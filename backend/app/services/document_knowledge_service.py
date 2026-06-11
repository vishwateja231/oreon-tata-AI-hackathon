import logging
from pathlib import Path

from app.config.settings import get_settings
from app.schemas.investigation import KnowledgeChunk
from app.services.knowledge_base import ChromaKnowledgeIndex

logger = logging.getLogger(__name__)


class DocumentKnowledgeService:
    """Generic PDF knowledge service: parametrised by data subdirectory + Chroma collection.

    Manual and SOP services are thin subclasses of this — the indexing, search, and
    context-retrieval logic lives here once, instead of being duplicated per document type.
    """

    def __init__(self, subdir: str, collection_name: str) -> None:
        settings = get_settings()
        self.doc_dir = Path(settings.DATA_DIR) / subdir
        self.collection_name = collection_name
        self.index = ChromaKnowledgeIndex(collection_name, self.doc_dir)
        self._indexed = False

    def index_all(self) -> int:
        """Parse, chunk, embed, and index every PDF in the configured directory."""
        documents = sorted(self.doc_dir.glob("*.pdf"))
        count = self.index.index_documents(documents)
        self._indexed = True
        logger.info("Indexed %d chunks for '%s' from %s", count, self.collection_name, self.doc_dir)
        return count

    def search(self, query: str, top_k: int = 5) -> list[KnowledgeChunk]:
        """Return the top-k knowledge chunks for a query, indexing lazily on first use."""
        if not self._indexed and not self.index.is_populated():
            self.index_all()
        else:
            self._indexed = True
        return [
            KnowledgeChunk(
                text=hit.text,
                source_document=hit.source_document,
                confidence=hit.confidence,
                metadata=hit.metadata,
            )
            for hit in self.index.search(query, top_k=top_k)
        ]

    def retrieve_context(self, query: str, top_k: int = 5) -> dict:
        """Return chunks plus the top source document and its confidence."""
        chunks = self.search(query, top_k=top_k)
        return {
            "relevant_chunks": chunks,
            "source_document": chunks[0].source_document if chunks else None,
            "confidence": chunks[0].confidence if chunks else 0.0,
        }
