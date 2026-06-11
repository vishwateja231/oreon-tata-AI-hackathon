from collections import Counter
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.incident import Incident
from app.services.knowledge_base import tokenize


class IncidentRetrievalService:
    """Retrieves historical incidents that resemble a current fault."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def find_similar_incidents(
        self,
        fault_description: str,
        symptoms: str = "",
        asset_type: Optional[str] = None,
        limit: int = 5,
    ) -> list[dict]:
        query_terms = tokenize(f"{fault_description} {symptoms} {asset_type or ''}")
        stmt = select(Incident, Asset).join(Asset, Incident.asset_id == Asset.id)
        candidates = self._db.execute(stmt).all()
        scored = []
        for incident, asset in candidates:
            incident_text = f"{incident.symptoms} {incident.root_cause} {incident.corrective_action} {asset.equipment_type}"
            incident_terms = tokenize(incident_text)
            overlap = len(query_terms & incident_terms)
            type_boost = 0.25 if asset_type and asset.equipment_type.lower() == asset_type.lower() else 0.0
            score = overlap / max(len(query_terms), 1) + type_boost
            if score > 0:
                scored.append((score, incident, asset))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [self._serialize_incident(score, incident, asset) for score, incident, asset in scored[:limit]]

    def summarize_incident_patterns(self, incidents: list[dict]) -> dict:
        if not incidents:
            return {
                "top_similar_incidents": [],
                "most_common_root_causes": [],
                "average_downtime": 0.0,
                "average_repair_time": 0.0,
                "successful_corrective_actions": [],
            }
        root_causes = Counter(item["root_cause"] for item in incidents)
        return {
            "top_similar_incidents": incidents,
            "most_common_root_causes": [
                {"root_cause": root_cause, "count": count}
                for root_cause, count in root_causes.most_common(5)
            ],
            "average_downtime": round(sum(item["downtime_hours"] for item in incidents) / len(incidents), 2),
            "average_repair_time": round(sum(item["repair_time_hours"] for item in incidents) / len(incidents), 2),
            "successful_corrective_actions": list(dict.fromkeys(item["corrective_action"] for item in incidents))[:5],
        }

    @staticmethod
    def _serialize_incident(score: float, incident: Incident, asset: Asset) -> dict:
        return {
            "incident_id": incident.incident_id,
            "asset_id": incident.asset_id,
            "asset_name": asset.name,
            "asset_type": asset.equipment_type,
            "timestamp": incident.timestamp.isoformat(),
            "symptoms": incident.symptoms,
            "root_cause": incident.root_cause,
            "corrective_action": incident.corrective_action,
            "repair_time_hours": incident.repair_time_hours,
            "downtime_hours": incident.downtime_hours,
            "severity": incident.severity,
            "similarity": round(min(1.0, score), 4),
        }
