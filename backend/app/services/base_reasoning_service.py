import json
import logging

from app.config.settings import get_settings

logger = logging.getLogger(__name__)


class BaseReasoningService:
    """Shared Gemini plumbing for the deterministic-explanation reasoning services.

    Holds the common settings/model setup, the single LLM call, and JSON parsing.
    Subclasses build their own prompt and deterministic fallback — the LLM only ever
    *explains* OREON's deterministic outputs, it does not decide anything.
    """

    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def has_llm(self) -> bool:
        return bool(self.settings.OPENROUTER_API_KEY)

    def _generate_json(self, prompt: str) -> dict:
        """Explain a deterministic OREON report via the reasoning-tier model.

        Investigation/decision narration is analytical, so it routes to the reasoning
        model. Routing + the HTTP call live in ``llm_router`` (single OpenRouter client).
        """
        from app.services.llm_router import complete_json, pick_model

        model = pick_model(self.settings, complexity="complex")
        return complete_json(self.settings, prompt, model=model, timeout=12)

    @staticmethod
    def _parse_json(text: str) -> dict:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("OpenRouter response did not contain JSON")
        return json.loads(text[start : end + 1])
