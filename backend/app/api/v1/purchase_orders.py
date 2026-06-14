from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderResponse,
    NudgeRequest,
)
from app.services.purchase_order_service import PurchaseOrderService

router = APIRouter(prefix="/purchase-orders", tags=["Purchase Orders"])


@router.get("", response_model=list[PurchaseOrderResponse])
def list_purchase_orders(db: Session = Depends(get_db)) -> list[PurchaseOrderResponse]:
    """List every purchase order, newest first."""
    return PurchaseOrderService(db).list_all()


@router.get("/summary")
def purchase_order_summary(db: Session = Depends(get_db)) -> dict:
    """Rollup: counts and on-order / total spend in rupees."""
    return PurchaseOrderService(db).summary()


@router.post("", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
def create_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)) -> PurchaseOrderResponse:
    """Raise a purchase order from a reorder recommendation."""
    try:
        return PurchaseOrderService(db).create(
            part_id=payload.part_id, qty=payload.qty, requested_by_role=payload.requested_by_role
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.patch("/{po_id}/advance", response_model=PurchaseOrderResponse)
def advance_purchase_order(po_id: int, db: Session = Depends(get_db)) -> PurchaseOrderResponse:
    """Advance a purchase order to its next lifecycle stage (receiving restocks the part)."""
    try:
        return PurchaseOrderService(db).advance(po_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/nudge")
def nudge_procurement(payload: NudgeRequest, db: Session = Depends(get_db)) -> dict:
    """Plant-manager action: flag a part to the procurement officer (role-targeted alert)."""
    return PurchaseOrderService(db).nudge_procurement(
        part_id=payload.part_id, note=payload.note, from_role=payload.from_role
    )


@router.delete("")
def clear_purchase_orders(db: Session = Depends(get_db)) -> dict:
    """Clear all purchase orders (demo reset)."""
    removed = PurchaseOrderService(db).delete_all()
    return {"cleared": removed}
