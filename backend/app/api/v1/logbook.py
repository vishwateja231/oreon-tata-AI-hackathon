from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database.session import get_db
from app.models.maintenance_log import MaintenanceLog
from app.schemas.logbook import MaintenanceLogCreate, MaintenanceLogSummary

router = APIRouter(prefix="/logbook", tags=["Logbook"])


@router.post("", response_model=MaintenanceLogSummary, status_code=status.HTTP_201_CREATED)
def create_log_entry(payload: MaintenanceLogCreate, db: Session = Depends(get_db)) -> MaintenanceLog:
    """Manually add an entry into the digital maintenance logbook."""
    log = MaintenanceLog(
        asset_id=payload.asset_id,
        issue=payload.issue,
        root_cause=payload.root_cause,
        action=payload.action,
        engineer_notes=payload.engineer_notes,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("", response_model=list[MaintenanceLogSummary])
def list_log_entries(
    asset_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[MaintenanceLog]:
    """Retrieve maintenance logbook entries, optionally filtered by asset ID."""
    stmt = select(MaintenanceLog)
    if asset_id:
        stmt = stmt.where(MaintenanceLog.asset_id == asset_id)
    stmt = stmt.order_by(MaintenanceLog.timestamp.desc()).limit(limit)
    return list(db.scalars(stmt).all())
