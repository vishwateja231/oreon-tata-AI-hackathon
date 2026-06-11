from pydantic import BaseModel

from app.schemas.asset import AssetSummary
from app.schemas.spare_part import SparePartSummary


class PredictedFailure(BaseModel):
    asset_id: str
    asset_name: str
    equipment_type: str
    failure_probability: float
    rul_days: int
    criticality: str
    recommended_action: str


class ActiveAlert(BaseModel):
    asset_id: str
    asset_name: str
    alert_type: str
    severity: str
    message: str


class DashboardResponse(BaseModel):
    active_alerts: int
    critical_assets: list[AssetSummary]
    predicted_failures: list[PredictedFailure]
    spare_shortages: list[SparePartSummary]
    total_assets: int
    operational_assets: int
    assets_in_maintenance: int
    avg_plant_health: float
