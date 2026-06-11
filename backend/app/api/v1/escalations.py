from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database.session import get_db
from app.models.escalation import Escalation, EscalationHistory
from app.models.notification import Notification
from app.schemas.escalation import EscalationsResponse, ManualEscalationResponse

router = APIRouter(prefix="/escalations", tags=["Escalations"])


class ManualEscalationRequest(BaseModel):
    asset_id: str = Field(..., description="ID of the asset to escalate")
    escalation_level: str = Field("high", description="Escalation level (low, medium, high, critical)")
    reason: str = Field("Manual escalation by supervisor", description="Reason for escalation")



@router.get("", response_model=EscalationsResponse)
def list_escalations(
    asset_id: Optional[str] = Query(None),
    resolved: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Retrieve active asset escalations and chronological escalation audit history."""
    # Active escalations
    stmt = select(Escalation)
    if asset_id:
        stmt = stmt.where(Escalation.asset_id == asset_id)
    if resolved is not None:
        stmt = stmt.where(Escalation.resolved == resolved)
    stmt = stmt.order_by(Escalation.created_at.desc()).limit(limit)
    active_records = db.scalars(stmt).all()

    # Escalation history
    hist_stmt = select(EscalationHistory)
    if asset_id:
        hist_stmt = hist_stmt.where(EscalationHistory.asset_id == asset_id)
    hist_stmt = hist_stmt.order_by(EscalationHistory.timestamp.desc()).limit(limit)
    history_records = db.scalars(hist_stmt).all()

    active_list = []
    for esc in active_records:
        active_list.append(
            {
                "id": esc.id,
                "asset_id": esc.asset_id,
                "escalation_level": esc.escalation_level,
                "target_roles": [r.strip() for r in esc.target_roles.split(",") if r.strip()] if esc.target_roles else [],
                "resolved": esc.resolved,
                "created_at": esc.created_at.isoformat() if esc.created_at else None,
            }
        )

    history_list = []
    for hist in history_records:
        history_list.append(
            {
                "id": hist.id,
                "asset_id": hist.asset_id,
                "risk_level": hist.risk_level,
                "priority_band": hist.priority_band,
                "target_roles": [r.strip() for r in hist.target_roles.split(",") if r.strip()] if hist.target_roles else [],
                "reason": hist.reason,
                "timestamp": hist.timestamp.isoformat() if hist.timestamp else None,
                "decision_id": hist.decision_id,
            }
        )

    return {"active": active_list, "history": history_list}


@router.post("/{escalation_id}/resolve")
def resolve_escalation(escalation_id: int, db: Session = Depends(get_db)):
    """Mark an active escalation as resolved and auto-resolve associated alerts."""
    esc = db.get(Escalation, escalation_id)
    if not esc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Escalation '{escalation_id}' not found",
        )
    esc.resolved = True

    # Also resolve active notifications for this asset
    notifications = db.scalars(
        select(Notification)
        .where(Notification.asset_id == esc.asset_id)
        .where(Notification.status == "active")
    ).all()
    for n in notifications:
        n.status = "resolved"

    db.commit()
    return {"success": True}


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ManualEscalationResponse)
def create_manual_escalation(payload: ManualEscalationRequest, db: Session = Depends(get_db)):
    """Manually escalate an asset anomaly, creating alerts and logbook entries."""
    from datetime import datetime, timezone
    from app.models.asset import Asset
    from app.services.notification_engine import NotificationEngine
    from app.models.maintenance_log import MaintenanceLog
    
    asset = db.get(Asset, payload.asset_id)
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{payload.asset_id}' not found"
        )
        
    level = payload.escalation_level.lower().strip()
    if level not in ("low", "medium", "high", "critical"):
        level = "high"
        
    roles = []
    if level == "critical":
        roles = ["plant_manager", "supervisor", "reliability_engineer", "maintenance_engineer", "operator"]
    elif level == "high":
        roles = ["supervisor", "reliability_engineer", "maintenance_engineer"]
    elif level == "medium":
        roles = ["maintenance_engineer", "operator", "supervisor"]
    else:
        roles = ["operator", "maintenance_engineer"]
        
    roles_str = ",".join(roles)
    
    # Bug Fix: If an escalation already exists for this asset, reactivate it 
    # instead of creating a new row, to bypass the unique constraint.
    stmt = select(Escalation).where(Escalation.asset_id == asset.id)
    esc = db.scalar(stmt)
    if not esc:
        esc = Escalation(
            asset_id=asset.id,
            escalation_level=level,
            target_roles=roles_str,
            resolved=False
        )
        db.add(esc)
    else:
        esc.resolved = False
        esc.escalation_level = level
        esc.target_roles = roles_str
        esc.created_at = datetime.now(timezone.utc)
        
    # Create escalation history
    history = EscalationHistory(
        asset_id=asset.id,
        risk_level=level,
        priority_band="CRITICAL" if level == "critical" else "HIGH" if level == "high" else "MEDIUM",
        target_roles=roles_str,
        reason=payload.reason
    )
    db.add(history)
    
    # Create notification alert
    title = f"[MANUAL ESCALATION: {level.upper()}] Anomaly on {asset.id}"
    message = f"{asset.name} manually escalated: {payload.reason}"
    NotificationEngine(db).create_notification(
        severity=level,
        title=title,
        message=message,
        asset_id=asset.id,
        target_roles=roles
    )
    
    # Append to maintenance logbook
    log_entry = MaintenanceLog(
        asset_id=asset.id,
        issue=f"MANUAL ESCALATION: {title}",
        root_cause=payload.reason,
        action=f"Inspect asset and coordinate with {', '.join(roles)}."
    )
    db.add(log_entry)
    
    db.commit()
    return {"success": True, "escalation_level": level}
