import json
import logging

from app.schemas.decision import DecisionExplanation, DecisionReport
from app.services.base_reasoning_service import BaseReasoningService

logger = logging.getLogger(__name__)


class DecisionReasoningService(BaseReasoningService):
    """Uses Gemini only to explain deterministic decision reports."""

    def explain(self, report: DecisionReport) -> DecisionExplanation:
        """Always uses the live LLM. Failures propagate — no canned fallback text."""
        if not self.has_llm:
            raise RuntimeError("OPENROUTER_API_KEY is not configured — AI explanations require the live model.")
        payload = self._generate_json(self._prompt(report))
        return DecisionExplanation(**payload)

    def _prompt(self, report: DecisionReport) -> str:
        payload = report.model_dump(mode="json", exclude={"explanation"})
        return (
            "OREON decision engines already made all decisions. Gemini must only explain. "
            "Return valid JSON with engineer_summary, supervisor_summary, executive_summary. "
            "Do not change priority, risk, schedules, or recommendations.\n\n"
            f"{json.dumps(payload, indent=2)}"
        )

    def _fallback(self, report: DecisionReport) -> DecisionExplanation:
        return DecisionExplanation(
            engineer_summary=(
                f"{report.investigation.asset_name}: {report.investigation.root_cause}. "
                f"Priority {report.priority.priority_band} ({report.priority.priority_score}/100). "
                f"Execute: {report.maintenance_plan.immediate_actions[:2]}."
            ),
            supervisor_summary=(
                f"Schedule maintenance for {report.asset_id} in the "
                f"{report.maintenance_plan.maintenance_schedule[0]['window']} window. "
                f"Procurement risk is {report.procurement.procurement_risk}."
            ),
            executive_summary=report.executive_summary,
        )
