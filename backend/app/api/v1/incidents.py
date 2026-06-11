from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.incident import IncidentResponse, IncidentSummary
from app.services.incident_service import IncidentService

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.get("", response_model=list[IncidentSummary])
def list_incidents(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    asset_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> list[IncidentSummary]:
    """List all maintenance incidents, optionally filtered by asset or severity."""
    svc = IncidentService(db)
    return svc.get_all(skip=skip, limit=limit, asset_id=asset_id, severity=severity)


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(incident_id: str, db: Session = Depends(get_db)) -> IncidentResponse:
    """Retrieve full details of a single incident including root cause and corrective action."""
    svc = IncidentService(db)
    incident = svc.get_by_id(incident_id)
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Incident '{incident_id}' not found",
        )
    return incident
