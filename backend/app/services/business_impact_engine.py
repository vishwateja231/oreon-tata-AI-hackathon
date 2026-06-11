from app.schemas.decision import BusinessImpactData, PlantImpactData


class BusinessImpactEngine:
    """Converts technical plant impact into production and executive language."""

    LINE_TONNES_PER_HOUR = {
        "PL-1": 110.0,
        "PL-2": 75.0,
        "PL-3": 55.0,
        "unknown": 40.0,
    }

    COST_PER_TONNE_INR = 45_000  # ₹45k per tonne
    HOURLY_OPERATING_COST_INR = {
        "PL-1": 350_000,
        "PL-2": 200_000,
        "PL-3": 150_000,
        "unknown": 100_000,
    }

    def analyze(self, plant_impact: PlantImpactData) -> BusinessImpactData:
        rate = self.LINE_TONNES_PER_HOUR.get(plant_impact.production_line, self.LINE_TONNES_PER_HOUR["unknown"])
        downtime_hours = plant_impact.estimated_downtime_hours
        tonnes_lost = round(rate * downtime_hours, 1)
        risk = self._business_risk(plant_impact)

        # --- Explicit business-outcome cost breakdown (all ₹ INR) ---
        # 1. Production loss = lost tonnes valued at margin per tonne.
        production_loss = tonnes_lost * self.COST_PER_TONNE_INR
        revenue_exposure = production_loss
        # 2. Downtime cost = fixed operating burn while the line is down.
        hourly_op_cost = self.HOURLY_OPERATING_COST_INR.get(
            plant_impact.production_line, self.HOURLY_OPERATING_COST_INR["unknown"]
        )
        downtime_cost = downtime_hours * hourly_op_cost
        # 3. Reactive repair after failure (scales with blast radius / severity).
        repair_cost = 75_000 + (plant_impact.impact_score * 2_500)
        # 4. Planned/preventive maintenance done now (much cheaper than reactive).
        maintenance_cost = 50_000 + (plant_impact.impact_score * 3_000)

        # Cost of inaction = let it fail: lost production + downtime burn + reactive repair.
        cost_of_inaction = production_loss + downtime_cost + repair_cost
        # Cost of action = fix it now under control: planned maintenance only.
        cost_of_action = maintenance_cost
        # 5. Cost of delay = money put at risk by deferring the intervention.
        cost_of_delay = max(0.0, cost_of_inaction - cost_of_action)
        # 6. Cost avoided = the proactive-maintenance saving (the core OREON value pitch).
        cost_avoided = max(0.0, cost_of_inaction - cost_of_action)

        impact_level = (
            "CATASTROPHIC" if risk == "CRITICAL"
            else "SEVERE" if risk == "HIGH"
            else "MODERATE" if risk == "MEDIUM"
            else "LOW"
        )
        business_impact_score = self._business_impact_score(
            plant_impact.impact_score, downtime_hours, revenue_exposure
        )

        estimate = f"{tonnes_lost} tons production loss over {downtime_hours} hours"

        return BusinessImpactData(
            production_loss_estimate=estimate,
            downtime_hours=downtime_hours,
            business_risk=risk,
            cost_of_inaction_inr=round(cost_of_inaction, 2),
            cost_of_action_inr=round(cost_of_action, 2),
            revenue_exposure_inr=round(revenue_exposure, 2),
            impact_level=impact_level,
            downtime_cost_inr=round(downtime_cost, 2),
            production_loss_inr=round(production_loss, 2),
            repair_cost_inr=round(repair_cost, 2),
            maintenance_cost_inr=round(maintenance_cost, 2),
            cost_of_delay_inr=round(cost_of_delay, 2),
            cost_avoided_inr=round(cost_avoided, 2),
            business_impact_score=business_impact_score,
            executive_summary=(
                f"{plant_impact.production_line} faces {risk.lower()} business risk ({impact_level.lower()} impact). "
                f"{len(plant_impact.affected_assets)} downstream assets are affected. "
                f"Revenue exposure ₹{revenue_exposure:,.0f}; acting now costs ₹{cost_of_action:,.0f} "
                f"and avoids ₹{cost_avoided:,.0f} (business impact score {business_impact_score}/100)."
            ),
        )

    def _business_impact_score(
        self, impact_score: float, downtime_hours: float, revenue_exposure: float
    ) -> float:
        """Composite 0-100 score translating engineering severity into business priority.

        Weighted blend of plant blast-radius (impact_score), downtime magnitude
        (normalised over a 24h reference), and revenue exposure (normalised over ₹1 crore).
        """
        downtime_norm = min(100.0, (downtime_hours / 24.0) * 100.0)
        revenue_norm = min(100.0, (revenue_exposure / 10_000_000.0) * 100.0)
        score = 0.5 * impact_score + 0.3 * downtime_norm + 0.2 * revenue_norm
        return round(min(100.0, max(0.0, score)), 1)


    def _business_risk(self, plant_impact: PlantImpactData) -> str:
        if plant_impact.impact_score >= 80 or plant_impact.estimated_downtime_hours >= 16:
            return "CRITICAL"
        if plant_impact.impact_score >= 60 or plant_impact.estimated_downtime_hours >= 10:
            return "HIGH"
        if plant_impact.impact_score >= 35:
            return "MEDIUM"
        return "LOW"
