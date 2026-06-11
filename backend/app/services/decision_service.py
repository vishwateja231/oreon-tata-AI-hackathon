from collections import Counter
from typing import Iterable

from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.schemas.decision import (
    BusinessRiskSummary,
    DecisionAnalyzeRequest,
    DecisionReport,
    MaintenanceActionSummary,
    PriorityAssetSummary,
    PriorityInput,
    ProcurementRiskSummary,
)
from app.services.asset_service import AssetService
from app.services.business_impact_engine import BusinessImpactEngine
from app.services.decision_reasoning_service import DecisionReasoningService
from app.services.incident_service import IncidentService
from app.services.investigation_service import InvestigationService
from app.services.maintenance_planner import MaintenancePlanner
from app.services.plant_impact_engine import PlantImpactEngine
from app.services.priority_engine import PriorityEngine
from app.services.procurement_engine import ProcurementEngine
from app.services.scenario_simulator import ScenarioSimulator


class DecisionService:
    """Orchestrates OREON Phase 3 maintenance decision intelligence."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self.asset_service = AssetService(db)
        self.incident_service = IncidentService(db)
        self.investigation_service = InvestigationService(db)
        self.priority_engine = PriorityEngine()
        self.impact_engine = PlantImpactEngine(db)
        self.procurement_engine = ProcurementEngine(db)
        self.business_engine = BusinessImpactEngine()
        self.scenario_simulator = ScenarioSimulator(db)
        self.maintenance_planner = MaintenancePlanner()
        self.reasoning_service = DecisionReasoningService()

    def analyze(self, request: DecisionAnalyzeRequest) -> DecisionReport:
        asset = self._require_asset(request.asset_id)
        investigation = self.investigation_service.investigate(request)
        plant_impact = self.impact_engine.analyze_impact(asset.id)
        required_parts = request.required_parts or self._infer_required_parts(asset, investigation.root_cause)
        procurement = self.procurement_engine.analyze(required_parts, asset.equipment_type, asset.id)
        priority = self.priority_engine.calculate_priority(
            self._priority_input(asset, plant_impact.impact_score, procurement.procurement_risk)
        )
        scenarios = {
            str(delay): self.scenario_simulator.simulate(asset.id, delay)
            for delay in sorted(set(request.delay_days or [3, 7, 14, 30]))
        }
        maintenance_plan = self.maintenance_planner.build_plan(
            investigation=investigation,
            priority=priority,
            plant_impact=plant_impact,
            procurement=procurement,
        )
        business_impact = self.business_engine.analyze(plant_impact)
        
        # Build recommendations by role
        recos = self._build_role_recommendations(
            asset=asset,
            priority_band=priority.priority_band,
            root_cause=investigation.root_cause,
            procurement_risk=procurement.procurement_risk
        )
        
        # Trigger critical event detector auto-scan
        try:
            from app.services.critical_event_detector import CriticalEventDetector
            CriticalEventDetector(self._db).scan_asset(asset.id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("CriticalEventDetector auto-scan failed: %s", exc)
            self._db.rollback()

        report = DecisionReport(
            asset_id=asset.id,
            investigation=investigation,
            priority=priority,
            plant_impact=plant_impact,
            business_impact=business_impact,
            procurement=procurement,
            scenario_analysis=scenarios,
            maintenance_plan=maintenance_plan,
            executive_summary=self._executive_summary(asset, priority, business_impact, procurement),
            recommendations_by_role=recos
        )
        report.explanation = self.reasoning_service.explain(report)
        return report

    def simulate_scenario(self, asset_id: str, delay_days: int):
        self._require_asset(asset_id)
        return self.scenario_simulator.simulate(asset_id, delay_days)

    def priority_assets(self, limit: int = 20) -> list[PriorityAssetSummary]:
        all_assets = self.asset_service.get_all(limit=500)
        asset_map = {a.id: a for a in all_assets}

        # Select directly from database models in bulk
        from sqlalchemy import select
        from app.models.incident import Incident
        from app.models.spare_part import SparePart

        all_incidents = self._db.scalars(select(Incident)).all()
        incidents_by_asset = {}
        for inc in all_incidents:
            incidents_by_asset.setdefault(inc.asset_id, []).append(inc)

        all_spares = self._db.scalars(select(SparePart)).all()
        spares_by_equipment = {}
        for spare in all_spares:
            spares_by_equipment.setdefault(spare.equipment_type, []).append(spare)

        summaries = []
        for asset in all_assets:
            impact = self.impact_engine.analyze_impact(asset.id, asset_map=asset_map)
            procurement_risk = self.procurement_engine.analyze(
                self._infer_required_parts(asset, "general maintenance"),
                asset.equipment_type,
                asset.id,
                spares_by_equipment=spares_by_equipment,
                all_spares=all_spares,
            ).procurement_risk
            priority = self.priority_engine.calculate_priority(
                self._priority_input(
                    asset,
                    impact.impact_score,
                    procurement_risk,
                    incidents_by_asset=incidents_by_asset,
                    spares_by_equipment=spares_by_equipment,
                )
            )
            summaries.append(
                PriorityAssetSummary(
                    asset_id=asset.id,
                    asset_name=asset.name,
                    equipment_type=asset.equipment_type,
                    health_score=asset.health_score,
                    failure_probability=asset.failure_probability,
                    rul_days=asset.rul_days,
                    priority=priority,
                )
            )
        summaries.sort(key=lambda item: item.priority.priority_score, reverse=True)
        return summaries[:limit]

    def procurement_risks(self) -> list[ProcurementRiskSummary]:
        return [ProcurementRiskSummary(**item) for item in self.procurement_engine.risk_summary()]

    def maintenance_actions(self, limit: int = 20) -> list[MaintenanceActionSummary]:
        actions = []
        for summary in self.priority_assets(limit=limit):
            if summary.priority.priority_band in {"CRITICAL", "HIGH"}:
                due_window = "0-24 hours" if summary.priority.priority_band == "CRITICAL" else "next 7 days"
                action = "Schedule corrective maintenance and confirm spare availability"
            else:
                due_window = "planned window"
                action = "Continue monitoring and preventive maintenance"
            actions.append(
                MaintenanceActionSummary(
                    asset_id=summary.asset_id,
                    asset_name=summary.asset_name,
                    action=action,
                    priority_band=summary.priority.priority_band,
                    due_window=due_window,
                )
            )
        return actions

    def business_risks(self, limit: int = 20) -> list[BusinessRiskSummary]:
        all_assets = self.asset_service.get_all(limit=500)
        asset_map = {a.id: a for a in all_assets}

        summaries = []
        for asset in all_assets:
            impact = self.impact_engine.analyze_impact(asset.id, asset_map=asset_map)
            business = self.business_engine.analyze(impact)
            summaries.append(
                BusinessRiskSummary(
                    asset_id=asset.id,
                    asset_name=asset.name,
                    production_line=impact.production_line,
                    business_risk=business.business_risk,
                    estimated_downtime_hours=business.downtime_hours,
                    impact_score=impact.impact_score,
                    cost_of_inaction_inr=business.cost_of_inaction_inr,
                    cost_of_action_inr=business.cost_of_action_inr,
                    revenue_exposure_inr=business.revenue_exposure_inr,
                    impact_level=business.impact_level,
                    cost_avoided_inr=business.cost_avoided_inr,
                    business_impact_score=business.business_impact_score,
                )
            )
        summaries.sort(key=lambda item: (self._risk_rank(item.business_risk), item.impact_score), reverse=True)
        return summaries[:limit]

    def _require_asset(self, asset_id: str) -> Asset:
        asset = self.asset_service.get_by_id(asset_id)
        if not asset:
            raise ValueError(f"Asset '{asset_id}' not found")
        return asset

    def _priority_input(
        self,
        asset: Asset,
        impact_score: float,
        procurement_risk: str,
        incidents_by_asset: dict[str, list] | None = None,
        spares_by_equipment: dict[str, list] | None = None,
    ) -> PriorityInput:
        if incidents_by_asset is not None:
            incidents = incidents_by_asset.get(asset.id, [])
        else:
            from app.models.incident import Incident
            incidents = self.incident_service.get_by_asset(asset.id)
        historical_frequency = len(incidents)
        safety_risk = self._safety_risk(asset, impact_score)
        spare_availability = self._spare_availability(procurement_risk)
        lead_time = self._max_lead_time(asset, spares_by_equipment)
        return PriorityInput(
            failure_probability=asset.failure_probability,
            health_score=asset.health_score,
            rul_days=asset.rul_days,
            asset_criticality=asset.criticality.value,
            historical_failure_frequency=historical_frequency,
            safety_risk=safety_risk,
            spare_availability=spare_availability,
            procurement_lead_time=lead_time,
            dependency_impact_score=impact_score,
        )

    def _infer_required_parts(self, asset: Asset, root_cause: str) -> list[str]:
        text = f"{asset.equipment_type} {root_cause}".lower()
        if "bearing" in text:
            return ["bearing"]
        if "cavitation" in text or "seal" in text or "pump" in text:
            return ["mechanical seal", "strainer"]
        if "fan" in text or "imbalance" in text:
            return ["fan blade", "bearing"]
        if "gearbox" in text or "gear" in text or "lubrication" in text:
            return ["oil filter", "bearing"]
        if "cooling" in text:
            return ["fill media", "pump seal"]
        if "conveyor" in text or "misalignment" in text:
            return ["idler roller", "bearing"]
        return [asset.equipment_type]

    def _safety_risk(self, asset: Asset, impact_score: float) -> float:
        base = {"low": 0.2, "medium": 0.4, "high": 0.65, "critical": 0.9}.get(asset.criticality.value, 0.4)
        if any(token in asset.equipment_type.lower() for token in ["blast furnace", "crusher", "cooling"]):
            base += 0.12
        if impact_score >= 80:
            base += 0.1
        return round(min(1.0, base), 3)

    def _spare_availability(self, procurement_risk: str) -> float:
        return {"LOW": 1.0, "MEDIUM": 0.65, "HIGH": 0.35, "CRITICAL": 0.1}.get(procurement_risk, 0.5)

    def _max_lead_time(self, asset: Asset, spares_by_equipment: dict[str, list] | None = None) -> int:
        if spares_by_equipment is not None:
            parts = spares_by_equipment.get(asset.equipment_type, [])
        else:
            parts = self.procurement_engine.spare_service.get_by_equipment_type(asset.equipment_type)
        return max((part.lead_time_days for part in parts), default=0)

    def _executive_summary(self, asset: Asset, priority, business_impact, procurement) -> str:
        return (
            f"{asset.name} is a {priority.priority_band} maintenance priority. "
            f"{business_impact.executive_summary} Procurement risk is {procurement.procurement_risk}."
        )

    def _risk_rank(self, risk: str) -> int:
        return {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}.get(risk, 0)

    def _build_role_recommendations(self, asset: Asset, priority_band: str, root_cause: str, procurement_risk: str) -> dict[str, str]:
        p = priority_band.upper()
        proc = procurement_risk.upper()
        if p == "CRITICAL" or asset.status.value == "critical":
            return {
                "operator": f"IMMEDIATE: Halt non-essential workloads on {asset.id}. Manually inspect temperature gauges and stand by for isolation tagging.",
                "maintenance_engineer": f"IMMEDIATE: Retrieve compatible replacement spares (lube oil, bearings) and prepare hydraulic decoupling gear.",
                "supervisor": f"IMMEDIATE: Disruption Alert. Authorize emergency shutdown window for {asset.id} and dispatch technical response team.",
                "plant_manager": f"IMMEDIATE: Operational override. Divert downstream feed lines and report outage SLA window to command center.",
                "reliability_engineer": f"IMMEDIATE: Log event. Capture high-frequency sensor recordings of {asset.id} vibration spikes for failure mode analysis.",
                "procurement_officer": (
                    f"IMMEDIATE: Procurement risk is {proc}. Expedite emergency PO for {asset.equipment_type} spares, "
                    "invoke fastest supplier/air-freight, and confirm same-day dispatch against the outage window."
                ),
            }
        elif p == "HIGH" or asset.status.value == "degraded":
            return {
                "operator": f"Monitor sensor alerts at high frequency (15-min intervals). Report abnormal motor humming.",
                "maintenance_engineer": f"Schedule inspection for next available shift change. Verify grease lubrication levels and alignment.",
                "supervisor": f"Request maintenance slot on the weekly plan. Coordinate with Warehouse A to verify spare part SKU availability.",
                "plant_manager": f"Monitor {asset.production_line} health KPI and prepare contingency buffers.",
                "reliability_engineer": f"Review prior incidents for {asset.equipment_type} bearings. Check if degradation matches previous patterns.",
                "procurement_officer": (
                    f"Procurement risk {proc}: verify {asset.equipment_type} spare stock vs RUL, raise a purchase order "
                    "now for any part whose lead time exceeds remaining RUL, and confirm supplier delivery dates."
                ),
            }
        else:
            return {
                "operator": f"Perform standard visual inspections of {asset.id} during routine rounds. Check base bolting stability.",
                "maintenance_engineer": f"Lubricate bearings according to standard periodic schedule (SOP-4.2).",
                "supervisor": f"Include {asset.id} in the upcoming bi-weekly maintenance schedule. No urgent crew assignments needed.",
                "plant_manager": f"Review monthly asset reliability reports. {asset.id} is operating in normal nominal ranges.",
                "reliability_engineer": f"Conduct routine maintenance audit. Update mean-time-between-failures (MTBF) tracking indices.",
                "procurement_officer": (
                    f"No procurement action required for {asset.id}. Maintain standard reorder levels for "
                    f"{asset.equipment_type} consumables and review supplier lead times in the next planning cycle."
                ),
            }
