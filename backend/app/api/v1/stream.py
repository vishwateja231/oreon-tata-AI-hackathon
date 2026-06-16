import json
import asyncio
import logging
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.database.session import SessionLocal
from app.services.sensor_stream_service import SensorStreamService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stream", tags=["Telemetry Stream"])

@router.get("/sensors")
def stream_sensors():
    """
    Establish a Server-Sent Events (SSE) connection to stream real-time plant telemetry.
    Yields data every 3 seconds for all assets.
    """
    async def event_generator():
        logger.info("New SSE client connected to telemetry stream.")
        try:
            while True:
                # Use a short-lived session so we don't exhaust the DB connection pool!
                db = SessionLocal()
                try:
                    stream_service = SensorStreamService(db)
                    readings = stream_service.get_next_readings_for_all()
                    payload = json.dumps(readings)
                finally:
                    db.close()
                
                yield f"data: {payload}\n\n"
                
                # Sleep without holding the database connection
                await asyncio.sleep(3.0)
        except asyncio.CancelledError:
            logger.info("SSE client connection closed (CancelledError).")
        except Exception as e:
            logger.error(f"Error in SSE stream generator: {e}")
        finally:
            logger.info("SSE client disconnected.")

    response = StreamingResponse(event_generator(), media_type="text/event-stream")
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response
