from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.incident import Incident
from app.schemas.incident import IncidentCreate


class IncidentService:
    """Data-access and business-logic layer for maintenance incidents."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        asset_id: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> list[Incident]:
        stmt = select(Incident).order_by(Incident.timestamp.desc())
        if asset_id:
            stmt = stmt.where(Incident.asset_id == asset_id)
        if severity:
            stmt = stmt.where(Incident.severity == severity)
        stmt = stmt.offset(skip).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_by_id(self, incident_id: str) -> Optional[Incident]:
        return self._db.get(Incident, incident_id)

    def get_by_asset(self, asset_id: str) -> list[Incident]:
        stmt = (
            select(Incident)
            .where(Incident.asset_id == asset_id)
            .order_by(Incident.timestamp.desc())
        )
        return list(self._db.scalars(stmt).all())

    def create(self, payload: IncidentCreate) -> Incident:
        incident = Incident(**payload.model_dump())
        self._db.add(incident)
        self._db.commit()
        self._db.refresh(incident)
        return incident

    def upsert_bulk(self, incidents: list[dict]) -> int:
        count = 0
        for data in incidents:
            existing = self._db.get(Incident, data["incident_id"])
            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                self._db.add(Incident(**data))
            count += 1
        self._db.commit()
        return count

    def get_recent(self, limit: int = 10) -> list[Incident]:
        stmt = select(Incident).order_by(Incident.timestamp.desc()).limit(limit)
        return list(self._db.scalars(stmt).all())
