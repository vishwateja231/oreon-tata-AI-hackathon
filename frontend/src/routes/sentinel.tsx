import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  Activity, Brain, AlertTriangle, Search, Shield, Zap,
  Clock, CheckCircle, Play, TrendingUp, BarChart3, Radio,
  ArrowUpRight,
} from "lucide-react";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import {
  useSentinelStatus,
  useSentinelActivities,
  useSentinelStats,
  useSentinelTimeline,
  useTriggerSentinel,
} from "@/lib/api/hooks";
import { ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";
import type { SentinelActivityType } from "@/lib/api/types";

export const Route = createFileRoute("/sentinel")({
  head: () => ({
    meta: [
      { title: "Sentinel Center · OREON" },
      { name: "description", content: "Autonomous maintenance intelligence agent." },
    ],
  }),
  component: SentinelCenter,
});

const ICON_MAP: Record<SentinelActivityType, typeof Activity> = {
  anomaly_detected: AlertTriangle,
  investigation_started: Search,
  alert_created: Zap,
  escalation_created: Shield,
  maintenance_plan_generated: CheckCircle,
  rca_completed: Brain,
  rul_predicted: TrendingUp,
  health_check: Activity,
};

const TONE_MAP: Record<SentinelActivityType, string> = {
  anomaly_detected: "text-warn",
  investigation_started: "text-cyan",
  alert_created: "text-crit",
  escalation_created: "text-violet",
  maintenance_plan_generated: "text-ok",
  rca_completed: "text-cyan",
  rul_predicted: "text-cyan",
  health_check: "text-text-muted",
};

const DOT_MAP: Record<SentinelActivityType, string> = {
  anomaly_detected: "bg-warn",
  investigation_started: "bg-cyan",
  alert_created: "bg-crit",
  escalation_created: "bg-violet",
  maintenance_plan_generated: "bg-ok",
  rca_completed: "bg-cyan",
  rul_predicted: "bg-cyan",
  health_check: "bg-text-muted",
};

function SentinelCenter() {
  const status = useSentinelStatus();
  const stats = useSentinelStats();
  const timeline = useSentinelTimeline(30);
  const [filterType, setFilterType] = useState<string>("all");
  const queryFilters: Record<string, string | number> = { limit: 50 };
  if (filterType !== "all") {
    queryFilters.activity_type = filterType;
  } else {
    queryFilters.exclude_routine = "true";
  }

  const activities = useSentinelActivities(queryFilters);
  const triggerMutation = useTriggerSentinel();

  const s = status.data;
  const st = stats.data;

  const filteredActivities = activities.data?.activities ?? [];
  const timelineEvents = (timeline.data ?? []).filter(e => e.type !== "health_check");

  return (
    <Shell title="Sentinel Center" subtitle={s?.running ? `${s.scan_count} cycles completed` : "Initializing..."}>
      <div className="h-full overflow-y-auto p-6 grid-bg space-y-4">

        {/* Top Stats Row — same style as Alert Center */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { l: "Assets Monitored", v: s?.assets_monitored ?? 0, tone: "text-cyan", dot: "bg-cyan" },
            { l: "Anomalies Found", v: s?.anomalies_detected ?? 0, tone: "text-warn", dot: "bg-warn" },
            { l: "Alerts Raised", v: s?.alerts_generated ?? 0, tone: "text-crit", dot: "bg-crit" },
            { l: "Investigations", v: s?.investigations_created ?? 0, tone: "text-cyan", dot: "bg-cyan" },
            { l: "Escalations", v: s?.escalations_triggered ?? 0, tone: "text-violet", dot: "bg-violet" },
            { l: "Scan Cycles", v: s?.scan_count ?? 0, tone: "text-ok", dot: "bg-ok" },
          ].map((kpi) => (
            <div key={kpi.l} className="card-flat p-4 flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{kpi.l}</div>
                <div className={`font-mono text-3xl mt-1 leading-none tracking-tight ${kpi.tone}`}>{kpi.v}</div>
              </div>
              <div className={`size-2 rounded-full ${kpi.dot} ${kpi.v > 0 ? "" : ""}`} />
            </div>
          ))}
        </div>

        {/* Status Bar */}
        <div className="card-flat p-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-text-secondary">
                {s?.running ? "Autonomous monitoring" : "Idle"}
              </span>
            </div>
            {s?.last_scan && (
              <span className="font-mono text-[10px] text-text-muted">
                Last scan: {new Date(s.last_scan).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            {st && (
              <span className="font-mono text-[10px] text-text-muted">
                Avg confidence: {Math.round(st.average_confidence * 100)}%
              </span>
            )}
          </div>
          <button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan/10 border border-cyan/20 hover:bg-cyan/20 text-cyan text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Play className="size-3" strokeWidth={2} />
            {triggerMutation.isPending ? "Scanning..." : "Trigger Scan"}
          </button>
        </div>

        {/* Main Grid: Timeline + Activity */}
        <div className="grid grid-cols-12 gap-4">
          {/* Timeline */}
          <div className="col-span-12 lg:col-span-4 card-flat flex flex-col">
            <PanelHeader label="Agent Timeline" action={
              <span className="font-mono text-[10px] text-text-muted">{timelineEvents.length} actions</span>
            } />
            <div className="flex-1 overflow-y-auto max-h-[520px]">
              {timelineEvents.map((event, idx) => {
                const Icon = ICON_MAP[event.type] || Activity;
                const tone = TONE_MAP[event.type] || "text-text-muted";
                const dot = DOT_MAP[event.type] || "bg-text-muted";
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 px-4 py-2.5 border-b border-border/60 last:border-0 hover:bg-surface-2/40 transition-colors"
                  >
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <span className={`size-1.5 rounded-full ${dot}`} />
                      {idx < timelineEvents.length - 1 && (
                        <div className="w-px flex-1 bg-border/60 min-h-[16px]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className={`size-3 ${tone} shrink-0`} strokeWidth={1.5} />
                        <span className="text-[12px] text-foreground truncate leading-tight">{event.summary}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[9px] text-text-muted">{event.time}</span>
                        <span className="text-[9px] text-text-muted">·</span>
                        <span className="font-mono text-[9px] text-text-muted truncate">
                          {(ASSET_DISPLAY_NAMES as any)[event.asset_id] || event.asset_id}
                        </span>
                      </div>
                    </div>
                    {event.confidence != null && (
                      <span className="font-mono text-[9px] text-text-muted shrink-0 pt-0.5">
                        {Math.round(event.confidence * 100)}%
                      </span>
                    )}
                  </div>
                );
              })}
              {timelineEvents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <Brain className="size-8 text-text-muted mb-3" strokeWidth={1} />
                  <p className="text-[12px] text-text-muted text-center">Sentinel is initializing.</p>
                  <p className="text-[11px] text-text-muted mt-1 text-center">First scan will populate this timeline.</p>
                  <button
                    onClick={() => triggerMutation.mutate()}
                    className="mt-3 px-3 py-1.5 rounded-md bg-cyan/10 border border-cyan/20 text-cyan text-[10px] font-mono uppercase"
                  >
                    Run First Scan
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Activity Log */}
          <div className="col-span-12 lg:col-span-8 card-flat flex flex-col">
            <PanelHeader label="Activity Log" action={
              <div className="flex items-center gap-2">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="font-mono text-[10px] bg-surface-2 border border-border text-text-secondary rounded px-2 py-0.5 outline-none uppercase"
                >
                  <option value="all">Key events</option>
                  <option value="anomaly_detected">Anomalies</option>
                  <option value="alert_created">Alerts</option>
                  <option value="investigation_started">Investigations</option>
                  <option value="escalation_created">Escalations</option>
                  <option value="rca_completed">Root Cause</option>
                  <option value="maintenance_plan_generated">Plans</option>
                  <option value="health_check">Health Checks</option>
                </select>
              </div>
            } />
            <div className="flex-1 overflow-y-auto max-h-[520px]">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-surface-1">
                    {["Time", "Type", "Asset", "Summary", "Conf."].map((h) => (
                      <th key={h} className="px-4 py-2 text-left label font-medium text-text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-[12px] text-text-muted">
                        {filterType === "all"
                          ? "No key events yet — Sentinel is scanning. Routine health checks are hidden; pick 'Health Checks' to see them."
                          : "No matching activities for this filter."}
                      </td>
                    </tr>
                  )}
                  {filteredActivities.map((a) => {
                    const Icon = ICON_MAP[a.activity_type] || Activity;
                    const tone = TONE_MAP[a.activity_type] || "text-text-muted";
                    return (
                      <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap">
                          {a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 ${tone}`}>
                            <Icon className="size-3" strokeWidth={1.5} />
                            <span className="font-mono text-[10px] uppercase">
                              {a.activity_type.replace(/_/g, " ").replace("detected", "").replace("created", "").replace("started", "").trim()}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-text-secondary">
                          {(ASSET_DISPLAY_NAMES as any)[a.asset_id] || a.asset_id}
                        </td>
                        <td className="px-4 py-2.5 text-foreground max-w-[300px] truncate">{a.summary}</td>
                        <td className="px-4 py-2.5 font-mono text-text-muted text-right">
                          {a.confidence != null ? `${Math.round(a.confidence * 100)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Performance Stats */}
        {st && st.total_activities > 0 && (
          <div className="card-flat">
            <PanelHeader label="Agent Performance Metrics" action={
              <Link to="/warroom" className="font-mono text-[10px] text-cyan hover:opacity-80 inline-flex items-center gap-1">
                War Room <ArrowUpRight className="size-3" strokeWidth={1.5} />
              </Link>
            } />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
              {[
                { l: "Total Actions", v: st.total_activities },
                { l: "Avg Confidence", v: `${Math.round(st.average_confidence * 100)}%` },
                { l: "Success Rate", v: `${Math.round(st.success_rate * 100)}%` },
                { l: "Anomalies/Cycle", v: st.scan_count > 0 ? (st.by_type.anomaly_detected / st.scan_count).toFixed(1) : "0" },
                { l: "Alerts/Cycle", v: st.scan_count > 0 ? (st.by_type.alert_created / st.scan_count).toFixed(1) : "0" },
              ].map((m) => (
                <div key={m.l} className="bg-surface-1 p-4 text-center">
                  <div className="font-mono text-[22px] font-semibold text-foreground leading-none">{m.v}</div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted mt-2">{m.l}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
