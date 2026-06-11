from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)) -> DashboardResponse:
    """
    Plant-wide operational dashboard.

    Returns active alerts, critical assets, predicted failures, and spare part shortages.
    This endpoint is designed to be polled by the frontend and consumed by AI agents
    as a plant health summary.
    """
    svc = DashboardService(db)
    return svc.get_dashboard()
