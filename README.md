# OREON — Industrial Maintenance Decision Intelligence Platform

OREON (Operations Reliability & Engineering Optimization Network) is a full-stack, context-aware **Intelligent Maintenance Support System** designed as a decision-support platform for maintenance engineers in steel manufacturing environments. 

It consolidates diverse fragmented data sources—such as equipment manuals, standard operating procedures (SOPs), historical maintenance logs, failure analysis reports, and sensor-based alerts—to deliver real-time anomaly alerts, ML-based Remaining Useful Life (RUL) predictions, NetworkX-driven plant blast-radius tracing, and LangGraph-powered multi-agent diagnostics.

> **Submission note for evaluators:** This document covers every required deliverable —
> system architecture (§2), technology stack (§1), data & system flow (§3), model design &
> reasoning pipeline (§4), alerting & prediction logic (§5), assumptions & limitations (§8),
> install/configure/run guide (§9), and a sample input/output demonstration (§10). The
> **Requirement Coverage Matrix** below maps each official functional requirement to where it
> is implemented in the codebase. A guided demo walkthrough is in `DEMO_SCRIPT.md`; the
> full per-file engineering reference is in `implementation.md`; RAG retrieval benchmarks are
> in `RAG_EVALUATION_REPORT.md`.

---

## Table of Contents

0. [Requirement Coverage Matrix](#0-requirement-coverage-matrix)
1. [Technology Stack](#1-technology-stack)
2. [Decoupled System Architecture](#2-decoupled-system-architecture)
3. [Data Flow & System Flow](#3-data-flow--system-flow)
4. [Model Design & Reasoning Pipeline](#4-model-design--reasoning-pipeline)
5. [Alerting & Prediction Logic](#5-alerting--prediction-logic)
6. [Knowledge Integration & RAG Pipeline](#6-knowledge-integration--rag-pipeline)
7. [Role-Based Customization Matrix](#7-role-based-customization-matrix)
8. [Assumptions & Limitations](#8-assumptions--limitations)
9. [Installation & Setup Guide](#9-installation--setup-guide)
10. [Sample Input & Output Demonstration](#10-sample-input--output-demonstration)
11. [Repository Map & Deliverables](#11-repository-map--deliverables)

---

## 0. Requirement Coverage Matrix

Every functional requirement from the problem statement, mapped to its implementation. This is
the fastest way to verify completeness.

### Functional Requirements

| # | Required Capability | OREON Implementation | Where |
|---|---|---|---|
| **1** | **Contextual reasoning using LLMs/SLMs** | Groq `llama-3.3-70b` (fast tier) + OpenRouter `gpt-4o-mini` (reasoning tier), routed by a complexity classifier. LLM narrates; engines decide. | `llm_router.py`, `complexity_classifier.py`, `*_reasoning_service.py` |
| **2** | **Knowledge integration** (manuals, SOPs, history, failure reports, logs) | Dual hybrid RAG: ChromaDB dense + BM25 sparse over manual/SOP PDFs, Jaccard incident similarity over the history table, fused with RRF + reranking. | `dual_retrieval_service.py`, `manual_/sop_knowledge_service.py`, `incident_retrieval_service.py` |
| **3** | **Natural-language, multi-turn interaction** | "Ask OREON" conversational RAG with persistent threads + Ctrl-K palette; autonomous voice agent (STT/TTS). | `api/v1/ask.py`, `api/v1/voice.py`, `models/conversation.py` |
| **4** | **Explainable, traceable recommendations** | Deterministic engines produce every decision; evidence cards cite the exact sensor reading / manual chunk / SOP / past incident behind each conclusion. | `evidence_engine.py`, `root_cause_engine.py`, investigation timeline |
| **5** | **Abnormality detection & failure prediction** | Threshold + trend anomaly engine, RandomForest RUL with 80% confidence bounds, always-on Sentinel agent, critical-event escalation at >70% failure prob. | `sensor_analysis_engine.py`, `rul_model_service.py`, `autonomous_agent_service.py`, `critical_event_detector.py` |
| **6** | **Feedback-driven improvement** | Closed online-learning loop: operator corrections re-calibrate RCA confidence (Laplace-smoothed trust score) and re-rank incidents — no batch retraining. | `feedback_learning_service.py`, `trust_score_engine.py`, `models/decision_feedback.py` |
| **7** | **Real-time alerting** | SSE telemetry stream + role-routed notifications/escalations (P1/P2/P3) with per-role read state. | `api/v1/stream.py`, `notification_engine.py`, `escalation_engine.py` |

### Expected Outputs

| Output Category | Delivered As | Where |
|---|---|---|
| Probable fault diagnosis + RCA | Investigation report with root cause, confidence, evidence | `investigation_service.py` |
| RUL / remaining-lifecycle prediction | ML forecast in days + confidence interval, severity-capped | `rul_model_service.py` |
| Early warning of catastrophic failure | Auto-escalation + War Room view on critical events | `critical_event_detector.py`, `warroom.tsx` |
| Risk classification & urgency | 0–100 priority score → LOW/MEDIUM/HIGH/CRITICAL band | `priority_engine.py` |
| Bottleneck prioritization (process/delay/spares/lead-time) | 9-factor weighted score incl. NetworkX blast radius | `priority_engine.py`, `plant_impact_engine.py` |
| Step-by-step maintenance plan + spare strategy | Phased plan (Immediate→Monitoring) + procurement analysis | `maintenance_planner.py`, `procurement_engine.py` |
| Structured reports | PDF/JSON export, per-asset & plant-wide | `report.py`, `pdf_generator.py` |
| Digital maintenance logbook | Auto-logged after every investigation + manual entries | `logbook.py`, `models/maintenance_log.py` |

### Optional Enhancements Implemented

Conversational interface · health/anomaly visualization dashboard · simulated IoT telemetry +
3D digital twin · per-equipment dynamic knowledge base · automatic digital logbook ·
user-role-based alerts & recommendations — **all six optional enhancements are present.**

---

## 1. Technology Stack

The platform is designed with a modern, decoupled service-oriented architecture:

*   **Backend Framework**: **FastAPI** (Python 3.12) - provides high-performance, asynchronous REST API endpoints, background execution worker threads, and Server-Sent Events (SSE) telemetry.
*   **Database**: **PostgreSQL** (version 16) - managed via **SQLAlchemy 2.0** (ORM) and **Alembic** (database migrations) for structural data persistence.
*   **Vector Database (RAG)**: **ChromaDB / Qdrant** (local embedded file-based or cloud cluster connection) - stores indexed chunks of PDF manuals and standard operating procedures (SOPs).
*   **Orchestration & Agents**: **LangGraph** & **LangChain** - routes queries and coordinates multi-agent reasoning.
*   **Machine Learning (RUL)**: **scikit-learn** (RandomForestRegressor) & **numpy** - trains on historical telemetry data to predict equipment degradation.
*   **Dependency Graph**: **NetworkX** - models the physical equipment topology and dependency flow.
*   **Frontend Client**: **TanStack Start** (React 19 + TypeScript + Vite) - hosts a responsive, role-tailored console.
*   **Styling & Visuals**: **Tailwind CSS v4** & **Framer Motion** - enables premium glassmorphism interfaces and fluid transitions.
*   **3D Digital Twin**: **Three.js** & **@react-three/fiber** - renders interactive 3D and 2D SVG plant layouts with live telemetry.

---

## 2. Decoupled System Architecture

The system topology isolates UI concerns, REST gateway operations, deterministic engineering calculations, and LLM explanation loops.

```mermaid
graph TD
  User([Maintenance Operator / Engineer]) -->|Interacts| FE[React / TanStack Start Client]
  FE -->|SSE Telemetry & Alerts| API[FastAPI Gateway]
  FE -->|REST HTTP Operations| API
  
  subgraph Backend Service Core
    API -->|1. Resolve Telemetry| Sensors[Sensor Service]
    API -->|2. Check Context| RAG[Hybrid RAG Engine]
    API -->|3. Route Query| Classifier[Complexity Classifier]
    
    Classifier -->|Simple Queries| FastModel[Single-Step Narrator: Llama 3.3]
    Classifier -->|Complex Diagnostics| LangGraph[LangGraph Multi-Agent Workflow]
    
    LangGraph -->|Asset Telemetry| AssetAgent[Asset Specialist]
    LangGraph -->|ML RUL Curve| RulAgent[RUL Analyst]
    LangGraph -->|Historical FMEA| RcaAgent[Root Cause Expert]
    LangGraph -->|Stock Lead Times| SparesAgent[Spare Parts Coordinator]
    LangGraph -->|Downtime Costs| PlanAgent[Priority Planner]
    LangGraph -->|LOTO Regulations| SafetyAgent[Safety Advisor]
  end
  
  subgraph Data Persistence Layer
    Sensors -->|Telemetry Stream| DB[(PostgreSQL Database)]
    RulAgent -->|Train / Predict| RF[RandomForest ML Engine]
    PlanAgent -->|Trace Downstream| NX[(NetworkX Plant Graph)]
    RAG -->|Dense Search| Qdrant[(ChromaDB / Qdrant Store)]
    RAG -->|Sparse Search| BM25[(Local BM25 Index)]
  end

  LangGraph -->|JSON Contract| API
  API -->|SSE Stream / JSON / PDF| FE
```

---

## 3. Data Flow & System Flow

OREON processes inputs from ingestion to structured output:

```
[INPUT INGESTION] ──► [CONTEXT ASSEMBLY] ──► [MULTI-AGENT REASONING] ──► [DECISION COMPILATION] ──► [STRUCTURED OUTPUT]
```

### 3.1 Request-Response Sequence Diagram
The following sequence diagram details the full processing path of an asset diagnostic and decision request:

```mermaid
sequenceDiagram
    autonumber
    actor Engineer as Maintenance Engineer
    participant FE as TanStack Start Client
    participant API as FastAPI Gateway
    participant DB as PostgreSQL DB
    participant NX as NetworkX Graph Service
    participant ML as RandomForest ML Service
    participant RAG as Hybrid RAG Engine
    participant LG as LangGraph Orchestrator
    participant LLM as Groq / OpenRouter API

    Engineer->>FE: Trigger Decision Report (Asset_ID)
    FE->>API: POST /api/v1/decision/analyze {asset_id, snapshot}
    
    API->>DB: Fetch Asset & Sensor History (250 readings)
    DB-->>API: Asset Record & Sensor Readings
    
    par Deterministic Engineering Engines
        API->>API: Run Anomaly & Trend Classifier
        API->>API: Run Root Cause Rules (8 scenarios)
    and Plant Topology Analysis
        API->>NX: Trace Blast Radius (Asset_ID)
        NX-->>API: Affected Downstream Assets & Line Impacts
    and Spare Procurement Check
        API->>DB: Query Spare Inventory & Lead Times
        DB-->>API: Spares Status & Procurement Risk
    and Degradation Forecasting
        API->>ML: Predict Remaining Useful Life (RUL)
        ML-->>API: Predicted Days & 80% Confidence Bounds
    end
    
    API->>API: Calculate Priority Score (Weighted formula)
    API->>API: Calculate Business Downtime Cost (₹ INR)
    API->>API: Simulate 3/7/14/30 Days Delay Scenarios
    
    API->>RAG: Retrieve Grounded Documents (Query, Asset_Type)
    RAG->>DB: Fetch Similar Incidents (Token overlap Jaccard)
    DB-->>RAG: Incident Summaries
    RAG->>RAG: ChromaDB dense search + BM25 sparse search
    RAG-->>API: Grounded Context (Manual Chunks + SOPs + Incidents)
    
    API->>LG: Initiate Multi-Agent Diagnostic State
    Note over LG: State passes sequentially:<br/>Asset -> RUL -> RCA -> Spares -> Planner -> Safety
    LG->>LLM: Explain Deterministic Output & RAG Evidence
    LLM-->>LG: Generated Summaries (Role-aware JSON)
    LG-->>API: Combined Diagnostic & Narrative State
    
    API->>DB: Auto-log Incident & Audit Trail
    API-->>FE: Return JSON DecisionReport
    FE->>Engineer: Display Glassmorphism Interactive Dashboard
```

---

## 4. Model Design & Reasoning Pipeline

OREON operates on a **strict three-layer reasoning principle**:
1.  **Deterministic Intelligence**: Domain-specific calculations, rules, plant graphs, and ML predictions always run first and make all analytical decisions.
2.  **Retrieval Intelligence**: Context-specific manuals, SOPs, and historical incident templates are retrieved from vector and database layers.
3.  **Narrative Intelligence**: Large Language Models (LLMs) act strictly as narrators to translate pre-computed numbers and evidence into clear, role-aware explanations.

---

### 4.1 LangGraph Multi-Agent Workflows
Complex maintenance diagnostics require multi-disciplinary verification. OREON coordinates this using a state graph:

```python
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
    status_updates: List[str]
```

The workflow coordinates six specialized agent nodes:
*   **Asset Specialist**: Gathers live telemetry and checks database records. Raises exceptions if the asset is missing, triggering immediate fallback routing.
*   **RUL Analyst**: Interfaces with the ML engine to verify degradation curves.
*   **Root Cause Expert**: Analyzes anomalies against historical logs and FMEA tables to determine failure modes.
*   **Spare Parts Coordinator**: Verifies replacement SKUs in warehouse inventories and flags lead-time risks.
*   **Priority Planner**: Integrates NetworkX bottlenecks, downtime costs (₹ INR), and shift availabilities.
*   **Safety Advisor**: Appends Lock-Out/Tag-Out (LOTO) requirements and safety warnings customized to the user's role.

---

### 4.2 Deterministic Root Cause Rules
The `RootCauseEngine` evaluates physical failure conditions using sensor thresholds and operational keywords. Rules are organised in two tiers — **steel-plant-specific failure modes** are evaluated first, then generic rotating-equipment modes — and the highest-confidence match across all of them wins.

**Steel-plant-specific failure modes** (mapped to the real incidents in the plant's history — tuyere fatigue, work-roll spalling, hearth erosion):

1.  **Tuyere Burn-through / Coolant Ingress** *(Blast Furnace)*: Cooling-water pressure $\le 2.5\text{ bar}$ OR fault text references `tuyere`/`coolant`/`water ingress`. Flags the hydrogen-explosion hazard of water reaching molten iron and recommends immediate blast reduction *(Confidence: up to 0.92)*.
2.  **Hearth Refractory Erosion** *(Blast Furnace)*: Stave temperature $\ge 110^\circ\text{C}$ OR text references `hearth`/`refractory`/`stave`/`lining`. Recommends increased stave cooling, titanium-burden skull rebuild, and campaign-end reline *(Confidence: 0.86)*.
3.  **Work-roll Spalling (Thermal Fatigue)** *(Rolling Mill)*: Vibration $\ge 4.5\text{ mm/s}$ AND (roll/strip/thermal evidence OR Temperature $\ge 80^\circ\text{C}$). Points to roll-cooling spray loss and subsurface fatigue cracking *(Confidence: 0.85)*.
4.  **Cooling-tower Fill Fouling / Scaling** *(Cooling System)*: Fouling/scaling/approach-temperature evidence. Recommends fill cleaning, anti-scalant/biocide dosing, and Legionella risk assessment *(Confidence: 0.80)*.
5.  **Belt Slip / Idler Misalignment** *(Conveyor)*: Belt/idler/pulley-lagging evidence OR Current $\ge 55\text{ A}$ OR Vibration $\ge 4.5\text{ mm/s}$. Diagnoses drive-pulley lagging wear starving the downstream furnace/mill feed *(Confidence: 0.78)*.

**Generic rotating-equipment failure modes:**

6.  **Bearing Wear**: Vibration $\ge 4.5\text{ mm/s}$ AND Temperature $\ge 80^\circ\text{C}$ AND Description contains `bearing`, `noise`, or `grinding`.
7.  **Lubrication Failure**: Temperature $\ge 85^\circ\text{C}$ AND Description contains `lubrication`, `oil`, `grease`, or `filter`.
8.  **Shaft Misalignment**: Vibration $\ge 5.0\text{ mm/s}$ AND (Description contains `misalign` or `coupling` OR Current $\ge 55\text{ A}$).
9.  **Motor Overload**: Asset Type is `motor` AND Current $\ge 55\text{ A}$ AND Temperature $\ge 80^\circ\text{C}$.
10. **Cooling Failure**: (Asset ID contains `cooling` OR Description contains `cool` or `temperature`) AND Temperature $\ge 90^\circ\text{C}$.
11. **Gearbox Wear**: Asset ID contains `gearbox` AND Vibration $\ge 4.5\text{ mm/s}$ AND Temperature $\ge 80^\circ\text{C}$.
12. **Pump Cavitation**: Asset Type is `pump` AND Pressure $\le 2.5\text{ bar}$ AND Vibration $\ge 4.5\text{ mm/s}$ *(Confidence: 0.89)*.
13. **Fan Imbalance**: Asset Type is `fan` AND Vibration $\ge 4.5\text{ mm/s}$ AND (Noise $\ge 88\text{ dB}$ OR Description contains `imbalance`).

*Fallback*: `"Undetermined industrial fault"` (Confidence: 0.35).

---

### 4.3 Plant Priority Scoring Engine
OREON prioritizes maintenance using a multi-factor weighted formula, generating a score between 0 and 100:

$$\text{Priority Score} = w_1 P_f + w_2 (100 - H) + w_3 S_{rul} + w_4 C_{crit} + w_5 F_{inc} + w_6 S_f + w_7 (1 - S_{avail}) + w_8 L_t + w_9 I_{plant}$$

| Weight | Input Variable | Description |
|---|---|---|
| **0.22** | $P_f$ | Failure Probability (derived from sensor anomalies and history) |
| **0.16** | $100 - H$ | Asset Health Deficit (100 - Health Score) |
| **0.14** | $S_{rul}$ | Remaining Useful Life Score (shorter RUL increases priority) |
| **0.14** | $C_{crit}$ | Asset Criticality Level (Low: 25, Medium: 50, High: 75, Critical: 100) |
| **0.10** | $F_{inc}$ | Historical Incident Frequency (repeat offenders get boosted) |
| **0.12** | $S_f$ | Safety Risk Factor (hazards, voltage, temperature) |
| **0.06** | $1 - S_{avail}$ | Stock Shortage Indicator (1 if replacement parts are out of stock) |
| **0.03** | $L_t$ | Supplier Procurement Lead Time (longer lead times raise urgency) |
| **0.03** | $I_{plant}$ | Plant Downstream Impact Score (NetworkX blast radius) |

*Priority Bands*: `CRITICAL` ($\ge 80$), `HIGH` ($\ge 60$), `MEDIUM` ($\ge 35$), `LOW` ($< 35$).

---

### 4.4 Machine Learning-Based Remaining Useful Life (RUL)
The `RulModelService` implements a `RandomForestRegressor` from `scikit-learn` to forecast degradation:

*   **Dataset Construction**: Constructs training matrices matching temperature, vibration, pressure, current, and historical equipment running hours against targets. Target RUL is computed as the duration (in days) between a telemetry reading and the subsequent failure timestamp.
*   **Confidence Intervals**: Computes the prediction standard deviation across all trees in the forest ensemble to yield lower and upper 80% percentile bounds (`np.percentile`).
*   **Physical Constraints**: Automatically overlays severity limits. If an asset is marked as critical in the DB, the RUL estimate is capped at 10 days, and degraded assets are capped at 30 days, preventing optimistic ML predictions for physically failing machinery.

---

### 4.5 NetworkX Plant Dependency Graph
The plant layout is modeled as a directed dependency graph using **NetworkX**, allowing topological blast-radius and downstream bottleneck tracing:

```
Motor_M12 ──drives──► Conveyor_C7 ──feeds──► BlastFurnace_BF2 ──requires──► Fan_F2 ──► DustCollector_DC1
                           ▲
Crusher_CR1 ──feeds────────┘

Pump_P3 ──supplies──► CoolingSystem_C1 ──cools──► BlastFurnace_BF2
                                         └──cools──► RollingMill_RM1 ──drives──► Gearbox_G1
```

If `Pump_P3` fails:
1.  Topological search identifies downstream child nodes: `CoolingSystem_C1`, `BlastFurnace_BF2`, `RollingMill_RM1`, and `Gearbox_G1`.
2.  The blast-radius score is computed based on node weights (criticality) and topological distance.
3.  Production lines `PL-1` and `PL-2` are flagged as blocked.
4.  Downtime costs are calculated at the plant level.

---

## 5. Alerting & Prediction Logic

### 5.1 Dynamic Abnormality & Real-Time Alerting
*   **Anomaly Classifier**: The `SensorAnalysisEngine` checks telemetry against dynamic thresholds.
*   **SSE Broadcast**: The backend publishes real-time readings to `/api/v1/stream/sensors` using `EventSourceResponse` (Server-Sent Events).
*   **UI Reflex**: The client's background `EventSource` listener invalidates query keys on active cards when alert signals arrive, instantly updating health scores, status badges, and dispatching targeted role notifications.
*   **Catastrophic Prevention**: The `CriticalEventDetector` triggers supervisor notifications and escalations when an asset's failure probability exceeds 70% and its NetworkX blast-radius score affects critical downstream systems (e.g., Blast Furnace).

### 5.2 Feedback-Driven Online Learning Loop
To improve recommendations, OREON includes a closed learning loop:
1.  **Feedback Capture**: Operators submit thumbs-up/down ratings or log explicit corrections (*"Predicted cause was bearing wear, actual cause was lubrication leakage"*).
2.  **Laplace-Smoothed Online Calibration**: The system aggregates feedback entries in the database to adjust confidence scores dynamically:
    $$\text{Trust Score} = \frac{\text{Confirmations} + 1}{\text{Confirmations} + \text{Rejections} + 2}$$
3.  **Incident Re-Ranking Boost**: Promotes or demotes historical incidents in future searches based on their trust scores. This online learning requires no slow batch retraining.

---

## 6. Knowledge Integration & RAG Pipeline

OREON uses a **dual-retrieval hybrid RAG system** with three knowledge sources:

| Source | Service | Storage | Retrieval Method |
|--------|---------|---------|-----------------|
| Equipment Manuals (PDF) | `ManualKnowledgeService` | ChromaDB (`oreon_manuals`) | Vector (dense embedding) + Jaccard fallback |
| SOPs (PDF) | `SOPKnowledgeService` | ChromaDB (`oreon_sops`) | Vector (dense embedding) + Jaccard fallback |
| Historical Incidents | `IncidentRetrievalService` | PostgreSQL (`Incidents` Table) | Pure tokenized Jaccard similarity |

### 6.1 Chunking & Extraction
*   **Chunking Strategy**: Character-based sliding window (`chunk_size=900`, `overlap=150` characters). This ensures that procedural steps and safety warnings remain unified in individual chunks.
*   **PDF Extraction**: Extracted via `pypdf.PdfReader` with a raw-text fallback (UTF-8, then Latin-1).

### 6.2 Embedding Technology
The vector database uses the deterministic `HashingEmbeddingService` for vector representation:

```python
def embed(self, text: str) -> list[float]:
    vector = [0.0] * 384
    for token in TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % 384
        sign = 1.0 if digest[4] % 2 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(v*v for v in vector)) or 1.0
    return [v / norm for v in vector]
```

This deterministic hashing maps tokens to a 384-dimensional float space. While lexical in nature, it offers **zero latency**, requires **no GPU/external API**, and maintains 100% availability during network disruptions.

### 6.3 Retrieval & Reranking
1.  **Dense search** queries ChromaDB using the 384-dim hash embedding.
2.  **Sparse search** runs a local BM25 index query over exact terms (SOP numbers, SKU codes).
3.  **Reciprocal Rank Fusion (RRF)** merges the two candidate lists:
    $$\text{RRF Score}(d \in D) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
4.  **Reranking** runs a cosine similarity cross-encoder to select the top 3 chunks, feeding a highly optimized prompt payload to the LLM context.

---

## 7. Role-Based Customization Matrix

OREON customizes dashboards, KPIs, sort orders, and AI explanations according to six active operational roles:

| Role | Interface Focus | Primary KPI Metrics | Default Sort Order | Ask Persona / Explanation Style |
|---|---|---|---|---|
| `plant_manager` | Plant risk & cost | Revenue exposure, OEE, downtime | Business Impact | ₹ INR financial risk and production line exposures |
| `maintenance_engineer` | Active repairs & SOPs | Needs repair, SOP coverage, avg RUL | Remaining Useful Life | Detailed repair steps, tool checklists, and SOP refs |
| `reliability_engineer` | Predictive degradation | Failure probability, RUL confidence | Failure Probability | Statistical variance, confidence intervals, sensor trends |
| `procurement_officer` | Spare parts supply | Shortages, lead times, capital | Procurement Risk | Spare part SKUs, reorder points, supplier lead times |
| `supervisor` | SLA & team escalations | Active escalations, SLA breaches | Escalation Urgency | SLA countdowns, team assignments, escalation paths |
| `operator` | Field quick-actions | Unacknowledged alerts, checklists | Alert Severity | Extremely simple, jargon-free physical actions & LOTO |

---

## 8. Assumptions & Limitations

1.  **Simulated SCADA Feed**: Telemetry readings are generated by a background simulation service (`sensor_stream_service.py`) using random-walk distributions rather than a live SCADA connection.
2.  **Cosmetic Login**: Authentication is mock/cosmetic. The layout and API headers adapt dynamically, but session validation (JWT, OAuth2) is not active.
3.  **Local Vector Lock**: Embedded ChromaDB database locks files per-process, preventing horizontal scaling of backend API instances unless configured with a remote vector DB client.

---

## 9. Installation & Setup Guide

### 9.1 Prerequisites
*   Docker & Docker Compose
*   *Or local execution*: Python 3.12+, Node.js 20+, PostgreSQL

### 9.2 Production Launch (Docker Compose)
The easiest way to run the entire system is using the automated deployment script.

1.  **Clone the Repository**.
2.  **Run the Deploy Script**:
    ```bash
    # Run the setup script (Bash)
    chmod +x deploy.sh
    ./deploy.sh
    ```
    *This script generates a secure random `SECRET_KEY`, writes the `.env` configuration, checks if Docker is running, and starts the container network in detached mode.*
3.  **Access the Platform**:
    *   **Frontend Client**: `http://localhost:8080`
    *   **Backend API Gateway**: `http://localhost:8000`
    *   **API Interactive Docs (Swagger)**: `http://localhost:8000/docs`
    *   **Health Status Probe**: `http://localhost:8000/health`

---

### 9.3 Local Development Setup (Manual)

#### 1. Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create backend/.env (copy from ../.env.example) and populate your keys:
# DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/oreon
# LLM_PROVIDER=groq                          # "groq" (fast, free) or "openrouter"
# GROQ_API_KEY=gsk_...                        # https://console.groq.com  (free tier)
# OPENROUTER_API_KEY=sk-or-...                # https://openrouter.ai/keys (fallback)
# DEEPGRAM_API_KEY=...                        # optional — voice STT/TTS

# Run database schema migrations
alembic upgrade head

# Seed initial plant assets & incident histories
python -m app.utils.data_loader

# Run the test suite
python -m pytest

# Start the web server
uvicorn app.main:app --reload --port 8000
```

#### 2. Frontend Setup
```bash
cd frontend

# Create frontend/.env.local:
# VITE_API_URL=http://localhost:8000

# Install dependencies and start development server
npm install --legacy-peer-deps
npm run dev # Launches console at http://localhost:8080
```

---

## 10. Sample Input & Output Demonstration

### 10.1 Ask OREON Streaming payload (`POST /api/v1/ask`)
Request to the conversational RAG engine with role-based parameters:
```json
{
  "query": "Why is Motor_M12 running hot and vibrating?",
  "role": "maintenance_engineer",
  "context_asset_id": "Motor_M12",
  "pins": [
    { "kind": "sop", "label": "motor_sop.pdf" }
  ]
}
```

Response payload (streamed via SSE and cached):
```json
{
  "conversation_id": "conv_9a2b8e5c",
  "diagnosis": "Motor_M12 is exhibiting high-frequency vibration (9.4 mm/s) and temperature spikes (88.5°C) indicative of bearing cage wear.",
  "recommended": "1. Perform Lock-Out/Tag-Out (LOTO) on breaker M12.\n2. Disassemble casing and inspect bearing housing.\n3. Apply grease per Motor SOP Sec 4.2.",
  "evidence": [
    { "text": "Inspect bearings every 500 hours for cage degradation.", "src": "motor_sop.pdf" }
  ],
  "confidence": 88.5,
  "critical": true,
  "reasoning": [
    { "t": "Troubleshooting", "d": "Telemetry spikes identified..." },
    { "t": "Safety", "d": "LOTO required on electrical isolator..." }
  ]
}
```

### 10.2 Decision Report Analysis (`POST /api/v1/decision/analyze`)
Triggers complete diagnostic analysis:
```json
{
  "asset_id": "Motor_M12",
  "fault_description": "Vibration spikes",
  "sensor_snapshot": {
    "temperature_c": 88.5,
    "vibration_mms": 9.4
  }
}
```

Response payload:
```json
{
  "asset_id": "Motor_M12",
  "priority": {
    "priority_score": 88.2,
    "priority_band": "CRITICAL"
  },
  "plant_impact": {
    "affected_assets": ["Conveyor_C7", "BlastFurnace_BF2"],
    "production_line": "PL-1",
    "impact_score": 92.0
  },
  "business_impact": {
    "production_loss_estimate": "240 tonnes",
    "cost_of_inaction_inr": 1200000.0,
    "business_risk": "CRITICAL"
  },
  "procurement": {
    "required_parts": ["bearing"],
    "procurement_risk": "MEDIUM",
    "lead_time_days": 12
  },
  "scenario_analysis": {
    "3": { "failure_probability": 0.82, "projected_health": 35.0 },
    "7": { "failure_probability": 0.94, "projected_health": 18.0 }
  }
}
```

> A fuller, click-through walkthrough of inputs and expected outputs (per screen and per
> endpoint) is provided in **`DEMO_SCRIPT.md`**, and the interactive Swagger UI at
> `http://localhost:8000/docs` lets evaluators run every endpoint live against seeded data.

---

## 11. Repository Map & Deliverables

### What's in this submission

| Path | Contents |
|---|---|
| `backend/` | FastAPI service — 17 routers, 42 services, 12 DB models, deterministic engines, RAG, ML, Sentinel agent |
| `frontend/` | TanStack Start (React 19) console — 19 pages, 3D twin, voice agent, role-tailored dashboards |
| `backend/data/` | Seed data — 25+ assets, 100+ incidents, 40+ spare parts, sensor history, plant graph |
| `docker-compose.yml`, `deploy.sh` | One-command containerized launch |
| `README.md` | **This document** — the consolidated architecture & operations guide |
| `implementation.md` | Exhaustive per-file engineering reference (every route, service, model) |
| `DEMO_SCRIPT.md` | Guided demo narrative with sample inputs/outputs for the screen recording |
| `RAG_EVALUATION_REPORT.md` | Retrieval quality benchmarks |
| `SETUP.md` | Detailed local (non-Docker) run instructions |

### Deliverables checklist (per problem statement §9)

- [x] **Detailed source code of working prototype** — `backend/` + `frontend/`, runs via `./deploy.sh`
- [x] **System architecture** — §2 + architecture diagrams (`/architecture` page renders them live)
- [x] **Technology stack** — §1
- [x] **Data flow & system flow** — §3 (sequence diagram)
- [x] **Model design & reasoning pipeline** — §4
- [x] **Alerting & prediction logic** — §5
- [x] **Assumptions & limitations** — §8
- [x] **Install / configure / run documentation** — §9 + `SETUP.md`
- [x] **Sample input & output demonstration** — §10 + `DEMO_SCRIPT.md` + Swagger `/docs`
- [ ] **Screen recording** — record the flow in `DEMO_SCRIPT.md` and include in the final ZIP

---

*OREON — built to shift steel-plant maintenance from reactive firefighting to proactive,
explainable, data-driven decision-making.*
