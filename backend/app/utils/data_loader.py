"""
Seed-data loader — reads JSON files from the data/ directory and upserts
records into the database. Safe to run multiple times (idempotent).
"""
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from app.config.settings import get_settings
from app.database.base import Base
from app.database.session import SessionLocal, engine
import app.models  # noqa: F401 — registers all models with Base

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")


def _load_json(filename: str) -> list[dict]:
    settings = get_settings()
    path = Path(settings.DATA_DIR) / filename
    if not path.exists():
        logger.warning("Seed file not found: %s", path)
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _parse_dates(data: list[dict], date_fields: list[str]) -> list[dict]:
    """Convert ISO-string date fields to Python date/datetime objects."""
    result = []
    for row in data:
        row = dict(row)
        for field in date_fields:
            val = row.get(field)
            if val and isinstance(val, str):
                try:
                    if "T" in val or " " in val:
                        row[field] = datetime.fromisoformat(val)
                    else:
                        from datetime import date
                        row[field] = date.fromisoformat(val)
                except ValueError:
                    row[field] = None
        result.append(row)
    return result


def load_all() -> None:
    logger.info("Creating database tables if not exist...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        from app.models.asset import Asset
        from sqlalchemy import select, func
        asset_count = db.scalar(select(func.count()).select_from(Asset)) or 0
        if asset_count > 0:
            logger.info("Database already seeded (found %d assets). Skipping data load.", asset_count)
            return

        from app.services.asset_service import AssetService
        from app.services.incident_service import IncidentService
        from app.services.spare_part_service import SparePartService
        from app.services.sensor_service import SensorService

        # Roles
        from app.models.role import Role
        from sqlalchemy import select
        existing_roles = db.scalars(select(Role.name)).all()
        default_roles = [
            {"name": "operator", "description": "Control room & floor operator"},
            {"name": "maintenance_engineer", "description": "Hands-on diagnostic and repair engineer"},
            {"name": "supervisor", "description": "Crew supervisor and schedule coordinator"},
            {"name": "plant_manager", "description": "Overall operations and safety manager"},
            {"name": "reliability_engineer", "description": "Long-term health analysis and MTBF auditor"},
        ]
        for r_data in default_roles:
            if r_data["name"] not in existing_roles:
                db.add(Role(name=r_data["name"], description=r_data["description"]))
        db.commit()
        logger.info("Loaded default roles")

        # Assets
        assets = _parse_dates(_load_json("assets.json"), ["last_maintenance_date"])
        if assets:
            count = AssetService(db).upsert_bulk(assets)
            logger.info("Loaded %d assets", count)

        # Spare parts
        parts = _load_json("spare_parts.json")
        if parts:
            count = SparePartService(db).upsert_bulk(parts)
            logger.info("Loaded %d spare parts", count)

        # Incidents
        incidents = _parse_dates(_load_json("incidents.json"), ["timestamp"])
        incidents.extend(_parse_dates(_load_json("additional_incidents.json"), ["timestamp"]))
        if incidents:
            count = IncidentService(db).upsert_bulk(incidents)
            logger.info("Loaded %d incidents", count)

        # Sensor history
        readings = _parse_dates(_load_json("sensor_history.json"), ["timestamp"])
        readings.extend(_parse_dates(_load_json("sensor_anomaly_cases.json"), ["timestamp"]))
        if readings:
            count = SensorService(db).upsert_bulk(readings)
            logger.info("Loaded %d sensor readings", count)

        logger.info("Seed data load complete.")

    except Exception:
        logger.exception("Seed data load failed")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    load_all()
