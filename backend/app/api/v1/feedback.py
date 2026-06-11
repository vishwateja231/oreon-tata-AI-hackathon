from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database.session import get_db
from app.models.asset import Asset
from app.models.decision_feedback import DecisionFeedback
from app.schemas.feedback import FeedbackCreate, FeedbackSummary, LearningSummary
from app.services.feedback_learning_service import FeedbackLearningService

router = APIRouter(prefix="/feedback", tags=["Feedback Loop"])


@router.post("", response_model=FeedbackSummary, status_code=status.HTTP_201_CREATED)
def submit_feedback(payload: FeedbackCreate, db: Session = Depends(get_db)) -> DecisionFeedback:
    """Submit operator feedback on an OREON decision or recommendation.

    Confirmations, rejections, and root-cause corrections recorded here immediately
    feed ``FeedbackLearningService`` — the next investigation re-calibrates its
    diagnostic confidence and re-ranks historical incidents accordingly.
    """
    # Derive equipment type from the asset when the client did not supply it, so the
    # loop can learn at the equipment-type granularity.
    asset_type = payload.asset_type
    if asset_type is None and payload.asset_id:
        asset = db.get(Asset, payload.asset_id)
        if asset:
            asset_type = asset.equipment_type

    feedback = DecisionFeedback(
        asset_id=payload.asset_id,
        asset_type=asset_type,
        decision_type=payload.decision_type,
        feedback_value=payload.feedback_value,
        investigation_id=payload.investigation_id,
        predicted_root_cause=payload.predicted_root_cause,
        corrected_root_cause=payload.corrected_root_cause,
        predicted_confidence=payload.predicted_confidence,
        outcome=payload.outcome,
        user_comments=payload.user_comments,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


@router.get("", response_model=list[FeedbackSummary])
def list_feedback(db: Session = Depends(get_db)) -> list[DecisionFeedback]:
    """Retrieve all submitted feedback logs, ordered by newest first."""
    return list(db.scalars(
        select(DecisionFeedback)
        .order_by(DecisionFeedback.created_at.desc())
        .limit(200)
    ).all())


@router.get("/stats")
def get_feedback_stats(db: Session = Depends(get_db)) -> dict:
    """Return helpfulness ratio stats grouped by decision type, plus total_feedback count."""
    rows = db.execute(
        select(DecisionFeedback.decision_type, DecisionFeedback.feedback_value)
    ).all()

    breakdown: dict[str, dict] = {}
    for row in rows:
        dt = row.decision_type
        if dt not in breakdown:
            breakdown[dt] = {"total_count": 0, "helpful_count": 0}
        breakdown[dt]["total_count"] += 1
        if row.feedback_value == "helpful":
            breakdown[dt]["helpful_count"] += 1

    for dt, s in breakdown.items():
        total = s["total_count"]
        s["helpfulness_ratio"] = round(s["helpful_count"] / total, 4) if total else 1.0

    total_feedback = sum(s["total_count"] for s in breakdown.values())
    return {"total_feedback": total_feedback, "breakdown": breakdown}


@router.get("/learning", response_model=LearningSummary)
def get_learning_summary(
    asset_type: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """Show what OREON has learned from operator feedback so far.

    This makes the closed loop explainable: per ``(asset_type, root_cause)`` confidence
    modifiers, learned root-cause corrections, and incident re-ranking boosts. Pass
    ``?asset_type=motor`` to scope the calibration view to one equipment type.
    """
    return FeedbackLearningService(db).learning_summary(asset_type)
