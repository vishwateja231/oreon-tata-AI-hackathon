from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sensor_reading import SensorReading


class SensorService:
    """Data-access layer for sensor readings."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_asset(
        self,
        asset_id: str,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> list[SensorReading]:
        stmt = (
            select(SensorReading)
            .where(SensorReading.asset_id == asset_id)
            .order_by(SensorReading.timestamp.desc())
        )
        if since:
            stmt = stmt.where(SensorReading.timestamp >= since)
        stmt = stmt.limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_anomalies(self, asset_id: Optional[str] = None, limit: int = 100) -> list[SensorReading]:
        stmt = select(SensorReading).where(SensorReading.anomaly_flag.is_(True))
        if asset_id:
            stmt = stmt.where(SensorReading.asset_id == asset_id)
        stmt = stmt.order_by(SensorReading.timestamp.desc()).limit(limit)
        return list(self._db.scalars(stmt).all())

    def upsert_bulk(self, readings: list[dict]) -> int:
        """Insert sensor readings while skipping already loaded source/timestamp rows."""
        if not readings:
            return 0
        
        asset_ids = list(set(r["asset_id"] for r in readings))
        timestamps = [r["timestamp"] for r in readings if isinstance(r["timestamp"], datetime)]
        
        stmt = select(SensorReading.asset_id, SensorReading.timestamp, SensorReading.sensor_source)
        if asset_ids:
            stmt = stmt.where(SensorReading.asset_id.in_(asset_ids))
        if timestamps:
            stmt = stmt.where(SensorReading.timestamp.between(min(timestamps), max(timestamps)))
            
        existing_rows = self._db.execute(stmt).all()
        existing_keys = {
            (row.asset_id, row.timestamp, row.sensor_source)
            for row in existing_rows
        }
        
        objects = []
        for reading in readings:
            ts = reading["timestamp"]
            key = (reading["asset_id"], ts, reading.get("sensor_source", "SCADA"))
            if key not in existing_keys:
                existing_keys.add(key)
                objects.append(SensorReading(**reading))
                
        if objects:
            self._db.add_all(objects)
            self._db.commit()
        return len(objects)

