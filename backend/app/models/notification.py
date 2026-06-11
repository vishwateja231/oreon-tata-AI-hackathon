from datetime import datetime, timezone
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text, DateTime, ForeignKey
from app.database.base import Base

class Notification(Base):
    """SQLAlchemy model for Command Center active alarms and notices."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)  # "info" | "warning" | "high" | "critical"
    title: Mapped[str] = mapped_column(String(150))
    message: Mapped[str] = mapped_column(Text)
    asset_id: Mapped[str | None] = mapped_column(String(50), ForeignKey("assets.id"), nullable=True)
    target_roles: Mapped[str] = mapped_column(String(255))  # Comma-separated list of role names
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    status: Mapped[str] = mapped_column(String(20), default="active")  # "active" | "resolved"

class NotificationRead(Base):
    """Tracks read logs for role-based alert feeds."""
    __tablename__ = "notification_reads"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"))
    role_name: Mapped[str] = mapped_column(String(50), index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
