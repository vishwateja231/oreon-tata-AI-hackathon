from typing import Optional

from pydantic import BaseModel


class ActiveEscalation(BaseModel):
    """An open escalation currently shown in the command center."""

    id: int
    asset_id: str
    escalation_level: str
    target_roles: list[str]
    resolved: bool
    created_at: Optional[str] = None


class EscalationHistoryItem(BaseModel):
    """An audit record of a past escalation event."""

    id: int
    asset_id: str
    risk_level: str
    priority_band: str
    target_roles: list[str]
    reason: str
    timestamp: Optional[str] = None
    decision_id: Optional[str] = None


class EscalationsResponse(BaseModel):
    """Combined active + historical escalation feed."""

    active: list[ActiveEscalation]
    history: list[EscalationHistoryItem]


class ManualEscalationResponse(BaseModel):
    """Result of creating a manual escalation."""

    success: bool
    escalation_level: str
