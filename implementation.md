# OREON — Complete Implementation Reference

> **OREON** is an Industrial Maintenance Decision Intelligence Platform for a steel manufacturing plant. It combines deterministic engineering rules, ML-based RUL prediction, multi-agent RAG, and a real-time 3D frontend to turn raw sensor telemetry into actionable maintenance decisions.

---

## Table of Contents

1. [Project Structure Overview](#1-project-structure-overview)
2. [Frontend Routes (Pages)](#2-frontend-routes-pages)
3. [Frontend Components](#3-frontend-components)
4. [Frontend Libraries & Hooks](#4-frontend-libraries--hooks)
5. [Frontend UI Component Library](#5-frontend-ui-component-library)
6. [Backend API Endpoints](#6-backend-api-endpoints)
7. [Backend Services](#7-backend-services)
8. [Backend Models (Database)](#8-backend-models-database)
9. [Backend Schemas (Pydantic)](#9-backend-schemas-pydantic)
10. [Backend Utilities](#10-backend-utilities)
11. [Configuration & Bootstrap](#11-configuration--bootstrap)
12. [Data Layer](#12-data-layer)
13. [Architecture Patterns](#13-architecture-patterns)

---

## 1. Project Structure Overview

```
oreon/
├── implementation.md          ← this file
├── CLAUDE.md                  ← architecture rules and working agreements
├── SETUP.md                   ← run instructions
├── docker-compose.yml         ← Postgres + backend + (optional) Redis
├── .env.example               ← env var template
├── frontend/                  ← TanStack Start / React 19 / Vite app
│   ├── src/
│   │   ├── routes/            ← file-based pages (19 route files)
│   │   ├── components/        ← shared UI components
│   │   │   ├── ui/            ← Radix UI / shadcn design system (45 files)
│   │   │   ├── oreon/         ← product-specific components
│   │   │   └── landing/       ← marketing page components
│   │   ├── lib/               ← API client, hooks, state, config
│   │   └── styles.css         ← global design tokens + Tailwind base
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
└── backend/
    ├── app/
    │   ├── main.py            ← FastAPI factory + lifespan + middleware
    │   ├── config/settings.py ← Pydantic Settings (all env vars)
    │   ├── database/          ← SQLAlchemy engine, session, Base
    │   ├── models/            ← ORM table definitions (12 models)
    │   ├── schemas/           ← Pydantic request/response (14 schema files)
    │   ├── api/v1/            ← Thin HTTP route handlers (17 routers)
    │   ├── services/          ← All business logic (42 service files)
    │   └── utils/             ← Seeding, PDF, Redis cache, schema fixes
    ├── data/                  ← Seed JSON (assets, incidents, spares, graph)
    ├── requirements.txt
    └── Dockerfile
```

**Key numbers:** 19 frontend pages · 42 backend services · 17 API routers · 12 DB models · 45 UI components

---

## 2. Frontend Routes (Pages)

All routes use TanStack Start file-based routing. Files under `frontend/src/routes/` map 1-to-1 to URL paths.

---

### `__root.tsx` — Root Layout Wrapper
**URL:** wraps everything  
**What it does:** Defines the top-level layout: React Query provider, Toaster, global error boundary, and the `<Outlet />` that renders child routes. Also sets the `<html>` document shell (meta tags, fonts, viewport). Handles 404 and uncaught error display.  
**Why it exists:** Every TanStack Start app needs one root layout as the universal wrapper — providers must be mounted here so all child routes inherit them.

---

### `index.tsx` — Landing / Marketing Page
**URL:** `/`  
**What it does:** The public marketing page. A fullscreen hero section with a parallax scroll effect renders the OREON wordmark in brushed-steel CSS gradient (`ORE` in silver, `ON` in white). Below the hero: a capabilities overview, plant schematic preview, tech stack section, and a call-to-action. Uses Framer Motion for scroll-reveal animations and scroll parallax on the hero.  
**Key components used:** `SiteShell` (header), `LaunchTransition` (page exit animation), `OreonWord` (brand wordmark), `PlantSchematic`, Framer Motion `motion.div` with `useScroll`/`useTransform`  
**Why it exists:** First impression for hackathon judges and stakeholders. Communicates the platform's purpose before login.

---

### `login.tsx` — Demo Login
**URL:** `/login`  
**What it does:** A simple login form pre-filled with demo credentials for each role (Operator, Maintenance Engineer, Supervisor, Plant Manager, Reliability Engineer, Procurement Officer). Selecting a role and clicking "Enter OREON" sets the active role in Zustand store and redirects to `/command`. No real authentication — login is cosmetic.  
**Why it exists:** Required for the demo to show role-personalised UX. Allows judges to explore the system from different stakeholder perspectives.

---

### `command.tsx` — Command Center Dashboard
**URL:** `/command`  
**What it does:** The main operational dashboard after login. Shows a high-level plant health snapshot: KPI cards (health score, active alerts, critical assets, procurement risks), a ranked list of priority assets, and recent sentinel activity. Data is fetched from `GET /api/v1/dashboard` and auto-refreshed every 30 seconds. The layout responds to the active role — plant managers see financial KPIs first; operators see sensor anomalies first.  
**Why it exists:** The first screen operators and managers land on after login. Acts as a "mission control" — one glance tells you the plant's current health state.

---

### `app.ask.tsx` — Ask OREON (Conversational RAG)
**URL:** `/app/ask`  
**What it does:** Full conversational interface for querying the OREON knowledge base. Left panel shows conversation history list; right panel shows the active conversation with streaming message responses. Users can pin asset IDs and SOP documents into the context. Messages stream back as NDJSON. Includes the `AskPalette` (Ctrl-K shortcut) for quick asset/SOP lookup.

**Key implementation details:**
- Uses `staleTime: 0` on the messages React Query key so replies are never served from a stale cache
- Optimistic UI: shows user's message immediately as a "pending bubble" while the stream completes
- `sentAtLenRef` tracks message count at send time; a catch-up effect clears the bubble once the DB thread grows past that count
- Switching conversations aborts the in-flight stream and resets all transient state
- Empty state displays `Ask <OreonWord />` with example questions

**Why it exists:** Core user-facing feature. Lets engineers ask natural language questions like "What's the root cause of vibration on Motor_M12?" and get grounded, cited answers from manuals, SOPs, and historical incidents.

---

### `assets.index.tsx` — Asset Inventory List
**URL:** `/assets`  
**What it does:** Paginated grid/list of all plant assets. Each card shows the asset name, equipment type, health score (colour-coded bar), failure probability, RUL in days, and status badge (Operational / Degraded / Critical). Clicking a card navigates to the asset detail page. Supports filter by status and criticality.  
**Why it exists:** Entry point for browsing all equipment. Lets maintenance teams triage which assets need attention without running an investigation first.

---

### `assets.$id.tsx` — Asset Detail
**URL:** `/assets/:id` (e.g. `/assets/Motor_M12`)  
**What it does:** Deep-dive page for a single asset. Shows: current sensor readings (temp, vibration, pressure, current, RPM), health trend chart, active incidents, maintenance log history, RUL prediction with confidence bounds, and a link to run a full investigation. Also shows the asset's position in the plant dependency graph and its blast-radius (which downstream assets fail if this one fails). Has a "Download Report (PDF)" button that calls `GET /api/v1/report/{asset_id}/export`.  
**Why it exists:** The single-asset view is where maintenance engineers spend most of their time — they navigate here from alerts or the asset list to understand what's happening with a specific machine.

---

### `investigations.tsx` — Investigation Results
**URL:** `/investigations`  
**What it does:** Shows completed investigation reports. For each investigation: the timeline of analysis steps (Loading Asset → Analyzing Sensors → Searching Manuals → Running RCA → Building Report), the root-cause diagnosis with confidence percentage, evidence cards (sensor thresholds violated, SOP references, similar historical incidents), recommended actions, and the LLM narrative explanation. Also shows learning signals — whether operator feedback has adjusted the confidence on this root cause.  
**Why it exists:** Gives engineers a structured output from the investigation engine. The timeline makes the reasoning transparent — engineers can see *how* OREON reached its conclusion.

---

### `decisions.tsx` — Decision Intelligence
**URL:** `/decisions`  
**What it does:** Three-tab layout: **Maintenance** (priority-ranked asset list with score breakdown), **Business** (financial impact — downtime cost in INR, revenue exposure, cost of action vs. inaction), **Procurement** (spare part availability, lead times, risk bands). Each priority asset card shows the 9-factor score with a mini breakdown. Scenario analysis shows projected risk at 3 / 7 / 14 / 30 day delay horizons.  
**Why it exists:** The decision layer is OREON's core value proposition. It translates technical sensor data into business language that plant managers and procurement officers can act on.

---

### `incidents.tsx` — Incident History
**URL:** `/incidents`  
**What it does:** Searchable, filterable log of all historical maintenance incidents. Each incident shows: asset, timestamp, symptoms, root cause, corrective action taken, repair time, downtime hours, severity, and technician. Used for pattern recognition — if the same failure mode keeps recurring on one asset type, that surfaces here.  
**Why it exists:** Historical incidents are the training data for the RCA engine's similarity search and for the feedback learning loop. Engineers also reference this directly during diagnostics.

---

### `alerts.tsx` — Alert Feed
**URL:** `/alerts`  
**What it does:** Real-time alert feed filtered by active role. Each alert shows severity (Critical / High / Medium / Low), affected asset, description, and timestamp. Clicking "Mark as read" calls `POST /api/v1/alerts/{id}/read` and removes it from the unread count in the sidebar. Alert severity is colour-coded and sorted with Critical first.  
**Why it exists:** The first thing operators check at shift start. Alerts are generated autonomously by the Sentinel agent every 60 seconds and by the critical event detector when failure probability crosses 70%.

---

### `escalations.tsx` — Escalation Queue
**URL:** `/escalations`  
**What it does:** Shows all active escalations (unresolved SLA-tracked events requiring human decision). Each card shows: escalation level (P1/P2/P3), target roles, description, the asset involved, time raised, and an elapsed timer. "Resolve" button calls `POST /api/v1/escalations/{id}/resolve`. Manual escalation form allows users to create new P1/P2/P3 escalations for any asset.  
**Why it exists:** Bridges the gap between automated detection and human response. When OREON detects a critical situation it can't auto-resolve, it escalates to the right people. This page is the escalation inbox.

---

### `procurement.tsx` — Spare Parts & Procurement
**URL:** `/procurement`  
**What it does:** Displays spare parts inventory: part name, SKU, equipment type it applies to, current stock, minimum stock threshold, reorder point, lead time (days), supplier, and unit cost. Items with `current_stock <= reorder_point` are highlighted. Procurement officers use this to raise purchase orders before lead time runs out.  
**Why it exists:** Procurement risk is one of the 9 factors in the priority scoring formula. A critical asset with a long lead time for its replacement part scores higher urgency. This page makes that risk visible.

---

### `logbook.tsx` — Maintenance Logbook
**URL:** `/logbook`  
**What it does:** Chronological log of maintenance actions — both manually created entries and auto-logged entries from completed investigations. Each entry shows: asset, issue description, diagnosed root cause, action taken, estimated hours, technician assigned, and timestamp. New entries can be added manually via a form. Auto-entries are created every time the investigation service completes.  
**Why it exists:** Audit trail and operational memory. Maintenance engineers reference this when a fault recurs to see what was done last time. It also feeds into MTBF calculations.

---

### `sentinel.tsx` — Autonomous Agent Monitor
**URL:** `/sentinel`  
**What it does:** Dashboard for the Sentinel autonomous monitoring agent. Shows: current status (scanning / idle), total scans performed, anomalies detected, escalations triggered, and a paginated timeline of recent activities (anomaly detected, alert raised, investigation triggered, escalation created). A "Trigger Manual Scan" button calls `POST /api/v1/sentinel/trigger` to run an immediate cycle.  
**Why it exists:** Makes the autonomous agent's behaviour transparent. Engineers can see exactly what Sentinel did, when, and why — building trust in the automated system.

---

### `warroom.tsx` — Crisis War Room
**URL:** `/warroom`  
**What it does:** Crisis command center activated during P1 critical events. Shows live metric tiles for the affected asset, active escalation details, recommended immediate actions by role, countdown timer for the response window, and a communication log. Designed for real-time multi-stakeholder coordination during a plant emergency.  
**Why it exists:** High-stakes incidents need a dedicated "bridge" view that cuts through noise and shows only what matters right now. Normal dashboard is too information-dense for crisis response.

---

### `simulator.tsx` — Failure Scenario Simulator
**URL:** `/simulator`  
**What it does:** "What-if" modelling tool. User selects an asset and a delay duration (3 / 7 / 14 / 30 days). Calls `POST /api/v1/decision/scenario` and displays projected failure probability, estimated downtime cost, revenue exposure, and recommended action for each delay scenario. A comparison table shows all four horizons side-by-side.  
**Why it exists:** Helps plant managers quantify the cost of deferring maintenance. "If we wait 7 more days on this motor, the expected loss is ₹X." Turns a maintenance decision into a financial trade-off.

---

### `twin.tsx` — 3D Digital Plant Twin
**URL:** `/twin`  
**What it does:** Real-time 3D/isometric visualization of the plant floor. Each asset node is colour-coded by health status (green → operational, amber → degraded, red → critical). Live telemetry from the SSE stream (`GET /api/v1/stream/sensors`) updates node colours every 3 seconds. Clicking a node navigates to the asset detail page. Two view modes: isometric grid and a full-3D Three.js scene.  
**Why it exists:** Provides spatial context — engineers need to know *where* in the plant a fault is occurring, not just which asset ID. The 3D view is a key demo showpiece.

---

### `architecture.tsx` — System Architecture Diagrams
**URL:** `/architecture`  
**What it does:** Static page displaying Mermaid flowcharts and block diagrams of the OREON system: data flow from SCADA → backend → LLM, the LangGraph multi-agent coordination graph, the RAG retrieval pipeline, and the feedback learning loop. Also shows the plant dependency graph topology.  
**Why it exists:** Required for the hackathon submission — judges need to understand the system architecture. Also useful onboarding documentation for new engineers.

---

### `platform.tsx` — Platform Overview
**URL:** `/platform`  
**What it does:** Product tour / feature overview page. Walks through each OREON module (Investigation, Decision, Sentinel, Voice, Ask) with icons, descriptions, and screenshots. Includes a role guide section showing which features each role (Operator, Engineer, Manager, etc.) uses most.  
**Why it exists:** Onboarding guide for new users and a product narrative for the demo.

---

### `about.tsx` — About Page
**URL:** `/about`  
**What it does:** Background on the OREON project: problem statement (steel plant maintenance costs), solution overview, technology stack breakdown, and team/submission context.  
**Why it exists:** Hackathon requirement — provides context on what was built and why.

---

## 3. Frontend Components

### `oreon/shell.tsx` — App Shell Layout
**What it does:** The main application chrome wrapping all `/command`, `/assets`, `/decisions`, etc. pages. Renders: a collapsible sidebar with navigation links, a top bar with the active page title and role switcher, and a main content viewport (`<Outlet />`). The sidebar shows the OREON wordmark, nav items (each with icon + label), and the active role badge.

Key behaviours:
- `renderBrandTitle()` helper replaces any literal "OREON" in page titles with the `<OreonWord />` component so the steel/white branding is consistent everywhere
- The "Ask OREON" nav item renders `Ask <OreonWord />` instead of plain text
- The "OREON Voice" header button shows `<OreonWord /> Voice`
- Navigation items include icons from Lucide React

**Why it exists:** Single layout component means nav/sidebar changes are made in one place. All authenticated app pages inherit this layout automatically.

---

### `oreon/oreon-word.tsx` — Brand Wordmark Component
**What it does:** Renders the OREON brand name with consistent split styling: `ORE` uses `.text-steel` (brushed silver CSS gradient) and `ON` uses `.text-foreground` (white in dark theme). Accepts a `className` prop for size/weight overrides.

```tsx
<span className={className}>
  <span className="text-steel">ORE</span>
  <span className="text-foreground">ON</span>
</span>
```

**Why it exists:** Used in 6+ locations (landing header, sidebar, "Ask OREON" nav, empty state, "OREON Voice" button, voice subtitles). Centralises the styling so a single change updates every occurrence.

---

### `oreon/ask-palette.tsx` — Command Palette
**What it does:** A `cmdk`-powered command palette (opens with Ctrl-K or from the sidebar). Provides fuzzy search over all assets and SOPs. Selecting an item pins it into the current Ask OREON conversation context. Also supports quick navigation shortcuts.  
**Why it exists:** Power-user shortcut. Instead of browsing the asset list to find Motor_M12, you type "M12" in the palette and it's pinned. Reduces friction for experts.

---

### `oreon/thinking-state.tsx` — Loading Indicator
**What it does:** Animated thinking / loading component used during investigation and decision analysis. Shows a pulsing spinner with a label like "Running Root Cause Analysis..." that cycles through investigation timeline steps.  
**Why it exists:** The investigation pipeline takes 3–8 seconds. This component prevents the user thinking the app is broken.

---

### `oreon/error-boundary.tsx` — Error Boundary
**What it does:** React class-based error boundary. Catches JS runtime errors in the component tree, logs them, and renders a fallback UI ("Something went wrong") instead of a blank white screen.  
**Why it exists:** Production resilience. Without it, a single component crash would break the entire page.

---

### `oreon/isometric-plant.tsx` — Isometric Plant View
**What it does:** 2D isometric CSS-art representation of the plant floor. Each asset tile shows name, health score, and a status colour. Tiles are positioned on a grid that roughly reflects the physical layout. Hovering a tile shows a tooltip with live sensor values. Clicking navigates to the asset detail.  
**Why it exists:** Lighter alternative to the full Three.js 3D twin — loads faster, works on low-end hardware, and is used in the twin page's "isometric" view mode.

---

### `oreon/plant-3d.tsx` — Full 3D Plant Twin
**What it does:** Three.js + React Three Fiber scene rendering a 3D isometric factory. Asset nodes are coloured boxes or meshes colour-coded by health. Uses `OrbitControls` for camera control. Live sensor data from the SSE stream updates node colours in real time. Raycasting detects clicks on nodes and navigates to the asset page.  
**Why it exists:** The flagship visual for the demo and hackathon submission. Makes the platform feel like a real industrial SCADA system rather than a dashboard.

---

### `oreon/voice-agent/VoiceDashboard.tsx` — Voice Agent UI
**What it does:** Full-screen voice interaction UI. Three regions:
1. **Orb area:** A 20,000-particle GLSL Three.js sphere (monochrome: core `#5b6675`, rim `#eef3f8`) that animates based on agent state (idle / listening / thinking / speaking)
2. **State indicator:** Colour-coded pill showing current state (Listening · Thinking · Response · Standby)  
3. **Subtitles panel:** Glassy dark surface with a grid-texture background, state-coloured top edge, `<OreonWord /> · Voice` brand tag, and scrolling transcript of what was heard and said

**Why it exists:** Makes voice interaction feel native to the OREON industrial theme. The orb visualises agent activity so operators know if the system is processing without looking at text.

---

### `oreon/voice-agent/ParticleSphere.tsx` — Particle Orb
**What it does:** Three.js `<Canvas>` component rendering a 20,000-point particle sphere with custom GLSL vertex and fragment shaders. Shader uniforms (`uTime`, `uAmplitude`, `uState`) drive the animation — idle is a gentle float, listening is rapid pulsing, thinking is a slow orbital swirl, speaking has outward expansion rings.  
**Why it exists:** The orb is the face of the voice agent. A visually rich, reactive orb communicates agent activity in a way that a simple spinner cannot.

---

### `landing/SiteShell.tsx` — Landing Page Header
**What it does:** The top navigation bar on the public marketing pages (`/`, `/platform`, `/about`, `/architecture`). Shows the OREON logo (`<OreonWord />`), navigation links, and a "Launch OREON" CTA button. Collapses to a hamburger menu on mobile.  
**Why it exists:** Consistent header across all landing pages. Separate from `oreon/shell.tsx` because the marketing header has different nav items (no sidebar, links to About/Platform) compared to the app shell.

---

### `landing/LaunchTransition.tsx` — Page Transition Animation
**What it does:** Full-screen plasma explosion / portal animation that plays when the user clicks "Launch OREON" on the landing page before navigating to `/login`. Uses canvas-based particle burst with Framer Motion opacity fade.  
**Why it exists:** Brand moment. Turns a simple page navigation into a memorable entry sequence for the demo.

---

### `landing/OreonMark3D.tsx` — 3D Logo
**What it does:** A Three.js animated 3D version of the OREON wordmark. Used decoratively on the landing page architecture section.  
**Why it exists:** Visual interest on the landing page — reinforces the "industrial precision" brand.

---

### `landing/PlantNetwork3D.tsx` — 3D Plant Network Graph
**What it does:** Three.js node-link graph visualising the plant's asset dependency network. Nodes are spheres, edges are lines connecting dependent assets. The graph animates slowly and is used as a background/hero element on the landing page.  
**Why it exists:** Shows the plant dependency graph concept visually — "if Motor_M12 fails, these 4 downstream assets are affected" — without needing the user to read a description.

---

### `landing/PlantSchematic.tsx` — 2D Plant Schematic
**What it does:** SVG-based 2D schematic diagram of the plant layout. Shows equipment symbols (motor, pump, furnace, conveyor) connected by flow lines. Used on the landing page capabilities section.  
**Why it exists:** More instantly recognisable to engineers than a 3D scene. Looks like the P&ID drawings they already use.

---

### `landing/ArchDiagrams.tsx` — Architecture Diagrams
**What it does:** Renders Mermaid.js flowchart diagrams showing the OREON system architecture: sensor pipeline, investigation workflow, multi-agent coordination, RAG pipeline.  
**Why it exists:** Used on the `/architecture` page to explain system design to technical evaluators.

---

### `landing/ModuleDiagram.tsx` — Module Block Diagram
**What it does:** Static SVG/JSX block diagram showing the relationships between OREON's core modules (Investigation Engine → Decision Service → Sentinel Agent → Voice Agent).  
**Why it exists:** High-level system map for the platform overview page.

---

### `landing/motion-primitives.tsx` — Animation Helpers
**What it does:** Reusable Framer Motion wrappers: `Reveal` (fade-in on scroll), `Stagger` (stagger-delayed children), `StaggerItem`, `Section` (padded section wrapper with consistent scroll reveal).  
**Why it exists:** DRY pattern — every landing page section uses the same scroll animation. Centralising in one file means all scroll reveals can be tuned in one place.

---

## 4. Frontend Libraries & Hooks

### `lib/api/client.ts` — HTTP Client
**What it does:** A typed fetch wrapper exporting an `http` object with `.get<T>()`, `.post<T>()`, `.patch<T>()`, `.put<T>()`, `.delete<T>()` methods. Automatically attaches `Content-Type: application/json`, reads `API_BASE` from env, and throws typed errors on non-2xx responses.  
**Why it exists:** Single place to configure auth headers, base URL, and error handling. All API calls go through here — changing the base URL for production only touches this file.

---

### `lib/api/endpoints.ts` — API Endpoint Functions
**What it does:** Exports typed wrapper functions for every backend REST endpoint. Organized into namespaces:

| Namespace | Key Functions | Calls |
|---|---|---|
| `assetsApi` | `list()`, `get(id)`, `update(id, payload)`, `impact(id)`, `plantGraph()`, `investigate(id, payload)` | `GET/PATCH /assets` |
| `dashboardApi` | `get()` | `GET /dashboard` |
| `incidentsApi` | `list()`, `getByAsset(assetId)` | `GET /incidents` |
| `sparesApi` | `list()`, `get(id)` | `GET /spares` |
| `investigationApi` | `run(payload)`, `stream(payload)` | `POST /investigate` |
| `decisionApi` | `analyze(payload)`, `scenario(payload)`, `priorityAssets()`, `procurementRisks()`, `businessRisks()`, `maintenanceActions()` | `POST /decision/*`, `GET /priority-assets` |
| `askApi` | `converse(payload)`, `stream(payload)`, `history()`, `messages(conversationId)`, `deleteConversation(id)` | `POST /ask`, `GET /ask/history` |
| `alertsApi` | `list(role)`, `markRead(id)` | `GET /alerts`, `POST /alerts/{id}/read` |
| `escalationsApi` | `list()`, `resolve(id)`, `create(payload)` | `GET/POST /escalations` |
| `sentinelApi` | `status()`, `activities(page)`, `stats()`, `timeline()`, `trigger()` | `GET/POST /sentinel/*` |
| `voiceApi` | `converse(payload)`, `tts(text)`, `stt(audio)` | `POST /voice/*` |
| `reportApi` | `exportPdf(assetId)`, `exportJson(assetId)` | `GET /report/{id}/export` |

**Why it exists:** Prevents string typos in URLs, provides TypeScript auto-complete for request/response shapes, and makes each endpoint change a single-file update.

---

### `lib/api/types.ts` — TypeScript Interfaces
**What it does:** All TypeScript types matching backend Pydantic schemas. Key types:
- `AssetResponse`, `AssetSummary`, `AssetUpdate`
- `InvestigationReport`, `InvestigationRequest`, `SensorSnapshot`
- `DecisionReport`, `DecisionAnalyzeRequest`, `ScenarioAnalysisData`, `PriorityAssetSummary`
- `AskRequest`, `AskResponse`, `ConversationSummary`, `MessageSummary`
- `AlertsListResponse`, `EscalationsListResponse`, `DashboardResponse`
- `SentinelStatus`, `SentinelActivity`, `SentinelStats`
- `VoiceConverseRequest`, `VoiceConverseResponse`

**Why it exists:** TypeScript can't infer backend response shapes — these types bring compile-time safety to API calls and prevent mismatches between frontend and backend.

---

### `lib/api/hooks.ts` — React Query Hooks
**What it does:** Custom React Query hooks that encapsulate cache keys, fetch functions, and refetch intervals. Key hooks:

| Hook | Cache Key | What It Fetches | Notes |
|---|---|---|---|
| `useAssets()` | `["assets"]` | All assets | 30s stale time |
| `useAsset(id)` | `["asset", id]` | Single asset | |
| `useIncidents()` | `["incidents"]` | All incidents | |
| `useAssetIncidents(assetId)` | `["incidents", assetId]` | Per-asset incidents | |
| `useDashboard()` | `["dashboard"]` | Plant-wide summary | Refetch every 30s |
| `useAskHistory()` | `["ask-history"]` | Conversation list | |
| `useAskMessages(conversationId)` | `["ask-messages", conversationId]` | Messages in thread | `staleTime: 0` — always fresh |
| `useDeleteConversation()` | — | Mutation | Invalidates `ask-history` |
| `useActiveRole()` | — | Zustand state | |

**Why it exists:** Centralises cache key naming and refetch logic. Without this layer, every component would define its own cache keys, causing cache fragmentation and stale data bugs.

---

### `lib/api/use-sensor-stream.ts` — SSE Sensor Stream Hook
**What it does:** Opens a persistent `EventSource` connection to `GET /api/v1/stream/sensors`. Parses incoming JSON packets (sensor readings for all assets), updates a local state map, and invalidates the `["assets"]` and `["dashboard"]` React Query keys so UI components re-render with live data. Reconnects automatically on disconnection.  
**Why it exists:** The 3D plant twin and dashboard need sensor data every 3 seconds. Polling would create 20 requests/second; SSE gives one persistent connection for all assets.

---

### `lib/api/voice.ts` — Voice API Utilities
**What it does:** Helper functions for voice agent API interaction: `converseStream()` (opens streaming fetch to `/voice/converse`), `textToSpeech()`, `speechToText()`. Handles the `MediaRecorder` audio capture flow for the Deepgram fallback path.  
**Why it exists:** Voice API has unique requirements (audio blobs, streaming responses, MediaRecorder) that don't fit the standard `http` client pattern.

---

### `lib/context-store.ts` — Zustand Global Store
**What it does:** Global client state store. Holds:
- `activeRole` — current user role (Operator / Engineer / Supervisor / etc.)
- `user` — display name and role label
- `contextAssetId` — asset currently pinned in the voice/ask context
- `theme` — light/dark preference
- Actions: `setRole()`, `setContextAsset()`, `setTheme()`

**Why it exists:** Role and context asset need to be accessible everywhere (sidebar, ask page, voice agent, alert feed) without prop drilling.

---

### `lib/role-config.ts` — Role Personalisation Config
**What it does:** Maps each role to: KPI display order, alert severity emphasis, investigation explanation verbosity, and recommended first-action prompts. Example: operators see temperature/vibration first; plant managers see financial impact first.  
**Why it exists:** OREON is multi-role. The same data presented differently depending on who's viewing it makes the platform genuinely useful to each stakeholder rather than just the engineer who built it.

---

### `lib/oreon-data.ts` — Static Reference Data
**What it does:** Static lookup tables: equipment type labels, asset ID → human-readable name map, role display names, SOP document titles. Used for display labels throughout the UI.  
**Why it exists:** Avoids hard-coding display strings in component files. Changing an equipment type label is a single-file update.

---

### `lib/utils.ts` — General Utilities
**What it does:** `cn()` (Tailwind class merger using `clsx` + `tailwind-merge`), date formatting helpers (`formatDate`, `formatRelativeTime`), number formatters (INR currency, percentage), and misc. string utilities.  
**Why it exists:** Prevents duplicate utility logic across 50+ component files.

---

### `lib/config.server.ts` — Server Config
**What it does:** Server-side (TanStack Start server function context) environment variable reading. Exports `API_BASE` for server-rendered data fetching.  
**Why it exists:** Environment variables in TanStack Start must be explicitly read on the server vs. client — this separates that concern.

---

### `lib/error-capture.ts` and `lib/lovable-error-reporting.ts` — Error Reporting
**What it does:** Wraps Lovable IDE's error reporting SDK. Catches unhandled promise rejections and JS errors during development and sends them to the Lovable dashboard.  
**Why it exists:** Development tooling — not used in production. Helps diagnose issues when building in the Lovable IDE environment.

---

## 5. Frontend UI Component Library

Located in `frontend/src/components/ui/`. 45 files. All built on Radix UI primitives with shadcn styling conventions and Tailwind CSS. These are the atomic building blocks used throughout the app.

| Component | What It Does | Used For |
|---|---|---|
| `accordion.tsx` | Collapsible content sections | Evidence cards in investigation results |
| `alert.tsx` | Inline alert banner (info/warning/error) | Form errors, status messages |
| `alert-dialog.tsx` | Modal confirm dialog | "Are you sure?" destructive actions |
| `aspect-ratio.tsx` | Fixed aspect ratio container | Chart/image wrappers |
| `avatar.tsx` | User avatar with fallback initials | Role indicator in sidebar |
| `badge.tsx` | Small coloured label chip | Status badges (Critical, Degraded), priority bands |
| `breadcrumb.tsx` | Page path navigation | Sub-page navigation |
| `button.tsx` | Clickable button (variant: default/outline/ghost/destructive) | All CTAs |
| `calendar.tsx` | Date picker calendar | Maintenance scheduling |
| `card.tsx` | Padded container with header/content/footer | Asset cards, KPI tiles, report sections |
| `carousel.tsx` | Horizontal scroll with prev/next | Feature carousel on landing page |
| `checkbox.tsx` | Accessible checkbox | Filter controls |
| `collapsible.tsx` | Toggle show/hide content | Expandable table rows |
| `command.tsx` | Command palette (cmdk wrapper) | Ask palette (Ctrl-K) |
| `context-menu.tsx` | Right-click context menu | Asset grid right-click actions |
| `dialog.tsx` | Modal overlay with focus trap | Escalation form, confirmation dialogs |
| `drawer.tsx` | Bottom/side slide-in panel | Mobile sidebar, filter panels |
| `dropdown-menu.tsx` | Trigger + floating menu | Role switcher, actions menu |
| `form.tsx` | React Hook Form + Zod integration helpers | All controlled forms |
| `hover-card.tsx` | Floating content on hover | Asset quick-preview on hover |
| `input.tsx` | Text input field | Search, form fields |
| `input-otp.tsx` | OTP-style segmented input | (Available, not actively used) |
| `label.tsx` | Form field label | All form labels |
| `menubar.tsx` | Horizontal menu bar | (Available for future use) |
| `navigation-menu.tsx` | Radix navigation menu | Landing page header nav |
| `pagination.tsx` | Page controls (prev/next/numbers) | Incidents list, sentinel activities |
| `popover.tsx` | Floating content anchored to trigger | Tooltip-like rich content |
| `progress.tsx` | Horizontal progress bar | Health score bar, RUL indicator |
| `radio-group.tsx` | Exclusive option selection | Role selection in login |
| `resizable.tsx` | Draggable split panels | (Available for investigation detail layout) |
| `scroll-area.tsx` | Custom scrollbar overlay | Chat message list, sidebar |
| `select.tsx` | Dropdown select (Radix) | Filter dropdowns, role picker |
| `separator.tsx` | Horizontal/vertical divider line | Section dividers |
| `sheet.tsx` | Full-height side panel (slide-in) | Mobile nav drawer |
| `sidebar.tsx` | shadcn sidebar primitive | Base for `oreon/shell.tsx` sidebar |
| `skeleton.tsx` | Grey placeholder while loading | Asset cards loading state |
| `slider.tsx` | Range/value slider | (Available for threshold tuning) |
| `sonner.tsx` | Toast notification system (Sonner) | Success/error toasts after API calls |
| `switch.tsx` | Toggle switch | Feature flags, filter toggles |
| `table.tsx` | Accessible data table with header/body/row/cell | Incidents, procurement, logbook |
| `tabs.tsx` | Tabbed content (Radix) | Decisions page (Maintenance/Business/Procurement tabs) |
| `textarea.tsx` | Multi-line text input | Manual escalation description |
| `toggle.tsx` | Press-to-toggle button | View mode switches |
| `toggle-group.tsx` | Exclusive toggle group | Grid vs. list view switch |
| `tooltip.tsx` | Floating hint on hover | Icon button labels |

**Why this library exists:** Using pre-built accessible components eliminates hundreds of hours of implementing keyboard navigation, ARIA attributes, focus management, and animation from scratch. The shadcn pattern (copy-pasted, not npm-imported) means components can be modified freely without fighting a third-party API.

---

## 6. Backend API Endpoints

All routers are mounted under `/api/v1` in `main.py`. Each router file is a thin handler — it validates input via Pydantic schemas, calls one service method, and returns the result. No business logic lives in router files.

---

### `api/v1/assets.py` — Asset Endpoints
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| GET | `/assets` | Query params (status, criticality, limit) | `list[AssetSummary]` | List all assets with optional filters |
| GET | `/assets/{asset_id}` | — | `AssetResponse` | Get single asset with full detail |
| PATCH | `/assets/{asset_id}` | `AssetUpdate` | `AssetResponse` | Update asset fields (health score, status, etc.) |
| GET | `/assets/{asset_id}/impact` | — | `ImpactChainResponse` | NetworkX blast-radius: which assets downstream are affected |
| GET | `/assets/plant-graph` | — | Graph nodes + edges | Full plant dependency topology for 3D twin |

**Why it exists:** Assets are the core entity. Every other feature (investigation, decision, alert) is anchored to an asset ID.

---

### `api/v1/ask.py` — Conversational RAG
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/ask` | `AskRequest` | NDJSON stream | Streaming conversational RAG — retrieves context, calls LLM, streams back chunks |
| GET | `/ask/history` | — | `list[ConversationSummary]` | List all conversations for the user |
| GET | `/ask/{conversation_id}/messages` | — | `list[MessageSummary]` | Messages in a conversation |
| DELETE | `/ask/{conversation_id}` | — | `{"deleted": true}` | Delete a conversation and its messages |

The streaming endpoint (`POST /ask`) emits NDJSON lines: progress events (`{"progress": "Searching..."}`) then a final `{"result": {...}}` chunk.  
**Why it exists:** Conversational interface to the knowledge base — engineers ask questions in plain English, OREON retrieves relevant manuals, SOPs, incidents, and asset state, then narrates an answer.

---

### `api/v1/dashboard.py` — Plant Overview
| Method | Path | Schema Out | What It Does |
|---|---|---|---|
| GET | `/dashboard` | `DashboardResponse` | Aggregate snapshot: total assets, active alerts by severity, critical assets list, overall health score, procurement risk summary |

**Why it exists:** The command center page needs one endpoint that gives a complete picture in one request instead of making 8 separate calls.

---

### `api/v1/decision.py` — Decision Intelligence
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/decision/analyze` | `DecisionAnalyzeRequest` | `DecisionReport` | Full decision pipeline: investigation → priority → plant impact → procurement → scenario → recommendations |
| POST | `/decision/scenario` | `ScenarioRequest` | `ScenarioAnalysisData` | Simulate risk at a specific delay (days) |
| GET | `/priority-assets` | Query: limit | `list[PriorityAssetSummary]` | All assets ranked by 9-factor priority score |
| GET | `/procurement-risks` | — | `list[ProcurementRiskSummary]` | Parts with stock shortages or high lead times |
| GET | `/maintenance-actions` | Query: limit | `list[MaintenanceActionSummary]` | Recommended maintenance actions in priority order |
| GET | `/business-risks` | Query: limit | `list[BusinessRiskSummary]` | Financial risk per asset: downtime cost, revenue exposure |

**Why it exists:** The core value layer — takes raw sensor + asset data and outputs prioritised, actionable maintenance recommendations with financial context.

---

### `api/v1/escalations.py` — Escalation Management
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| GET | `/escalations` | Query: status, role | `EscalationsResponse` | List active/resolved escalations, filtered by role |
| POST | `/escalations/{id}/resolve` | — | `{"resolved": true}` | Mark escalation as resolved |
| POST | `/escalations` | `ManualEscalationRequest` | `EscalationResponse` | Create a manual escalation for an asset |

**Why it exists:** Bridges the gap between automated detection and human response. When Sentinel or the critical event detector flags something, it creates an escalation. Humans use this endpoint to acknowledge and close it.

---

### `api/v1/feedback.py` — Feedback Learning
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/feedback` | `FeedbackCreate` | `FeedbackSummary` | Record operator feedback on a root cause diagnosis (correct / incorrect + actual cause) |
| GET | `/feedback` | Query: asset_id, limit | `list[FeedbackSummary]` | List feedback history |
| GET | `/feedback/stats` | Query: equipment_type | `FeedbackStats` | Confidence calibration summary — how much feedback has shifted RCA confidence |

**Why it exists:** The closed-loop feedback system. When an operator says "OREON said bearing wear but it was actually lubrication failure," this endpoint records that correction. The `FeedbackLearningService` then adjusts future confidence scores for that equipment type + root cause pair.

---

### `api/v1/incidents.py` — Incident History
| Method | Path | Schema Out | What It Does |
|---|---|---|---|
| GET | `/incidents` | `list[IncidentSummary]` | All historical incidents (searchable, filterable) |
| GET | `/incidents/{incident_id}` | `IncidentResponse` | Full incident detail |

**Why it exists:** The historical incident database is the training data for similarity search in the RAG pipeline and for the RUL model.

---

### `api/v1/investigation.py` — Root Cause Investigation
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/investigate` | `InvestigationRequest` | NDJSON stream | Full multi-agent investigation with streaming progress (8 timeline steps) |
| GET | `/investigate/timeline` | — | `InvestigationTimelineResponse` | The 8-step investigation timeline labels (used by the UI progress tracker) |

The streaming endpoint emits JSON lines for each step (`{"progress": "Analyzing Sensors"}`), then a final `{"progress": "COMPLETE", "report": {...}}`.  
**Why it exists:** Investigation is compute-heavy (sensor analysis, RAG retrieval, RCA rules, LLM narration). Streaming lets the frontend show progress instead of a blank spinner for 5–10 seconds.

---

### `api/v1/alerts.py` — Alert Feed
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| GET | `/alerts` | Query: role, unread_only | `AlertsListResponse` | Role-filtered alert list with unread count |
| POST | `/alerts/{alert_id}/read` | — | `{"read": true}` | Mark alert as read for the current role |

**Why it exists:** Alerts are generated by Sentinel and the critical event detector. This endpoint serves them to the UI and tracks read state so the unread count badge in the sidebar stays accurate.

---

### `api/v1/logbook.py` — Maintenance Logbook
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/logbook` | `MaintenanceLogCreate` | `MaintenanceLogSummary` | Create a manual logbook entry |
| GET | `/logbook` | Query: asset_id, limit | `list[MaintenanceLogSummary]` | List logbook entries (auto + manual) |
| GET | `/logbook/{id}` | — | `MaintenanceLogSummary` | Single logbook entry |

**Why it exists:** Auto-entries are created by `InvestigationService` at the end of every investigation. Manual entries are created by technicians after completing work. Together they form a complete audit trail.

---

### `api/v1/report.py` — Report Export
| Method | Path | Schema Out | What It Does |
|---|---|---|---|
| GET | `/report/{asset_id}/export?format=pdf` | PDF binary | Run full decision analysis on an asset and export as PDF. Calls `decision_svc.analyze(payload, with_explanation=False)` — skips LLM narration to keep export fast (seconds, not minutes) |
| GET | `/report/{asset_id}/export?format=json` | `DecisionReport` JSON | Same analysis, raw JSON |
| GET | `/report/plant/{kind}/export` | PDF or JSON | Whole-plant report: `maintenance` (priority assets + actions) or `business` (financial risks) |

**Why `with_explanation=False`:** The PDF renders only deterministic fields (diagnosis, root cause, evidence, priority, scenarios, procurement). The two LLM narration calls (`investigation_reasoning_service.explain()` and `decision_reasoning_service.explain()`) add 2–3 minutes and produce text the PDF never shows. Skipping them makes the export near-instant.

---

### `api/v1/sentinel.py` — Autonomous Agent Control
| Method | Path | Schema Out | What It Does |
|---|---|---|---|
| GET | `/sentinel/status` | `SentinelStatus` | Current agent state: running/idle, last scan time, next scan time |
| GET | `/sentinel/activities` | Paginated `list[SentinelActivity]` | Full activity log: anomalies detected, alerts raised, investigations triggered |
| GET | `/sentinel/stats` | `SentinelStats` | Aggregate counts: total scans, anomalies, alerts, escalations |
| GET | `/sentinel/timeline` | `list[SentinelActivity]` | Last N activities for the timeline widget |
| POST | `/sentinel/trigger` | — | `{"triggered": true}` | Force an immediate monitoring scan outside the 60-second schedule |

**Why it exists:** Transparency into the autonomous agent. Users need to know if Sentinel is running, what it found, and have a way to force an immediate scan when they suspect a problem.

---

### `api/v1/simulation.py` — Demo Simulation
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| GET | `/simulation/{asset_id}` | — | Current simulation state | Current simulated sensor state for an asset |
| POST | `/simulation/{asset_id}/run` | `ScenarioRequest` | Simulation result | Run a degradation scenario (e.g. "bearing wear progression over 7 days") |

**Why it exists:** Demo scripted stories. Instead of waiting for real degradation to happen, the simulation director advances a pre-defined fault scenario for the demo presentation. Judges can watch OREON detect and respond to a staged failure in real time.

---

### `api/v1/spares.py` — Spare Parts
| Method | Path | Schema Out | What It Does |
|---|---|---|---|
| GET | `/spares` | `list[SparePartSummary]` | All spare parts with stock levels and reorder status |
| GET | `/spares/{part_id}` | `SparePartResponse` | Single spare part detail |

**Why it exists:** Spare part availability is factored into the priority score. Low stock + long lead time = higher urgency. The procurement page uses these endpoints.

---

### `api/v1/stream.py` — SSE Telemetry Stream
| Method | Path | What It Does |
|---|---|---|
| GET | `/stream/sensors` | Server-Sent Events — emits a JSON packet every 3 seconds with latest sensor readings for all assets |

The endpoint uses `SensorStreamService` to generate new simulated readings, writes them to the database, then yields the SSE event. The frontend `use-sensor-stream.ts` hook consumes this.  
**Why it exists:** Real SCADA systems push data continuously. SSE is the right transport for push-based, server-initiated updates — more efficient than polling and simpler than WebSocket for one-way data.

---

### `api/v1/voice.py` — Voice Agent
| Method | Path | Schema In | Schema Out | What It Does |
|---|---|---|---|---|
| POST | `/voice/converse` | `VoiceConverseRequest` | NDJSON stream | Autonomous voice agent: grounds in live asset data, calls decision service, streams natural language response |
| GET | `/voice/tts` | Query: text | Audio stream | Text-to-speech via Deepgram |
| POST | `/voice/stt` | Audio blob | `{"transcript": "..."}` | Speech-to-text via Deepgram (fallback when native SpeechRecognition unavailable) |

**Why it exists:** Hands-free operation. Plant floor operators often can't use a keyboard. "OREON, what's the status of Motor M12?" gives an instant spoken answer.

---

## 7. Backend Services

42 service files in `backend/app/services/`. All business logic lives here — route handlers only validate input and call one service method.

---

### Core Orchestrators

#### `decision_service.py` — `DecisionService`
The top-level orchestrator for maintenance intelligence. `analyze(request, *, with_explanation=True)` runs the complete pipeline:
1. Load asset
2. `InvestigationService.investigate()` → diagnosis, root cause, evidence
3. `PlantImpactEngine.analyze_impact()` → blast radius, impact score
4. `ProcurementEngine.analyze()` → parts availability, lead times
5. `PriorityEngine.calculate_priority()` → 0–100 priority score
6. `ScenarioSimulator.simulate()` → risk at 3/7/14/30 day delays
7. `MaintenancePlanner.build_plan()` → step-by-step maintenance sequence
8. `BusinessImpactEngine.analyze()` → financial impact (INR)
9. `CriticalEventDetector.scan_asset()` → auto-escalation if critical
10. If `with_explanation=True`: `DecisionReasoningService.explain()` → LLM narrative

Also exposes: `priority_assets()`, `maintenance_actions()`, `business_risks()`, `procurement_risks()` for the decisions page list views.

**Why it exists:** Central coordinator. No single component knows the full picture — this service assembles all the pieces into a coherent `DecisionReport`.

---

#### `investigation_service.py` — `InvestigationService`
Runs the root cause investigation pipeline. `investigate_stream(request, *, with_explanation=True, pace=True)` is a generator that yields NDJSON progress events:

1. Load asset (yield "Loading Asset")
2. Sensor analysis (yield "Analyzing Sensors")
3. Dual RAG retrieval — manuals + SOPs (yield "Searching Manuals", "Searching SOPs")
4. Incident similarity search (yield "Searching Historical Incidents")
5. Feedback-driven confidence adjustment
6. Root cause rule engine (yield "Running Root Cause Analysis")
7. Evidence assembly (yield "Generating Evidence")
8. RUL prediction (RandomForest)
9. If `with_explanation=True`: LLM narration call
10. Auto-log to maintenance logbook
11. Yield `{"progress": "COMPLETE", "report": {...}}`

`investigate()` wraps `investigate_stream()` for non-streaming callers, consuming the generator until COMPLETE.

**The `pace` flag:** When `pace=True` (live streaming), `_pause()` calls insert cosmetic delays (0.4–0.6s per step) so the progress bar animates visibly. When `pace=False` (PDF export, batch), the delays are skipped entirely.

**Why it exists:** The investigation is the core AI product — it takes a fault description and sensor snapshot and produces a grounded, evidence-backed root cause diagnosis. Everything else depends on what this service produces.

---

#### `agent_workflow.py` — `AgentWorkflow`
LangGraph-based multi-agent orchestration for complex queries. Coordinates 6 specialised agents:
1. **Asset Specialist** — asset health, history, maintenance records
2. **RUL Analyst** — remaining useful life prediction and trend interpretation
3. **Root Cause Expert** — FMEA-based failure mode analysis
4. **Spare Parts Agent** — procurement availability and lead time checking
5. **Priority Planner** — urgency scoring and scheduling recommendation
6. **Safety Advisor** — HSE risk assessment and lockout/tagout guidance

Used by the Ask OREON endpoint for complex multi-faceted queries that need answers from multiple domains simultaneously.  
**Why it exists:** Single-agent LLM struggles with "diagnose the fault AND check spare parts AND assess safety risk AND recommend timing" — the multi-agent approach parallelises these and produces more accurate, comprehensive answers.

---

### Deterministic Engine Suite

#### `sensor_analysis_engine.py` — `SensorAnalysisEngine`
Analyses sensor snapshots against thresholds and historical baselines.
- `analyze_sensor_snapshot(snapshot)` — checks temperature, vibration, pressure, current, RPM against equipment-type-specific critical and warning thresholds. Returns `SensorAnalysis` with `threshold_violations`, `anomalies`, and `risk_indicators`.
- `analyze_sensor_trends(history)` — computes rolling mean and stddev for each sensor channel. Returns trend direction (stable / degrading / recovering) and rate of change.

**Why it exists:** Deterministic anomaly detection runs before any LLM call. If a motor's vibration is 3x above the critical threshold, that fact is established by math, not by asking a language model.

---

#### `root_cause_engine.py` — `RootCauseEngine`
Rule-based FMEA engine. `analyze(asset_type, fault_description, sensor_analysis, confidence_adjuster)` applies 8 ordered conditions:
1. Bearing wear (vibration > critical threshold)
2. Lubrication failure (high temp + vibration)
3. Shaft misalignment (vibration + noise)
4. Motor overload (high current + high temp)
5. Cooling system failure (high temp, low pressure)
6. Gearbox degradation (vibration + noise pattern)
7. Pump cavitation (pressure drop + vibration)
8. Fan imbalance (vibration + noise, fan type)

Each match returns a `RootCauseResult` with `root_cause`, `diagnosis`, `confidence`, and `recommended_actions`. The `confidence_adjuster` (from `FeedbackLearningService`) modifies confidence based on historical operator corrections.

**Why it exists:** Rules run in microseconds, are fully explainable, and don't hallucinate. The LLM narrates the output — it doesn't determine it.

---

#### `priority_engine.py` — `PriorityEngine`
Calculates a 0–100 priority score using a weighted linear formula:

| Factor | Weight | Source |
|---|---|---|
| Failure probability | 22% | ML model / asset field |
| Health deficit (100 - health_score) | 16% | Asset field |
| RUL urgency (nonlinear decay at <30d) | 14% | RUL model |
| Asset criticality | 14% | Asset field (low/med/high/critical) |
| Historical failure frequency | 10% | Incident count |
| Safety risk | 12% | Criticality × impact score |
| Spare availability | 6% | Procurement analysis |
| Procurement lead time | 3% | Spare parts data |
| Plant dependency impact | 3% | NetworkX blast radius |

Returns `PriorityResult` with `priority_score`, `priority_band` (LOW/MEDIUM/HIGH/CRITICAL), and a factor breakdown for UI display.

**Why it exists:** Maintenance teams can only work on one thing at a time. A single number that encodes all relevant risk factors makes the "what to fix first" decision objective and auditable.

---

#### `plant_impact_engine.py` — `PlantImpactEngine`
Uses NetworkX to perform topological impact analysis.
- `analyze_impact(asset_id)` — traces all downstream dependencies in the plant graph. Counts: directly blocked assets, total blocked assets, production lines affected. Returns an `impact_score` (0–100) and `PlantImpactReport`.
- Uses `PlantGraphService` for the underlying graph queries.

**Why it exists:** A motor failure isn't just a motor problem — if it drives the conveyor that feeds the blast furnace, the entire production line stops. This engine quantifies that cascading risk.

---

#### `business_impact_engine.py` — `BusinessImpactEngine`
Translates engineering impact into financial impact.
- `analyze(plant_impact)` — uses production tonnage rates (₹ per hour per line) and downtime hours to compute: `downtime_hours`, `cost_of_inaction_inr`, `cost_of_action_inr`, `revenue_exposure_inr`, `cost_avoided_inr`, `business_risk` (LOW/MEDIUM/HIGH/CRITICAL).

**Why it exists:** Plant managers and board members think in INR, not vibration mm/s. This engine makes the financial case for maintenance spending.

---

#### `procurement_engine.py` — `ProcurementEngine`
Checks spare part availability for required components.
- `analyze(required_parts, equipment_type, asset_id)` — looks up each part in `SparePart` inventory. Returns: stock status, lead times, supplier info, `procurement_risk` (LOW/MEDIUM/HIGH/CRITICAL).
- Risk escalates when `current_stock < min_stock` or `lead_time_days > rul_days`.

**Why it exists:** A critical asset with a 30-day part lead time needs a purchase order *today* if its RUL is 25 days. This engine catches that conflict before it becomes an emergency.

---

#### `evidence_engine.py` — `EvidenceEngine`
Assembles evidence cards for the investigation report.
- `build_evidence(sensor_analysis, manual_chunks, sop_chunks, incidents)` — creates a list of `EvidenceCard` objects, each with: source type (sensor / manual / SOP / incident), title, summary text, confidence weight, and a citation.

**Why it exists:** Transparency. Engineers don't trust a black box — they need to see *why* OREON diagnosed a specific root cause. Evidence cards show exactly which sensor reading, manual paragraph, or historical incident supports each conclusion.

---

#### `escalation_engine.py` — `EscalationEngine`
Auto-routes escalations to appropriate roles.
- `auto_escalate(asset, priority)` — creates an `Escalation` record in the database and a `Notification` for each target role.
- P1 (CRITICAL): Plant Manager + Supervisor + Maintenance Engineer
- P2 (HIGH): Supervisor + Maintenance Engineer  
- P3 (MEDIUM): Maintenance Engineer

**Why it exists:** When Sentinel detects a critical event, the right people need to be notified immediately — and the responsibility chain needs to be documented.

---

#### `notification_engine.py` — `NotificationEngine`
Creates and manages notifications.
- `create_notification(severity, title, message, asset_id, target_roles)` — writes to `Notification` table.
- `get_notifications(role, unread_only)` — role-filtered notification list.
- `mark_as_read(notification_id, role)` — writes to `NotificationRead` table.

**Why it exists:** Alerts need per-role read state — marking as read for Supervisor shouldn't mark it read for Operator. The `NotificationRead` join table handles this.

---

#### `critical_event_detector.py` — `CriticalEventDetector`
Auto-scans a single asset after every decision analysis.
- `scan_asset(asset_id)` — if `failure_probability > 0.70` or blast radius is large, calls `EscalationEngine.auto_escalate()`.

**Why it exists:** Passive safety net. Every time the decision service runs, this check fires automatically. High-risk situations are escalated without anyone having to remember to check.

---

#### `scenario_simulator.py` — `ScenarioSimulator`
Projects asset failure risk forward in time.
- `simulate(asset_id, delay_days)` — uses the asset's current degradation rate, health score, and RUL to project failure probability, estimated downtime, and cost of waiting `delay_days` before maintenance.

**Why it exists:** "If we wait 7 days" is a question maintenance planners ask constantly. This engine answers it quantitatively.

---

#### `maintenance_planner.py` — `MaintenancePlanner`
Builds a structured maintenance action sequence.
- `build_plan(investigation, priority, plant_impact, procurement)` — synthesises all inputs into a `MaintenancePlan` with phases: Immediate Actions, Preparation, Execution, Verification, Monitoring.

**Why it exists:** Translates diagnosis into a to-do list. Maintenance engineers need a step-by-step plan, not a root cause report.

---

### AI / LLM Integration

#### `llm_router.py` — `LLMRouter`
Routes LLM calls to Groq or OpenRouter based on `LLM_PROVIDER` setting.
- `complete_json(prompt, schema, model)` — sends the prompt, expects valid JSON back matching `schema`, retries on parse failure.
- Groq path: `llama-3.3-70b-versatile` (~2s latency on the real OREON prompt)
- OpenRouter path: `gpt-4o-mini` for reasoning, `llama-3.3-70b-instruct` for voice (~2.2s)

**Why it exists:** Provider abstraction. Switching from Groq to OpenRouter (or back) is a single env var change. The retry logic handles JSON parse failures common with large language models.

---

#### `investigation_reasoning_service.py` — `InvestigationReasoningService`
Calls the LLM to narrate the investigation report.
- `explain(report, asset_context, plant_context)` — constructs a grounded prompt containing the deterministic report fields, then asks the LLM to produce a plain-English explanation in the voice of a senior maintenance engineer.

**Why it exists:** Engineers want a readable narrative, not a JSON object. The LLM's only job here is to *explain* what the deterministic engines already decided — not to make new decisions.

---

#### `decision_reasoning_service.py` — `DecisionReasoningService`
Calls the LLM to narrate the decision report.
- `explain(decision_report)` — similar to investigation reasoning but covers priority justification, business impact context, and procurement recommendations.

**Why it exists:** Same as above — turns a structured report into a readable executive summary.

---

#### `base_reasoning_service.py` — `BaseReasoningService`
Abstract base class shared by `InvestigationReasoningService` and `DecisionReasoningService`. Provides `_call_llm()` and prompt construction helpers.  
**Why it exists:** DRY — both reasoning services have the same LLM call mechanics.

---

#### `voice_agent_service.py` — `VoiceAgentService`
The autonomous voice agent brain.
- `converse(query, history, role, context_asset_id, current_page)` — grounds the query in live data (fetches asset state if `context_asset_id` is set), calls `DecisionService.analyze()` or `InvestigationService.investigate()` as needed, then calls the LLM with the grounded context to produce a spoken response. Streams back chunks.
- Enforces safe write gates — only certain actions (logbook entry, alert mark-read) can be triggered by voice.
- Uses `OPENROUTER_VOICE_MODEL` (llama-3.3-70b-instruct) at `max_tokens=280` for fast spoken-length responses.

**Why it exists:** The voice agent must be *grounded* — it cannot hallucinate asset IDs or sensor values. This service ensures the LLM only has access to real-time facts from the database.

---

### RAG Pipeline

#### `dual_retrieval_service.py` — `DualRetrievalService`
Hybrid retrieval combining three methods:
1. **Dense**: ChromaDB vector similarity on manuals + SOPs
2. **Sparse**: BM25 keyword matching
3. **Incident similarity**: Jaccard token overlap on historical incidents

Results are merged via Reciprocal Rank Fusion (RRF) and reranked using a cross-encoder model. Returns `{"procedural_knowledge": [...], "historical_knowledge": [...]}`.

**Why it exists:** Dense-only retrieval misses keyword-specific technical terms. BM25-only misses semantic similarity. The hybrid approach gets the best of both worlds for industrial maintenance queries.

---

#### `manual_knowledge_service.py` — `ManualKnowledgeService`
ChromaDB-backed search over equipment manuals.
- `index_manuals()` — chunks PDF manuals, computes hash embeddings (or bge-m3 if `USE_BGE_EMBEDDINGS=True`), upserts to ChromaDB.
- `search_manuals(query, top_k)` — retrieves top-k relevant manual chunks.

**Why it exists:** Manuals contain the authoritative specification for what "normal" looks like and what to do when it isn't. The RAG layer makes that knowledge searchable.

---

#### `sop_knowledge_service.py` — `SOPKnowledgeService`
Same as `ManualKnowledgeService` but for Standard Operating Procedures. Includes cross-encoder reranking after initial retrieval.  
**Why it exists:** SOPs tell technicians the exact procedure to follow (permit-to-work, lockout/tagout, torque specs). This is safety-critical information that needs to be retrieved accurately.

---

#### `incident_retrieval_service.py` — `IncidentRetrievalService`
Tokenized Jaccard similarity search over the incidents table.
- `search_similar(query, top_k)` — tokenises the query, computes Jaccard overlap with each incident's `symptoms` + `root_cause` text, returns the top-k most similar.

**Why it exists:** Historical incidents are the most relevant context for "have we seen this before?". Jaccard works better than dense embeddings for short, technical symptom descriptions.

---

#### `knowledge_base.py` — `KnowledgeBase`
Preloads all RAG models on startup.
- `preload_rag_models()` — initialises the cross-encoder reranker, embedding models (hash or bge-m3), and triggers `index_manuals()` / `index_sops()` if the ChromaDB index is empty.

**Why it exists:** Model loading takes 10–30 seconds. Doing it at startup (not at first request) ensures users don't hit a 30-second cold-start delay on the first investigation.

---

#### `document_knowledge_service.py` — `DocumentKnowledgeService`
Abstract base class for `ManualKnowledgeService` and `SOPKnowledgeService`. Defines the `index()` and `search()` interface.  
**Why it exists:** Allows the retrieval pipeline to treat manuals and SOPs uniformly.

---

### ML & Prediction

#### `rul_model_service.py` — `RulModelService`
RandomForestRegressor for Remaining Useful Life prediction.
- `predict_rul(asset_id, temperature_c, vibration_mms, pressure_bar)` — returns `(pred_rul_days, confidence_pct, lower_bound, upper_bound)`. The confidence interval is derived from estimator-variance across the forest's trees.
- Model is trained class-level (`_trained` flag) on the seeded `sensor_history.json` data at first call. Subsequent calls hit the cached model.

**Why it exists:** A deterministic threshold check tells you "this is bad now." The RUL model tells you "this will fail in 12 days." Planning-horizon information is far more valuable for scheduling.

---

#### `sensor_stream_service.py` — `SensorStreamService`
Generates simulated SCADA telemetry.
- `get_next_readings_for_all()` — for each asset, generates temperature, vibration, pressure, current, RPM as random walks around the asset's "normal" range. Critically/degraded assets have readings in warning/critical bands. Writes new `SensorReading` rows to the database.

**Why it exists:** No real SCADA connection exists in the demo environment. This service simulates a live 3-second tick from all 25+ plant assets, making the real-time features (alerts, 3D twin, SSE stream) functional without physical hardware.

---

#### `demo_simulation_service.py` — `DemoSimulationService`
Scripted fault scenario director.
- `run_scenario(asset_id, scenario)` — advances a pre-defined degradation timeline (e.g. "Motor bearing wear progression over 7 steps"). Updates the asset's `health_score`, `failure_probability`, and `rul_days` in the database, and injects anomalous sensor readings.

**Why it exists:** Allows the hackathon demo to show a *real-time failure detection story* in 10 minutes — start with a healthy motor, advance the simulation, watch Sentinel detect the anomaly and escalate.

---

### Autonomous Monitoring

#### `autonomous_agent_service.py` — `AutonomousAgentService` + `SentinelState`
The Sentinel monitoring loop. APScheduler calls `run_cycle()` every 60 seconds.

`run_cycle()` workflow:
1. Load all assets
2. For each asset: call `_monitor_asset(asset)`
3. `_monitor_asset()`:
   a. Get latest sensor reading
   b. `SensorAnalysisEngine.analyze_sensor_snapshot()` — detect anomalies
   c. If anomalies found: `NotificationEngine.create_notification()` → generate alert
   d. If failure_probability > threshold: `CriticalEventDetector.scan_asset()` → escalate
   e. Log to `SentinelActivity`
4. Update `SentinelState` counters

**Why it exists:** Human operators can't watch 25 assets simultaneously. Sentinel is the always-on watcher that never sleeps, never misses a spike, and immediately alerts the right people.

---

#### `feedback_learning_service.py` — `FeedbackLearningService`
Online learning loop from operator corrections.
- `record_feedback(asset_id, decision_id, feedback_type, actual_cause)` — writes to `DecisionFeedback` table.
- `confidence_modifier(equipment_type, root_cause)` — Laplace-smoothed ratio of positive to total feedback for this (type, cause) pair. Returns multiplier applied to `RootCauseEngine` confidence.
- `rerank_incidents(incidents)` — boosts incidents whose root cause has high positive feedback, demotes those with negative feedback.
- `suggested_correction(equipment_type, root_cause)` — if another root cause has been confirmed more often for this equipment type, surface it as a suggested alternative.

**Why it exists:** The root cause rules are static. Operators have local knowledge that the rules don't encode. The feedback loop makes the system *learn* from corrections, improving over time without code changes.

---

#### `trust_score_engine.py` — `TrustScoreEngine`
Calculates per-(equipment_type, root_cause) trust scores from `DecisionFeedback` history.
- `calculate_trust_score(equipment_type, root_cause)` — Laplace-smoothed probability (positive_feedback + 1) / (total_feedback + 2).

**Why it exists:** The feedback learning service needs a stable, bias-adjusted score to avoid overreacting to a single data point. Laplace smoothing handles the cold-start (new root cause with only 1 data point).

---

#### `complexity_classifier.py` — `ComplexityClassifier`
Routes queries to fast or slow LLM based on estimated complexity.
- `classify(query)` — counts tokens, detects multi-entity queries ("Motor AND Pump AND…"), returns `"fast"` or `"reasoning"`.
- Fast queries → Groq llama-3.3-70b (≈2s)
- Reasoning queries → OpenRouter gpt-4o-mini (≈5–15s)

**Why it exists:** Using the reasoning model for every query wastes time and money. Simple factual lookups don't need a slow model. The classifier gets fast answers fast and hard questions handled carefully.

---

### Data Services

#### `asset_service.py` — `AssetService`
CRUD for `Asset` records.
- `get_all(status, criticality, limit)`, `get_by_id(id)`, `update(id, payload)`
- Also computes the `ImpactChainResponse` for the `/assets/{id}/impact` endpoint via `PlantGraphService`.

---

#### `incident_service.py` — `IncidentService`
CRUD for `Incident` records.
- `get_all(limit, asset_id)`, `get_by_id(incident_id)`, `get_by_asset(asset_id)`

---

#### `spare_part_service.py` — `SparePartService`
CRUD for `SparePart` records.
- `get_all()`, `get_by_id(id)`, `get_by_equipment_type(type)`, `check_availability(part_name)`

---

#### `sensor_service.py` — `SensorService`
Reads `SensorReading` records.
- `get_by_asset(asset_id, limit)`, `get_latest(asset_id)`

---

#### `dashboard_service.py` — `DashboardService`
Assembles the dashboard aggregate.
- `get_dashboard()` — combines: total asset count, alert counts by severity, critical asset list, plant health score (weighted average), procurement risk summary.

---

#### `plant_graph_service.py` — `PlantGraphService`
NetworkX graph operations over the plant topology.
- `get_direct_dependencies(asset_id)` — immediate upstream/downstream neighbours.
- `get_impact_chain(asset_id)` — all transitive downstream assets.
- `get_all_nodes()`, `get_all_edges()` — for the 3D twin visualisation.

---

#### `agent_planner.py` — `AgentPlanner`
LLM-powered detailed repair procedure generator.
- `plan_maintenance(asset_id, root_cause)` — produces a detailed step-by-step maintenance procedure using the LLM with asset context and SOP retrieval.

---

#### `evidence_aggregator.py` — `EvidenceAggregator`
Merges evidence from multiple sources (sensor, manual, SOP, incident) and deduplicates overlapping content before building the final evidence list.

---

## 8. Backend Models (Database)

SQLAlchemy 2.0 declarative style with `Mapped`/`mapped_column`. All models inherit from `Base` (via `database/base.py`).

---

### `models/asset.py` — `Asset`
**Table:** `assets`  
**Columns:**

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | e.g. `Motor_M12`, `BlastFurnace_BF2` |
| `name` | String | Human-readable display name |
| `equipment_type` | String | e.g. `Electric Motor`, `Centrifugal Pump` |
| `location` | String | Plant zone (e.g. `Zone A - Rolling Mill`) |
| `criticality` | Enum | `low / medium / high / critical` |
| `production_line` | String | Which line it serves |
| `health_score` | Float | 0–100, higher is healthier |
| `failure_probability` | Float | 0–1 ML prediction |
| `rul_days` | Integer | Days until predicted failure |
| `status` | Enum | `operational / degraded / critical` |
| `last_maintenance_date` | Date | When it was last serviced |
| `description` | String | Free-text asset description |
| `manufacturer` | String | Equipment maker |
| `model_number` | String | Model/part number |
| `installation_year` | Integer | Year installed |

**Relationships:** Has many `SensorReading`, `Incident`, `MaintenanceLog`, `Escalation`, `SentinelActivity`  
**Why it exists:** The central entity of the entire system. Every alert, investigation, decision, and escalation is anchored to an asset ID.

---

### `models/sensor_reading.py` — `SensorReading`
**Table:** `sensor_readings`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK auto | |
| `asset_id` | String FK → Asset | |
| `timestamp` | DateTime | When reading was taken |
| `temperature_c` | Float | °C |
| `vibration_mms` | Float | mm/s RMS |
| `pressure_bar` | Float | bar |
| `current_amps` | Float | Amps |
| `rpm` | Float | Revolutions per minute |
| `noise_db` | Float | dB (optional) |
| `anomaly_flag` | Boolean | Set by SensorStreamService when values exceed threshold |
| `sensor_source` | String | `simulated` or `scada` |

**Why it exists:** Time-series telemetry is the raw input to every analytical function — anomaly detection, trend analysis, RUL prediction, and investigation evidence.

---

### `models/incident.py` — `Incident`
**Table:** `incidents`

| Column | Type | Notes |
|---|---|---|
| `incident_id` | String PK | e.g. `INC-Motor_M12-001` |
| `asset_id` | String FK → Asset | |
| `timestamp` | DateTime | When incident occurred |
| `symptoms` | Text | Observed symptoms (what operators noticed) |
| `root_cause` | String | Confirmed root cause |
| `corrective_action` | Text | What was done to fix it |
| `repair_time_hours` | Float | How long the repair took |
| `downtime_hours` | Float | Production downtime |
| `severity` | String | low / medium / high / critical |
| `technician` | String | Who performed the repair |
| `work_order_id` | String | WO reference number |
| `parts_replaced` | JSON | List of parts used |
| `cost_usd` | Float | Total repair cost |

**Why it exists:** Historical incidents are the training data for: RCA similarity search, RUL model training, feedback learning confidence calibration, and the incident page display.

---

### `models/conversation.py` — `Conversation` + `ConversationMessage`
**Tables:** `conversations`, `conversation_messages`

`Conversation`: `id` (UUID), `title`, `created_at`, `updated_at`  
`ConversationMessage`: `id`, `conversation_id` FK, `role` (user/assistant/system), `content` (Text), `timestamp`, `metadata` (JSON — stores pinned asset IDs)

**Why it exists:** Ask OREON needs persistent conversation history so users can return to previous discussions. The message `role` field follows the OpenAI message format, making the history directly usable as LLM context.

---

### `models/escalation.py` — `Escalation` + `EscalationHistory`
**Tables:** `escalations`, `escalation_history`

`Escalation`: `id`, `asset_id`, `escalation_level` (P1/P2/P3), `description`, `target_roles` (JSON array), `status` (active/resolved), `created_at`, `resolved_at`  
`EscalationHistory`: `id`, `escalation_id` FK, `action`, `performed_by`, `timestamp`, `notes`

**Why it exists:** SLA tracking and audit trail for escalations. The history table records who resolved it and when, providing accountability.

---

### `models/notification.py` — `Notification` + `NotificationRead`
**Tables:** `notifications`, `notification_reads`

`Notification`: `id`, `severity`, `title`, `message`, `asset_id`, `target_roles` (JSON), `status`, `created_at`  
`NotificationRead`: `id`, `notification_id` FK, `role`, `read_at` — one row per role that has read it

**Why it exists:** Per-role read state. An alert read by the Supervisor should still appear unread for the Maintenance Engineer. The join table handles this without denormalising the notification record.

---

### `models/maintenance_log.py` — `MaintenanceLog`
**Table:** `maintenance_logs`

| Column | Notes |
|---|---|
| `id` | Integer PK |
| `asset_id` | FK → Asset |
| `timestamp` | When logged |
| `issue` | What fault was described |
| `root_cause` | Diagnosed root cause |
| `action` | Action taken (up to 3 from investigation recommended_actions) |
| `estimated_hours` | Planned repair duration |
| `technician_assigned` | Who to assign |

**Why it exists:** Auto-created by `InvestigationService` at the end of every investigation. Provides a running operational log without manual data entry from technicians.

---

### `models/decision_feedback.py` — `DecisionFeedback`
**Table:** `decision_feedback`

| Column | Notes |
|---|---|
| `id` | Integer PK |
| `asset_id` | FK → Asset |
| `decision_id` | Investigation ID that was corrected |
| `feedback_type` | `positive` or `negative` |
| `expected_root_cause` | What OREON predicted |
| `actual_root_cause` | What operator confirmed |
| `confidence_delta` | How much confidence shifted |
| `timestamp` | When feedback was given |

**Why it exists:** The persistent store for the feedback learning loop. Without this table, every restart would forget all operator corrections.

---

### `models/sentinel_activity.py` — `SentinelActivity`
**Table:** `sentinel_activities`

| Column | Notes |
|---|---|
| `id` | Integer PK |
| `timestamp` | When activity occurred |
| `asset_id` | Asset affected (nullable for plant-wide events) |
| `activity_type` | Enum: `anomaly_detected / alert_raised / investigation_triggered / escalation_created / scan_complete` |
| `summary` | One-line description |
| `details` | JSON: sensor values, thresholds, triggered thresholds |
| `confidence` | Confidence level (0–1) of the detection |

**Why it exists:** Audit trail for the autonomous agent. Makes Sentinel's decisions explainable and reviewable. Used by the `/sentinel/activities` endpoint and the sentinel page timeline.

---

### `models/role.py` — `Role`
**Table:** `roles`

Columns: `id`, `name`, `permissions` (JSON), `created_at`

**Why it exists:** Placeholder for future RBAC implementation. Currently login is cosmetic (no JWT, no enforcement), but this model is in place for when authentication is added.

---

### `models/spare_part.py` — `SparePart`
**Table:** `spare_parts`

| Column | Notes |
|---|---|
| `id` / `part_id` | String PK (SKU-style) |
| `name` | Part name |
| `sku` | Supplier SKU |
| `equipment_type` | Which asset type uses this part |
| `supplier` | Supplier name |
| `lead_time_days` | Days from order to delivery |
| `cost_usd` | Unit cost |
| `min_stock` | Minimum required quantity |
| `current_stock` | Current on-hand quantity |
| `reorder_point` | Order when stock falls to this level |

**Property:** `is_low_stock` → `current_stock <= reorder_point`

**Why it exists:** Procurement risk analysis. The `ProcurementEngine` queries this table to determine if required parts are available before maintenance can be scheduled.

---

## 9. Backend Schemas (Pydantic)

All schemas in `backend/app/schemas/`. Every API response is validated through a Pydantic schema — ORM objects are never returned raw.

| Schema File | Key Classes | Purpose |
|---|---|---|
| `asset.py` | `AssetSummary`, `AssetResponse`, `AssetUpdate`, `ImpactChainResponse` | Asset list and detail response; update payload |
| `sensor_reading.py` | `SensorReadingResponse`, `SensorSnapshot` | Telemetry point and analysis snapshot |
| `incident.py` | `IncidentSummary`, `IncidentResponse` | Incident history list and detail |
| `conversation.py` | `AskRequest`, `AskResponse`, `ConversationSummary`, `MessageSummary` | Ask OREON chat interface |
| `investigation.py` | `InvestigationRequest`, `InvestigationReport`, `InvestigationTimelineResponse`, `LearningSignals`, `RootCauseResult` | Investigation pipeline input/output |
| `decision.py` | `DecisionAnalyzeRequest`, `DecisionReport`, `PriorityAssetSummary`, `PriorityInput`, `BusinessRiskSummary`, `ProcurementRiskSummary`, `MaintenanceActionSummary`, `ScenarioAnalysisData` | Decision intelligence pipeline I/O |
| `escalation.py` | `EscalationsResponse`, `EscalationResponse`, `ManualEscalationRequest` | Escalation management |
| `feedback.py` | `FeedbackCreate`, `FeedbackSummary`, `FeedbackStats` | Feedback learning loop |
| `dashboard.py` | `DashboardResponse`, `AlertSummary`, `CriticalAssetSummary`, `ProcurementSummary` | Plant overview aggregate |
| `logbook.py` | `MaintenanceLogCreate`, `MaintenanceLogSummary` | Maintenance log entries |
| `spare_part.py` | `SparePartSummary`, `SparePartResponse` | Spare parts inventory |
| `voice.py` | `VoiceConverseRequest`, `VoiceConverseResponse` | Voice agent interaction |

---

## 10. Backend Utilities

### `utils/data_loader.py` — `DataLoader`
Idempotent database seeder. Reads JSON files from `backend/data/` and inserts records only if they don't already exist (checks by PK). Seeded entities: Assets, Incidents, SpareParts, SensorReadings, PlantGraph edges, Roles.

Called by `main.py` lifespan on every startup. Safe to run repeatedly.  
**Why it exists:** Zero-friction first run. Clone the repo, start Docker, and the database is populated with 25 assets, 100+ incidents, and 40+ spare parts without any manual SQL.

---

### `utils/pdf_generator.py` — `generate_maintenance_pdf()`, `generate_plant_report_pdf()`
Generates PDF reports using ReportLab (or WeasyPrint).

`generate_maintenance_pdf(report_data)`:
- Renders: asset header (name, equipment type, location, criticality, health bar)
- Investigation section (root cause, diagnosis, confidence, evidence list)
- Priority scoring section (score, band, factor breakdown)
- Scenario analysis table (3/7/14/30 day delay comparison)
- Procurement section (parts needed, stock, lead times, risk)
- Maintenance plan (step-by-step actions)
- Executive summary
- Does **not** render `llm_explanation` or `explanation` — those fields are for the UI only

`generate_plant_report_pdf(kind, data)`:
- For `kind="maintenance"`: renders priority asset list + maintenance actions table
- For `kind="business"`: renders financial risk table with INR cost columns

**Why it exists:** Plant managers and procurement officers need printable/emailable reports for work order systems and management reviews.

---

### `utils/redis_cache.py` — `RedisCache`
Multi-tier cache with automatic fallback:
1. Upstash Redis (TLS via `rediss://` URL) — production
2. Local Redis (`localhost:6379`) — local dev
3. In-memory dict — if neither Redis is available

`cache_set(key, value, ttl_seconds)` / `cache_get(key)` — used by the RAG pipeline to cache embedding vectors, retrieval results, and LLM completions keyed by model + prompt hash.

**Why it exists:** Re-embedding the same query and re-fetching the same RAG context on every request wastes time and API credits. Caching brings repeat queries down from 2–5s to <50ms.

---

### `utils/ensure_schema.py` — `ensure_additive_columns()`
Inspects the live database schema and `ALTER TABLE ADD COLUMN IF NOT EXISTS` for any columns defined in models that don't yet exist in the database. Called during lifespan startup.

**Why it exists:** Allows incremental model additions without requiring a full Alembic migration in development. New optional columns added to models automatically appear in the DB on next restart.

---

### `utils/asset_naming.py` — `generate_asset_id()`
Generates OREON-style asset IDs from equipment type strings.
- `"Electric Motor"` → `"Motor_M{n}"`
- `"Centrifugal Pump"` → `"Pump_P{n}"`
- `"Blast Furnace"` → `"BlastFurnace_BF{n}"`

**Why it exists:** Asset IDs appear in API calls, database references, and plant graph edges — they must be consistent and predictable. This function ensures the format is the same whether IDs are generated at seed time or dynamically.

---

## 11. Configuration & Bootstrap

### `backend/app/config/settings.py` — `Settings`
Pydantic `BaseSettings` class. All environment variables are defined here with defaults. Never read `os.environ` directly anywhere else.

| Category | Key Variables | Default |
|---|---|---|
| App | `APP_NAME`, `APP_VERSION`, `DEBUG`, `SECRET_KEY` | `"Oreon"`, `"1.0.0"`, `False`, `"dev-secret-key"` |
| Database | `DATABASE_URL` | `"postgresql://...@localhost:5432/oreon"` |
| LLM Provider | `LLM_PROVIDER` | `"groq"` (fast tier) |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` | `""`, `"llama-3.3-70b-versatile"` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_REASONING_MODEL`, `OPENROUTER_VOICE_MODEL` | `""`, `"openai/gpt-4o-mini"`, `"openai/gpt-4o-mini"`, `"meta-llama/llama-3.3-70b-instruct"` |
| Voice | `OPENROUTER_VOICE_MAX_TOKENS`, `OPENROUTER_VOICE_TIMEOUT` | `280`, `30` |
| RAG | `USE_BGE_EMBEDDINGS`, `CHROMADB_PERSIST_DIR` | `False`, `data/chroma` |
| Qdrant | `QDRANT_URL`, `QDRANT_API_KEY` | `""`, `""` |
| Redis | `REDIS_URL` | `""` (falls back to in-memory) |
| Deepgram | `DEEPGRAM_API_KEY` | `""` |
| HuggingFace | `HF_TOKEN` | `""` |
| CORS | `CORS_ALLOW_ORIGINS` | `["https://oreon.vercel.app", "http://localhost:8080"]` |

The `CORS_ALLOW_ORIGINS` field has a validator that parses a comma-separated string from env into a list, enabling easy override: `CORS_ALLOW_ORIGINS="https://a.com,https://b.com"`.

---

### `backend/app/main.py` — FastAPI App Factory
**Lifespan sequence (startup):**
1. `create_all(engine)` — creates tables if not exists
2. `ensure_additive_columns(engine)` — back-fills new optional columns
3. `DataLoader().load_all()` — seed initial data (idempotent)
4. `KnowledgeBase.preload_rag_models()` — load reranker + embeddings + index documents
5. `APScheduler` starts `SentinelAgent.run_cycle()` on 60-second interval

**Middleware:**
- `CORSMiddleware` — `allow_origins=settings.CORS_ALLOW_ORIGINS`, `allow_methods=["*"]`, `allow_headers=["*"]`
- Rate limiting on `/api/v1/ask` (prevent LLM cost blowout)

**Routers mounted** (all under `/api/v1`):
`assets`, `alerts`, `ask`, `dashboard`, `decision`, `escalations`, `feedback`, `incidents`, `investigation`, `logbook`, `report`, `sentinel`, `simulation`, `spares`, `stream`, `voice`

**Health endpoint:** `GET /health` → `{"status": "ok", "version": "1.0.0"}`

---

### `backend/app/database/session.py`
- `engine` — SQLAlchemy `create_engine(DATABASE_URL, pool_pre_ping=True)`
- `SessionLocal` — `sessionmaker(bind=engine, autocommit=False, autoflush=False)`
- `get_db()` — FastAPI dependency: yields a session, ensures `session.close()` on exit

---

## 12. Data Layer

### `backend/data/` — Seed Files

| File | Records | Content |
|---|---|---|
| `assets.json` | 25+ assets | Equipment inventory: ID, name, type, location, criticality, health_score, failure_probability, rul_days, status, manufacturer, installation_year |
| `incidents.json` | 100+ incidents | Historical failure events: asset_id, symptoms, root_cause, corrective_action, repair_time, downtime_hours, severity, cost_usd |
| `additional_incidents.json` | Additional incidents | Supplementary incident cases for expanded RCA training data |
| `sensor_history.json` | Thousands of readings | Historical sensor time-series for RUL model training: temp, vibration, pressure, current per asset per timestamp |
| `sensor_anomaly_cases.json` | Labeled cases | Known anomaly scenarios with ground-truth labels for validation |
| `spare_parts.json` | 40+ parts | Parts inventory: name, SKU, equipment_type, supplier, lead_time_days, cost_usd, min_stock, current_stock, reorder_point |
| `plant_graph.json` | Graph structure | NetworkX-compatible edge list: `{source: "Motor_M12", target: "Conveyor_C7", relation: "drives"}` |

### Plant Dependency Graph (from `CLAUDE.md`)
```
Crusher_CR1 ──feeds──┐
Motor_M12 ──drives──► Conveyor_C7 ──feeds──► BlastFurnace_BF2 ──requires──► Fan_F2 ──exhausts──► DustCollector_DC1
Pump_P3 ──supplies──► CoolingSystem_C1 ──cools──► BlastFurnace_BF2
                                         └──cools──► RollingMill_RM1 ──drives──► Gearbox_G1
```

`PlantGraphService.get_impact_chain("Motor_M12")` returns `[Conveyor_C7, BlastFurnace_BF2, Fan_F2, DustCollector_DC1]` — the full blast radius.

---

## 13. Architecture Patterns

### Layering Rule (Hard Constraint)
```
HTTP Request
    │
    ▼
api/v1/*.py       ← ONLY: parse request, call one service, return response
    │
    ▼
services/*.py     ← ALL business logic, computation, LLM calls, DB writes
    │
    ▼
models/*.py       ← SQLAlchemy ORM (database access via services only)
```

No business logic in route handlers. No raw SQL in routes. No ORM objects returned directly — always converted through a Pydantic schema.

---

### Request/Response Contract
Every API input and output crosses a Pydantic schema. This enforces:
- Automatic validation (type coercion, field constraints)
- OpenAPI documentation auto-generation
- TypeScript interface generation (via `api/types.ts` on the frontend)

---

### Streaming Pattern
Two endpoints stream responses (`/investigate` and `/ask`):
- Backend: `StreamingResponse(content=generator(), media_type="application/x-ndjson")`
- Generator yields: `json.dumps(chunk) + "\n"` per step
- Frontend: `fetch()` + `response.body.getReader()` + chunk accumulation
- Progress events: `{"progress": "Step Name"}` — drives UI progress bar
- Final event: `{"progress": "COMPLETE", "report": {...}}` or `{"result": {...}}`

---

### React Query Cache Strategy
| Data Type | staleTime | refetchInterval | Rationale |
|---|---|---|---|
| Assets | 30s | — | Changes rarely during a shift |
| Dashboard | 30s | 30s | Auto-refresh for live KPIs |
| Ask messages | 0 | — | Must always be fresh — stale cache caused the "reply disappears" bug |
| Sensor stream | — | SSE push | Real-time — no polling needed |
| Incidents | 5m | — | Historical, rarely changes |

---

### Optimistic UI (Ask OREON)
1. User sends message → immediately show as "pending bubble"
2. `sentAtLenRef` records current message count
3. Stream fires, backend saves both user message and reply
4. `staleTime: 0` refetch on stream completion gets the new DB state
5. Catch-up effect: when `dbMessages.length > sentAtLenRef.current`, clear the pending bubble
6. On error: clear bubble and show error state

This ensures the UI is immediately responsive without waiting for the full stream, while the bubble is reliably cleared only when the database confirms persistence.

---

### Brand Consistency Pattern
All occurrences of the OREON name use the `<OreonWord />` component:
- `ORE` → `.text-steel` (brushed silver CSS gradient via `background-clip: text`)
- `ON` → `.text-foreground` (white in dark theme)

Locations: landing header, app sidebar, "Ask OREON" nav item, Ask page empty state heading, "OREON Voice" button, voice subtitles brand tag.

---

### PDF Export Performance
The asset PDF export (`GET /report/{id}/export`) calls `decision_svc.analyze(payload, with_explanation=False)`. This flag propagates through the entire service chain, skipping:
- `InvestigationReasoningService.explain()` (the investigation LLM narration, ≈30–90s)
- `DecisionReasoningService.explain()` (the decision LLM narration, ≈30–90s)
- All cosmetic `time.sleep()` pacing delays (≈2.6s total)

The PDF only renders deterministic fields that are computed in milliseconds. Result: export completes in seconds instead of 2–3 minutes.

---

### CORS Configuration
Controlled entirely via `settings.CORS_ALLOW_ORIGINS`:
- Production: `https://oreon.vercel.app`
- Local dev: `http://localhost:8080`
- Override via env: `CORS_ALLOW_ORIGINS="https://custom.com,http://localhost:3000"`

No wildcard `*` in production — prevents credential leakage.
