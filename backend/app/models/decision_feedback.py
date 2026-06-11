from typing import Optional
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin


class DecisionFeedback(Base, TimestampMixin):
    """Stores operator feedback on OREON recommendations and feeds the learning loop.

    Beyond a simple Helpful/Not Helpful signal, this table captures the *correction*
    payload that lets OREON re-rank and re-calibrate future recommendations:
    what OREON predicted, what the operator says the real cause was, and the
    eventual outcome. ``FeedbackLearningService`` aggregates these rows into
    deterministic confidence modifiers and root-cause correction hints.
    """

    __tablename__ = "decision_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    # Equipment type (e.g. "motor", "pump") — the granularity at which the loop learns,
    # so a confirmation on one motor improves confidence for all motors.
    asset_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    decision_type: Mapped[str] = mapped_column(String(64), nullable=False)  # "investigation" | "priority" | "scenario"
    feedback_value: Mapped[str] = mapped_column(String(32), nullable=False)  # "helpful" | "not_helpful"

    # Learning payload — all optional so legacy thumbs-up/down feedback still works.
    investigation_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    predicted_root_cause: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    corrected_root_cause: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    predicted_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    outcome: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # "resolved" | "recurred" | "false_alarm"

    user_comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<DecisionFeedback id={self.id} type={self.decision_type} val={self.feedback_value}>"
