from dataclasses import dataclass, field

from app.schemas.decision import PriorityData, PriorityInput


@dataclass(frozen=True)
class PriorityWeights:
    """Configurable deterministic weights for maintenance priority scoring."""

    failure_probability: float = 0.22
    health_score: float = 0.16
    rul_days: float = 0.14
    asset_criticality: float = 0.14
    historical_failure_frequency: float = 0.10
    safety_risk: float = 0.12
    spare_availability: float = 0.06
    procurement_lead_time: float = 0.03
    dependency_impact_score: float = 0.03
    criticality_scores: dict[str, float] = field(
        default_factory=lambda: {"low": 20.0, "medium": 45.0, "high": 70.0, "critical": 100.0}
    )


class PriorityEngine:
    """Deterministic and repeatable priority scoring engine. No LLM logic."""

    def __init__(self, weights: PriorityWeights | None = None) -> None:
        self.weights = weights or PriorityWeights()

    def calculate_priority(self, payload: PriorityInput) -> PriorityData:
        components = {
            "failure_probability": payload.failure_probability * 100,
            "health_score": 100 - payload.health_score,
            "rul_days": self._rul_score(payload.rul_days),
            "asset_criticality": self.weights.criticality_scores.get(payload.asset_criticality.lower(), 50.0),
            "historical_failure_frequency": min(100.0, payload.historical_failure_frequency * 16.0),
            "safety_risk": payload.safety_risk * 100,
            "spare_availability": (1 - payload.spare_availability) * 100,
            "procurement_lead_time": min(100.0, payload.procurement_lead_time * 2.5),
            "dependency_impact_score": payload.dependency_impact_score,
        }
        score = (
            components["failure_probability"] * self.weights.failure_probability
            + components["health_score"] * self.weights.health_score
            + components["rul_days"] * self.weights.rul_days
            + components["asset_criticality"] * self.weights.asset_criticality
            + components["historical_failure_frequency"] * self.weights.historical_failure_frequency
            + components["safety_risk"] * self.weights.safety_risk
            + components["spare_availability"] * self.weights.spare_availability
            + components["procurement_lead_time"] * self.weights.procurement_lead_time
            + components["dependency_impact_score"] * self.weights.dependency_impact_score
        )
        score = round(min(100.0, max(0.0, score)), 2)
        band = self._band(score)
        return PriorityData(
            priority_score=score,
            priority_band=band,
            priority_reason=self._reason(band, payload, components),
            score_components={key: round(value, 2) for key, value in components.items()},
        )

    def _rul_score(self, rul_days: int) -> float:
        if rul_days <= 3:
            return 100.0
        if rul_days <= 7:
            return 90.0
        if rul_days <= 14:
            return 80.0
        if rul_days <= 30:
            return 65.0
        if rul_days <= 90:
            return 35.0
        return 10.0

    def _band(self, score: float) -> str:
        if score >= 80:
            return "CRITICAL"
        if score >= 60:
            return "HIGH"
        if score >= 35:
            return "MEDIUM"
        return "LOW"

    def _reason(self, band: str, payload: PriorityInput, components: dict[str, float]) -> str:
        drivers = sorted(components.items(), key=lambda item: item[1], reverse=True)[:3]
        driver_text = ", ".join(f"{name.replace('_', ' ')}={round(value, 1)}" for name, value in drivers)
        return (
            f"{band} priority from deterministic weighted score. Top drivers: {driver_text}. "
            f"RUL={payload.rul_days} days, failure probability={payload.failure_probability:.0%}."
        )
