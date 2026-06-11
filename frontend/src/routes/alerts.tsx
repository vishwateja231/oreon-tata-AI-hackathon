import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Bell, ArrowUpCircle, TrendingDown, ShieldAlert } from "lucide-react";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { useDashboard, useAlerts, useReadAlert, useActiveRole, useEscalations, useResolveEscalation } from "@/lib/api/hooks";
import { statusBg, statusColor, ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";

type AlertTab = "alerts" | "escalations" | "predicted";

type AlertRow = {
  id: string;
  dbId: number;
  severity: "critical" | "warning" | "info";
  asset: string;
  title: string;
  message: string;
  eta: string;
  time: string;
  is_read: boolean;
};

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alert Center · OREON" }, { name: "description", content: "Centralized alert management." }] }),
  component: Alerts,
});

const FILTERS = ["All", "Critical", "Warning", "Info"] as const;

function Alerts() {
  const [f, setF] = useState<(typeof FILTERS)[number]>("All");
  const [showRead, setShowRead] = useState(true);
  const [tab, setTab] = useState<AlertTab>("alerts");
  const [activeRole] = useActiveRole();
  const dashboard = useDashboard();
  const alertsQuery = useAlerts({ role: activeRole });
  const readAlertMutation = useReadAlert();
  const escalationsQuery = useEscalations();
  const resolveEscalation = useResolveEscalation();
  const escalations = escalationsQuery.data?.active ?? [];
  const activeEscalations = escalations.filter((e: any) => !e.resolved);

  const d = dashboard.data;
  const { isLoading: dashLoading, isError: dashError } = dashboard;
  const { isLoading: alertsLoading, isError: alertsError } = alertsQuery;

  const ALERTS = useMemo<AlertRow[]>(() => {
    const raw = (alertsQuery.data?.alerts ?? []).map((a) => {
      const sev = a.severity.toLowerCase();
      const uiSeverity = (
        sev === "critical"
          ? "critical"
          : (sev === "high" || sev === "medium" || sev === "warning")
          ? "warning"
          : "info"
      ) as AlertRow["severity"];

      return {
        id: `AL-${a.id}`,
        dbId: a.id,
        severity: uiSeverity,
        asset: a.asset_id || "Plant",
        title: a.title,
        message: a.message,
        eta: sev === "critical" ? "4h" : (sev === "high" || sev === "warning") ? "12h" : "24h+",
        time: new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        is_read: a.is_read,
      };
    });

    // Deduplicate: keep only the latest alert per asset+title combo
    const seen = new Map<string, AlertRow>();
    for (const alert of raw) {
      const key = `${alert.asset}::${alert.title}`;
      if (!seen.has(key)) seen.set(key, alert);
    }
    return Array.from(seen.values());
  }, [alertsQuery.data]);

  const list = ALERTS.filter((a) => {
    if (f !== "All" && a.severity !== f.toLowerCase()) return false;
    if (!showRead && a.is_read) return false;
    return true;
  });
  const counts = {
    Critical: ALERTS.filter((a) => a.severity === "critical").length,
    Warning: ALERTS.filter((a) => a.severity === "warning").length,
    Info: ALERTS.filter((a) => a.severity === "info").length,
  };
  const predicted = d?.predicted_failures ?? [];

  return (
    <Shell title="Alert Center" subtitle={alertsLoading ? "Loading…" : alertsError ? "Backend unreachable" : `${ALERTS.filter(x => !x.is_read).length} active signals`}>
      <div className="h-full overflow-y-auto p-6 grid-bg space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[
            { l: "Critical Alerts", v: counts.Critical, t: "critical" as const, sub: "Act within response SLA" },
            { l: "Warning Alerts", v: counts.Warning, t: "warning" as const, sub: "Monitor and schedule" },
            { l: "Info Alerts", v: counts.Info, t: "info" as const, sub: "Procurement/Info logs" },
          ].map((s) => (
            <div key={s.l} className="card-flat p-5 flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted">{s.l}</div>
                <div className={`font-mono text-4xl mt-1 mb-1 leading-none tracking-tight ${s.t === 'critical' ? 'text-crit' : s.t === 'warning' ? 'text-warn' : 'text-cyan'}`}>{s.v}</div>
                <div className="font-mono text-[10px] text-text-secondary">{s.sub}</div>
              </div>
              <div className={`size-2.5 rounded-full ${s.t === 'critical' ? 'bg-crit' : s.t === 'warning' ? 'bg-warn' : 'bg-cyan'} ${s.t === "critical" && s.v > 0 ? "" : ""}`} />
            </div>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-0.5 border-b border-border mb-4">
          {([
            { id: "alerts", label: "Alerts", icon: Bell, count: ALERTS.filter((x) => !x.is_read).length },
            { id: "escalations", label: "Escalations", icon: ArrowUpCircle, count: activeEscalations.length },
            { id: "predicted", label: "Predicted Failures", icon: TrendingDown, count: predicted.length },
          ] as const).map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 h-9 px-4 font-mono text-[11px] uppercase tracking-wider transition-colors ${isActive ? "text-cyan" : "text-text-muted hover:text-foreground"}`}>
                <Icon className="size-3.5" />
                {t.label}
                {t.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${isActive ? "bg-cyan/15 text-cyan" : "bg-surface-2 text-text-muted border border-border"}`}>{t.count}</span>
                )}
                {isActive && <motion.span layoutId="alert-tab-indicator" className="absolute inset-x-0 -bottom-px h-[2px] bg-cyan rounded-full" />}
              </button>
            );
          })}
        </div>

        {tab === "alerts" && (
        <div className="card-flat flex flex-col">
          <PanelHeader label={`Active Alerts Feed (${activeRole.replace("_", " ")})`}
            action={
              <div className="flex gap-1 items-center">
                {FILTERS.map((x) => (
                  <button key={x} onClick={() => setF(x)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest rounded transition-colors ${f === x ? "border border-cyan/30 text-cyan bg-cyan/10" : "border border-transparent text-text-muted hover:bg-surface-1"}`}>{x}</button>
                ))}
                <div className="w-px h-3.5 bg-border mx-1" />
                <button onClick={() => setShowRead(v => !v)}
                  className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest rounded transition-colors border ${showRead ? "border-cyan/30 text-cyan bg-cyan/10" : "border-transparent text-text-muted hover:bg-surface-1"}`}>
                  {showRead ? "Hide read" : "Show all"}
                </button>
              </div>
            } />
          <div className="divide-y divide-border">
            {alertsError && (
              <div className="px-5 py-6 flex items-center gap-3 font-mono text-[11px] text-crit">
                <AlertTriangle className="size-4 shrink-0" />
                Backend unreachable — ensure the API server is running at localhost:8000
              </div>
            )}
            {!alertsError && list.length === 0 && !alertsLoading && (
              <div className="px-5 py-12 font-mono text-[11px] text-text-muted text-center">No alerts in current filter.</div>
            )}
            {!alertsError && list.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`relative overflow-hidden p-4 border-b border-border/80 transition-all duration-200 hover:bg-surface-1/40 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center ${
                  a.is_read
                    ? "opacity-60"
                    : a.severity === "critical"
                    ? "bg-red-500/[0.02] hover:bg-red-500/[0.04]"
                    : a.severity === "warning"
                    ? "bg-amber-500/[0.02] hover:bg-amber-500/[0.04]"
                    : "bg-cyan/5 hover:bg-cyan/8"
                }`}
              >
                {/* Accent line on left */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                    a.is_read
                      ? "bg-muted-foreground/30"
                      : a.severity === "critical"
                      ? "bg-crit"
                      : a.severity === "warning"
                      ? "bg-warn"
                      : "bg-cyan"
                  }`}
                />

                {/* Left: Severity Badge & Icon */}
                <div className="flex items-center gap-3 shrink-0">
                  <div
                    className={`size-8 rounded flex items-center justify-center border ${
                      a.severity === "critical"
                        ? "bg-crit/15 border-crit/35 text-crit"
                        : a.severity === "warning"
                        ? "bg-warn/15 border-warn/35 text-warn"
                        : "bg-cyan/15 border-cyan/35 text-cyan"
                    }`}
                  >
                    {a.severity === "critical" ? (
                      <ShieldAlert className="size-4 animate-pulse" />
                    ) : a.severity === "warning" ? (
                      <AlertTriangle className="size-4" />
                    ) : (
                      <Bell className="size-4" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span
                      className={`text-[9px] font-mono font-bold tracking-wider uppercase ${
                        a.severity === "critical"
                          ? "text-crit"
                          : a.severity === "warning"
                          ? "text-warn"
                          : "text-cyan"
                      }`}
                    >
                      {a.severity}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted">{a.id}</span>
                  </div>
                </div>

                {/* Center: Title, Message, Tags */}
                <div className="flex-1 min-w-0 space-y-1.5 md:pl-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-sans font-semibold text-[13px] text-foreground">
                      {a.title}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted">· {a.time}</span>
                  </div>
                  <p className="text-[12px] text-text-secondary leading-relaxed max-w-4xl">
                    {a.message}
                  </p>

                  {/* Metadata Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="px-2 py-0.5 bg-secondary/35 border border-border/40 rounded-sm font-mono text-[9px] text-text-secondary flex items-center gap-1.5">
                      <span className="text-text-muted">Asset:</span>
                      <span className="text-foreground font-semibold">{ASSET_DISPLAY_NAMES[a.asset] || a.asset}</span>
                      <span className="opacity-60">({a.asset})</span>
                    </span>
                    <span className="px-2 py-0.5 bg-secondary/35 border border-border/40 rounded-sm font-mono text-[9px] text-text-secondary">
                      <span className="text-text-muted">SLA Window:</span> <span className="text-foreground font-semibold">{a.eta} response</span>
                    </span>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0 self-stretch md:self-auto justify-end pt-2 md:pt-0 pl-0 md:pl-4">
                  {!a.is_read && (
                    <button
                      onClick={() => readAlertMutation.mutate({ alertId: a.dbId, role: activeRole })}
                      disabled={readAlertMutation.isPending}
                      className="px-2.5 py-1 bg-cyan/15 border border-cyan/35 text-cyan font-mono text-[10px] uppercase tracking-widest hover:bg-cyan/25 rounded-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all font-semibold"
                    >
                      <CheckCircle className="size-3" /> Acknowledge
                    </button>
                  )}
                  <Link
                    to="/assets/$id"
                    params={{ id: a.asset }}
                    className="px-2.5 py-1 border border-border bg-card hover:bg-secondary text-text-secondary hover:text-foreground font-mono text-[10px] uppercase tracking-widest rounded-sm transition-all"
                  >
                    Investigate &rarr;
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        )}

        {tab === "escalations" && (
          <div className="card-flat flex flex-col">
            <PanelHeader label="Active Escalations" action={
              <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">{activeEscalations.length} open</span>
            } />
            <div className="divide-y divide-border/60 flex-1 overflow-y-auto">
              {escalationsQuery.isError && (
                <div className="px-5 py-6 flex items-center gap-3 font-mono text-[11px] text-crit">
                  <AlertTriangle className="size-4 shrink-0" /> Backend unreachable.
                </div>
              )}
              {!escalationsQuery.isError && activeEscalations.length === 0 && (
                <div className="px-5 py-12 font-mono text-[11px] text-text-muted text-center">
                  {escalationsQuery.isLoading ? "Loading escalations…" : "No active escalations. Shift is nominal."}
                </div>
              )}
              {activeEscalations.map((esc: any, i: number) => {
                const isCrit = String(esc.escalation_level).toLowerCase().includes("crit") || String(esc.escalation_level).toLowerCase().includes("high");
                return (
                  <motion.div
                    key={esc.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={`relative overflow-hidden p-4 border-b border-border/80 transition-all duration-200 hover:bg-surface-1/40 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center ${
                      isCrit ? "bg-red-500/[0.02] hover:bg-red-500/[0.04]" : "bg-warn/5 hover:bg-warn/8"
                    }`}
                  >
                    {/* Side accent glow line */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${isCrit ? "bg-crit" : "bg-warn"}`} />

                    {/* Left: Escalation Badge */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className={`size-8 rounded flex items-center justify-center border ${isCrit ? "bg-crit/15 border-crit/35 text-crit" : "bg-warn/15 border-warn/35 text-warn"}`}>
                        <ShieldAlert className={`size-4 ${isCrit ? "animate-pulse" : ""}`} />
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-[9px] font-mono font-bold tracking-wider uppercase ${isCrit ? "text-crit" : "text-warn"}`}>
                          {esc.escalation_level || "HIGH"}
                        </span>
                        <span className="text-[10px] font-mono text-text-muted">ESC-{esc.id}</span>
                      </div>
                    </div>

                    {/* Center: Detail and metadata tags */}
                    <div className="flex-1 min-w-0 space-y-1.5 md:pl-2">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-sans font-semibold text-[13px] text-foreground">
                          Critical Operations Escalation
                        </span>
                        <span className="text-[10px] font-mono text-text-muted">· Active SLA</span>
                      </div>
                      <p className="text-[12px] text-text-secondary leading-relaxed max-w-4xl">
                        {esc.reason || "Manual escalation raised by operator."}
                      </p>

                      {/* Metadata Tags */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="px-2 py-0.5 bg-secondary/35 border border-border/40 rounded-sm font-mono text-[9px] text-text-secondary flex items-center gap-1.5">
                          <span className="text-text-muted">Asset:</span>
                          <span className="text-foreground font-semibold">{ASSET_DISPLAY_NAMES[esc.asset_id] || esc.asset_id}</span>
                          <span className="opacity-60">({esc.asset_id})</span>
                        </span>
                        <span className="px-2 py-0.5 bg-secondary/35 border border-border/40 rounded-sm font-mono text-[9px] text-text-secondary">
                          <span className="text-text-muted">Roles Routing:</span> <span className="text-foreground font-semibold">{esc.target_roles || "all"}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-stretch md:self-auto justify-end pt-2 md:pt-0 pl-0 md:pl-4">
                      <button
                        onClick={() => resolveEscalation.mutate(esc.id)}
                        disabled={resolveEscalation.isPending}
                        className="px-2.5 py-1 bg-cyan/15 border border-cyan/35 text-cyan font-mono text-[10px] uppercase tracking-widest hover:bg-cyan/25 rounded-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all font-semibold"
                      >
                        <CheckCircle className="size-3" /> Resolve
                      </button>
                      <Link
                        to="/assets/$id"
                        params={{ id: esc.asset_id }}
                        className="px-2.5 py-1 border border-border bg-card hover:bg-secondary text-text-secondary hover:text-foreground font-mono text-[10px] uppercase tracking-widest rounded-sm transition-all"
                      >
                        Investigate &rarr;
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "predicted" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-7 card-flat flex flex-col">
            <PanelHeader label="Upcoming Failures · 30-day forecast" />
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {predicted.length === 0 && (
                <div className="font-mono text-[11px] text-text-muted py-4 text-center">
                  {dashLoading ? "Loading forecast…" : dashError ? "Backend unreachable" : "No failures predicted."}
                </div>
              )}
              {predicted.slice(0, 6).map((pf) => (
                <div key={pf.asset_id} className="p-3 bg-surface-2/45 border border-border rounded flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-foreground font-semibold">{ASSET_DISPLAY_NAMES[pf.asset_id] || pf.asset_name || pf.asset_id}</span>
                      <span className="font-mono text-[10px] text-text-muted">({pf.asset_id})</span>
                    </div>
                    <div className="font-mono text-[10px] text-text-secondary uppercase tracking-widest bg-surface-1 border border-border px-2 py-0.5 rounded">{Math.round(pf.failure_probability * 100)}% probability</div>
                  </div>
                  <div className="text-[13px] text-text-secondary leading-snug">{pf.recommended_action}</div>
                  <div className="relative h-1.5 bg-background border border-border/40 overflow-hidden rounded-full mt-1">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(4, (1 - pf.rul_days / 30) * 100)}%` }} transition={{ duration: 1 }}
                      className={`h-full ${pf.rul_days < 14 ? "bg-crit" : "bg-warn"}`} />
                  </div>
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className="text-text-muted uppercase tracking-widest">Time to failure</span>
                    <span className={`font-bold ${pf.rul_days < 14 ? "text-crit" : "text-warn"}`}>{pf.rul_days} days</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 card-flat flex flex-col">
            <PanelHeader label="High Priority Actions" />
            <div className="divide-y divide-border/60 flex-1 overflow-y-auto">
              {predicted.length === 0 && (
                <div className="px-4 py-6 font-mono text-[11px] text-text-muted text-center">No actions queued.</div>
              )}
              {predicted.slice(0, 6).map((pf) => {
                const p = pf.failure_probability >= 0.6 ? "P0" : pf.failure_probability >= 0.4 ? "P1" : "P2";
                return (
                  <div key={pf.asset_id} className="p-4 flex items-start gap-3 hover:bg-surface-1/40 transition-colors">
                    <div className={`mt-0.5 font-mono text-[9px] px-1.5 py-0.5 border rounded uppercase font-bold shrink-0 ${p === "P0" ? "border-crit/30 text-crit bg-crit/15" : p === "P1" ? "border-warn/30 text-warn bg-warn/15" : "border-cyan/30 text-cyan bg-cyan/15"}`}>{p}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground/90 leading-snug">{pf.recommended_action}</div>
                      <div className="font-mono text-[10px] text-text-muted mt-1.5">{ASSET_DISPLAY_NAMES[pf.asset_id] || pf.asset_name || pf.asset_id} · {pf.equipment_type}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}
      </div>
    </Shell>
  );
}