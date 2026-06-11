"""
OREON Orchestrator — Intelligent Agent Planner.

Transforms Ask OREON from a simple LLM call into a multi-step orchestration:
Query → Intent → Tool Selection → Evidence Collection → Reasoning → Role Adaptation → Response
"""

import logging
import re
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class QueryIntent(str, Enum):
    """Classified intent categories for incoming queries."""
    diagnosis = "diagnosis"
    root_cause = "root_cause"
    rul_prediction = "rul_prediction"
    maintenance_planning = "maintenance_planning"
    risk_assessment = "risk_assessment"
    procurement = "procurement"
    business_impact = "business_impact"
    failure_simulation = "failure_simulation"
    knowledge_query = "knowledge_query"
    general = "general"


# Keyword patterns for intent classification
INTENT_PATTERNS: dict[QueryIntent, list[str]] = {
    QueryIntent.diagnosis: [
        r"diagnos", r"what.*wrong", r"troubleshoot", r"symptom",
        r"issue.*with", r"problem.*with", r"fault", r"malfunction",
        r"vibrat", r"noise", r"overheat", r"leak", r"abnormal",
        r"why.*is.*the", r"check.*the",
    ],
    QueryIntent.root_cause: [
        r"root\s*cause", r"why.*fail", r"cause.*of", r"reason.*for",
        r"what.*caused", r"rca",
    ],
    QueryIntent.rul_prediction: [
        r"rul\b", r"remaining.*life", r"how.*long.*last",
        r"when.*fail", r"predict.*failure", r"life.*expectancy",
    ],
    QueryIntent.maintenance_planning: [
        r"maintenance.*plan", r"repair.*plan", r"what.*should.*do",
        r"action.*plan", r"schedule.*maintenance", r"pm\b", r"corrective",
    ],
    QueryIntent.risk_assessment: [
        r"risk", r"danger", r"safety", r"hazard", r"critical",
        r"priority", r"urgency", r"escalat",
    ],
    QueryIntent.procurement: [
        r"spare", r"part", r"procure", r"inventory", r"stock",
        r"lead.*time", r"order", r"supplier",
    ],
    QueryIntent.business_impact: [
        r"cost", r"revenue", r"business.*impact", r"downtime.*cost",
        r"financial", r"production.*loss", r"₹", r"rupee", r"inr",
    ],
    QueryIntent.failure_simulation: [
        r"what.*if", r"simulat", r"scenario", r"delay.*maintenance",
        r"happen.*if", r"impact.*of.*delay",
    ],
    QueryIntent.knowledge_query: [
        r"sop\b", r"manual", r"procedure", r"how.*to", r"standard",
        r"guideline", r"instruction", r"protocol",
    ],
}

# Tool registry: what engines/services to invoke per intent
TOOL_REGISTRY: dict[QueryIntent, list[str]] = {
    QueryIntent.diagnosis: [
        "sensor_analysis", "root_cause", "incident_retrieval",
        "sop_retrieval", "manual_retrieval",
    ],
    QueryIntent.root_cause: [
        "sensor_analysis", "root_cause", "incident_retrieval",
        "evidence_engine",
    ],
    QueryIntent.rul_prediction: [
        "sensor_service", "rul_model", "trend_analysis",
    ],
    QueryIntent.maintenance_planning: [
        "root_cause", "maintenance_planner", "procurement_engine",
        "sop_retrieval",
    ],
    QueryIntent.risk_assessment: [
        "priority_engine", "escalation_engine", "plant_impact",
        "business_impact",
    ],
    QueryIntent.procurement: [
        "spare_inventory", "procurement_engine", "priority_engine",
    ],
    QueryIntent.business_impact: [
        "plant_impact", "business_impact", "priority_engine",
        "scenario_simulator",
    ],
    QueryIntent.failure_simulation: [
        "scenario_simulator", "plant_impact", "business_impact",
        "rul_model",
    ],
    QueryIntent.knowledge_query: [
        "sop_retrieval", "manual_retrieval", "incident_retrieval",
    ],
    QueryIntent.general: [
        "dual_retrieval",
    ],
}


class AgentPlanner:
    """
    Classifies user intent and selects appropriate tools for orchestration.
    """

    def classify_intent(self, query: str) -> QueryIntent:
        """Classify the incoming query into an intent category."""
        query_lower = query.lower().strip()

        # Score each intent by pattern matches
        scores: dict[QueryIntent, int] = {}
        for intent, patterns in INTENT_PATTERNS.items():
            score = sum(1 for p in patterns if re.search(p, query_lower))
            if score > 0:
                scores[intent] = score

        if not scores:
            return QueryIntent.general

        # Return highest-scoring intent
        return max(scores, key=scores.get)  # type: ignore[arg-type]

    def select_tools(self, intent: QueryIntent) -> list[str]:
        """Return the list of tools/engines to invoke for this intent."""
        return TOOL_REGISTRY.get(intent, TOOL_REGISTRY[QueryIntent.general])

    def plan(self, query: str, role: str | None = None) -> dict[str, Any]:
        """
        Full planning step: classify intent, select tools, determine execution order.
        Returns a plan dict that the orchestrator can execute.
        """
        intent = self.classify_intent(query)
        tools = self.select_tools(intent)

        # Role-specific tool additions
        if role == "plant_manager" and "business_impact" not in tools:
            tools.append("business_impact")
        elif role == "procurement_officer" and "spare_inventory" not in tools:
            tools.append("spare_inventory")
        elif role == "reliability_engineer" and "rul_model" not in tools:
            tools.append("rul_model")

        return {
            "intent": intent.value,
            "tools": tools,
            "execution_order": self._determine_order(tools),
            "role": role,
            "requires_llm": intent != QueryIntent.general or len(tools) > 1,
        }

    def _determine_order(self, tools: list[str]) -> list[list[str]]:
        """
        Group tools into execution phases (parallel within phase, sequential across).
        Phase 1: Data collection (sensor, inventory, retrieval)
        Phase 2: Analysis (RCA, RUL, impact)
        Phase 3: Synthesis (planner, simulator, evidence)
        """
        phase_1 = [t for t in tools if t in {
            "sensor_analysis", "sensor_service", "spare_inventory",
            "sop_retrieval", "manual_retrieval", "incident_retrieval",
            "dual_retrieval", "trend_analysis",
        }]
        phase_2 = [t for t in tools if t in {
            "root_cause", "rul_model", "plant_impact",
            "business_impact", "priority_engine", "escalation_engine",
            "procurement_engine",
        }]
        phase_3 = [t for t in tools if t in {
            "maintenance_planner", "scenario_simulator", "evidence_engine",
        }]

        phases = [p for p in [phase_1, phase_2, phase_3] if p]
        return phases if phases else [tools]
