"""LangGraph Multi-Agent Workflow for OREON (Phase 4).

Coordinates specialist agents:
- DocumentRetrievalAgent (Retrieves RAG info)
- TroubleshootingAgent (Initial diagnosis & telemetry analysis)
- RCAAgent (Root Cause Analysis, run for complex queries)
- MaintenancePlannerAgent (Schedules & details repairs, run for complex queries)
- SafetyValidationAgent (Validates safety constraints)
- ReportGenerationAgent (Combines everything into the final JSON schema)
"""

from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END
from app.config.settings import get_settings
from app.services.llm_router import pick_model, complete_json
from app.services.complexity_classifier import ComplexityClassifier
import logging
import json

logger = logging.getLogger(__name__)

class AgentState(TypedDict):
    query: str
    role: str
    context_asset_id: Optional[str]
    pins: List[Dict[str, str]]
    complexity: str
    retrieved_documents: List[Dict[str, Any]]
    troubleshooting_notes: str
    rca_notes: str
    maintenance_plan: str
    safety_violations: List[str]
    final_report: Dict[str, Any]
    errors: List[str]
    # For streaming / step-tracking
    status_updates: List[str]

# 1. DocumentRetrievalAgent
def document_retrieval_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] DocumentRetrievalAgent starting...")
    from app.services.dual_retrieval_service import DualRetrievalService
    from app.database.session import SessionLocal

    query = state["query"]
    docs = []
    status_update = "Reviewing maintenance manuals..."
    try:
        with SessionLocal() as db:
            retrieval_svc = DualRetrievalService(db)
            ret_results = retrieval_svc.retrieve(query, asset_type="plant", limit=3)
            for doc in ret_results.get("procedural_knowledge", []):
                docs.append({
                    "text": doc.text,
                    "src": doc.source_document,
                    "confidence": doc.confidence
                })
            for inc in ret_results.get("historical_knowledge", []):
                docs.append({
                    "text": f"Incident {inc.get('incident_id')}: {inc.get('symptoms')} -> {inc.get('root_cause')}",
                    "src": "OREON Incident History",
                    "confidence": 0.8
                })
    except Exception as e:
        logger.error("[Agent] DocumentRetrievalAgent failed: %s", e)

    return {
        "retrieved_documents": docs,
        "status_updates": [status_update]
    }

# 2. TroubleshootingAgent
def troubleshooting_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] TroubleshootingAgent starting...")
    settings = get_settings()
    model = pick_model(settings, complexity=state["complexity"])
    
    doc_context = "\n".join([f"- {d['text']} (Source: {d['src']})" for d in state["retrieved_documents"]])
    
    prompt = f"""You are the OREON Troubleshooting Agent.
Your job is to analyze the user's issue and perform an initial technical diagnosis.
User Query: {state['query']}
User Role: {state['role']}
Retrieved Documents Context:
{doc_context}

Return a JSON object:
{{
  "troubleshooting_notes": "Your detailed technical assessment, diagnosis, and findings."
}}
"""
    status_update = "Inspecting equipment history..."
    notes = ""
    try:
        res = complete_json(settings, prompt, model)
        notes = res.get("troubleshooting_notes", "")
    except Exception as e:
        logger.error(f"[Agent] TroubleshootingAgent failed: {e}")
        notes = f"Failed to perform automated troubleshooting. Error: {e}"
        
    return {
        "troubleshooting_notes": notes,
        "status_updates": [status_update]
    }

# 3. RCAAgent
def rca_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] RCAAgent starting...")
    settings = get_settings()
    model = pick_model(settings, complexity="complex")
    
    prompt = f"""You are the OREON Root Cause Analysis Agent.
Analyze the troubleshooting notes and determine the probable root causes of the issue.
User Query: {state['query']}
Troubleshooting Notes: {state['troubleshooting_notes']}

Return a JSON object:
{{
  "rca_notes": "Detailed root cause analysis including failure modes, contributing factors, and evidence."
}}
"""
    status_update = "Building root cause hypotheses..."
    notes = ""
    try:
        res = complete_json(settings, prompt, model)
        notes = res.get("rca_notes", "")
    except Exception as e:
        logger.error(f"[Agent] RCAAgent failed: {e}")
        notes = f"Failed to perform root cause analysis: {e}"
        
    return {
        "rca_notes": notes,
        "status_updates": [status_update]
    }

# 4. MaintenancePlannerAgent
def maintenance_planner_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] MaintenancePlannerAgent starting...")
    settings = get_settings()
    model = pick_model(settings, complexity="complex")
    
    prompt = f"""You are the OREON Maintenance Planner Agent.
Propose a step-by-step maintenance action plan, recommended tools, and part details.
User Query: {state['query']}
Troubleshooting Notes: {state['troubleshooting_notes']}

Return a JSON object:
{{
  "maintenance_plan": "Step-by-step plan, required tools, parts, and estimated MTTR."
}}
"""
    status_update = "Comparing historical incidents..."
    plan = ""
    try:
        res = complete_json(settings, prompt, model)
        plan = res.get("maintenance_plan", "")
    except Exception as e:
        logger.error(f"[Agent] MaintenancePlannerAgent failed: {e}")
        plan = f"Failed to generate maintenance plan: {e}"
        
    return {
        "maintenance_plan": plan,
        "status_updates": [status_update]
    }

# 5. SafetyValidationAgent
def safety_validation_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] SafetyValidationAgent starting...")
    settings = get_settings()
    model = pick_model(settings, complexity=state["complexity"])
    
    plan = state.get("maintenance_plan", "") or "No specific maintenance plan."
    notes = state.get("troubleshooting_notes", "")
    
    prompt = f"""You are the OREON Safety Validation Agent.
Review the proposed diagnosis and maintenance plan for any safety violations, hazards, or Lock-Out/Tag-Out (LOTO) requirements.
Diagnosis: {notes}
Plan: {plan}

Return a JSON object:
{{
  "violations": [], // List of any safety violations or concerns found, empty if safe.
  "safety_warnings": "LOTO or other mandatory safety protocols to include."
}}
"""
    status_update = "Evaluating safety constraints..."
    violations = []
    try:
        res = complete_json(settings, prompt, model)
        violations = res.get("violations", [])
        if res.get("safety_warnings"):
            violations.append(res["safety_warnings"])
    except Exception as e:
        logger.error(f"[Agent] SafetyValidationAgent failed: {e}")
        
    return {
        "safety_violations": violations,
        "status_updates": [status_update]
    }

# 6. ReportGenerationAgent
def report_generation_agent(state: AgentState) -> Dict[str, Any]:
    logger.info("[Agent] ReportGenerationAgent starting...")
    settings = get_settings()
    model = pick_model(settings, complexity=state["complexity"])
    
    doc_context = "\n".join([f"- {d['text']} [{d['src']}]" for d in state["retrieved_documents"]])
    safety = "\n".join([f"- {v}" for v in state["safety_violations"]])
    
    prompt = f"""You are OREON, the Industrial Maintenance Decision Intelligence platform.
Compile all information gathered by the specialist agents into the final required JSON format.

User Query: {state['query']}
User Role: {state['role']}
Troubleshooting Notes: {state['troubleshooting_notes']}
Root Cause Analysis (RCA): {state.get('rca_notes', '')}
Maintenance Plan: {state.get('maintenance_plan', '')}
Safety/LOTO Requirements: {safety}
Grounded Evidence:
{doc_context}

You MUST return a JSON object match this schema exactly:
{{
  "diagnosis": "Detailed combined diagnosis tailored to the user's role.",
  "recommended": "Recommended action steps (incorporate maintenance plan and safety/LOTO rules).",
  "evidence": [
     {{"text": "evidence snippet from context", "src": "Source name"}}
  ],
  "confidence": 85.0, // a float
  "critical": false // boolean
}}
"""
    status_update = "Preparing engineering report..."
    final_report = {}
    try:
        final_report = complete_json(settings, prompt, model)
        # Parse reasoning out of the individual agent notes to display under "reasoning"
        reasoning_steps = []
        if state.get("troubleshooting_notes"):
            reasoning_steps.append({"t": "Troubleshooting", "d": state["troubleshooting_notes"][:120] + "..."})
        if state.get("rca_notes"):
            reasoning_steps.append({"t": "Root Cause", "d": state["rca_notes"][:120] + "..."})
        if state.get("maintenance_plan"):
            reasoning_steps.append({"t": "Plan", "d": state["maintenance_plan"][:120] + "..."})
        if state["safety_violations"]:
            reasoning_steps.append({"t": "Safety", "d": ", ".join(state["safety_violations"])[:120]})
        
        final_report["reasoning"] = reasoning_steps
    except Exception as e:
        logger.error(f"[Agent] ReportGenerationAgent failed: {e}")
        final_report = {
            "diagnosis": "Failed to compile the report: " + str(e),
            "recommended": "Please try again later.",
            "evidence": [],
            "confidence": 0.0,
            "critical": False,
            "reasoning": []
        }
        
    return {
        "final_report": final_report,
        "status_updates": [status_update]
    }

# Build LangGraph StateGraph
def create_agent_graph():
    builder = StateGraph(AgentState)
    
    # Register Nodes
    builder.add_node("document_retrieval", document_retrieval_agent)
    builder.add_node("troubleshooting", troubleshooting_agent)
    builder.add_node("rca", rca_agent)
    builder.add_node("maintenance_planner", maintenance_planner_agent)
    builder.add_node("safety_validation", safety_validation_agent)
    builder.add_node("report_generation", report_generation_agent)
    
    # Set entry point
    builder.set_entry_point("document_retrieval")

    # Define Edges
    builder.add_edge("document_retrieval", "troubleshooting")

    # Decide path: complex → rca → maintenance_planner → safety_validation
    #              simple  → safety_validation (skip heavy RCA)
    def route_complexity(state: AgentState) -> str:
        return "rca" if state["complexity"] == "complex" else "safety_validation"

    builder.add_conditional_edges(
        "troubleshooting",
        route_complexity,
        {
            "rca": "rca",
            "safety_validation": "safety_validation",
        }
    )

    # Complex path: rca → maintenance_planner → safety_validation (sequential)
    builder.add_edge("rca", "maintenance_planner")
    builder.add_edge("maintenance_planner", "safety_validation")

    builder.add_edge("safety_validation", "report_generation")
    builder.add_edge("report_generation", END)
    
    return builder.compile()

# Singleton-like runner
_workflow = None

def run_agent_workflow(query: str, role: str, context_asset_id: Optional[str] = None, pins: List[Dict[str, str]] = None) -> Dict[str, Any]:
    global _workflow
    if _workflow is None:
        _workflow = create_agent_graph()
        
    # Pre-classify the complexity
    complexity = ComplexityClassifier.classify(query)
    
    initial_state = {
        "query": query,
        "role": role,
        "context_asset_id": context_asset_id,
        "pins": pins or [],
        "complexity": complexity,
        "retrieved_documents": [],
        "troubleshooting_notes": "",
        "rca_notes": "",
        "maintenance_plan": "",
        "safety_violations": [],
        "final_report": {},
        "errors": [],
        "status_updates": ["Analyzing operating conditions..."]
    }
    
    result_state = _workflow.invoke(initial_state)
    return result_state.get("final_report", {})
