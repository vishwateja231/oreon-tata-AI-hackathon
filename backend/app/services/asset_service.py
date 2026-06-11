from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset, AssetStatus, CriticalityLevel
from app.schemas.asset import AssetCreate, AssetUpdate


class AssetService:
    """Data-access and business-logic layer for industrial assets."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        status: Optional[AssetStatus] = None,
        criticality: Optional[CriticalityLevel] = None,
    ) -> list[Asset]:
        stmt = select(Asset)
        if status:
            stmt = stmt.where(Asset.status == status)
        if criticality:
            stmt = stmt.where(Asset.criticality == criticality)
        stmt = stmt.offset(skip).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_by_id(self, asset_id: str) -> Optional[Asset]:
        asset = self._db.get(Asset, asset_id)
        if asset:
            try:
                from app.services.rul_model_service import RulModelService
                from app.services.sensor_service import SensorService
                sensor_svc = SensorService(self._db)
                readings = sensor_svc.get_by_asset(asset_id, limit=1)
                temp = readings[0].temperature_c if readings else 75.0
                vib = readings[0].vibration_mms if readings else 2.5
                press = readings[0].pressure_bar if readings else 4.0
                if temp is None: temp = 75.0
                if vib is None: vib = 2.5
                if press is None: press = 4.0
                
                rul_svc = RulModelService(self._db)
                pred_rul, conf, _, _ = rul_svc.predict_rul(asset_id, temp, vib, press)
                asset.rul_days = int(pred_rul)
            except Exception:
                pass
        return asset

    def create(self, payload: AssetCreate) -> Asset:
        asset = Asset(**payload.model_dump())
        self._db.add(asset)
        self._db.commit()
        self._db.refresh(asset)
        return asset

    def update(self, asset_id: str, payload: AssetUpdate) -> Optional[Asset]:
        asset = self.get_by_id(asset_id)
        if not asset:
            return None
        for field, value in payload.model_dump(exclude_none=True).items():
            setattr(asset, field, value)
        self._db.commit()
        self._db.refresh(asset)
        return asset

    def get_critical_assets(self) -> list[Asset]:
        """Returns assets that are critical or in a degraded/offline state."""
        stmt = select(Asset).where(
            (Asset.criticality == CriticalityLevel.CRITICAL)
            | (Asset.status.in_([AssetStatus.CRITICAL, AssetStatus.OFFLINE, AssetStatus.DEGRADED]))
        )
        return list(self._db.scalars(stmt).all())

    def get_predicted_failures(self, threshold: float = 0.5) -> list[Asset]:
        """Returns assets whose failure probability exceeds the given threshold."""
        stmt = select(Asset).where(Asset.failure_probability >= threshold).order_by(
            Asset.failure_probability.desc()
        )
        return list(self._db.scalars(stmt).all())

    def upsert_bulk(self, assets: list[dict]) -> int:
        """Insert or update a list of asset dicts (used during data loading)."""
        count = 0
        for data in assets:
            existing = self._db.get(Asset, data["id"])
            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                self._db.add(Asset(**data))
            count += 1
        self._db.commit()
        return count
