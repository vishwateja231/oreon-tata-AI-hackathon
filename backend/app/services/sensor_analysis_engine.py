from statistics import mean
from typing import Any, Mapping, Optional

from app.models.sensor_reading import SensorReading
from app.schemas.investigation import SensorAnalysisResult, SensorSnapshot


class SensorAnalysisEngine:
    """Analyzes sensor snapshots and historical trends for industrial anomalies."""

    THRESHOLDS = {
        "temperature_c": {"warning": 80.0, "critical": 90.0},
        "vibration_mms": {"warning": 4.5, "critical": 7.0},
        "current_amps": {"warning": 55.0, "critical": 70.0},
        "pressure_bar_low": {"warning": 2.5, "critical": 1.5},
        "pressure_bar_high": {"warning": 8.0, "critical": 10.0},
        "noise_db": {"warning": 88.0, "critical": 95.0},
    }

    def analyze_sensor_snapshot(self, snapshot: SensorSnapshot | Mapping[str, Any]) -> SensorAnalysisResult:
        normalized = self._normalize_snapshot(snapshot)
        anomalies: list[str] = []
        violations: list[str] = []
        degradation: list[str] = []
        risks: list[str] = []

        self._check_high("temperature_c", normalized, anomalies, violations, risks)
        self._check_high("vibration_mms", normalized, anomalies, violations, risks)
        self._check_high("current_amps", normalized, anomalies, violations, risks)
        self._check_high("noise_db", normalized, anomalies, violations, risks)
        self._check_pressure(normalized, anomalies, violations, risks)

        if (normalized.get("temperature_c") or 0) >= 80 and (normalized.get("vibration_mms") or 0) >= 4.5:
            degradation.append("Combined heat and vibration signature indicates rotating component degradation")
        if (normalized.get("current_amps") or 0) >= 55 and (normalized.get("temperature_c") or 0) >= 80:
            degradation.append("Electrical loading is increasing thermal stress")
        pressure_val = normalized.get("pressure_bar")
        if pressure_val is not None and pressure_val <= 2.5 and (normalized.get("vibration_mms") or 0) >= 4.5:
            degradation.append("Low pressure with elevated vibration indicates flow instability or cavitation")

        return SensorAnalysisResult(
            anomalies=anomalies,
            threshold_violations=violations,
            degradation_indicators=degradation,
            risk_indicators=risks,
            normalized_snapshot=normalized,
        )

    def analyze_sensor_trends(self, readings: list[SensorReading]) -> dict[str, Any]:
        if not readings:
            return {"reading_count": 0, "metrics": {}, "trend_indicators": []}
        ordered = sorted(readings, key=lambda item: item.timestamp)
        metrics: dict[str, dict[str, Optional[float]]] = {}
        trend_indicators = []
        for field in ["temperature_c", "vibration_mms", "current_amps", "pressure_bar", "rpm", "noise_db"]:
            values = [getattr(item, field) for item in ordered if getattr(item, field) is not None]
            if not values:
                continue
            delta = values[-1] - values[0]
            metrics[field] = {
                "min": round(min(values), 3),
                "max": round(max(values), 3),
                "avg": round(mean(values), 3),
                "latest": round(values[-1], 3),
                "delta": round(delta, 3),
            }
            if field in {"temperature_c", "vibration_mms", "current_amps", "noise_db"} and delta > 0:
                trend_indicators.append(f"{field} increased by {round(delta, 2)} over the retrieved window")
            if field == "pressure_bar" and delta < 0:
                trend_indicators.append(f"pressure_bar decreased by {round(abs(delta), 2)} over the retrieved window")
        return {
            "reading_count": len(readings),
            "anomaly_count": sum(1 for item in readings if item.anomaly_flag),
            "metrics": metrics,
            "trend_indicators": trend_indicators,
        }

    def _normalize_snapshot(self, snapshot: SensorSnapshot | Mapping[str, Any]) -> dict[str, Optional[float]]:
        data = snapshot.model_dump() if isinstance(snapshot, SensorSnapshot) else dict(snapshot)
        return {
            "temperature_c": data.get("temperature_c", data.get("temperature")),
            "vibration_mms": data.get("vibration_mms", data.get("vibration")),
            "pressure_bar": data.get("pressure_bar", data.get("pressure")),
            "current_amps": data.get("current_amps", data.get("current")),
            "rpm": data.get("rpm"),
            "noise_db": data.get("noise_db"),
        }

    def _check_high(
        self,
        field: str,
        normalized: dict[str, Optional[float]],
        anomalies: list[str],
        violations: list[str],
        risks: list[str],
    ) -> None:
        value = normalized.get(field)
        if value is None:
            return
        threshold = self.THRESHOLDS[field]
        if value >= threshold["critical"]:
            anomalies.append(f"Critical {field} anomaly: {value}")
            violations.append(f"{field} exceeded critical threshold {threshold['critical']}")
            risks.append(f"{field} creates immediate failure risk")
        elif value >= threshold["warning"]:
            anomalies.append(f"Warning {field} anomaly: {value}")
            violations.append(f"{field} exceeded warning threshold {threshold['warning']}")

    def _check_pressure(
        self,
        normalized: dict[str, Optional[float]],
        anomalies: list[str],
        violations: list[str],
        risks: list[str],
    ) -> None:
        value = normalized.get("pressure_bar")
        if value is None:
            return
        if value <= self.THRESHOLDS["pressure_bar_low"]["critical"]:
            anomalies.append(f"Critical low pressure anomaly: {value}")
            violations.append("pressure_bar below critical low threshold 1.5")
            risks.append("Low pressure may starve pump or cooling circuits")
        elif value <= self.THRESHOLDS["pressure_bar_low"]["warning"]:
            anomalies.append(f"Warning low pressure anomaly: {value}")
            violations.append("pressure_bar below warning low threshold 2.5")
        elif value >= self.THRESHOLDS["pressure_bar_high"]["critical"]:
            anomalies.append(f"Critical high pressure anomaly: {value}")
            violations.append("pressure_bar exceeded critical high threshold 10.0")
            risks.append("High pressure may rupture seals or piping")
        elif value >= self.THRESHOLDS["pressure_bar_high"]["warning"]:
            anomalies.append(f"Warning high pressure anomaly: {value}")
            violations.append("pressure_bar exceeded warning high threshold 8.0")
