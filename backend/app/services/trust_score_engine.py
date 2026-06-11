"""
OREON Orchestrator — AI Trust Score Engine.

Computes a transparent trust score for every AI recommendation,
showing exactly what evidence supports the conclusion.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class TrustScoreEngine:
    """
    Generates an AI Trust Score (0-100%) for any recommendation.

    Score is composed of weighted signals:
    - Sensor confidence (data freshness + anomaly clarity)
    - Historical match strength (number + similarity)
    - SOP coverage (relevant procedures found)
    - Manual coverage (relevant documentation found)
    - Model confidence (RUL, RCA confidence values)
    - Recommendation consistency (past success rate)
    """

    WEIGHTS = {
        "sensor_confidence": 0.25,
        "historical_match": 0.20,
        "sop_coverage": 0.15,
        "manual_coverage": 0.10,
        "model_confidence": 0.20,
        "recommendation_consistency": 0.10,
    }

    def compute(
        self,
        evidence_chain: dict[str, Any],
        rca_confidence: float | None = None,
        rul_confidence: float | None = None,
        historical_matches: int = 0,
        sop_chunks: int = 0,
        manual_chunks: int = 0,
        past_success_rate: float | None = None,
    ) -> dict[str, Any]:
        """
        Compute trust score and per-dimension breakdown.

        Returns dict with:
        - trust_score: int (0-100)
        - dimensions: per-dimension scores and labels
        - reliability_label: High/Medium/Low
        - explanation: human-readable summary
        """
        dimensions: dict[str, dict[str, Any]] = {}

        # 1. Sensor confidence
        sensor_items = evidence_chain.get("source_coverage", {}).get("sensor", 0)
        sensor_score = min(100, sensor_items * 25)  # 4+ items = 100
        dimensions["sensor_confidence"] = {
            "score": sensor_score,
            "label": self._label(sensor_score),
            "detail": f"{sensor_items} sensor evidence items",
        }

        # 2. Historical match strength
        hist_score = min(100, historical_matches * 12)  # 8+ matches = ~100
        dimensions["historical_match"] = {
            "score": hist_score,
            "label": self._label(hist_score),
            "detail": f"{historical_matches} similar past incidents",
        }

        # 3. SOP coverage
        sop_score = min(100, sop_chunks * 25)  # 4+ chunks = 100
        dimensions["sop_coverage"] = {
            "score": sop_score,
            "label": self._label(sop_score),
            "detail": f"{sop_chunks} relevant SOP references",
        }

        # 4. Manual coverage
        manual_score = min(100, manual_chunks * 30)  # 3-4 chunks = 100
        dimensions["manual_coverage"] = {
            "score": manual_score,
            "label": self._label(manual_score),
            "detail": f"{manual_chunks} manual references",
        }

        # 5. Model confidence (average of RCA + RUL)
        model_scores = []
        if rca_confidence is not None:
            model_scores.append(rca_confidence * 100)
        if rul_confidence is not None:
            model_scores.append(rul_confidence * 100)
        model_score = sum(model_scores) / len(model_scores) if model_scores else 50
        dimensions["model_confidence"] = {
            "score": round(model_score),
            "label": self._label(model_score),
            "detail": f"RCA: {rca_confidence:.0%}" if rca_confidence else "No model data",
        }

        # 6. Recommendation consistency
        consistency_score = (past_success_rate or 0.65) * 100
        dimensions["recommendation_consistency"] = {
            "score": round(consistency_score),
            "label": self._label(consistency_score),
            "detail": f"Past success rate: {past_success_rate:.0%}" if past_success_rate else "Default baseline",
        }

        # Weighted composite
        trust_score = sum(
            dimensions[dim]["score"] * weight
            for dim, weight in self.WEIGHTS.items()
        )
        trust_score = round(min(100, max(0, trust_score)))

        reliability = (
            "High" if trust_score >= 75
            else "Medium" if trust_score >= 50
            else "Low"
        )

        # Build explanation
        strong = [d for d, v in dimensions.items() if v["score"] >= 75]
        weak = [d for d, v in dimensions.items() if v["score"] < 40]

        explanation_parts = []
        if strong:
            explanation_parts.append(f"Strong evidence from: {', '.join(self._humanize(s) for s in strong)}")
        if weak:
            explanation_parts.append(f"Limited evidence for: {', '.join(self._humanize(w) for w in weak)}")

        return {
            "trust_score": trust_score,
            "reliability": reliability,
            "dimensions": dimensions,
            "explanation": ". ".join(explanation_parts) if explanation_parts else "Moderate evidence across all dimensions.",
        }

    @staticmethod
    def _label(score: float) -> str:
        if score >= 75:
            return "Strong"
        if score >= 50:
            return "Moderate"
        if score >= 25:
            return "Weak"
        return "Insufficient"

    @staticmethod
    def _humanize(dim_key: str) -> str:
        return dim_key.replace("_", " ").title()
