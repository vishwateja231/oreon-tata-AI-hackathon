/**
 * React Query hooks for the OREON backend.
 * Components stay declarative: call a hook, render `data`/`isLoading`/`isError`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";

import {
  assetsApi,
  dashboardApi,
  decisionApi,
  incidentsApi,
  investigationApi,
  sparesApi,
  askApi,
  feedbackApi,
  logbookApi,
  alertsApi,
  escalationsApi,
  type AssetFilters,
  type IncidentFilters,
  type SpareFilters,
  type AlertFilters,
  type EscalationFilters,
} from "./endpoints";
import type {
  AssetResponse,
  DecisionAnalyzeRequest,
  InvestigationRequest,
  ScenarioRequest,
  AskRequest,
  FeedbackCreate,
  MaintenanceLogCreate,
} from "./types";

// ---------- Dashboard ----------
export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

// ---------- Assets ----------
export function useAssets(filters: AssetFilters = {}) {
  return useQuery({
    queryKey: ["assets", filters],
    queryFn: () => assetsApi.list(filters),
    staleTime: 30_000,
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: ["asset", id],
    queryFn: () => assetsApi.get(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useAssetImpact(id: string | undefined) {
  return useQuery({
    queryKey: ["asset-impact", id],
    queryFn: () => assetsApi.impact(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<AssetResponse> }) =>
      assetsApi.update(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["asset", id] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function usePlantGraph() {
  return useQuery({
    queryKey: ["plant-graph"],
    queryFn: assetsApi.plantGraph,
  });
}

export function useAssetInvestigation(id: string | undefined) {
  return useQuery({
    queryKey: ["asset-investigate", id],
    queryFn: () => assetsApi.investigate(id as string),
    enabled: Boolean(id),
  });
}

// ---------- Incidents ----------
export function useIncidents(filters: IncidentFilters = {}) {
  return useQuery({
    queryKey: ["incidents", filters],
    queryFn: () => incidentsApi.list(filters),
  });
}

// ---------- Spares ----------
export function useSpares(filters: SpareFilters = {}) {
  return useQuery({
    queryKey: ["spares", filters],
    queryFn: () => sparesApi.list(filters),
  });
}

// ---------- Investigation ----------
export function useInvestigationTimeline() {
  return useQuery({
    queryKey: ["investigation-timeline"],
    queryFn: investigationApi.timeline,
    staleTime: Infinity,
  });
}

export function useInvestigate() {
  return useMutation({
    mutationFn: (body: InvestigationRequest) =>
      investigationApi.investigate(body),
  });
}

// ---------- Decision ----------
export function useDecisionAnalyze() {
  return useMutation({
    mutationFn: (body: DecisionAnalyzeRequest) => decisionApi.analyze(body),
  });
}

export function useDecisionReport(assetId: string | undefined) {
  return useQuery({
    queryKey: ["decision-report", assetId],
    queryFn: () =>
      decisionApi.analyze({
        asset_id: assetId as string,
        fault_description: `Routine evaluation for ${assetId}`,
        sensor_snapshot: {},
      }),
    enabled: Boolean(assetId),
  });
}

export function useScenario() {
  return useMutation({
    mutationFn: (body: ScenarioRequest) => decisionApi.scenario(body),
  });
}

export function usePriorityAssets(limit = 20) {
  return useQuery({
    queryKey: ["priority-assets", limit],
    queryFn: () => decisionApi.priorityAssets(limit),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useProcurementRisks() {
  return useQuery({
    queryKey: ["procurement-risks"],
    queryFn: decisionApi.procurementRisks,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useMaintenanceActions(limit = 20) {
  return useQuery({
    queryKey: ["maintenance-actions", limit],
    queryFn: () => decisionApi.maintenanceActions(limit),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useBusinessRisks(limit = 20) {
  return useQuery({
    queryKey: ["business-risks", limit],
    queryFn: () => decisionApi.businessRisks(limit),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ---------- Ask OREON ----------
export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AskRequest) => askApi.ask(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ask-history"] });
    },
  });
}

export function useAskHistory() {
  return useQuery({
    queryKey: ["ask-history"],
    queryFn: askApi.history,
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => askApi.deleteConversation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ask-history"] });
    },
  });
}

export function useAskMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["ask-messages", conversationId],
    queryFn: () => askApi.messages(conversationId as string),
    enabled: Boolean(conversationId),
    // A chat thread must always reflect the latest persisted turn. The global
    // 30s staleTime would otherwise serve the pre-reply message list from cache
    // after a follow-up turn, so a 2nd message's reply only appeared on refresh.
    staleTime: 0,
  });
}

// ---------- Feedback Loop ----------
export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackCreate) => feedbackApi.submit(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-stats"] });
      qc.invalidateQueries({ queryKey: ["feedback-list"] });
    },
  });
}

export function useFeedbackStats() {
  return useQuery({
    queryKey: ["feedback-stats"],
    queryFn: feedbackApi.stats,
  });
}

// ---------- Logbook ----------
export function useLogbook(assetId?: string, limit = 100) {
  return useQuery({
    queryKey: ["logbook", assetId, limit],
    queryFn: () => logbookApi.list(assetId, limit),
  });
}

export function useCreateLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MaintenanceLogCreate) => logbookApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logbook"] });
    },
  });
}

// ---------- Alerts ----------
export function useAlerts(filters: AlertFilters = {}) {
  return useQuery({
    queryKey: ["alerts", filters],
    queryFn: () => alertsApi.list(filters),
    refetchInterval: 15_000, // refresh feed periodically
  });
}

export function useReadAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, role }: { alertId: number; role: string }) =>
      alertsApi.read(alertId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ---------- Escalations ----------
export function useEscalations(filters: EscalationFilters = {}) {
  return useQuery({
    queryKey: ["escalations", filters],
    queryFn: () => escalationsApi.list(filters),
    refetchInterval: 15_000,
  });
}

export function useResolveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (escalationId: number) => escalationsApi.resolve(escalationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalations"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

export function useCreateManualEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { asset_id: string; escalation_level: string; reason: string }) =>
      escalationsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalations"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ---------- Role / Persona Management ----------
export type OperationalRole =
  | "operator"
  | "maintenance_engineer"
  | "supervisor"
  | "plant_manager"
  | "reliability_engineer"
  | "procurement_officer";

export function getActiveRole(): OperationalRole {
  if (typeof window !== "undefined") {
    const role = localStorage.getItem("oreon_role") as OperationalRole;
    if (
      role &&
      [
        "operator",
        "maintenance_engineer",
        "supervisor",
        "plant_manager",
        "reliability_engineer",
        "procurement_officer",
      ].includes(role)
    ) {
      return role;
    }
  }
  return "operator";
}

export function setActiveRole(role: OperationalRole) {
  if (typeof window !== "undefined") {
    localStorage.setItem("oreon_role", role);
    window.dispatchEvent(new Event("oreon_role_changed"));
  }
}

export function useActiveRole() {
  // Initialize with the SSR-safe default so server and first client render
  // match (avoids a hydration mismatch that regenerates the whole shell);
  // the real role from localStorage is applied in the effect below.
  const [role, setRoleState] = useState<OperationalRole>("operator");

  useEffect(() => {
    setRoleState(getActiveRole());
    const handler = () => {
      setRoleState(getActiveRole());
    };
    window.addEventListener("oreon_role_changed", handler);
    return () => window.removeEventListener("oreon_role_changed", handler);
  }, []);

  const setRole = (newRole: OperationalRole) => {
    setActiveRole(newRole);
  };

  return [role, setRole] as const;
}

import { ROLE_CONFIGS, type RoleConfig } from "../role-config";

export function useRoleConfig(): RoleConfig {
  const [role] = useActiveRole();
  return ROLE_CONFIGS[role];
}

// ---------- Sentinel (Autonomous Agent) ----------
import { sentinelApi, type SentinelActivityFilters } from "./endpoints";

export function useSentinelStatus() {
  return useQuery({
    queryKey: ["sentinel-status"],
    queryFn: sentinelApi.status,
    refetchInterval: 10_000,
  });
}

export function useSentinelActivities(filters: SentinelActivityFilters = {}) {
  return useQuery({
    queryKey: ["sentinel-activities", filters],
    queryFn: () => sentinelApi.activities(filters),
    refetchInterval: 10_000,
  });
}

export function useSentinelStats() {
  return useQuery({
    queryKey: ["sentinel-stats"],
    queryFn: sentinelApi.stats,
    refetchInterval: 30_000,
  });
}

export function useSentinelTimeline(limit = 20) {
  return useQuery({
    queryKey: ["sentinel-timeline", limit],
    queryFn: () => sentinelApi.timeline(limit),
    refetchInterval: 10_000,
  });
}

export function useTriggerSentinel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sentinelApi.trigger,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sentinel-status"] });
      qc.invalidateQueries({ queryKey: ["sentinel-activities"] });
      qc.invalidateQueries({ queryKey: ["sentinel-stats"] });
      qc.invalidateQueries({ queryKey: ["sentinel-timeline"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["escalations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
