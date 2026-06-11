from sqlalchemy.orm import Session

from app.services.incident_retrieval_service import IncidentRetrievalService
from app.services.manual_knowledge_service import ManualKnowledgeService
from app.services.sop_knowledge_service import SOPKnowledgeService


class DualRetrievalService:
    """Retrieves procedural and historical knowledge in one workflow."""

    def __init__(
        self,
        db: Session,
        manual_service: ManualKnowledgeService | None = None,
        sop_service: SOPKnowledgeService | None = None,
        incident_service: IncidentRetrievalService | None = None,
    ) -> None:
        self.manual_service = manual_service or ManualKnowledgeService()
        self.sop_service = sop_service or SOPKnowledgeService()
        self.incident_service = incident_service or IncidentRetrievalService(db)

    def retrieve(self, query: str, asset_type: str, limit: int = 5) -> dict:
        manual_chunks = self.manual_service.search_manuals(f"{asset_type} {query}", top_k=limit)
        sop_chunks = self.sop_service.search_sops(f"{asset_type} {query}", top_k=limit)
        similar_incidents = self.incident_service.find_similar_incidents(
            fault_description=query,
            symptoms=query,
            asset_type=asset_type,
            limit=limit,
        )
        return {
            "procedural_knowledge": manual_chunks + sop_chunks,
            "historical_knowledge": similar_incidents,
        }
