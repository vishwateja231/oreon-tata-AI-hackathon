from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.investigation import InvestigationReport, InvestigationRequest, InvestigationTimelineResponse
from app.services.investigation_service import INVESTIGATION_TIMELINE, InvestigationService
from fastapi.responses import StreamingResponse

router = APIRouter(tags=["Investigation"])


@router.post("/investigate")
def investigate(payload: InvestigationRequest, db: Session = Depends(get_db)):
    """Run a complete deterministic OREON investigation with explanatory LLM narration."""
    try:
        service = InvestigationService(db)
        return StreamingResponse(
            service.investigate_stream(payload),
            media_type="application/x-ndjson"
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Investigation failed: {exc}",
        ) from exc


@router.get("/investigate/timeline", response_model=InvestigationTimelineResponse)
def get_investigation_timeline() -> InvestigationTimelineResponse:
    """Return the fixed investigation workflow used by the agentic UI."""
    return InvestigationTimelineResponse(steps=INVESTIGATION_TIMELINE)
