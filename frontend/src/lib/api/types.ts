/**
 * TypeScript mirrors of the OREON FastAPI Pydantic schemas.
 * Source of truth is the backend (backend/app/schemas/*.py).
 */

export type AssetStatus =
  | "operational"
  | "degraded"
  | "critical"
  | "offline"
  | "maintenance";

export type CriticalityLevel = "low" | "medium" | "high" | "critical";

// ----- Assets -----
export interface AssetSummary {
  id: string;
  name: string;
  equipment_type: string;
  criticality: CriticalityLevel;
  health_score: number;
  failure_probability: number;
  rul_days: number;
  status: AssetStatus;
}

export interface AssetResponse extends AssetSummary {
  location: string;
  production_line: string;
  last_maintenance_date: string | null;
  description: string | null;
  manufacturer: string | null;
  model_number: string | null;
  installation_year: number | null;
  created_at: string;
  updated_at: string;
}

export interface ImpactChainResponse {
  asset_id: string;
  asset_name: string;
  downstream_assets: AssetSummary[];
  total_impact_score: number;
  affected_production_lines: string[];
}

// ----- Incidents -----
export interface IncidentSummary {
  incident_id: string;
  asset_id: string;
  timestamp: string;
  root_cause: string;
  severity: string;
  downtime_hours: number;
}

export interface IncidentResponse extends IncidentSummary {
  symptoms: string;
  corrective_action: string;
  repair_time_hours: number;
  technician: string | null;
  work_order_id: string | null;
  parts_replaced: string | null;
  cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

// ----- Spare parts -----
export interface SparePartSummary {
  part_id: string;
  part_name: string;
  equipment_type: string;
  stock_quantity: number;
  reorder_level: number;
  lead_time_days: number;
  is_low_stock: boolean;
  compatible_assets?: string | null;
}

export interface SparePartResponse extends SparePartSummary {
  supplier: string;
  unit_cost_usd: number | null;
  part_number: string | null;
  description: string | null;
  storage_location: string | null;
  compatible_assets: string | null;
  created_at: string;
  updated_at: string;
}

// ----- Dashboard -----
export interface PredictedFailure {
  asset_id: string;
  asset_name: string;
  equipment_type: string;
  failure_probability: number;
  rul_days: number;
  criticality: string;
  recommended_action: string;
}

export interface ActiveAlert {
  asset_id: string;
  asset_name: string;
  alert_type: string;
  severity: string;
  message: string;
}

export interface DashboardResponse {
  active_alerts: number;
  critical_assets: AssetSummary[];
  predicted_failures: PredictedFailure[];
  spare_shortages: SparePartSummary[];
  total_assets: number;
  operational_assets: number;
  assets_in_maintenance: number;
  avg_plant_health: number;
}

// ----- Investigation -----
export interface SensorSnapshot {
  temperature_c?: number | null;
  vibration_mms?: number | null;
  pressure_bar?: number | null;
  current_amps?: number | null;
  rpm?: number | null;
  noise_db?: number | null;
}

export interface InvestigationRequest {
  asset_id: string;
  fault_description: string;
  sensor_snapshot: SensorSnapshot;
}

export interface KnowledgeChunk {
  text: string;
  source_document: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface EvidenceBundle {
  sensor_evidence: string[];
  manual_evidence: KnowledgeChunk[];
  sop_evidence: KnowledgeChunk[];
  historical_evidence: Record<string, unknown>[];
}

export interface ReasoningNarrative {
  natural_language_explanation: string;
  manager_summary: string;
  engineer_summary: string;
  risk_explanation: string;
  maintenance_recommendation: string;
}

export interface InvestigationReport {
  asset_id: string;
  asset_name: string;
  investigation_id: string;
  diagnosis: string;
  root_cause: string;
  confidence: number;
  risk_level: string;
  rul_days: number;
  rul_lower?: number;
  rul_upper?: number;
  rul_confidence?: number;
  evidence: EvidenceBundle;
  similar_incidents: Record<string, unknown>[];
  recommended_actions: string[];
  next_steps: string[];
  timeline: string[];
  procedural_knowledge: KnowledgeChunk[];
  historical_knowledge: Record<string, unknown>[];
  llm_explanation: ReasoningNarrative | null;
}

export interface InvestigationTimelineResponse {
  steps: string[];
}

// ----- Decision -----
export interface PriorityData {
  priority_score: number;
  priority_band: string;
  priority_reason: string;
  score_components: Record<string, number>;
}

export interface PlantImpactData {
  affected_assets: Record<string, unknown>[];
  production_line: string;
  critical_assets_impacted: Record<string, unknown>[];
  estimated_downtime_hours: number;
  impact_score: number;
  impact_category: string;
  impact_chain: Record<string, unknown>[];
  bottlenecks: Record<string, unknown>[];
}

export interface ProcurementData {
  available_parts: Record<string, unknown>[];
  missing_parts: Record<string, unknown>[];
  lead_times: Record<string, unknown>[];
  procurement_risk: string;
  reorder_recommendations: string[];
  alternative_parts: Record<string, unknown>[];
}

export interface BusinessImpactData {
  production_loss_estimate: string;
  downtime_hours: number;
  business_risk: string;
  executive_summary: string;
  cost_of_inaction_inr?: number;
  cost_of_action_inr?: number;
  revenue_exposure_inr?: number;
  impact_level?: string;
}

export interface ScenarioAnalysisData {
  current_health: number;
  future_health: number;
  current_failure_probability: number;
  future_failure_probability: number;
  failure_risk_change: string;
  affected_assets: Record<string, unknown>[];
  production_impact: string;
  recommendation: string;
  delay_days: number;
}

export interface MaintenancePlanData {
  immediate_actions: string[];
  next_24_hours: string[];
  next_7_days: string[];
  long_term_actions: string[];
  maintenance_schedule: Record<string, unknown>[];
}

export interface DecisionExplanation {
  engineer_summary: string;
  supervisor_summary: string;
  executive_summary: string;
}

export interface DecisionReport {
  asset_id: string;
  investigation: InvestigationReport;
  priority: PriorityData;
  plant_impact: PlantImpactData;
  business_impact: BusinessImpactData;
  procurement: ProcurementData;
  scenario_analysis: Record<string, ScenarioAnalysisData>;
  maintenance_plan: MaintenancePlanData;
  executive_summary: string;
  explanation: DecisionExplanation | null;
  recommendations_by_role?: Record<string, string>;
}

export interface DecisionAnalyzeRequest extends InvestigationRequest {
  delay_days?: number[];
  required_parts?: string[];
}

export interface ScenarioRequest {
  asset_id: string;
  delay_days: number;
}

export interface PriorityAssetSummary {
  asset_id: string;
  asset_name: string;
  equipment_type: string;
  health_score: number;
  failure_probability: number;
  rul_days: number;
  priority: PriorityData;
}

export interface ProcurementRiskSummary {
  part_id: string;
  part_name: string;
  equipment_type: string;
  stock_quantity: number;
  reorder_level: number;
  lead_time_days: number;
  procurement_risk: string;
}

export type POStage = "PENDING_APPROVAL" | "APPROVED" | "SHIPPED" | "RECEIVED";

export interface PurchaseOrder {
  id: number;
  po_number: string;
  part_id: string;
  part_name: string;
  qty: number;
  lead_time_days: number;
  unit_cost_usd: number | null;
  order_value_inr: number;
  stage: POStage;
  requested_by_role: string | null;
  supplier: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderSummaryData {
  total: number;
  open: number;
  on_order_value_inr: number;
  total_value_inr: number;
}

export interface CreatePurchaseOrderRequest {
  part_id: string;
  qty: number;
  requested_by_role?: string;
}

export interface NudgeRequest {
  part_id: string;
  note?: string;
  from_role?: string;
}

export interface MaintenanceActionSummary {
  asset_id: string;
  asset_name: string;
  action: string;
  priority_band: string;
  due_window: string;
}

export interface BusinessRiskSummary {
  asset_id: string;
  asset_name: string;
  production_line: string;
  business_risk: string;
  estimated_downtime_hours: number;
  impact_score: number;
  cost_of_inaction_inr?: number;
  cost_of_action_inr?: number;
  revenue_exposure_inr?: number;
  impact_level?: string;
}

// ----- Ask OREON -----
export interface PinInput {
  kind: "asset" | "incident" | "sop";
  label: string;
}

export interface AskRequest {
  query: string;
  conversation_id?: string;
  pins?: PinInput[];
  role?: string;
  context_asset_id?: string;
  context_page?: string;
  stream?: boolean;
}

export interface EvidenceSource {
  text: string;
  src: string;
}

export interface ReasoningStep {
  t: string;
  d: string;
}

export interface AskResponse {
  conversation_id: string;
  diagnosis: string;
  evidence: EvidenceSource[];
  recommended: string;
  confidence: number;
  critical: boolean;
  risk_level?: "low" | "medium" | "high" | "critical" | null;
  reasoning: ReasoningStep[];
}

export interface MessageSummary {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  sources?: any[] | null;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// ----- Feedback Loop -----
export interface FeedbackCreate {
  asset_id?: string;
  asset_type?: string;
  decision_type: string;
  feedback_value: string;
  investigation_id?: string;
  predicted_root_cause?: string;
  corrected_root_cause?: string;
  predicted_confidence?: number;
  outcome?: string;
  user_comments?: string;
}

export interface FeedbackSummary {
  id: number;
  asset_id?: string | null;
  decision_type: string;
  feedback_value: string;
  user_comments?: string | null;
  created_at: string;
}

export interface FeedbackStatsItem {
  total_count: number;
  helpful_count: number;
  helpfulness_ratio: number;
}

export type FeedbackStats = Record<string, FeedbackStatsItem>;

// ----- Logbook -----
export interface MaintenanceLogCreate {
  asset_id: string;
  issue: string;
  root_cause: string;
  action: string;
  engineer_notes?: string;
}

export interface MaintenanceLogSummary {
  id: number;
  asset_id: string;
  issue: string;
  root_cause: string;
  action: string;
  engineer_notes?: string | null;
  timestamp: string;
}

// ----- Plant Graph -----
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  status: string;
  health: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

export interface PlantGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ----- Command Center Alerts & Escalations -----
export interface NotificationSummary {
  id: number;
  severity: string;
  title: string;
  message: string;
  asset_id: string | null;
  target_roles: string[];
  created_at: string;
  status: string;
  is_read: boolean;
}

export interface EscalationSummary {
  id: number;
  asset_id: string;
  escalation_level: string;
  target_roles: string[];
  resolved: boolean;
  created_at: string;
}

export interface EscalationHistorySummary {
  id: number;
  asset_id: string;
  risk_level: string;
  priority_band: string;
  target_roles: string[];
  reason: string;
  timestamp: string;
  decision_id: string | null;
}

export interface AlertsListResponse {
  counts: Record<string, number>;
  alerts: NotificationSummary[];
}

export interface EscalationsListResponse {
  active: EscalationSummary[];
  history: EscalationHistorySummary[];
}

// ----- Sentinel (Autonomous Agent) -----
export type SentinelActivityType =
  | "anomaly_detected"
  | "investigation_started"
  | "alert_created"
  | "escalation_created"
  | "maintenance_plan_generated"
  | "rca_completed"
  | "rul_predicted"
  | "health_check";

export interface SentinelStatus {
  running: boolean;
  last_scan: string | null;
  scan_count: number;
  anomalies_detected: number;
  alerts_generated: number;
  investigations_created: number;
  escalations_triggered: number;
  assets_monitored: number;
  uptime_seconds: number;
}

export interface SentinelActivity {
  id: number;
  timestamp: string;
  asset_id: string;
  activity_type: SentinelActivityType;
  summary: string;
  details: Record<string, any> | null;
  confidence: number | null;
}

export interface SentinelActivitiesResponse {
  activities: SentinelActivity[];
  count: number;
}

export interface SentinelStats {
  total_activities: number;
  by_type: Record<SentinelActivityType, number>;
  average_confidence: number;
  success_rate: number;
  scan_count: number;
  running: boolean;
}

export interface SentinelTimelineEvent {
  id: number;
  time: string;
  type: SentinelActivityType;
  summary: string;
  asset_id: string;
  confidence: number | null;
}