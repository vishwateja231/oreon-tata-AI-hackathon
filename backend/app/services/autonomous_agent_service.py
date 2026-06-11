"""
OREON Sentinel — Autonomous Maintenance Intelligence Agent.

Runs continuously, monitoring all plant assets without human interaction.
Detects anomalies, predicts failures, launches investigations, generates alerts,
creates escalations, and routes work to appropriate roles.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.models.asset import Asset
from app.models.sensor_reading import SensorReading
from app.models.sentinel_activity import SentinelActivity, ActivityType
from app.services.sensor_analysis_engine import SensorAnalysisEngine
from app.services.root_cause_engine import RootCauseEngine
from app.services.priority_engine import PriorityEngine
from app.services.escalation_engine import EscalationEngine
from app.services.business_impact_engine import BusinessImpactEngine
from app.services.plant_impact_engine import PlantImpactEngine
from app.services.maintenance_planner import MaintenancePlanner
from app.services.critical_event_detector import CriticalEventDetector

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------


class SentinelState:
    """Tracks sentinel operational state (singleton-like class-level state)."""

    running: bool = False
    last_scan: datetime | None = None
    scan_count: int = 0
    anomalies_detected: int = 0
    alerts_generated: int = 0
    investigations_created: int = 0
    escalations_triggered: int = 0
    _last_asset_state: dict[str, dict[str, Any]] = {}

    @classmethod
    def reset(cls):
        cls.running = False
        cls.last_scan = None
        cls.scan_count = 0
        cls.anomalies_detected = 0
        cls.alerts_generated = 0
        cls.investigations_created = 0
        cls.escalations_triggered = 0
        cls._last_asset_state = {}


class AutonomousAgentService:
    """
    The Sentinel — OREON's autonomous monitoring agent.

    Continuously scans all assets, detects anomalies, launches investigations,
    generates rich alerts, and routes actions to appropriate roles.
    """

    def __init__(self, db: Session) -> None:
        self._db = db
        self.sensor_engine = SensorAnalysisEngine()
        self.root_cause_engine = RootCauseEngine()
        self.priority_engine = PriorityEngine()
        self.escalation_engine = EscalationEngine()
        self.plant_impact_engine = PlantImpactEngine(db)
        self.business_impact_engine = BusinessImpactEngine()
        self.maintenance_planner = MaintenancePlanner()
        self.critical_event_detector = CriticalEventDetector(db)

    # ------------------------------------------------------------------
    # MAIN CYCLE
    # ------------------------------------------------------------------

    def run_cycle(self) -> dict[str, Any]:
        """Execute one full monitoring cycle across all assets."""
        SentinelState.running = True
        cycle_start = datetime.now(timezone.utc)
        results: list[dict] = []

        try:
            assets = self._db.scalars(select(Asset)).all()
            for asset in assets:
                try:
                    result = self._monitor_asset(asset)
                    if result:
                        results.append(result)
                except Exception as exc:
                    logger.error("Sentinel error on asset %s: %s", asset.id, exc)
                    continue

            SentinelState.last_scan = cycle_start
            SentinelState.scan_count += 1
            self._db.commit()

        except Exception as exc:
            logger.error("Sentinel cycle failed: %s", exc)
            self._db.rollback()
        finally:
            SentinelState.running = True  # stays running between cycles

        return {
            "cycle_time": (datetime.now(timezone.utc) - cycle_start).total_seconds(),
            "assets_scanned": len(results),
            "anomalies": sum(1 for r in results if r.get("anomaly")),
            "alerts": sum(1 for r in results if r.get("alert_created")),
            "investigations": sum(1 for r in results if r.get("investigation_created")),
        }

    # ------------------------------------------------------------------
    # PER-ASSET MONITORING
    # ------------------------------------------------------------------

    def _monitor_asset(self, asset: Asset) -> dict[str, Any] | None:
        """Full monitoring pipeline for a single asset."""
        # 1. Get latest sensor readings
        readings = self._db.scalars(
            select(SensorReading)
            .where(SensorReading.asset_id == asset.id)
            .order_by(SensorReading.timestamp.desc())
            .limit(50)
        ).all()

        if not readings:
            return None

        latest = readings[0]
        snapshot = {
            "temperature_c": latest.temperature_c,
            "vibration_mms": latest.vibration_mms,
            "current_amps": latest.current_amps,
            "pressure_bar": latest.pressure_bar,
            "rpm": latest.rpm,
            "noise_db": latest.noise_db,
        }

        # 2. Anomaly detection
        sensor_analysis = self.sensor_engine.analyze_sensor_snapshot(snapshot)
        has_anomaly = bool(
            sensor_analysis.anomalies
            or sensor_analysis.threshold_violations
            or sensor_analysis.degradation_indicators
        )

        # 3. Check if state changed (debounce) — skip debounce on first scan
        prev_state = SentinelState._last_asset_state.get(asset.id, {})
        prev_anomaly = prev_state.get("has_anomaly", False)
        is_first_scan = not bool(prev_state)
        state_changed = has_anomaly != prev_anomaly or is_first_scan

        # Update tracked state
        SentinelState._last_asset_state[asset.id] = {
            "has_anomaly": has_anomaly,
            "health_score": asset.health_score,
            "last_check": datetime.now(timezone.utc).isoformat(),
        }

        result: dict[str, Any] = {
            "asset_id": asset.id,
            "anomaly": has_anomaly,
            "alert_created": False,
            "investigation_created": False,
            "escalation_created": False,
        }

        # 4. Always log health check
        health_status = "anomaly signals active" if has_anomaly else "operating normally"
        self._log_activity(
            asset.id,
            ActivityType.health_check,
            f"{asset.name} — {asset.health_score:.0f}% health · {health_status}",
            {"health_score": asset.health_score, "snapshot": snapshot},
            confidence=0.95,
        )

        # 5. If anomaly detected and state changed → full pipeline
        if has_anomaly and state_changed:
            self._handle_anomaly(asset, snapshot, sensor_analysis, result)

        return result

    # ------------------------------------------------------------------
    # ANOMALY HANDLING PIPELINE
    # ------------------------------------------------------------------

    def _handle_anomaly(
        self, asset: Asset, snapshot: dict, sensor_analysis: Any, result: dict
    ) -> None:
        """Full anomaly response pipeline: RCA → RUL → Impact → Alert → Escalation."""
        SentinelState.anomalies_detected += 1

        # Log anomaly detection
        anomaly_details = {
            "anomalies": sensor_analysis.anomalies,
            "violations": sensor_analysis.threshold_violations,
            "degradation": sensor_analysis.degradation_indicators,
        }
        self._log_activity(
            asset.id,
            ActivityType.anomaly_detected,
            f"Anomaly detected: {sensor_analysis.anomalies[0] if sensor_analysis.anomalies else 'threshold violation'}",
            anomaly_details,
            confidence=0.88,
        )

        # Root Cause Analysis
        fault_desc = " ".join(sensor_analysis.anomalies + sensor_analysis.threshold_violations)
        rca_result = self.root_cause_engine.analyze(
            asset_type=asset.equipment_type,
            fault_description=fault_desc or "anomaly detected",
            sensor_analysis=sensor_analysis,
        )
        self._log_activity(
            asset.id,
            ActivityType.rca_completed,
            f"Root cause: {rca_result.root_cause} (confidence: {rca_result.confidence:.0%})",
            {
                "root_cause": rca_result.root_cause,
                "confidence": rca_result.confidence,
                "evidence": rca_result.evidence,
                "recommended_actions": rca_result.recommended_actions,
            },
            confidence=rca_result.confidence,
        )

        # RUL prediction (use asset's existing value + degradation signal)
        rul_days = asset.rul_days or 90
        if sensor_analysis.degradation_indicators:
            rul_days = max(3, int(rul_days * 0.7))  # Accelerated degradation

        self._log_activity(
            asset.id,
            ActivityType.rul_predicted,
            f"RUL prediction: {rul_days} days remaining",
            {"rul_days": rul_days, "failure_probability": asset.failure_probability},
            confidence=0.82,
        )

        # Business impact (lightweight — catch errors gracefully)
        try:
            plant_impact = self.plant_impact_engine.analyze_impact(asset.id)
            business_impact = self.business_impact_engine.analyze(plant_impact)
        except Exception:
            # Fallback: create minimal impact data
            from app.schemas.decision import PlantImpactData, BusinessImpactData
            plant_impact = PlantImpactData(
                affected_assets=[], production_line="PL-1",
                critical_assets_impacted=[], estimated_downtime_hours=4.0,
                impact_score=50.0, impact_category="LOCALIZED",
                impact_chain=[], bottlenecks=[],
            )
            business_impact = BusinessImpactData(
                production_loss_estimate="~200 tonnes",
                downtime_hours=4.0, business_risk="MEDIUM",
                executive_summary="Moderate production risk",
                cost_of_inaction_inr=500000.0,
            )

        # Priority scoring
        from app.schemas.decision import PriorityInput
        priority_input = PriorityInput(
            failure_probability=asset.failure_probability or 0.3,
            health_score=asset.health_score or 70,
            rul_days=rul_days,
            asset_criticality=asset.criticality.value if asset.criticality else "medium",
            historical_failure_frequency=2,
            safety_risk=0.4 if asset.criticality and asset.criticality.value == "critical" else 0.2,
            spare_availability=0.7,
            procurement_lead_time=14,
            dependency_impact_score=plant_impact.impact_score,
        )
        priority_result = self.priority_engine.calculate_priority(priority_input)

        # Generate rich alert
        self._generate_rich_alert(
            asset, snapshot, sensor_analysis, rca_result,
            rul_days, business_impact, priority_result
        )
        result["alert_created"] = True
        SentinelState.alerts_generated += 1

        # Auto-create investigation
        self._create_auto_investigation(asset, snapshot, sensor_analysis, rca_result)
        result["investigation_created"] = True
        SentinelState.investigations_created += 1

        # Escalation routing
        try:
            escalation_result = self.critical_event_detector.scan_asset(asset.id)
        except Exception:
            escalation_result = None
        if escalation_result and escalation_result.get("escalation_level") in ("high", "critical"):
            result["escalation_created"] = True
            SentinelState.escalations_triggered += 1
            self._log_activity(
                asset.id,
                ActivityType.escalation_created,
                f"Escalation triggered: level={escalation_result.get('escalation_level', 'high')}",
                escalation_result,
                confidence=0.93,
            )

        # Generate maintenance plan
        self._generate_maintenance_plan(
            asset, rca_result, priority_result, plant_impact, business_impact
        )

    # ------------------------------------------------------------------
    # RICH ALERT GENERATION
    # ------------------------------------------------------------------

    def _generate_rich_alert(
        self, asset, snapshot, sensor_analysis, rca_result,
        rul_days, business_impact, priority_result
    ) -> None:
        """Generate evidence-backed, context-rich alert."""
        from app.models.notification import Notification

        # Determine severity from priority
        severity = "critical" if priority_result.priority_band in ("CRITICAL", "HIGH") else "warning"

        # Build rich alert message
        primary_anomaly = (
            sensor_analysis.anomalies[0]
            if sensor_analysis.anomalies
            else sensor_analysis.threshold_violations[0]
            if sensor_analysis.threshold_violations
            else "Health degradation"
        )

        # Format sensor readings for context
        sensor_context = []
        if snapshot.get("vibration_mms"):
            sensor_context.append(f"Vibration: {snapshot['vibration_mms']:.1f} mm/s")
        if snapshot.get("temperature_c"):
            sensor_context.append(f"Temperature: {snapshot['temperature_c']:.1f}°C")

        message = (
            f"Issue: {primary_anomaly}\n"
            f"Readings: {' | '.join(sensor_context)}\n"
            f"Probable Cause: {rca_result.root_cause}\n"
            f"RUL: {rul_days} days\n"
            f"Failure Probability: {asset.failure_probability or 0.5:.0%}\n"
            f"Business Exposure: ₹{business_impact.cost_of_inaction_inr / 100000:.1f} Lakh\n"
            f"Priority: {priority_result.priority_band}\n"
            f"AI Confidence: {rca_result.confidence:.0%}"
        )

        # Determine target roles based on priority
        if priority_result.priority_band == "CRITICAL":
            target_roles = "plant_manager,supervisor,reliability_engineer,maintenance_engineer"
        elif priority_result.priority_band == "HIGH":
            target_roles = "supervisor,reliability_engineer,maintenance_engineer"
        else:
            target_roles = "maintenance_engineer,operator"

        notification = Notification(
            severity=severity,
            title=f"[Sentinel] {asset.name}: {rca_result.root_cause}",
            message=message,
            asset_id=asset.id,
            target_roles=target_roles,
            status="active",
        )
        self._db.add(notification)

        self._log_activity(
            asset.id,
            ActivityType.alert_created,
            f"Alert: {rca_result.root_cause} — Priority {priority_result.priority_band}",
            {
                "severity": severity,
                "root_cause": rca_result.root_cause,
                "rul_days": rul_days,
                "business_exposure_inr": business_impact.cost_of_inaction_inr,
                "priority_band": priority_result.priority_band,
                "target_roles": target_roles.split(","),
            },
            confidence=rca_result.confidence,
        )

    # ------------------------------------------------------------------
    # AUTO-INVESTIGATION
    # ------------------------------------------------------------------

    def _create_auto_investigation(
        self, asset, _snapshot, sensor_analysis, rca_result
    ) -> None:
        """Create investigation record without manual trigger."""
        from app.models.maintenance_log import MaintenanceLog

        log_entry = MaintenanceLog(
            asset_id=asset.id,
            issue=f"[Sentinel] Auto-investigation: {rca_result.root_cause}",
            root_cause=rca_result.root_cause,
            action=(
                f"Autonomous investigation triggered by Sentinel.\n"
                f"Anomalies: {', '.join(sensor_analysis.anomalies[:3])}\n"
                f"Evidence: {', '.join(rca_result.evidence[:3])}"
            ),
            engineer_notes="Generated by OREON Sentinel autonomous agent",
        )
        self._db.add(log_entry)

        self._log_activity(
            asset.id,
            ActivityType.investigation_started,
            f"Auto-investigation: {rca_result.root_cause}",
            {
                "anomalies": sensor_analysis.anomalies,
                "root_cause": rca_result.root_cause,
                "confidence": rca_result.confidence,
            },
            confidence=rca_result.confidence,
        )

    # ------------------------------------------------------------------
    # MAINTENANCE PLAN GENERATION
    # ------------------------------------------------------------------

    def _generate_maintenance_plan(
        self, asset, rca_result, priority_result, plant_impact, _business_impact
    ) -> None:
        """Generate immediate, short-term, and long-term maintenance actions."""
        immediate = []
        short_term = []
        long_term = []

        # Immediate actions based on root cause
        if rca_result.root_cause:
            immediate.append(f"Inspect: {rca_result.root_cause}")
        if priority_result.priority_band in ("CRITICAL", "HIGH"):
            immediate.append("Notify shift supervisor immediately")
            immediate.append("Prepare for potential unplanned stop")

        # Short-term from contributing factors
        for factor in rca_result.evidence[:2]:
            short_term.append(f"Address contributing factor: {factor}")
        short_term.append("Schedule corrective maintenance within 7 days")

        # Long-term
        long_term.append("Review PM schedule for this asset class")
        long_term.append("Increase monitoring frequency on degrading parameters")
        if plant_impact and plant_impact.affected_assets:
            long_term.append(f"Assess impact on {len(plant_impact.affected_assets)} downstream assets")

        plan_details = {
            "immediate_actions": immediate,
            "short_term_actions": short_term,
            "long_term_actions": long_term,
            "priority_band": priority_result.priority_band,
            "assigned_role": "maintenance_engineer",
        }

        self._log_activity(
            asset.id,
            ActivityType.maintenance_plan_generated,
            f"Maintenance plan: {len(immediate)} immediate, {len(short_term)} short-term, {len(long_term)} long-term actions",
            plan_details,
            confidence=0.87,
        )

    # ------------------------------------------------------------------
    # HELPERS
    # ------------------------------------------------------------------

    def _log_activity(
        self,
        asset_id: str,
        activity_type: ActivityType,
        summary: str,
        details: dict | None = None,
        confidence: float | None = None,
    ) -> None:
        """Persist a sentinel activity record."""
        activity = SentinelActivity(
            asset_id=asset_id,
            activity_type=activity_type,
            summary=summary,
            details=details,
            confidence=confidence,
        )
        self._db.add(activity)


# ---------------------------------------------------------------------------
# SCHEDULER ENTRY POINT
# ---------------------------------------------------------------------------


def run_sentinel_cycle() -> dict[str, Any]:
    """Entry point called by the scheduler. Creates its own DB session."""
    db = SessionLocal()
    try:
        service = AutonomousAgentService(db)
        result = service.run_cycle()
        logger.info(
            "Sentinel cycle complete: %d assets, %d anomalies, %d alerts",
            result["assets_scanned"],
            result["anomalies"],
            result["alerts"],
        )
        return result
    except Exception as exc:
        logger.error("Sentinel cycle error: %s", exc)
        return {"error": str(exc)}
    finally:
        db.close()

