"""Pydantic schemas for the OREON autonomous voice agent.

The agent receives a transcribed utterance plus short conversation history and
returns a structured response: a spoken reply (for browser TTS), a plan of
action, a list of tool executions it performed, and optional context widgets to
render in the mini-dashboard.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class VoiceTurn(BaseModel):
    """One prior turn in the conversation, for context awareness."""

    role: Literal["user", "assistant"]
    content: str


class VoiceConverseRequest(BaseModel):
    """Inbound request for an autonomous voice conversation turn."""

    query: str = Field(..., description="Transcribed user utterance.")
    history: list[VoiceTurn] = Field(default_factory=list, description="Recent conversation turns for context.")
    role: str = Field(default="maintenance_engineer", description="Active operator role persona.")
    context_asset_id: Optional[str] = Field(default=None, description="Asset the user is currently viewing, if any.")
    current_page: Optional[str] = Field(default=None, description="The screen the operator is currently on.")
    recent_activity: list[str] = Field(default_factory=list, description="Recent operator navigation/activity trail.")


class ExecutionLogEntry(BaseModel):
    """A single tool the agent invoked while answering — shown in the API execution feed."""

    tool: str = Field(..., description="Name of the backend capability invoked.")
    label: str = Field(..., description="Human-readable description of the call.")
    kind: Literal["read", "write"] = Field(..., description="Whether the tool read data or mutated state.")
    status: Literal["ok", "error", "skipped"] = Field(default="ok")
    detail: Optional[str] = Field(default=None, description="Short result summary.")


class ContextWidget(BaseModel):
    """A compact metric the dashboard renders alongside the orb."""

    label: str
    value: str
    tone: Literal["cyan", "warn", "crit", "ok", "violet"] = "cyan"


class VoiceConverseResponse(BaseModel):
    """Structured autonomous-agent reply."""

    spoken_response: str = Field(..., description="Conversational reply for text-to-speech.")
    plan_of_action: list[str] = Field(default_factory=list, description="Ordered checklist the agent intends/executed.")
    execution_log: list[ExecutionLogEntry] = Field(default_factory=list, description="Tools the agent invoked.")
    context_label: Optional[str] = Field(default=None, description="What the agent is currently analysing.")
    widgets: list[ContextWidget] = Field(default_factory=list, description="Compact metrics to display.")
    llm_used: bool = Field(default=False, description="True if a live LLM produced the reply.")
