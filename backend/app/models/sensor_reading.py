from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class SensorReading(Base):
    """Records a point-in-time sensor measurement for an asset."""

    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    temperature_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vibration_mms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_amps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pressure_bar: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rpm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    noise_db: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    anomaly_flag: Mapped[bool] = mapped_column(default=False, nullable=False)
    sensor_source: Mapped[str] = mapped_column(String(64), nullable=False, default="SCADA")

    # Relationships
    asset: Mapped["Asset"] = relationship("Asset", back_populates="sensor_readings")  # noqa: F821

    def __repr__(self) -> str:
        return f"<SensorReading asset={self.asset_id} ts={self.timestamp}>"
