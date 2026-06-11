"""Sentinel API — exposes autonomous agent status, activities, and controls."""

import logging
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


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    """Current sentinel operational status — combines in-memory state with DB counts."""
    from app.models.asset import Asset

    assets_monitored = len(SentinelState._last_asset_state)
    if assets_monitored == 0:
        assets_monitored = db.scalar(select(func.count()).select_from(Asset)) or 0

    # Pull counts from DB if in-memory state is empty (server just started)
    anomalies = SentinelState.anomalies_detected
    alerts = SentinelState.alerts_generated
    investigations = SentinelState.investigations_created
    escalations = SentinelState.escalations_triggered
    scan_count = SentinelState.scan_count

    if anomalies == 0 and scan_count == 0:
        # Fall back to DB counts
        anomalies = db.scalar(
            select(func.count()).select_from(SentinelActivity)
            .where(SentinelActivity.activity_type == ActivityType.anomaly_detected)
        ) or 0
        alerts = db.scalar(
            select(func.count()).select_from(SentinelActivity)
            .where(SentinelActivity.activity_type == ActivityType.alert_created)
        ) or 0
        investigations = db.scalar(
            select(func.count()).select_from(SentinelActivity)
            .where(SentinelActivity.activity_type == ActivityType.investigation_started)
        ) or 0
        escalations = db.scalar(
            select(func.count()).select_from(SentinelActivity)
            .where(SentinelActivity.activity_type == ActivityType.escalation_created)
        ) or 0
        # If DB has data, there was at least 1 scan
        total_db = db.scalar(select(func.count()).select_from(SentinelActivity)) or 0
        if total_db > 0:
            scan_count = max(1, scan_count)

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
):
    """Paginated list of sentinel activities."""
    query = select(SentinelActivity).order_by(desc(SentinelActivity.timestamp))

    if activity_type:
        try:
            atype = ActivityType(activity_type)
            query = query.where(SentinelActivity.activity_type == atype)
        except ValueError:
            pass

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

    return {
        "total_activities": total,
        "by_type": type_counts,
        "average_confidence": round(float(avg_confidence), 3),
        "success_rate": round(success_rate, 3),
        "scan_count": max(SentinelState.scan_count, 1 if total > 0 else 0),
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
async def trigger_scan():
    """Manually trigger a full sentinel scan cycle (runs in background thread)."""
    import asyncio
    result = await asyncio.to_thread(run_sentinel_cycle)
    return {"triggered": True, "result": result}
