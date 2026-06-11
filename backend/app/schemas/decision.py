from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.investigation import InvestigationRequest, InvestigationReport, SensorSnapshot


class DecisionAnalyzeRequest(InvestigationRequest):
    """Request for a complete maintenance decision analysis."""

    delay_days: list[int] = Field(default_factory=lambda: [3, 7, 14, 30])
    required_parts: list[str] = Field(default_factory=list)


class ScenarioRequest(BaseModel):
    asset_id: str = Field(min_length=1)
    delay_days: int = Field(ge=0, le=365)


class PriorityInput(BaseModel):
    failure_probability: float = Field(ge=0.0, le=1.0)
    health_score: float = Field(ge=0.0, le=100.0)
    rul_days: int = Field(ge=0)
    asset_criticality: str
    historical_failure_frequency: int = Field(ge=0)
    safety_risk: float = Field(ge=0.0, le=1.0)
    spare_availability: float = Field(ge=0.0, le=1.0)
    procurement_lead_time: int = Field(ge=0)
    dependency_impact_score: float = Field(ge=0.0, le=100.0)


class PriorityData(BaseModel):
    priority_score: float = Field(ge=0.0, le=100.0)
    priority_band: str
    priority_reason: str
    score_components: dict[str, float] = Field(default_factory=dict)


class PlantImpactData(BaseModel):
    affected_assets: list[dict[str, Any]]
    production_line: str
    critical_assets_impacted: list[dict[str, Any]]
    estimated_downtime_hours: float
    impact_score: float = Field(ge=0.0, le=100.0)
    impact_category: str
    impact_chain: list[dict[str, Any]]
    bottlenecks: list[dict[str, Any]]


class ProcurementData(BaseModel):
    available_parts: list[dict[str, Any]]
    missing_parts: list[dict[str, Any]]
    lead_times: list[dict[str, Any]]
    procurement_risk: str
    reorder_recommendations: list[str]
    alternative_parts: list[dict[str, Any]]


class BusinessImpactData(BaseModel):
    production_loss_estimate: str
    downtime_hours: float
    business_risk: str
    executive_summary: str
    cost_of_inaction_inr: Optional[float] = None
    cost_of_action_inr: Optional[float] = None
    revenue_exposure_inr: Optional[float] = None
    impact_level: Optional[str] = None
    # Explicit business-outcome metrics (Phase E)
    downtime_cost_inr: Optional[float] = None
    production_loss_inr: Optional[float] = None
    repair_cost_inr: Optional[float] = None
    maintenance_cost_inr: Optional[float] = None
    cost_of_delay_inr: Optional[float] = None
    cost_avoided_inr: Optional[float] = None
    business_impact_score: Optional[float] = None



class ScenarioAnalysisData(BaseModel):
    current_health: float
    future_health: float
    current_failure_probability: float
    future_failure_probability: float
    failure_risk_change: str
    affected_assets: list[dict[str, Any]]
    production_impact: str
    recommendation: str
    delay_days: int


class MaintenancePlanData(BaseModel):
    immediate_actions: list[str]
    next_24_hours: list[str]
    next_7_days: list[str]
    long_term_actions: list[str]
    maintenance_schedule: list[dict[str, Any]]


class DecisionExplanation(BaseModel):
    engineer_summary: str
    supervisor_summary: str
    executive_summary: str


class DecisionReport(BaseModel):
    asset_id: str
    investigation: InvestigationReport
    priority: PriorityData
    plant_impact: PlantImpactData
    business_impact: BusinessImpactData
    procurement: ProcurementData
    scenario_analysis: dict[str, ScenarioAnalysisData]
    maintenance_plan: MaintenancePlanData
    executive_summary: str
    explanation: Optional[DecisionExplanation] = None
    recommendations_by_role: dict[str, str] = Field(default_factory=dict)


class PriorityAssetSummary(BaseModel):
    asset_id: str
    asset_name: str
    equipment_type: str
    health_score: float
    failure_probability: float
    rul_days: int
    priority: PriorityData


class ProcurementRiskSummary(BaseModel):
    part_id: str
    part_name: str
    equipment_type: str
    stock_quantity: int
    reorder_level: int
    lead_time_days: int
    procurement_risk: str


class MaintenanceActionSummary(BaseModel):
    asset_id: str
    asset_name: str
    action: str
    priority_band: str
    due_window: str


class BusinessRiskSummary(BaseModel):
    asset_id: str
    asset_name: str
    production_line: str
    business_risk: str
    estimated_downtime_hours: float
    impact_score: float
    cost_of_inaction_inr: Optional[float] = None
    cost_of_action_inr: Optional[float] = None
    revenue_exposure_inr: Optional[float] = None
    impact_level: Optional[str] = None
    cost_avoided_inr: Optional[float] = None
    business_impact_score: Optional[float] = None

