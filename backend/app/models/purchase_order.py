from typing import Optional

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin

# Purchase-order lifecycle stages (tokens; the UI formats them for display).
PO_STAGES = ["PENDING_APPROVAL", "APPROVED", "SHIPPED", "RECEIVED"]


class PurchaseOrder(Base, TimestampMixin):
    """A spare-part purchase order raised from a reorder recommendation.

    Tracks the order through its lifecycle (pending approval -> approved ->
    shipped -> received) and carries the order value so procurement spend can be
    rolled up. Persisted so the pipeline survives restarts and is shared across
    every role's view of the plant.
    """

    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    part_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    part_name: Mapped[str] = mapped_column(String(128), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    lead_time_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unit_cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    order_value_inr: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_APPROVAL")
    requested_by_role: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    supplier: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    def __repr__(self) -> str:
        return f"<PurchaseOrder {self.po_number} {self.part_id} qty={self.qty} stage={self.stage}>"
