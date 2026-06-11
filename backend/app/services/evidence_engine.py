from app.schemas.investigation import EvidenceBundle, KnowledgeChunk, SensorAnalysisResult


class EvidenceEngine:
    """Builds explainable evidence bundles for investigation reports."""

    def build_evidence(
        self,
        sensor_analysis: SensorAnalysisResult,
        manual_chunks: list[KnowledgeChunk],
        sop_chunks: list[KnowledgeChunk],
        incidents: list[dict],
    ) -> EvidenceBundle:
        sensor_evidence = (
            sensor_analysis.anomalies
            + sensor_analysis.threshold_violations
            + sensor_analysis.degradation_indicators
            + sensor_analysis.risk_indicators
            + sensor_analysis.trend_summary.get("trend_indicators", [])
        )
        return EvidenceBundle(
            sensor_evidence=list(dict.fromkeys(sensor_evidence)),
            manual_evidence=manual_chunks,
            sop_evidence=sop_chunks,
            historical_evidence=incidents,
        )
