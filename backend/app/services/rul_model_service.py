import logging
from datetime import datetime, date, timezone
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.asset import Asset
from app.models.sensor_reading import SensorReading
from app.models.incident import Incident

logger = logging.getLogger(__name__)


class RulModelService:
    """
    Predicts Remaining Useful Life (RUL) of industrial machinery using Machine Learning.
    Trains a RandomForestRegressor on database sensor history and incident records.
    """

    _model = None
    _trained = False

    def __init__(self, db: Session) -> None:
        self._db = db
        # Train model on boot if not already done
        if not RulModelService._trained:
            self._train_model()

    def _train_model(self) -> None:
        """Construct the training dataset and fit the RandomForestRegressor."""
        logger.info("Initializing RUL Machine Learning Model...")
        try:
            from sklearn.ensemble import RandomForestRegressor

            # 1. Fetch all assets
            assets = self._db.scalars(select(Asset)).all()
            if not assets:
                logger.warning("No assets in database. Skipping RUL training.")
                return
            
            asset_map = {a.id: a for a in assets}

            # 2. Fetch all incidents and group by asset
            incidents = self._db.scalars(select(Incident).order_by(Incident.timestamp.asc())).all()
            asset_incidents: dict[str, list[datetime]] = {}
            for inc in incidents:
                if inc.asset_id not in asset_incidents:
                    asset_incidents[inc.asset_id] = []
                asset_incidents[inc.asset_id].append(inc.timestamp)

            # 3. Fetch sensor readings
            readings = self._db.scalars(select(SensorReading).order_by(SensorReading.timestamp.asc())).all()
            if not readings:
                logger.warning("No sensor history found. Skipping RUL training.")
                return

            # 4. Build training vectors
            X_data = []
            y_data = []

            for r in readings:
                asset = asset_map.get(r.asset_id)
                if not asset:
                    continue

                # Compute runtime hours
                install_year = asset.installation_year or 2018
                install_date = datetime(year=install_year, month=1, day=1, tzinfo=r.timestamp.tzinfo)
                runtime_hours = (r.timestamp - install_date).total_seconds() / 3600.0

                # Compute target RUL in days
                target_rul = None
                priors = asset_incidents.get(r.asset_id, [])
                for inc_ts in priors:
                    if inc_ts > r.timestamp:
                        # Time remaining until next failure event
                        target_rul = (inc_ts - r.timestamp).total_seconds() / 86400.0
                        break
                
                if target_rul is None:
                    # If no future failure logged, derive target RUL from health score
                    target_rul = (asset.health_score / 100.0) * 365.0
                
                # Inputs: Temp, Vibration, Pressure, Runtime Hours
                temp = r.temperature_c or 60.0
                vib = r.vibration_mms or 1.5
                press = r.pressure_bar or 0.0
                
                X_data.append([temp, vib, press, runtime_hours])
                y_data.append(target_rul)

            if len(X_data) < 10:
                logger.warning("Insufficient training data for RUL regression. Skipping model fit.")
                return

            X = np.array(X_data)
            y = np.array(y_data)

            # Fit model
            model = RandomForestRegressor(n_estimators=50, random_state=42)
            model.fit(X, y)
            
            RulModelService._model = model
            RulModelService._trained = True
            logger.info("RUL RandomForestRegressor successfully trained on %d historical samples.", len(X))

        except Exception as exc:
            logger.warning("Failed to train ML RUL model: %s. Falling back to deterministic formulas.", exc)
            RulModelService._trained = False

    def predict_rul(
        self,
        asset_id: str,
        temperature: float,
        vibration: float,
        pressure: float
    ) -> tuple[float, float, float, float]:
        """
        Predict Remaining Useful Life (in days) and estimation confidence, along with RUL range.
        
        Returns:
            predicted_rul: float (days remaining)
            confidence: float (percentage 0..100)
            rul_lower: float (lower 80% confidence bound)
            rul_upper: float (upper 80% confidence bound)
        """
        asset = self._db.get(Asset, asset_id)
        if not asset:
            return 365.0, 90.0, 273.0, 456.0

        # Compute runtime hours
        install_year = asset.installation_year or 2018
        install_date = datetime(year=install_year, month=1, day=1, tzinfo=timezone.utc)
        runtime_hours = (datetime.now(timezone.utc) - install_date).total_seconds() / 3600.0

        # If model is not trained (e.g. scikit-learn is missing), use fallback regression
        if not RulModelService._trained or RulModelService._model is None:
            return self._predict_fallback(asset, temperature, vibration, pressure)

        try:
            X_input = np.array([[temperature, vibration, pressure, runtime_hours]])
            
            # Predict mean RUL
            predicted_rul = float(RulModelService._model.predict(X_input)[0])
            predicted_rul = max(1.0, round(predicted_rul, 1))

            # Compute prediction variance (standard deviation across estimators) to derive confidence
            preds = []
            for estimator in RulModelService._model.estimators_:
                preds.append(estimator.predict(X_input)[0])
            std_dev = np.std(preds)
            
            # Map standard deviation (days) to confidence (0-100)
            conf_score = max(55.0, min(99.0, 98.0 - (std_dev * 1.5)))
            
            # 80% confidence interval using percentile bounds
            rul_lower = max(1.0, float(np.percentile(preds, 10)))
            rul_upper = float(np.percentile(preds, 90))
            
            # Apply physical severity constraints. A high failure-probability or low-health
            # asset cannot have a long RUL regardless of the ML point estimate or status label
            # (guards against the model returning, e.g., 114 days for a 71%-failure asset).
            status_val = asset.status.value
            fp = asset.failure_probability or 0.0
            health = asset.health_score if asset.health_score is not None else 100.0
            if status_val == "critical" or fp >= 0.70 or health < 35:
                predicted_rul = min(predicted_rul, 10.0)
            elif status_val == "degraded" or fp >= 0.45 or health < 60:
                predicted_rul = min(predicted_rul, 30.0)
            elif status_val == "operational" and predicted_rul > 180:
                predicted_rul = min(predicted_rul, 365.0)

            # Keep the confidence interval consistent with the (possibly capped) point estimate.
            rul_upper = max(predicted_rul, min(rul_upper, predicted_rul * 1.3))
            rul_lower = max(1.0, min(rul_lower, predicted_rul))

            # Ensure bounds make sense with the capped RUL
            if rul_lower > predicted_rul:
                rul_lower = max(1.0, predicted_rul * 0.75)
            if rul_upper < predicted_rul:
                rul_upper = predicted_rul * 1.25

            # If the status is critical or degraded, cap the bounds as well to keep them realistic
            if status_val == "critical":
                rul_lower = min(rul_lower, 5.0)
                rul_upper = min(rul_upper, 14.0)
            elif status_val == "degraded":
                rul_lower = min(rul_lower, 20.0)
                rul_upper = min(rul_upper, 45.0)

            # Ensure lower bound is at least 1.0 and lower <= upper
            rul_lower = max(1.0, rul_lower)
            rul_upper = max(rul_lower, rul_upper)

            return round(predicted_rul, 1), round(conf_score, 1), round(rul_lower, 1), round(rul_upper, 1)

        except Exception as exc:
            logger.warning("ML prediction failed: %s. Using fallback.", exc)
            return self._predict_fallback(asset, temperature, vibration, pressure)

    def _predict_fallback(
        self,
        asset: Asset,
        temperature: float,
        vibration: float,
        pressure: float
    ) -> tuple[float, float, float, float]:
        """Resilient fallback mathematical formula representing asset degradation RUL."""
        health = asset.health_score
        status_val = asset.status.value
        
        # Base RUL estimate based on health score
        base_rul = (health / 100.0) * 250.0
        
        # Penalize for severe sensor spikes
        penalty = 1.0
        if vibration > 7.0:
            penalty *= 0.15
        elif vibration > 4.5:
            penalty *= 0.45
            
        if temperature > 90.0:
            penalty *= 0.25
        elif temperature > 80.0:
            penalty *= 0.55

        predicted_rul = base_rul * penalty
        if status_val == "critical":
            predicted_rul = min(predicted_rul, 7.0)
        elif status_val == "degraded":
            predicted_rul = min(predicted_rul, 25.0)
            
        predicted_rul = max(1.0, round(predicted_rul, 1))
        
        # Simple confidence formula based on health score and sensor deviation
        conf = 85.0
        if vibration > 4.5 or temperature > 80.0:
            conf -= 15.0
        if status_val == "critical":
            conf += 10.0 # We are very confident it's critical
            
        # Calculate bounds
        rul_lower = max(1.0, predicted_rul * 0.75)
        rul_upper = predicted_rul * 1.25
            
        return round(predicted_rul, 1), round(conf, 1), round(rul_lower, 1), round(rul_upper, 1)

