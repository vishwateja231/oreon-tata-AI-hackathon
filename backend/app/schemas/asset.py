from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.asset import AssetStatus, CriticalityLevel


class AssetBase(BaseModel):
    name: str
    equipment_type: str
    location: str
    criticality: CriticalityLevel
    production_line: str
    health_score: float = Field(ge=0.0, le=100.0)
    failure_probability: float = Field(ge=0.0, le=1.0)
    rul_days: int = Field(ge=0)
    status: AssetStatus
    last_maintenance_date: Optional[date] = None
    description: Optional[str] = None
    manufacturer: Optional[str] = None
    model_number: Optional[str] = None
    installation_year: Optional[int] = None


class AssetCreate(AssetBase):
    id: str


class AssetUpdate(BaseModel):
    health_score: Optional[float] = Field(None, ge=0.0, le=100.0)
    failure_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    rul_days: Optional[int] = Field(None, ge=0)
    status: Optional[AssetStatus] = None
    last_maintenance_date: Optional[date] = None


class AssetResponse(AssetBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AssetSummary(BaseModel):
    """Lightweight asset view for lists and dashboard."""

    id: str
    name: str
    equipment_type: str
    criticality: CriticalityLevel
    health_score: float
    failure_probability: float
    rul_days: int
    status: AssetStatus

    model_config = {"from_attributes": True}


class ImpactChainResponse(BaseModel):
    asset_id: str
    asset_name: str
    downstream_assets: list[AssetSummary]
    total_impact_score: float
    affected_production_lines: list[str]
