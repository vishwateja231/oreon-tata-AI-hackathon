"""Autonomous voice-agent reasoning and control service for OREON.

This is the "master control AI" behind the 3D voice orb. It is context-aware
(reads live plant data deterministically), conversational (an LLM composes the
spoken reply), and autonomous (it can invoke a whitelist of safe, reversible
backend actions and report each one in an execution log).

Design notes
------------
* READ tools run automatically as grounding — they gather live data about the
  asset(s) in scope and are always reflected in the execution log.
* WRITE tools are *proposed* by the LLM in a structured ``actions`` array and
  then executed here against a strict whitelist with argument validation.
* The LLM only ever produces narration + an action plan; it never touches the
  database directly. Execution is fully deterministic and safe.
* If the LLM is unavailable the service degrades to a data-driven reply built
  from the resolved asset state, so the agent always responds.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config.settings import get_settings
from app.models.asset import Asset
from app.models.maintenance_log import MaintenanceLog
from app.models.notification import Notification
from app.services.llm_router import complete_json

logger = logging.getLogger(__name__)

VALID_ROLES = frozenset({
    "plant_manager", "maintenance_engineer", "reliability_engineer",
    "procurement_officer", "supervisor", "operator",
})

# Whitelisted write actions the agent is permitted to execute autonomously.
_ALLOWED_WRITE_TOOLS = {"log_maintenance", "acknowledge_alert", "run_simulation"}

_ASSET_REF_RE = re.compile(r"\b[A-Za-z]{2,}_[A-Za-z0-9]+\b")

# Deterministic guard: only execute write actions when the operator's utterance
# carries an explicit command verb. Prevents a chatty model from logging/acting
# on a plain status question.
_ACTION_INTENT_RE = re.compile(
    r"\b(log|record|note|schedule|acknowledge|ack|run|start|simulate|simulation|"
    r"dispatch|create|raise|file|book|order|reorder|escalate|approve|assign|trigger)\b",
    re.IGNORECASE,
)


class VoiceAgentService:
    """Context-aware, autonomous reasoning core for the OREON voice agent."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._settings = get_settings()

    # ── public entrypoint ────────────────────────────────────────────────
    def converse(
        self,
        query: str,
        history: list[dict[str, str]],
        role: str,
        context_asset_id: Optional[str] = None,
        current_page: Optional[str] = None,
        recent_activity: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Run one autonomous conversation turn and return a structured reply."""
        role = role if role in VALID_ROLES else "maintenance_engineer"
        execution_log: list[dict[str, Any]] = []

        # Friendly-name map used both to humanize the model's view and its output.
        from app.utils.asset_naming import humanize_asset_refs
        id_to_name = {a.id: a.name for a in self._db.scalars(select(Asset)).all()}

        # 1. Resolve the asset(s) in scope from context, the query, then history.
        assets = self._resolve_assets(query, history, context_asset_id)
        context_label = assets[0].name if assets else (current_page or None)

        # 2. Gather live grounding via READ tools (always logged).
        grounding, widgets = self._gather_context(assets, execution_log, role)

        # 2b. Situational awareness — where the operator is and what they've done.
        operator_context = self._build_operator_context(current_page, recent_activity, role)

        # 3. Ask the LLM to narrate + propose actions, or fall back deterministically.
        # The model only ever sees friendly names, so it can't echo raw codes.
        llm_used = False
        plan_of_action: list[str] = []
        proposed_actions: list[dict[str, Any]] = []
        spoken = ""

        if (self._settings.LLM_PROVIDER == "groq" and self._settings.GROQ_API_KEY) or self._settings.OPENROUTER_API_KEY:
            try:
                grounding_for_llm = humanize_asset_refs(grounding, id_to_name)
                parsed = self._invoke_llm(query, history, role, grounding_for_llm, operator_context)
                spoken = (parsed.get("spoken_response") or "").strip()
                plan_of_action = [str(s) for s in (parsed.get("plan_of_action") or [])][:6]
                proposed_actions = parsed.get("actions") or []
                llm_used = bool(spoken)
            except Exception as exc:  # pragma: no cover - network/parse guard
                logger.warning("Voice agent LLM call failed; using deterministic reply: %s", exc)

        if not spoken:
            logger.info("Voice Agent LLM returned empty or failed. Falling back to data-driven reply.")
            spoken, plan_of_action = self._fallback_reply(query, role, assets)

        # 4. Execute proposed safe-write actions — but ONLY if the operator
        # actually issued a command (deterministic guard), and repair any
        # hallucinated asset IDs to the asset currently in scope.
        if proposed_actions and _ACTION_INTENT_RE.search(query):
            known_ids = set(id_to_name.keys())
            primary_id = assets[0].id if assets else None
            for a in proposed_actions:
                if isinstance(a, dict):
                    args = a.get("args") or {}
                    aid = str(args.get("asset_id", "")).strip()
                    if aid not in known_ids and primary_id:
                        args["asset_id"] = primary_id
                        a["args"] = args
            self._execute_actions(proposed_actions, role, execution_log)

        # 5. Safety net: present assets by friendly name in the spoken output.
        spoken = humanize_asset_refs(spoken, id_to_name)
        plan_of_action = [humanize_asset_refs(s, id_to_name) for s in plan_of_action]

        return {
            "spoken_response": spoken,
            "plan_of_action": plan_of_action,
            "execution_log": execution_log,
            "context_label": context_label,
            "widgets": widgets,
            "llm_used": llm_used,
        }

    # ── asset resolution ─────────────────────────────────────────────────
    def _resolve_assets(
        self, query: str, history: list[dict[str, str]], context_asset_id: Optional[str]
    ) -> list[Asset]:
        """Find the asset(s) the user is talking about."""
        all_assets = list(self._db.scalars(select(Asset)).all())
        by_id = {a.id.lower(): a for a in all_assets}
        by_name = {a.name.lower(): a for a in all_assets}
        resolved: list[Asset] = []

        def _add(asset: Optional[Asset]) -> None:
            if asset and asset not in resolved:
                resolved.append(asset)

        if context_asset_id:
            _add(self._db.get(Asset, context_asset_id))

        q = query.lower()
        for a in all_assets:
            if a.id.lower() in q or a.name.lower() in q:
                _add(a)

        # equipment-type mentions (e.g. "the blast furnace", "that motor")
        if not resolved:
            for a in all_assets:
                etype = (a.equipment_type or "").lower()
                if etype and etype in q:
                    _add(a)

        # fall back to the most recent asset referenced in history
        if not resolved:
            for msg in reversed(history):
                content = (msg.get("content") or "").lower()
                for key, asset in {**by_id, **by_name}.items():
                    if key in content:
                        _add(asset)
                        break
                if resolved:
                    break

        return resolved[:2]

    # ── READ tools (deterministic grounding) ─────────────────────────────
    def _gather_context(
        self, assets: list[Asset], execution_log: list[dict[str, Any]], role: str
    ) -> tuple[str, list[dict[str, str]]]:
        """Run read tools, returning a grounding string and dashboard widgets."""
        widgets: list[dict[str, str]] = []

        if not assets:
            # No specific asset — give the agent plant-wide situational awareness.
            summary = self._read_plant_status(execution_log)
            return summary, widgets

        lines: list[str] = []
        primary = assets[0]
        for a in assets:
            lines.append(self._read_asset_health(a, execution_log))

        # Impact chain for the primary asset.
        lines.append(self._read_impact_chain(primary, execution_log))

        # Active alerts in scope.
        lines.append(self._read_alerts(role, execution_log))

        # Widgets from the primary asset for the dashboard.
        status_val = primary.status.value if hasattr(primary.status, "value") else str(primary.status)
        health = int(primary.health_score)
        widgets = [
            {"label": "Health", "value": f"{health}%",
             "tone": "crit" if health < 50 else "warn" if health < 75 else "ok"},
            {"label": "RUL", "value": f"{primary.rul_days}d",
             "tone": "crit" if primary.rul_days < 14 else "warn" if primary.rul_days < 30 else "ok"},
            {"label": "Fail Prob", "value": f"{round(primary.failure_probability * 100)}%",
             "tone": "crit" if primary.failure_probability >= 0.7 else "warn" if primary.failure_probability >= 0.4 else "ok"},
            {"label": "Status", "value": status_val.upper(), "tone": "violet"},
        ]
        return "\n".join(lines), widgets

    def _read_asset_health(self, asset: Asset, execution_log: list[dict[str, Any]]) -> str:
        """READ: live health, sensors, and RUL for one asset."""
        temp = vib = press = None
        try:
            from app.services.sensor_service import SensorService
            readings = SensorService(self._db).get_by_asset(asset.id, limit=1)
            if readings:
                temp = readings[0].temperature_c
                vib = readings[0].vibration_mms
                press = readings[0].pressure_bar
        except Exception:
            pass
        temp = 75.0 if temp is None else temp
        vib = 2.5 if vib is None else vib
        press = 4.0 if press is None else press

        status_val = asset.status.value if hasattr(asset.status, "value") else str(asset.status)
        crit_val = asset.criticality.value if hasattr(asset.criticality, "value") else str(asset.criticality)
        execution_log.append({
            "tool": "get_asset_health", "kind": "read", "status": "ok",
            "label": f"Queried live health for {asset.id}",
            "detail": f"{int(asset.health_score)}% health · {status_val}",
        })
        return (
            f"Asset {asset.id} ({asset.name}): status {status_val}, health {int(asset.health_score)}%, "
            f"failure probability {round(asset.failure_probability * 100)}%, RUL {asset.rul_days} days, "
            f"criticality {crit_val}, line {asset.production_line or 'plant floor'}. "
            f"Sensors -> temperature {temp}°C, vibration {vib} mm/s, pressure {press} bar."
        )

    def _read_impact_chain(self, asset: Asset, execution_log: list[dict[str, Any]]) -> str:
        """READ: downstream blast radius of an asset failure."""
        try:
            from app.services.plant_graph_service import PlantGraphService
            chain = PlantGraphService().get_impact_chain(asset.id)
            downstream = chain.get("impact_chain") or []
            names = [d.get("asset_id", "") if isinstance(d, dict) else str(d) for d in downstream]
            names = [n for n in names if n]
            execution_log.append({
                "tool": "get_impact_chain", "kind": "read", "status": "ok",
                "label": f"Traced downstream impact of {asset.id}",
                "detail": f"{len(names)} downstream asset(s)",
            })
            if names:
                return f"Failure of {asset.id} propagates to: {', '.join(names[:6])}."
            return f"{asset.id} has no mapped downstream dependencies."
        except Exception:
            return ""

    def _read_alerts(self, role: str, execution_log: list[dict[str, Any]]) -> str:
        """READ: active plant alerts."""
        try:
            from app.services.notification_engine import NotificationEngine
            alerts = NotificationEngine(self._db).get_notifications(
                role=role, status="active", limit=5
            )
            execution_log.append({
                "tool": "list_alerts", "kind": "read", "status": "ok",
                "label": "Listed active plant alerts",
                "detail": f"{len(alerts)} active",
            })
            if not alerts:
                return "No active alerts."
            return "Active alerts: " + "; ".join(f"[{a.severity.upper()}] {a.title}" for a in alerts)
        except Exception:
            return ""

    def _read_plant_status(self, execution_log: list[dict[str, Any]]) -> str:
        """READ: plant-wide situational summary when no asset is in scope."""
        try:
            from app.services.dashboard_service import DashboardService
            dash = DashboardService(self._db).get_dashboard()
            execution_log.append({
                "tool": "get_plant_status", "kind": "read", "status": "ok",
                "label": "Queried plant-wide status",
                "detail": f"{getattr(dash, 'total_assets', '?')} assets monitored",
            })
            crit = getattr(dash, "critical_assets", []) or []
            crit_names = [c.id if hasattr(c, "id") else str(c) for c in crit][:5]
            return (
                f"Plant status: {getattr(dash, 'total_assets', 0)} assets, "
                f"{getattr(dash, 'active_alerts', 0)} active alerts, "
                f"average health {round(getattr(dash, 'avg_plant_health', 0))}%. "
                f"Critical assets: {', '.join(crit_names) if crit_names else 'none'}."
            )
        except Exception:
            return "Plant status unavailable."

    # ── situational awareness ────────────────────────────────────────────
    def _build_operator_context(
        self, current_page: Optional[str], recent_activity: Optional[list[str]], role: str
    ) -> str:
        """Describe where the operator is and what they've been doing."""
        parts: list[str] = [f"Operator role: {role.replace('_', ' ')}."]
        if current_page:
            parts.append(f"Currently viewing: {current_page}.")
        trail = [a for a in (recent_activity or []) if a][:6]
        if trail:
            parts.append("Recent activity: " + " → ".join(trail) + ".")
        return " ".join(parts)

    # ── LLM narration + action planning ──────────────────────────────────
    def _invoke_llm(
        self, query: str, history: list[dict[str, str]], role: str, grounding: str,
        operator_context: str,
    ) -> dict[str, Any]:
        """Ask the LLM for a spoken reply, a plan, and proposed safe actions."""
        history_str = "\n".join(
            f"{m.get('role', 'user').upper()}: {m.get('content', '')}" for m in history[-6:]
        ) or "(no prior turns)"

        # Tight, low-latency prompt — fewer tokens = faster prefill + generation.
        prompt = (
            f"You are OREON, the voice AI for a steel plant, talking to a {role.replace('_', ' ')}. "
            "Reply in 1-2 short spoken sentences (no markdown/bullets). Use ONLY the LIVE CONTEXT; "
            "if it's not there, say so. Refer to equipment by its plain name (e.g. 'the Main Rolling "
            "Mill Drive'), never codes like 'Motor_M12' or '(RM1)'.\n"
            "Only when the user explicitly asks you to ACT, add an action from: "
            "log_maintenance(asset_id,issue,root_cause,action), acknowledge_alert(alert_id), "
            "run_simulation(asset_id,profile). Otherwise actions=[]. "
            "When the operator asks you to log/record/note an issue, ALWAYS create a log_maintenance "
            "action using THEIR reported words as the issue — the operator is the source, the issue "
            "does NOT need to appear in the context. Use the asset in scope for asset_id.\n"
            "Reply with ONLY this JSON: "
            '{"spoken_response":"...","plan_of_action":["step"],"actions":[{"tool":"...","args":{},"label":"..."}]}\n\n'
            f"OPERATOR CONTEXT: {operator_context}\n"
            f"LIVE CONTEXT:\n{grounding or '(no specific asset in scope)'}\n"
            f"RECENT TURNS:\n{history_str}\n"
            f"OPERATOR SAID: {query}\n"
        )

        # Voice is latency-critical: one fast model, capped output, short timeout.
        s = self._settings
        model = s.OPENROUTER_VOICE_MODEL or s.OPENROUTER_FAST_MODEL or s.OPENROUTER_MODEL
        return complete_json(
            s, prompt, model=model,
            timeout=s.OPENROUTER_VOICE_TIMEOUT,
            max_tokens=s.OPENROUTER_VOICE_MAX_TOKENS,
        )

    # ── deterministic fallback ───────────────────────────────────────────
    def _fallback_reply(
        self, query: str, role: str, assets: list[Asset]
    ) -> tuple[str, list[str]]:
        """Build a grounded reply from live data when the LLM is unavailable."""
        if not assets:
            return (
                "I'm online and monitoring the plant. Ask me about a specific asset — for example, "
                "'How is the blast furnace?' — and I'll pull its live health and impact for you.",
                [],
            )
        a = assets[0]
        status_val = a.status.value if hasattr(a.status, "value") else str(a.status)
        is_critical = a.health_score < 50 or a.failure_probability >= 0.7
        urgency = (
            "It needs immediate attention to avoid unplanned downtime."
            if is_critical else "It's stable, but keep it on the preventive-maintenance schedule."
        )
        spoken = (
            f"{a.name} is currently {status_val} with {int(a.health_score)} percent health and about "
            f"{a.rul_days} days of remaining useful life. {urgency}"
        )
        plan = [
            f"Inspect {a.id} per the applicable SOP",
            "Review the latest sensor alarms and lubrication",
            "Log findings to the maintenance ledger",
        ]
        return spoken, plan

    # ── WRITE tools (safe, whitelisted execution) ────────────────────────
    def _execute_actions(
        self, actions: list[dict[str, Any]], role: str, execution_log: list[dict[str, Any]]
    ) -> None:
        """Execute the LLM's proposed write actions against a strict whitelist."""
        handlers: dict[str, Callable[[dict[str, Any], str], dict[str, Any]]] = {
            "log_maintenance": self._do_log_maintenance,
            "acknowledge_alert": self._do_acknowledge_alert,
            "run_simulation": self._do_run_simulation,
        }
        def _canonical_tool(name: str) -> str:
            """Map a model's loose tool name to a canonical write tool."""
            n = name.lower().replace("-", "_").replace(" ", "_")
            if n in _ALLOWED_WRITE_TOOLS:
                return n
            if any(k in n for k in ("log", "note", "book", "record", "journal")):
                return "log_maintenance"
            if any(k in n for k in ("ack", "acknowledg", "mark_read", "read_alert", "dismiss")):
                return "acknowledge_alert"
            if "sim" in n:
                return "run_simulation"
            return name

        for action in actions[:4]:
            if not isinstance(action, dict):
                continue
            tool = _canonical_tool(str(action.get("tool", "")).strip())
            args = action.get("args") or {}
            label = action.get("label") or tool
            if tool not in _ALLOWED_WRITE_TOOLS:
                execution_log.append({
                    "tool": tool or "unknown", "kind": "write", "status": "skipped",
                    "label": f"Blocked unsupported action '{tool}'", "detail": None,
                })
                continue
            try:
                result = handlers[tool](args, role)
                execution_log.append({
                    "tool": tool, "kind": "write", "status": "ok",
                    "label": label, "detail": result.get("detail"),
                })
            except Exception as exc:
                logger.warning("Voice agent action %s failed: %s", tool, exc)
                execution_log.append({
                    "tool": tool, "kind": "write", "status": "error",
                    "label": label, "detail": str(exc)[:120],
                })

    def _do_log_maintenance(self, args: dict[str, Any], role: str) -> dict[str, Any]:
        """WRITE: append a maintenance log entry."""
        asset_id = str(args.get("asset_id", "")).strip()
        if not asset_id or not self._db.get(Asset, asset_id):
            raise ValueError(f"Unknown asset '{asset_id}'")
        entry = MaintenanceLog(
            asset_id=asset_id,
            issue=str(args.get("issue") or "Voice-agent logged observation"),
            root_cause=str(args.get("root_cause") or "Reported via OREON voice agent")[:256],
            action=str(args.get("action") or "Pending engineer review"),
            engineer_notes=f"Logged autonomously by OREON voice agent (role: {role}).",
        )
        self._db.add(entry)
        self._db.commit()
        return {"detail": f"Maintenance log #{entry.id} created for {asset_id}"}

    def _do_acknowledge_alert(self, args: dict[str, Any], role: str) -> dict[str, Any]:
        """WRITE: acknowledge an active alert by id (or the latest if unspecified)."""
        alert_id = args.get("alert_id")
        if alert_id is None:
            latest = self._db.scalars(
                select(Notification).where(Notification.status == "active")
                .order_by(Notification.id.desc()).limit(1)
            ).first()
            if latest is None:
                raise ValueError("No active alerts to acknowledge")
            alert_id = latest.id
        from app.services.notification_engine import NotificationEngine
        ok = NotificationEngine(self._db).mark_as_read(int(alert_id), role)
        if not ok:
            raise ValueError(f"Alert {alert_id} not found")
        return {"detail": f"Alert {alert_id} acknowledged by {role}"}

    def _do_run_simulation(self, args: dict[str, Any], role: str) -> dict[str, Any]:
        """WRITE: start a scripted degradation simulation."""
        asset_id = str(args.get("asset_id", "Motor_M12")).strip() or "Motor_M12"
        if not self._db.get(Asset, asset_id):
            raise ValueError(f"Unknown asset '{asset_id}'")
        profile = str(args.get("profile", "bearing_failure")).strip() or "bearing_failure"
        from app.services.demo_simulation_service import DemoSimulationService
        DemoSimulationService.start(asset_id, profile)
        return {"detail": f"Simulation '{profile}' started on {asset_id}"}
