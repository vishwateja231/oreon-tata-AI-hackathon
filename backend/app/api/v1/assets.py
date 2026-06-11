from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.asset import AssetStatus, CriticalityLevel
from app.schemas.asset import AssetResponse, AssetSummary, AssetUpdate, ImpactChainResponse
from app.schemas.investigation import InvestigationReport
from app.services.asset_service import AssetService
from app.services.plant_graph_service import PlantGraphService

router = APIRouter(prefix="/assets", tags=["Assets"])

_graph_service = PlantGraphService()


@router.get("", response_model=list[AssetSummary])
def list_assets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status: Optional[AssetStatus] = Query(None),
    criticality: Optional[CriticalityLevel] = Query(None),
    db: Session = Depends(get_db),
) -> list[AssetSummary]:
    """List all plant assets with optional filtering by status or criticality."""
    svc = AssetService(db)
    return svc.get_all(skip=skip, limit=limit, status=status, criticality=criticality)


@router.get("/plant-graph", tags=["Assets"])
def get_plant_graph() -> dict:
    """Retrieve the complete plant graph (nodes and edges)."""
    return {
        "nodes": _graph_service.get_all_nodes(),
        "edges": _graph_service.get_all_edges(),
    }


@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: str, db: Session = Depends(get_db)) -> AssetResponse:
    """Retrieve full details of a single asset."""
    svc = AssetService(db)
    asset = svc.get_by_id(asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset '{asset_id}' not found")
    return asset


@router.patch("/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: str,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
) -> AssetResponse:
    """Partially update an asset's operational fields (health score, status, RUL, etc.)."""
    svc = AssetService(db)
    asset = svc.update(asset_id, payload)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset '{asset_id}' not found")
    return asset


@router.get("/{asset_id}/impact", response_model=ImpactChainResponse)
def get_asset_impact(asset_id: str, db: Session = Depends(get_db)) -> ImpactChainResponse:
    """
    Calculate the downstream impact chain if the given asset fails.

    Returns all dependent assets ordered by proximity in the plant dependency graph.
    """
    svc = AssetService(db)
    asset = svc.get_by_id(asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset '{asset_id}' not found")

    impact = _graph_service.get_impact_chain(asset_id)
    downstream_ids = [item["asset_id"] for item in impact["impact_chain"]]

    downstream_assets = []
    seen_lines: set[str] = set()
    for aid in downstream_ids:
        a = svc.get_by_id(aid)
        if a:
            downstream_assets.append(AssetSummary.model_validate(a))
            seen_lines.add(a.production_line)

    from app.services.plant_impact_engine import PlantImpactEngine
    total_impact = PlantImpactEngine(db, graph_service=_graph_service).calculate_downstream_impact_score(
        downstream_assets
    )

    return ImpactChainResponse(
        asset_id=asset_id,
        asset_name=asset.name,
        downstream_assets=downstream_assets,
        total_impact_score=round(total_impact, 4),
        affected_production_lines=sorted(seen_lines),
    )


@router.get("/{asset_id}/investigate", response_model=InvestigationReport)
def get_asset_investigation(asset_id: str, db: Session = Depends(get_db)) -> InvestigationReport:
    """Run/retrieve an on-demand investigation for an asset using its latest sensor readings."""
    from app.services.investigation_service import InvestigationService
    from app.services.sensor_service import SensorService
    from app.schemas.investigation import InvestigationRequest, SensorSnapshot

    svc = AssetService(db)
    asset = svc.get_by_id(asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset '{asset_id}' not found")

    # Fetch latest readings to use as snapshot
    sensor_svc = SensorService(db)
    readings = sensor_svc.get_by_asset(asset_id, limit=1)
    
    if readings:
        last_r = readings[0]
        snapshot = SensorSnapshot(
            temperature_c=last_r.temperature_c,
            vibration_mms=last_r.vibration_mms,
            pressure_bar=last_r.pressure_bar,
            current_amps=last_r.current_amps,
            rpm=last_r.rpm,
            noise_db=last_r.noise_db
        )
    else:
        status_val = asset.status.value
        v = 1.2 if status_val == "operational" else 5.2 if status_val == "degraded" else 8.5
        t = 65.0 if status_val == "operational" else 82.0 if status_val == "degraded" else 92.0
        p = 4.0 if status_val == "operational" else 2.2 if status_val == "degraded" else 1.2
        snapshot = SensorSnapshot(
            temperature_c=t,
            vibration_mms=v,
            pressure_bar=p,
            current_amps=48.0 if status_val == "operational" else 58.0,
            rpm=1480.0
        )

    fault = f"Abnormal operational parameters or {asset.status.value} status on {asset.name}"
    payload = InvestigationRequest(
        asset_id=asset_id,
        fault_description=fault,
        sensor_snapshot=snapshot
    )
    
    try:
        return InvestigationService(db).investigate(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Investigation failed: {exc}",
        ) from exc
