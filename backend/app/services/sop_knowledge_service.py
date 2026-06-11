from app.schemas.investigation import KnowledgeChunk
from app.services.document_knowledge_service import DocumentKnowledgeService


class SOPKnowledgeService(DocumentKnowledgeService):
    """Indexes and retrieves standard operating procedure knowledge."""

    def __init__(self) -> None:
        super().__init__(subdir="sops", collection_name="oreon_sops")

    # Backward-compatible aliases (callers use the SOP-specific names).
    def index_sops(self) -> int:
        return self.index_all()

    def search_sops(self, query: str, top_k: int = 5) -> list[KnowledgeChunk]:
        return self.search(query, top_k=top_k)

    def retrieve_sop_context(self, query: str, top_k: int = 5) -> dict:
        return self.retrieve_context(query, top_k=top_k)
