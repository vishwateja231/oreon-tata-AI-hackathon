import json
import asyncio
import logging
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.services.sensor_stream_service import SensorStreamService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stream", tags=["Telemetry Stream"])

@router.get("/sensors")
def stream_sensors(db: Session = Depends(get_db)):
    """
    Establish a Server-Sent Events (SSE) connection to stream real-time plant telemetry.
    Yields data every 3 seconds for all assets.
    """
    stream_service = SensorStreamService(db)

    async def event_generator():
        logger.info("New SSE client connected to telemetry stream.")
        try:
            while True:
                # Expire session cache so we get fresh database reads on each tick
                db.expire_all()
                
                # Generate new readings
                readings = stream_service.get_next_readings_for_all()
                
                # Format SSE packet
                payload = json.dumps(readings)
                yield f"data: {payload}\n\n"
                
                # Sleep for 3 seconds
                await asyncio.sleep(3.0)
        except asyncio.CancelledError:
            logger.info("SSE client connection closed (CancelledError).")
        except Exception as e:
            logger.error(f"Error in SSE stream generator: {e}")
        finally:
            logger.info("SSE client disconnected.")

    return StreamingResponse(event_generator(), media_type="text/event-stream")
