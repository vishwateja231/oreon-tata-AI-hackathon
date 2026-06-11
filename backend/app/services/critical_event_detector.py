import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.models.asset import Asset
from app.models.escalation import Escalation, EscalationHistory
from app.models.maintenance_log import MaintenanceLog
from app.services.escalation_engine import EscalationEngine
from app.services.notification_engine import NotificationEngine

logger = logging.getLogger(__name__)

class CriticalEventDetector:
    """Monitors assets and inventory metrics to trigger escalations, alert notifications, and log events."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self.escalation_engine = EscalationEngine()
        self.notification_engine = NotificationEngine(db)

    def scan_asset(self, asset_id: str) -> dict | None:
        """Scan a single asset, checking metrics and triggering escalation/notifications if thresholds are exceeded."""
        asset = self._db.get(Asset, asset_id)
        if not asset:
            logger.warning("CriticalEventDetector: Asset %s not found", asset_id)
            return None

        # Gather metrics for evaluation
        risk_level = asset.status.value
        priority_band = "CRITICAL" if asset.health_score < 50 or asset.failure_probability >= 0.7 else "HIGH" if asset.health_score < 75 else "MEDIUM"
        rul_days = asset.rul_days
        
        # Calculate derived impact (simple score proxy)
        production_impact = asset.failure_probability * 100.0
        if asset.criticality.value == "critical":
            production_impact += 20.0
        production_impact = min(100.0, production_impact)

        # Procurement risk proxy (e.g. if status is offline or degraded, assume moderate/high parts risk)
        procurement_risk = "HIGH" if asset.status.value in ("critical", "offline") else "MEDIUM" if asset.status.value == "degraded" else "LOW"

        # 1. Run Escalation Engine evaluation
        result = self.escalation_engine.evaluate(
            risk_level=risk_level,
            priority_band=priority_band,
            rul_days=rul_days,
            production_impact=production_impact,
            procurement_risk=procurement_risk
        )

        level = result["escalation_level"]
        roles = result["notify_roles"]
        window = result["response_window"]
        reason = result["escalation_reason"]

        # Only escalate if level is high or critical
        if level in ("high", "critical"):
            # 2. Check if active escalation already exists
            roles_str = ",".join(roles)
            active_esc = self._db.scalars(select(Escalation).where(Escalation.asset_id == asset.id)).first()

            try:
                with self._db.begin_nested():
                    if not active_esc:
                        # Create active escalation
                        active_esc = Escalation(
                            asset_id=asset.id,
                            escalation_level=level,
                            target_roles=roles_str,
                            resolved=False
                        )
                        self._db.add(active_esc)
                    else:
                        active_esc.resolved = False
                        active_esc.escalation_level = level
                        active_esc.target_roles = roles_str
                        active_esc.created_at = datetime.now(timezone.utc)
                    self._db.flush()
            except Exception:
                active_esc = self._db.scalars(select(Escalation).where(Escalation.asset_id == asset.id)).first()
                if active_esc:
                    active_esc.resolved = False
                    active_esc.escalation_level = level
                    active_esc.target_roles = roles_str
                    active_esc.created_at = datetime.now(timezone.utc)

            # Log to escalation history
            history = EscalationHistory(
                asset_id=asset.id,
                risk_level=level,
                priority_band=priority_band,
                target_roles=roles_str,
                reason=reason
            )
            self._db.add(history)

            # 3. Dispatch Notification targeting target roles
            title = f"[ESCALATION: {level.upper()}] Anomaly on {asset.id}"
            message = f"{asset.name} is showing critical warning parameters (RUL {rul_days}d). {reason}"
            self.notification_engine.create_notification(
                severity=level,
                title=title,
                message=message,
                asset_id=asset.id,
                target_roles=roles
            )

            # 4. Append to Digital Maintenance Logbook
            exists = self._db.scalar(
                select(MaintenanceLog.id)
                .where(MaintenanceLog.asset_id == asset.id)
                .where(MaintenanceLog.issue.like("%ESCALATION%"))
                .limit(1)
            )
            if not exists:
                log_entry = MaintenanceLog(
                    asset_id=asset.id,
                    issue=f"AUTOMATED ESCALATION: {title}",
                    root_cause=reason,
                    action=f"Assemble crew to inspect within response window ({window})."
                )
                self._db.add(log_entry)
            
            self._db.commit()
            logger.info("Asset %s escalated to LEVEL: %s", asset.id, level)

        return result

    def scan_all_assets(self) -> int:
        """Scan all database assets and return total escalations active/triggered."""
        stmt = select(Asset)
        assets = self._db.scalars(stmt).all()
        count = 0
        for asset in assets:
            res = self.scan_asset(asset.id)
            if res and res["escalation_level"] in ("high", "critical"):
                count += 1
        return count
