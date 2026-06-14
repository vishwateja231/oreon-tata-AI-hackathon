from fastapi import APIRouter

from app.api.v1.assets import router as assets_router
from app.api.v1.incidents import router as incidents_router
from app.api.v1.spares import router as spares_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.investigation import router as investigation_router
from app.api.v1.decision import router as decision_router
from app.api.v1.ask import router as ask_router
from app.api.v1.feedback import router as feedback_router
from app.api.v1.logbook import router as logbook_router
from app.api.v1.report import router as report_router
from app.api.v1.alerts import router as alerts_router
from app.api.v1.escalations import router as escalations_router
from app.api.v1.stream import router as stream_router
from app.api.v1.simulation import router as simulation_router
from app.api.v1.voice import router as voice_router
from app.api.v1.sentinel import router as sentinel_router
from app.api.v1.purchase_orders import router as purchase_orders_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(assets_router)
api_router.include_router(incidents_router)
api_router.include_router(spares_router)
api_router.include_router(dashboard_router)
api_router.include_router(investigation_router)
api_router.include_router(decision_router)
api_router.include_router(ask_router)
api_router.include_router(feedback_router)
api_router.include_router(logbook_router)
api_router.include_router(report_router)
api_router.include_router(alerts_router)
api_router.include_router(escalations_router)
api_router.include_router(stream_router)
api_router.include_router(simulation_router)
api_router.include_router(voice_router)
api_router.include_router(sentinel_router)
api_router.include_router(purchase_orders_router)

