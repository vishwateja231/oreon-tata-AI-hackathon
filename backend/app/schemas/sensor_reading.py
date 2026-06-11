from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SensorReadingBase(BaseModel):
    asset_id: str
    timestamp: datetime
    temperature_c: Optional[float] = None
    vibration_mms: Optional[float] = None
    current_amps: Optional[float] = None
    pressure_bar: Optional[float] = None
    rpm: Optional[float] = None
    noise_db: Optional[float] = None
    anomaly_flag: bool = False
    sensor_source: str = "SCADA"


class SensorReadingCreate(SensorReadingBase):
    pass


class SensorReadingResponse(SensorReadingBase):
    id: int

    model_config = {"from_attributes": True}


class SensorReadingAggregated(BaseModel):
    asset_id: str
    metric: str
    min_value: float
    max_value: float
    avg_value: float
    anomaly_count: int
    reading_count: int
