"""Voice agent route — the autonomous, context-aware control endpoint.

Includes reasoning, Deepgram Speech-to-Text (STT) and Deepgram Text-to-Speech (TTS) endpoints.
"""

import logging
import httpx
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from deepgram import DeepgramClient

from app.database.session import get_db
from app.config.settings import get_settings, Settings
from app.schemas.voice import VoiceConverseRequest, VoiceConverseResponse
from app.services.voice_agent_service import VoiceAgentService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["Voice Agent"])


@router.post("/converse", response_model=VoiceConverseResponse)
def converse(payload: VoiceConverseRequest, db: Session = Depends(get_db)) -> VoiceConverseResponse:
    """Run one autonomous voice-agent turn: ground in live data, reply, and act."""
    service = VoiceAgentService(db)
    result = service.converse(
        query=payload.query,
        history=[turn.model_dump() for turn in payload.history],
        role=payload.role,
        context_asset_id=payload.context_asset_id,
        current_page=payload.current_page,
        recent_activity=payload.recent_activity,
    )
    return VoiceConverseResponse(**result)


@router.get("/tts")
async def text_to_speech(text: str, voice: str = "aura-asteria-en", settings: Settings = Depends(get_settings)):
    """Generate audio from text using Deepgram Text-to-Speech."""
    if not settings.DEEPGRAM_API_KEY:
        raise HTTPException(status_code=400, detail="Deepgram API key not configured")
    try:
        headers = {
            "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
            "Content-Type": "application/json",
        }
        
        url = "https://api.deepgram.com/v1/speak"
        params = {"model": voice}
        json_data = {"text": text}
        
        async def stream_generator():
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream("POST", url, params=params, headers=headers, json=json_data) as response:
                    if response.status_code != 200:
                        error_detail = await response.aread()
                        logger.error(f"Deepgram TTS API failed with status {response.status_code}: {error_detail}")
                        raise HTTPException(
                            status_code=response.status_code,
                            detail=f"Deepgram TTS failed: {error_detail.decode('utf-8', errors='ignore')}"
                        )
                    
                    async for chunk in response.aiter_bytes(chunk_size=4096):
                        yield chunk

        return StreamingResponse(stream_generator(), media_type="audio/mpeg")
    except Exception as exc:
        logger.error(f"Deepgram TTS failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Deepgram TTS failed: {exc}")


@router.post("/stt")
async def speech_to_text(file: UploadFile = File(...), settings: Settings = Depends(get_settings)):
    """Transcribe audio file to text using Deepgram Speech-to-Text."""
    if not settings.DEEPGRAM_API_KEY:
        raise HTTPException(status_code=400, detail="Deepgram API key not configured")
    try:
        client = DeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
        audio_bytes = await file.read()
        
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-2",
            smart_format=True
        )
        
        # Extract transcript safely
        transcript = ""
        if response.results and response.results.channels:
            channel = response.results.channels[0]
            if channel.alternatives:
                transcript = channel.alternatives[0].transcript
                
        return {"transcript": transcript}
    except Exception as exc:
        logger.error(f"Deepgram STT failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Deepgram STT failed: {exc}")
