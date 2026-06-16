import os as _os

# ── Silence ChromaDB / PostHog telemetry before any import ──────────────────
# ChromaDB 0.5.x calls posthog.capture() with args that don't match PostHog
# 7.x signature, producing ERROR/WARNING logs on every client create.
_os.environ["ANONYMIZED_TELEMETRY"] = "false"
_os.environ["CHROMA_TELEMETRY"] = "false"
_os.environ["POSTHOG_DISABLED"] = "true"

# Patch PostHog at module level — disables all tracking globally
try:
    import posthog as _posthog
    _posthog.disabled = True
    _posthog.capture = lambda *_a, **_kw: None
except Exception:
    pass

# (ChromaDB removed — OREON uses a local embedded Qdrant vector store.)
# ─────────────────────────────────────────────────────────────────────────────

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_router
from app.config.settings import get_settings
from app.database.base import Base
from app.database.session import engine

# Import all models so Alembic/SQLAlchemy discovers them
import app.models  # noqa: F401

settings = get_settings()

if settings.HF_TOKEN:
    _os.environ.setdefault("HF_TOKEN", settings.HF_TOKEN)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Create tables on startup (Alembic handles migrations in production)."""
    import logging
    _log = logging.getLogger(__name__)

    Base.metadata.create_all(bind=engine)

    # Back-fill additive columns on databases created before recent model changes
    # (create_all builds new tables but never alters existing ones).
    try:
        from app.utils.ensure_schema import ensure_additive_columns
        ensure_additive_columns(engine)
    except Exception as exc:
        _log.warning("Schema back-fill skipped: %s", exc)

    # Seed on first run AND refresh asset vitals on every boot. load_all() is
    # idempotent: it full-seeds an empty DB, otherwise it only re-applies the
    # health/risk/RUL/status spread from assets.json. This is required because the
    # live sensor sim drifts health down and persists it — without a boot refresh an
    # already-seeded plant would ratchet toward failure and never recover the spread.
    try:
        from app.utils.data_loader import load_all
        load_all()
        _log.info("Database seeded / asset vitals refreshed from seed data")
    except Exception as exc:
        _log.warning("Seed/refresh failed (may already be seeded): %s", exc)

    # ── Production warmup: preload every singleton so NO request pays a cold
    #    start. Loads reranker, builds/verifies the RAG index, creates the Groq
    #    client, primes the Redis cache, and runs ONE full retrieval through the
    #    pipeline (embed → hybrid search → rerank) so it is hot for query #1.
    import asyncio
    def run_startup_warmup():
        try:
            from app.services.knowledge_base import preload_rag_models
            from app.services.manual_knowledge_service import ManualKnowledgeService
            from app.services.sop_knowledge_service import SOPKnowledgeService
            from app.services.llm_router import get_groq_client
            from app.utils.redis_cache import get_cache

            # 1. Reranker (cross-encoder) into RAM
            preload_rag_models()
            _log.info("warmup: RAG models preloaded")

            # 2. Build / verify the persisted vector index
            msvc = ManualKnowledgeService()
            ssvc = SOPKnowledgeService()
            if not msvc.index.is_populated():
                msvc.index_manuals()
            if not ssvc.index.is_populated():
                ssvc.index_sops()
            _log.info("warmup: RAG indexes ready")

            # 3. Groq client singleton + Redis cache handle
            if settings.GROQ_API_KEY:
                get_groq_client(settings.GROQ_API_KEY)
            get_cache()

            # 4. Hot-path warmup — full retrieval so query #1 is fast
            try:
                msvc.index.search("bearing wear vibration", top_k=5)
                ssvc.index.search("lockout tagout procedure", top_k=5)
            except Exception as exc:
                _log.warning("warmup: sample retrieval skipped: %s", exc)

            _log.info("warmup: complete — all singletons hot, no cold start")
        except Exception as exc:
            _log.warning("Startup warmup failed (will lazy-init): %s", exc)

    asyncio.create_task(asyncio.to_thread(run_startup_warmup))

    # ── Sentinel autonomous agent scheduler ──────────────────────────────
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from app.services.autonomous_agent_service import run_sentinel_cycle, SentinelState

    # Run first cycle immediately so data is available on page load
    def _initial_sentinel_scan():
        import time
        time.sleep(2)  # Brief delay to let DB seed finish
        _log.info("Running initial Sentinel scan...")
        run_sentinel_cycle()
        _log.info("Initial Sentinel scan complete")

    asyncio.create_task(asyncio.to_thread(_initial_sentinel_scan))

    sentinel_scheduler = AsyncIOScheduler()
    sentinel_scheduler.add_job(
        run_sentinel_cycle,
        "interval",
        seconds=60,
        id="sentinel_cycle",
        name="OREON Sentinel Autonomous Monitoring",
        max_instances=1,
    )
    sentinel_scheduler.start()
    SentinelState.running = True
    _log.info("OREON Sentinel scheduler started (60s interval)")

    yield

    sentinel_scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Industrial Maintenance Decision Intelligence Platform for steel plant operations. "
        "Provides asset health, incident history, spare parts inventory, and AI-ready endpoints."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate limiting (graceful throttling with Retry-After headers) ──────────────
# Tiers: global 100/min, chat 20/min, voice 10/min, heavy AI 5/min.
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    # Generous global limit — a real dashboard fires several parallel reads per page,
    # so the ceiling protects against abuse without ever tripping normal use.
    limiter = Limiter(key_func=get_remote_address, default_limits=["600/minute"])
    app.state.limiter = limiter

    def _throttle_handler(request, exc):
        # Never surface a raw 429 stack — friendly message WITH CORS headers (the
        # SlowAPI middleware short-circuits before CORS, so add them here or the
        # browser reports a misleading CORS error instead of the throttle).
        resp = JSONResponse(
            status_code=429,
            content={"detail": "OREON is handling a burst of requests. Please retry in a moment."},
        )
        resp.headers["Retry-After"] = "5"
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp

    app.add_exception_handler(RateLimitExceeded, _throttle_handler)
    app.add_middleware(SlowAPIMiddleware)
    _RATE_LIMITING = True
except Exception as _rl_exc:  # pragma: no cover
    import logging as _l
    _l.getLogger(__name__).warning("Rate limiting disabled: %s", _rl_exc)
    _RATE_LIMITING = False


from fastapi import Request
from fastapi.responses import JSONResponse

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    # CORS preflight is handled by CORSMiddleware; pass it straight through.
    if request.method == "OPTIONS":
        return await call_next(request)

    # Note: role-based access is intentionally advisory in this build — the
    # `X-Oreon-Role` header drives client-side personalisation, but the API does
    # not block any role (login is cosmetic; see CLAUDE.md). Hardening response
    # headers are still applied to every request below.
    response = await call_next(request)
    # Security headers on every response.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=()"
    return response


app.include_router(api_router)


@app.get("/health", tags=["Health"])
def health_check() -> dict:
    """Liveness probe for container orchestration."""
    return {"status": "ok", "version": settings.APP_VERSION, "service": settings.APP_NAME}


@app.get("/diagnostics", tags=["Health"])
def diagnostics() -> dict:
    """System diagnostics — AI readiness, DB connectivity, and RAG index status."""
    result: dict = {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "openrouter_configured": bool(settings.OPENROUTER_API_KEY),
        "openrouter_reachable": False,
        "openrouter_model": settings.OPENROUTER_MODEL,
        "db": "unknown",
        "asset_count": 0,
        "rag": {"manuals_indexed": False, "sops_indexed": False, "semantic_embeddings": False},
    }

    # OpenRouter reachability check
    if settings.OPENROUTER_API_KEY:
        try:
            import requests
            headers = {"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"}
            resp = requests.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=5)
            if resp.status_code == 200:
                result["openrouter_reachable"] = True
        except Exception:
            pass

    # DB check
    try:
        from app.database.session import get_db as _get_db
        from app.models.asset import Asset as _Asset
        from sqlalchemy import func, select as _select
        db = next(_get_db())
        result["asset_count"] = db.scalar(_select(func.count()).select_from(_Asset)) or 0
        result["db"] = "ok"
        db.close()
    except Exception as exc:
        result["db"] = f"error: {exc}"

    # RAG status — query the live Qdrant index (the actual vector store).
    try:
        from app.services.knowledge_base import _get_local_qdrant_client
        client = _get_local_qdrant_client()
        existing = {c.name for c in client.get_collections().collections}
        def _count(name):
            try:
                return client.get_collection(name).points_count or 0
            except Exception:
                return 0
        m, s = _count("oreon_manuals"), _count("oreon_sops")
        result["rag"]["manuals_indexed"] = "oreon_manuals" in existing and m > 0
        result["rag"]["sops_indexed"] = "oreon_sops" in existing and s > 0
        result["rag"]["manual_chunks"] = m
        result["rag"]["sop_chunks"] = s
    except Exception:
        pass

    # Semantic embedding status
    try:
        from app.services.knowledge_base import _ST_MODEL
        result["rag"]["semantic_embeddings"] = _ST_MODEL is not None
    except Exception:
        pass

    return result
