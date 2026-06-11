"""SentinelActivity model — persists autonomous agent actions."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Float, Text, JSON, Enum as SAEnum
from sqlalchemy.sql import func
import enum

from app.database.base import Base


class ActivityType(str, enum.Enum):
    anomaly_detected = "anomaly_detected"
    investigation_started = "investigation_started"
    alert_created = "alert_created"
    escalation_created = "escalation_created"
    maintenance_plan_generated = "maintenance_plan_generated"
    rca_completed = "rca_completed"
    rul_predicted = "rul_predicted"
    health_check = "health_check"


class SentinelActivity(Base):
    __tablename__ = "sentinel_activities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    asset_id = Column(String, nullable=False, index=True)
    activity_type = Column(SAEnum(ActivityType), nullable=False, index=True)
    summary = Column(Text, nullable=False)
    details = Column(JSON, nullable=True)
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
