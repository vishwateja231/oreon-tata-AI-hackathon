from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, Float, Integer, String, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database.base import Base, TimestampMixin


class AssetStatus(str, enum.Enum):
    OPERATIONAL = "operational"
    DEGRADED = "degraded"
    CRITICAL = "critical"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"


class CriticalityLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Asset(Base, TimestampMixin):
    """Represents a physical industrial asset in the steel plant."""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    equipment_type: Mapped[str] = mapped_column(String(64), nullable=False)
    location: Mapped[str] = mapped_column(String(128), nullable=False)
    criticality: Mapped[CriticalityLevel] = mapped_column(
        SAEnum(CriticalityLevel), nullable=False
    )
    production_line: Mapped[str] = mapped_column(String(64), nullable=False)
    health_score: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    failure_probability: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rul_days: Mapped[int] = mapped_column(Integer, nullable=False, default=365)
    status: Mapped[AssetStatus] = mapped_column(
        SAEnum(AssetStatus), nullable=False, default=AssetStatus.OPERATIONAL
    )
    last_maintenance_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    installation_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Relationships
    incidents: Mapped[list["Incident"]] = relationship(  # noqa: F821
        "Incident", back_populates="asset", cascade="all, delete-orphan"
    )
    sensor_readings: Mapped[list["SensorReading"]] = relationship(  # noqa: F821
        "SensorReading", back_populates="asset", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Asset id={self.id} name={self.name} status={self.status}>"
