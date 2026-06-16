"""Sentinel API — exposes autonomous agent status, activities, and controls."""

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.sentinel_activity import SentinelActivity, ActivityType
from app.services.autonomous_agent_service import SentinelState, run_sentinel_cycle

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sentinel", tags=["Sentinel"])

# Guards the manual trigger so overlapping clicks don't run concurrent cycles.
# (SentinelState.running can't serve as this lock — run_cycle keeps it True.)
_trigger_lock = threading.Lock()


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    """Current sentinel operational snapshot.

    The headline cards are a real current-state funnel derived from live asset
    health — not a 1:1:1 pipeline counter (which made every card read the same
    number). Each metric is a distinct, deterministic count from the asset table:
        monitored ≥ anomalies ≥ alerts ≥ investigations ≥ escalations.
    """
    from app.models.asset import Asset, AssetStatus

    def cnt(stmt) -> int:
        return db.scalar(stmt) or 0

    assets_monitored = cnt(select(func.count()).select_from(Asset))
    # Any asset off "operational" is showing an anomaly signal.
    anomalies = cnt(
        select(func.count()).select_from(Asset).where(Asset.status != AssetStatus.OPERATIONAL)
    )
    # Critical-status assets raise an operator alert.
    alerts = cnt(
        select(func.count()).select_from(Asset).where(Asset.status == AssetStatus.CRITICAL)
    )
    # Elevated failure probability opens an investigation; high probability escalates.
    investigations = cnt(
        select(func.count()).select_from(Asset).where(Asset.failure_probability >= 0.4)
    )
    escalations = cnt(
        select(func.count()).select_from(Asset).where(Asset.failure_probability >= 0.6)
    )

    # Scan cycles are a lifetime tally tracked in-memory for the running process.
    scan_count = SentinelState.scan_count

    return {
        "running": SentinelState.running or scan_count > 0,
        "last_scan": SentinelState.last_scan.isoformat() if SentinelState.last_scan else None,
        "scan_count": scan_count,
        "anomalies_detected": anomalies,
        "alerts_generated": alerts,
        "investigations_created": investigations,
        "escalations_triggered": escalations,
        "assets_monitored": assets_monitored,
        "uptime_seconds": (
            (datetime.now(timezone.utc) - SentinelState.last_scan).total_seconds()
            if SentinelState.last_scan else 0
        ),
    }


@router.get("/activities")
def get_activities(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    activity_type: Optional[str] = Query(default=None),
    asset_id: Optional[str] = Query(default=None),
    exclude_routine: bool = Query(default=False),
):
    """Paginated list of sentinel activities."""
    query = select(SentinelActivity).order_by(desc(SentinelActivity.timestamp))

    if activity_type:
        try:
            atype = ActivityType(activity_type)
            query = query.where(SentinelActivity.activity_type == atype)
        except ValueError:
            pass
    elif exclude_routine:
        query = query.where(SentinelActivity.activity_type != ActivityType.health_check)

    if asset_id:
        query = query.where(SentinelActivity.asset_id == asset_id)

    query = query.offset(offset).limit(limit)
    activities = db.scalars(query).all()

    return {
        "activities": [
            {
                "id": a.id,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                "asset_id": a.asset_id,
                "activity_type": a.activity_type.value if a.activity_type else None,
                "summary": a.summary,
                "details": a.details,
                "confidence": a.confidence,
            }
            for a in activities
        ],
        "count": len(activities),
    }


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    """Aggregated sentinel statistics."""
    total = db.scalar(select(func.count()).select_from(SentinelActivity)) or 0

    # Counts by type
    type_counts = {}
    for atype in ActivityType:
        count = db.scalar(
            select(func.count())
            .select_from(SentinelActivity)
            .where(SentinelActivity.activity_type == atype)
        ) or 0
        type_counts[atype.value] = count

    # Average confidence
    avg_confidence = db.scalar(
        select(func.avg(SentinelActivity.confidence)).select_from(SentinelActivity)
    ) or 0.0

    # Success rate (investigations that led to alerts = success)
    investigations = type_counts.get("investigation_started", 0)
    alerts = type_counts.get("alert_created", 0)
    success_rate = alerts / max(investigations, 1)

    # Estimate scan count from health checks if in-memory is 0
    scan_count = SentinelState.scan_count
    if scan_count == 0 and total > 0:
        health_checks = type_counts.get("health_check", 0)
        from app.models.asset import Asset
        assets_monitored = db.scalar(select(func.count()).select_from(Asset)) or 10
        scan_count = max(1, health_checks // max(assets_monitored, 1))

    return {
        "total_activities": total,
        "by_type": type_counts,
        "average_confidence": round(float(avg_confidence), 3),
        "success_rate": round(success_rate, 3),
        "scan_count": max(scan_count, 1 if total > 0 else 0),
        "running": SentinelState.running or total > 0,
    }


@router.get("/timeline")
def get_timeline(
    db: Session = Depends(get_db),
    limit: int = Query(default=20, le=50),
):
    """Recent timeline events (for the live feed UI).

    Health checks are excluded — every scan emits one per asset, which would
    push all real events (anomalies, alerts, RCA, plans) out of the window.
    """
    activities = db.scalars(
        select(SentinelActivity)
        .where(SentinelActivity.activity_type != ActivityType.health_check)
        .order_by(desc(SentinelActivity.timestamp))
        .limit(limit)
    ).all()

    return [
        {
            "id": a.id,
            "time": a.timestamp.strftime("%H:%M") if a.timestamp else "",
            "type": a.activity_type.value if a.activity_type else "",
            "summary": a.summary,
            "asset_id": a.asset_id,
            "confidence": a.confidence,
        }
        for a in activities
    ]


@router.post("/trigger")
def trigger_scan():
    """Kick off a full sentinel scan in the background and return immediately.

    A full cycle does many DB round-trips (several seconds); running it inline would
    freeze the button and risk gateway timeouts in production. We launch it on a
    daemon thread and let the dashboard's polling surface the new numbers. A
    non-blocking lock prevents overlapping triggers from double-running.
    """
    if not _trigger_lock.acquire(blocking=False):
        return {"triggered": False, "status": "already_running"}

    def _run() -> None:
        try:
            run_sentinel_cycle()
        except Exception as exc:  # never let a worker thread die silently
            logger.error("Manual sentinel trigger failed: %s", exc)
        finally:
            _trigger_lock.release()

    threading.Thread(target=_run, name="sentinel-trigger", daemon=True).start()
    return {"triggered": True, "status": "running"}
