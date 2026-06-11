import json
import logging
from typing import Any

from app.schemas.investigation import InvestigationReport, ReasoningNarrative
from app.services.base_reasoning_service import BaseReasoningService

logger = logging.getLogger(__name__)


class InvestigationReasoningService(BaseReasoningService):
    """Uses Gemini only to explain deterministic investigation outputs."""

    def explain(self, report: InvestigationReport, asset_context: dict[str, Any], plant_context: dict[str, Any]) -> ReasoningNarrative:
        """Always uses the live LLM. Failures propagate — no canned fallback text."""
        if not self.has_llm:
            raise RuntimeError("OPENROUTER_API_KEY is not configured — AI explanations require the live model.")
        prompt = self._build_prompt(report, asset_context, plant_context)
        parsed = self._generate_json(prompt)
        return ReasoningNarrative(**parsed)

    def _build_prompt(self, report: InvestigationReport, asset_context: dict[str, Any], plant_context: dict[str, Any]) -> str:
        payload = {
            "rules": [
                "You do not decide diagnosis, root cause, risk, confidence, or actions.",
                "Explain only the deterministic OREON report and evidence supplied below.",
                "Return valid JSON matching the requested keys.",
            ],
            "report": report.model_dump(mode="json", exclude={"llm_explanation"}),
            "asset_context": asset_context,
            "plant_context": plant_context,
        }
        return (
            "OREON is an industrial decision intelligence system, not a chatbot. "
            "Explain the supplied deterministic investigation for maintenance users. "
            "Return JSON with keys natural_language_explanation, manager_summary, "
            "engineer_summary, risk_explanation, maintenance_recommendation.\n\n"
            f"{json.dumps(payload, indent=2)}"
        )

    def _fallback_explanation(self, report: InvestigationReport) -> ReasoningNarrative:
        actions = "; ".join(report.recommended_actions[:3]) or "Continue investigation using plant procedures."
        return ReasoningNarrative(
            natural_language_explanation=(
                f"OREON identified {report.root_cause} on {report.asset_name} with "
                f"{report.confidence:.0%} confidence. The diagnosis is based on deterministic "
                "sensor, procedure, and historical incident evidence."
            ),
            manager_summary=(
                f"{report.asset_name} is at {report.risk_level} risk. Expected RUL is "
                f"{report.rul_days} days. Primary action: {report.recommended_actions[0] if report.recommended_actions else 'inspect asset'}."
            ),
            engineer_summary=(
                f"Diagnosis: {report.diagnosis} Evidence count: "
                f"{len(report.evidence.sensor_evidence)} sensor, {len(report.evidence.manual_evidence)} manual, "
                f"{len(report.evidence.sop_evidence)} SOP, {len(report.evidence.historical_evidence)} historical."
            ),
            risk_explanation=(
                f"Risk is {report.risk_level} because asset health, RUL, rule confidence, and threshold evidence "
                "were evaluated before narrative generation."
            ),
            maintenance_recommendation=actions,
        )
