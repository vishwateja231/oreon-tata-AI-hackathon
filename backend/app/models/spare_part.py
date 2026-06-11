from typing import Optional

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin


class SparePart(Base, TimestampMixin):
    """Represents a spare part in the plant's inventory."""

    __tablename__ = "spare_parts"

    part_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    part_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    equipment_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    stock_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False)
    supplier: Mapped[str] = mapped_column(String(128), nullable=False)
    reorder_level: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    part_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    storage_location: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    compatible_assets: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    @property
    def is_low_stock(self) -> bool:
        return self.stock_quantity <= self.reorder_level

    def __repr__(self) -> str:
        return f"<SparePart id={self.part_id} name={self.part_name} qty={self.stock_quantity}>"
