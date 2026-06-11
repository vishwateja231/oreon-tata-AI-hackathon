from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.decision import (
    BusinessRiskSummary,
    DecisionAnalyzeRequest,
    DecisionReport,
    MaintenanceActionSummary,
    PriorityAssetSummary,
    ProcurementRiskSummary,
    ScenarioAnalysisData,
    ScenarioRequest,
)
from app.services.decision_service import DecisionService

router = APIRouter(tags=["Decision Intelligence"])


@router.post("/decision/analyze", response_model=DecisionReport)
def analyze_decision(payload: DecisionAnalyzeRequest, db: Session = Depends(get_db)) -> DecisionReport:
    """Run the complete OREON maintenance decision intelligence workflow."""
    try:
        return DecisionService(db).analyze(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Decision analysis failed: {exc}",
        ) from exc


@router.post("/decision/scenario", response_model=ScenarioAnalysisData)
def simulate_decision_scenario(payload: ScenarioRequest, db: Session = Depends(get_db)) -> ScenarioAnalysisData:
    """Simulate the maintenance risk of delaying work on an asset."""
    try:
        return DecisionService(db).simulate_scenario(payload.asset_id, payload.delay_days)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/priority-assets", response_model=list[PriorityAssetSummary])
def get_priority_assets(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[PriorityAssetSummary]:
    """Return assets ranked by deterministic maintenance priority."""
    return DecisionService(db).priority_assets(limit=limit)


@router.get("/procurement-risks", response_model=list[ProcurementRiskSummary])
def get_procurement_risks(db: Session = Depends(get_db)) -> list[ProcurementRiskSummary]:
    """Return spare parts with low stock, long lead time, or shortage risk."""
    return DecisionService(db).procurement_risks()


@router.get("/maintenance-actions", response_model=list[MaintenanceActionSummary])
def get_maintenance_actions(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[MaintenanceActionSummary]:
    """Return prioritized maintenance action summaries."""
    return DecisionService(db).maintenance_actions(limit=limit)


@router.get("/business-risks", response_model=list[BusinessRiskSummary])
def get_business_risks(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[BusinessRiskSummary]:
    """Return assets ranked by business and production risk."""
    return DecisionService(db).business_risks(limit=limit)
