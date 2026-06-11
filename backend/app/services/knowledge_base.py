import hashlib
import logging
import math
import re
import uuid
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Optional, List, Dict

from app.config.settings import get_settings
from app.utils.redis_cache import get_cache

logger = logging.getLogger(__name__)

TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")

# ---------------------------------------------------------------------------
# BGE-M3 & Reranker Model Loading (Lazy)
# ---------------------------------------------------------------------------
_ST_MODEL = None
_RERANK_MODEL = None
_ST_DIMS = 1024  # BGE-M3 produces 1024-dim vectors


def _load_sentence_transformer() -> bool:
    """Optionally load BAAI/bge-m3 for semantic embeddings.

    Disabled by default: the 2GB model is a major cold-start cost, and loading
    it AFTER the index was built with hash vectors creates an embedding-space
    mismatch (vector search silently degrades to BM25). With it off we use fast
    hash vectors + BM25 + a cross-encoder reranker (the real quality driver),
    which keeps retrieval <300ms and the pipeline consistent. Enable via
    settings.USE_BGE_EMBEDDINGS only if you rebuild the index with it on.
    """
    global _ST_MODEL
    if _ST_MODEL is not None:
        return True
    try:
        from app.config.settings import get_settings
        if not getattr(get_settings(), "USE_BGE_EMBEDDINGS", False):
            return False
        from sentence_transformers import SentenceTransformer  # type: ignore
        _ST_MODEL = SentenceTransformer("BAAI/bge-m3")
        logger.info("sentence-transformers loaded: BAAI/bge-m3 (1024 dims)")
        return True
    except Exception as exc:
        logger.warning("Failed to load BAAI/bge-m3, using hash fallback: %s", exc)
        return False


def preload_rag_models() -> None:
    """Eagerly load the reranker at startup to eliminate first-query cold start."""
    _load_sentence_transformer()  # no-op unless USE_BGE_EMBEDDINGS
    _load_reranker()


def _load_reranker() -> bool:
    global _RERANK_MODEL
    if _RERANK_MODEL is not None:
        return True
    try:
        from sentence_transformers import CrossEncoder  # type: ignore
        _RERANK_MODEL = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("CrossEncoder loaded: ms-marco-MiniLM-L-6-v2")
        return True
    except Exception as exc:
        logger.warning("CrossEncoder not loaded (cosine fallback): %s", exc)
        return False


# Models are loaded lazily on first use — do NOT load at import time


@dataclass(frozen=True)
class SearchHit:
    text: str
    source_document: str
    confidence: float
    metadata: dict

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "SearchHit":
        return cls(
            text=data["text"],
            source_document=data["source_document"],
            confidence=data["confidence"],
            metadata=data["metadata"],
        )


class BM25:
    """Pure-Python Okapi BM25 for keyword search."""

    def __init__(self, corpus: List[str]):
        self.corpus_size = len(corpus)
        self.doc_lens = [len(doc.split()) for doc in corpus]
        self.avg_doc_len = sum(self.doc_lens) / max(self.corpus_size, 1)
        self.f: List[Dict[str, int]] = []
        self.df: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}

        for doc in corpus:
            frequencies: Dict[str, int] = {}
            for word in tokenize(doc):
                frequencies[word] = frequencies.get(word, 0) + 1
            self.f.append(frequencies)
            for word in frequencies:
                self.df[word] = self.df.get(word, 0) + 1

        for word, freq in self.df.items():
            self.idf[word] = math.log(
                1.0 + (self.corpus_size - freq + 0.5) / (freq + 0.5)
            )

    def get_scores(self, query_terms: set) -> List[float]:
        scores = [0.0] * self.corpus_size
        k1, b = 1.5, 0.75
        for word in query_terms:
            if word not in self.df:
                continue
            idf = self.idf[word]
            for i, doc_freqs in enumerate(self.f):
                freq = doc_freqs.get(word, 0)
                scores[i] += idf * (freq * (k1 + 1)) / (
                    freq + k1 * (1 - b + b * self.doc_lens[i] / self.avg_doc_len)
                )
        return scores


class HashingEmbeddingService:
    """Embeds text using BGE-M3 if loaded, else falls back to hash-based vectors."""

    def __init__(self, dimensions: Optional[int] = None) -> None:
        self.dimensions = dimensions or _ST_DIMS

    def embed(self, text: str) -> list:
        cache = get_cache()
        text_hash = hashlib.sha1(text.encode("utf-8")).hexdigest()
        cached = cache.get("embed", text_hash)
        if cached is not None:
            return cached
        vector = self._compute_embedding(text)
        cache.set("embed", vector, text_hash)
        return vector

    def _compute_embedding(self, text: str) -> list:
        if _ST_MODEL is not None:
            try:
                vec = _ST_MODEL.encode(text, normalize_embeddings=True)
                embedding_list = vec.tolist()
                if len(embedding_list) == self.dimensions:
                    return embedding_list
                if len(embedding_list) > self.dimensions:
                    return embedding_list[: self.dimensions]
                return embedding_list + [0.0] * (self.dimensions - len(embedding_list))
            except Exception as e:
                logger.warning("BGE-M3 encoding failed, hash fallback: %s", e)

        vector = [0.0] * self.dimensions
        for token in TOKEN_RE.findall(text.lower()):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 else -1.0
            vector[index] += sign
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]


class PdfTextExtractor:
    def extract(self, path: Path) -> str:
        if path.read_bytes()[:5] == b"%PDF-":
            try:
                from pypdf import PdfReader
                reader = PdfReader(str(path))
                text = "\n".join(page.extract_text() or "" for page in reader.pages)
                if text.strip():
                    return text
            except Exception as exc:
                logger.debug("PDF parser fallback for %s: %s", path, exc)
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path.read_text(encoding="latin-1")


def tokenize(text: str) -> set:
    return {t.lower() for t in TOKEN_RE.findall(text) if len(t) > 2}


def chunk_text(text: str, chunk_size: int = 350, overlap: int = 70) -> list:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    chunks = []
    start = 0
    while start < len(clean):
        end = min(start + chunk_size, len(clean))
        chunks.append(clean[start:end])
        if end >= len(clean):
            break
        start = max(0, end - overlap)
    return chunks


def _str_to_uuid(s: str) -> str:
    """Convert an arbitrary string ID to a deterministic UUID for Qdrant."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, s))


# ---------------------------------------------------------------------------
# Local embedded Qdrant — process-wide singleton
# ---------------------------------------------------------------------------

_LOCAL_QDRANT_CLIENT = None


def _get_local_qdrant_client():
    """Return the one shared embedded-Qdrant client for this process.

    The file-based store holds an exclusive lock, so every knowledge index must
    reuse the same client or they collide. Created once, reused everywhere.
    """
    global _LOCAL_QDRANT_CLIENT
    if _LOCAL_QDRANT_CLIENT is None:
        from qdrant_client import QdrantClient
        local_path = Path(get_settings().CHROMADB_PERSIST_DIR) / "qdrant"
        local_path.mkdir(parents=True, exist_ok=True)
        _LOCAL_QDRANT_CLIENT = QdrantClient(path=str(local_path))
        logger.info("Using local embedded Qdrant at %s (shared client)", local_path)
    return _LOCAL_QDRANT_CLIENT


# ---------------------------------------------------------------------------
# Qdrant Knowledge Index
# ---------------------------------------------------------------------------

class QdrantKnowledgeIndex:
    """Qdrant Cloud-backed index with Hybrid Search (Vector + BM25) and Reranking."""

    def __init__(self, collection_name: str, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.collection_name = collection_name
        self.embedding_service = HashingEmbeddingService()
        self._fallback_hits: list = []
        self._client = self._create_client()
        if self._client:
            self._ensure_collection()

    def _create_client(self):
        settings = get_settings()
        try:
            from qdrant_client import QdrantClient
            if settings.QDRANT_URL and settings.QDRANT_API_KEY:
                client = QdrantClient(
                    url=settings.QDRANT_URL,
                    api_key=settings.QDRANT_API_KEY,
                    timeout=30,
                )
                client.get_collections()  # test connection
                logger.info("Connected to Qdrant Cloud: %s", settings.QDRANT_URL)
                return client
            # Local embedded Qdrant — file-based store is single-process-locked, so
            # ALL knowledge indexes must share ONE client instance (process-wide
            # singleton) or they collide and silently fall back to empty in-memory.
            return _get_local_qdrant_client()
        except Exception as exc:
            logger.warning("Qdrant unavailable, using in-memory fallback: %s", exc)
            return None

    def _ensure_collection(self) -> None:
        if not self._client:
            return
        try:
            from qdrant_client.models import Distance, VectorParams
            existing = {c.name for c in self._client.get_collections().collections}
            if self.collection_name not in existing:
                self._client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=_ST_DIMS, distance=Distance.COSINE),
                )
                logger.info("Created Qdrant collection: %s", self.collection_name)
        except Exception as exc:
            logger.warning("Failed to ensure collection %s: %s", self.collection_name, exc)

    def is_populated(self) -> bool:
        if self._client:
            try:
                info = self._client.get_collection(self.collection_name)
                return (info.points_count or 0) > 0
            except Exception:
                pass
        return len(self._fallback_hits) > 0

    def index_documents(self, documents: Iterable[Path]) -> int:
        extractor = PdfTextExtractor()
        hits: list = []
        points = []

        for path in documents:
            if not path.exists():
                logger.warning("Knowledge document missing: %s", path)
                continue
            for index, chunk in enumerate(chunk_text(extractor.extract(path))):
                str_id = f"{path.stem}-{index}"
                metadata = {"source_document": path.name, "chunk_index": index}
                hit = SearchHit(
                    text=chunk, source_document=path.name,
                    confidence=1.0, metadata=metadata,
                )
                hits.append(hit)
                embedding = self.embedding_service.embed(chunk)
                if self._client:
                    from qdrant_client.models import PointStruct
                    points.append(PointStruct(
                        id=_str_to_uuid(str_id),
                        vector=embedding,
                        payload={"text": chunk, **metadata},
                    ))

        self._fallback_hits = hits

        if self._client and points:
            try:
                # Upsert in batches of 100
                batch_size = 100
                for i in range(0, len(points), batch_size):
                    self._client.upsert(
                        collection_name=self.collection_name,
                        points=points[i: i + batch_size],
                    )
                logger.info("Upserted %d vectors to Qdrant collection %s", len(points), self.collection_name)
            except Exception as exc:
                logger.warning("Failed to upsert to Qdrant %s: %s", self.collection_name, exc)

        return len(hits)

    def search(self, query: str, top_k: int = 5) -> list:
        cache = get_cache()
        cached = cache.get("rag", self.collection_name, query, top_k)
        if cached is not None:
            logger.info("RAG cache hit for: '%s'", query)
            return [SearchHit.from_dict(h) for h in cached]

        hits = self._search_uncached(query, top_k)
        cache.set("rag", [h.to_dict() for h in hits], self.collection_name, query, top_k)
        return hits

    def _search_uncached(self, query: str, top_k: int) -> list:
        # Ensure models are loaded (lazy)
        _load_sentence_transformer()
        _load_reranker()

        # 1. Fetch all docs for BM25
        all_hits: list = []
        if self._client:
            try:
                results, _ = self._client.scroll(
                    collection_name=self.collection_name,
                    with_payload=True,
                    with_vectors=False,
                    limit=2000,
                )
                all_hits = [
                    SearchHit(
                        text=r.payload.get("text", ""),
                        source_document=r.payload.get("source_document", "unknown"),
                        confidence=1.0,
                        metadata={k: v for k, v in r.payload.items() if k != "text"},
                    )
                    for r in results if r.payload
                ]
            except Exception as exc:
                logger.warning("Qdrant scroll failed: %s", exc)

        if not all_hits:
            all_hits = self._fallback_hits
        if not all_hits:
            return []

        # 2. BM25 keyword search
        corpus = [h.text for h in all_hits]
        bm25_model = BM25(corpus)
        bm25_scores = bm25_model.get_scores(tokenize(query))
        bm25_ranked = sorted(zip(bm25_scores, all_hits), key=lambda x: x[0], reverse=True)
        bm25_results = [h for score, h in bm25_ranked if score > 0]

        # 3. Vector search via Qdrant
        vector_results: list = []
        if self._client:
            try:
                query_vector = self.embedding_service.embed(query)
                limit = min(top_k * 3, 50)
                # qdrant-client >=1.10 deprecated .search() in favour of .query_points();
                # support both so local embedded and cloud clients work identically.
                if hasattr(self._client, "query_points"):
                    v_results = self._client.query_points(
                        collection_name=self.collection_name,
                        query=query_vector,
                        limit=limit,
                        with_payload=True,
                    ).points
                else:
                    v_results = self._client.search(
                        collection_name=self.collection_name,
                        query_vector=query_vector,
                        limit=limit,
                        with_payload=True,
                    )
                vector_results = [
                    SearchHit(
                        text=r.payload.get("text", ""),
                        source_document=r.payload.get("source_document", "unknown"),
                        confidence=max(0.0, min(1.0, float(r.score))),
                        metadata={k: v for k, v in r.payload.items() if k != "text"},
                    )
                    for r in v_results if r.payload
                ]
            except Exception as exc:
                logger.warning("Qdrant vector search failed: %s", exc)

        if not vector_results:
            vector_results = bm25_results[:top_k]

        # 4. Reciprocal Rank Fusion
        rrf_scores: Dict[str, float] = {}
        hit_map: Dict[str, SearchHit] = {}
        k_param = 60.0

        for rank, hit in enumerate(vector_results):
            hit_map[hit.text] = hit
            rrf_scores[hit.text] = rrf_scores.get(hit.text, 0.0) + 1.0 / (k_param + rank)

        for rank, hit in enumerate(bm25_results):
            hit_map[hit.text] = hit
            rrf_scores[hit.text] = rrf_scores.get(hit.text, 0.0) + 1.0 / (k_param + rank)

        merged = sorted(rrf_scores.keys(), key=lambda t: rrf_scores[t], reverse=True)
        candidates = [hit_map[t] for t in merged[: top_k * 3]]

        if not candidates:
            return []

        # 5. Rerank with CrossEncoder
        if _RERANK_MODEL is not None:
            try:
                pairs = [[query, c.text] for c in candidates]
                scores = _RERANK_MODEL.predict(pairs)
                ranked = sorted(zip(scores, candidates), key=lambda x: x[0], reverse=True)
                min_s, max_s = min(scores), max(scores)
                denom = (max_s - min_s) if (max_s - min_s) > 1e-5 else 1.0
                return [
                    SearchHit(
                        text=h.text,
                        source_document=h.source_document,
                        confidence=round(0.3 + 0.65 * (s - min_s) / denom, 4),
                        metadata=h.metadata,
                    )
                    for s, h in ranked[:top_k]
                ]
            except Exception as exc:
                logger.warning("CrossEncoder reranking failed: %s", exc)

        # Fallback: cosine similarity reranking
        try:
            query_vector = self.embedding_service.embed(query)
            dot_products = [
                sum(q * d for q, d in zip(query_vector, self.embedding_service.embed(c.text)))
                for c in candidates
            ]
            ranked = sorted(zip(dot_products, candidates), key=lambda x: x[0], reverse=True)
            return [
                SearchHit(
                    text=h.text,
                    source_document=h.source_document,
                    confidence=round(max(0.1, min(0.99, float(s))), 4),
                    metadata=h.metadata,
                )
                for s, h in ranked[:top_k]
            ]
        except Exception:
            return candidates[:top_k]

    def invalidate_cache(self) -> None:
        pass


# Keep ChromaKnowledgeIndex as an alias so nothing else breaks
ChromaKnowledgeIndex = QdrantKnowledgeIndex
