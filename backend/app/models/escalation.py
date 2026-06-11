from datetime import datetime, timezone
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean
from app.database.base import Base

class Escalation(Base):
    """Tracks active asset escalations in the command center."""
    __tablename__ = "escalations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(String(50), ForeignKey("assets.id"), unique=True)
    escalation_level: Mapped[str] = mapped_column(String(20))  # "low" | "medium" | "high" | "critical"
    target_roles: Mapped[str] = mapped_column(String(255))  # Comma-separated roles
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class EscalationHistory(Base):
    """Auditable log of operational escalations."""
    __tablename__ = "escalation_history"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(String(50), ForeignKey("assets.id"))
    risk_level: Mapped[str] = mapped_column(String(20))
    priority_band: Mapped[str] = mapped_column(String(20))
    target_roles: Mapped[str] = mapped_column(String(255))  # Comma-separated roles
    reason: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    decision_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
