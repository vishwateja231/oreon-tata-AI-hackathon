"""Centralized multi-tier cache for OREON (Phase 5).

Connects to a local Redis (``localhost:6379``) and **degrades gracefully to an in-process
dict cache** if Redis is unavailable — the app stays 100% functional either way.

Five tiers (per the architecture plan):
  embed  — text embeddings           key oreon:embed:{hash}    TTL 30 days
  rag    — retrieved chunks per query key oreon:rag:{hash}      TTL 1 hour
  llm    — model completions          key oreon:llm:{model}:{h} TTL 12 hours
  tool   — volatile tool/sensor reads key oreon:tool:{name}:{h} TTL 10 seconds
  session— conversation history       key oreon:session:{id}    TTL 24 hours
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

TTL = {
    "embed": 60 * 60 * 24 * 30,   # 30 days
    "rag": 60 * 60,               # 1 hour
    "llm": 60 * 60 * 12,          # 12 hours
    "tool": 10,                   # 10 seconds
    "session": 60 * 60 * 24,      # 24 hours
}


def _hash(*parts: Any) -> str:
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha1(raw.encode("utf-8", "ignore")).hexdigest()[:24]


class _MemoryBackend:
    """Tiny TTL dict used when Redis is unavailable."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}

    def get(self, key: str) -> Optional[str]:
        item = self._store.get(key)
        if not item:
            return None
        expiry, value = item
        if expiry and expiry < time.time():
            self._store.pop(key, None)
            return None
        return value

    def setex(self, key: str, ttl: int, value: str) -> None:
        self._store[key] = (time.time() + ttl if ttl else 0, value)

    def ping(self) -> bool:
        return True


class CacheClient:
    """Singleton-ish cache facade with Redis + in-memory fallback.

    Connection priority:
      1. REDIS_URL env var (Upstash / any cloud Redis via rediss:// or redis://)
      2. localhost:6379 (local dev)
      3. In-memory dict (always works, not shared across processes)
    """

    _instance: Optional["CacheClient"] = None

    def __init__(self) -> None:
        self.backend: Any
        self.using_redis = False
        self._connect()

    def _connect(self) -> None:
        import redis  # type: ignore
        from app.config.settings import get_settings

        settings = get_settings()

        # 1. Try REDIS_URL (Upstash or any configured cloud Redis)
        if settings.REDIS_URL:
            try:
                client = redis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    socket_connect_timeout=3,
                    socket_timeout=3,
                )
                client.ping()
                self.backend = client
                self.using_redis = True
                host = settings.REDIS_URL.split("@")[-1].split("/")[0]
                logger.info("CacheClient: connected to Redis at %s", host)
                return
            except Exception as exc:
                logger.warning("CacheClient: REDIS_URL failed (%s), trying localhost", exc)

        # 2. Try localhost Redis (local dev)
        try:
            client = redis.Redis(
                host="localhost", port=6379, db=0,
                socket_connect_timeout=1, decode_responses=True,
            )
            client.ping()
            self.backend = client
            self.using_redis = True
            logger.info("CacheClient: connected to Redis at localhost:6379")
            return
        except Exception:
            pass

        # 3. In-memory fallback
        self.backend = _MemoryBackend()
        logger.warning("CacheClient: no Redis available — using in-memory cache")

    @classmethod
    def instance(cls) -> "CacheClient":
        if cls._instance is None:
            cls._instance = CacheClient()
        return cls._instance

    # --- raw access ----------------------------------------------------------
    def _get(self, key: str) -> Optional[Any]:
        try:
            raw = self.backend.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            return None

    def _set(self, key: str, value: Any, ttl: int) -> None:
        try:
            self.backend.setex(key, ttl, json.dumps(value, default=str))
        except Exception as exc:  # pragma: no cover - never let caching break a request
            logger.debug("cache set failed for %s: %s", key, exc)

    # --- tiered helpers ------------------------------------------------------
    def key(self, tier: str, *parts: Any) -> str:
        if tier == "session":
            return f"oreon:session:{parts[0]}"
        if tier == "llm":
            return f"oreon:llm:{parts[0]}:{_hash(*parts[1:])}"
        if tier == "tool":
            return f"oreon:tool:{parts[0]}:{_hash(*parts[1:])}"
        return f"oreon:{tier}:{_hash(*parts)}"

    def get(self, tier: str, *parts: Any) -> Optional[Any]:
        return self._get(self.key(tier, *parts))

    def set(self, tier: str, value: Any, *parts: Any) -> None:
        self._set(self.key(tier, *parts), value, TTL.get(tier, 60))

    def get_or_set(self, tier: str, parts: tuple, producer: Callable[[], Any]) -> Any:
        """Return cached value for ``parts`` or compute via ``producer`` and cache it."""
        hit = self.get(tier, *parts)
        if hit is not None:
            return hit
        value = producer()
        if value is not None:
            self.set(tier, value, *parts)
        return value


def get_cache() -> CacheClient:
    return CacheClient.instance()
