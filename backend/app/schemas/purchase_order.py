from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PurchaseOrderCreate(BaseModel):
    """Raise a purchase order from a reorder recommendation."""

    part_id: str
    qty: int = Field(gt=0)
    requested_by_role: Optional[str] = None


class PurchaseOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    po_number: str
    part_id: str
    part_name: str
    qty: int
    lead_time_days: int
    unit_cost_usd: Optional[float] = None
    order_value_inr: float
    stage: str
    requested_by_role: Optional[str] = None
    supplier: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class NudgeRequest(BaseModel):
    """A plant manager nudging the procurement officer to order a part."""

    part_id: str
    note: Optional[str] = None
    from_role: str = "plant_manager"
