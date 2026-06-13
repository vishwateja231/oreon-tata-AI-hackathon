import logging
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.schemas.investigation import (
    InvestigationReport,
    InvestigationRequest,
    LearningSignals,
    RootCauseResult,
)
from app.services.asset_service import AssetService
from app.services.dual_retrieval_service import DualRetrievalService
from app.services.evidence_engine import EvidenceEngine
from app.services.feedback_learning_service import FeedbackLearningService
from app.services.incident_retrieval_service import IncidentRetrievalService
from app.services.investigation_reasoning_service import InvestigationReasoningService
from app.services.plant_graph_service import PlantGraphService
from app.services.root_cause_engine import RootCauseEngine
from app.services.sensor_analysis_engine import SensorAnalysisEngine
from app.services.sensor_service import SensorService

logger = logging.getLogger(__name__)


INVESTIGATION_TIMELINE = [
    "Loading Asset",
    "Analyzing Sensors",
    "Searching Manuals",
    "Searching SOPs",
    "Searching Historical Incidents",
    "Running Root Cause Analysis",
    "Generating Evidence",
    "Building Report",
]


class InvestigationService:
    """Orchestrates complete OREON industrial investigations."""

    def __init__(
        self,
        db: Session,
        sensor_engine: SensorAnalysisEngine | None = None,
        root_cause_engine: RootCauseEngine | None = None,
        evidence_engine: EvidenceEngine | None = None,
        reasoning_service: InvestigationReasoningService | None = None,
        graph_service: PlantGraphService | None = None,
    ) -> None:
        self._db = db
        self.asset_service = AssetService(db)
        self.sensor_service = SensorService(db)
        self.sensor_engine = sensor_engine or SensorAnalysisEngine()
        self.root_cause_engine = root_cause_engine or RootCauseEngine()
        self.evidence_engine = evidence_engine or EvidenceEngine()
        self.reasoning_service = reasoning_service or InvestigationReasoningService()
        self.graph_service = graph_service or PlantGraphService()
        self.dual_retrieval_service = DualRetrievalService(db)
        self.incident_retrieval_service = IncidentRetrievalService(db)
        self.feedback_learning_service = FeedbackLearningService(db)

    def investigate(self, request: InvestigationRequest, *, with_explanation: bool = True) -> InvestigationReport:
        import json
        # Non-streaming callers (e.g. PDF/report export) don't need UI pacing; skip the
        # cosmetic sleeps. `with_explanation=False` also skips the slow LLM narration for
        # consumers (like the PDF) that only render the deterministic fields.
        for chunk in self.investigate_stream(request, with_explanation=with_explanation, pace=False):
            data = json.loads(chunk.strip())
            if data.get("progress") == "COMPLETE":
                return InvestigationReport(**data["report"])
        raise RuntimeError("Failed to generate investigation report")

    def investigate_stream(self, request: InvestigationRequest, *, with_explanation: bool = True, pace: bool = True):
        import json
        import time
        asset = self.asset_service.get_by_id(request.asset_id)
        if not asset:
            raise ValueError(f"Asset '{request.asset_id}' not found")

        logger.info("Starting investigation for asset %s", asset.id)
        def _pause(seconds: float) -> None:
            # Cosmetic pacing for the streaming UI only; skipped for non-streaming callers.
            if pace:
                time.sleep(seconds)

        yield json.dumps({"progress": "Loading Asset"}) + "\n"
        _pause(0.4)

        yield json.dumps({"progress": "Analyzing Sensors"}) + "\n"
        sensor_history = self.sensor_service.get_by_asset(asset.id, limit=250)
        sensor_analysis = self.sensor_engine.analyze_sensor_snapshot(request.sensor_snapshot)
        trend_summary = self.sensor_engine.analyze_sensor_trends(sensor_history)
        sensor_analysis.trend_summary = trend_summary

        yield json.dumps({"progress": "Searching Manuals"}) + "\n"
        _pause(0.6)
        yield json.dumps({"progress": "Searching SOPs"}) + "\n"
        _pause(0.6)
        yield json.dumps({"progress": "Searching Historical Incidents"}) + "\n"

        retrieval_query = self._build_query(asset, request)
        retrieval = self.dual_retrieval_service.retrieve(
            query=retrieval_query,
            asset_type=asset.equipment_type,
            limit=5,
        )
        procedural = retrieval["procedural_knowledge"]
        historical = retrieval["historical_knowledge"]
        manual_chunks = [chunk for chunk in procedural if "manual" in chunk.source_document.lower()]
        sop_chunks = [chunk for chunk in procedural if "sop" in chunk.source_document.lower()]

        yield json.dumps({"progress": "Running Root Cause Analysis"}) + "\n"
        root_cause = self.root_cause_engine.analyze(
            asset_type=asset.equipment_type,
            fault_description=request.fault_description,
            sensor_analysis=sensor_analysis,
            confidence_adjuster=self.feedback_learning_service.confidence_modifier,
        )

        # Feedback-driven re-ranking: promote historical incidents whose root cause
        # operators have validated, demote ones they have rejected.
        historical = self.feedback_learning_service.rerank_incidents(historical)
        retrieval["historical_knowledge"] = historical

        learning_signals = self._build_learning_signals(asset, root_cause, historical)

        yield json.dumps({"progress": "Generating Evidence"}) + "\n"
        _pause(0.5)
        evidence = self.evidence_engine.build_evidence(
            sensor_analysis=sensor_analysis,
            manual_chunks=manual_chunks,
            sop_chunks=sop_chunks,
            incidents=historical,
        )
        risk_level = self._risk_level(asset, root_cause.confidence, sensor_analysis)
        next_steps = self._next_steps(asset, risk_level)

        # Surface a learned operator correction as a high-priority recommendation.
        feedback_actions: list[str] = []
        if learning_signals.suggested_alternative_cause:
            feedback_actions.append(
                f"Operator feedback flag: previous '{root_cause.root_cause}' diagnoses on "
                f"{asset.equipment_type} assets were corrected to "
                f"'{learning_signals.suggested_alternative_cause}' "
                f"({learning_signals.alternative_support}x) - verify this cause before acting."
            )

        # Calculate RUL bounds and confidence
        from app.services.rul_model_service import RulModelService
        from app.services.sensor_service import SensorService
        try:
            sensor_svc = SensorService(self._db)
            readings = sensor_svc.get_by_asset(asset.id, limit=1)
            temp = readings[0].temperature_c if readings else 75.0
            vib = readings[0].vibration_mms if readings else 2.5
            press = readings[0].pressure_bar if readings else 4.0
            if temp is None: temp = 75.0
            if vib is None: vib = 2.5
            if press is None: press = 4.0
            
            rul_svc = RulModelService(self._db)
            pred_rul, conf, rul_lower, rul_upper = rul_svc.predict_rul(asset.id, temp, vib, press)
        except Exception:
            pred_rul = asset.rul_days or 30
            conf = 80.0
            rul_lower = max(1.0, pred_rul * 0.7)
            rul_upper = pred_rul * 1.3

        yield json.dumps({"progress": "Building Report"}) + "\n"
        _pause(0.5)

        report = InvestigationReport(
            asset_id=asset.id,
            asset_name=asset.name,
            investigation_id=f"INV-{uuid4().hex[:12].upper()}",
            diagnosis=root_cause.diagnosis,
            root_cause=root_cause.root_cause,
            confidence=root_cause.confidence,
            risk_level=risk_level,
            rul_days=int(pred_rul),
            rul_lower=round(rul_lower, 1),
            rul_upper=round(rul_upper, 1),
            rul_confidence=round(conf, 1),
            evidence=evidence,
            similar_incidents=historical,
            recommended_actions=feedback_actions
            + root_cause.recommended_actions
            + self._historical_actions(historical),
            next_steps=next_steps,
            timeline=INVESTIGATION_TIMELINE,
            procedural_knowledge=procedural,
            historical_knowledge=historical,
            learning_signals=learning_signals,
        )
        # The LLM narration is the slowest step. Callers that only need the deterministic
        # report (e.g. PDF export) pass with_explanation=False to skip it entirely.
        if with_explanation:
            report.llm_explanation = self.reasoning_service.explain(
                report=report,
                asset_context=self._asset_context(asset),
                plant_context=self.graph_service.get_direct_dependencies(asset.id),
            )
        
        # Save to Maintenance Logbook
        try:
            from app.models.maintenance_log import MaintenanceLog
            log_entry = MaintenanceLog(
                asset_id=asset.id,
                issue=request.fault_description,
                root_cause=root_cause.root_cause,
                action="; ".join(report.recommended_actions[:3])
            )
            self._db.add(log_entry)
            self._db.commit()
        except Exception as exc:
            logger.warning("Failed to auto-log investigation: %s", exc)

        yield json.dumps({"progress": "COMPLETE", "report": report.model_dump()}) + "\n"

    def _build_query(self, asset: Asset, request: InvestigationRequest) -> str:
        snapshot = request.sensor_snapshot.model_dump(exclude_none=True)
        return (
            f"{asset.equipment_type} {asset.name} {request.fault_description} "
            f"health {asset.health_score} failure probability {asset.failure_probability} "
            f"sensors {snapshot}"
        )

    def _risk_level(self, asset: Asset, confidence: float, sensor_analysis) -> str:
        critical_signal_count = sum(1 for item in sensor_analysis.threshold_violations if "critical" in item.lower())
        if asset.status.value == "critical" or asset.rul_days <= 7 or critical_signal_count >= 2:
            return "critical"
        if asset.failure_probability >= 0.65 or confidence >= 0.85 or asset.rul_days <= 21:
            return "high"
        if asset.failure_probability >= 0.35 or sensor_analysis.anomalies:
            return "medium"
        return "low"

    def _next_steps(self, asset: Asset, risk_level: str) -> list[str]:
        steps = [
            "Attach vibration spectrum, thermal image, and operator notes to the work order",
            "Confirm findings against the retrieved SOP before intervention",
        ]
        if risk_level in {"critical", "high"}:
            steps.insert(0, "Notify maintenance planner and prepare controlled shutdown window")
        if asset.rul_days <= 14:
            steps.append("Expedite spare part availability check because RUL is short")
        return steps

    def _historical_actions(self, incidents: list[dict]) -> list[str]:
        actions = [item["corrective_action"] for item in incidents[:3]]
        return list(dict.fromkeys(actions))

    def _build_learning_signals(
        self,
        asset: Asset,
        root_cause: RootCauseResult,
        incidents: list[dict],
    ) -> LearningSignals:
        """Assemble the closed-loop transparency payload for this investigation."""
        learner = self.feedback_learning_service
        modifier = learner.confidence_modifier(asset.equipment_type, root_cause.root_cause)
        alt_cause, alt_support = learner.suggested_correction(
            asset.equipment_type, root_cause.root_cause
        )
        reranked = any("feedback_boost" in inc for inc in incidents)
        summary = learner.learning_summary(asset.equipment_type)
        samples = sum(p["samples"] for p in summary["calibrated_pairs"])

        reason = None
        if root_cause.feedback_adjusted:
            direction = "raised" if modifier > 1.0 else "lowered"
            reason = (
                f"Confidence {direction} by operator feedback on '{root_cause.root_cause}' "
                f"for {asset.equipment_type} assets (modifier {modifier:.2f})."
            )

        return LearningSignals(
            confidence_adjusted=root_cause.feedback_adjusted,
            base_confidence=root_cause.base_confidence,
            adjusted_confidence=root_cause.confidence,
            confidence_modifier=modifier,
            adjustment_reason=reason,
            suggested_alternative_cause=alt_cause,
            alternative_support=alt_support,
            incidents_reranked=reranked,
            feedback_samples_considered=samples,
        )

    def _asset_context(self, asset: Asset) -> dict:
        return {
            "asset_id": asset.id,
            "name": asset.name,
            "equipment_type": asset.equipment_type,
            "criticality": asset.criticality.value,
            "status": asset.status.value,
            "health_score": asset.health_score,
            "failure_probability": asset.failure_probability,
            "rul_days": asset.rul_days,
            "location": asset.location,
            "production_line": asset.production_line,
        }
