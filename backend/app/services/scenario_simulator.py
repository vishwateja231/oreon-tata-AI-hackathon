from sqlalchemy.orm import Session

from app.schemas.decision import ScenarioAnalysisData
from app.services.asset_service import AssetService
from app.services.business_impact_engine import BusinessImpactEngine
from app.services.plant_impact_engine import PlantImpactEngine


class ScenarioSimulator:
    """Simulates the deterministic impact of delaying maintenance."""

    def __init__(self, db: Session) -> None:
        self.asset_service = AssetService(db)
        self.impact_engine = PlantImpactEngine(db)
        self.business_engine = BusinessImpactEngine()

    def simulate(self, asset_id: str, delay_days: int) -> ScenarioAnalysisData:
        asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")

        plant_impact = self.impact_engine.analyze_impact(asset_id)
        business_impact = self.business_engine.analyze(plant_impact)
        degradation_factor = self._degradation_factor(asset.failure_probability, asset.criticality.value)
        future_health = round(max(0.0, asset.health_score - delay_days * degradation_factor), 2)
        future_failure = round(min(1.0, asset.failure_probability + delay_days * self._failure_growth(asset.rul_days)), 4)
        risk_change = future_failure - asset.failure_probability
        return ScenarioAnalysisData(
            current_health=asset.health_score,
            future_health=future_health,
            current_failure_probability=asset.failure_probability,
            future_failure_probability=future_failure,
            failure_risk_change=f"+{risk_change:.1%}" if risk_change >= 0 else f"{risk_change:.1%}",
            affected_assets=plant_impact.affected_assets,
            production_impact=business_impact.production_loss_estimate,
            recommendation=self._recommendation(delay_days, asset.rul_days, future_failure, plant_impact.impact_score),
            delay_days=delay_days,
        )

    def _degradation_factor(self, failure_probability: float, criticality: str) -> float:
        criticality_multiplier = {"low": 0.4, "medium": 0.7, "high": 1.0, "critical": 1.35}.get(criticality, 0.8)
        return round((0.55 + failure_probability * 1.8) * criticality_multiplier, 3)

    def _failure_growth(self, rul_days: int) -> float:
        if rul_days <= 7:
            return 0.045
        if rul_days <= 14:
            return 0.032
        if rul_days <= 30:
            return 0.018
        return 0.008

    def _recommendation(self, delay_days: int, rul_days: int, future_failure: float, impact_score: float) -> str:
        if delay_days >= rul_days or future_failure >= 0.85 or impact_score >= 80:
            return "Do not delay; execute maintenance immediately or prepare controlled shutdown."
        if delay_days >= 14 or future_failure >= 0.65:
            return "Delay is high risk; schedule intervention within the next available maintenance window."
        if delay_days >= 7:
            return "Delay is acceptable only with enhanced monitoring and spare confirmation."
        return "Short delay is acceptable with daily sensor review and operator inspection."

    # ------------------------------------------------------------------
    # ENHANCED DECISION INTELLIGENCE SCENARIOS
    # ------------------------------------------------------------------

    def simulate_load_increase(self, asset_id: str, load_increase_pct: float) -> dict:
        """What if load increases by X%? Models accelerated degradation."""
        asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")

        # Load increase accelerates degradation proportionally
        stress_factor = 1.0 + (load_increase_pct / 100.0) * 1.5
        rul_reduction = int(asset.rul_days * (1 - 1 / stress_factor))
        new_rul = max(1, asset.rul_days - rul_reduction)
        new_failure_prob = min(1.0, asset.failure_probability * stress_factor)
        health_drop = min(asset.health_score, load_increase_pct * 0.8)
        new_health = round(asset.health_score - health_drop, 1)

        plant_impact = self.impact_engine.analyze_impact(asset_id)
        business_impact = self.business_engine.analyze(plant_impact)

        return {
            "scenario": f"Load increase +{load_increase_pct}%",
            "current_rul_days": asset.rul_days,
            "projected_rul_days": new_rul,
            "rul_reduction_days": rul_reduction,
            "current_failure_probability": asset.failure_probability,
            "projected_failure_probability": round(new_failure_prob, 4),
            "health_score_drop": round(health_drop, 1),
            "projected_health": new_health,
            "downtime_forecast_hours": round(plant_impact.estimated_downtime_hours * stress_factor, 1),
            "revenue_impact_inr": round((business_impact.cost_of_inaction_inr or 0) * stress_factor),
            "production_loss": business_impact.production_loss_estimate,
            "risk_escalation": "CRITICAL" if new_failure_prob >= 0.8 else "HIGH" if new_failure_prob >= 0.6 else "MEDIUM",
            "recommendation": (
                "Reduce load immediately; asset cannot sustain increased demand safely."
                if new_failure_prob >= 0.8
                else "Monitor closely; prepare contingency maintenance plan."
                if new_failure_prob >= 0.6
                else "Load increase is within tolerance with enhanced monitoring."
            ),
        }

    def simulate_spare_unavailable(self, asset_id: str) -> dict:
        """What if required spare is unavailable? Models extended downtime."""
        asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")

        plant_impact = self.impact_engine.analyze_impact(asset_id)
        business_impact = self.business_engine.analyze(plant_impact)

        # Unavailable spare means emergency procurement (2-4x lead time)
        base_lead_time = 14  # days default
        emergency_lead_time = base_lead_time * 3
        extended_downtime = plant_impact.estimated_downtime_hours + (emergency_lead_time * 8)
        extended_cost = (business_impact.cost_of_inaction_inr or 500000) * 2.5

        return {
            "scenario": "Critical spare unavailable",
            "base_repair_time_hours": plant_impact.estimated_downtime_hours,
            "extended_downtime_hours": round(extended_downtime, 1),
            "emergency_procurement_days": emergency_lead_time,
            "current_cost_inr": round(business_impact.cost_of_inaction_inr or 500000),
            "extended_cost_inr": round(extended_cost),
            "production_loss_tonnes": round(extended_downtime * 55, 0),  # avg line rate
            "risk_escalation": "CRITICAL",
            "recommendation": (
                "Initiate emergency procurement immediately. "
                "Explore temporary workaround or alternate supplier. "
                "Escalate to procurement officer and plant manager."
            ),
        }

    def simulate_continued_degradation(self, asset_id: str, days_forward: int = 30) -> dict:
        """What if current degradation trend continues? Projects future state."""
        asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")

        plant_impact = self.impact_engine.analyze_impact(asset_id)
        business_impact = self.business_engine.analyze(plant_impact)

        degradation_rate = self._degradation_factor(asset.failure_probability, asset.criticality.value)
        failure_growth = self._failure_growth(asset.rul_days)

        # Project day-by-day
        projections = []
        for day in [7, 14, 21, 30]:
            if day > days_forward:
                break
            proj_health = round(max(0, asset.health_score - day * degradation_rate), 1)
            proj_failure = round(min(1.0, asset.failure_probability + day * failure_growth), 4)
            proj_rul = max(0, asset.rul_days - day)
            projections.append({
                "day": day,
                "health_score": proj_health,
                "failure_probability": proj_failure,
                "rul_days": proj_rul,
                "risk_level": "CRITICAL" if proj_failure >= 0.8 else "HIGH" if proj_failure >= 0.6 else "MEDIUM",
            })

        # Final state
        final_health = round(max(0, asset.health_score - days_forward * degradation_rate), 1)
        final_failure = round(min(1.0, asset.failure_probability + days_forward * failure_growth), 4)

        return {
            "scenario": f"Continued degradation for {days_forward} days",
            "current_state": {
                "health_score": asset.health_score,
                "failure_probability": asset.failure_probability,
                "rul_days": asset.rul_days,
            },
            "projected_state": {
                "health_score": final_health,
                "failure_probability": final_failure,
                "rul_days": max(0, asset.rul_days - days_forward),
            },
            "projections": projections,
            "days_to_critical": next(
                (p["day"] for p in projections if p["failure_probability"] >= 0.8), None
            ),
            "revenue_at_risk_inr": round((business_impact.cost_of_inaction_inr or 500000) * (1 + final_failure)),
            "recommendation": (
                f"Asset will reach critical state within {days_forward} days. "
                "Immediate maintenance intervention required."
                if final_failure >= 0.8
                else "Schedule preventive maintenance before degradation reaches critical threshold."
            ),
        }
