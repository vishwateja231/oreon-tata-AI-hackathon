"""Intelligent LLM model routing and cache integration for OREON.

Routes simple lookups to a fast model (Nemotron Super) and complex reasoning
to the larger model (Nemotron Ultra), using the ComplexityClassifier.
Handles API requests to OpenRouter and manages the cache layer.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Generator, Optional
from app.services.complexity_classifier import ComplexityClassifier
from app.utils.redis_cache import get_cache

logger = logging.getLogger(__name__)

# Module-level Groq client singleton — created once, reused for every request
# (avoids per-call client construction / connection setup).
_GROQ_CLIENT = None


def get_groq_client(api_key: str):
    """Return the process-wide Groq client, creating it on first use."""
    global _GROQ_CLIENT
    if _GROQ_CLIENT is None:
        from groq import Groq
        _GROQ_CLIENT = Groq(api_key=api_key)
    return _GROQ_CLIENT


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

def score_complexity(query: str) -> str:
    """Classify the query into 'simple' or 'complex' using the ComplexityClassifier."""
    return ComplexityClassifier.classify(query)

def pick_model(settings, complexity: Optional[str] = None, query: Optional[str] = None) -> str:
    """Select the OpenRouter model id for a request based on complexity or raw query."""
    if complexity is None:
        complexity = score_complexity(query or "")
    if complexity == "complex":
        return settings.OPENROUTER_REASONING_MODEL or settings.OPENROUTER_MODEL
    return settings.OPENROUTER_FAST_MODEL or settings.OPENROUTER_MODEL

def complete_json(settings, prompt: str, model: str, timeout: int = 90, max_tokens: Optional[int] = None) -> dict:
    """Call OpenRouter chat completions and parse the first JSON object from the reply.

    Caches the results to the 'llm' cache tier for 12 hours.
    """
    import requests
    import time

    cache = get_cache()
    cached = cache.get("llm", model, prompt)
    if cached is not None:
        logger.info("llm cache hit model=%s", model)
        return cached

    # Groq direct path — much lower latency than OpenRouter.
    if getattr(settings, "LLM_PROVIDER", "openrouter") == "groq" and settings.GROQ_API_KEY:
        client = get_groq_client(settings.GROQ_API_KEY)
        # Ask Groq for a guaranteed JSON object via response_format, then parse
        # leniently. Retry once on a parse miss (Groq is ~2s, so this is cheap and
        # is a real re-query of the model, not a canned fallback).
        last_exc = None
        for attempt in range(3):
            kwargs = dict(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2 if attempt == 0 else 0.0,
                max_completion_tokens=max_tokens or 1100,
            )
            if attempt == 0:
                kwargs["response_format"] = {"type": "json_object"}
            try:
                completion = client.chat.completions.create(**kwargs)
                content = completion.choices[0].message.content or ""
                parsed = parse_json_lenient(content)
                cache.set("llm", parsed, model, prompt)
                return parsed
            except Exception as exc:
                last_exc = exc
                # Back off on Groq free-tier rate limits (429) before retrying.
                if "429" in str(exc) or "rate" in str(exc).lower():
                    time.sleep(1.5 * (attempt + 1))
                logger.warning("Groq attempt %d failed: %s", attempt + 1, exc)
        raise last_exc

    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
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

            # Lenient parse — tolerates markdown-with-newlines inside JSON strings.
            parsed = parse_json_lenient(content)

            # Cache the result for subsequent calls
            cache.set("llm", parsed, model, prompt)

            return parsed
        except Exception as e:
            import requests.exceptions
            if isinstance(e, requests.exceptions.Timeout):
                logger.warning(f"OpenRouter attempt {attempt + 1} timed out ({timeout}s). Skipping further retries.")
                raise
            if attempt < max_retries:
                logger.warning(f"OpenRouter attempt {attempt + 1} failed: {e}. Retrying...")
                time.sleep(1)
            else:
                raise


def stream_chat(settings, prompt: str, model: str, timeout: int = 90) -> Generator[str, None, None]:
    """Stream response tokens. Uses Groq when configured (fast), else OpenRouter."""
    import requests

    # Groq direct streaming path — retry the whole stream on rate-limit.
    if getattr(settings, "LLM_PROVIDER", "openrouter") == "groq" and settings.GROQ_API_KEY:
        client = get_groq_client(settings.GROQ_API_KEY)
        for attempt in range(3):
            try:
                stream = client.chat.completions.create(
                    model=settings.GROQ_MODEL,
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
                if ("429" in str(exc) or "rate" in str(exc).lower()) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                logger.error("Groq streaming failed: %s", exc)
                raise RuntimeError(f"Groq streaming failed: {exc}") from exc
        # All 3 rate-limit retries exhausted
        raise RuntimeError("Groq streaming rate-limited after 3 attempts")

    body = {
        "model": model,
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
    except Exception as exc:
        logger.error(f"Error streaming from OpenRouter: {exc}")
        raise RuntimeError(f"OpenRouter streaming failed: {exc}") from exc
