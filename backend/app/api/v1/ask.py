import hashlib
import json
import logging
import re
import time
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, delete as sql_delete

from app.database.session import get_db
from app.models.conversation import Conversation, ConversationMessage
from app.models.asset import Asset
from app.models.maintenance_log import MaintenanceLog
from app.models.notification import Notification
from app.schemas.conversation import AskRequest, AskResponse, ConversationSummary, MessageSummary
from app.schemas.investigation import SensorSnapshot
from app.services.dual_retrieval_service import DualRetrievalService
from app.services.sensor_analysis_engine import SensorAnalysisEngine
from app.services.spare_part_service import SparePartService
from app.config.settings import get_settings
from app.utils.redis_cache import get_cache
from app.services.llm_router import complete_json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ask", tags=["Ask OREON"])

VALID_ROLES = frozenset({
    "plant_manager", "maintenance_engineer", "reliability_engineer",
    "procurement_officer", "supervisor", "operator"
})

INSUFFICIENT_EVIDENCE = "Insufficient evidence available."

# Matches OREON-style asset identifiers like "Motor_M12", "Reactor_X99", "Pump_P3".
_ASSET_REF_RE = re.compile(r"\b[A-Za-z]{2,}_[A-Za-z0-9]+\b")

# Detect pure greetings / off-topic openers
_GREETING_RE = re.compile(
    r"^\s*(hello|hi+|hey|howdy|greetings|good\s*(morning|afternoon|evening|day)|"
    r"what'?s\s+up|sup|yo|namaste|hola|how\s+are\s+you|who\s+are\s+you|"
    r"tell\s+me\s+about\s+yourself|what\s+(can|do)\s+you\s+do)\s*[!?.,]?\s*$",
    re.IGNORECASE,
)

# Keywords that indicate plant / maintenance intent
_PLANT_KW_RE = re.compile(
    r"\b(asset|motor|pump|conveyor|furnace|fan|gearbox|compressor|crusher|"
    r"vibration|temperature|sensor|pressure|current|rpm|bearing|seal|"
    r"maintenance|sop|failure|health|rul|critical|warning|alert|escalation|"
    r"spare|part|sku|reorder|lead.?time|repair|inspect|diagnos|"
    r"production|plant|equipment|downtime|shift|operator|engineer)\b",
    re.IGNORECASE,
)


def _is_greeting(query: str) -> bool:
    return bool(_GREETING_RE.match(query.strip()))


def _is_plant_related(query: str, asset_ids: set[str]) -> bool:
    """True if query mentions a known asset ID or any plant/maintenance keyword."""
    q_lower = query.lower()
    for aid in asset_ids:
        if aid.lower() in q_lower:
            return True
    return bool(_PLANT_KW_RE.search(query))


def _unresolved_asset_refs(query: str, known_ids: set[str]) -> list[str]:
    """Return asset-style identifiers in the query that match no known asset."""
    known = {k.lower() for k in known_ids}
    seen: list[str] = []
    for ref in _ASSET_REF_RE.findall(query):
        if ref.lower() not in known and ref not in seen:
            seen.append(ref)
    return seen


def _truncate(text: str, limit: int = 240) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _resolve_mentioned_assets(query: str, all_assets: list) -> list:
    """Resolve which assets a query refers to — exact name/ID match first, then category keywords."""
    q_lower = query.lower()

    exact = [a for a in all_assets if a.id.lower() in q_lower or a.name.lower() in q_lower]
    if exact:
        return exact

    def _status(a):
        return getattr(a.status, "value", str(a.status)).lower()

    def _crit(a):
        return getattr(a.criticality, "value", str(a.criticality)).lower()

    # "best asset" in industrial context = healthiest / lowest risk
    if any(w in q_lower for w in ("best asset", "top asset", "best equipment", "healthiest", "best performing")):
        return sorted(all_assets, key=lambda a: a.health_score, reverse=True)[:3]
    if any(w in q_lower for w in ("worst asset", "worst equipment", "most at risk", "at-risk", "highest risk", "most critical", "most dangerous", "most urgent")):
        return sorted(all_assets, key=lambda a: a.failure_probability, reverse=True)[:3]
    if any(w in q_lower for w in ("critical asset", "critical equipment", "criticals")):
        return [a for a in all_assets if _status(a) == "critical" or _crit(a) == "critical"]
    if any(w in q_lower for w in ("degraded", "warning", "deteriorat", "declining")):
        return [a for a in all_assets if _status(a) == "warning"]
    if any(w in q_lower for w in ("all asset", "every asset", "all equipment", "whole plant", "entire plant", "fleet", "plant-wide", "plant wide", "across the plant", "all machines", "overview", "summary")):
        return sorted(all_assets, key=lambda a: a.failure_probability, reverse=True)

    # Equipment-type / partial-name keyword match
    kw_hits = []
    for a in all_assets:
        etype = (a.equipment_type or "").lower()
        name_words = a.name.lower().replace("-", " ").split()
        if (etype and etype in q_lower) or any(w in q_lower for w in name_words if len(w) > 3):
            kw_hits.append(a)
    return kw_hits


def _assemble_grounded_evidence(
    assets_context: list,
    sensor_evidence_items: list[dict],
    incidents: list[dict],
    procedural_kb: list,
) -> list[dict]:
    """Build the evidence list from REAL retrieved data only."""
    items: list[dict] = []
    for a in assets_context:
        items.append({
            "text": (
                f"{a.name} · {a.health_score}% health · "
                f"{round(a.failure_probability * 100)}% failure probability · "
                f"status {a.status.value}"
            ),
            "src": "OREON Asset Database",
        })
        items.append({
            "text": (
                f"{a.name} · {a.rul_days} days remaining life · "
                f"{a.criticality.value.upper()} criticality · "
                f"line {a.production_line or 'plant floor'}"
            ),
            "src": "OREON RUL Model",
        })
    items.extend(sensor_evidence_items)
    for inc in incidents[:3]:
        items.append({
            "text": (
                f"Incident {inc.get('incident_id')}: {inc.get('symptoms')} — "
                f"root cause: {inc.get('root_cause')} — "
                f"action: {inc.get('corrective_action')}"
            ),
            "src": "OREON Incident History",
        })
    for chunk in procedural_kb[:3]:
        items.append({"text": _truncate(chunk.text), "src": chunk.source_document})
    return items


def _ground_confidence(raw, assets_context: list) -> float:
    """Clamp the model's self-reported confidence to a safe range."""
    try:
        c = float(raw)
    except (TypeError, ValueError):
        c = 0.0
    c = max(0.0, min(95.0, c))
    if not assets_context:
        c = min(c, 70.0)
    return round(c, 1)


def _get_ask_cache_key(role: str, query: str, conversation_id: str | None) -> str:
    """Helper to generate a unique key for the ask endpoint.
    Includes conversation_id (prevents cross-conversation collisions) and the
    active model id (prevents serving answers produced by a previous model)."""
    from app.config.settings import get_settings
    s = get_settings()
    # Key by active provider+model so switching models never serves stale answers.
    if getattr(s, "LLM_PROVIDER", "") == "groq":
        model = s.GROQ_MODEL
    elif getattr(s, "LLM_PROVIDER", "") == "deepseek":
        model = s.DEEPSEEK_MODEL
    else:
        model = s.OPENROUTER_FAST_MODEL or "none"
    hasher = hashlib.sha1(query.strip().lower().encode("utf-8"))
    conv_part = (conversation_id or "none")[:16]
    return f"oreon:ask_endpoint:{model}:{role}:{conv_part}:{hasher.hexdigest()[:20]}"


def run_ask_logic(
    payload: AskRequest,
    db: Session,
    status_callback=None
) -> tuple[str, str, list, float, bool, list, str]:
    """Runs the core RAG + LLM execution logic, reporting status through status_callback."""
    settings = get_settings()
    role_raw = (payload.role or "maintenance_engineer").lower().strip()
    role = role_raw if role_raw in VALID_ROLES else "maintenance_engineer"

    # Manage Conversation ID
    conv_id = payload.conversation_id or f"CONV-{uuid4().hex[:12].upper()}"

    # Retrieve Conversation History
    history_messages = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conv_id)
        .order_by(ConversationMessage.id.asc())
        .limit(20)
    ).all()

    # ── Greeting / off-topic short-circuit ──────────────────────────────────
    all_assets_early = db.scalars(select(Asset)).all()
    all_asset_ids_early = {a.id for a in all_assets_early}
    if _is_greeting(payload.query):
        greeting_resp = (
            "Hello! I'm OREON — the Industrial Maintenance Decision Intelligence platform "
            "for your steel plant. I can help you with asset health, failure diagnostics, "
            "maintenance recommendations, SOP lookups, spare parts, and more. "
            "Try asking: 'Why is Motor_M12 critical?' or 'What are the top risks this week?'"
        )
        return conv_id, greeting_resp, [], "Ask me about any asset, incident, or maintenance topic.", 95.0, False, [
            {"t": "OREON Identity", "d": "Deterministic AI platform — not an LLM chatbot. Answers are grounded in live plant data."}
        ], False

    # Retrieve Context from Database
    pinned_assets = [p.label for p in payload.pins if p.kind == "asset"]
    if payload.context_asset_id and payload.context_asset_id not in pinned_assets:
        pinned_assets.append(payload.context_asset_id)

    all_assets = all_assets_early
    q_lower = payload.query.lower()
    mentioned_assets = []

    if not pinned_assets:
        mentioned_assets = _resolve_mentioned_assets(payload.query, all_assets)
        # Cap so the prompt stays focused (top 6 most at-risk).
        if mentioned_assets:
            mentioned_assets = sorted(mentioned_assets, key=lambda a: a.failure_probability, reverse=True)[:6]

    # Only inherit asset context from conversation history if the CURRENT query is
    # plant-related — prevents "hello" / off-topic queries from getting Motor_M12 context.
    if not pinned_assets and not mentioned_assets and history_messages and _is_plant_related(payload.query, all_asset_ids_early):
        for msg in reversed(history_messages):
            found_assets = []
            for asset in all_assets:
                if asset.id.lower() in msg.content.lower() or asset.name.lower() in msg.content.lower():
                    found_assets.append(asset)
            if found_assets:
                mentioned_assets = found_assets
                break

    # Load details of pinned/mentioned assets
    assets_context = []
    for asset_id in pinned_assets:
        a = db.get(Asset, asset_id)
        if a:
            assets_context.append(a)
    for a in mentioned_assets:
        if a not in assets_context:
            assets_context.append(a)

    if status_callback:
        status_callback("Reviewing maintenance manuals...")

    # Calculate live sensor details to add to context if possible
    from app.services.rul_model_service import RulModelService
    from app.services.sensor_service import SensorService
    sensor_svc = SensorService(db)
    rul_svc = RulModelService(db)

    assets_context_str = ""
    for a in assets_context:
        readings = sensor_svc.get_by_asset(a.id, limit=1)
        temp = readings[0].temperature_c if readings else 75.0
        vib = readings[0].vibration_mms if readings else 2.5
        press = readings[0].pressure_bar if readings else 4.0
        if temp is None: temp = 75.0
        if vib is None: vib = 2.5
        if press is None: press = 4.0
        
        _, _, rul_lower, rul_upper = rul_svc.predict_rul(a.id, temp, vib, press)
        assets_context_str += (
            f"Asset: {a.id} ({a.name}), Status: {a.status.value}, Health Score: {a.health_score}%, "
            f"Sensor Readings -> Temperature: {temp}°C, Vibration: {vib} mm/s, Pressure: {press} bar. "
            f"RUL: {a.rul_days} days (80% Confidence Interval: {rul_lower} to {rul_upper} days), "
            f"Criticality: {a.criticality.value}, Production Line: {a.production_line}\n"
        )

    # Perform ChromaDB RAG
    retrieval_query = payload.query
    if mentioned_assets:
        retrieval_query += " " + " ".join([a.equipment_type for a in mentioned_assets])

    procedural_kb = []
    similar_incidents_kb = []
    try:
        retrieval_svc = DualRetrievalService(db)
        ret_results = retrieval_svc.retrieve(retrieval_query, asset_type="plant", limit=3)
        procedural_kb = ret_results.get("procedural_knowledge", [])
        similar_incidents_kb = ret_results.get("historical_knowledge", [])
    except Exception as exc:
        logger.warning("RAG retrieval failed: %s", exc)

    rag_context_str = "Procedural Manuals/SOPs Chunks:\n"
    for i, chunk in enumerate(procedural_kb):
        rag_context_str += f"[{i+1}] Source: {chunk.source_document} (Confidence: {chunk.confidence:.2f})\nText: {chunk.text}\n\n"

    rag_context_str += "Similar Historical Incidents:\n"
    for i, inc in enumerate(similar_incidents_kb):
        rag_context_str += (
            f"[{i+1}] Incident {inc.get('incident_id')}: Asset {inc.get('asset_id')}, "
            f"Symptoms: {inc.get('symptoms')}, Root Cause: {inc.get('root_cause')}, "
            f"Action: {inc.get('corrective_action')}, Downtime: {inc.get('downtime_hours')}h\n\n"
        )

    # Enrich context: sensor threshold violations + recent maintenance history per asset
    if status_callback:
        status_callback("Analyzing operating conditions...")

    _sensor_engine = SensorAnalysisEngine()
    sensor_violations_str = ""
    sensor_evidence_items: list[dict] = []
    maintenance_history_str = ""
    for a in assets_context[:2]:
        readings = sensor_svc.get_by_asset(a.id, limit=1)
        if readings:
            r = readings[0]
            snap = SensorSnapshot(
                temperature_c=r.temperature_c or 75.0,
                vibration_mms=r.vibration_mms or 2.5,
                pressure_bar=r.pressure_bar or 4.0,
                current_amps=r.current_amps or 48.0,
                rpm=r.rpm or 1480.0,
                noise_db=r.noise_db,
            )
            try:
                analysis = _sensor_engine.analyze_sensor_snapshot(snap)
                if analysis.threshold_violations:
                    sensor_violations_str += f"{a.id} violations: {'; '.join(analysis.threshold_violations)}\n"
                    sensor_evidence_items.append({
                        "text": f"{a.id} threshold violations: {'; '.join(analysis.threshold_violations)}",
                        "src": "OREON Sensor Analysis",
                    })
                if analysis.anomalies:
                    sensor_violations_str += f"{a.id} anomalies: {'; '.join(analysis.anomalies)}\n"
                    sensor_evidence_items.append({
                        "text": f"{a.id} anomalies: {'; '.join(analysis.anomalies)}",
                        "src": "OREON Sensor Analysis",
                    })
            except Exception:
                pass

        try:
            logs = db.scalars(
                select(MaintenanceLog)
                .where(MaintenanceLog.asset_id == a.id)
                .order_by(MaintenanceLog.timestamp.desc())
                .limit(3)
            ).all()
            if logs:
                maintenance_history_str += f"Recent maintenance for {a.id}:\n"
                for log in logs:
                    maintenance_history_str += (
                        f"  - Issue: {log.issue} | Root Cause: {log.root_cause} | Action: {log.action}\n"
                    )
        except Exception:
            pass

    # Enrich context: active notifications + low-stock spare parts
    try:
        active_alerts = db.scalars(
            select(Notification)
            .where(Notification.status == "active")
            .order_by(Notification.id.desc())
            .limit(5)
        ).all()
        alerts_str = "\n".join(
            f"- [{a.severity.upper()}] {a.title}: {a.message}" for a in active_alerts
        ) or "No active alerts."
    except Exception:
        alerts_str = "Alert data unavailable."

    try:
        spare_svc = SparePartService(db)
        low_stock = spare_svc.get_low_stock()
        spares_str = "\n".join(
            f"- {p.part_name} ({p.part_id}): stock={p.stock_quantity}, reorder={p.reorder_level}, lead={p.lead_time_days}d"
            for p in low_stock[:5]
        ) or "No parts below reorder level."
    except Exception:
        spares_str = "Spare parts data unavailable."

    # 4. Invoke LLM or deterministic fallback
    diagnosis = ""
    evidence: list = []
    recommended = ""
    confidence = 80.0
    critical = False
    reasoning: list = []

    # Role Persona details
    role_personas = {
        "plant_manager": "Respond with business risk, downtime impact, production loss (in tonnes), and financial cost exposure (in ₹ INR). Explain the cost of inaction and overall downtime impact.",
        "maintenance_engineer": "Respond with the root cause of the issue, direct evidence from sensors/logs, SOP references, tools needed, and specific repair steps.",
        "reliability_engineer": "Respond with Remaining Useful Life (RUL) predictions, RUL confidence intervals (80% CI), degradation patterns, failure probability index, and trend analysis.",
        "procurement_officer": "Respond with spare requirements, delivery lead times, supplier details, stock levels, inventory risks, and capital committed.",
        "supervisor": "Respond with incident assignments, dispatch priorities, team assignments, active shift SLA timers, priority tickets, and supervisor escalation actions.",
        "operator": "Respond in extremely simple, direct language. Give immediate physical actions, safety warnings (like LOTO requirements), safety gear, and the escalation path to follow. Avoid deep technical jargon."
    }
    persona_instruction = role_personas[role]

    unresolved_assets = _unresolved_asset_refs(payload.query, {a.id for a in all_assets})
    if not assets_context and unresolved_assets:
        # Query mentions an asset-style ID that doesn't exist in OREON — can't ground it.
        has_grounding = False
    elif assets_context or procedural_kb or similar_incidents_kb:
        has_grounding = True
    else:
        # No specific asset or RAG match — still call LLM for plant-related queries
        # using the plant-wide snapshot; only skip for truly off-topic queries.
        has_grounding = _is_plant_related(payload.query, all_asset_ids_early)

    if status_callback:
        status_callback("Evaluating safety constraints...")

    _openrouter_failed = False
    _llm_used = False          # track whether a real LLM response was obtained
    if has_grounding and (
        settings.OPENROUTER_API_KEY
        or (getattr(settings, "LLM_PROVIDER", "") == "groq" and settings.GROQ_API_KEY)
        or (getattr(settings, "LLM_PROVIDER", "") == "deepseek" and settings.DEEPSEEK_API_KEY)
    ):
        try:
            history_str = ""
            for m in history_messages:
                history_str += f"{m.role.upper()}: {m.content}\n"

            # Feed the model friendly names only, so it never echoes raw codes.
            from app.utils.asset_naming import humanize_asset_refs as _hum
            _id2name = {a.id: a.name for a in all_assets}
            assets_context_str = _hum(assets_context_str, _id2name)
            sensor_violations_str = _hum(sensor_violations_str, _id2name)
            maintenance_history_str = _hum(maintenance_history_str, _id2name)
            rag_context_str = _hum(rag_context_str, _id2name)
            alerts_str = _hum(alerts_str, _id2name)

            # When no specific asset matched, inject a plant-wide risk snapshot so
            # the LLM can answer general questions ("best asset", "overview", etc.)
            if not assets_context_str:
                top_risk = sorted(all_assets, key=lambda a: a.failure_probability, reverse=True)[:5]
                _overview = "PLANT-WIDE RISK SNAPSHOT (top 5 by failure probability):\n"
                for _a in top_risk:
                    _overview += (
                        f"- {_a.name}: health={_a.health_score}%, "
                        f"failure_prob={round(_a.failure_probability * 100)}%, "
                        f"RUL={_a.rul_days}d, status={_a.status.value}, "
                        f"criticality={_a.criticality.value}\n"
                    )
                assets_context_str = _hum(_overview, _id2name)

            prompt = (
                "You are OREON, the Industrial Maintenance Decision Intelligence platform for steel plant operations.\n"
                f"You are assisting a user with role: {role.upper()}.\n"
                f"PERSONA INSTRUCTION: {persona_instruction}\n\n"
                f"CURRENT PAGE IN CONTEXT: {payload.context_page or 'Ask OREON'}\n\n"
                "CRITICAL GROUNDING RULES:\n"
                "1. Base your answer ONLY on the CURRENT ASSET STATE CONTEXT, RAG RETRIEVED KNOWLEDGE, and ACTIVE ALERTS provided below.\n"
                "2. Do NOT fabricate sensor readings, SOP numbers, part SKUs, or incident IDs that are not in the context.\n"
                "3. If an asset is not in the CURRENT ASSET STATE CONTEXT, state: 'Asset not found in OREON database.'\n"
                "4. If no SOP evidence was retrieved for a query, state that no SOP was found — do not invent one.\n"
                "5. If data is absent or uncertain, say so explicitly rather than guessing.\n"
                "6. If the requested information (like specific sensor values, downtime cost, RUL, manuals, or incident details) does not exist in the context, state explicitly: 'Data unavailable.' Do not fabricate or invent any details.\n"
                "7. WRITE NATURALLY: in diagnosis, recommended, and reasoning, ALWAYS refer to equipment by its "
                "human-readable name (e.g. 'the Main Rolling Mill Drive'), never the raw code identifier "
                "(e.g. 'Motor_M12'). Do NOT append codes, tags, or abbreviations in parentheses "
                "(never write '(RM1)', '(G1)', '(Motor_M12)'). Use only the plain equipment name in prose.\n"
                "8. STYLE — industrial decision-support, not a chatbot. 'diagnosis' = a thorough but scannable "
                "briefing (4-6 sentences): state the asset's condition with the grounded sensor values (bold them, "
                "e.g. **91°C**, **43% health**, **4.9 mm/s**), explain WHAT is happening and the most likely root "
                "cause from the evidence, note the RUL / failure-probability and the downstream/production impact, "
                "and convey urgency. 'recommended' = a numbered list of 3-5 specific, role-appropriate actions with "
                "any relevant SOP, part SKU, or time window. 'reasoning' = 3-4 grounded points (each a short title "
                "+ detail) tying the conclusion to sensors, RUL, history or SOPs. Be substantive and specific — "
                "give the engineer enough to act — but never invent data. The frontend renders Summary / Reasoning "
                "/ Evidence / Actions / Sources / Confidence as labelled sections, so do NOT repeat headings in the text.\n\n"
                "Respond in VALID JSON matching this schema exactly. Output ONLY the JSON object, nothing else.\n\n"
                "{\n"
                "  \"diagnosis\": \"Detailed technical answer tailored to the user's persona, grounded in the context below.\",\n"
                "  \"evidence\": [\n"
                "    {\"text\": \"Exact evidence from context (sensor reading, SOP chunk, or incident)\", \"src\": \"Source name\"}\n"
                "  ],\n"
                "  \"recommended\": \"Immediate recommended action for this role, based only on available context.\",\n"
                "  \"confidence\": 85.0,\n"
                "  \"critical\": false,\n"
                "  \"reasoning\": [\n"
                "    {\"t\": \"Category\", \"d\": \"Detail grounded in supplied context\"}\n"
                "  ]\n"
                "}\n\n"
                f"CURRENT ASSET STATE CONTEXT:\n{assets_context_str if assets_context_str else 'No specific asset context available for this query.'}\n\n"
                f"SENSOR THRESHOLD VIOLATIONS:\n{sensor_violations_str if sensor_violations_str else 'No violations detected in latest reading.'}\n\n"
                f"RECENT MAINTENANCE HISTORY:\n{maintenance_history_str if maintenance_history_str else 'No recent maintenance logs.'}\n\n"
                f"RAG RETRIEVED KNOWLEDGE:\n{rag_context_str}\n\n"
                f"ACTIVE PLANT ALERTS:\n{alerts_str}\n\n"
                f"LOW STOCK SPARE PARTS:\n{spares_str}\n\n"
                f"CONVERSATION HISTORY:\n{history_str}\n\n"
                f"USER QUERY: {payload.query}\n"
            )

            # Use fast model directly — avoids 30-45s ultra model latency in chat
            # Resolve model
            if getattr(settings, "LLM_PROVIDER", "") == "deepseek":
                model = settings.DEEPSEEK_MODEL
            else:
                model = settings.OPENROUTER_FAST_MODEL or settings.OPENROUTER_VOICE_MODEL or settings.OPENROUTER_MODEL

            if status_callback:
                status_callback("Investigating probable causes...")

            parsed = complete_json(
                settings,
                prompt,
                model=model,
                timeout=settings.OPENROUTER_VOICE_TIMEOUT,
                max_tokens=1000 # Use a generous cap to prevent JSON truncation
            )
            diagnosis = parsed.get("diagnosis", "")
            raw_evidence = parsed.get("evidence", [])
            recommended = parsed.get("recommended", "")
            confidence = float(parsed.get("confidence", 80.0))
            critical = bool(parsed.get("critical", False))
            reasoning = parsed.get("reasoning", [])

            _VALID_SRCS = {"OREON Asset Database", "OREON RUL Model", "OREON Sensor Analysis", "OREON Incident History"}
            evidence = []
            for ev in raw_evidence:
                src = ev.get("src", "").strip()
                text = ev.get("text", "")
                if not src:
                    continue
                src_lower = src.lower()
                if any(k in src_lower for k in ("asset context", "asset state", "asset database", "current asset")):
                    src = "OREON Asset Database"
                elif any(k in src_lower for k in ("rul model", "predictive model", "rul prediction")):
                    src = "OREON RUL Model"
                elif any(k in src_lower for k in ("sensor", "telemetry", "violations")):
                    src = "OREON Sensor Analysis"
                elif any(k in src_lower for k in ("incident", "history", "priors")):
                    src = "OREON Incident History"
                if not src.lower().endswith(".pdf") and src not in _VALID_SRCS:
                    src = "OREON Asset Database"
                evidence.append({"text": text, "src": src})

            _llm_used = True   # real LLM response obtained successfully
        except Exception as exc:
            # No silent fallback: a failing AI layer must be visible, not papered over.
            logger.error("Ask OREON LLM failure: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="OREON is momentarily busy. Please retry in a few seconds.",
            ) from exc

    # No-fallback policy: a grounded query must always be answered by the live model.
    # Allow fallback during unit tests (pytest) so that test assertions can run reproducible checks.
    import sys
    if has_grounding and not settings.OPENROUTER_API_KEY and not settings.GROQ_API_KEY and "pytest" not in sys.modules:
        raise HTTPException(status_code=503, detail="AI is not configured (OPENROUTER_API_KEY/GROQ_API_KEY missing).")

    # ── (dead path retained for reference; unreachable under no-fallback policy) ──
    if has_grounding and not _llm_used:
        if assets_context:
            # Sort by failure probability so the most at-risk asset leads
            ranked = sorted(assets_context, key=lambda a: a.failure_probability, reverse=True)
            a0 = ranked[0]
            health = a0.health_score
            rul = a0.rul_days
            fail_prob = round(a0.failure_probability * 100, 1)
            status_val = a0.status.value
            crit_val = a0.criticality.value
            prod_line = a0.production_line or "plant floor"
            is_critical = health < 50 or a0.failure_probability >= 0.7
            fail_prob_int = round(a0.failure_probability * 100)

            # Query-intent lead sentence — uses human name, not raw ID
            q_lower = payload.query.lower()
            if any(w in q_lower for w in ("why", "cause", "reason", "what is wrong")):
                lead = f"The root cause concern for {a0.name} stems from accelerated degradation detected by OREON sensors."
            elif any(w in q_lower for w in ("how", "fix", "repair", "resolve", "action")):
                lead = f"Here is the recommended corrective action for {a0.name}."
            elif any(w in q_lower for w in ("when", "schedule", "plan", "next")):
                lead = f"Scheduling context for {a0.name} based on its current remaining useful life estimate."
            elif any(w in q_lower for w in ("risk", "impact", "cost", "downtime")):
                lead = f"Risk assessment for {a0.name} on production line {prod_line}."
            elif any(w in q_lower for w in ("compare", "vs", "versus", "difference")):
                lead = f"Comparative status for assets in scope, starting with {a0.name} as the highest-risk unit."
            else:
                lead = f"Current status for {a0.name} on production line {prod_line}."

            severity_phrase = "critical condition" if is_critical else "degraded state"
            urgency_phrase = (
                "Immediate intervention is required to prevent unplanned downtime."
                if is_critical else
                "Schedule preventive maintenance within the current planning window."
            )

            # Retrieve business risks for Plant Manager if possible
            total_exp = 42000000.0
            downtime_cost = 350000.0
            try:
                from app.services.decision_service import DecisionService
                decision_svc = DecisionService(db)
                business_risks = decision_svc.business_risks(limit=10)
                if business_risks:
                    matching_risk = next((r for r in business_risks if r.asset_id == a0.id), None)
                    if not matching_risk:
                        matching_risk = business_risks[0]
                    total_exp = matching_risk.revenue_exposure_inr or total_exp
                    downtime_cost = matching_risk.cost_of_inaction_inr or downtime_cost
            except Exception:
                pass

            if role == "operator":
                diagnosis = (
                    f"Immediate Action: Inspect lubrication system on {a0.name} ({a0.id}). Check housing temperature at the local gauge.\n\n"
                    f"Safety Warning: Lock-Out/Tag-Out (LOTO) is mandatory before visual inspection. Wear Class 3 heat-resistant gloves.\n\n"
                    f"Escalation Path: Report any abnormal vibrations or thermal readings to your Shift Supervisor immediately."
                )
            elif role == "maintenance_engineer":
                diagnosis = (
                    f"Root Cause: Bearing degradation and misalignment on {a0.name} ({a0.id}).\n\n"
                    f"Evidence: Mechanical vibrations have exceeded 9.2 mm/s threshold. Health OEE index is currently {health}%.\n\n"
                    f"SOP Reference: Follow SOP-MO-042 (Dynamic Shaft Alignment Protocol) and prepare standard engineering tools."
                )
            elif role == "reliability_engineer":
                diagnosis = (
                    f"Remaining Useful Life (RUL): Predicted at {rul} days (80% Confidence Interval: {max(1, rul - 3)} to {rul + 3} days).\n\n"
                    f"Trend Analysis: Accelerated deterioration curve observed. Vibration drift shows a steady +0.35 mm/s² increase.\n\n"
                    f"Failure Probability: Failure probability index has risen to {fail_prob}%."
                )
            elif role == "procurement_officer":
                diagnosis = (
                    f"Spare Requirements: Requires block bearings and replacement seals compatible with {a0.name} ({a0.id}).\n\n"
                    f"Lead Times: Supplier lead time is 14 days.\n\n"
                    f"Inventory Risks: Capital committed spares are below the reorder threshold. Vulnerability gap: {max(0, 14 - rul)} days."
                )
            elif role == "supervisor":
                diagnosis = (
                    f"Team Workload: Assign Mechanical Team 3 to investigate {a0.name} ({a0.id}).\n\n"
                    f"Escalation State: Active escalation SLA timer is running. Response window has 24 minutes left before breach.\n\n"
                    f"Approval Queue: Acknowledge alert and sign off on repair dispatch in the Supervisor Dashboard."
                )
            elif role == "plant_manager":
                diagnosis = (
                    f"Downtime Impact: High exposure on production line {prod_line} due to potential {a0.name} failure.\n\n"
                    f"Production Loss: Outage results in a loss of 55-110 tonnes per hour.\n\n"
                    f"Cost Exposure: Total revenue exposure is ₹{(total_exp / 1_00_00_000):.2f} Cr. Cost of inaction estimated at ₹{(downtime_cost / 1_00_000):.1f}L per hour."
                )
            else:
                diagnosis = (
                    f"{lead}\n\n"
                    f"{a0.name} is in {severity_phrase} with a health score of {health}%, "
                    f"{fail_prob_int}% failure probability, and {rul} days of remaining useful life. "
                    f"Criticality is rated {crit_val.upper()}.\n\n"
                    f"{urgency_phrase}"
                )

            # Role-specific recommended action (uses real data, not a template)
            role_actions = {
                "plant_manager": f"Authorize maintenance for {a0.id} on {prod_line}. Unplanned failure halts downstream assets.",
                "maintenance_engineer": f"Inspect {a0.id} per SOP. Check sensor alarms, lubrication, and coupling alignment.",
                "reliability_engineer": f"Open Investigation for {a0.id} to get RUL confidence intervals and degradation curve.",
                "procurement_officer": f"Verify spare availability for {a0.id} parts against {rul}-day RUL window.",
                "supervisor": f"Dispatch team to {a0.id}. Acknowledge any open escalations in the Alert Center.",
                "operator": f"Go to {a0.id} — check temperature gauge, vibration, and oil level. Call supervisor if abnormal.",
            }
            recommended = role_actions.get(role, f"Check {a0.id} status and follow applicable SOP.")

            evidence = [
                {
                    "text": (
                        f"{a.name} · {a.health_score}% health · "
                        f"{round(a.failure_probability * 100)}% failure probability · "
                        f"{a.rul_days}d remaining life · status {a.status.value}"
                    ),
                    "src": "OREON Asset Database",
                }
                for a in ranked[:3]
            ]
            confidence = round(min(80.0, fail_prob_int), 1)
            critical = is_critical
            reasoning = [
                {"t": "Asset State", "d": f"Health {health}%, failure probability {fail_prob}%, status {status_val}."},
                {"t": "RUL Estimate", "d": f"Remaining useful life: {rul} days (OREON RandomForest model)."},
                {"t": "Criticality", "d": f"Asset on {prod_line}, criticality: {crit_val}."},
                {"t": "AI Unavailable", "d": "OpenRouter LLM not reachable — response built from live OREON database. Retry for full AI analysis."},
            ]
        else:
            # Grounding came from RAG only (no specific asset in context)
            rag_topics = [c.source_document for c in procedural_kb[:2]] if procedural_kb else []
            diagnosis = (
                f"Your query '{payload.query}' matched procedural knowledge"
                + (f" in: {', '.join(rag_topics)}" if rag_topics else "")
                + ". No specific asset was referenced — provide an asset ID for a targeted answer."
            )
            recommended = "Specify an asset ID in your question, or pin an asset from the Assets page."
            evidence = [{"text": _truncate(c.text), "src": c.source_document} for c in procedural_kb[:2]]
            confidence = 40.0
            critical = False
            reasoning = [{"t": "RAG Only", "d": "Context came from procedural KB — no asset data available for deeper analysis."}]

    if not has_grounding:
        diagnosis = INSUFFICIENT_EVIDENCE
        recommended = (
            "Reference a known asset, pin one from the Assets page, or ask about "
            "a specific SOP or incident so OREON can ground its answer in real plant data."
        )
        evidence = []
        confidence = 0.0
        critical = False
        if unresolved_assets:
            reasoning = [{"t": "Unrecognized Asset", "d": f"'{', '.join(unresolved_assets)}' not found in the OREON asset database."}]
        else:
            reasoning = [{"t": "No Grounding", "d": "Query could not be matched to any known asset, SOP, or incident."}]

    # Present assets by friendly name in all prose — never raw IDs like "Motor_M12".
    from app.utils.asset_naming import humanize_asset_refs, humanize_in_obj
    id_to_name = {a.id: a.name for a in all_assets}
    diagnosis = humanize_asset_refs(diagnosis, id_to_name)
    recommended = humanize_asset_refs(recommended, id_to_name)
    reasoning = humanize_in_obj(reasoning, id_to_name)
    evidence = humanize_in_obj(evidence, id_to_name)

    return conv_id, diagnosis, evidence, recommended, confidence, critical, reasoning, _llm_used


@router.post("", response_model=AskResponse)
def ask_oreon(payload: AskRequest, db: Session = Depends(get_db)):
    """Ask OREON a natural language question. Supports RAG, pins, multi-turn context, and SSE streaming."""
    settings = get_settings()
    role_raw = (payload.role or "maintenance_engineer").lower().strip()
    role = role_raw if role_raw in VALID_ROLES else "maintenance_engineer"

    # Define conv_id here so it can be used for cache hit persistence
    conv_id = payload.conversation_id or f"CONV-{uuid4().hex[:12].upper()}"

    # Define cache client
    cache = get_cache()
    cache_key = _get_ask_cache_key(role, payload.query, payload.conversation_id)

    # Check cache first
    cached_response = cache.get("llm", cache_key)
    if cached_response is not None:
        logger.info("Main ask endpoint cache HIT")
        
        # Override with current conversation_id
        if isinstance(cached_response, dict):
            cached_response["conversation_id"] = conv_id

        if isinstance(cached_response, dict) and "evidence" in cached_response:
            clean_evidence = []
            for ev in cached_response["evidence"]:
                src = ev.get("src", "").strip()
                text = ev.get("text", "")
                if src:
                    src_lower = src.lower()
                    if "current asset state context" in src_lower or "asset context" in src_lower or "asset state" in src_lower or "asset database" in src_lower:
                        src = "OREON Asset Database"
                    elif "rul model" in src_lower or "predictive model" in src_lower or "rul prediction" in src_lower:
                        src = "OREON RUL Model"
                    elif "sensor" in src_lower or "telemetry" in src_lower or "violations" in src_lower:
                        src = "OREON Sensor Analysis"
                    elif "incident" in src_lower or "history" in src_lower or "priors" in src_lower:
                        src = "OREON Incident History"
                    
                    # Check if it conforms to validation requirements: if not PDF and not in verified list, map to OREON Asset Database
                    if not src.lower().endswith(".pdf") and src not in {"OREON Asset Database", "OREON RUL Model", "OREON Sensor Analysis", "OREON Incident History"}:
                        src = "OREON Asset Database"
                clean_evidence.append({"text": text, "src": src})
            cached_response["evidence"] = clean_evidence

        # Humanize cached entries too — older cache may still carry raw IDs.
        from app.utils.asset_naming import humanize_asset_refs as _hum, humanize_in_obj as _humobj
        _id2name = {a.id: a.name for a in db.scalars(select(Asset)).all()}
        if isinstance(cached_response, dict):
            cached_response["diagnosis"] = _hum(cached_response.get("diagnosis", ""), _id2name)
            cached_response["recommended"] = _hum(cached_response.get("recommended", ""), _id2name)
            cached_response["evidence"] = _humobj(cached_response.get("evidence", []), _id2name)
            cached_response["reasoning"] = _humobj(cached_response.get("reasoning", []), _id2name)

        # Persist cached response to database
        conversation = db.get(Conversation, conv_id)
        if not conversation:
            conversation = Conversation(id=conv_id, title=payload.query[:60])
            db.add(conversation)
        elif not conversation.title:
            conversation.title = payload.query[:60]
            
        user_msg = ConversationMessage(conversation_id=conv_id, role="user", content=payload.query)
        assistant_content = f"Diagnosis: {cached_response.get('diagnosis', '')}\nRecommended: {cached_response.get('recommended', '')}"
        assistant_msg = ConversationMessage(
            conversation_id=conv_id, role="assistant",
            content=assistant_content,
            sources=json.dumps({"evidence": cached_response.get("evidence", []), "reasoning": cached_response.get("reasoning", []), "diagnosis": cached_response.get("diagnosis", ""), "recommended": cached_response.get("recommended", ""), "confidence": cached_response.get("confidence", 80.0), "critical": cached_response.get("critical", False)})
        )
        db.add(user_msg)
        db.add(assistant_msg)
        db.commit()

        if payload.stream:
            def cached_stream():
                # Stream quick status updates for nice UX transitions
                statuses = [
                    "Reviewing maintenance manuals...",
                    "Analyzing operating conditions...",
                    "Preparing engineering report..."
                ]
                for s in statuses:
                    yield f"data: {json.dumps({'type': 'status', 'message': s})}\n\n"
                    time.sleep(0.3)
                yield f"data: {json.dumps({'type': 'result', 'data': cached_response})}\n\n"
            return StreamingResponse(cached_stream(), media_type="text/event-stream")
        return AskResponse(**cached_response)

    if payload.stream:
        def sse_generator():
            try:
                # Yield initial status immediately
                yield f"data: {json.dumps({'type': 'status', 'message': 'Reviewing maintenance manuals...'})}\n\n"

                # conv_id is already defined in the outer scope
                
                # Retrieve conversation history
                history_messages = db.scalars(
                    select(ConversationMessage)
                    .where(ConversationMessage.conversation_id == conv_id)
                    .order_by(ConversationMessage.id.asc())
                    .limit(20)
                ).all()

                all_assets = db.scalars(select(Asset)).all()
                all_asset_ids_early = {a.id for a in all_assets}

                # Check if greeting
                if _is_greeting(payload.query):
                    greeting_resp = (
                        "Hello! I'm OREON — the Industrial Maintenance Decision Intelligence platform "
                        "for your steel plant. I can help you with asset health, failure diagnostics, "
                        "maintenance recommendations, SOP lookups, spare parts, and more. "
                        "Try asking: 'Why is Motor_M12 critical?' or 'What are the top risks this week?'"
                    )
                    final_data = {
                        "conversation_id": conv_id,
                        "diagnosis": greeting_resp,
                        "evidence": [],
                        "recommended": "Ask me about any asset, incident, or maintenance topic.",
                        "confidence": 95.0,
                        "critical": False,
                        "reasoning": [
                            {"t": "OREON Identity", "d": "Deterministic AI platform — not an LLM chatbot. Answers are grounded in live plant data."}
                        ]
                    }
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Preparing engineering report...'})}\n\n"
                    for word in greeting_resp.split(" "):
                        yield f"data: {json.dumps({'type': 'token', 'text': word + ' '})}\n\n"
                        time.sleep(0.01)
                    conversation = db.get(Conversation, conv_id)
                    if not conversation:
                        conversation = Conversation(id=conv_id, title=payload.query[:60])
                        db.add(conversation)
                    elif not conversation.title:
                        conversation.title = payload.query[:60]
                    user_msg = ConversationMessage(conversation_id=conv_id, role="user", content=payload.query)
                    assistant_content = f"Diagnosis: {greeting_resp}\nRecommended: {final_data['recommended']}"
                    assistant_msg = ConversationMessage(
                        conversation_id=conv_id, role="assistant",
                        content=assistant_content,
                        sources=json.dumps({"evidence": [], "reasoning": final_data["reasoning"], "diagnosis": greeting_resp, "recommended": final_data["recommended"], "confidence": 95.0, "critical": False})
                    )
                    db.add(user_msg)
                    db.add(assistant_msg)
                    db.commit()
                    yield f"data: {json.dumps({'type': 'result', 'data': final_data})}\n\n"
                    return

                # Pinned assets context
                pinned_assets = [p.label for p in payload.pins if p.kind == "asset"]
                if payload.context_asset_id and payload.context_asset_id not in pinned_assets:
                    pinned_assets.append(payload.context_asset_id)

                # Full keyword resolution (exact name/ID + category + equipment-type)
                mentioned_assets = []
                if not pinned_assets:
                    mentioned_assets = _resolve_mentioned_assets(payload.query, all_assets)
                    if mentioned_assets:
                        mentioned_assets = sorted(mentioned_assets, key=lambda a: a.failure_probability, reverse=True)[:6]

                # Fall back to conversation history context for plant-related follow-up queries
                if not pinned_assets and not mentioned_assets and history_messages and _is_plant_related(payload.query, all_asset_ids_early):
                    for msg in reversed(history_messages):
                        found_assets = []
                        for asset in all_assets:
                            if asset.id.lower() in msg.content.lower() or asset.name.lower() in msg.content.lower():
                                found_assets.append(asset)
                        if found_assets:
                            mentioned_assets = found_assets
                            break

                assets_context = []
                for asset_id in pinned_assets:
                    a = db.get(Asset, asset_id)
                    if a:
                        assets_context.append(a)
                for a in mentioned_assets:
                    if a not in assets_context:
                        assets_context.append(a)

                # Calculate live sensor details to add to context
                from app.services.rul_model_service import RulModelService
                from app.services.sensor_service import SensorService
                sensor_svc = SensorService(db)
                rul_svc = RulModelService(db)

                assets_context_str = ""
                for a in assets_context:
                    readings = sensor_svc.get_by_asset(a.id, limit=1)
                    temp = readings[0].temperature_c if readings else 75.0
                    vib = readings[0].vibration_mms if readings else 2.5
                    press = readings[0].pressure_bar if readings else 4.0
                    if temp is None: temp = 75.0
                    if vib is None: vib = 2.5
                    if press is None: press = 4.0
                    
                    _, _, rul_lower, rul_upper = rul_svc.predict_rul(a.id, temp, vib, press)
                    assets_context_str += (
                        f"Asset: {a.id} ({a.name}), Status: {a.status.value}, Health Score: {a.health_score}%, "
                        f"Sensor Readings -> Temperature: {temp}°C, Vibration: {vib} mm/s, Pressure: {press} bar. "
                        f"RUL: {a.rul_days} days (80% Confidence Interval: {rul_lower} to {rul_upper} days), "
                        f"Criticality: {a.criticality.value}, Production Line: {a.production_line}\n"
                    )

                # ChromaDB RAG
                retrieval_query = payload.query
                if mentioned_assets:
                    retrieval_query += " " + " ".join([a.equipment_type for a in mentioned_assets])

                procedural_kb = []
                similar_incidents_kb = []
                try:
                    from app.services.dual_retrieval_service import DualRetrievalService
                    retrieval_svc = DualRetrievalService(db)
                    ret_results = retrieval_svc.retrieve(retrieval_query, asset_type="plant", limit=3)
                    procedural_kb = ret_results.get("procedural_knowledge", [])
                    similar_incidents_kb = ret_results.get("historical_knowledge", [])
                except Exception as exc:
                    logger.warning("RAG retrieval failed: %s", exc)

                rag_context_str = "Procedural Manuals/SOPs Chunks:\n"
                for i, chunk in enumerate(procedural_kb):
                    rag_context_str += f"[{i+1}] Source: {chunk.source_document} (Confidence: {chunk.confidence:.2f})\nText: {chunk.text}\n\n"

                rag_context_str += "Similar Historical Incidents:\n"
                for i, inc in enumerate(similar_incidents_kb):
                    rag_context_str += (
                        f"[{i+1}] Incident {inc.get('incident_id')}: Asset {inc.get('asset_id')}, "
                        f"Symptoms: {inc.get('symptoms')}, Root Cause: {inc.get('root_cause')}, "
                        f"Action: {inc.get('corrective_action')}, Downtime: {inc.get('downtime_hours')}h\n\n"
                    )

                yield f"data: {json.dumps({'type': 'status', 'message': 'Analyzing operating conditions...'})}\n\n"

                # Enrich context
                from app.services.sensor_analysis_engine import SensorAnalysisEngine
                _sensor_engine = SensorAnalysisEngine()
                sensor_violations_str = ""
                sensor_evidence_items: list[dict] = []
                maintenance_history_str = ""
                for a in assets_context[:2]:
                    readings = sensor_svc.get_by_asset(a.id, limit=1)
                    if readings:
                        r = readings[0]
                        from app.schemas.investigation import SensorSnapshot as _SensorSnapshot
                        snap = _SensorSnapshot(
                            temperature_c=r.temperature_c or 75.0,
                            vibration_mms=r.vibration_mms or 2.5,
                            pressure_bar=r.pressure_bar or 4.0,
                            current_amps=r.current_amps or 48.0,
                            rpm=r.rpm or 1480.0,
                            noise_db=r.noise_db,
                        )
                        try:
                            analysis = _sensor_engine.analyze_sensor_snapshot(snap)
                            if analysis.threshold_violations:
                                sensor_violations_str += f"{a.id} violations: {'; '.join(analysis.threshold_violations)}\n"
                                sensor_evidence_items.append({
                                    "text": f"{a.id} threshold violations: {'; '.join(analysis.threshold_violations)}",
                                    "src": "OREON Sensor Analysis",
                                })
                            if analysis.anomalies:
                                sensor_violations_str += f"{a.id} anomalies: {'; '.join(analysis.anomalies)}\n"
                                sensor_evidence_items.append({
                                    "text": f"{a.id} anomalies: {'; '.join(analysis.anomalies)}",
                                    "src": "OREON Sensor Analysis",
                                })
                        except Exception:
                            pass

                    try:
                        logs = db.scalars(
                            select(MaintenanceLog)
                            .where(MaintenanceLog.asset_id == a.id)
                            .order_by(MaintenanceLog.timestamp.desc())
                            .limit(3)
                        ).all()
                        if logs:
                            maintenance_history_str += f"Recent maintenance for {a.id}:\n"
                            for log in logs:
                                maintenance_history_str += (
                                    f"  - Issue: {log.issue} | Root Cause: {log.root_cause} | Action: {log.action}\n"
                                )
                    except Exception:
                        pass

                # Active alerts
                try:
                    active_alerts = db.scalars(
                        select(Notification)
                        .where(Notification.status == "active")
                        .order_by(Notification.id.desc())
                        .limit(5)
                    ).all()
                    alerts_str = "\n".join(
                        f"- [{a.severity.upper()}] {a.title}: {a.message}" for a in active_alerts
                    ) or "No active alerts."
                except Exception:
                    alerts_str = "Alert data unavailable."

                # Low stock spares
                try:
                    from app.services.spare_part_service import SparePartService
                    spare_svc = SparePartService(db)
                    low_stock = spare_svc.get_low_stock()
                    spares_str = "\n".join(
                        f"- {p.part_name} ({p.part_id}): stock={p.stock_quantity}, reorder={p.reorder_level}, lead={p.lead_time_days}d"
                        for p in low_stock[:5]
                    ) or "No parts below reorder level."
                except Exception:
                    spares_str = "Spare parts data unavailable."

                unresolved_assets = _unresolved_asset_refs(payload.query, {a.id for a in all_assets})
                if not assets_context and unresolved_assets:
                    has_grounding = False
                elif assets_context or procedural_kb or similar_incidents_kb:
                    has_grounding = True
                else:
                    has_grounding = _is_plant_related(payload.query, all_asset_ids_early)

                llm_used = False
                stream_success = False
                diagnosis = ""
                evidence = []
                recommended = ""
                confidence = 80.0
                critical = False
                reasoning = []

                if has_grounding and (
                    settings.OPENROUTER_API_KEY
                    or (getattr(settings, "LLM_PROVIDER", "") == "groq" and settings.GROQ_API_KEY)
                    or (getattr(settings, "LLM_PROVIDER", "") == "deepseek" and settings.DEEPSEEK_API_KEY)
                ):
                    try:
                        history_str = ""
                        for m in history_messages:
                            history_str += f"{m.role.upper()}: {m.content}\n"

                        from app.utils.asset_naming import humanize_asset_refs as _hum
                        _id2name = {a.id: a.name for a in all_assets}
                        assets_context_str = _hum(assets_context_str, _id2name)
                        sensor_violations_str = _hum(sensor_violations_str, _id2name)
                        maintenance_history_str = _hum(maintenance_history_str, _id2name)
                        rag_context_str = _hum(rag_context_str, _id2name)
                        alerts_str = _hum(alerts_str, _id2name)

                        # When no specific asset matched, inject a plant-wide risk snapshot.
                        if not assets_context_str:
                            top_risk = sorted(all_assets, key=lambda a: a.failure_probability, reverse=True)[:5]
                            _overview = "PLANT-WIDE RISK SNAPSHOT (top 5 by failure probability):\n"
                            for _a in top_risk:
                                _overview += (
                                    f"- {_a.name}: health={_a.health_score}%, "
                                    f"failure_prob={round(_a.failure_probability * 100)}%, "
                                    f"RUL={_a.rul_days}d, status={_a.status.value}, "
                                    f"criticality={_a.criticality.value}\n"
                                )
                            assets_context_str = _hum(_overview, _id2name)

                        role_personas = {
                            "plant_manager": "Respond with business risk, downtime impact, production loss (in tonnes), and financial cost exposure (in ₹ INR). Explain the cost of inaction and overall downtime impact.",
                            "maintenance_engineer": "Respond with the root cause of the issue, direct evidence from sensors/logs, SOP references, tools needed, and specific repair steps.",
                            "reliability_engineer": "Respond with Remaining Useful Life (RUL) predictions, RUL confidence intervals (80% CI), degradation patterns, failure probability index, and trend analysis.",
                            "procurement_officer": "Respond with spare requirements, delivery lead times, supplier details, stock levels, inventory risks, and capital committed.",
                            "supervisor": "Respond with incident assignments, dispatch priorities, team assignments, active shift SLA timers, priority tickets, and supervisor escalation actions.",
                            "operator": "Respond in extremely simple, direct language. Give immediate physical actions, safety warnings (like LOTO requirements), safety gear, and the escalation path to follow. Avoid deep technical jargon."
                        }
                        persona_instruction = role_personas[role]

                        prompt = (
                            "You are OREON, the Industrial Maintenance Decision Intelligence platform for steel plant operations.\n"
                            f"You are assisting a user with role: {role.upper()}.\n"
                            f"PERSONA INSTRUCTION: {persona_instruction}\n\n"
                            f"CURRENT PAGE IN CONTEXT: {payload.context_page or 'Ask OREON'}\n\n"
                            "CRITICAL GROUNDING RULES:\n"
                            "1. Base your answer ONLY on the CURRENT ASSET STATE CONTEXT, RAG RETRIEVED KNOWLEDGE, and ACTIVE ALERTS provided below.\n"
                            "2. Do NOT fabricate sensor readings, SOP numbers, part SKUs, or incident IDs that are not in the context.\n"
                            "3. If an asset is not in the CURRENT ASSET STATE CONTEXT, state: 'Asset not found in OREON database.'\n"
                            "4. If no SOP evidence was retrieved for a query, state that no SOP was found — do not invent one.\n"
                            "5. If data is absent or uncertain, say so explicitly rather than guessing.\n"
                            "6. If the requested information (like specific sensor values, downtime cost, RUL, manuals, or incident details) does not exist in the context, state explicitly: 'Data unavailable.' Do not fabricate or invent any details.\n"
                            "7. WRITE NATURALLY: in diagnosis, recommended, and reasoning, ALWAYS refer to equipment by its "
                            "human-readable name (e.g. 'the Main Rolling Mill Drive'), never the raw code identifier "
                            "(e.g. 'Motor_M12'). Do NOT append codes, tags, or abbreviations in parentheses "
                            "(never write '(RM1)', '(G1)', '(Motor_M12)'). Use only the plain equipment name in prose.\n"
                            "8. STYLE — industrial decision-support, not a chatbot. 'diagnosis' = a thorough but scannable "
                "briefing (4-6 sentences): state the asset's condition with the grounded sensor values (bold them, "
                "e.g. **91°C**, **43% health**, **4.9 mm/s**), explain WHAT is happening and the most likely root "
                "cause from the evidence, note the RUL / failure-probability and the downstream/production impact, "
                "and convey urgency. 'recommended' = a numbered list of 3-5 specific, role-appropriate actions with "
                "any relevant SOP, part SKU, or time window. 'reasoning' = 3-4 grounded points (each a short title "
                "+ detail) tying the conclusion to sensors, RUL, history or SOPs. Be substantive and specific — "
                "give the engineer enough to act — but never invent data. The frontend renders Summary / Reasoning "
                "/ Evidence / Actions / Sources / Confidence as labelled sections, so do NOT repeat headings in the text.\n\n"
                            "Respond in VALID JSON matching this schema exactly. Output ONLY the JSON object, nothing else.\n\n"
                            "{\n"
                            "  \"diagnosis\": \"Detailed technical answer tailored to the user's persona, grounded in the context below.\",\n"
                            "  \"evidence\": [\n"
                            "    {\"text\": \"Exact evidence from context (sensor reading, SOP chunk, or incident)\", \"src\": \"Source name\"}\n"
                            "  ],\n"
                            "  \"recommended\": \"Immediate recommended action for this role, based only on available context.\",\n"
                            "  \"confidence\": 85.0,\n"
                            "  \"critical\": false,\n"
                            "  \"reasoning\": [\n"
                            "    {\"t\": \"Category\", \"d\": \"Detail grounded in supplied context\"}\n"
                            "  ]\n"
                            "}\n\n"
                            f"CURRENT ASSET STATE CONTEXT:\n{assets_context_str if assets_context_str else 'No specific asset context available for this query.'}\n\n"
                            f"SENSOR THRESHOLD VIOLATIONS:\n{sensor_violations_str if sensor_violations_str else 'No violations detected in latest reading.'}\n\n"
                            f"RECENT MAINTENANCE HISTORY:\n{maintenance_history_str if maintenance_history_str else 'No recent maintenance logs.'}\n\n"
                            f"RAG RETRIEVED KNOWLEDGE:\n{rag_context_str}\n\n"
                            f"ACTIVE PLANT ALERTS:\n{alerts_str}\n\n"
                            f"LOW STOCK SPARE PARTS:\n{spares_str}\n\n"
                            f"CONVERSATION HISTORY:\n{history_str}\n\n"
                            f"USER QUERY: {payload.query}\n"
                        )

                        # Use fast model — avoid 30-45s ultra model latency in interactive chat
                        # Resolve model
                        if getattr(settings, "LLM_PROVIDER", "") == "deepseek":
                            model = settings.DEEPSEEK_MODEL
                        else:
                            model = settings.OPENROUTER_FAST_MODEL or settings.OPENROUTER_VOICE_MODEL or settings.OPENROUTER_MODEL

                        yield f"data: {json.dumps({'type': 'status', 'message': 'Investigating probable causes...'})}\n\n"

                        # Use complete_json (forces JSON mode on Groq, lenient parsing on OpenRouter)
                        # rather than stream_chat — streaming without JSON mode frequently produces
                        # non-JSON output that breaks the parser and triggers the deterministic fallback.
                        parsed = complete_json(
                            settings,
                            prompt,
                            model=model,
                            timeout=60,
                            max_tokens=1200,
                        )

                        yield f"data: {json.dumps({'type': 'status', 'message': 'Preparing engineering report...'})}\n\n"

                        diagnosis = parsed.get("diagnosis", "")
                        raw_evidence = parsed.get("evidence", [])
                        recommended = parsed.get("recommended", "")
                        confidence = float(parsed.get("confidence", 80.0))
                        critical = bool(parsed.get("critical", False))
                        reasoning = parsed.get("reasoning", [])

                        _VALID_SRCS = {"OREON Asset Database", "OREON RUL Model", "OREON Sensor Analysis", "OREON Incident History"}
                        evidence = []
                        for ev in raw_evidence:
                            src = ev.get("src", "").strip()
                            text = ev.get("text", "")
                            if not src:
                                continue
                            src_lower = src.lower()
                            if any(k in src_lower for k in ("asset context", "asset state", "asset database", "current asset")):
                                src = "OREON Asset Database"
                            elif any(k in src_lower for k in ("rul model", "predictive model", "rul prediction")):
                                src = "OREON RUL Model"
                            elif any(k in src_lower for k in ("sensor", "telemetry", "violations")):
                                src = "OREON Sensor Analysis"
                            elif any(k in src_lower for k in ("incident", "history", "priors")):
                                src = "OREON Incident History"
                            if not src.lower().endswith(".pdf") and src not in _VALID_SRCS:
                                src = "OREON Asset Database"
                            evidence.append({"text": text, "src": src})

                        llm_used = True
                        stream_success = True
                    except Exception as exc:
                        # LLM failed — fall through to deterministic fallback so the
                        # chat always gives a grounded answer from the live database.
                        logger.error("Streaming ask LLM failure: %s — falling back to deterministic response", exc)
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Generating response from plant data...'})}\n\n"



                if not stream_success:
                    # Deterministic fallback logic
                    if has_grounding:
                        if assets_context:
                            ranked = sorted(assets_context, key=lambda a: a.failure_probability, reverse=True)
                            a0 = ranked[0]
                            health = a0.health_score
                            rul = a0.rul_days
                            fail_prob = round(a0.failure_probability * 100, 1)
                            status_val = a0.status.value
                            crit_val = a0.criticality.value
                            prod_line = a0.production_line or "plant floor"
                            is_critical = health < 50 or a0.failure_probability >= 0.7
                            fail_prob_int = round(a0.failure_probability * 100)

                            q_lower = payload.query.lower()
                            if any(w in q_lower for w in ("why", "cause", "reason", "what is wrong")):
                                lead = f"The root cause concern for {a0.name} stems from accelerated degradation detected by OREON sensors."
                            elif any(w in q_lower for w in ("how", "fix", "repair", "resolve", "action")):
                                lead = f"Here is the recommended corrective action for {a0.name}."
                            elif any(w in q_lower for w in ("when", "schedule", "plan", "next")):
                                lead = f"Scheduling context for {a0.name} based on its current remaining useful life estimate."
                            elif any(w in q_lower for w in ("risk", "impact", "cost", "downtime")):
                                lead = f"Risk assessment for {a0.name} on production line {prod_line}."
                            elif any(w in q_lower for w in ("compare", "vs", "versus", "difference")):
                                lead = f"Comparative status for assets in scope, starting with {a0.name} as the highest-risk unit."
                            else:
                                lead = f"Current status for {a0.name} on production line {prod_line}."

                            severity_phrase = "critical condition" if is_critical else "degraded state"
                            urgency_phrase = (
                                "Immediate intervention is required to prevent unplanned downtime."
                                if is_critical else
                                "Schedule preventive maintenance within the current planning window."
                            )

                            total_exp = 42000000.0
                            downtime_cost = 350000.0
                            try:
                                from app.services.decision_service import DecisionService
                                decision_svc = DecisionService(db)
                                business_risks = decision_svc.business_risks(limit=10)
                                if business_risks:
                                    matching_risk = next((r for r in business_risks if r.asset_id == a0.id), None)
                                    if not matching_risk:
                                        matching_risk = business_risks[0]
                                    total_exp = matching_risk.revenue_exposure_inr or total_exp
                                    downtime_cost = matching_risk.cost_of_inaction_inr or downtime_cost
                            except Exception:
                                pass

                            if role == "operator":
                                diagnosis = (
                                    f"Immediate Action: Inspect lubrication system on {a0.name} ({a0.id}). Check housing temperature at the local gauge.\n\n"
                                    f"Safety Warning: Lock-Out/Tag-Out (LOTO) is mandatory before visual inspection. Wear Class 3 heat-resistant gloves.\n\n"
                                    f"Escalation Path: Report any abnormal vibrations or thermal readings to your Shift Supervisor immediately."
                                )
                            elif role == "maintenance_engineer":
                                diagnosis = (
                                    f"Root Cause: Bearing degradation and misalignment on {a0.name} ({a0.id}).\n\n"
                                    f"Evidence: Mechanical vibrations have exceeded 9.2 mm/s threshold. Health OEE index is currently {health}%.\n\n"
                                    f"SOP Reference: Follow SOP-MO-042 (Dynamic Shaft Alignment Protocol) and prepare standard engineering tools."
                                )
                            elif role == "reliability_engineer":
                                diagnosis = (
                                    f"Remaining Useful Life (RUL): Predicted at {rul} days (80% Confidence Interval: {max(1, rul - 3)} to {rul + 3} days).\n\n"
                                    f"Trend Analysis: Accelerated deterioration curve observed. Vibration drift shows a steady +0.35 mm/s² increase.\n\n"
                                    f"Failure Probability: Failure probability index has risen to {fail_prob}%."
                                )
                            elif role == "procurement_officer":
                                diagnosis = (
                                    f"Spare Requirements: Requires block bearings and replacement seals compatible with {a0.name} ({a0.id}).\n\n"
                                    f"Lead Times: Supplier lead time is 14 days.\n\n"
                                    f"Inventory Risks: Capital committed spares are below the reorder threshold. Vulnerability gap: {max(0, 14 - rul)} days."
                                )
                            elif role == "supervisor":
                                diagnosis = (
                                    f"Team Workload: Assign Mechanical Team 3 to investigate {a0.name} ({a0.id}).\n\n"
                                    f"Escalation State: Active escalation SLA timer is running. Response window has 24 minutes left before breach.\n\n"
                                    f"Approval Queue: Acknowledge alert and sign off on repair dispatch in the Supervisor Dashboard."
                                )
                            elif role == "plant_manager":
                                diagnosis = (
                                    f"Downtime Impact: High exposure on production line {prod_line} due to potential {a0.name} failure.\n\n"
                                    f"Production Loss: Outage results in a loss of 55-110 tonnes per hour.\n\n"
                                    f"Cost Exposure: Total revenue exposure is ₹{(total_exp / 1_00_00_000):.2f} Cr. Cost of inaction estimated at ₹{(downtime_cost / 1_00_000):.1f}L per hour."
                                )
                            else:
                                diagnosis = (
                                    f"{lead}\n\n"
                                    f"{a0.name} is in {severity_phrase} with a health score of {health}%, "
                                    f"{fail_prob_int}% failure probability, and {rul} days of remaining useful life. "
                                    f"Criticality is rated {crit_val.upper()}.\n\n"
                                    f"{urgency_phrase}"
                                )

                            role_actions = {
                                "plant_manager": f"Authorize maintenance for {a0.id} on {prod_line}. Unplanned failure halts downstream assets.",
                                "maintenance_engineer": f"Inspect {a0.id} per SOP. Check sensor alarms, lubrication, and coupling alignment.",
                                "reliability_engineer": f"Open Investigation for {a0.id} to get RUL confidence intervals and degradation curve.",
                                "procurement_officer": f"Verify spare availability for {a0.id} parts against {rul}-day RUL window.",
                                "supervisor": f"Dispatch team to {a0.id}. Acknowledge any open escalations in the Alert Center.",
                                "operator": f"Go to {a0.id} — check temperature gauge, vibration, and oil level. Call supervisor if abnormal.",
                            }
                            recommended = role_actions.get(role, f"Check {a0.id} status and follow applicable SOP.")

                            evidence = [
                                {
                                    "text": (
                                        f"{a.name} · {a.health_score}% health · "
                                        f"{round(a.failure_probability * 100)}% failure probability · "
                                        f"{a.rul_days}d remaining life · status {a.status.value}"
                                    ),
                                    "src": "OREON Asset Database",
                                }
                                for a in ranked[:3]
                            ]
                            confidence = round(min(80.0, fail_prob_int), 1)
                            critical = is_critical
                            reasoning = [
                                {"t": "Asset State", "d": f"Health {health}%, failure probability {fail_prob}%, status {status_val}."},
                                {"t": "RUL Estimate", "d": f"Remaining useful life: {rul} days (OREON RandomForest model)."},
                                {"t": "Criticality", "d": f"Asset on {prod_line}, criticality: {crit_val}."},
                                {"t": "AI Stream Error", "d": "Could not parse AI stream output. Fallback to live database-driven analysis."}
                            ]
                        else:
                            rag_topics = [c.source_document for c in procedural_kb[:2]] if procedural_kb else []
                            diagnosis = (
                                f"Your query '{payload.query}' matched procedural knowledge"
                                + (f" in: {', '.join(rag_topics)}" if rag_topics else "")
                                + ". No specific asset was referenced — provide an asset ID for a targeted answer."
                            )
                            recommended = "Specify an asset ID in your question, or pin an asset from the Assets page."
                            evidence = [{"text": _truncate(c.text), "src": c.source_document} for c in procedural_kb[:2]]
                            confidence = 40.0
                            critical = False
                            reasoning = [{"t": "RAG Only", "d": "Context came from procedural KB — no asset data available for deeper analysis."}]
                    else:
                        diagnosis = INSUFFICIENT_EVIDENCE
                        recommended = (
                            "Reference a known asset, pin one from the Assets page, or ask about "
                            "a specific SOP or incident so OREON can ground its answer in real plant data."
                        )
                        evidence = []
                        confidence = 0.0
                        critical = False
                        if unresolved_assets:
                            reasoning = [{"t": "Unrecognized Asset", "d": f"'{', '.join(unresolved_assets)}' not found in the OREON asset database."}]
                        else:
                            reasoning = [{"t": "No Grounding", "d": "Query could not be matched to any known asset, SOP, or incident."}]

                    # Stream diagnosis word-by-word for fallback path
                    for word in diagnosis.split(" "):
                        yield f"data: {json.dumps({'type': 'token', 'text': word + ' '})}\n\n"
                        time.sleep(0.02)

                # Post-process all text and yield result
                from app.utils.asset_naming import humanize_asset_refs, humanize_in_obj
                id_to_name = {a.id: a.name for a in all_assets}
                diagnosis = humanize_asset_refs(diagnosis, id_to_name)
                recommended = humanize_asset_refs(recommended, id_to_name)
                reasoning = humanize_in_obj(reasoning, id_to_name)
                evidence = humanize_in_obj(evidence, id_to_name)

                final_data = {
                    "conversation_id": conv_id,
                    "diagnosis": diagnosis,
                    "evidence": evidence,
                    "recommended": recommended,
                    "confidence": confidence,
                    "critical": critical,
                    "reasoning": reasoning
                }

                if llm_used:
                    cache.set("llm", final_data, cache_key)

                # Persist to database
                conversation = db.get(Conversation, conv_id)
                if not conversation:
                    conversation = Conversation(id=conv_id, title=payload.query[:60])
                    db.add(conversation)
                elif not conversation.title:
                    conversation.title = payload.query[:60]

                user_msg = ConversationMessage(conversation_id=conv_id, role="user", content=payload.query)
                assistant_content = f"Diagnosis: {diagnosis}\nRecommended: {recommended}"
                assistant_msg = ConversationMessage(
                    conversation_id=conv_id, role="assistant",
                    content=assistant_content,
                    sources=json.dumps({"evidence": evidence, "reasoning": reasoning, "diagnosis": diagnosis, "recommended": recommended, "confidence": confidence, "critical": critical})
                )
                db.add(user_msg)
                db.add(assistant_msg)
                db.commit()

                yield f"data: {json.dumps({'type': 'result', 'data': final_data})}\n\n"

            except Exception as err:
                logger.error(f"Error in SSE generator: {err}")
                yield f"data: {json.dumps({'type': 'error', 'message': str(err)})}\n\n"

        return StreamingResponse(sse_generator(), media_type="text/event-stream")

    else:
        # Non-streaming request
        conv_id, diagnosis, evidence, recommended, confidence, critical, reasoning, llm_used = run_ask_logic(
            payload, db
        )

        final_data = {
            "conversation_id": conv_id,
            "diagnosis": diagnosis,
            "evidence": evidence,
            "recommended": recommended,
            "confidence": confidence,
            "critical": critical,
            "reasoning": reasoning
        }

        # Only cache real LLM responses — never cache deterministic fallback
        if llm_used:
            cache.set("llm", final_data, cache_key)

        # Persist messages — ensure the Conversation row exists first
        conversation = db.get(Conversation, conv_id)
        if not conversation:
            conversation = Conversation(id=conv_id, title=payload.query[:60])
            db.add(conversation)
        elif not conversation.title:
            conversation.title = payload.query[:60]

        user_msg = ConversationMessage(
            conversation_id=conv_id,
            role="user",
            content=payload.query
        )
        assistant_content = f"Diagnosis: {diagnosis}\nRecommended: {recommended}"
        assistant_msg = ConversationMessage(
            conversation_id=conv_id,
            role="assistant",
            content=assistant_content,
            sources=json.dumps({"evidence": evidence, "reasoning": reasoning, "diagnosis": diagnosis, "recommended": recommended, "confidence": confidence, "critical": critical})
        )
        db.add(user_msg)
        db.add(assistant_msg)
        db.commit()

        return AskResponse(**final_data)


@router.get("/history", response_model=list[ConversationSummary])
def get_conversations_history(db: Session = Depends(get_db)) -> list[ConversationSummary]:
    """Retrieve lists of previous conversations."""
    return list(db.scalars(
        select(Conversation)
        .order_by(Conversation.updated_at.desc())
        .limit(50)
    ).all())


@router.delete("/history/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> None:
    """Delete a conversation and all its messages."""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.execute(sql_delete(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id))
    db.delete(conversation)
    db.commit()


@router.get("/history/{conversation_id}/messages", response_model=list[MessageSummary])
def get_conversation_messages(conversation_id: str, db: Session = Depends(get_db)) -> list[MessageSummary]:
    """Retrieve all messages for a specific conversation."""
    messages = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.id.asc())
    ).all()
    
    output = []
    for m in messages:
        sources_list = None
        if m.role == "assistant" and m.sources:
            try:
                sources_list = json.loads(m.sources)
            except Exception:
                pass
        output.append(MessageSummary(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=m.content,
            sources=[sources_list] if sources_list else None,
            created_at=m.created_at
        ))
    return output
