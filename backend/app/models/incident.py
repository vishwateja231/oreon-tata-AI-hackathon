from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin


class Incident(Base, TimestampMixin):
    """Records a maintenance incident or failure event for an asset."""

    __tablename__ = "incidents"

    incident_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    symptoms: Mapped[str] = mapped_column(Text, nullable=False)
    root_cause: Mapped[str] = mapped_column(Text, nullable=False)
    corrective_action: Mapped[str] = mapped_column(Text, nullable=False)
    repair_time_hours: Mapped[float] = mapped_column(Float, nullable=False)
    downtime_hours: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    technician: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    work_order_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    parts_replaced: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    asset: Mapped["Asset"] = relationship("Asset", back_populates="incidents")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Incident id={self.incident_id} asset={self.asset_id} severity={self.severity}>"
