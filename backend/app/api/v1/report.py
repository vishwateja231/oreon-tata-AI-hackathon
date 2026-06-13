import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.services.asset_service import AssetService
from app.services.sensor_service import SensorService
from app.services.decision_service import DecisionService
from app.schemas.decision import DecisionAnalyzeRequest
from app.schemas.investigation import SensorSnapshot
from app.utils.pdf_generator import generate_maintenance_pdf, generate_plant_report_pdf

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/report", tags=["Report Export"])


def _datetime_now_str() -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y%m%d_%H%M%S")


@router.get("/plant/{kind}/export")
def export_plant_report(
    kind: str,
    format: str = Query("pdf", regex="^(pdf|json)$"),
    db: Session = Depends(get_db),
):
    """
    Export a whole-plant report matching the Decisions page tabs:
    `maintenance` (asset health + queued actions) or `business` (financial impact).
    """
    if kind not in ("maintenance", "business"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown report kind '{kind}'")

    try:
        decision_svc = DecisionService(db)
        if kind == "maintenance":
            data = {
                "priority": [p.model_dump(mode="json") for p in decision_svc.priority_assets(limit=50)],
                "actions": [a.model_dump(mode="json") for a in decision_svc.maintenance_actions(limit=50)],
            }
        else:
            data = {"risks": [r.model_dump(mode="json") for r in decision_svc.business_risks(limit=50)]}
    except Exception as exc:
        logger.exception("Plant report aggregation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to assemble {kind} report: {exc}",
        ) from exc

    if format == "json":
        return JSONResponse(content=data)

    # 3. Output as PDF
    pdf_stream = generate_plant_report_pdf(kind, data)
    filename = f"oreon_plant_{kind}_report_{_datetime_now_str()}.pdf"
    
    return Response(
        content=pdf_stream.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@router.get("/{asset_id}/export")
def export_maintenance_report(
    asset_id: str,
    format: str = Query("pdf", regex="^(pdf|json)$"),
    db: Session = Depends(get_db)
):
    """
    Run full decision intelligence analysis on an asset and export the report
    as a beautifully formatted PDF document or raw JSON payload.
    """
    # 1. Load asset
    asset_svc = AssetService(db)
    asset = asset_svc.get_by_id(asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Asset '{asset_id}' not found")

    # 2. Get latest sensor snapshot
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

    # 3. Perform decision analysis
    fault = f"Abnormal operational parameters or {asset.status.value} status on {asset.name}"
    payload = DecisionAnalyzeRequest(
        asset_id=asset_id,
        fault_description=fault,
        sensor_snapshot=snapshot,
        delay_days=[3, 7, 14, 30]
    )

    try:
        decision_svc = DecisionService(db)
        # The PDF renders only deterministic fields (diagnosis, root cause, evidence,
        # scenarios, procurement, executive summary) — never the LLM narrative. Skip the
        # two slow LLM narration calls so the report generates in seconds, not minutes.
        report = decision_svc.analyze(payload, with_explanation=False)
        report_data = report.model_dump(mode="json")
        # Add asset metadata manually for report formatting
        report_data["asset"] = {
            "name": asset.name,
            "equipment_type": asset.equipment_type,
            "location": asset.location,
            "criticality": asset.criticality.value,
            "production_line": asset.production_line,
            "health_score": asset.health_score,
            "failure_probability": asset.failure_probability,
            "rul_days": asset.rul_days,
            "status": asset.status.value,
            "manufacturer": asset.manufacturer,
            "model_number": asset.model_number,
            "installation_year": asset.installation_year,
            "last_maintenance_date": asset.last_maintenance_date.isoformat() if asset.last_maintenance_date else None
        }
    except Exception as exc:
        logger.exception("Decision analysis failed for report export: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate decision analysis report: {exc}",
        ) from exc

    # 4. Return formatted output
    if format == "json":
        return JSONResponse(content=report_data)

    # Generate PDF
    pdf_stream = generate_maintenance_pdf(report_data)
    filename = f"oreon_report_{asset_id}_{_datetime_now_str()}.pdf"
    
    return Response(
        content=pdf_stream.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
