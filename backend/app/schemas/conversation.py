from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class PinInput(BaseModel):
    kind: str  # "asset" | "incident" | "sop"
    label: str


class AskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    conversation_id: Optional[str] = None
    pins: list[PinInput] = Field(default_factory=list)
    role: Optional[str] = None
    context_asset_id: Optional[str] = None
    context_page: Optional[str] = None
    stream: Optional[bool] = False



class EvidenceSource(BaseModel):
    text: str
    src: str


class ReasoningStep(BaseModel):
    t: str  # title, e.g. "Sensor Analysis"
    d: str  # description


class AskResponse(BaseModel):
    conversation_id: str
    diagnosis: str
    evidence: list[EvidenceSource] = Field(default_factory=list)
    recommended: str
    confidence: float
    critical: bool = False
    reasoning: list[ReasoningStep] = Field(default_factory=list)


class MessageSummary(BaseModel):
    id: int
    conversation_id: str
    role: str
    content: str
    sources: Optional[list[Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationSummary(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
