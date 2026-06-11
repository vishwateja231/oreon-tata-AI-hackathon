"""Scripted live-plant simulation for reliable demos (Phase G + H).

The default SSE telemetry stream injects *random* anomalies (~3% per tick), which is
great for ambience but unreliable on stage. This director overlays a **deterministic,
repeatable degradation story** on a chosen asset (default ``Motor_M12``):

    HEALTHY -> abnormal vibration -> critical alert -> escalation -> failure imminent

While a scenario is active, ``SensorStreamService`` asks this director for each tick's
values for the target asset, so the existing Digital Twin / Command Center / Alert Center
(all already wired to the SSE feed) visibly "come alive" along the scripted curve.
Milestones (alert, escalation, RUL collapse) fire once, at fixed ticks, every run.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


# Per-tick keyframes (one tick == one SSE sweep, ~3s). The last row is held until the
# scenario is stopped, so the asset stays in a failure state for as long as the demo needs.
# Each row: temperature_c, vibration_mms, current_amps, health_score, phase label.
_BEARING_FAILURE_SCRIPT: list[dict[str, Any]] = [
    {"temperature": 72.0, "vibration": 4.5, "current": 45.0, "health": 95.0, "phase": "HEALTHY"},
    {"temperature": 72.5, "vibration": 4.6, "current": 45.0, "health": 95.0, "phase": "HEALTHY"},
    {"temperature": 73.0, "vibration": 4.8, "current": 46.0, "health": 94.0, "phase": "HEALTHY"},
    {"temperature": 73.5, "vibration": 5.0, "current": 46.0, "health": 93.0, "phase": "HEALTHY"},
    {"temperature": 76.0, "vibration": 5.7, "current": 48.0, "health": 89.0, "phase": "ONSET"},
    {"temperature": 79.0, "vibration": 6.5, "current": 50.0, "health": 84.0, "phase": "ONSET"},
    {"temperature": 83.0, "vibration": 7.3, "current": 52.0, "health": 78.0, "phase": "ONSET"},
    {"temperature": 87.0, "vibration": 8.2, "current": 55.0, "health": 71.0, "phase": "ONSET"},
    {"temperature": 92.0, "vibration": 9.2, "current": 57.0, "health": 63.0, "phase": "ALERT"},
    {"temperature": 94.0, "vibration": 9.8, "current": 58.0, "health": 57.0, "phase": "ALERT"},
    {"temperature": 96.0, "vibration": 10.2, "current": 59.0, "health": 51.0, "phase": "ALERT"},
    {"temperature": 97.0, "vibration": 10.6, "current": 60.0, "health": 46.0, "phase": "ALERT"},
    {"temperature": 99.0, "vibration": 11.0, "current": 61.0, "health": 41.0, "phase": "CRITICAL"},
    {"temperature": 100.0, "vibration": 11.3, "current": 62.0, "health": 37.0, "phase": "CRITICAL"},
    {"temperature": 101.0, "vibration": 11.6, "current": 63.0, "health": 34.0, "phase": "CRITICAL"},
    {"temperature": 102.0, "vibration": 11.9, "current": 64.0, "health": 31.0, "phase": "FAILURE_IMMINENT"},
]

_PROFILES = {
    "bearing_failure": {
        "label": "Bearing failure (vibration-led)",
        "pressure": 1.0,            # motors run near-atmospheric; held flat
        "script": _BEARING_FAILURE_SCRIPT,
        "escalation_tick": 12,      # tick at which a critical escalation + RUL collapse fires
        "escalation_rul_days": 5,
    },
}

_DEFAULT_ASSET = "Motor_M12"
_DEFAULT_PROFILE = "bearing_failure"

# Curated presentation baselines: a believable plant (mostly healthy, two degraded
# assets, one critical "story" asset to investigate). Used by reset_plant().
_PRESENTATION_BASELINES: dict[str, dict[str, Any]] = {
    "BlastFurnace_BF2":  {"health": 87, "rul": 90,  "fp": 0.12},
    "RollingMill_RM1":   {"health": 84, "rul": 75,  "fp": 0.16},
    "Conveyor_C7":       {"health": 89, "rul": 110, "fp": 0.10},
    "CoolingSystem_C1":  {"health": 72, "rul": 45,  "fp": 0.34},
    "Motor_M12":         {"health": 81, "rul": 60,  "fp": 0.21},
    "Pump_P3":           {"health": 68, "rul": 38,  "fp": 0.38},
    "Fan_F2":            {"health": 92, "rul": 180, "fp": 0.08},
    "Crusher_CR1":       {"health": 88, "rul": 120, "fp": 0.11},
    "DustCollector_DC1": {"health": 95, "rul": 270, "fp": 0.05},
    "Gearbox_G1":        {"health": 46, "rul": 14,  "fp": 0.74},
}


class DemoSimulationService:
    """Singleton-style director (class-level state) consulted by the SSE stream."""

    _scenario: Optional[dict[str, Any]] = None

    # --- lifecycle -----------------------------------------------------------
    @classmethod
    def start(cls, asset_id: str = _DEFAULT_ASSET, profile: str = _DEFAULT_PROFILE) -> dict:
        profile = profile if profile in _PROFILES else _DEFAULT_PROFILE
        cls._scenario = {
            "asset_id": asset_id,
            "profile": profile,
            "tick": 0,
            "escalation_done": False,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info("Demo scenario '%s' started on %s", profile, asset_id)
        return cls.status()

    @classmethod
    def stop(cls) -> dict:
        was = cls._scenario
        cls._scenario = None
        logger.info("Demo scenario stopped (was: %s)", was)
        return {"active": False, "stopped": bool(was)}

    @classmethod
    def status(cls) -> dict:
        s = cls._scenario
        if not s:
            return {"active": False}
        prof = _PROFILES[s["profile"]]
        script = prof["script"]
        idx = min(s["tick"], len(script) - 1)
        return {
            "active": True,
            "asset_id": s["asset_id"],
            "profile": s["profile"],
            "profile_label": prof["label"],
            "tick": s["tick"],
            "total_ticks": len(script),
            "phase": script[idx]["phase"],
            "escalation_done": s["escalation_done"],
            "started_at": s["started_at"],
        }

    @classmethod
    def is_target(cls, asset_id: str) -> bool:
        return bool(cls._scenario and cls._scenario["asset_id"] == asset_id)

    @classmethod
    def reset_plant(cls, db) -> dict:
        """Restore every asset to its curated presentation baseline.

        Stops any active scenario, rewrites health/RUL/failure-probability/status in the
        database, and clears the live SSE stream's in-memory state so the telemetry feed
        re-anchors to the new baselines on the very next tick. Use before a demo run.
        """
        from sqlalchemy import select
        from app.models.asset import Asset, AssetStatus
        # Imported here to avoid a circular import (stream service imports this module).
        from app.services.sensor_stream_service import SensorStreamService

        cls.stop()

        assets = db.scalars(select(Asset)).all()
        updated: list[str] = []
        for asset in assets:
            base = _PRESENTATION_BASELINES.get(
                asset.id, {"health": 90, "rul": 120, "fp": 0.10}
            )
            asset.health_score = base["health"]
            asset.rul_days = base["rul"]
            asset.failure_probability = base["fp"]
            if base["health"] < 50:
                asset.status = AssetStatus.CRITICAL
            elif base["health"] < 75:
                asset.status = AssetStatus.DEGRADED
            else:
                asset.status = AssetStatus.OPERATIONAL
            updated.append(asset.id)
        db.commit()

        # Drop live stream state so the next SSE sweep re-initialises from the DB.
        SensorStreamService._asset_states.clear()

        logger.info("Plant reset to presentation baselines (%d assets)", len(updated))
        return {"reset": True, "assets": updated}

    # --- per-tick application ------------------------------------------------
    @classmethod
    def apply(cls, asset_id: str, state: dict[str, Any]) -> bool:
        """Overwrite a sensor state with the scripted values for the current tick.

        Returns True if the asset is the active scenario target (caller should then
        skip random drift), False otherwise.
        """
        if not cls.is_target(asset_id):
            return False
        s = cls._scenario  # type: ignore[assignment]
        prof = _PROFILES[s["profile"]]
        script = prof["script"]
        frame = script[min(s["tick"], len(script) - 1)]

        state["temperature"] = frame["temperature"]
        state["vibration"] = frame["vibration"]
        state["current"] = frame["current"]
        state["pressure"] = prof["pressure"]
        state["health_score"] = frame["health"]
        state["anomaly_type"] = None  # scripted; bypass the random anomaly machinery
        # Mark non-healthy phases as anomalous so the UI flags them.
        state["anomaly_ticks_left"] = 0 if frame["phase"] == "HEALTHY" else 1
        return True

    @classmethod
    def advance(cls, db, notification_engine) -> None:
        """Progress the scenario one tick and fire one-shot milestones (escalation + RUL).

        Called once per SSE sweep, after all readings are generated. Threshold-based
        alerts are already created by ``SensorStreamService``; this adds the escalation
        and the RUL/failure-probability collapse at the scripted milestone.
        """
        s = cls._scenario
        if not s:
            return
        prof = _PROFILES[s["profile"]]
        tick = s["tick"]

        if tick >= prof["escalation_tick"] and not s["escalation_done"]:
            cls._fire_escalation(db, notification_engine, s["asset_id"], prof)
            s["escalation_done"] = True

        # Advance. Once we hit the end of the script, stop the scenario so the plant can recover.
        if tick + 1 >= len(prof["script"]):
            cls.stop()
        else:
            s["tick"] = tick + 1

    @staticmethod
    def _fire_escalation(db, notification_engine, asset_id: str, prof: dict) -> None:
        """Create a critical escalation, collapse RUL, and notify managers — once."""
        try:
            from sqlalchemy import select
            from app.models.asset import Asset, AssetStatus
            from app.models.escalation import Escalation, EscalationHistory

            asset = db.get(Asset, asset_id)
            if not asset:
                return

            # Collapse RUL / failure probability to reflect imminent bearing failure.
            asset.rul_days = prof["escalation_rul_days"]
            asset.failure_probability = 0.92
            asset.status = AssetStatus.CRITICAL

            roles = ["plant_manager", "supervisor", "reliability_engineer"]
            roles_str = ",".join(roles)
            reason = (
                f"Scripted demo: catastrophic bearing-failure trajectory on {asset_id}. "
                f"RUL collapsed to {prof['escalation_rul_days']} days; vibration > 11 mm/s."
            )

            esc = db.scalar(select(Escalation).where(Escalation.asset_id == asset_id))
            if not esc:
                db.add(Escalation(
                    asset_id=asset_id, escalation_level="critical",
                    target_roles=roles_str, resolved=False,
                ))
            else:
                esc.resolved = False
                esc.escalation_level = "critical"
                esc.target_roles = roles_str
                esc.created_at = datetime.now(timezone.utc)

            db.add(EscalationHistory(
                asset_id=asset_id, risk_level="critical", priority_band="CRITICAL",
                target_roles=roles_str, reason=reason,
            ))
            db.commit()

            notification_engine.create_notification(
                severity="critical",
                title=f"ESCALATION: Imminent failure on {asset_id}",
                message=reason,
                asset_id=asset_id,
                target_roles=roles,
            )
            logger.info("Demo escalation fired for %s", asset_id)
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Failed to fire demo escalation for %s: %s", asset_id, exc)
