from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class IncidentBase(BaseModel):
    asset_id: str
    timestamp: datetime
    symptoms: str
    root_cause: str
    corrective_action: str
    repair_time_hours: float = Field(ge=0.0)
    downtime_hours: float = Field(ge=0.0)
    severity: str = "medium"
    technician: Optional[str] = None
    work_order_id: Optional[str] = None
    parts_replaced: Optional[str] = None
    cost_usd: Optional[float] = None


class IncidentCreate(IncidentBase):
    incident_id: str


class IncidentResponse(IncidentBase):
    incident_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IncidentSummary(BaseModel):
    incident_id: str
    asset_id: str
    timestamp: datetime
    root_cause: str
    severity: str
    downtime_hours: float

    model_config = {"from_attributes": True}
