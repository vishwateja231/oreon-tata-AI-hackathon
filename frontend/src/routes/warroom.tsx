import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Brain, Shield, Sparkles, ArrowUpRight, ChevronRight,
} from "lucide-react";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import {
  useDashboard,
  useAlerts,
  useEscalations,
  useSentinelStatus,
  useSentinelTimeline,
  useActiveRole,
} from "@/lib/api/hooks";
import { ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";
import type { SentinelActivityType } from "@/lib/api/types";

export const Route = createFileRoute("/warroom")({
  head: () => ({
    meta: [
      { title: "War Room · OREON" },
      { name: "description", content: "Executive maintenance command center." },
    ],
  }),
  component: WarRoom,
});

const TYPE_TONE: Partial<Record<SentinelActivityType, string>> = {
  anomaly_detected: "text-warn",
  alert_created: "text-crit",
  escalation_created: "text-violet",
  investigation_started: "text-cyan",
  rca_completed: "text-cyan",
  maintenance_plan_generated: "text-ok",
};

const TYPE_DOT: Partial<Record<SentinelActivityType, string>> = {
  anomaly_detected: "bg-warn",
  alert_created: "bg-crit",
  escalation_created: "bg-violet",
  investigation_started: "bg-cyan",
  rca_completed: "bg-cyan",
  maintenance_plan_generated: "bg-ok",
};

function WarRoom() {
  const [activeRole] = useActiveRole();
  const dashboard = useDashboard();
  const alerts = useAlerts({ role: activeRole, limit: 20 });
  const escalations = useEscalations();
  const sentinel = useSentinelStatus();
  const timeline = useSentinelTimeline(25);

  const d = dashboard.data;
  const s = sentinel.data;
  const activeAlerts = alerts.data?.alerts ?? [];
  const activeEscalations = escalations.data?.active?.filter((e) => !e.resolved) ?? [];
  const criticalAlerts = activeAlerts.filter((a) => a.severity === "critical" || a.severity === "high");
  const predictedFailures = d?.predicted_failures ?? [];
  const criticalAssets = d?.critical_assets ?? [];
  const plantHealth = d ? Math.round(d.avg_plant_health) : 0;

  const failNext7 = predictedFailures.filter(f => f.rul_days <= 7).length;
  const failNext14 = predictedFailures.filter(f => f.rul_days <= 14).length;
  const failNext30 = predictedFailures.filter(f => f.rul_days <= 30).length;

  const timelineFiltered = (timeline.data ?? []).filter(e => e.type !== "health_check");
  const revenueAtRisk = criticalAssets.length * 23;

  const threatLevel = plantHealth < 50 ? "CRITICAL" : plantHealth < 68 ? "HIGH" : plantHealth < 80 ? "ELEVATED" : "NOMINAL";
  const threatClass = plantHealth < 50 ? "text-crit" : plantHealth < 68 ? "text-warn" : plantHealth < 80 ? "text-yellow-400" : "text-ok";
  const threatDot = plantHealth < 50 ? "bg-crit" : plantHealth < 68 ? "bg-warn" : plantHealth < 80 ? "bg-yellow-400" : "bg-ok";
  const threatBorder = plantHealth < 50 ? "border-crit/20" : plantHealth < 68 ? "border-warn/20" : plantHealth < 80 ? "border-yellow-400/20" : "border-ok/20";
  const healthTone = plantHealth >= 75 ? "text-ok" : plantHealth >= 50 ? "text-warn" : "text-crit";

  return (
    <Shell title="War Room" subtitle="Executive Maintenance Command">
      <div className="h-full overflow-y-auto p-5 pb-24 grid-bg space-y-4">

        {/* Threat Assessment Header */}
        <div className={`card-flat p-4 border ${threatBorder}`}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted mb-1.5">Threat Level</div>
                <div className={`font-mono text-[30px] font-bold leading-none tracking-tight ${threatClass} flex items-center gap-2.5`}>
                  <span className={`size-2.5 rounded-full ${threatDot} shrink-0`} />
                  {threatLevel}
                </div>
              </div>
              <div className="h-10 w-px bg-border hidden sm:block" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted mb-1.5">Plant Health</div>
                <div className={`font-mono text-[30px] font-bold leading-none tracking-tight ${healthTone}`}>
                  {plantHealth > 0 ? `${plantHealth}%` : "—"}
                </div>
              </div>
              <div className="h-10 w-px bg-border hidden sm:block" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted mb-1.5">Critical Assets</div>
                <div className={`font-mono text-[30px] font-bold leading-none tracking-tight ${criticalAssets.length > 0 ? "text-crit" : "text-ok"}`}>
                  {criticalAssets.length}
                </div>
              </div>
              <div className="h-10 w-px bg-border hidden sm:block" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted mb-1.5">Revenue at Risk</div>
                <div className={`font-mono text-[30px] font-bold leading-none tracking-tight ${revenueAtRisk > 0 ? "text-warn" : "text-ok"}`}>
                  {revenueAtRisk > 0 ? `₹${revenueAtRisk}L` : "—"}
                </div>
              </div>
              <div className="h-10 w-px bg-border hidden sm:block" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted mb-1.5">Predicted Failures</div>
                <div className={`font-mono text-[30px] font-bold leading-none tracking-tight ${predictedFailures.length > 0 ? "text-warn" : "text-ok"}`}>
                  {predictedFailures.length}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <Brain className="size-3.5 text-cyan" strokeWidth={1.5} />
                <span className="font-mono text-[11px] text-text-secondary font-medium">
                  Sentinel {s?.running ? "online" : "idle"}
                </span>
              </div>
              <span className="font-mono text-[9px] text-text-muted">
                {s?.scan_count ?? 0} cycles · {s?.anomalies_detected ?? 0} anomalies · {s?.alerts_generated ?? 0} alerts
              </span>
              <Link to="/sentinel" className="font-mono text-[9px] text-cyan hover:opacity-80 inline-flex items-center gap-1 mt-0.5">
                Sentinel Center <ArrowUpRight className="size-3" strokeWidth={1.5} />
              </Link>
            </div>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { l: "Active Alerts", v: activeAlerts.length, tone: activeAlerts.length > 0 ? "text-warn" : "text-ok", dot: activeAlerts.length > 0 ? "bg-warn" : "bg-ok" },
            { l: "Critical Alerts", v: criticalAlerts.length, tone: criticalAlerts.length > 0 ? "text-crit" : "text-ok", dot: criticalAlerts.length > 0 ? "bg-crit" : "bg-ok" },
            { l: "Escalations", v: activeEscalations.length, tone: activeEscalations.length > 0 ? "text-violet" : "text-ok", dot: activeEscalations.length > 0 ? "bg-violet" : "bg-ok" },
            { l: "AI Detections", v: s?.anomalies_detected ?? 0, tone: "text-cyan", dot: "bg-cyan" },
            { l: "Fail within 7d", v: failNext7, tone: failNext7 > 0 ? "text-crit" : "text-ok", dot: failNext7 > 0 ? "bg-crit" : "bg-ok" },
            { l: "Fail within 14d", v: failNext14, tone: failNext14 > 0 ? "text-warn" : "text-ok", dot: failNext14 > 0 ? "bg-warn" : "bg-ok" },
          ].map((kpi) => (
            <div key={kpi.l} className="card-flat p-3.5 flex items-start justify-between">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted leading-tight">{kpi.l}</div>
                <div className={`font-mono text-[26px] mt-1.5 leading-none tracking-tight font-bold ${kpi.tone}`}>{kpi.v}</div>
              </div>
              <div className={`size-1.5 rounded-full mt-0.5 ${kpi.dot} ${typeof kpi.v === "number" && kpi.v > 0 ? "" : ""}`} />
            </div>
          ))}
        </div>

        {/* Main Three-Column Grid */}
        <div className="grid grid-cols-12 gap-4">

          {/* Left: Alerts + Failure Countdown */}
          <div className="col-span-12 lg:col-span-4 space-y-4">

            <div className="card-flat flex flex-col">
              <PanelHeader label="Critical Alerts" action={
                <Link to="/alerts" className="font-mono text-[10px] text-cyan hover:opacity-80 inline-flex items-center gap-1">
                  All Alerts <ArrowUpRight className="size-3" strokeWidth={1.5} />
                </Link>
              } />
              <div className="max-h-[260px] overflow-y-auto">
                {criticalAlerts.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[12px] text-text-muted">No critical alerts active</div>
                ) : criticalAlerts.slice(0, 6).map((alert) => (
                  <div key={alert.id} className="px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-2/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] text-foreground font-medium leading-tight flex-1 truncate">
                        {alert.title?.replace("[Sentinel] ", "")}
                      </span>
                      <span className={`shrink-0 font-mono text-[8px] px-1.5 py-0.5 rounded border uppercase font-semibold ${
                        alert.severity === "critical"
                          ? "bg-crit/10 text-crit border-crit/20"
                          : "bg-warn/10 text-warn border-warn/20"
                      }`}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="font-mono text-[9px] text-text-muted mt-0.5">
                      {(ASSET_DISPLAY_NAMES as any)[alert.asset_id!] || alert.asset_id}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-flat flex flex-col">
              <PanelHeader label="Failure Countdown" action={
                <span className="font-mono text-[10px] text-warn">
                  {failNext7 > 0 ? `${failNext7} within 7d` : failNext14 > 0 ? `${failNext14} within 14d` : "stable"}
                </span>
              } />
              <div className="max-h-[240px] overflow-y-auto">
                {predictedFailures.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[12px] text-text-muted">No predicted failures</div>
                ) : predictedFailures.slice(0, 5).map((pf, i) => (
                  <div key={i} className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-center gap-3 hover:bg-surface-2/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-foreground truncate">
                        {(ASSET_DISPLAY_NAMES as any)[pf.asset_id] || pf.asset_name}
                      </p>
                      <p className="font-mono text-[9px] text-text-muted mt-0.5 truncate">
                        {(pf.recommended_action ?? "Maintenance required").slice(0, 42)}
                        {(pf.recommended_action?.length ?? 0) > 42 ? "…" : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`font-mono text-[16px] font-bold leading-none ${pf.rul_days <= 7 ? "text-crit" : pf.rul_days <= 14 ? "text-warn" : "text-cyan"}`}>
                        {pf.rul_days}d
                      </span>
                      <p className="font-mono text-[8px] text-text-muted mt-0.5">{Math.round(pf.failure_probability * 100)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Center: Sentinel Feed + Downtime Risk */}
          <div className="col-span-12 lg:col-span-4 space-y-4">

            <div className="card-flat flex flex-col">
              <PanelHeader label="Sentinel Feed" action={
                <span className="font-mono text-[10px] text-text-muted">{timelineFiltered.length} actions</span>
              } />
              <div className="max-h-[260px] overflow-y-auto">
                {timelineFiltered.slice(0, 10).map((event, idx) => (
                  <div key={event.id} className="px-3 py-2 border-b border-border/40 last:border-0 flex items-start gap-2.5 hover:bg-surface-2/20 transition-colors">
                    <div className="flex flex-col items-center gap-1 pt-1.5 shrink-0">
                      <span className={`size-1.5 rounded-full ${TYPE_DOT[event.type] || "bg-text-muted"}`} />
                      {idx < Math.min(timelineFiltered.length, 10) - 1 && (
                        <div className="w-px h-3 bg-border/60" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`font-mono text-[8px] uppercase tracking-wider ${TYPE_TONE[event.type] || "text-text-muted"}`}>
                          {event.type.replace(/_/g, " ").replace("detected", "").replace("created", "").replace("started", "").trim().slice(0, 12)}
                        </span>
                        <span className="text-[8px] text-text-muted">·</span>
                        <span className="font-mono text-[8px] text-text-muted">{event.time}</span>
                      </div>
                      <p className="text-[11px] text-foreground leading-snug">{event.summary}</p>
                      <p className="font-mono text-[8px] text-text-muted mt-0.5">
                        {(ASSET_DISPLAY_NAMES as any)[event.asset_id] || event.asset_id}
                      </p>
                    </div>
                    {event.confidence != null && (
                      <span className="font-mono text-[8px] text-text-muted shrink-0 pt-1">
                        {Math.round(event.confidence * 100)}%
                      </span>
                    )}
                  </div>
                ))}
                {timelineFiltered.length === 0 && (
                  <div className="px-4 py-10 text-center text-[12px] text-text-muted">Awaiting sentinel scan...</div>
                )}
              </div>
            </div>

            <div className="card-flat flex flex-col">
              <PanelHeader label="Downtime Risk Window" />
              <div className="p-4 space-y-4">
                {[
                  { label: "Next 7 days", value: failNext7, max: 5, tone: "bg-crit", textTone: failNext7 > 0 ? "text-crit" : "text-ok" },
                  { label: "Next 14 days", value: failNext14, max: 7, tone: "bg-warn", textTone: failNext14 > 0 ? "text-warn" : "text-ok" },
                  { label: "Next 30 days", value: failNext30, max: 10, tone: "bg-cyan", textTone: failNext30 > 0 ? "text-cyan" : "text-ok" },
                ].map((bar) => (
                  <div key={bar.label}>
                    <div className="flex justify-between font-mono text-[10px] mb-1.5">
                      <span className="text-text-muted uppercase tracking-wider">{bar.label}</span>
                      <span className={bar.textTone}>{bar.value} asset{bar.value !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, bar.max > 0 ? (bar.value / bar.max) * 100 : 0)}%` }}
                        transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                        className={`h-full rounded-full ${bar.value > 0 ? bar.tone : "bg-ok/40"}`}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-border">
                  <p className="font-mono text-[9px] text-text-muted leading-relaxed">
                    {failNext7 > 0
                      ? `${failNext7} asset${failNext7 > 1 ? "s" : ""} require immediate intervention within 7 days`
                      : "No imminent failures in 7-day window — monitoring active"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Escalations + AI Recommendations */}
          <div className="col-span-12 lg:col-span-4 space-y-4">

            <div className="card-flat flex flex-col">
              <PanelHeader label="Active Escalations" action={
                <span className={`font-mono text-[10px] ${activeEscalations.length > 0 ? "text-crit" : "text-ok"}`}>
                  {activeEscalations.length > 0 ? `${activeEscalations.length} active` : "clear"}
                </span>
              } />
              <div className="max-h-[260px] overflow-y-auto">
                {activeEscalations.length === 0 ? (
                  <div className="px-4 py-10 flex flex-col items-center gap-2">
                    <Shield className="size-6 text-ok" strokeWidth={1} />
                    <p className="text-[12px] text-text-muted">No active escalations</p>
                  </div>
                ) : activeEscalations.slice(0, 6).map((esc) => (
                  <div key={esc.id} className="px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-2/30 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-medium text-foreground truncate">
                        {(ASSET_DISPLAY_NAMES as any)[esc.asset_id] || esc.asset_id}
                      </span>
                      <span className={`shrink-0 font-mono text-[8px] px-1.5 py-0.5 rounded border uppercase font-semibold ${
                        esc.escalation_level === "critical"
                          ? "bg-crit/15 text-crit border-crit/20"
                          : "bg-warn/15 text-warn border-warn/20"
                      }`}>
                        {esc.escalation_level}
                      </span>
                    </div>
                    <p className="font-mono text-[9px] text-text-muted mt-0.5">
                      → {esc.target_roles?.join(", ") || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-flat flex flex-col">
              <PanelHeader label="AI Recommendations" action={
                <Sparkles className="size-3 text-cyan" strokeWidth={1.5} />
              } />
              <div className="max-h-[240px] overflow-y-auto">
                {predictedFailures.length === 0 ? (
                  <div className="px-4 py-10 flex flex-col items-center gap-2">
                    <Sparkles className="size-6 text-text-muted" strokeWidth={1} />
                    <p className="text-[12px] text-text-muted">All assets within tolerance</p>
                  </div>
                ) : predictedFailures.slice(0, 4).map((pf, i) => (
                  <div key={i} className="px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-surface-2/20 transition-colors">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="size-3 text-cyan shrink-0 mt-0.5" strokeWidth={2} />
                      <div className="min-w-0">
                        <p className="text-[11px] text-foreground leading-snug">{pf.recommended_action}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[8px] text-text-muted truncate">
                            {(ASSET_DISPLAY_NAMES as any)[pf.asset_id] || pf.asset_id}
                          </span>
                          <span className="text-[8px] text-text-muted">·</span>
                          <span className={`font-mono text-[8px] ${pf.rul_days <= 7 ? "text-crit" : pf.rul_days <= 14 ? "text-warn" : "text-cyan"}`}>
                            {pf.rul_days}d RUL
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Business Exposure Footer */}
        <div className="card-flat">
          <PanelHeader label="Business Exposure" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
            {[
              { l: "Revenue at Risk", v: revenueAtRisk > 0 ? `₹${revenueAtRisk}L` : "—", tone: revenueAtRisk > 0 ? "text-crit" : "text-ok" },
              { l: "Maintenance Backlog", v: `${predictedFailures.length} assets`, tone: predictedFailures.length > 0 ? "text-warn" : "text-ok" },
              { l: "Spare Shortages", v: `${d?.spare_shortages?.length ?? 0} items`, tone: (d?.spare_shortages?.length ?? 0) > 0 ? "text-warn" : "text-ok" },
              { l: "Lines at Risk", v: `${Math.min(criticalAssets.length, 3)} of 3`, tone: criticalAssets.length > 0 ? "text-warn" : "text-ok" },
            ].map((m) => (
              <div key={m.l} className="bg-surface-1 p-4 text-center">
                <div className={`font-mono text-[22px] font-semibold leading-none ${m.tone}`}>{m.v}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted mt-2">{m.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
