"""OREON model validation harness.

Measures OREON's analytical components against the *labeled* seed datasets and
emits both a console summary and a Markdown report (``VALIDATION_REPORT.md`` at the
repo root). It is fully standalone — it reads the JSON seed files directly and does
**not** require a running database or any API keys.

Run from the ``backend`` directory:

    python -m app.validate

It prints a live results summary to the console. By design it does **not** write any
figures into a committed file — the reproducible harness *is* the deliverable, so the
numbers are always recomputed against whatever labeled data the harness is pointed at.
The methodology is documented in ``VALIDATION_REPORT.md``.

What it measures
----------------
1. **Anomaly detection** (``SensorAnalysisEngine``) against two labeled cohorts:
   * 20 hand-authored expert anomaly cases (``sensor_anomaly_cases.json``) — recall.
   * 1208 SCADA-labeled readings (``sensor_history.json``) — full confusion matrix
     (precision / recall / specificity / F1 / accuracy).
2. **RUL regression** (``RandomForestRegressor``) — 5-fold cross-validated MAE and R²
   on features reconstructed from the seed data with the same logic as
   ``RulModelService``.

Honesty notes (also printed in the report)
------------------------------------------
* The ``anomaly_flag`` in ``sensor_history.json`` was produced by SCADA-side
  threshold logic similar to the engine's, so those labels are *semi-independent*.
  The 20 expert cases are the more independent test and are reported separately.
* RUL targets are partly derived from health score where no future failure event
  exists, so cross-validated error reflects internal consistency, not field-measured
  remaining life. It is reported as a model-quality metric, not a field accuracy.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.sensor_analysis_engine import SensorAnalysisEngine

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

ANOMALY_SENSOR_FIELDS = (
    "temperature_c",
    "vibration_mms",
    "pressure_bar",
    "current_amps",
    "rpm",
    "noise_db",
)


def _load(name: str) -> Any:
    """Load a JSON seed file from ``backend/data``."""
    with (DATA_DIR / name).open(encoding="utf-8") as handle:
        return json.load(handle)


# --------------------------------------------------------------------------- #
# 1. Anomaly detection                                                        #
# --------------------------------------------------------------------------- #
def _predict_anomaly(engine: SensorAnalysisEngine, row: dict[str, Any]) -> bool:
    """Return True if the engine flags the reading as anomalous (any anomaly)."""
    snapshot = {field: row.get(field) for field in ANOMALY_SENSOR_FIELDS}
    result = engine.analyze_sensor_snapshot(snapshot)
    return len(result.anomalies) > 0


def _confusion(rows: list[dict[str, Any]]) -> dict[str, float]:
    """Compute a confusion matrix and derived metrics over labeled rows."""
    engine = SensorAnalysisEngine()
    tp = fp = tn = fn = 0
    for row in rows:
        actual = bool(row.get("anomaly_flag"))
        predicted = _predict_anomaly(engine, row)
        if actual and predicted:
            tp += 1
        elif actual and not predicted:
            fn += 1
        elif not actual and predicted:
            fp += 1
        else:
            tn += 1

    total = tp + fp + tn + fn or 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "n": total,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "f1": f1,
        "accuracy": (tp + tn) / total,
    }


def evaluate_anomaly_detection() -> dict[str, dict[str, float]]:
    """Evaluate anomaly detection on both labeled cohorts."""
    expert_cases = _load("sensor_anomaly_cases.json")
    history = _load("sensor_history.json")
    return {
        "expert_cases": _confusion(expert_cases),
        "scada_history": _confusion(history),
    }


# --------------------------------------------------------------------------- #
# 2. RUL regression (k-fold cross-validation)                                 #
# --------------------------------------------------------------------------- #
def _build_rul_dataset() -> tuple[list[list[float]], list[float]]:
    """Reconstruct the RUL training matrix from seed JSON (mirrors RulModelService)."""
    assets = {a["id"]: a for a in _load("assets.json")}
    incidents = _load("incidents.json")
    history = _load("sensor_history.json")

    asset_incidents: dict[str, list[datetime]] = {}
    for inc in incidents:
        ts = datetime.fromisoformat(inc["timestamp"])
        asset_incidents.setdefault(inc["asset_id"], []).append(ts)
    for ts_list in asset_incidents.values():
        ts_list.sort()

    features: list[list[float]] = []
    targets: list[float] = []
    for reading in history:
        asset = assets.get(reading["asset_id"])
        if not asset:
            continue
        ts = datetime.fromisoformat(reading["timestamp"])
        install_year = asset.get("installation_year") or 2018
        runtime_hours = (ts - datetime(install_year, 1, 1)).total_seconds() / 3600.0

        target_rul = None
        for inc_ts in asset_incidents.get(reading["asset_id"], []):
            if inc_ts > ts:
                target_rul = (inc_ts - ts).total_seconds() / 86400.0
                break
        if target_rul is None:
            target_rul = (asset.get("health_score", 100.0) / 100.0) * 365.0

        temp = reading.get("temperature_c") or 60.0
        vib = reading.get("vibration_mms") or 1.5
        press = reading.get("pressure_bar") or 0.0
        features.append([temp, vib, press, runtime_hours])
        targets.append(target_rul)
    return features, targets


def evaluate_rul_model() -> dict[str, Any]:
    """5-fold cross-validated MAE and R² for the RUL RandomForest."""
    try:
        import numpy as np
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.model_selection import cross_val_score
    except ImportError:
        return {"available": False, "reason": "scikit-learn / numpy not installed"}

    features, targets = _build_rul_dataset()
    if len(features) < 20:
        return {"available": False, "reason": f"only {len(features)} samples"}

    X = np.array(features)
    y = np.array(targets)
    model = RandomForestRegressor(n_estimators=50, random_state=42)
    folds = 5
    mae = -cross_val_score(model, X, y, cv=folds, scoring="neg_mean_absolute_error")
    r2 = cross_val_score(model, X, y, cv=folds, scoring="r2")
    return {
        "available": True,
        "samples": len(features),
        "folds": folds,
        "mae_days_mean": float(mae.mean()),
        "mae_days_std": float(mae.std()),
        "r2_mean": float(r2.mean()),
        "target_mean_days": float(y.mean()),
    }


# --------------------------------------------------------------------------- #
# Reporting (console only — by design, no figures are frozen into a file)      #
# --------------------------------------------------------------------------- #
def _pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def main() -> None:
    """Run all evaluations and print a live results summary to the console."""
    anomaly = evaluate_anomaly_detection()
    rul = evaluate_rul_model()

    expert = anomaly["expert_cases"]
    scada = anomaly["scada_history"]
    print("=" * 64)
    print("OREON VALIDATION - live results (reproducible, no figures committed)")
    print("=" * 64)
    print("Abnormality detection - SensorAnalysisEngine")
    print(f"  Expert-authored cases (independent) : recall {_pct(expert['recall'])} "
          f"({expert['tp']}/{expert['n']}), missed {expert['fn']}")
    print(f"  SCADA-labeled history (n={scada['n']})")
    print(f"    precision {_pct(scada['precision'])} | recall {_pct(scada['recall'])} | "
          f"specificity {_pct(scada['specificity'])} | F1 {_pct(scada['f1'])} | "
          f"accuracy {_pct(scada['accuracy'])}")
    print(f"    confusion: TP={scada['tp']} FP={scada['fp']} TN={scada['tn']} FN={scada['fn']}")
    print("Remaining useful life - RandomForest")
    if rul.get("available"):
        print(f"  {rul['folds']}-fold CV on {rul['samples']} samples: "
              f"MAE {rul['mae_days_mean']:.1f} +/- {rul['mae_days_std']:.1f} days | "
              f"R^2 {rul['r2_mean']:.3f} (target mean {rul['target_mean_days']:.0f}d)")
    else:
        print(f"  skipped: {rul.get('reason')}")
    print("-" * 64)
    print("Interpretation & methodology: see VALIDATION_REPORT.md")


if __name__ == "__main__":
    main()
