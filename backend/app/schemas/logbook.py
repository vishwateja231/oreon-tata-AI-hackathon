from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class MaintenanceLogCreate(BaseModel):
    asset_id: str = Field(min_length=1)
    issue: str = Field(min_length=1)
    root_cause: str = Field(min_length=1)
    action: str = Field(min_length=1)
    engineer_notes: Optional[str] = None


class MaintenanceLogSummary(BaseModel):
    id: int
    asset_id: str
    issue: str
    root_cause: str
    action: str
    engineer_notes: Optional[str]
    timestamp: datetime

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat()
        }
