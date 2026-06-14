import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { ArrowRight, ArrowUpRight, Sparkles, CheckSquare, Clock, AlertTriangle, Search, Zap, Shield, Brain, TrendingUp, CheckCircle } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart, ReferenceLine, BarChart, Bar, Legend } from "recharts";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { useDashboard, useIncidents, useAlerts, useActiveRole, useEscalations, useReadAlert, useResolveEscalation, useRoleConfig, useSpares, useAssets, useBusinessRisks, useSentinelStatus, useSentinelStats, useSentinelTimeline } from "@/lib/api/hooks";
import { useSensorStream } from "@/lib/api/use-sensor-stream";
import { ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";

export const Route = createFileRoute("/command")({
  head: () => ({ meta: [{ title: "Command Center — OREON" }, { name: "description", content: "Plant-wide operational intelligence." }] }),
  component: Command,
});

// Synthetic fallback traces
const healthSeriesFallback = Array.from({ length: 48 }, (_, i) => ({
  t: i,
  health: 72 + Math.sin(i / 4) * 4 + (i > 36 ? 2 : 0),
  risk: 28 + Math.cos(i / 5) * 6,
}));

const vibrationSeriesFallback = Array.from({ length: 60 }, (_, i) => {
  const base = 6 + Math.sin(i / 3) * 0.6 + Math.cos(i / 7) * 0.5;
  const spike = i > 40 ? (i - 40) * 0.18 : 0;
  return { t: i, v: +(base + spike).toFixed(2) };
});

const sparesData = [
  { name: "Bearings", v: 38 },
  { name: "Seals", v: 22 },
  { name: "Belts", v: 15 },
  { name: "Filters", v: 12 },
  { name: "Other", v: 13 },
];
const SPARE_COLORS = [
  "oklch(0.80 0.14 200)",
  "oklch(0.72 0.15 295)",
  "oklch(0.62 0.12 200)",
  "oklch(0.50 0.10 200)",
  "oklch(0.78 0.16 75)",
];

function makeSpark(seed: number, trend: number) {
  return Array.from({ length: 24 }, (_, i) => ({
    i,
    v: 50 + Math.sin((i + seed) / 2.4) * 6 + (i / 23) * trend,
  }));
}

function CountUp({ value, decimals = 0, prefix, suffix }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const mv = useMotionValue(0);
  const [shown, setShown] = useState("0");
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(v.toFixed(decimals)),
    });
    return controls.stop;
  }, [value, decimals]);
  useTransform(mv, (v) => v);
  return (
    <span>
      {prefix && <span className="text-foreground mr-0.5">{prefix}</span>}
      {shown}
      {suffix && <span className="text-text-muted text-[18px] ml-0.5">{suffix}</span>}
    </span>
  );
}

function Kpi({
  label,
  value,
  decimals = 0,
  prefix,
  suffix,
  spark,
  tone = "cyan",
  trend,
}: {
  label: string;
  value: number | string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  spark: { i: number; v: number }[];
  tone?: string;
  trend?: string;
}) {
  let toneVar = "var(--accent-cyan)";
  if (tone?.includes("crit") || tone?.includes("red")) toneVar = "var(--state-crit)";
  else if (tone?.includes("warn") || tone?.includes("amber")) toneVar = "var(--state-warn)";
  else if (tone?.includes("ok") || tone?.includes("emerald")) toneVar = "var(--state-ok)";
  else if (tone?.includes("purple")) toneVar = "oklch(0.65 0.2 295)";
  else if (tone?.includes("cyan") || tone?.includes("blue")) toneVar = "var(--accent-cyan)";

  return (
    <div className="card-flat py-4 px-5 group hover:border-text-muted/40 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="label">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3 mb-1.5">
        <div className="font-mono text-[26px] lg:text-[30px] leading-none tracking-tight" style={{ color: toneVar }}>
          {typeof value === "number" ? (
            <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
          ) : (
            <span>{value}</span>
          )}
        </div>
        <div className="w-[70px] h-[26px] -mb-1">
          {/* Fixed-size chart (no ResponsiveContainer) — avoids the recharts
              width(-1)/height(-1) warning that fires during layout/resize. */}
          <LineChart width={70} height={26} data={spark}>
            <Line type="monotone" dataKey="v" stroke={toneVar} strokeWidth={1.5} dot={false} />
          </LineChart>
        </div>
      </div>
      <div className="font-mono text-[10px] text-text-muted truncate">
        {trend}
      </div>
    </div>
  );
}

const TOOLTIP_STYLE = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontFamily: "JetBrains Mono",
  fontSize: 11,
  padding: "6px 10px",
  color: "var(--color-foreground)",
};

function severityTone(sev: string): "crit" | "warn" | "ok" {
  const s = sev.toLowerCase();
  if (s.includes("crit") || s.includes("high")) return "crit";
  if (s.includes("med") || s.includes("warn")) return "warn";
  return "ok";
}

/** Human-friendly relative time, e.g. "just now", "14 min ago", "3h ago". */
function relativeTime(isoStr: string): string {
  const t = new Date(isoStr).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type TaskPriority = "high" | "med" | "low";
interface MissionConfig {
  badge: string;
  badgeClass: string;
  focus: string;
  tasks: { label: string; priority: TaskPriority }[];
  actions: { label: string; to: string; search?: Record<string, string> }[];
}

function WorkflowStatus({ role }: { role: string }) {
  const configs: Record<string, MissionConfig> = {
    operator: {
      badge: "Field Operations",
      badgeClass: "text-ok bg-ok/10 border-ok/20",
      focus: "Active inspection round · 3 machines require in-person checks",
      tasks: [
        { label: "Shaft lubrication check — Motor_M12", priority: "high" },
        { label: "Cooling water pressure log — Pump_P3", priority: "high" },
        { label: "Gearbox oil sample extraction — Gearbox_G1", priority: "med" },
      ],
      actions: [{ label: "Open Logbook", to: "/logbook" }, { label: "View Alerts", to: "/alerts" }],
    },
    maintenance_engineer: {
      badge: "Maintenance Dispatch",
      badgeClass: "text-cyan bg-cyan/10 border-cyan/20",
      focus: "2 critical repairs pending · Gearbox_G1 is highest priority",
      tasks: [
        { label: "Gearbox_G1 — bearing inspection & work order creation", priority: "high" },
        { label: "Pump_P3 — impeller overhaul work order in progress", priority: "high" },
        { label: "CoolingSystem_C1 — vibration baseline re-calibration", priority: "med" },
      ],
      actions: [{ label: "Investigations", to: "/investigations" }, { label: "Digital Twin", to: "/twin" }],
    },
    reliability_engineer: {
      badge: "Reliability Analysis",
      badgeClass: "text-violet bg-violet/10 border-violet/20",
      focus: "Gearbox_G1 RUL at 14d · ML confidence interval narrowed",
      tasks: [
        { label: "Review Gearbox_G1 Random Forest CI — 14d RUL estimate", priority: "high" },
        { label: "Validate CoolingSystem_C1 vibration sensor drift pattern", priority: "med" },
        { label: "Update degradation curve post-maintenance for Pump_P3", priority: "low" },
      ],
      actions: [{ label: "Digital Twin", to: "/twin" }, { label: "Investigate", to: "/investigations" }],
    },
    supervisor: {
      badge: "Shift Control",
      badgeClass: "text-warn bg-warn/10 border-warn/20",
      focus: "1 unresolved escalation · 3 alerts pending sign-off",
      tasks: [
        { label: "Acknowledge Gearbox_G1 critical escalation — Team 3", priority: "high" },
        { label: "Dispatch maintenance crew to Pump_P3 repair zone", priority: "high" },
        { label: "Review shift logs and field operator reports", priority: "med" },
      ],
      actions: [{ label: "War Room", to: "/warroom" }, { label: "View Alerts", to: "/alerts" }],
    },
    procurement_officer: {
      badge: "Supply Chain",
      badgeClass: "text-amber-400 bg-amber-400/10 border-amber-400/20",
      focus: "3 parts below reorder level · Gearbox bearing blocks critical",
      tasks: [
        { label: "Issue PO for Gearbox_G1 bearing block — SKF India", priority: "high" },
        { label: "Confirm pump seal delivery timeline — Flowserve", priority: "med" },
        { label: "Review Siemens AG lead time for gear set replacement", priority: "low" },
      ],
      actions: [{ label: "Procurement", to: "/procurement" }, { label: "View Assets", to: "/assets" }],
    },
    plant_manager: {
      badge: "Executive Review",
      badgeClass: "text-red-400 bg-red-400/10 border-red-400/20",
      focus: "₹4.2Cr revenue exposure · Budget approval required for Gearbox_G1",
      tasks: [
        { label: "Approve Gearbox_G1 repair budget — ₹1.85L (critical path)", priority: "high" },
        { label: "Review PL-3 downtime risk report — production impact", priority: "high" },
        { label: "Sign off on escalation resolution — Supervisor Team 3", priority: "med" },
      ],
      actions: [{ label: "Business Impact", to: "/decisions", search: { tab: "business-impact" } }, { label: "War Room", to: "/warroom" }],
    },
  };

  const c = configs[role] ?? configs.operator;
  const priorityLabel: Record<TaskPriority, string> = { high: "Urgent", med: "This shift", low: "Scheduled" };
  const priorityClass: Record<TaskPriority, string> = {
    high: "border-red-500/40 text-red-400 bg-red-500/8",
    med: "border-amber-400/40 text-amber-400 bg-amber-400/8",
    low: "border-border text-text-muted bg-surface-2",
  };
  const labelClass: Record<TaskPriority, string> = { high: "text-red-400", med: "text-amber-400", low: "text-text-muted" };

  return (
    <div className="card-flat overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`font-mono text-[9px] uppercase tracking-[0.12em] px-2.5 py-0.5 rounded-full border shrink-0 ${c.badgeClass}`}>{c.badge}</span>
          <span className="font-mono text-[11px] text-text-secondary truncate">{c.focus}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.actions.map((a) => (
            <Link key={a.to + JSON.stringify(a.search)} to={a.to as any} search={a.search as any}
              className="font-mono text-[10px] h-6 px-2.5 border border-border rounded text-text-secondary hover:text-foreground hover:bg-surface-2 transition-colors inline-flex items-center">
              {a.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {c.tasks.map((task, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={`size-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 font-mono text-[9px] font-bold ${priorityClass[task.priority]}`}>
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11.5px] text-foreground leading-snug">{task.label}</p>
              <span className={`font-mono text-[9px] uppercase tracking-wide ${labelClass[task.priority]}`}>{priorityLabel[task.priority]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SENTINEL_ICON: Record<string, typeof AlertTriangle> = {
  anomaly_detected: AlertTriangle,
  investigation_started: Search,
  alert_created: Zap,
  escalation_created: Shield,
  maintenance_plan_generated: CheckCircle,
  rca_completed: Brain,
  rul_predicted: TrendingUp,
};
const SENTINEL_COLOR: Record<string, string> = {
  anomaly_detected: "#f59e0b",
  investigation_started: "#22d3ee",
  alert_created: "#ef4444",
  escalation_created: "#8b5cf6",
  maintenance_plan_generated: "#10b981",
  rca_completed: "#22d3ee",
  rul_predicted: "#22d3ee",
};

function SentinelPanel() {
  const statusQ = useSentinelStatus();
  const statsQ = useSentinelStats();
  // Use the timeline endpoint — it already excludes health_check on the backend and
  // returns only the real events (anomaly/alert/RCA/escalation/plan), newest first.
  const timelineQ = useSentinelTimeline(20);

  // SentinelStatus has anomalies_detected, investigations_created, alerts_generated, scan_count
  const s = statusQ.data ?? ({} as any);
  // SentinelStats has by_type record (activity_type → count)
  const byType: Record<string, number> = (statsQ.data as any)?.by_type ?? {};
  // Timeline events use {type, time, summary, asset_id} — map to the panel's shape.
  const recentActs: any[] = ((timelineQ.data as any[]) ?? [])
    .filter((e: any) => e.type !== "health_check")
    .slice(0, 5)
    .map((e: any) => ({ activity_type: e.type, asset_id: e.asset_id, summary: e.summary, timestamp: e.time }));

  const sentinelStats = [
    { label: "Anomalies Detected", value: s.anomalies_detected ?? "—", color: "text-amber-signal" },
    { label: "RUL Predictions", value: byType["rul_predicted"] ?? "—", color: "text-cyan" },
    { label: "Investigations", value: s.investigations_created ?? "—", color: "text-violet" },
    { label: "Assets Monitored", value: s.assets_monitored ?? "—", color: "text-green-signal" },
  ];

  return (
    <div className="card-flat overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">Sentinel Intelligence</span>
          {s.running && (
            <span className="font-mono text-[9px] text-text-muted border border-border px-2 py-0.5 rounded-full">
              {s.scan_count ?? 0} scans
            </span>
          )}
        </div>
        <Link to="/sentinel" className="font-mono text-[10px] text-cyan hover:underline inline-flex items-center gap-1">
          Full analysis <ArrowUpRight className="size-3" strokeWidth={1.75} />
        </Link>
      </div>

      <div className="grid grid-cols-12 divide-x divide-border">
        {/* Left side: Sentinel stats styled as high-fidelity telemetry grid */}
        <div className="col-span-12 lg:col-span-3 p-4 space-y-2.5">
          {sentinelStats.map(({ label, value, color }) => {
            let textClass = "text-cyan";
            let Icon = Brain;
            
            if (color.includes("amber")) {
              textClass = "text-amber-signal";
              Icon = AlertTriangle;
            } else if (color.includes("violet")) {
              textClass = "text-violet";
              Icon = Search;
            } else if (color.includes("green")) {
              textClass = "text-green-signal";
              Icon = Shield;
            }
            
            return (
              <div 
                key={label} 
                className="rounded-md border border-border bg-surface-2/40 p-3.5 flex flex-col justify-between min-h-[64px] transition-colors hover:bg-surface-1"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="font-mono text-[10px] text-text-muted uppercase tracking-wider font-medium pr-2">
                    {label}
                  </div>
                  <Icon className={`size-3.5 opacity-70 shrink-0 ${textClass}`} />
                </div>
                <div className={`font-mono text-[22px] font-semibold tabular-nums leading-none ${textClass}`}>
                  {value}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right side: Sentinel scans list styled as structured log entries */}
        <div className="col-span-12 lg:col-span-9 p-4">
          {recentActs.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-text-muted font-mono text-[11px] justify-center border border-dashed border-border rounded">
              <span className="size-1.5 rounded-full bg-text-muted animate-pulse" />
              Sentinel scanning plant systems…
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
              {recentActs.map((act: any, i: number) => {
                const Icon = SENTINEL_ICON[act.activity_type] ?? AlertTriangle;
                const color = SENTINEL_COLOR[act.activity_type] ?? "#6b7280";
                
                // Map local color hex codes to match tailwind variables if possible
                let toneColor = color;
                if (color === "#f59e0b") toneColor = "var(--state-warn)";
                else if (color === "#22d3ee") toneColor = "var(--accent-cyan)";
                else if (color === "#ef4444") toneColor = "var(--state-crit)";
                else if (color === "#8b5cf6") toneColor = "var(--color-primary)"; // violet
                else if (color === "#10b981") toneColor = "var(--state-ok)";

                const assetLabel = act.asset_id ? (ASSET_DISPLAY_NAMES[act.asset_id as keyof typeof ASSET_DISPLAY_NAMES] ?? act.asset_id) : null;
                
                return (
                  <div key={i} className="p-3 bg-surface-2/30 border border-border/30 rounded-lg hover:border-border/60 hover:bg-surface-2/50 transition-all duration-200 flex items-start gap-3">
                    <div className="size-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: `${toneColor}15`, border: `1px solid ${toneColor}30` }}>
                      <Icon className="size-3.5" style={{ color: toneColor }} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border"
                          style={{ backgroundColor: `${toneColor}15`, color: toneColor, borderColor: `${toneColor}30` }}>
                          {act.activity_type.replace(/_/g, " ")}
                        </span>
                        {assetLabel && (
                          <span className="font-mono text-[10px] text-cyan bg-cyan/5 border border-cyan/20 px-1.5 py-0.5 rounded font-medium">
                            {assetLabel}
                          </span>
                        )}
                      </div>
                      {act.summary && (
                        <p className="text-[11px] text-text-secondary leading-snug mt-1.5">{act.summary}</p>
                      )}
                    </div>
                    <div className="flex items-center font-mono text-[10px] text-text-muted shrink-0 pt-0.5">
                      <Clock className="size-3 mr-1" strokeWidth={1.5} />
                      {act.timestamp}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Command() {
  const [activeRole] = useActiveRole();
  const roleConfig = useRoleConfig();
  
  // Real-time sensor stream connection
  const { getAssetHistory, getAssetLatest, isConnected } = useSensorStream();

  const alertsQuery = useAlerts({ role: activeRole });
  const escalationsQuery = useEscalations();
  const sparesQuery = useSpares();
  const readAlertMutation = useReadAlert();
  const resolveEscalationMutation = useResolveEscalation();
  const dashboard = useDashboard();
  const incidents = useIncidents();
  const assetsQuery = useAssets();
  const businessRisksQuery = useBusinessRisks();
  
  const rawAssets = assetsQuery.data ?? [];
  const businessRisks = businessRisksQuery.data ?? [];

  const assetNames = useMemo(() => {
    const map: Record<string, string> = {};
    rawAssets.forEach((a: any) => {
      map[a.id] = a.name;
    });
    return map;
  }, [rawAssets]);
  
  const d = dashboard.data;
  const critical = d?.critical_assets.length ?? 0;
  const plantHealth = Math.round(d?.avg_plant_health ?? 0);
  const predicted = d?.predicted_failures ?? [];
  const spares = sparesQuery.data ?? [];
  const escalations = escalationsQuery.data?.active ?? [];

  const top = useMemo(() => {
    let bestObj: any = predicted[0] || null;
    
    if (activeRole === "plant_manager" && businessRisks.length > 0) {
      const sorted = [...businessRisks].sort((a, b) => (b.revenue_exposure_inr || 0) - (a.revenue_exposure_inr || 0));
      bestObj = predicted.find((p: any) => p.asset_id === sorted[0].asset_id) || { ...bestObj, asset_id: sorted[0].asset_id };
    } else if (activeRole === "maintenance_engineer" && rawAssets.length > 0) {
      const sorted = [...rawAssets].sort((a, b) => (a.rul_days || 999) - (b.rul_days || 999));
      bestObj = predicted.find((p: any) => p.asset_id === sorted[0].id) || { ...bestObj, asset_id: sorted[0].id };
    } else if (activeRole === "supervisor" && escalations.length > 0) {
      const unresolved = escalations.filter((e: any) => !e.resolved);
      if (unresolved.length > 0) {
        bestObj = predicted.find((p: any) => p.asset_id === unresolved[0].asset_id) || { ...bestObj, asset_id: unresolved[0].asset_id };
      }
    } else if (activeRole === "procurement_officer" && spares.length > 0) {
      const risky = spares.filter((s: any) => s.stock_quantity <= s.reorder_level).sort((a: any, b: any) => (b.lead_time_days || 0) - (a.lead_time_days || 0));
      if (risky.length > 0 && risky[0].compatible_assets) {
        const assetsList = String(risky[0].compatible_assets).split(",").map((s) => s.trim()).filter(Boolean);
        if (assetsList.length > 0) {
          bestObj = predicted.find((p: any) => p.asset_id === assetsList[0]) || { ...bestObj, asset_id: assetsList[0] };
        }
      }
    } else if (predicted.length > 0) {
      const sorted = [...predicted].sort((a: any, b: any) => (b.failure_probability || 0) - (a.failure_probability || 0));
      bestObj = sorted[0];
    }
    return bestObj;
  }, [activeRole, businessRisks, rawAssets, escalations, spares, predicted]);

  const lineExposureData = useMemo(() => {
    if (businessRisks.length === 0) {
      return [
        { line: "PL-1", cost: 45.8 },
        { line: "PL-2", cost: 28.5 },
        { line: "PL-3", cost: 15.2 }
      ];
    }
    const lines: Record<string, number> = {};
    businessRisks.forEach((r) => {
      const pl = r.production_line || "Other";
      lines[pl] = (lines[pl] || 0) + (r.revenue_exposure_inr || 0) / 1_00_000; // in Lakhs
    });
    return Object.entries(lines).map(([line, cost]) => ({
      line,
      cost: parseFloat(cost.toFixed(1)),
    }));
  }, [businessRisks]);

  const recent = (incidents.data ?? []).slice(0, 10).map((inc) => ({
    time: new Date(inc.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    asset: inc.asset_id,
    assetName: assetNames[inc.asset_id] || inc.asset_id,
    diag: inc.root_cause,
    downtime: inc.downtime_hours,
    status: inc.severity,
    tone: severityTone(inc.severity),
  }));

  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const askInChat = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setQ("");
    navigate({ to: "/app/ask", search: { q: t } });
  };

  // Live telemetry for top asset vibration chart
  const vibrationSeries = useMemo(() => {
    const liveHistory = getAssetHistory(top?.asset_id || "Motor_M12");
    if (liveHistory && liveHistory.length > 5) {
      return liveHistory.map((reading, idx) => ({
        t: idx * 3,
        v: reading.vibration
      }));
    }
    return vibrationSeriesFallback;
  }, [top, getAssetHistory]);

  // Live telemetry for plant health chart
  const healthSeries = useMemo(() => {
    // Average health across all live streaming history
    const allHistoryKeys = Array.from(latestByAssetKeySet());
    if (allHistoryKeys.length > 0) {
      const sampleHistory = getAssetHistory(allHistoryKeys[0]);
      if (sampleHistory && sampleHistory.length > 5) {
        return sampleHistory.map((_, timeIdx) => {
          let sumHealth = 0;
          let count = 0;
          allHistoryKeys.forEach((assetId) => {
            const hist = getAssetHistory(assetId);
            if (hist && hist[timeIdx]) {
              sumHealth += hist[timeIdx].health_score;
              count++;
            }
          });
          const avgH = count > 0 ? sumHealth / count : 84.5;
          return { t: timeIdx, health: avgH, risk: 100 - avgH };
        });
      }
    }
    return healthSeriesFallback;
  }, [getAssetHistory]);

  function latestByAssetKeySet() {
    const set = new Set<string>();
    predicted.slice(0, 3).forEach((p) => set.add(p.asset_id));
    return set;
  }

  // Authorize/PO Expedite mock action trigger
  const [authorized, setAuthorized] = useState(false);
  const triggerAuthorize = () => {
    setAuthorized(true);
    setTimeout(() => setAuthorized(false), 3000);
  };

  // Render role-specific hero card layouts
  const renderHeroContent = () => {
    const topAssetId = top?.asset_id || "Motor_M12";
    const topAssetDisplayName = assetNames[topAssetId] || top?.asset_name || "Main Rolling Mill Drive";
    const recommendedAction = top?.recommended_action || "Perform immediate local vibration inspection.";
    const rulDays = top?.rul_days || 12;

    const topRiskAsset = businessRisks.find(r => r.asset_id === topAssetId) || businessRisks[0];
    const totalExposureInr = businessRisks.reduce((acc, r) => acc + (r.revenue_exposure_inr || 0), 0);
    const totalExposureCrStr = totalExposureInr > 0 ? `₹${(totalExposureInr / 1_00_00_000).toFixed(2)} Cr` : "₹4.20 Cr";
    const downtimeCostVal = topRiskAsset?.cost_of_inaction_inr ? `₹${(topRiskAsset.cost_of_inaction_inr / 1_00_000).toFixed(1)}L` : "₹3.5L";
    const productionLineStr = topRiskAsset?.production_line || "PL-1";
    const repairCostVal = topRiskAsset?.cost_of_action_inr ? `₹${(topRiskAsset.cost_of_action_inr / 1_00_000).toFixed(2)}L` : "₹1.85L";
    const delayRiskVal = top ? `+${Math.round(top.failure_probability * 105)}%` : "+84%";

    switch (roleConfig.heroFocus) {
      case "plant_risk":
        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[280px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-red-500/15 border border-red-500/30 font-mono text-[10px] text-red-400 uppercase font-semibold">
                    Cost Exposure & Risk
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Financial exposure</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-4">{topAssetId}</div>
                <div className="font-mono text-[13px] leading-[1.6] max-w-[45ch] mb-8 text-text-secondary border-l-2 border-crit/40 pl-3">
                  <span className="text-foreground font-semibold">Immediate Action Required:</span> {totalExposureCrStr} Total Revenue Exposure due to {topAssetDisplayName} potential line outage. Downtime cost is {downtimeCostVal}/hour.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={triggerAuthorize}
                  className={`inline-flex items-center gap-2 h-9 px-4 font-mono text-[11px] uppercase tracking-widest transition-all border ${authorized ? "border-ok text-ok bg-ok/10" : "border-crit text-crit bg-crit/10 hover:bg-crit/15"}`}
                >
                  {authorized ? "Expenditure Approved ✓" : "Authorize Repair Budget"}
                </button>
                <Link
                  to="/decisions"
                  className="inline-flex items-center gap-2 h-9 px-4 border border-border font-mono text-[11px] uppercase tracking-widest text-text-secondary hover:text-foreground hover:bg-surface-1 transition-colors"
                >
                  Scenario Analysis
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative flex flex-col justify-center">
              <div className="label mb-2">Revenue Exposure by Line · ₹ Lakhs</div>
              <div className="h-[170px]">
                <ResponsiveContainer>
                  <BarChart data={lineExposureData} margin={{ left: -16 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="line" stroke="var(--color-text-muted)" fontSize={9} tickLine={false} />
                    <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255, 255, 255, 0.04)" }} />
                    <Bar dataKey="cost" fill="var(--state-crit)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );

      case "maintenance_repair":
        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[280px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-cyan/15 border border-cyan/30 font-mono text-[10px] text-cyan uppercase font-semibold">
                    Maintenance Dispatch
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Top repair priority</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-4">{topAssetId}</div>
                <div className="font-mono text-[13px] leading-[1.6] max-w-[45ch] mb-8 text-text-secondary border-l-2 border-cyan/40 pl-3">
                  <span className="text-foreground font-semibold">Critical Maintenance:</span> {recommendedAction} Asset RUL is critically low ({rulDays} days).
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/assets/$id"
                  params={{ id: topAssetId }}
                  className="inline-flex items-center gap-2 h-9 px-4 border border-cyan font-mono text-[11px] uppercase tracking-widest text-cyan bg-cyan/10 hover:bg-cyan/15 transition-colors"
                >
                  View action plan
                  <ArrowRight className="size-3.5" strokeWidth={1.75} />
                </Link>
                <Link
                  to="/investigations"
                  className="inline-flex items-center gap-2 h-9 px-4 border border-border font-mono text-[11px] uppercase tracking-widest text-text-secondary hover:text-foreground hover:bg-surface-1 transition-colors"
                >
                  Open in Investigator
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative">
              <div className="label mb-2 flex items-center justify-between">
                <span>Vibration · last 60 min · mm/s</span>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer>
                  <AreaChart data={vibrationSeries} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="vibArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--state-crit)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--state-crit)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="t" stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} domain={[2, 12]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--color-border)", strokeDasharray: "2 2" }} />
                    <ReferenceLine y={9} stroke="var(--state-crit)" strokeDasharray="4 4" strokeWidth={1}
                      label={{ value: "threshold 9.0", position: "right", fill: "var(--state-crit)", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                    <Area type="monotone" dataKey="v" stroke="var(--state-crit)" fill="url(#vibArea)" strokeWidth={1.75} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );

      case "reliability_predictions":
        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[280px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-purple-500/15 border border-purple-500/30 font-mono text-[10px] text-purple-400 uppercase font-semibold">
                    Reliability Forecaster
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">ML degradation modeling</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-4">{topAssetId}</div>
                <div className="font-mono text-[13px] leading-[1.6] max-w-[45ch] mb-8 text-text-secondary border-l-2 border-purple-500/40 pl-3">
                  <span className="text-foreground font-semibold">Degradation Detected:</span> RUL predicted at {rulDays} days due to HF vibration 3.2kHz drift. 80% CI: {Math.max(1, rulDays - 3)}–{rulDays + 3} days.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/twin"
                  className="inline-flex items-center gap-2 h-9 px-4 border border-purple-500/60 font-mono text-[11px] uppercase tracking-widest text-purple-400 bg-purple-500/10 hover:bg-purple-500/15 transition-colors"
                >
                  View digital twin
                  <ArrowRight className="size-3.5" />
                </Link>
                <Link
                  to="/assets/$id"
                  params={{ id: topAssetId }}
                  className="inline-flex items-center gap-2 h-9 px-4 border border-border font-mono text-[11px] uppercase tracking-widest text-text-secondary hover:text-foreground hover:bg-surface-1 transition-colors"
                >
                  Telemetry breakdown
                </Link>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative">
              <div className="label mb-2">Degradation Curve & Confidence Interval</div>
              <div className="h-[180px]">
                <ResponsiveContainer>
                  <LineChart data={Array.from({ length: 15 }, (_, i) => {
                    const days = i * 2;
                    const h = 95 - (days * days * 0.22);
                    return {
                      days,
                      health: Math.max(10, Math.round(h)),
                      lower: Math.max(5, Math.round(h - 8)),
                      upper: Math.min(100, Math.round(h + 6))
                    };
                  })} margin={{ left: -16 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="days" label={{ value: "days", position: "insideBottomRight", offset: -5, fontSize: 9, fill: "var(--color-text-muted)" }} stroke="var(--color-text-muted)" fontSize={10} tickLine={false} />
                    <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--color-border)", strokeDasharray: "2 2" }} />
                    <ReferenceLine x={rulDays} stroke="var(--state-warn)" strokeDasharray="3 3" label={{ value: "RUL", position: "top", fill: "var(--state-warn)", fontSize: 10 }} />
                    <Line type="monotone" dataKey="health" stroke="var(--state-ai)" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="lower" stroke="var(--color-border)" strokeDasharray="2 2" dot={false} />
                    <Line type="monotone" dataKey="upper" stroke="var(--color-border)" strokeDasharray="2 2" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );

      case "supply_chain": {
        const compatSpare = spares.find((s: any) => s.compatible_assets?.includes(topAssetId)) || spares[0];
        const spareSku = compatSpare?.part_id || `${topAssetId}-B08`;
        const spareName = compatSpare?.part_name || "Replacement Spares";
        const leadTimeDays = compatSpare?.lead_time_days || 14;
        const stockQty = compatSpare?.stock_quantity ?? 0;
        const reorderLevel = compatSpare?.reorder_level ?? 2;

        const deliveryGap = leadTimeDays - rulDays;
        const maxDays = Math.max(rulDays, leadTimeDays);
        const failurePct = Math.min(100, Math.max(0, (rulDays / maxDays) * 100));
        const leadTimePct = Math.min(100, Math.max(0, (leadTimeDays / maxDays) * 100));
        const isVulnerable = deliveryGap > 0;

        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[280px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-warn/15 border border-warn/30 font-mono text-[10px] text-warn uppercase font-semibold">
                    Supply Chain Risk
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Parts stock shortage alert</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-4">{topAssetId}</div>
                <div className="font-mono text-[13px] leading-[1.6] max-w-xl mb-8 text-text-secondary border-l-2 border-warn/40 pl-3">
                  <span className="text-foreground font-semibold">Supply Vulnerability:</span> {isVulnerable
                    ? <>SKU: {spareSku} ({spareName}) is at <span className="text-crit font-bold">LOW STOCK ({stockQty})</span> with a delivery gap of <span className="text-warn font-bold">{deliveryGap} days</span>.</>
                    : <>SKU: {spareSku} ({spareName}) is at <span className="text-crit font-bold">LOW STOCK ({stockQty})</span>, but currently lead-time buffered.</>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={triggerAuthorize}
                  className={`inline-flex items-center gap-2 h-9 px-4 font-mono text-[11px] uppercase tracking-widest transition-all cursor-pointer border ${authorized ? "border-ok text-ok bg-ok/10" : "border-warn text-warn bg-warn/10 hover:bg-warn/15"}`}
                >
                  {authorized ? "Expedited PO Issued ✓" : "Expedite Purchase Order"}
                </button>
                <Link
                  to="/assets"
                  className="inline-flex items-center gap-2 h-9 px-4 border border-border font-mono text-[11px] uppercase tracking-widest text-text-secondary hover:text-foreground hover:bg-surface-1 transition-colors"
                >
                  View Spares Status
                </Link>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative flex flex-col justify-center">
              <div className="border border-border bg-surface-1">
                <div className="flex items-center justify-between px-4 h-9 border-b border-border">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">SC-01</span>
                  <span className="label">Timeline Overlap</span>
                </div>
                <div className="p-4 space-y-5">
                  {/* Row 1: Predicted Failure */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">PREDICTED FAILURE · {topAssetId}</span>
                      <span className="font-mono text-[11px] text-crit font-bold">{rulDays}d</span>
                    </div>
                    <div className="relative h-1.5 bg-background overflow-hidden border border-border/60">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${failurePct}%` }}
                        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full bg-crit"
                      />
                    </div>
                  </div>

                  {/* Row 2: Supplier Lead Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">SUPPLIER LEAD TIME</span>
                      <span className="font-mono text-[11px] text-warn font-bold">{leadTimeDays}d</span>
                    </div>
                    <div className="relative h-1.5 bg-background overflow-hidden border border-border/60">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${leadTimePct}%` }}
                        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full bg-warn"
                      />
                    </div>
                  </div>

                  {/* Status Indicator */}
                  {isVulnerable ? (
                    <div className="flex items-center gap-2 font-mono text-[10px] text-crit bg-crit/8 px-3 py-2 border border-crit/25 uppercase tracking-widest">
                      <span className="size-1.5 rounded-full bg-crit shrink-0" />
                      {deliveryGap}-DAY VULNERABILITY WINDOW
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 font-mono text-[10px] text-ok bg-ok/8 px-3 py-2 border border-ok/25 uppercase tracking-widest">
                      <span className="size-1.5 rounded-full bg-ok shrink-0" />
                      {Math.abs(deliveryGap)}-DAY BUFFER · SECURE
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      }

      case "escalation_sla":
        const activeEscalationsCount = escalations.filter((e: any) => !e.resolved).length;
        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[280px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-rose-500/15 border border-rose-500/30 font-mono text-[10px] text-rose-400 uppercase font-semibold">
                    Shift SLA Control
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Escalation active</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-4">{topAssetId}</div>
                <div className="font-mono text-[13px] leading-[1.6] max-w-[36ch] mb-8 text-text-secondary border-l-2 border-rose-500/40 pl-3">
                  <span className="text-foreground font-semibold">SLA Breach Risk:</span> Alarm escalated 45 mins ago and is currently unacknowledged. Only <span className="text-crit font-bold">24 minutes</span> remaining before shift response SLA breach.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={triggerAuthorize}
                  className={`inline-flex items-center gap-2 h-9 px-4 font-mono text-[11px] uppercase tracking-widest transition-all border ${authorized ? "border-ok text-ok bg-ok/10" : "border-rose-500/60 text-rose-400 bg-rose-500/10 hover:bg-rose-500/15"}`}
                >
                  {authorized ? "Radio Dispatch Sent ✓" : "Radio Dispatch Team 3"}
                </button>
                <button
                  onClick={() => {
                    const topEsc = escalations.find((e: any) => !e.resolved);
                    if (topEsc) resolveEscalationMutation.mutate(topEsc.id);
                  }}
                  disabled={resolveEscalationMutation.isPending || activeEscalationsCount === 0}
                  className="inline-flex items-center gap-2 h-9 px-4 border border-border font-mono text-[11px] uppercase tracking-widest text-text-secondary hover:text-foreground hover:bg-surface-1 transition-colors disabled:opacity-50"
                >
                  Acknowledge & Resolve
                </button>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative flex flex-col justify-center">
              <div className="flex items-center justify-between mb-3">
                <div className="label">Shift SLA Timers</div>
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted/70">Response window</span>
              </div>
              <div className="border border-border bg-surface-2/30 divide-y divide-border/60">
                {escalations.filter((e: any) => !e.resolved).slice(0, 3).map((esc: any, idx) => {
                  const isCritical = esc.escalation_level === "critical" || idx === 0;
                  const tone = isCritical ? "var(--state-crit)" : "var(--state-warn)";
                  const remainingPct = isCritical ? 14 : 78;
                  const timeLeft = isCritical ? "24m" : "3h 15m";
                  return (
                    <div key={esc.id} className="relative pl-4 pr-3.5 py-3">
                      <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ backgroundColor: tone }} />
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isCritical && (
                            <span className="size-1.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: tone }} />
                          )}
                          <span className="font-mono text-[11px] text-foreground truncate">
                            {assetNames[esc.asset_id] || esc.asset_id}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] tabular-nums font-semibold shrink-0" style={{ color: tone }}>
                          {timeLeft} <span className="text-text-muted font-normal">left</span>
                        </span>
                      </div>
                      <div className="h-[3px] w-full bg-background overflow-hidden">
                        <div className="h-full transition-all duration-500" style={{ width: `${remainingPct}%`, backgroundColor: tone, boxShadow: `0 0 8px ${tone}` }} />
                      </div>
                    </div>
                  );
                })}
                {activeEscalationsCount === 0 && (
                  <div className="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    No active shift SLA timers
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case "plant_status":
      default: {
        const oee = d?.avg_plant_health ? Math.round(d.avg_plant_health) : 84;
        const ringHex = oee >= 75 ? "#10b981" : oee >= 50 ? "#f59e0b" : "#ef4444";
        const ringLabel = oee >= 75 ? "Nominal" : oee >= 50 ? "Watch" : "Critical";
        const RING_C = 2 * Math.PI * 64;
        const topAssetRaw = rawAssets.find((a: any) => a.id === (top?.asset_id || "Motor_M12"));
        const liveLatest = getAssetLatest(top?.asset_id || "Motor_M12");
        const rawHealth = liveLatest?.health_score ?? topAssetRaw?.health_score ?? top?.health_score;
        const health = rawHealth != null ? Math.round(rawHealth) : null;
        const rul = top?.rul_days ?? topAssetRaw?.rul_days ?? null;
        const failPct = top?.failure_probability != null ? Math.round(top.failure_probability * 100) : (topAssetRaw?.failure_probability != null ? Math.round(topAssetRaw.failure_probability * 100) : null);
        const metrics = [
          { label: "Health", value: health != null ? `${health}%` : "—", tone: health == null ? "text-text-muted" : health < 50 ? "text-crit" : health < 75 ? "text-warn" : "text-ok" },
          { label: "RUL", value: rul != null ? `${rul}d` : "—", tone: rul == null ? "text-text-muted" : rul < 7 ? "text-crit" : rul < 14 ? "text-warn" : "text-cyan" },
          { label: "Fail risk", value: failPct != null ? `${failPct}%` : "—", tone: failPct == null ? "text-text-muted" : failPct > 60 ? "text-crit" : failPct > 40 ? "text-warn" : "text-ok" },
        ];
        return (
          <div className="grid grid-cols-12 gap-6 p-7 min-h-[300px]">
            <div className="col-span-12 lg:col-span-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 font-mono text-[10px] text-emerald-400 uppercase font-semibold">
                    Field Commands
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Operator guide</span>
                </div>
                <div className="font-mono text-[30px] leading-none mb-1 tracking-tight text-foreground">{topAssetDisplayName}</div>
                <div className="font-mono text-[14px] text-text-muted mb-5">{topAssetId}</div>

                {/* live asset metrics */}
                <div className="grid grid-cols-3 gap-2 max-w-[380px] mb-5">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-center">
                      <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted">{m.label}</div>
                      <div className={`font-mono text-[18px] font-semibold leading-none mt-1 ${m.tone}`}>{m.value}</div>
                    </div>
                  ))}
                </div>

                <div className="font-mono text-[13px] leading-[1.6] max-w-[40ch] mb-8 text-text-secondary border-l-2 border-ok/40 pl-3">
                  <span className="text-foreground font-semibold">Task Pending:</span> Verify lubrication and alignment at local station. Check coupling housing for heat or grinding.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/logbook"
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-ok/60 font-mono text-[11px] uppercase tracking-widest text-ok bg-ok/10 hover:bg-ok/15 transition-colors"
                >
                  Log Local Inspection
                  <CheckSquare className="size-3.5" />
                </Link>
                <button
                  onClick={triggerAuthorize}
                  className={`inline-flex items-center gap-2 h-9 px-4 rounded-md border font-mono text-[11px] uppercase tracking-widest transition-colors ${authorized ? "border-ok/40 text-ok bg-ok/8" : "border-border text-text-secondary hover:text-foreground hover:bg-surface-1"}`}
                >
                  {authorized ? "Supervisor Alerted ✓" : "Alert Supervisor"}
                </button>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 relative flex flex-col justify-center items-center">

              
              <div className="relative size-44">
                <svg viewBox="0 0 160 160" className="size-full -rotate-90">
                  {/* Track background */}
                  <circle cx="80" cy="80" r="72" fill="none" stroke="var(--color-surface-2)" strokeWidth="3" />
                  {/* Decorative dashed inner track */}
                  <circle cx="80" cy="80" r="63" fill="none" stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 4" opacity={0.6} />
                  
                  {/* Main Progress Indicator */}
                  <circle
                    cx="80" cy="80" r="72" fill="none" stroke={ringHex} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${(oee / 100) * (2 * Math.PI * 72)} ${2 * Math.PI * 72}`}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
                  <span className="font-mono text-[42px] font-bold leading-none tracking-tighter text-foreground">
                    {oee}<span className="text-[20px] text-text-muted ml-0.5 font-normal">%</span>
                  </span>
                  <span className="font-mono text-[9px] text-text-muted mt-2 tracking-[0.2em] uppercase">OEE Index</span>
                  <span
                    className="mt-3 font-mono text-[9px] px-3 py-1 rounded uppercase tracking-widest backdrop-blur-sm transition-colors"
                    style={{ color: ringHex, background: `${ringHex}15`, border: `1px solid ${ringHex}30` }}
                  >
                    {ringLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  const renderSections = () => {
    // 1. Plant health telemetry charts
    const chartsPanel = (
      <div key="charts" className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 card-flat">
          <PanelHeader label="Plant health · 48h" action={<span className="font-mono text-[10px] text-text-muted">Δt 30m</span>} />
          <div className="p-4 h-[280px]">
            <ResponsiveContainer>
              <AreaChart data={healthSeries} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gH" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--color-border)", strokeDasharray: "2 2" }} />
                <Area type="monotone" dataKey="health" stroke="var(--accent-cyan)" strokeWidth={1.75} fill="url(#gH)" />
                <ReferenceLine x={36} stroke="var(--state-crit)" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: top ? `${top.asset_id} anomaly` : "anomaly detected", position: "top", fill: "var(--state-crit)", fontSize: 10, fontFamily: "JetBrains Mono" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 card-flat flex flex-col">
          <PanelHeader label={activeRole === "maintenance_engineer" ? "Active SOP & Repair Guidelines" : "Spare mix"} action={<span className="font-mono text-[10px] text-text-muted">100 SKU</span>} />
          {activeRole === "maintenance_engineer" ? (
            <div className="p-4 flex-1 overflow-y-auto space-y-2.5 max-h-[280px]">
              {[
                { id: "SOP-MO-042", name: "Dynamic Shaft Alignment Protocol", difficulty: "Medium", time: "2.5h" },
                { id: "SOP-PU-018", name: "Centrifugal Pump Impeller Overhaul", difficulty: "High", time: "4.0h" },
                { id: "SOP-GE-089", name: "Flender Helical Gear Lube Flushing", difficulty: "Low", time: "1.5h" },
                { id: "SOP-BF-005", name: "Refractory Thermal Imaging Check", difficulty: "Low", time: "1.0h" },
                { id: "SOP-CO-024", name: "Raw Ore Conveyor Belt Splice Repair", difficulty: "High", time: "5.0h" },
              ].map((sop) => (
                <div key={sop.id} className="p-2.5 bg-surface-2/60 border border-border rounded flex justify-between items-center text-[12px]">
                  <div>
                    <span className="font-mono text-[10px] text-cyan block">{sop.id}</span>
                    <span className="font-medium text-foreground">{sop.name}</span>
                  </div>
                  <div className="text-right font-mono text-[10px] text-text-muted shrink-0 ml-3">
                    <div>Time: {sop.time}</div>
                    <div>Level: {sop.difficulty}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 flex-1 flex items-center gap-4">
              <div className="w-[140px] h-[140px] relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={sparesData} dataKey="v" nameKey="name" innerRadius={48} outerRadius={68} stroke="var(--color-surface-1)" strokeWidth={2} paddingAngle={1}>
                      {sparesData.map((_, i) => <Cell key={i} fill={SPARE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="font-mono text-[20px] leading-none">100</div>
                  <div className="font-mono text-[9px] text-text-muted mt-1">TOTAL</div>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {sparesData.map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="size-2 rounded-sm shrink-0" style={{ background: SPARE_COLORS[i] }} />
                      <span className="truncate">{s.name}</span>
                    </div>
                    <span className="font-mono text-text-muted">{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );

    // 2. Spares stock panel for Procurement
    const sparesStockPanel = (
      <div key="spares-stock" className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 card-flat">
          <PanelHeader label="Spare Parts Stock Levels vs Reorder Limits" action={<span className="font-mono text-[10px] text-text-muted">Total inventory</span>} />
          <div className="p-4 h-[280px]">
            <ResponsiveContainer>
              <BarChart data={spares.slice(0, 8).map(s => ({ name: s.part_name, stock: s.stock_quantity, limit: s.reorder_level }))} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="var(--color-text-muted)"
                  fontSize={9}
                  tickLine={false}
                  interval={0}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <Bar dataKey="stock" fill="var(--accent-cyan)" name="Current Stock" maxBarSize={26} radius={[2, 2, 0, 0]} />
                <Bar dataKey="limit" fill="var(--state-warn)" name="Reorder Limit" maxBarSize={26} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 card-flat flex flex-col">
          <PanelHeader label="Critical Spare Status" action={<span className="font-mono text-[10px] text-text-muted">Low stock</span>} />
          <div className="p-4 flex-1 overflow-y-auto space-y-2 max-h-[280px]">
            {spares.slice(0, 5).map((s: any) => (
              <div key={s.part_id} className="flex items-center justify-between text-[12px] p-2.5 bg-surface-2/65 rounded border border-border">
                <div className="min-w-0">
                  <div className="font-mono font-medium truncate">{s.part_name}</div>
                  <div className="text-[10px] text-text-muted">Supplier: {s.supplier || "SKF India"}</div>
                </div>
                <div className="text-right font-mono shrink-0 ml-2">
                  <div className={s.stock_quantity <= s.reorder_level ? "text-crit" : "text-emerald-400"}>
                    Stock: {s.stock_quantity}/{s.reorder_level}
                  </div>
                  <div className="text-[10px] text-text-muted">{s.lead_time_days} days lead</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    // 3. Purchase orders panel for Procurement
    const purchaseOrdersPanel = (
      <div key="purchase-orders" className="card-flat">
        <PanelHeader label="Spare Parts Purchase Order Pipeline" action={<span className="font-mono text-[10px] text-amber-400">Sync with ERP</span>} />
        <div className="p-4 space-y-3">
          {[
            { id: "PO-2026-981", part: "M12-B08 Bearing Block", supplier: "SKF India", status: "SHIPPED", eta: "June 12" },
            { id: "PO-2026-985", part: "P3 Centrifugal Seal", supplier: "Flowserve", status: "PENDING APPROVED", eta: "June 18" },
            { id: "PO-2026-990", part: "G1 Gears Set (Flender)", supplier: "Siemens AG", status: "DRAFT IN REVIEW", eta: "July 02" },
          ].map((po) => (
            <div key={po.id} className="p-3 bg-surface-2/45 border border-border rounded flex justify-between items-start text-[12.5px]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-amber-400 font-semibold">{po.id}</span>
                  <span className="text-text-muted font-mono text-[11px]">· {po.part}</span>
                </div>
                <div className="text-text-secondary mt-1 text-xs">Supplier: {po.supplier} · ETA: <span className="font-semibold text-foreground">{po.eta}</span></div>
              </div>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded shrink-0 ml-3 ${po.status === "SHIPPED" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : po.status.includes("APPROVED") ? "bg-cyan/10 text-cyan border border-cyan/20" : "bg-surface-1 text-text-muted border border-border"}`}>
                {po.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );

    // 4. Operator field inspections
    const fieldInspectionsPanel = (
      <div key="field-inspections" className="card-flat">
        <PanelHeader label="Pending Operator Field Inspections" action={
          <Link to="/logbook" className="font-mono text-[11px] text-ok hover:underline inline-flex items-center gap-1">
            Open Logbook &rarr;
          </Link>
        } />
        <div className="p-4 space-y-3">
          {[
            { id: "FI-102", asset: "Motor_M12", task: "Check shaft lubrication levels and record housing temperature.", status: "PENDING" },
            { id: "FI-105", asset: "Pump_P3", task: "Check cooling water outlet pressure and listen for cavitation.", status: "PENDING" },
            { id: "FI-108", asset: "Gearbox_G1", task: "Extract oil sample for particle concentration analysis.", status: "SCHEDULED" },
          ].map((task) => (
            <div key={task.id} className="p-3 bg-surface-2/45 border border-border rounded flex justify-between items-start text-[12.5px]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-emerald-400 font-semibold">{task.id}</span>
                  <span className="text-text-muted font-mono text-[11px]">· {assetNames[task.asset] || task.asset}</span>
                </div>
                <p className="text-text-secondary mt-1 text-xs">{task.task}</p>
              </div>
              <span className={`font-mono text-[10px] px-2 py-0.5 rounded shrink-0 ml-3 ${task.status === "PENDING" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-surface-1 text-text-muted border border-border"}`}>
                {task.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );

    // 5. Reliability sensor anomaly logs
    const sensorAnomalyPanel = (
      <div key="reliability-anomalies" className="card-flat">
        <PanelHeader label="High-Frequency Sensor Anomaly Log" action={<span className="font-mono text-[10px] text-text-muted">Real-time</span>} />
        <div className="p-4 space-y-3">
          {[
            { asset: "Motor_M12", channel: "Vib X-Axis (DE)", anomaly: "RMS vibration exceeded 9.2 mm/s threshold (1.8x baseline)", time: "12 mins ago" },
            { asset: "Gearbox_G1", channel: "Thermal Probe 2", anomaly: "High gradient shift: +0.42°C/min under steady-state load", time: "45 mins ago" },
            { asset: "Pump_P3", channel: "Fluid Flow Rate", anomaly: "Turbulence index fluctuation (>15% variance over 2 min)", time: "2 hours ago" },
          ].map((anom, idx) => (
            <div key={idx} className="p-3 bg-surface-2/45 border border-border rounded flex justify-between items-start text-[12.5px]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-purple-400 font-semibold">{anom.channel}</span>
                  <span className="text-text-muted font-mono text-[11px]">· {assetNames[anom.asset] || anom.asset}</span>
                </div>
                <p className="text-text-secondary mt-1 text-xs">{anom.anomaly}</p>
              </div>
              <span className="font-mono text-[10px] text-text-muted shrink-0 ml-3 pt-0.5">
                {anom.time}
              </span>
            </div>
          ))}
        </div>
      </div>
    );

    const alertsFeedPanel = (
      <div key="alerts" className="col-span-12 lg:col-span-8 card-flat flex flex-col">
        <PanelHeader
          label="Mission Control Alert Feed"
          action={
            <span className="font-mono text-[10px] text-text-muted capitalize">
              Active Persona: {activeRole.replace("_", " ")}
            </span>
          }
        />
        <div className="flex-1 min-h-[300px] max-h-[450px] overflow-y-auto divide-y divide-border/60">
          {alertsQuery.isLoading ? (
            <div className="h-full flex items-center justify-center p-8 text-text-muted text-[12px] font-mono">
              Loading telemetry alarms...
            </div>
          ) : (alertsQuery.data?.alerts || []).length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-12 text-text-muted text-[12px]">
              <span>No active alarms targeting this role.</span>
              <span className="text-[10px] text-text-muted/70 mt-1">Switch roles in the top command header to inspect other feeds.</span>
            </div>
          ) : (
            (alertsQuery.data?.alerts || []).map((alert) => (
              <div
                key={alert.id}
                className={`p-4 flex gap-4 transition-colors hover:bg-surface-1/40 ${
                  alert.is_read ? "opacity-60" : "bg-cyan/5 border-l-2 border-cyan"
                }`}
              >
                <div className="flex flex-col items-start justify-start pt-0.5 shrink-0">
                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                      alert.severity === "critical"
                        ? "bg-crit/15 text-crit border border-crit/20"
                        : alert.severity === "high"
                        ? "bg-warn/15 text-warn border border-warn/20"
                        : "bg-surface-2 text-text-secondary border border-border"
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
                
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[13px] text-foreground">
                      {alert.title}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted flex items-center gap-1.5">
                      <Clock className="size-3 text-text-muted" />
                      {relativeTime(alert.created_at)}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-secondary leading-relaxed">
                    {alert.message}
                  </p>
                  {alert.asset_id && (
                    <div className="pt-1">
                      <Link
                        to="/assets/$id"
                        params={{ id: alert.asset_id }}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline"
                      >
                        Asset: {assetNames[alert.asset_id] || alert.asset_id} ({alert.asset_id}) &rarr;
                      </Link>
                    </div>
                  )}
                </div>

                {!alert.is_read && (
                  <button
                    onClick={() => readAlertMutation.mutate({ alertId: alert.id, role: activeRole })}
                    disabled={readAlertMutation.isPending}
                    className="self-center font-mono text-[10px] text-cyan hover:text-cyan/85 border border-cyan/20 px-2 py-1 rounded hover:bg-cyan/10 transition-all shrink-0 disabled:opacity-50"
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );

    const escalationsPanel = (
      <div key="escalations" className="col-span-12 lg:col-span-4 card-flat flex flex-col">
        <PanelHeader
          label="Active Escalation SLAs"
          action={
            <span className="font-mono text-[10px] text-text-muted">
              {escalations.filter((e: any) => !e.resolved).length} Urgent
            </span>
          }
        />
        <div className="flex-1 p-4 overflow-y-auto space-y-3 max-h-[450px]">
          {escalationsQuery.isLoading ? (
            <div className="h-full flex items-center justify-center text-text-muted text-[12px] font-mono py-12">
              Loading active SLAs...
            </div>
          ) : escalations.filter((e: any) => !e.resolved).length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-muted text-[12px] py-12 text-center">
              <span>No active escalations.</span>
              <span className="text-[10px] text-text-muted/70 mt-1 max-w-[25ch]">If a critical warning threshold is reached, assets will auto-escalate here.</span>
            </div>
          ) : (
            escalations.filter((e: any) => !e.resolved).map((esc: any) => {
              const sla = esc.escalation_level === "critical" ? "4h Response SLA" : "12h Response SLA";
              return (
                <div
                  key={esc.id}
                  className="p-3 bg-surface-2 border border-border/80 rounded-md space-y-2.5 flex flex-col"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      to="/assets/$id"
                      params={{ id: esc.asset_id }}
                      className="font-mono font-bold text-[14px] text-foreground hover:text-cyan transition-colors"
                    >
                      {assetNames[esc.asset_id] || esc.asset_id}
                    </Link>
                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                        esc.escalation_level === "critical"
                          ? "bg-crit/20 text-crit border border-crit/30"
                          : "bg-warn/20 text-warn border border-warn/30"
                      }`}
                    >
                      {esc.escalation_level}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-crit font-medium">{sla}</span>
                    <span className="text-text-muted">{relativeTime(esc.created_at)}</span>
                  </div>
                  <button
                    onClick={() => resolveEscalationMutation.mutate(esc.id)}
                    disabled={resolveEscalationMutation.isPending}
                    className="w-full h-8 rounded bg-surface-1 border border-border text-[11px] hover:bg-cyan/15 hover:border-cyan/30 text-foreground transition-all font-mono uppercase tracking-wider disabled:opacity-50"
                  >
                    Resolve SLA
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    );

    const investigationsPanel = (
      <div key="investigations" className="card-flat">
        <PanelHeader label="Recent investigations" action={
          <Link to="/investigations" className="font-mono text-[11px] text-cyan hover:opacity-80 inline-flex items-center gap-1">
            View all <ArrowUpRight className="size-3" strokeWidth={1.75} />
          </Link>
        } />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left border-b border-border">
                {["Time", "Asset", "Root cause", "Downtime", "Severity"].map((h) => (
                  <th key={h} className="px-4 py-2 label text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px] text-text-muted">
                  {incidents.isLoading ? "Loading incidents…" : "No incidents on record."}
                </td></tr>
              )}
              {recent.map((r, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-surface-1 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-text-muted">{r.time}</td>
                  <td className="px-4 py-2.5 font-mono">{r.assetName} <span className="text-[10px] text-text-muted">({r.asset})</span></td>
                  <td className="px-4 py-2.5 text-text-secondary">{r.diag}</td>
                  <td className="px-4 py-2.5 font-mono">{r.downtime}h</td>
                  <td className="px-4 py-2.5">
                    <span className={
                      "inline-flex items-center gap-1.5 font-mono text-[11px] capitalize " +
                      (r.tone === "crit" ? "text-crit" : r.tone === "warn" ? "text-warn" : "text-ok")
                    }>
                      <span className={"size-1.5 rounded-full " + (r.tone === "crit" ? "bg-crit" : r.tone === "warn" ? "bg-warn" : "bg-ok")} />
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

    switch (activeRole) {
      case "plant_manager":
        return [
          chartsPanel,
          investigationsPanel
        ];
      case "maintenance_engineer":
        return [
          chartsPanel,
          <div key="maint-feeds" className="grid grid-cols-12 gap-6">{alertsFeedPanel}{escalationsPanel}</div>
        ];
      case "reliability_engineer":
        return [
          chartsPanel,
          <div key="re-feeds" className="grid grid-cols-12 gap-6">
            {alertsFeedPanel}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">{sensorAnomalyPanel}</div>
          </div>
        ];
      case "procurement_officer":
        return [
          sparesStockPanel,
          purchaseOrdersPanel
        ];
      case "supervisor":
        return [
          <div key="sup-feeds" className="grid grid-cols-12 gap-6">{alertsFeedPanel}{escalationsPanel}</div>,
          investigationsPanel
        ];
      case "operator":
      default:
        return [
          <div key="op-feeds" className="grid grid-cols-12 gap-6">
            {alertsFeedPanel}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">{fieldInspectionsPanel}</div>
          </div>,
          chartsPanel
        ];
    }
  };

  return (
    <Shell
      title={
        activeRole === "plant_manager"
          ? "Executive Dashboard"
          : activeRole === "maintenance_engineer"
          ? "Maintenance Command Center"
          : activeRole === "reliability_engineer"
          ? "Reliability Analytics Center"
          : activeRole === "supervisor"
          ? "Shift Operations Console"
          : activeRole === "procurement_officer"
          ? "Procurement & Spares Command"
          : "Field Operator Console"
      }
      subtitle={roleConfig.heroTitle}
    >
      <div className="h-full overflow-y-auto grid-bg">
        <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* HERO PRIORITY CARD */}
        <motion.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="card-flat overflow-hidden"
        >
          {renderHeroContent()}
        </motion.div>

        {/* KPI STRIP — 4 cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {roleConfig.kpiSet.map((kpi, idx) => {
            const rawVal = kpi.valueExpression(d, predicted, spares, escalations, businessRisks);
            const subtext = kpi.subtextExpression(d, predicted, spares, escalations, businessRisks);

            let numericVal = NaN;
            let prefix = "";
            let suffix = "";

            if (typeof rawVal === "string") {
              const match = rawVal.match(/([\d\.,]+)/);
              if (match) {
                const numStr = match[1];
                numericVal = parseFloat(numStr.replace(/,/g, ""));
                const index = rawVal.indexOf(numStr);
                prefix = rawVal.substring(0, index);
                suffix = rawVal.substring(index + numStr.length);
              }
            } else if (typeof rawVal === "number") {
              numericVal = rawVal;
            }

            let tone = "cyan";
            if (kpi.color.includes("red") || kpi.color.includes("rose") || kpi.color.includes("warn")) tone = "crit";
            else if (kpi.color.includes("amber")) tone = "warn";
            else if (kpi.color.includes("emerald") || kpi.color.includes("ok")) tone = "ok";
            else if (kpi.color.includes("purple")) tone = "purple";

            // Dynamically override tone based on actual telemetry values
            if (kpi.key === "plant_health" && !isNaN(numericVal)) {
              if (numericVal < 70) tone = "crit";
              else if (numericVal < 85) tone = "warn";
              else tone = "ok";
            } else if (kpi.key === "critical_assets" && !isNaN(numericVal)) {
              if (numericVal > 2) tone = "crit";
              else if (numericVal > 0) tone = "warn";
              else tone = "ok";
            }

            return (
              <Kpi
                key={kpi.key}
                label={kpi.label}
                value={isNaN(numericVal) ? rawVal : numericVal}
                decimals={typeof rawVal === "string" && rawVal.includes(".") ? 1 : 0}
                prefix={prefix || undefined}
                suffix={suffix || undefined}
                spark={makeSpark(idx * 4, idx * 3)}
                tone={tone}
                trend={subtext}
              />
            );
          })}
        </div>

        {/* Secondary pill strip */}
        <div className="flex flex-wrap items-center gap-2 -mt-1">
          {[
            { l: "Total assets", v: d ? d.total_assets : "—" },
            { l: "Spare shortages", v: d ? (spares.filter((s: any) => s.stock_level <= s.reorder_level).length || d.spare_shortages.length || 0) : "—" },
            { l: "In maintenance", v: d ? d.assets_in_maintenance : "—" }
          ].map((p) => (
            <div key={p.l} className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-border bg-surface-1">
              <span className="text-[11px] text-text-secondary">{p.l}</span>
              <span className="font-mono text-[11px] text-foreground">{p.v}</span>
            </div>
          ))}
        </div>

        {/* ASK OREON INLINE — Enter sends the question straight into the chat */}
        <div
          className="w-full h-14 rounded-lg border border-border bg-surface-1 hover:bg-surface-2/60 hover:border-violet/30 transition-colors flex items-center gap-3 px-4 cursor-text"
        >
          <Sparkles className="size-4 text-violet" strokeWidth={1.5} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") askInChat(q);
            }}
            placeholder="Ask OREON about any asset, incident, or trend…"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-text-muted"
          />
          <button
            onClick={() => askInChat(q)}
            disabled={!q.trim()}
            className="font-mono text-[10px] uppercase tracking-wide h-7 px-3 rounded bg-violet/15 text-violet border border-violet/30 hover:bg-violet/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Ask →
          </button>
        </div>

        {/* SENTINEL INTELLIGENCE PANEL */}
        <SentinelPanel />

        {/* MISSION BRIEF — role-specific priority tasks */}
        <WorkflowStatus role={activeRole} />

        {/* Reordered Panels */}
        {renderSections()}
        </div>
      </div>
    </Shell>
  );
}