/**
 * Typed wrappers around every OREON backend endpoint.
 * One function per route; all calls go through the shared `http` client.
 */
import { http, API_BASE } from "./client";
import type {
  AssetResponse,
  AssetSummary,
  BusinessRiskSummary,
  DashboardResponse,
  DecisionAnalyzeRequest,
  DecisionReport,
  ImpactChainResponse,
  IncidentResponse,
  IncidentSummary,
  InvestigationReport,
  InvestigationRequest,
  InvestigationTimelineResponse,
  MaintenanceActionSummary,
  PriorityAssetSummary,
  ProcurementRiskSummary,
  ScenarioAnalysisData,
  ScenarioRequest,
  SparePartResponse,
  SparePartSummary,
  AskRequest,
  AskResponse,
  ConversationSummary,
  MessageSummary,
  FeedbackCreate,
  FeedbackSummary,
  FeedbackStats,
  MaintenanceLogCreate,
  MaintenanceLogSummary,
  PlantGraphResponse,
  AlertsListResponse,
  EscalationsListResponse,
} from "./types";

export interface AssetFilters {
  status?: string;
  criticality?: string;
  equipment_type?: string;
  [key: string]: string | undefined;
}

export const assetsApi = {
  list: (filters: AssetFilters = {}) =>
    http.get<AssetSummary[]>("/assets", filters),
  get: (id: string) => http.get<AssetResponse>(`/assets/${id}`),
  impact: (id: string) => http.get<ImpactChainResponse>(`/assets/${id}/impact`),
  update: (id: string, body: Partial<AssetResponse>) =>
    http.patch<AssetResponse>(`/assets/${id}`, body),
  plantGraph: () => http.get<PlantGraphResponse>("/assets/plant-graph"),
  investigate: (id: string) => http.get<InvestigationReport>(`/assets/${id}/investigate`),
};

export const dashboardApi = {
  get: () => http.get<DashboardResponse>("/dashboard"),
};

export interface IncidentFilters {
  asset_id?: string;
  severity?: string;
  [key: string]: string | undefined;
}

export const incidentsApi = {
  list: (filters: IncidentFilters = {}) =>
    http.get<IncidentSummary[]>("/incidents", filters),
  get: (id: string) => http.get<IncidentResponse>(`/incidents/${id}`),
};

export const sparesApi = {
  list: (filters: SpareFilters = {}) =>
    http.get<SparePartSummary[]>("/spares", filters),
  get: (id: string) => http.get<SparePartResponse>(`/spares/${id}`),
};

export interface SpareFilters {
  equipment_type?: string;
  low_stock?: boolean;
  [key: string]: string | boolean | undefined;
}

export const investigationApi = {
  investigate: (body: InvestigationRequest) =>
    http.post<InvestigationReport>("/investigate", body),
  investigateStream: async (
    body: InvestigationRequest,
    onEvent: (event: { progress: string; report?: InvestigationReport }) => void,
    signal?: AbortSignal
  ) => {
    const response = await fetch(`${API_BASE}/api/v1/investigate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json();
        detail = data?.detail ?? detail;
      } catch {}
      throw new Error(detail);
    }
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (line) {
            try {
              const event = JSON.parse(line);
              onEvent(event);
            } catch (e) {
              console.error("Failed to parse NDJSON", line, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
  timeline: () =>
    http.get<InvestigationTimelineResponse>("/investigate/timeline"),
};

export const decisionApi = {
  analyze: (body: DecisionAnalyzeRequest) =>
    http.post<DecisionReport>("/decision/analyze", body),
  scenario: (body: ScenarioRequest) =>
    http.post<ScenarioAnalysisData>("/decision/scenario", body),
  priorityAssets: (limit = 20) =>
    http.get<PriorityAssetSummary[]>("/priority-assets", { limit }),
  procurementRisks: () =>
    http.get<ProcurementRiskSummary[]>("/procurement-risks"),
  maintenanceActions: (limit = 20) =>
    http.get<MaintenanceActionSummary[]>("/maintenance-actions", { limit }),
  businessRisks: (limit = 20) =>
    http.get<BusinessRiskSummary[]>("/business-risks", { limit }),
};

// ----- Ask OREON -----
export const askApi = {
  ask: (body: AskRequest) => http.post<AskResponse>("/ask", body),
  askStream: async (
    body: AskRequest,
    onEvent: (event: {
      type: "status" | "token" | "result" | "error";
      message?: string;
      text?: string;
      data?: AskResponse;
    }) => void,
    signal?: AbortSignal
  ) => {
    const activeRole = typeof window !== "undefined" ? localStorage.getItem("oreon_role") || "operator" : "operator";
    const response = await fetch(`${API_BASE}/api/v1/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Oreon-Role": activeRole,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json();
        detail = data?.detail ?? detail;
      } catch {}
      throw new Error(detail);
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            try {
              const event = JSON.parse(jsonStr);
              onEvent(event);
            } catch (e) {
              console.error("Failed to parse SSE JSON", jsonStr, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
  history: () => http.get<ConversationSummary[]>("/ask/history"),
  messages: (conversation_id: string) =>
    http.get<MessageSummary[]>(`/ask/history/${conversation_id}/messages`),
  deleteConversation: (conversation_id: string) =>
    http.delete<void>(`/ask/history/${conversation_id}`),
};

// ----- Feedback Loop -----
export const feedbackApi = {
  submit: (body: FeedbackCreate) => http.post<FeedbackSummary>("/feedback", body),
  list: () => http.get<FeedbackSummary[]>("/feedback"),
  stats: () => http.get<FeedbackStats>("/feedback/stats"),
};

// ----- Logbook -----
export const logbookApi = {
  list: (asset_id?: string, limit = 100) =>
    http.get<MaintenanceLogSummary[]>("/logbook", { asset_id, limit }),
  create: (body: MaintenanceLogCreate) =>
    http.post<MaintenanceLogSummary>("/logbook", body),
};

// ----- Report Export -----
export const reportApi = {
  downloadUrl: (asset_id: string, format = "pdf") =>
    `${API_BASE}/api/v1/report/${asset_id}/export?format=${format}`,
  // Whole-plant reports tied to the Decisions page tabs (not a single asset).
  plantUrl: (kind: "maintenance" | "business", format = "pdf") =>
    `${API_BASE}/api/v1/report/plant/${kind}/export?format=${format}`,
};

// ----- Command Center Alerts & Escalations -----
export interface AlertFilters {
  role?: string;
  severity?: string;
  asset_id?: string;
  status?: string;
  limit?: number;
  [key: string]: string | number | undefined;
}

export const alertsApi = {
  list: (filters: AlertFilters = {}) =>
    http.get<AlertsListResponse>("/alerts", filters),
  read: (alertId: number, role: string) =>
    http.post<{ success: boolean }>(`/alerts/${alertId}/read?role=${encodeURIComponent(role)}`, {}),
};

export interface EscalationFilters {
  asset_id?: string;
  resolved?: boolean;
  limit?: number;
  [key: string]: string | boolean | number | undefined;
}

export const escalationsApi = {
  list: (filters: EscalationFilters = {}) =>
    http.get<EscalationsListResponse>("/escalations", filters),
  resolve: (escalationId: number) =>
    http.post<{ success: boolean }>(`/escalations/${escalationId}/resolve`, {}),
  create: (body: { asset_id: string; escalation_level: string; reason: string }) =>
    http.post<{ success: boolean }>("/escalations", body),
};

// ----- Sentinel (Autonomous Agent) -----
import type {
  SentinelStatus,
  SentinelActivitiesResponse,
  SentinelStats,
  SentinelTimelineEvent,
} from "./types";

export interface SentinelActivityFilters {
  limit?: number;
  offset?: number;
  activity_type?: string;
  asset_id?: string;
  [key: string]: string | number | undefined;
}

export const sentinelApi = {
  status: () => http.get<SentinelStatus>("/sentinel/status"),
  activities: (filters: SentinelActivityFilters = {}) =>
    http.get<SentinelActivitiesResponse>("/sentinel/activities", filters),
  stats: () => http.get<SentinelStats>("/sentinel/stats"),
  timeline: (limit = 20) =>
    http.get<SentinelTimelineEvent[]>("/sentinel/timeline", { limit }),
  trigger: () => http.post<{ triggered: boolean; result: any }>("/sentinel/trigger", {}),
};
