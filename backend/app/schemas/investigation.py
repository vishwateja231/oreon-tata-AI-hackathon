from typing import Any, Optional

from pydantic import BaseModel, Field


class SensorSnapshot(BaseModel):
    """Point-in-time sensor payload supplied by an operator or SCADA client."""

    temperature: Optional[float] = None
    temperature_c: Optional[float] = None
    vibration: Optional[float] = None
    vibration_mms: Optional[float] = None
    pressure: Optional[float] = None
    pressure_bar: Optional[float] = None
    current: Optional[float] = None
    current_amps: Optional[float] = None
    rpm: Optional[float] = None
    noise_db: Optional[float] = None


class InvestigationRequest(BaseModel):
    """Request body for the OREON investigation workflow."""

    asset_id: str = Field(min_length=1)
    fault_description: str = Field(min_length=1)
    sensor_snapshot: SensorSnapshot = Field(default_factory=SensorSnapshot)


class KnowledgeChunk(BaseModel):
    text: str
    source_document: str
    confidence: float = Field(ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class IncidentPatternSummary(BaseModel):
    top_similar_incidents: list[dict[str, Any]]
    most_common_root_causes: list[dict[str, Any]]
    average_downtime: float
    average_repair_time: float
    successful_corrective_actions: list[str]


class SensorAnalysisResult(BaseModel):
    anomalies: list[str]
    threshold_violations: list[str]
    degradation_indicators: list[str]
    risk_indicators: list[str]
    normalized_snapshot: dict[str, Optional[float]]
    trend_summary: dict[str, Any] = Field(default_factory=dict)


class RootCauseResult(BaseModel):
    root_cause: str
    confidence: float = Field(ge=0.0, le=1.0)
    diagnosis: str
    evidence: list[str]
    recommended_actions: list[str]
    base_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    feedback_adjusted: bool = False


class LearningSignals(BaseModel):
    """Explains how operator feedback shaped this investigation (closed-loop transparency)."""

    confidence_adjusted: bool = False
    base_confidence: Optional[float] = None
    adjusted_confidence: Optional[float] = None
    confidence_modifier: float = 1.0
    adjustment_reason: Optional[str] = None
    suggested_alternative_cause: Optional[str] = None
    alternative_support: int = 0
    incidents_reranked: bool = False
    feedback_samples_considered: int = 0


class EvidenceBundle(BaseModel):
    sensor_evidence: list[str]
    manual_evidence: list[KnowledgeChunk]
    sop_evidence: list[KnowledgeChunk]
    historical_evidence: list[dict[str, Any]]


class ReasoningNarrative(BaseModel):
    natural_language_explanation: str
    manager_summary: str
    engineer_summary: str
    risk_explanation: str
    maintenance_recommendation: str


class InvestigationReport(BaseModel):
    asset_id: str
    asset_name: str
    investigation_id: str
    diagnosis: str
    root_cause: str
    confidence: float = Field(ge=0.0, le=1.0)
    risk_level: str
    rul_days: int
    evidence: EvidenceBundle
    similar_incidents: list[dict[str, Any]]
    recommended_actions: list[str]
    next_steps: list[str]
    timeline: list[str]
    procedural_knowledge: list[KnowledgeChunk]
    historical_knowledge: list[dict[str, Any]]
    rul_lower: Optional[float] = None
    rul_upper: Optional[float] = None
    rul_confidence: Optional[float] = None
    llm_explanation: Optional[ReasoningNarrative] = None
    learning_signals: Optional[LearningSignals] = None



class InvestigationTimelineResponse(BaseModel):
    steps: list[str]
