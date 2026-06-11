"""Lightweight, dialect-aware column back-fill for additive schema changes.

The project bootstraps schema with ``Base.metadata.create_all`` (Alembic is configured
but versions are not yet authored). ``create_all`` creates *new* tables but never alters
*existing* ones, so a database seeded before the feedback-learning columns were added
would be missing them. This helper adds any missing additive columns in-place, which is
safe for SQLite and PostgreSQL alike. It is idempotent and never drops or alters data.
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# table -> {column_name: SQL column type definition}
_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "decision_feedback": {
        "asset_type": "VARCHAR(64)",
        "investigation_id": "VARCHAR(64)",
        "predicted_root_cause": "VARCHAR(128)",
        "corrected_root_cause": "VARCHAR(128)",
        "predicted_confidence": "FLOAT",
        "outcome": "VARCHAR(32)",
    },
}


def ensure_additive_columns(engine: Engine) -> None:
    """Add any missing additive columns defined in ``_ADDITIVE_COLUMNS``."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for table, columns in _ADDITIVE_COLUMNS.items():
        if table not in existing_tables:
            continue  # create_all will build it fresh with all columns
        present = {col["name"] for col in inspector.get_columns(table)}
        missing = {name: ddl for name, ddl in columns.items() if name not in present}
        if not missing:
            continue
        with engine.begin() as conn:
            for name, ddl in missing.items():
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}'))
                logger.info("Schema back-fill: added %s.%s (%s)", table, name, ddl)
