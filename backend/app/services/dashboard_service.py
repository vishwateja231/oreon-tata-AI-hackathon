import time
from sqlalchemy.orm import Session

from app.models.asset import AssetStatus
from app.schemas.dashboard import ActiveAlert, DashboardResponse, PredictedFailure
from app.schemas.asset import AssetSummary
from app.schemas.spare_part import SparePartSummary
from app.services.asset_service import AssetService
from app.services.spare_part_service import SparePartService

# Cache variables for fast dashboard loads
_DASHBOARD_CACHE = None
_DASHBOARD_CACHE_EXPIRY = 0.0
CACHE_TTL_SECONDS = 2.0

def clear_dashboard_cache() -> None:
    global _DASHBOARD_CACHE, _DASHBOARD_CACHE_EXPIRY
    _DASHBOARD_CACHE = None
    _DASHBOARD_CACHE_EXPIRY = 0.0

_FAILURE_RECOMMENDATION: dict[str, str] = {
    "critical": "Schedule emergency maintenance within 24 hours",
    "high": "Schedule maintenance within 72 hours",
    "medium": "Schedule maintenance within 7 days",
    "low": "Monitor and schedule at next planned window",
}


class DashboardService:
    """Aggregates plant-wide KPIs for the operational dashboard."""

    def __init__(self, db: Session) -> None:
        self._db = db
        self._asset_svc = AssetService(db)
        self._spare_svc = SparePartService(db)

    def get_dashboard(self) -> DashboardResponse:
        global _DASHBOARD_CACHE, _DASHBOARD_CACHE_EXPIRY
        if _DASHBOARD_CACHE is not None and time.time() < _DASHBOARD_CACHE_EXPIRY:
            return _DASHBOARD_CACHE

        all_assets = self._asset_svc.get_all(limit=1000)
        critical_assets = self._asset_svc.get_critical_assets()
        predicted_failures = self._asset_svc.get_predicted_failures(threshold=0.4)
        low_stock_parts = self._spare_svc.get_low_stock()

        alerts = self._build_alerts(critical_assets, predicted_failures)

        operational = sum(1 for a in all_assets if a.status == AssetStatus.OPERATIONAL)
        in_maintenance = sum(1 for a in all_assets if a.status == AssetStatus.MAINTENANCE)
        avg_health = (
            sum(a.health_score for a in all_assets) / len(all_assets) if all_assets else 0.0
        )

        # Predict RUL dynamically for predicted failures
        from app.services.rul_model_service import RulModelService
        from app.models.sensor_reading import SensorReading
        from sqlalchemy import select
        
        rul_svc = RulModelService(self._db)
        
        predicted_failures_list = []
        if predicted_failures:
            asset_ids = [a.id for a in predicted_failures]
            stmt = select(SensorReading).where(SensorReading.asset_id.in_(asset_ids)).order_by(SensorReading.timestamp.desc())
            all_readings = self._db.scalars(stmt).all()
            
            latest_readings = {}
            for r in all_readings:
                if r.asset_id not in latest_readings:
                    latest_readings[r.asset_id] = r
            
            for a in predicted_failures:
                r = latest_readings.get(a.id)
                temp = r.temperature_c if r else 75.0
                vib = r.vibration_mms if r else 2.5
                press = r.pressure_bar if r else 4.0
                if temp is None: temp = 75.0
                if vib is None: vib = 2.5
                if press is None: press = 4.0
                
                pred_rul, conf, _, _ = rul_svc.predict_rul(a.id, temp, vib, press)
                predicted_failures_list.append(
                    PredictedFailure(
                        asset_id=a.id,
                        asset_name=a.name,
                        equipment_type=a.equipment_type,
                        failure_probability=a.failure_probability,
                        rul_days=int(pred_rul),
                        criticality=a.criticality.value,
                        recommended_action=_FAILURE_RECOMMENDATION.get(
                            a.criticality.value, "Review maintenance schedule"
                        ),
                    )
                )

        res = DashboardResponse(
            active_alerts=len(alerts),
            critical_assets=[AssetSummary.model_validate(a) for a in critical_assets],
            predicted_failures=predicted_failures_list,
            spare_shortages=[SparePartSummary.model_validate(p) for p in low_stock_parts],
            total_assets=len(all_assets),
            operational_assets=operational,
            assets_in_maintenance=in_maintenance,
            avg_plant_health=round(avg_health, 2),
        )
        
        _DASHBOARD_CACHE = res
        _DASHBOARD_CACHE_EXPIRY = time.time() + CACHE_TTL_SECONDS
        return res

    def _build_alerts(self, critical_assets, predicted_failures) -> list[ActiveAlert]:
        alerts: list[ActiveAlert] = []
        seen: set[str] = set()

        for asset in critical_assets:
            if asset.id not in seen:
                alerts.append(
                    ActiveAlert(
                        asset_id=asset.id,
                        asset_name=asset.name,
                        alert_type="ASSET_STATUS",
                        severity=asset.status.value,
                        message=f"{asset.name} is in {asset.status.value} state — immediate review required",
                    )
                )
                seen.add(asset.id)

        for asset in predicted_failures:
            if asset.id not in seen and asset.failure_probability >= 0.7:
                alerts.append(
                    ActiveAlert(
                        asset_id=asset.id,
                        asset_name=asset.name,
                        alert_type="HIGH_FAILURE_PROBABILITY",
                        severity="high",
                        message=(
                            f"{asset.name} has {asset.failure_probability:.0%} failure probability "
                            f"with {asset.rul_days} days RUL remaining"
                        ),
                    )
                )
                seen.add(asset.id)

        return alerts
