from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.asset import Asset
from app.services.demo_simulation_service import DemoSimulationService

router = APIRouter(prefix="/simulation", tags=["Live Simulation"])


class StartSimulationRequest(BaseModel):
    asset_id: str = Field(default="Motor_M12", description="Asset to drive through the scripted degradation")
    profile: str = Field(default="bearing_failure", description="Scenario profile to run")


@router.post("/start")
def start_simulation(payload: StartSimulationRequest, db: Session = Depends(get_db)) -> dict:
    """Start the scripted live degradation scenario on an asset.

    Drives a deterministic HEALTHY -> ONSET -> ALERT -> CRITICAL -> FAILURE_IMMINENT
    curve over the SSE telemetry feed, firing a real alert and (at the milestone tick)
    a critical escalation with RUL collapse. Designed for reliable, repeatable demos.
    """
    if not db.get(Asset, payload.asset_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{payload.asset_id}' not found",
        )
    return DemoSimulationService.start(payload.asset_id, payload.profile)


@router.post("/stop")
def stop_simulation() -> dict:
    """Stop the active scripted scenario (telemetry reverts to normal random drift)."""
    return DemoSimulationService.stop()


@router.get("/status")
def simulation_status() -> dict:
    """Return the current scripted scenario state (active, tick, phase, target asset)."""
    return DemoSimulationService.status()


@router.post("/reset")
def reset_plant(db: Session = Depends(get_db)) -> dict:
    """Reset every asset to its curated presentation baseline.

    Restores a believable demo plant (mostly healthy, two degraded assets, one
    critical story asset), stops any active scenario, and re-anchors the live
    telemetry stream. Call this before starting a demo run.
    """
    return DemoSimulationService.reset_plant(db)
