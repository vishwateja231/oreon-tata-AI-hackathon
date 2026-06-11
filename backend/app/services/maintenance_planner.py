from app.schemas.decision import MaintenancePlanData, PlantImpactData, PriorityData, ProcurementData
from app.schemas.investigation import InvestigationReport


class MaintenancePlanner:
    """Builds executable maintenance plans from investigation and decision outputs."""

    def build_plan(
        self,
        investigation: InvestigationReport,
        priority: PriorityData,
        plant_impact: PlantImpactData,
        procurement: ProcurementData,
    ) -> MaintenancePlanData:
        immediate = []
        next_24 = []
        next_7 = []
        long_term = []

        if priority.priority_band in {"CRITICAL", "HIGH"}:
            immediate.append("Notify maintenance supervisor, production planner, and control room.")
            immediate.append("Prepare controlled shutdown or load reduction window.")
        if procurement.procurement_risk in {"CRITICAL", "HIGH"}:
            immediate.append("Escalate missing or long-lead spare parts to procurement.")

        immediate.extend(investigation.recommended_actions[:3])
        next_24.extend(
            [
                "Verify sensor readings with handheld instruments.",
                "Create or update work order with OREON evidence bundle.",
                "Reserve available spare parts and confirm storage location.",
            ]
        )
        if plant_impact.critical_assets_impacted:
            next_24.append("Brief affected production line owners on downstream critical asset exposure.")

        next_7.extend(
            [
                "Complete corrective maintenance and record post-maintenance baseline.",
                "Review similar historical incidents for recurrence prevention.",
                "Close procurement reorder recommendations for consumed or low-stock parts.",
            ]
        )
        long_term.extend(
            [
                "Update preventive maintenance interval based on observed degradation.",
                "Review plant dependency bottlenecks during weekly reliability meeting.",
                "Add recurring monitoring rule for the detected root-cause signature.",
            ]
        )
        return MaintenancePlanData(
            immediate_actions=list(dict.fromkeys(immediate)),
            next_24_hours=list(dict.fromkeys(next_24)),
            next_7_days=list(dict.fromkeys(next_7)),
            long_term_actions=list(dict.fromkeys(long_term)),
            maintenance_schedule=self._schedule(priority, procurement),
        )

    def _schedule(self, priority: PriorityData, procurement: ProcurementData) -> list[dict]:
        if priority.priority_band == "CRITICAL":
            start = "0-4 hours"
        elif priority.priority_band == "HIGH":
            start = "next 24 hours"
        elif priority.priority_band == "MEDIUM":
            start = "next 7 days"
        else:
            start = "next planned maintenance window"
        schedule = [
            {"window": start, "activity": "Execute priority corrective maintenance", "owner": "Maintenance"},
            {"window": "same shift", "activity": "Verify safety isolation and production coordination", "owner": "Operations"},
        ]
        if procurement.reorder_recommendations:
            schedule.append({"window": "same day", "activity": "Release procurement actions for required spares", "owner": "Procurement"})
        return schedule
