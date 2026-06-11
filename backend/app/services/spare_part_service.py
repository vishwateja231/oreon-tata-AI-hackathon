from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.spare_part import SparePart
from app.schemas.spare_part import SparePartCreate


class SparePartService:
    """Data-access and business-logic layer for spare parts inventory."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        equipment_type: Optional[str] = None,
        low_stock_only: bool = False,
    ) -> list[SparePart]:
        stmt = select(SparePart)
        if equipment_type:
            stmt = stmt.where(SparePart.equipment_type == equipment_type)
        if low_stock_only:
            stmt = stmt.where(SparePart.stock_quantity <= SparePart.reorder_level)
        stmt = stmt.offset(skip).limit(limit)
        return list(self._db.scalars(stmt).all())

    def get_by_id(self, part_id: str) -> Optional[SparePart]:
        return self._db.get(SparePart, part_id)

    def get_low_stock(self) -> list[SparePart]:
        """Returns parts at or below their reorder level."""
        stmt = select(SparePart).where(
            SparePart.stock_quantity <= SparePart.reorder_level
        ).order_by(SparePart.stock_quantity.asc())
        return list(self._db.scalars(stmt).all())

    def get_by_equipment_type(self, equipment_type: str) -> list[SparePart]:
        stmt = select(SparePart).where(SparePart.equipment_type == equipment_type)
        return list(self._db.scalars(stmt).all())

    def create(self, payload: SparePartCreate) -> SparePart:
        part = SparePart(**payload.model_dump())
        self._db.add(part)
        self._db.commit()
        self._db.refresh(part)
        return part

    def upsert_bulk(self, parts: list[dict]) -> int:
        count = 0
        for data in parts:
            existing = self._db.get(SparePart, data["part_id"])
            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                self._db.add(SparePart(**data))
            count += 1
        self._db.commit()
        return count
