"""Intelligent LLM model routing and cache integration for OREON.

Routes simple lookups to a fast model (Nemotron Super) and complex reasoning
to the larger model (Nemotron Ultra), using the ComplexityClassifier.
Handles API requests to OpenRouter and manages the cache layer.

Failover chain:  Groq  →  DeepSeek (flash only)  →  OpenRouter
Fatal errors (auth 401/403, rate-limit 429, quota exhausted) are detected
immediately and skip remaining retries to avoid wasting time & tokens.
Prompts are truncated to MAX_PROMPT_CHARS to prevent token-abuse attacks.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Generator, Optional
from app.services.complexity_classifier import ComplexityClassifier
from app.utils.redis_cache import get_cache

logger = logging.getLogger(__name__)

# ── Provider client singletons ────────────────────────────────────────────────
_GROQ_CLIENT = None
_DEEPSEEK_CLIENT = None

# The ONLY DeepSeek model we ever use — hard-coded, never overridden.
_DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash"

# Maximum prompt length in characters (~4000 tokens). Any input beyond this is
# truncated before it reaches the LLM, preventing abuse via huge context dumps.
MAX_PROMPT_CHARS = 16_000


def get_groq_client(api_key: str):
    """Return the process-wide Groq client, creating it on first use."""
    global _GROQ_CLIENT
    if _GROQ_CLIENT is None:
        from groq import Groq
        _GROQ_CLIENT = Groq(api_key=api_key)
    return _GROQ_CLIENT


def get_deepseek_client(api_key: str):
    """Return the process-wide DeepSeek client, creating it on first use."""
    global _DEEPSEEK_CLIENT
    if _DEEPSEEK_CLIENT is None:
        from openai import OpenAI
        _DEEPSEEK_CLIENT = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    return _DEEPSEEK_CLIENT


# ── Fatal error detection (auth + rate-limit) ────────────────────────────────

_FATAL_KEYWORDS = (
    # Auth errors
    "401", "403", "invalid_api_key", "invalid api key",
    "authentication", "unauthorized", "forbidden",
    "api key", "apikey", "incorrect api key",
    # Rate-limit / quota errors — retrying is pointless
    "429", "rate_limit", "rate limit", "quota", "too many requests",
    "tokens per day", "tokens per minute",
)


def is_fatal_provider_error(exc: Exception) -> bool:
    """Return True when *exc* is an auth or rate-limit error.

    These errors will NOT recover on retry (bad key, daily quota exhausted,
    per-minute cap). The router should immediately fall to the next provider.
    """
    msg = str(exc).lower()
    return any(kw in msg for kw in _FATAL_KEYWORDS)


# Backward compat alias used by tests
is_auth_error = is_fatal_provider_error


def _guard_prompt(prompt: str) -> str:
    """Truncate over-long prompts to prevent token-abuse attacks."""
    if len(prompt) > MAX_PROMPT_CHARS:
        logger.warning("Prompt truncated from %d to %d chars", len(prompt), MAX_PROMPT_CHARS)
        return prompt[:MAX_PROMPT_CHARS] + "\n[... truncated for safety ...]"
    return prompt


# ── JSON parsing ──────────────────────────────────────────────────────────────

def parse_json_lenient(text: str) -> dict:
    """Extract the first JSON object from an LLM reply, tolerating markdown.

    Models routinely emit Markdown (### headings, bullet lists) INSIDE JSON
    string values with literal newlines/tabs — which is invalid JSON and makes
    ``json.loads`` throw. This escapes raw control chars that sit inside
    double-quoted strings, then parses. This is the single most important fix
    for chat reliability: without it, any well-formatted answer silently fails
    to parse and the user gets a degraded/error response.
    """
    c = text.strip()
    if c.startswith("```json"):
        c = c[7:]
    elif c.startswith("```"):
        c = c[3:]
    if c.endswith("```"):
        c = c[:-3]
    c = c.strip()
    start, end = c.find("{"), c.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("response did not contain JSON")
    raw = c[start : end + 1]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        out, in_str, esc = [], False, False
        for ch in raw:
            if esc:
                out.append(ch)
                esc = False
                continue
            if ch == "\\":
                out.append(ch)
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                out.append(ch)
                continue
            if in_str and ch == "\n":
                out.append("\\n")
                continue
            if in_str and ch == "\r":
                continue
            if in_str and ch == "\t":
                out.append("\\t")
                continue
            out.append(ch)
        return json.loads("".join(out))


# ── Complexity routing ────────────────────────────────────────────────────────

def score_complexity(query: str) -> str:
    """Classify the query into 'simple' or 'complex' using the ComplexityClassifier."""
    return ComplexityClassifier.classify(query)

def pick_model(settings, complexity: Optional[str] = None, query: Optional[str] = None) -> str:
    """Select the model id for a request based on complexity or raw query."""
    provider = getattr(settings, "LLM_PROVIDER", "openrouter")
    if provider == "deepseek":
        # Always deepseek-v4-flash, regardless of complexity.
        return _DEEPSEEK_FLASH_MODEL
    if complexity is None:
        complexity = score_complexity(query or "")
    if complexity == "complex":
        return settings.OPENROUTER_REASONING_MODEL or settings.OPENROUTER_MODEL
    return settings.OPENROUTER_FAST_MODEL or settings.OPENROUTER_MODEL


# ── Failover provider chain ──────────────────────────────────────────────────

def _build_provider_chain(settings) -> list[str]:
    """Build the ordered list of providers to attempt."""
    provider = getattr(settings, "LLM_PROVIDER", "openrouter")
    if provider == "groq":
        return ["groq", "deepseek", "openrouter"]
    if provider == "deepseek":
        return ["deepseek", "openrouter"]
    return ["openrouter"]


def complete_json(settings, prompt: str, model: str, timeout: int = 90, max_tokens: Optional[int] = None) -> dict:
    """Call LLM provider chat completions and parse the first JSON object from the reply.

    Caches the results to the 'llm' cache tier for 12 hours.
    Failover: Groq → DeepSeek (flash) → OpenRouter.
    Fatal errors (auth / rate-limit) skip remaining retries immediately.
    """
    import requests

    prompt = _guard_prompt(prompt)

    cache = get_cache()
    cached = cache.get("llm", model, prompt)
    if cached is not None:
        logger.info("llm cache hit model=%s", model)
        return cached

    last_exc = None

    for current_prov in _build_provider_chain(settings):
        logger.warning("Attempting LLM provider: %s", current_prov)

        # ── Groq ──────────────────────────────────────────────────────────
        if current_prov == "groq":
            if not getattr(settings, "GROQ_API_KEY", None):
                continue
            client = get_groq_client(settings.GROQ_API_KEY)
            for attempt in range(3):
                kwargs = dict(
                    model=getattr(settings, "GROQ_MODEL", "llama-3.3-70b-versatile"),
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_completion_tokens=max_tokens or 1100,
                )
                if attempt == 0:
                    kwargs["response_format"] = {"type": "json_object"}
                try:
                    completion = client.chat.completions.create(**kwargs)
                    content = completion.choices[0].message.content or ""
                    logger.info("Successfully received response from Groq model: %s", completion.model)
                    parsed = parse_json_lenient(content)
                    cache.set("llm", parsed, model, prompt)
                    return parsed
                except Exception as exc:
                    last_exc = exc
                    logger.warning("Groq attempt %d failed: %s", attempt + 1, exc)
                    if is_fatal_provider_error(exc):
                        logger.warning("Groq fatal error (auth/rate-limit) — skipping remaining retries")
                        break
            logger.warning("Groq failed all attempts, moving to next provider...")

        # ── DeepSeek (always flash) ───────────────────────────────────────
        elif current_prov == "deepseek":
            if not getattr(settings, "DEEPSEEK_API_KEY", None):
                continue
            client = get_deepseek_client(settings.DEEPSEEK_API_KEY)
            for attempt in range(3):
                try:
                    completion = client.chat.completions.create(
                        model=_DEEPSEEK_FLASH_MODEL,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.2 if attempt == 0 else 0.0,
                        response_format={"type": "json_object"},
                        max_tokens=max_tokens or 1100,
                        timeout=timeout,
                    )
                    content = completion.choices[0].message.content or ""
                    logger.info("Successfully received response from DeepSeek model: %s", completion.model)
                    parsed = parse_json_lenient(content)
                    cache.set("llm", parsed, model, prompt)
                    return parsed
                except Exception as exc:
                    last_exc = exc
                    logger.warning("DeepSeek attempt %d failed: %s", attempt + 1, exc)
                    if is_fatal_provider_error(exc):
                        logger.warning("DeepSeek fatal error (auth/rate-limit) — skipping remaining retries")
                        break
            logger.warning("DeepSeek failed all attempts, moving to next provider...")

        # ── OpenRouter ────────────────────────────────────────────────────
        elif current_prov == "openrouter":
            if not getattr(settings, "OPENROUTER_API_KEY", None):
                continue
            openrouter_model = model
            if "versatile" in openrouter_model or "groq" in openrouter_model or openrouter_model == getattr(settings, "GROQ_MODEL", ""):
                openrouter_model = getattr(settings, "OPENROUTER_MODEL", "openai/gpt-4o-mini")

            body = {
                "model": openrouter_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            }
            if max_tokens:
                body["max_tokens"] = max_tokens

            max_retries = 2
            for attempt in range(max_retries + 1):
                try:
                    response = requests.post(
                        url="https://openrouter.ai/api/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                        timeout=timeout,
                    )
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"].get("content", "") or ""
                    parsed = parse_json_lenient(content)
                    cache.set("llm", parsed, model, prompt)
                    return parsed
                except Exception as e:
                    last_exc = e
                    logger.warning("OpenRouter attempt %d failed: %s", attempt + 1, e)
                    if is_fatal_provider_error(e):
                        logger.warning("OpenRouter fatal error — skipping remaining retries")
                        break
                    import requests.exceptions
                    if isinstance(e, requests.exceptions.Timeout):
                        logger.warning("OpenRouter timed out (%ds). Skipping further retries.", timeout)
                        break
                    if attempt < max_retries:
                        time.sleep(1)
                    else:
                        logger.warning("OpenRouter failed all attempts.")

    # All providers exhausted
    if last_exc:
        raise last_exc
    raise RuntimeError("No LLM provider was configured or succeeded.")


def stream_chat(settings, prompt: str, model: str, timeout: int = 90) -> Generator[str, None, None]:
    """Stream response tokens. Uses Groq when configured (fast), else OpenRouter.
    Failover: Groq → DeepSeek (flash) → OpenRouter.
    Fatal errors (auth / rate-limit) skip remaining retries immediately.
    """
    import requests

    prompt = _guard_prompt(prompt)
    last_exc = None

    for current_prov in _build_provider_chain(settings):
        # ── Groq ──────────────────────────────────────────────────────────
        if current_prov == "groq":
            if not getattr(settings, "GROQ_API_KEY", None):
                continue
            client = get_groq_client(settings.GROQ_API_KEY)
            for attempt in range(3):
                try:
                    stream = client.chat.completions.create(
                        model=getattr(settings, "GROQ_MODEL", "llama-3.3-70b-versatile"),
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.2,
                        max_completion_tokens=1100,
                        stream=True,
                    )
                    for chunk in stream:
                        tok = chunk.choices[0].delta.content
                        if tok:
                            yield tok
                    return
                except Exception as exc:
                    last_exc = exc
                    logger.error("Groq streaming attempt %d failed: %s", attempt + 1, exc)
                    if is_fatal_provider_error(exc):
                        logger.warning("Groq fatal error — skipping remaining retries")
                        break
            logger.warning("Groq streaming failed all attempts, moving to next provider...")

        # ── DeepSeek (always flash) ───────────────────────────────────────
        elif current_prov == "deepseek":
            if not getattr(settings, "DEEPSEEK_API_KEY", None):
                continue
            client = get_deepseek_client(settings.DEEPSEEK_API_KEY)
            for attempt in range(3):
                try:
                    stream = client.chat.completions.create(
                        model=_DEEPSEEK_FLASH_MODEL,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.2,
                        max_tokens=700,
                        stream=True,
                        timeout=timeout,
                    )
                    for chunk in stream:
                        tok = chunk.choices[0].delta.content
                        if tok:
                            yield tok
                    return
                except Exception as exc:
                    last_exc = exc
                    logger.error("DeepSeek streaming attempt %d failed: %s", attempt + 1, exc)
                    if is_fatal_provider_error(exc):
                        logger.warning("DeepSeek fatal error — skipping remaining retries")
                        break
            logger.warning("DeepSeek streaming failed all attempts, moving to next provider...")

        # ── OpenRouter ────────────────────────────────────────────────────
        elif current_prov == "openrouter":
            if not getattr(settings, "OPENROUTER_API_KEY", None):
                continue
            openrouter_model = model
            if "versatile" in openrouter_model or "groq" in openrouter_model or openrouter_model == getattr(settings, "GROQ_MODEL", ""):
                openrouter_model = getattr(settings, "OPENROUTER_MODEL", "openai/gpt-4o-mini")

            body = {
                "model": openrouter_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "stream": True,
                "max_tokens": 700,
                "frequency_penalty": 0.6,
                "presence_penalty": 0.3,
            }

            try:
                response = requests.post(
                    url="https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    stream=True,
                    timeout=timeout,
                )
                response.raise_for_status()

                for line in response.iter_lines():
                    if line:
                        line_str = line.decode("utf-8").strip()
                        if line_str.startswith("data: "):
                            data_str = line_str[6:]
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk["choices"][0]["delta"]
                                if "content" in delta:
                                    yield delta["content"]
                            except Exception:
                                pass
                return
            except Exception as exc:
                last_exc = exc
                logger.error("Error streaming from OpenRouter: %s", exc)

    if last_exc:
        raise last_exc
    raise RuntimeError("No LLM provider was configured or succeeded for streaming.")
