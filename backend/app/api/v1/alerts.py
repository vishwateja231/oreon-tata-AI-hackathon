from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database.session import get_db
from app.services.notification_engine import NotificationEngine
from app.models.notification import Notification, NotificationRead

router = APIRouter(prefix="/alerts", tags=["Alerts"])


def personalize_alert(title: str, message: str, asset_id: Optional[str], role: str) -> tuple[str, str]:
    """Rewrite alert title/message per role so each persona gets actionable context."""
    role_lower = role.lower().strip()
    name = asset_id or "equipment"

    # 1. Spares/Inventory shortage alerts
    if any(w in title.lower() or w in message.lower() for w in ("spare", "stock", "reorder", "part", "sku")):
        SPARE_MSGS = {
            "procurement_officer": ("Critical Spare Unavailable", f"SKU stock for {name} below reorder level. Initiate emergency PO."),
            "plant_manager": ("Supply Chain Risk", f"Spare parts shortage on {name} threatens production. Revenue exposure active."),
            "supervisor": ("Inventory Check Required", f"Verify warehouse stock for {name} replacement before next shift."),
            "maintenance_engineer": ("Parts Availability Warning", f"Confirm spare availability for {name} before scheduling repair."),
            "reliability_engineer": ("Degradation Acceleration Risk", f"Lack of spares for {name} may extend downtime beyond RUL window."),
            "operator": ("Parts Alert", f"Spare parts for {name} are running low. Flag to supervisor."),
        }
        return SPARE_MSGS.get(role_lower, ("Spare Stock Alert", f"Low stock parts for {name}. Contact procurement."))

    # 2. Escalation / SLA alerts
    if any(w in title.lower() or w in message.lower() for w in ("escalat", "sla", "dispatch")):
        ESC_MSGS = {
            "supervisor": ("Escalation Requires Action", f"Immediate decision needed on {name} to prevent SLA breach."),
            "plant_manager": ("Revenue Exposure Active", f"Outage risk on {name} escalated to critical. ₹2.3 Cr exposure."),
            "operator": ("Follow Escalation Protocol", f"Anomalies on {name} require immediate supervisor notification."),
            "maintenance_engineer": ("Urgent Work Order", f"Prepare tools and alignment protocol for emergency dispatch to {name}."),
            "reliability_engineer": ("Escalation Analysis Needed", f"Update prediction models — {name} crossed escalation threshold."),
            "procurement_officer": ("Expedite Parts for Escalation", f"Escalated asset {name} may need emergency spare procurement."),
        }
        return ESC_MSGS.get(role_lower, ("Escalation Active", f"Asset {name} has been escalated."))

    # 3. Vibration breach
    title_lower = title.lower()
    if "vibration" in title_lower or "vibration" in message.lower():
        VIB_MSGS = {
            "operator": ("Inspect Lubrication System", f"Check oil levels and vibration indicators on {name}. Report any noise."),
            "maintenance_engineer": ("Bearing Degradation Detected", f"Schedule bearing inspection on {name}. Vibration exceeds normal band."),
            "reliability_engineer": ("Vibration Spectrum Anomaly", f"High-frequency shift detected on {name}. Update degradation model."),
            "supervisor": ("Vibration Alert — Assign Team", f"Asset {name} has vibration anomaly. Assign maintenance crew."),
            "plant_manager": ("Production Risk — Vibration", f"Vibration breach on {name} may cause unplanned shutdown."),
            "procurement_officer": ("Bearing Replacement May Be Needed", f"Vibration on {name} suggests bearing wear. Verify stock."),
        }
        return VIB_MSGS.get(role_lower, ("Vibration Alert", f"Abnormal vibration detected on {name}."))

    # 4. Thermal overheat
    if "thermal" in title_lower or "temperature" in title_lower or "overheat" in title_lower or "thermal" in message.lower():
        THERM_MSGS = {
            "operator": ("Check Cooling Flow", f"Verify coolant lines and fan operation on {name}. Avoid contact."),
            "maintenance_engineer": ("Thermal Overheat — Inspect", f"Check heat dissipation, coolant pump, and bearings on {name}."),
            "reliability_engineer": ("Thermal Degradation Trend", f"Thermal breach on {name} correlates with accelerated aging."),
            "supervisor": ("Thermal Alert — Decision Needed", f"Asset {name} overheating. Consider controlled shutdown."),
            "plant_manager": ("Thermal Risk to Production", f"Temperature breach on {name} risks cascading failure."),
            "procurement_officer": ("Cooling Components Check", f"Thermal issue on {name}. Verify coolant valve and seal stock."),
        }
        return THERM_MSGS.get(role_lower, ("Thermal Alert", f"Temperature breach on {name}."))

    # 5. Health / RUL degradation
    if "health" in title_lower or "rul" in title_lower or "degradation" in message.lower():
        HEALTH_MSGS = {
            "operator": ("Asset Condition Warning", f"Health of {name} is dropping. Monitor for unusual sounds/vibration."),
            "maintenance_engineer": ("Predictive Maintenance Due", f"Health index on {name} indicates upcoming failure. Plan repair."),
            "reliability_engineer": ("RUL Below Threshold", f"ML forecaster indicates accelerated degradation for {name}."),
            "supervisor": ("Impending Failure — Plan Action", f"Asset {name} health declining. Schedule maintenance window."),
            "plant_manager": ("Asset Health Warning", f"Unplanned failure risk on {name} could impact production line."),
            "procurement_officer": ("Pre-order Replacement Parts", f"Asset {name} degrading. Ensure replacement parts are on order."),
        }
        return HEALTH_MSGS.get(role_lower, ("Health Alert", f"Asset health declining on {name}."))

    # 6. Generic fallback — still personalize by role
    GENERIC_MSGS = {
        "operator": ("Field Attention Required", f"Anomaly detected on {name}. Perform visual inspection."),
        "maintenance_engineer": ("Maintenance Advisory", f"Review condition of {name} and schedule if needed."),
        "reliability_engineer": ("Anomaly for Analysis", f"New signal on {name}. Update prediction models."),
        "supervisor": ("Situation Awareness", f"Alert on {name}. Assess team capacity and prioritize."),
        "plant_manager": ("Plant Status Update", f"Condition change on {name}. Monitor for business impact."),
        "procurement_officer": ("Supply Chain Advisory", f"Activity on {name} may require parts verification."),
    }
    return GENERIC_MSGS.get(role_lower, (title, message))


@router.get("")
def list_alerts(
    request: Request,
    role: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    asset_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query("active", alias="status"),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List notifications with filtering, read state tracking, and severity counts."""
    if not role:
        role = request.headers.get("X-Oreon-Role")
    if role:
        role = role.lower().strip()

    engine = NotificationEngine(db)
    alerts = engine.get_notifications(
        role=role,
        severity=severity,
        asset_id=asset_id,
        status=status_filter,
        limit=limit,
    )
    counts = engine.get_counts(role=role)

    # Determine read state if role is provided
    read_ids = set()
    if role:
        read_stmt = select(NotificationRead.notification_id).where(
            NotificationRead.role_name == role.lower()
        )
        read_ids = set(db.scalars(read_stmt).all())

    serialized_alerts = []
    for alert in alerts:
        alert_title, alert_message = alert.title, alert.message
        if role:
            alert_title, alert_message = personalize_alert(alert_title, alert_message, alert.asset_id, role)
        serialized_alerts.append(
            {
                "id": alert.id,
                "severity": alert.severity,
                "title": alert_title,
                "message": alert_message,
                "asset_id": alert.asset_id,
                "target_roles": [r.strip() for r in alert.target_roles.split(",") if r.strip()],
                "created_at": alert.created_at.isoformat() if alert.created_at else None,
                "status": alert.status,
                "is_read": alert.id in read_ids if role else False,
            }
        )

    return {"counts": counts, "alerts": serialized_alerts}


@router.post("/{alert_id}/read")
def mark_alert_read(
    alert_id: int,
    role: str = Query(..., description="Role marking the alert as read"),
    db: Session = Depends(get_db),
):
    """Mark a notification as read by a specific role."""
    engine = NotificationEngine(db)
    success = engine.mark_as_read(alert_id, role)
    if not success:
        # Check if notification exists
        alert = db.get(Notification, alert_id)
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Alert '{alert_id}' not found",
            )
    return {"success": True}
