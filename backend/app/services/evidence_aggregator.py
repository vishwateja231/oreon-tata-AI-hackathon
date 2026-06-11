"""
OREON Orchestrator — Evidence Aggregator.

Collects evidence from all tool outputs into a unified structure with source
attribution for the explainability graph. Every recommendation is traceable.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class EvidenceItem:
    """A single piece of evidence with source attribution."""

    def __init__(
        self,
        source_type: str,
        source_name: str,
        content: str,
        confidence: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ):
        self.source_type = source_type  # sensor, historical, sop, manual, model, rule
        self.source_name = source_name
        self.content = content
        self.confidence = confidence
        self.metadata = metadata or {}
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_type": self.source_type,
            "source_name": self.source_name,
            "content": self.content,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }


class EvidenceAggregator:
    """
    Aggregates evidence from multiple tool outputs into a unified,
    explainable evidence chain.
    """

    def __init__(self, db: Session) -> None:
        self._db = db
        self._evidence: list[EvidenceItem] = []

    @property
    def evidence(self) -> list[EvidenceItem]:
        return self._evidence

    def clear(self) -> None:
        self._evidence = []

    # ------------------------------------------------------------------
    # EVIDENCE COLLECTORS
    # ------------------------------------------------------------------

    def add_sensor_evidence(self, sensor_analysis: Any) -> None:
        """Extract evidence from sensor analysis results."""
        if not sensor_analysis:
            return
        for anomaly in getattr(sensor_analysis, "anomalies", []):
            self._evidence.append(EvidenceItem(
                source_type="sensor",
                source_name="Sensor Analysis Engine",
                content=anomaly,
                confidence=0.92,
                metadata={"category": "anomaly"},
            ))
        for violation in getattr(sensor_analysis, "threshold_violations", []):
            self._evidence.append(EvidenceItem(
                source_type="sensor",
                source_name="Threshold Monitor",
                content=violation,
                confidence=0.95,
                metadata={"category": "threshold_violation"},
            ))
        for indicator in getattr(sensor_analysis, "degradation_indicators", []):
            self._evidence.append(EvidenceItem(
                source_type="sensor",
                source_name="Degradation Detector",
                content=indicator,
                confidence=0.85,
                metadata={"category": "degradation"},
            ))

    def add_historical_evidence(self, incidents: list[dict[str, Any]]) -> None:
        """Extract evidence from similar historical incidents."""
        for inc in incidents[:5]:
            self._evidence.append(EvidenceItem(
                source_type="historical",
                source_name=f"Incident {inc.get('incident_id', 'unknown')}",
                content=f"{inc.get('root_cause', 'Unknown')} — "
                        f"Corrective: {inc.get('corrective_action', 'N/A')}",
                confidence=inc.get("similarity", 0.7),
                metadata={
                    "incident_id": inc.get("incident_id"),
                    "severity": inc.get("severity"),
                    "downtime_hours": inc.get("downtime_hours"),
                },
            ))

    def add_sop_evidence(self, sop_chunks: list[dict[str, Any]]) -> None:
        """Extract evidence from SOP retrieval."""
        for chunk in sop_chunks[:4]:
            self._evidence.append(EvidenceItem(
                source_type="sop",
                source_name=chunk.get("source", "SOP"),
                content=chunk.get("content", chunk.get("text", "")),
                confidence=chunk.get("relevance", 0.8),
                metadata={"section": chunk.get("section", "")},
            ))

    def add_manual_evidence(self, manual_chunks: list[dict[str, Any]]) -> None:
        """Extract evidence from manual retrieval."""
        for chunk in manual_chunks[:4]:
            self._evidence.append(EvidenceItem(
                source_type="manual",
                source_name=chunk.get("source", "Manual"),
                content=chunk.get("content", chunk.get("text", "")),
                confidence=chunk.get("relevance", 0.8),
                metadata={"section": chunk.get("section", "")},
            ))

    def add_rul_evidence(self, rul_days: int, confidence_interval: dict | None = None) -> None:
        """Add RUL prediction as evidence."""
        self._evidence.append(EvidenceItem(
            source_type="model",
            source_name="RUL Prediction Model (RandomForest)",
            content=f"Predicted remaining useful life: {rul_days} days",
            confidence=0.82,
            metadata={
                "rul_days": rul_days,
                "confidence_interval": confidence_interval,
            },
        ))

    def add_rca_evidence(self, rca_result: Any) -> None:
        """Add root cause analysis results as evidence."""
        if not rca_result:
            return
        self._evidence.append(EvidenceItem(
            source_type="rule",
            source_name="Root Cause Engine",
            content=f"Root cause: {rca_result.root_cause} — {rca_result.diagnosis}",
            confidence=rca_result.confidence,
            metadata={
                "evidence_items": rca_result.evidence,
                "recommended_actions": rca_result.recommended_actions,
            },
        ))

    def add_business_impact_evidence(self, impact: Any) -> None:
        """Add business impact data as evidence."""
        if not impact:
            return
        self._evidence.append(EvidenceItem(
            source_type="model",
            source_name="Business Impact Engine",
            content=impact.executive_summary if hasattr(impact, "executive_summary") else str(impact),
            confidence=0.88,
            metadata={
                "cost_of_inaction_inr": getattr(impact, "cost_of_inaction_inr", None),
                "downtime_hours": getattr(impact, "downtime_hours", None),
                "business_risk": getattr(impact, "business_risk", None),
            },
        ))

    # ------------------------------------------------------------------
    # AGGREGATION
    # ------------------------------------------------------------------

    def build_evidence_chain(self) -> dict[str, Any]:
        """
        Build the complete evidence chain for explainability.
        Groups evidence by source type and computes overall strength.
        """
        grouped: dict[str, list[dict]] = {}
        for item in self._evidence:
            grouped.setdefault(item.source_type, []).append(item.to_dict())

        # Compute aggregate confidence
        total_confidence = 0.0
        if self._evidence:
            total_confidence = sum(e.confidence for e in self._evidence) / len(self._evidence)

        return {
            "evidence_chain": grouped,
            "total_items": len(self._evidence),
            "aggregate_confidence": round(total_confidence, 3),
            "source_coverage": {
                "sensor": len(grouped.get("sensor", [])),
                "historical": len(grouped.get("historical", [])),
                "sop": len(grouped.get("sop", [])),
                "manual": len(grouped.get("manual", [])),
                "model": len(grouped.get("model", [])),
                "rule": len(grouped.get("rule", [])),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_summary(self) -> str:
        """One-line summary of evidence collected."""
        chain = self.build_evidence_chain()
        coverage = chain["source_coverage"]
        parts = [f"{v} {k}" for k, v in coverage.items() if v > 0]
        return f"Evidence: {chain['total_items']} items ({', '.join(parts)}), confidence {chain['aggregate_confidence']:.0%}"
