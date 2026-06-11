from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SparePartBase(BaseModel):
    part_name: str
    equipment_type: str
    stock_quantity: int = Field(ge=0)
    lead_time_days: int = Field(ge=0)
    supplier: str
    reorder_level: int = Field(ge=0)
    unit_cost_usd: Optional[float] = None
    part_number: Optional[str] = None
    description: Optional[str] = None
    storage_location: Optional[str] = None
    compatible_assets: Optional[str] = None


class SparePartCreate(SparePartBase):
    part_id: str


class SparePartResponse(SparePartBase):
    part_id: str
    is_low_stock: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SparePartSummary(BaseModel):
    part_id: str
    part_name: str
    equipment_type: str
    stock_quantity: int
    reorder_level: int
    lead_time_days: int
    is_low_stock: bool
    compatible_assets: Optional[str] = None

    model_config = {"from_attributes": True}
