from app.schemas.investigation import KnowledgeChunk
from app.services.document_knowledge_service import DocumentKnowledgeService


class ManualKnowledgeService(DocumentKnowledgeService):
    """Indexes and retrieves maintenance manual knowledge."""

    def __init__(self) -> None:
        super().__init__(subdir="manuals", collection_name="oreon_manuals")

    # Backward-compatible aliases (callers use the manual-specific names).
    def index_manuals(self) -> int:
        return self.index_all()

    def search_manuals(self, query: str, top_k: int = 5) -> list[KnowledgeChunk]:
        return self.search(query, top_k=top_k)

    def retrieve_manual_context(self, query: str, top_k: int = 5) -> dict:
        return self.retrieve_context(query, top_k=top_k)
