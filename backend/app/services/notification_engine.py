import logging
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import select, func, and_
from app.models.notification import Notification, NotificationRead

logger = logging.getLogger(__name__)

class NotificationEngine:
    """Manages creation, query feeds, and read states for plant-wide notifications."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def create_notification(
        self,
        severity: str,
        title: str,
        message: str,
        asset_id: str | None = None,
        target_roles: Optional[list[str]] = None
    ) -> Notification | None:
        """Create and persist a new notification targeting specific roles.

        Deduplicates: if an active notification with the same asset_id + title
        exists within the last 5 minutes, skip creation and return None.
        """
        # Deduplication check — prevent spamming the same alert
        cutoff = datetime.utcnow() - timedelta(minutes=5)
        existing = self._db.scalar(
            select(Notification.id)
            .where(
                and_(
                    Notification.asset_id == asset_id,
                    Notification.title == title,
                    Notification.status == "active",
                    Notification.created_at >= cutoff,
                )
            )
            .limit(1)
        )
        if existing:
            return None  # Duplicate within cooldown window

        roles_str = ",".join(target_roles or ["operator"])

        notification = Notification(
            severity=severity.lower(),
            title=title,
            message=message,
            asset_id=asset_id,
            target_roles=roles_str,
            status="active"
        )
        self._db.add(notification)
        self._db.commit()
        self._db.refresh(notification)
        logger.info("Created notification %d: %s", notification.id, title)
        return notification

    def get_notifications(
        self,
        role: str | None = None,
        severity: str | None = None,
        asset_id: str | None = None,
        status: str | None = None,
        limit: int = 100
    ) -> list[Notification]:
        """Fetch notifications with filters. All roles see all plant alerts (personalized differently)."""
        stmt = select(Notification)

        filters = []
        if severity:
            filters.append(Notification.severity == severity.lower())
        if asset_id:
            filters.append(Notification.asset_id == asset_id)
        if status:
            filters.append(Notification.status == status.lower())

        # Role filtering: prefer role-specific alerts but always fall back to all
        # active alerts so no role ever sees an empty feed.
        if role:
            role_lower = role.lower()
            role_filters = (
                (Notification.target_roles.like(f"%{role_lower}%")) |
                (Notification.target_roles.like("%all%"))
            )
            role_stmt = stmt
            if filters:
                role_stmt = role_stmt.where(and_(*filters, role_filters))
            else:
                role_stmt = role_stmt.where(role_filters)
            role_stmt = role_stmt.order_by(Notification.created_at.desc()).limit(limit)
            role_results = list(self._db.scalars(role_stmt).all())
            return role_results

        if filters:
            stmt = stmt.where(and_(*filters))
        stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_counts(self, role: Optional[str] = None) -> dict:
        """Return counts of active notifications grouped by severity."""
        stmt = (
            select(Notification.severity, func.count(Notification.id))
            .where(Notification.status == "active")
        )
        if role:
            role_lower = role.lower().strip()
            role_filters = (
                (Notification.target_roles.like(f"%{role_lower}%")) |
                (Notification.target_roles.like("%all%"))
            )
            stmt = stmt.where(role_filters)
        stmt = stmt.group_by(Notification.severity)
        results = self._db.execute(stmt).all()
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for severity, count in results:
            severity_lower = severity.lower()
            if severity_lower in counts:
                counts[severity_lower] = count
            elif severity_lower in ("warn", "warning"):
                counts["medium"] += count
            elif severity_lower in ("info", "ok"):
                counts["low"] += count
        return counts

    def mark_as_read(self, notification_id: int, role_name: str) -> bool:
        """Record that a role has read a notification, resolving it so it stops appearing."""
        notification = self._db.get(Notification, notification_id)
        if not notification:
            return False

        # Check if already read by this role
        exists = self._db.scalar(
            select(NotificationRead.id)
            .where(NotificationRead.notification_id == notification_id)
            .where(NotificationRead.role_name == role_name.lower())
            .limit(1)
        )
        if not exists:
            read_log = NotificationRead(
                notification_id=notification_id,
                role_name=role_name.lower()
            )
            self._db.add(read_log)

            # Mark notification as resolved so it stops showing up
            notification.status = "resolved"
            self._db.commit()
            return True
        return False
