
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "Oreon"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    SECRET_KEY: str = "dev-secret-key-replace-in-production"

    # Database
    DATABASE_URL: str = "postgresql://maintenance_user:maintenance_pass@localhost:5432/oreon"

    # Data
    DATA_DIR: str = str(Path(__file__).resolve().parents[2] / "data")

    # AI Services — OpenRouter.
    # Benchmarked 2026-06-10 on the real OREON ask prompt (latency / JSON validity /
    # grounding correctness): openai/gpt-4o-mini won at 4.3s with perfect grounded JSON.
    # Free-tier Nemotron models produced self-contradicting answers on large contexts —
    # do not reintroduce free-tier models here.
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = "openai/gpt-4o-mini"
    OPENROUTER_REASONING_MODEL: str = "openai/gpt-4o-mini"
    OPENROUTER_FAST_MODEL: str = "openai/gpt-4o-mini"

    # LLM provider: "groq" (direct, ~2s, free fast tier) or "openrouter" (~5-15s).
    # Groq runs llama-3.3-70b — with OREON's grounded context + strong formatting
    # rules it produces rich markdown answers at a fraction of OpenRouter latency.
    LLM_PROVIDER: str = "groq"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # DeepSeek direct connection
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"
    DEEPSEEK_REASONING_MODEL: str = "deepseek-v4-flash"

    # RAG: hash-vectors + BM25 + cross-encoder reranker by default (fast, no cold
    # start). Enable bge-m3 semantic embeddings only with a matching index rebuild.
    USE_BGE_EMBEDDINGS: bool = False
    # Voice agent — latency-critical. Single fast model, benchmarked best on the
    # real prompt: ~2.2s, clean JSON, 70B quality, non-reasoning (stays fast),
    # reliable (no free-tier 429s). Override via env, no code changes.
    OPENROUTER_VOICE_MODEL: str = "meta-llama/llama-3.3-70b-instruct"
    OPENROUTER_VOICE_MAX_TOKENS: int = 280
    OPENROUTER_VOICE_TIMEOUT: int = 30
    CHROMADB_PERSIST_DIR: str = str(Path(__file__).resolve().parents[2] / "data" / "chroma")

    # HuggingFace Hub — enables higher rate limits and faster model downloads
    HF_TOKEN: str = ""

    # Qdrant Cloud — vector store for RAG (manuals + SOPs)
    QDRANT_URL: str = ""
    QDRANT_API_KEY: str = ""

    # Upstash Redis — cloud cache (embeddings, RAG results, LLM completions)
    # Uses rediss:// (TLS) URL. Falls back to localhost:6379, then in-memory.
    REDIS_URL: str = ""

    # Deepgram API for STT/TTS voice integration
    DEEPGRAM_API_KEY: str = ""

    # CORS — browser origins allowed to call this API. Override via env with a
    # comma-separated list (e.g. CORS_ALLOW_ORIGINS="https://a.com,https://b.com").
    CORS_ALLOW_ORIGINS: list[str] = [
        "https://oreon.vercel.app",   # deployed frontend
        "http://localhost:8080",      # local dev frontend
    ]

    @field_validator("CORS_ALLOW_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        """Accept a comma-separated string from the environment."""
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value: object) -> object:
        """Accept deployment-style DEBUG strings in addition to booleans."""
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production", "false", "0", "no"}:
                return False
            if normalized in {"debug", "dev", "development", "true", "1", "yes"}:
                return True
        return value

    @field_validator("DATA_DIR", mode="after")
    @classmethod
    def validate_data_dir(cls, value: str) -> str:
        """Fallback to default relative data directory if path does not exist."""
        default_path = Path(__file__).resolve().parents[2] / "data"
        try:
            if not Path(value).exists():
                if default_path.exists():
                    return str(default_path)
        except Exception:
            if default_path.exists():
                return str(default_path)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
