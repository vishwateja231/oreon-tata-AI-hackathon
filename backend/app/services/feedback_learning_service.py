"""Feedback-driven learning loop for OREON.

This service closes the loop required by the problem statement: *"user corrections,
confirmations, or outcomes can be used to improve future recommendations."*

It is **deterministic** — consistent with OREON's architecture where engines decide
and the LLM only narrates. It reads accumulated ``DecisionFeedback`` rows and derives:

1. **Confidence calibration** — a per ``(asset_type, root_cause)`` multiplier that
   raises or lowers the deterministic diagnostic confidence based on whether operators
   have historically confirmed or rejected that diagnosis.
2. **Root-cause corrections** — when operators repeatedly correct prediction *X* to
   actual cause *Y* for an equipment type, OREON surfaces *Y* as a learned alternative.
3. **Incident re-ranking boosts** — historical incidents whose root cause has earned
   operator trust are promoted (and rejected ones demoted) in retrieval.

The learning is online: every new piece of feedback immediately changes the next
investigation. No batch retraining step is required.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.decision_feedback import DecisionFeedback

logger = logging.getLogger(__name__)

# --- Tunable learning constants ---------------------------------------------
_CONFIRM_VALUES = {"helpful", "confirmed", "positive", "accurate", "correct", "up", "yes"}
_REJECT_VALUES = {"not_helpful", "rejected", "negative", "inaccurate", "wrong", "down", "no"}
_CONFIRM_OUTCOMES = {"resolved", "fixed", "confirmed"}
_REJECT_OUTCOMES = {"recurred", "false_alarm", "misdiagnosed"}

_MIN_SAMPLES = 2          # need at least this many signals before adjusting confidence
_MIN_CORRECTION = 2       # need this many identical corrections before suggesting one
_MAX_BOOST = 0.12         # confidence may be lifted at most +12%
_MAX_PENALTY = 0.30       # confidence may be cut at most -30% (penalise harder than reward)
_BOOST_SCALE = 0.30       # incident re-rank boost magnitude
_CONF_FLOOR = 0.05
_CONF_CEIL = 0.97


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


@dataclass
class _Tally:
    confirmations: int = 0
    rejections: int = 0
    corrections: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    @property
    def samples(self) -> int:
        return self.confirmations + self.rejections

    @property
    def trust(self) -> float:
        """Laplace-smoothed confirmation ratio. Neutral (0.5) with no evidence."""
        return (self.confirmations + 1) / (self.confirmations + self.rejections + 2)


class FeedbackLearningService:
    """Aggregates operator feedback into deterministic learning signals."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._loaded = False
        # keyed by (asset_type, root_cause)
        self._pairs: dict[tuple[str, str], _Tally] = defaultdict(_Tally)
        # keyed by asset_type only (legacy thumbs feedback with no root cause)
        self._by_type: dict[str, _Tally] = defaultdict(_Tally)
        self._rows: list[DecisionFeedback] = []

    # --- ingestion -----------------------------------------------------------
    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        try:
            self._rows = list(self._db.scalars(select(DecisionFeedback)).all())
        except Exception as exc:  # pragma: no cover - defensive against missing table
            logger.warning("FeedbackLearningService could not load feedback: %s", exc)
            self._rows = []
        for row in self._rows:
            self._ingest(row)
        self._loaded = True

    def _ingest(self, row: DecisionFeedback) -> None:
        value = _norm(row.feedback_value)
        outcome = _norm(row.outcome)
        predicted = _norm(row.predicted_root_cause)
        corrected = _norm(row.corrected_root_cause)
        asset_type = _norm(row.asset_type)

        # A correction (real cause differs from prediction) is itself a rejection.
        is_correction = bool(corrected and predicted and corrected != predicted)
        confirmed = (
            value in _CONFIRM_VALUES or outcome in _CONFIRM_OUTCOMES
        ) and not is_correction
        rejected = (
            value in _REJECT_VALUES or outcome in _REJECT_OUTCOMES or is_correction
        )

        type_tally = self._by_type[asset_type] if asset_type else None
        pair_tally = self._pairs[(asset_type, predicted)] if (asset_type and predicted) else None

        if confirmed:
            if pair_tally is not None:
                pair_tally.confirmations += 1
            if type_tally is not None:
                type_tally.confirmations += 1
        elif rejected:
            if pair_tally is not None:
                pair_tally.rejections += 1
            if type_tally is not None:
                type_tally.rejections += 1

        if is_correction and asset_type and predicted:
            self._pairs[(asset_type, predicted)].corrections[corrected] += 1

    # --- learning signals ----------------------------------------------------
    def _modifier_from_tally(self, tally: _Tally) -> float:
        if tally.samples < _MIN_SAMPLES:
            return 1.0
        net = tally.trust - 0.5  # range [-0.5, 0.5]
        if net >= 0:
            return round(1.0 + (net / 0.5) * _MAX_BOOST, 4)
        return round(1.0 + (net / 0.5) * _MAX_PENALTY, 4)

    def confidence_modifier(self, asset_type: str | None, root_cause: str | None) -> float:
        """Multiplier (≈0.70–1.12) to apply to a deterministic diagnostic confidence.

        Falls back from the specific ``(asset_type, root_cause)`` pair to an
        ``asset_type``-level signal, then to neutral (1.0) when evidence is thin.
        """
        self._ensure_loaded()
        at, rc = _norm(asset_type), _norm(root_cause)
        pair = self._pairs.get((at, rc))
        if pair and pair.samples >= _MIN_SAMPLES:
            return self._modifier_from_tally(pair)
        type_tally = self._by_type.get(at)
        if type_tally and type_tally.samples >= _MIN_SAMPLES:
            return self._modifier_from_tally(type_tally)
        return 1.0

    def adjust_confidence(self, base: float, asset_type: str | None, root_cause: str | None) -> float:
        """Apply the learned modifier to a base confidence, clamped to a safe range."""
        modifier = self.confidence_modifier(asset_type, root_cause)
        return round(min(_CONF_CEIL, max(_CONF_FLOOR, base * modifier)), 4)

    def suggested_correction(self, asset_type: str | None, root_cause: str | None) -> tuple[str | None, int]:
        """Return the most frequently logged operator correction for this prediction,
        or ``(None, 0)`` if none has reached the support threshold."""
        self._ensure_loaded()
        tally = self._pairs.get((_norm(asset_type), _norm(root_cause)))
        if not tally or not tally.corrections:
            return None, 0
        cause, count = max(tally.corrections.items(), key=lambda kv: kv[1])
        if count >= _MIN_CORRECTION:
            return cause, count
        return None, 0

    def incident_boosts(self) -> dict[str, float]:
        """Map of root_cause -> re-rank boost (positive for trusted, negative for rejected).

        Used to promote/demote historical incidents during retrieval.
        """
        self._ensure_loaded()
        boosts: dict[str, float] = {}
        agg: dict[str, _Tally] = defaultdict(_Tally)
        for (_, rc), tally in self._pairs.items():
            if not rc:
                continue
            agg[rc].confirmations += tally.confirmations
            agg[rc].rejections += tally.rejections
        for rc, tally in agg.items():
            if tally.samples < _MIN_SAMPLES:
                continue
            boosts[rc] = round((tally.trust - 0.5) * _BOOST_SCALE, 4)
        return boosts

    def rerank_incidents(self, incidents: list[dict]) -> list[dict]:
        """Re-order similar incidents by combining text similarity with learned trust.

        Each incident keeps its original ``similarity``; we add a ``feedback_boost``
        and sort by the adjusted score so operator-validated root causes rise.
        """
        boosts = self.incident_boosts()
        if not boosts:
            return incidents
        for inc in incidents:
            boost = boosts.get(_norm(inc.get("root_cause")), 0.0)
            inc["feedback_boost"] = boost
            inc["adjusted_score"] = round(float(inc.get("similarity", 0.0)) + boost, 4)
        return sorted(incidents, key=lambda i: i.get("adjusted_score", 0.0), reverse=True)

    # --- transparency --------------------------------------------------------
    def learning_summary(self, asset_type: str | None = None) -> dict:
        """Human/JSON-readable view of everything the loop has learned."""
        self._ensure_loaded()
        filt = _norm(asset_type) if asset_type else None

        calibrated = []
        corrections = []
        for (at, rc), tally in self._pairs.items():
            if not at or not rc:
                continue
            if filt and at != filt:
                continue
            calibrated.append(
                {
                    "asset_type": at,
                    "root_cause": rc,
                    "confirmations": tally.confirmations,
                    "rejections": tally.rejections,
                    "samples": tally.samples,
                    "confidence_modifier": self._modifier_from_tally(tally),
                    "trust": round(tally.trust, 4),
                }
            )
            for corrected, count in tally.corrections.items():
                if count >= _MIN_CORRECTION:
                    corrections.append(
                        {
                            "asset_type": at,
                            "predicted_root_cause": rc,
                            "corrected_root_cause": corrected,
                            "count": count,
                        }
                    )

        calibrated.sort(key=lambda c: c["samples"], reverse=True)
        corrections.sort(key=lambda c: c["count"], reverse=True)

        confirmations = sum(t.confirmations for t in self._pairs.values())
        rejections = sum(t.rejections for t in self._pairs.values())
        corrections_logged = sum(
            sum(t.corrections.values()) for t in self._pairs.values()
        )

        return {
            "total_feedback": len(self._rows),
            "confirmations": confirmations,
            "rejections": rejections,
            "corrections_logged": corrections_logged,
            "calibrated_pairs": calibrated,
            "learned_corrections": corrections,
            "boosted_root_causes": self.incident_boosts(),
        }
