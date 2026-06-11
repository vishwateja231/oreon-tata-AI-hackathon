from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    """Operator feedback on an OREON decision. Optional learning fields drive the
    closed feedback loop (confidence calibration + root-cause correction)."""

    asset_id: Optional[str] = None
    asset_type: Optional[str] = None
    decision_type: str = Field(min_length=1)  # "investigation" | "priority" | "scenario"
    feedback_value: str = Field(min_length=1)  # "helpful" | "not_helpful" (aliases: confirmed/rejected)

    # Learning payload (optional)
    investigation_id: Optional[str] = None
    predicted_root_cause: Optional[str] = None
    corrected_root_cause: Optional[str] = None
    predicted_confidence: Optional[float] = None
    outcome: Optional[str] = None  # "resolved" | "recurred" | "false_alarm"

    user_comments: Optional[str] = None


class FeedbackSummary(BaseModel):
    id: int
    asset_id: Optional[str]
    asset_type: Optional[str] = None
    decision_type: str
    feedback_value: str
    investigation_id: Optional[str] = None
    predicted_root_cause: Optional[str] = None
    corrected_root_cause: Optional[str] = None
    predicted_confidence: Optional[float] = None
    outcome: Optional[str] = None
    user_comments: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# --- Learning loop transparency schemas --------------------------------------

class RootCauseLearningStat(BaseModel):
    """What OREON has learned about one (asset_type, root_cause) pair."""

    asset_type: str
    root_cause: str
    confirmations: int
    rejections: int
    samples: int
    confidence_modifier: float = Field(description="Multiplier applied to base diagnostic confidence")
    trust: float = Field(ge=0.0, le=1.0, description="Smoothed confirmation ratio")


class RootCauseCorrection(BaseModel):
    """A learned correction: when OREON predicts X for this asset type, operators
    repeatedly say the real cause is Y."""

    asset_type: str
    predicted_root_cause: str
    corrected_root_cause: str
    count: int


class LearningSummary(BaseModel):
    """Full transparency view of the feedback-driven learning state."""

    total_feedback: int
    confirmations: int
    rejections: int
    corrections_logged: int
    calibrated_pairs: list[RootCauseLearningStat]
    learned_corrections: list[RootCauseCorrection]
    boosted_root_causes: dict[str, float]
