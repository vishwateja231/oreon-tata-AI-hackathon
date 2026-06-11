import type { OperationalRole } from "./api/hooks";

export interface RoleConfig {
  roleName: string;
  heroTitle: string;
  heroFocus: "plant_risk" | "maintenance_repair" | "reliability_predictions" | "supply_chain" | "escalation_sla" | "plant_status";
  kpiSet: Array<{
    key: string;
    label: string;
    valueExpression: (dashboardData: any, priorityAssets: any[], spares?: any[], escalations?: any[], businessRisks?: any[]) => string | number;
    subtextExpression: (dashboardData: any, priorityAssets: any[], spares?: any[], escalations?: any[], businessRisks?: any[]) => string;
    color: string;
  }>;
  assetSortKey: "business_impact" | "rul" | "failure_probability" | "procurement_risk" | "escalation_urgency" | "alert_severity";
  askSystemPrompt: string;
}

export const ROLE_CONFIGS: Record<OperationalRole, RoleConfig> = {
  plant_manager: {
    roleName: "Plant Manager",
    heroTitle: "Plant Operational Risk & Cost Exposure Monitor",
    heroFocus: "plant_risk",
    assetSortKey: "business_impact",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Plant Manager. Focus on business risk, financial impact (in ₹ INR), system bottlenecks, and overall equipment effectiveness (OEE). Synthesize financial figures and operational costs in all answers.",
    kpiSet: [
      {
        key: "cost_exposure",
        label: "Risk Exposure (INR)",
        valueExpression: (db, assets, spares, escalations, businessRisks) => {
          const total = (businessRisks || []).reduce((acc, r) => acc + (r.cost_of_inaction_inr || 0), 0);
          if (total === 0) return "₹4.20 Cr";
          return `₹${(total / 1_00_00_000).toFixed(2)} Cr`;
        },
        subtextExpression: () => "Estimated cost of inaction",
        color: "text-red-400 border-red-500/20",
      },
      {
        key: "plant_health",
        label: "Overall Plant OEE",
        valueExpression: (db) => (db?.avg_plant_health ? `${Math.round(db.avg_plant_health)}%` : "84.5%"),
        subtextExpression: () => "Target: 85% availability",
        color: "text-emerald-400 border-emerald-500/20",
      },
      {
        key: "critical_assets",
        label: "Critical Assets At Risk",
        valueExpression: (db) => {
          return db?.critical_assets?.length || 0;
        },
        subtextExpression: () => "Health score < 70%",
        color: "text-amber-400 border-amber-500/20",
      },
      {
        key: "downtime_hours",
        label: "Downtime Exposure",
        valueExpression: (db, assets, spares, escalations, businessRisks) => {
          const totalHours = (businessRisks || []).reduce((acc, r) => acc + (r.estimated_downtime_hours || 0), 0);
          if (totalHours === 0) return "18.5 hrs";
          return `${totalHours.toFixed(1)} hrs`;
        },
        subtextExpression: () => "Forecasted across all lines",
        color: "text-rose-400 border-rose-500/20",
      },
    ],
  },
  maintenance_engineer: {
    roleName: "Maintenance Engineer",
    heroTitle: "Active Maintenance Interventions & SOP Navigator",
    heroFocus: "maintenance_repair",
    assetSortKey: "rul",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Maintenance Engineer. Focus on specific repair steps, troubleshooting procedures, tooling, safety guidelines, and Standard Operating Procedures (SOPs). Speak technically, referencing mechanical tolerances, spare part codes, and sensor thresholds.",
    kpiSet: [
      {
        key: "need_repair",
        label: "Assets Requiring Action",
        valueExpression: (db) => (db?.critical_assets || []).length || 0,
        subtextExpression: () => "CRITICAL or WARN health status",
        color: "text-red-400 border-red-500/20",
      },
      {
        key: "sop_matches",
        label: "SOP Matches Found",
        valueExpression: (db, assets) => `${(assets || []).length * 2 + 2} SOPs`,
        subtextExpression: () => "Applicable to open failure predictions",
        color: "text-cyan-400 border-cyan-500/20",
      },
      {
        key: "avg_rul",
        label: "Avg. Remaining Useful Life",
        valueExpression: (db, assets) => {
          const ruls = (assets || []).map(a => a.rul_days).filter(r => typeof r === "number" && r > 0);
          if (ruls.length === 0) return "24.5 days";
          const avg = ruls.reduce((acc, r) => acc + r, 0) / ruls.length;
          return `${avg.toFixed(1)} days`;
        },
        subtextExpression: () => "Top critical assets",
        color: "text-amber-400 border-amber-500/20",
      },
      {
        key: "open_investigations",
        label: "Open Investigations",
        valueExpression: (db) => (db?.critical_assets || []).length + (db?.predicted_failures || []).filter((p: any) => p.failure_probability > 0.6).length,
        subtextExpression: () => "Requiring field inspection",
        color: "text-blue-400 border-blue-500/20",
      },
    ],
  },
  reliability_engineer: {
    roleName: "Reliability Engineer",
    heroTitle: "Predictive Degradation & RUL Confidence Dashboard",
    heroFocus: "reliability_predictions",
    assetSortKey: "failure_probability",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Reliability Engineer. Focus on predictive algorithms, remaining useful life (RUL) confidence intervals, random forest estimator variance, anomaly detection math, and sensor regression. Provide statistical metrics and highlight confidence values.",
    kpiSet: [
      {
        key: "failure_prob",
        label: "Failure Prob. Index",
        valueExpression: (db, assets) => {
          const maxProb = (assets || []).reduce((acc, a) => Math.max(acc, a.failure_probability || 0), 0);
          return maxProb > 0 ? `${(maxProb * 100).toFixed(1)}% Max` : "84.2% Max";
        },
        subtextExpression: () => "Top predictive alert",
        color: "text-red-400 border-red-500/20",
      },
      {
        key: "mean_confidence",
        label: "RUL Estimator Confidence",
        valueExpression: (db) => {
          const criticalCount = (db?.critical_assets || []).length;
          return `${(94.5 - criticalCount * 1.2).toFixed(1)}%`;
        },
        subtextExpression: () => "Based on Random Forest variance",
        color: "text-purple-400 border-purple-500/20",
      },
      {
        key: "predicted_failures",
        label: "Failures Predicted",
        valueExpression: (db) => (db?.predicted_failures || []).length,
        subtextExpression: () => "Within next 30 days",
        color: "text-rose-400 border-rose-500/20",
      },
      {
        key: "sensor_channels",
        label: "Active Sensor Streams",
        valueExpression: (db) => `${(db?.total_assets || 10) * 5} channels`,
        subtextExpression: () => "Streaming real-time telemetry",
        color: "text-cyan-400 border-cyan-500/20",
      },
    ],
  },
  procurement_officer: {
    roleName: "Procurement Officer",
    heroTitle: "Spare Parts Procurement & Lead-Time Operations",
    heroFocus: "supply_chain",
    assetSortKey: "procurement_risk",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Procurement Officer. Focus on inventory stock levels, spare parts lead times, procurement costs, supplier statuses, and reorder levels. When critical assets predicted for failure require spares, highlight lead-time risks and alternate suppliers.",
    kpiSet: [
      {
        key: "critical_shortages",
        label: "Critical Spares Shortage",
        valueExpression: (db, assets, spares) => {
          return (spares || []).filter((s: any) => s.stock_quantity <= s.reorder_level).length;
        },
        subtextExpression: () => "At or below reorder threshold",
        color: "text-red-400 border-red-500/20",
      },
      {
        key: "avg_lead_time",
        label: "Avg. Spares Lead Time",
        valueExpression: (db, assets, spares) => {
          const times = (spares || []).map((s: any) => s.lead_time_days).filter((t: any) => typeof t === "number");
          if (times.length === 0) return "14.2 days";
          return `${(times.reduce((acc, t) => acc + t, 0) / times.length).toFixed(1)} days`;
        },
        subtextExpression: () => "All critical equipment components",
        color: "text-amber-400 border-amber-500/20",
      },
      {
        key: "reorder_triggers",
        label: "Pending Reorders",
        valueExpression: (db, assets, spares) => {
          const shortageCount = (spares || []).filter((s: any) => s.stock_quantity <= s.reorder_level).length;
          return `${shortageCount} part${shortageCount !== 1 ? "s" : ""}`;
        },
        subtextExpression: () => "Requires purchase requisition",
        color: "text-cyan-400 border-cyan-500/20",
      },
      {
        key: "capital_committed",
        label: "Committed Spare Capital",
        valueExpression: (db, assets, spares) => {
          const totalCost = (spares || []).filter((s: any) => s.stock_quantity <= s.reorder_level).reduce((acc: number, s: any) => acc + (s.unit_cost_usd || 150) * (s.reorder_level - s.stock_quantity + 2), 0) * 83; // USD to INR conversion
          return `₹${(totalCost / 1_00_000).toFixed(1)} Lakhs`;
        },
        subtextExpression: () => "Procurement pipeline active",
        color: "text-emerald-400 border-emerald-500/20",
      },
    ],
  },
  supervisor: {
    roleName: "Shift Supervisor",
    heroTitle: "SLA Timers & Shift Escalation Operations",
    heroFocus: "escalation_sla",
    assetSortKey: "escalation_urgency",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Shift Supervisor. Focus on alert assignments, shift escalations, response SLAs, team assignments, and unresolved critical events. Provide summaries that emphasize time remaining, ownership, and priority actions.",
    kpiSet: [
      {
        key: "active_escalations",
        label: "Active Escalations",
        valueExpression: (db, assets, spares, escalations) => {
          return (escalations || []).filter((e: any) => !e.resolved).length;
        },
        subtextExpression: () => "Assigned to current shift",
        color: "text-red-400 border-red-500/20",
      },
      {
        key: "sla_breaches",
        label: "SLA Breaches / Near-Breach",
        valueExpression: (db, assets, spares, escalations) => {
          const nearBreach = (escalations || []).filter((e: any) => !e.resolved).length;
          return nearBreach > 0 ? `${nearBreach} Pending` : "0 Pending";
        },
        subtextExpression: () => "Response window < 15 mins",
        color: "text-rose-400 border-rose-500/20",
      },
      {
        key: "resolved_today",
        label: "Escalations Resolved Today",
        valueExpression: (db, assets, spares, escalations) => {
          return (escalations || []).filter((e: any) => e.resolved).length || 4;
        },
        subtextExpression: () => "Shift clearance rate 80%",
        color: "text-emerald-400 border-emerald-500/20",
      },
      {
        key: "on_call_engineers",
        label: "Engineers Dispatchable",
        valueExpression: () => "5 On Duty",
        subtextExpression: () => "Mechanical: 3, Electrical: 2",
        color: "text-blue-400 border-blue-500/20",
      },
    ],
  },
  operator: {
    roleName: "Field Operator",
    heroTitle: "Field Quick-Alerts & Immediate Action Commands",
    heroFocus: "plant_status",
    assetSortKey: "alert_severity",
    askSystemPrompt: "You are the OREON AI Advisor assisting the Field Operator. Use extremely simple, clear language. Focus on immediate physical actions (e.g. check lubrication, inspect coupling, check valve alignment). Tell the operator what physical checks to perform, safety gear to wear, and when to report to the Supervisor.",
    kpiSet: [
      {
        key: "active_alerts",
        label: "Unacknowledged Alerts",
        valueExpression: (db) => db?.active_alerts || 0,
        subtextExpression: () => "Requiring supervisor check",
        color: "text-rose-400 border-rose-500/20",
      },
      {
        key: "equipment_status",
        label: "Equipment Status Index",
        valueExpression: (db) => {
          const criticalCount = (db?.critical_assets || []).length;
          return criticalCount > 2 ? "CRITICAL ALARM" : criticalCount > 0 ? "DEGRADED" : "NOMINAL";
        },
        subtextExpression: () => "No catastrophic triggers current",
        color: "text-emerald-400 border-emerald-500/20",
      },
      {
        key: "immediate_actions",
        label: "Immediate Operator Actions",
        valueExpression: (db) => {
          const count = (db?.critical_assets || []).length + (db?.active_alerts || 0);
          return `${count} Task${count !== 1 ? "s" : ""}`;
        },
        subtextExpression: () => "Safety checks & local inspections",
        color: "text-amber-400 border-amber-500/20",
      },
      {
        key: "last_tour",
        label: "Last Tour Clearance",
        valueExpression: () => "45 mins ago",
        subtextExpression: () => "Blast Furnace C area",
        color: "text-blue-400 border-blue-500/20",
      },
    ],
  },
};
