"""Business logic for spare-part purchase orders.

Raising, advancing, and rolling up purchase orders. Receiving an order
replenishes the spare-part stock (closing the procurement loop), and a plant
manager can nudge the procurement officer to order a part (fires a role-targeted
notification through the existing notification engine).
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.purchase_order import PurchaseOrder, PO_STAGES
from app.models.spare_part import SparePart

USD_TO_INR = 830.0  # demo scaling (10x) so order values read at plant scale
_DEFAULT_UNIT_COST_USD = 350.0  # fallback when a part has no costed price


class PurchaseOrderService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # ── reads ────────────────────────────────────────────────────────────────
    def list_all(self) -> list[PurchaseOrder]:
        return list(
            self._db.scalars(
                select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc())
            ).all()
        )

    # ── create ───────────────────────────────────────────────────────────────
    def create(self, part_id: str, qty: int, requested_by_role: Optional[str] = None) -> PurchaseOrder:
        part = self._db.get(SparePart, part_id)
        if not part:
            raise ValueError(f"Spare part '{part_id}' not found")

        unit_cost = part.unit_cost_usd if part.unit_cost_usd else _DEFAULT_UNIT_COST_USD
        order_value_inr = round(unit_cost * qty * USD_TO_INR, 2)

        po = PurchaseOrder(
            po_number="PO-PENDING",
            part_id=part_id,
            part_name=part.part_name,
            qty=qty,
            lead_time_days=part.lead_time_days,
            unit_cost_usd=part.unit_cost_usd,
            order_value_inr=order_value_inr,
            stage="PENDING_APPROVAL",
            requested_by_role=requested_by_role,
            supplier=part.supplier,
        )
        self._db.add(po)
        self._db.flush()                       # assign id
        po.po_number = f"PO-2026-{900 + po.id}"
        self._db.commit()
        self._db.refresh(po)
        return po

    # ── advance lifecycle ────────────────────────────────────────────────────
    def advance(self, po_id: int) -> PurchaseOrder:
        po = self._db.get(PurchaseOrder, po_id)
        if not po:
            raise ValueError(f"Purchase order {po_id} not found")
        idx = PO_STAGES.index(po.stage) if po.stage in PO_STAGES else 0
        if idx < len(PO_STAGES) - 1:
            po.stage = PO_STAGES[idx + 1]
            # On receipt, replenish the spare-part stock — closes the loop.
            if po.stage == "RECEIVED":
                part = self._db.get(SparePart, po.part_id)
                if part:
                    part.stock_quantity = (part.stock_quantity or 0) + po.qty
        self._db.commit()
        self._db.refresh(po)
        return po

    def delete_all(self) -> int:
        pos = self.list_all()
        for po in pos:
            self._db.delete(po)
        self._db.commit()
        return len(pos)

    # ── plant-manager nudge ──────────────────────────────────────────────────
    def nudge_procurement(self, part_id: str, note: Optional[str], from_role: str) -> dict:
        """Plant manager flags a part to the procurement officer (role-targeted alert)."""
        part = self._db.get(SparePart, part_id)
        part_name = part.part_name if part else part_id
        sent = False
        try:
            from app.services.notification_engine import NotificationEngine
            ne = NotificationEngine(self._db)
            msg = note or (
                f"{from_role.replace('_', ' ').title()} requests a purchase order for "
                f"{part_name} ({part_id})."
            )
            ne.create_notification(
                severity="high",
                title=f"Procurement requested: {part_name}",
                message=msg,
                asset_id=None,
                target_roles=["procurement_officer"],
            )
            sent = True
        except Exception:
            sent = False
        return {"nudged": True, "notified_procurement": sent, "part_id": part_id, "part_name": part_name}

    # ── rollups ──────────────────────────────────────────────────────────────
    def summary(self) -> dict:
        pos = self.list_all()
        open_pos = [p for p in pos if p.stage != "RECEIVED"]
        return {
            "total": len(pos),
            "open": len(open_pos),
            "on_order_value_inr": round(sum(p.order_value_inr for p in open_pos), 2),
            "total_value_inr": round(sum(p.order_value_inr for p in pos), 2),
        }
