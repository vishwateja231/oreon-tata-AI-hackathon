from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.spare_part import SparePartResponse, SparePartSummary
from app.services.spare_part_service import SparePartService

router = APIRouter(prefix="/spares", tags=["Spare Parts"])


@router.get("", response_model=list[SparePartSummary])
def list_spares(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    equipment_type: Optional[str] = Query(None),
    low_stock_only: bool = Query(False),
    db: Session = Depends(get_db),
) -> list[SparePartSummary]:
    """List all spare parts, with optional filtering by equipment type or low-stock status."""
    svc = SparePartService(db)
    return svc.get_all(
        skip=skip, limit=limit, equipment_type=equipment_type, low_stock_only=low_stock_only
    )


@router.get("/{part_id}", response_model=SparePartResponse)
def get_spare(part_id: str, db: Session = Depends(get_db)) -> SparePartResponse:
    """Retrieve full details of a single spare part."""
    svc = SparePartService(db)
    part = svc.get_by_id(part_id)
    if not part:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spare part '{part_id}' not found",
        )
    return part
