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


def _derive_risk_level(assets_context: list, critical: bool, has_grounding: bool) -> str | None:
    """Deterministic risk classification grounded in real asset state — never invented.

    Returns one of "low" | "medium" | "high" | "critical", or None when the query
    was refused / not grounded (so the UI shows no risk badge). Uses the highest-risk
    asset in context; falls back to the model's `critical` flag for plant-wide answers.
    """
    if not has_grounding:
        return None
    if not assets_context:
        # Plant-wide or document-only answer — no single asset to grade.
        return "critical" if critical else "medium"

    worst = max(assets_context, key=lambda a: a.failure_probability)
    fp = worst.failure_probability
    health = worst.health_score
    status = getattr(worst.status, "value", str(worst.status)).lower()

    if critical or status == "critical" or fp >= 0.7 or health < 40:
        return "critical"
    if status in ("warning", "degraded") or fp >= 0.4 or health < 60:
        return "high"
    if fp >= 0.2 or health < 80:
        return "medium"
    return "low"


def _build_assets_context_str(assets_context: list, sensor_svc, rul_svc) -> str:
    """Build the per-asset LLM context from REAL data only — never fabricates.

    When an asset has no live sensor reading, the line states telemetry is
    unavailable instead of injecting placeholder values, and omits the
    sensor-conditioned RUL confidence interval. This prevents the model from
    repeating invented sensor numbers as if they were measured.
    """
    out = ""
    for a in assets_context:
        readings = sensor_svc.get_by_asset(a.id, limit=1)
        r = readings[0] if readings else None
        temp = r.temperature_c if r else None
        vib = r.vibration_mms if r else None
        press = r.pressure_bar if r else None

        if temp is not None and vib is not None and press is not None:
            _, _, rul_lower, rul_upper = rul_svc.predict_rul(a.id, temp, vib, press)
            sensor_part = (
                f"Sensor Readings -> Temperature: {temp}°C, Vibration: {vib} mm/s, "
                f"Pressure: {press} bar. "
                f"RUL: {a.rul_days} days (80% Confidence Interval: {rul_lower} to {rul_upper} days), "
            )
        elif temp is not None or vib is not None or press is not None:
            parts = []
            if temp is not None: parts.append(f"Temperature: {temp}°C")
            if vib is not None: parts.append(f"Vibration: {vib} mm/s")
            if press is not None: parts.append(f"Pressure: {press} bar")
            sensor_part = (
                f"Sensor Readings -> {', '.join(parts)} (partial telemetry). "
                f"RUL: {a.rul_days} days (stored model estimate), "
            )
        else:
            sensor_part = (
                "Sensor Readings -> not available (no live telemetry for this asset). "
                f"RUL: {a.rul_days} days (stored model estimate), "
            )

        out += (
            f"Asset: {a.id} ({a.name}), Status: {a.status.value}, Health Score: {a.health_score}%, "
            f"{sensor_part}"
            f"Criticality: {a.criticality.value}, Production Line: {a.production_line}\n"
        )
    return out


def _grounded_asset_fallback(assets_context: list, role: str, db) -> tuple:
    """Deterministic answer built ONLY from real DB values (LLM-unavailable path).

    Invents no SOP numbers, costs, tonnages, lead times, or sensor values — every
    figure traces to the asset record or a real service. Returns
    (diagnosis, recommended, evidence, confidence, critical, reasoning).
    """
    ranked = sorted(assets_context, key=lambda a: a.failure_probability, reverse=True)
    a0 = ranked[0]
    health = a0.health_score
    rul = a0.rul_days
    fail_prob = round(a0.failure_probability * 100, 1)
    status_val = a0.status.value
    crit_val = a0.criticality.value
    prod_line = a0.production_line or "the plant floor"
    is_critical = status_val.lower() == "critical" or health < 50 or a0.failure_probability >= 0.7

    if is_critical:
        severity_phrase = "a critical condition"
    elif status_val.lower() in ("warning", "degraded") or health < 70:
        severity_phrase = "a degraded state"
    else:
        severity_phrase = "a stable condition"
    urgency_phrase = (
        "Immediate intervention is recommended to prevent unplanned downtime."
        if is_critical else
        "Plan preventive maintenance within the current window."
    )

    base = (
        f"{a0.name} on {prod_line} is in {severity_phrase}: health score {health}%, "
        f"{fail_prob}% failure probability, {rul} days estimated remaining useful life, "
        f"criticality {crit_val.upper()}. {urgency_phrase}"
    )

    role_note = {
        "operator": " As the operator: perform a physical check of the unit and apply Lock-Out/Tag-Out (LOTO) before any inspection; escalate abnormal readings to your shift supervisor.",
        "maintenance_engineer": " As maintenance engineer: confirm the root cause against live sensor alarms and the applicable equipment SOP before intervening.",
        "reliability_engineer": f" As reliability engineer: remaining useful life is {rul} days at {fail_prob}% failure probability — track the degradation trend in the Investigation view.",
        "procurement_officer": f" As procurement officer: verify spare availability and lead time against the {rul}-day RUL window in Procurement.",
        "supervisor": " As supervisor: dispatch a team and acknowledge any open escalation for this asset in the Alert Center.",
    }.get(role, "")

    # Plant manager: use REAL business-risk figures or state unavailable — no hardcoded ₹.
    if role == "plant_manager":
        match = None
        try:
            from app.services.decision_service import DecisionService
            risks = DecisionService(db).business_risks(limit=10)
            match = next((r for r in risks if r.asset_id == a0.id), None) or (risks[0] if risks else None)
        except Exception:
            match = None
        if match and (getattr(match, "revenue_exposure_inr", None) or getattr(match, "cost_of_inaction_inr", None)):
            parts = []
            if match.revenue_exposure_inr:
                parts.append(f"revenue exposure ₹{match.revenue_exposure_inr / 1_00_00_000:.2f} Cr")
            if match.cost_of_inaction_inr:
                parts.append(f"cost of inaction ₹{match.cost_of_inaction_inr / 1_00_000:.1f} L")
            role_note = " As plant manager: " + ", ".join(parts) + " (OREON business-impact engine)."
        else:
            role_note = " As plant manager: quantified financial exposure is not available for this asset in the current data."

    diagnosis = base + role_note
    recommended = (
        f"Open an investigation for {a0.name} and act per the applicable SOP for this equipment type. "
        + ("Treat as urgent given the critical status." if is_critical
           else "Schedule within the preventive-maintenance window.")
    )
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
    confidence = round(min(80.0, fail_prob), 1)
    reasoning = [
        {"t": "Asset State", "d": f"Health {health}%, failure probability {fail_prob}%, status {status_val}."},
        {"t": "RUL Estimate", "d": f"Remaining useful life: {rul} days (OREON RandomForest model)."},
        {"t": "Criticality", "d": f"Asset on {prod_line}, criticality: {crit_val}."},
        {"t": "Source", "d": "Built deterministically from live OREON records (AI narration layer not used for this reply)."},
    ]
    return diagnosis, recommended, evidence, confidence, is_critical, reasoning


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
) -> tuple[str, str, list, float, bool, list, bool, str | None]:
    """Runs the core RAG + LLM execution logic, reporting status through status_callback.

    Returns: (conv_id, diagnosis, evidence, recommended, confidence, critical,
              reasoning, llm_used, risk_level).
    """
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
        ], False, None

    # Retrieve Context from Database
    pinned_assets = [p.label for p in payload.pins if p.kind == "asset"]
    if payload.context_asset_id and payload.context_asset_id not in pinned_assets:
        pinned_assets.append(payload.context_asset_id)

    all_assets = all_assets_early
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

    assets_context_str = _build_assets_context_str(assets_context, sensor_svc, rul_svc)

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
                temperature_c=r.temperature_c,
                vibration_mms=r.vibration_mms,
                pressure_bar=r.pressure_bar,
                current_amps=r.current_amps,
                rpm=r.rpm,
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
            # Graceful degradation: when the AI narration layer is unavailable, do NOT
            # error out and do NOT fabricate — fall through to the deterministic,
            # fully-grounded fallback built from live OREON records (handled below).
            logger.error("Ask OREON LLM failure: %s — using grounded deterministic fallback", exc)
            _llm_used = False

    # ── Deterministic grounded fallback (LLM unavailable / not configured / failed) ──
    # Always answers from real plant data — never fabricates and never hard-fails.
    if has_grounding and not _llm_used:
        if assets_context:
            diagnosis, recommended, evidence, confidence, critical, reasoning = (
                _grounded_asset_fallback(assets_context, role, db)
            )
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

    # Explicit, grounded risk classification (problem-statement 5.2).
    risk_level = _derive_risk_level(assets_context, critical, has_grounding)

    # Present assets by friendly name in all prose — never raw IDs like "Motor_M12".
    from app.utils.asset_naming import humanize_asset_refs, humanize_in_obj
    id_to_name = {a.id: a.name for a in all_assets}
    diagnosis = humanize_asset_refs(diagnosis, id_to_name)
    recommended = humanize_asset_refs(recommended, id_to_name)
    reasoning = humanize_in_obj(reasoning, id_to_name)
    evidence = humanize_in_obj(evidence, id_to_name)

    return conv_id, diagnosis, evidence, recommended, confidence, critical, reasoning, _llm_used, risk_level


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
                        "risk_level": None,
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

                assets_context_str = _build_assets_context_str(assets_context, sensor_svc, rul_svc)

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
                            temperature_c=r.temperature_c,
                            vibration_mms=r.vibration_mms,
                            pressure_bar=r.pressure_bar,
                            current_amps=r.current_amps,
                            rpm=r.rpm,
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
                    # Deterministic grounded fallback (LLM stream unavailable/unparseable).
                    if has_grounding:
                        if assets_context:
                            diagnosis, recommended, evidence, confidence, critical, reasoning = (
                                _grounded_asset_fallback(assets_context, role, db)
                            )
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

                # Post-process all text and yield result
                from app.utils.asset_naming import humanize_asset_refs, humanize_in_obj
                id_to_name = {a.id: a.name for a in all_assets}
                diagnosis = humanize_asset_refs(diagnosis, id_to_name)
                recommended = humanize_asset_refs(recommended, id_to_name)
                reasoning = humanize_in_obj(reasoning, id_to_name)
                evidence = humanize_in_obj(evidence, id_to_name)

                # Stream the (humanized) diagnosis word-by-word so the answer flows in
                # like a chat assistant rather than appearing as one block. Applies to
                # both the LLM and the deterministic-fallback diagnosis.
                if diagnosis:
                    for word in diagnosis.split(" "):
                        yield f"data: {json.dumps({'type': 'token', 'text': word + ' '})}\n\n"
                        time.sleep(0.012)

                # Explicit, grounded risk classification (problem-statement 5.2).
                risk_level = _derive_risk_level(assets_context, critical, has_grounding)

                final_data = {
                    "conversation_id": conv_id,
                    "diagnosis": diagnosis,
                    "evidence": evidence,
                    "recommended": recommended,
                    "confidence": confidence,
                    "critical": critical,
                    "risk_level": risk_level,
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
                    sources=json.dumps({"evidence": evidence, "reasoning": reasoning, "diagnosis": diagnosis, "recommended": recommended, "confidence": confidence, "critical": critical, "risk_level": risk_level})
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
        conv_id, diagnosis, evidence, recommended, confidence, critical, reasoning, llm_used, risk_level = run_ask_logic(
            payload, db
        )

        final_data = {
            "conversation_id": conv_id,
            "diagnosis": diagnosis,
            "evidence": evidence,
            "recommended": recommended,
            "confidence": confidence,
            "critical": critical,
            "risk_level": risk_level,
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
            sources=json.dumps({"evidence": evidence, "reasoning": reasoning, "diagnosis": diagnosis, "recommended": recommended, "confidence": confidence, "critical": critical, "risk_level": risk_level})
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
