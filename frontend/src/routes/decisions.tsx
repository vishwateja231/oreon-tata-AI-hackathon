import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line, AreaChart, Area, Cell, PieChart, Pie } from "recharts";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBusinessRisks,
  useMaintenanceActions,
  usePriorityAssets,
  useProcurementRisks,
  useUpdateAsset,
  useCreateLogEntry,
  useCreateManualEscalation,
  useActiveRole,
  useAlerts,
  useAssets,
} from "@/lib/api/hooks";
import { z } from "zod";
import { FileText, TrendingDown, TrendingUp, AlertTriangle, CheckCircle, DollarSign, Activity, Target, Zap, Package, BarChart3, Clock, Download, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { reportApi } from "@/lib/api/endpoints";

export const Route = createFileRoute("/decisions")({
  validateSearch: z.object({ tab: z.string().optional() }),
  // Static title — reading localStorage/window here diverges between SSR (no
  // window) and client, which triggers a hydration mismatch. The in-app header
  // already shows the role-specific title.
  head: () => ({
    meta: [
      { title: "Decision Center · OREON" },
      { name: "description", content: "Prioritized maintenance decisions and business impact." },
    ],
  }),
  component: Decisions,
});

function formatAssetId(id: string): string {
  return id
    .replace(/([A-Z][a-z]+)([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function titleCase(s: string) {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function bandTone(band: string) {
  const b = band.toLowerCase();
  if (b.includes("p0") || b.includes("crit") || b.includes("high")) return "text-red-signal";
  if (b.includes("p1") || b.includes("med")) return "text-amber-signal";
  return "text-green-signal";
}

function formatINR(v: number): string {
  const absVal = Math.abs(v);
  if (absVal >= 1_00_00_000) {
    return `₹${(v / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (absVal >= 1_00_000) {
    return `₹${(v / 1_00_000).toFixed(1)}L`;
  }
  return `₹${v.toLocaleString("en-IN")}`;
}

function formatROI(roi: number): string {
  if (roi >= 100) {
    return `${(roi / 100).toFixed(0)}x`;
  }
  return `${roi}%`;
}

function Ring({ value, label }: { value: number; label: string }) {
  const c = 2 * Math.PI * 62;
  return (
    <div className="relative size-44">
      <svg viewBox="0 0 160 160" className="rotate-[-90deg]">
        <circle cx="80" cy="80" r="62" stroke="oklch(0.28 0.018 250)" strokeWidth="10" fill="none" />
        <motion.circle cx="80" cy="80" r="62" stroke="oklch(0.72 0.18 240)" strokeWidth="10" fill="none" strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${(Math.min(100, value) / 100) * c} ${c}` }}
          transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ filter: "drop-shadow(0 0 8px oklch(0.72 0.18 240 / 0.5))" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-5xl text-glow text-electric">{value}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}

/* ── REPORTS TAB ── */
function ReportsTab() {
  const priority = usePriorityAssets(20);
  const actions = useMaintenanceActions(20);
  const business = useBusinessRisks(20);
  const [activeRole] = useActiveRole();

  const assets = priority.data ?? [];
  const criticalCount = assets.filter(a => (a.health_score ?? 100) < 50).length;
  const warningCount = assets.filter(a => (a.health_score ?? 100) >= 50 && (a.health_score ?? 100) < 75).length;
  const healthyCount = assets.filter(a => (a.health_score ?? 100) >= 75).length;
  const avgHealth = assets.length > 0 ? Math.round(assets.reduce((sum, a) => sum + (a.health_score ?? 0), 0) / assets.length) : 0;

  const healthTrend = Array.from({ length: 12 }, (_, i) => ({
    month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i],
    health: 72 + Math.sin(i / 2.2) * 6 + (i > 8 ? -4 : 0),
    failures: Math.round(1 + Math.cos(i / 2) * 0.8),
    maintenance: Math.round(3 + Math.sin(i / 3) * 1.5),
  }));

  const mttrData = [
    { name: "Rolling Mill", mttr: 4.2, mtbf: 312, availability: 98.7 },
    { name: "Blast Furnace", mttr: 6.8, mtbf: 480, availability: 98.6 },
    { name: "Cooling System", mttr: 2.1, mtbf: 720, availability: 99.7 },
    { name: "Conv. Belt", mttr: 3.5, mtbf: 240, availability: 98.5 },
    { name: "Power Supply", mttr: 1.2, mtbf: 1440, availability: 99.9 },
  ];

  const actionSummary = (actions.data ?? []).reduce((acc, a) => {
    const band = a.priority_band?.toLowerCase() ?? "medium";
    if (band.includes("crit") || band.includes("p0")) acc.critical++;
    else if (band.includes("high") || band.includes("p1")) acc.high++;
    else acc.medium++;
    return acc;
  }, { critical: 0, high: 0, medium: 0 });

  const totalActions = actionSummary.critical + actionSummary.high + actionSummary.medium;

  return (
    <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-4 grid-bg">
      {/* Header Badges */}
      <div className="col-span-12 flex justify-end">
        <span className="inline-flex items-center gap-2 h-8 px-3 rounded border border-electric/30 bg-electric/10 font-mono text-[10px] text-electric uppercase tracking-wider">
          <FileText className="size-3" /> Executive Report
        </span>
      </div>

      {/* KPI Summary Row */}
      {[
        { label: "Avg. Plant Health", value: `${avgHealth}%`, sub: "Across all assets", icon: Activity, color: avgHealth >= 75 ? "text-green-signal border-green-signal/30 bg-green-signal/8" : avgHealth >= 50 ? "text-amber-signal border-amber-signal/30 bg-amber-signal/8" : "text-red-signal border-red-signal/30 bg-red-signal/8" },
        { label: "Critical Assets", value: criticalCount, sub: "Require immediate action", icon: AlertTriangle, color: criticalCount > 0 ? "text-red-signal border-red-signal/30 bg-red-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
        { label: "Warning Assets", value: warningCount, sub: "Monitor & schedule", icon: TrendingDown, color: warningCount > 0 ? "text-amber-signal border-amber-signal/30 bg-amber-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
        { label: "Healthy Assets", value: healthyCount, sub: "Optimal performance", icon: CheckCircle, color: "text-green-signal border-green-signal/30 bg-green-signal/8" },
        { label: "Total Actions", value: totalActions, sub: `${actionSummary.critical} critical queued`, icon: Target, color: "text-electric border-electric/30 bg-electric/8" },
      ].map((kpi, i) => (
        <motion.div
          key={kpi.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className={`col-span-12 md:col-span-6 lg:col-span-2 panel p-4 border ${kpi.color}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{kpi.label}</span>
            <kpi.icon className="size-3.5 opacity-60" />
          </div>
          <div className="font-mono text-[28px] font-bold leading-none">{kpi.value}</div>
          <div className="font-mono text-[9px] text-muted-foreground mt-1">{kpi.sub}</div>
        </motion.div>
      ))}
      <div className="col-span-12 md:col-span-6 lg:col-span-2 panel p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Actions Queue</span>
          <Zap className="size-3.5 text-muted-foreground opacity-60" />
        </div>
        <div className="space-y-1.5 mt-1">
          {[
            { l: "Critical", v: actionSummary.critical, c: "text-red-signal bg-red-signal/10" },
            { l: "High", v: actionSummary.high, c: "text-amber-signal bg-amber-signal/10" },
            { l: "Medium", v: actionSummary.medium, c: "text-electric bg-electric/10" },
          ].map(s => (
            <div key={s.l} className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-muted-foreground">{s.l}</span>
              <span className={`font-mono text-[11px] font-semibold px-1.5 rounded ${s.c}`}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plant Health Trend Chart */}
      <div className="col-span-12 lg:col-span-8 panel">
        <PanelHeader label="Plant Health Trend — 12 Month" />
        <div className="p-4 h-52">
          <ResponsiveContainer>
            <AreaChart data={healthTrend} margin={{ left: -8 }}>
              <defs>
                <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.18 240)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.72 0.18 240)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(0.30 0.02 250 / 0.4)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="month" stroke="oklch(0.65 0.02 240)" fontSize={10} />
              <YAxis stroke="oklch(0.65 0.02 240)" fontSize={10} domain={[60, 100]} />
              <Tooltip contentStyle={{ background: "oklch(0.14 0.012 250)", border: "1px solid oklch(0.32 0.02 250)", fontFamily: "JetBrains Mono", fontSize: 11 }} />
              <Area type="monotone" dataKey="health" stroke="oklch(0.72 0.18 240)" fill="url(#healthGrad)" strokeWidth={2} dot={false} name="Health %" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Maintenance Actions Breakdown */}
      <div className="col-span-12 lg:col-span-4 panel">
        <PanelHeader label="Maintenance Breakdown" />
        <div className="p-4 h-52">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={[
                  { name: "Critical", value: actionSummary.critical, fill: "oklch(0.65 0.22 25)" },
                  { name: "High", value: actionSummary.high, fill: "oklch(0.80 0.18 80)" },
                  { name: "Medium", value: Math.max(1, actionSummary.medium), fill: "oklch(0.72 0.18 240)" },
                ]}
                cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value"
              >
                {[0, 1, 2].map((_, i) => <Cell key={i} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "oklch(0.14 0.012 250)", border: "1px solid oklch(0.32 0.02 250)", fontFamily: "JetBrains Mono", fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* MTTR / MTBF Table */}
      <div className="col-span-12 lg:col-span-6 panel">
        <PanelHeader label="Reliability Metrics — MTTR / MTBF" />
        <div className="p-3">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/60">
                <th className="pb-2 text-left text-[9px] text-muted-foreground uppercase tracking-widest">System</th>
                <th className="pb-2 text-right text-[9px] text-muted-foreground uppercase tracking-widest">MTTR (h)</th>
                <th className="pb-2 text-right text-[9px] text-muted-foreground uppercase tracking-widest">MTBF (h)</th>
                <th className="pb-2 text-right text-[9px] text-muted-foreground uppercase tracking-widest">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {mttrData.map((row) => (
                <tr key={row.name} className="hover:bg-surface-1/30 transition-colors">
                  <td className="py-2 text-foreground/80">{row.name}</td>
                  <td className={`py-2 text-right ${row.mttr > 5 ? "text-red-signal" : row.mttr > 3 ? "text-amber-signal" : "text-green-signal"}`}>{row.mttr}</td>
                  <td className="py-2 text-right text-electric">{row.mtbf}</td>
                  <td className={`py-2 text-right font-semibold ${row.availability >= 99.5 ? "text-green-signal" : row.availability >= 98.5 ? "text-amber-signal" : "text-red-signal"}`}>{row.availability}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Maintenance Actions List */}
      <div className="col-span-12 lg:col-span-6 panel flex flex-col">
        <PanelHeader label="Queued Actions Report" action={<span className="font-mono text-[10px] text-muted-foreground">{(actions.data ?? []).length} total</span>} />
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-52">
          {(actions.data ?? []).slice(0, 8).map((s, i) => {
            const band = s.priority_band?.toLowerCase() ?? "";
            const isCrit = band.includes("crit") || band.includes("p0");
            const isHigh = band.includes("high") || band.includes("p1");
            const badgeBg = isCrit ? "bg-red-signal/10 text-red-signal border-red-signal/30" : isHigh ? "bg-amber-signal/10 text-amber-signal border-amber-signal/30" : "bg-secondary text-muted-foreground border-border";
            return (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-surface-1/30 border border-border/40 hover:border-border transition-colors">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${badgeBg} shrink-0`}>{s.priority_band}</span>
                <span className="font-mono text-[10px] text-electric shrink-0">{formatAssetId(s.asset_id)}</span>
                <span className="text-[11px] text-foreground/80 truncate flex-1">{s.action}</span>
                <span className="font-mono text-[9px] text-muted-foreground shrink-0">{s.due_window}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Asset Status Table */}
      <div className="col-span-12 panel">
        <PanelHeader label="Asset Health Status Report" action={<span className="font-mono text-[10px] text-muted-foreground">{assets.length} assets</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/60">
                {["Asset ID", "Name", "Health", "Failure Prob.", "RUL (days)", "Priority Band", "Status", "Report"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {assets.slice(0, 10).map((a) => {
                const health = a.health_score ?? 0;
                const failProb = Math.round((a.failure_probability ?? 0) * 100);
                const rul = a.rul_days ?? 0;
                const band = a.priority?.priority_band ?? "—";
                return (
                  <tr key={a.asset_id} className="hover:bg-surface-1/30 transition-colors">
                    <td className="px-3 py-2 text-electric">{formatAssetId(a.asset_id)}</td>
                    <td className="px-3 py-2 text-foreground/80">{a.asset_name}</td>
                    <td className={`px-3 py-2 font-semibold ${health < 50 ? "text-red-signal" : health < 75 ? "text-amber-signal" : "text-green-signal"}`}>{health}%</td>
                    <td className={`px-3 py-2 ${failProb > 60 ? "text-red-signal" : failProb > 40 ? "text-amber-signal" : "text-green-signal"}`}>{failProb}%</td>
                    <td className={`px-3 py-2 ${rul < 7 ? "text-red-signal" : rul < 14 ? "text-amber-signal" : "text-electric"}`}>{rul}d</td>
                    <td className={`px-3 py-2 ${bandTone(band)}`}>{band}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${health < 50 ? "bg-red-signal/10 text-red-signal" : health < 75 ? "bg-amber-signal/10 text-amber-signal" : "bg-green-signal/10 text-green-signal"}`}>
                        {health < 50 ? "Critical" : health < 75 ? "Warning" : "Nominal"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => window.open(reportApi.downloadUrl(a.asset_id, "pdf"), "_blank")}
                        className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-foreground transition-colors cursor-pointer"
                        title="Download PDF Report"
                      >
                        <Download className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── BUSINESS IMPACT TAB ── */
function BusinessImpactTab() {
  const business = useBusinessRisks(20);
  const procurement = useProcurementRisks();
  const priority = usePriorityAssets(20);
  const [activeRole] = useActiveRole();

  const risks = business.data ?? [];
  const totalExposure = risks.reduce((s, r) => s + (r.revenue_exposure_inr || 0), 0);
  const totalDowntime = risks.reduce((s, r) => s + (r.estimated_downtime_hours || 0), 0);
  const totalInactionCost = risks.reduce((s, r) => s + (r.cost_of_inaction_inr || 0), 0);
  const totalActionCost = risks.reduce((s, r) => s + (r.cost_of_action_inr || 0), 0);

  const exposureData = risks.slice(0, 8).map(r => ({
    asset: formatAssetId(r.asset_id),
    exposure: Math.round((r.revenue_exposure_inr || 0) / 1_00_000),
    inaction: Math.round((r.cost_of_inaction_inr || 0) / 1_00_000),
    action: Math.round((r.cost_of_action_inr || 0) / 1_00_000),
  }));

  const roiData = risks.slice(0, 6).map(r => {
    const savings = (r.cost_of_inaction_inr || 0) - (r.cost_of_action_inr || 0);
    const roi = r.cost_of_action_inr ? Math.round((savings / r.cost_of_action_inr) * 100) : 0;
    return { asset: formatAssetId(r.asset_id), roi, savings: Math.round(savings / 1_00_000), risk: r.business_risk };
  });

  const maxSavings = roiData.length ? Math.max(...roiData.map(r => r.savings), 1) : 1;

  const lowStock = (procurement.data ?? []).filter(p => p.stock_quantity <= p.reorder_level);
  const critAssets = (priority.data ?? []).filter(a => (a.health_score ?? 100) < 50);

  return (
    <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-4 grid-bg">
      {/* Header Badges */}
      <div className="col-span-12 flex justify-end gap-3">
        <span className="inline-flex items-center gap-2 h-8 px-3 rounded border border-red-signal/30 bg-red-signal/10 font-mono text-[10px] text-red-signal">
          <AlertTriangle className="size-3" /> {critAssets.length} Critical Assets
        </span>
        <span className="inline-flex items-center gap-2 h-8 px-3 rounded border border-amber-signal/30 bg-amber-signal/10 font-mono text-[10px] text-amber-signal">
          <Package className="size-3" /> {lowStock.length} Parts Below Reorder
        </span>
      </div>

      {/* Financial KPIs */}
      {[
        { label: "Total Revenue Exposure", value: formatINR(totalExposure), sub: "Combined risk across all assets", color: "text-red-signal border-red-signal/30 bg-red-signal/8", icon: DollarSign },
        { label: "Cost of Inaction", value: `${formatINR(totalInactionCost)}/hr`, sub: "Cascade failure operational cost", color: "text-amber-signal border-amber-signal/30 bg-amber-signal/8", icon: TrendingDown },
        { label: "Repair Investment", value: formatINR(totalActionCost), sub: "Total planned maintenance budget", color: "text-electric border-electric/30 bg-electric/8", icon: Zap },
        { label: "Est. Downtime Hours", value: `${Math.round(totalDowntime)}h`, sub: "At-risk production time", color: "text-amber-signal border-amber-signal/30 bg-amber-signal/8", icon: Clock },
        { label: "Net Savings (Action)", value: formatINR(totalInactionCost - totalActionCost), sub: "vs. inaction scenario", color: "text-green-signal border-green-signal/30 bg-green-signal/8", icon: TrendingUp },
        { label: "Production Lines at Risk", value: new Set(risks.map(r => r.production_line).filter(Boolean)).size, sub: "Lines affected by degradation", color: "text-red-signal border-red-signal/30 bg-red-signal/8", icon: Activity },
      ].map((kpi, i) => (
        <motion.div
          key={kpi.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className={`col-span-12 md:col-span-6 lg:col-span-2 panel p-4 border ${kpi.color}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{kpi.label}</span>
            <kpi.icon className="size-3.5 opacity-60" />
          </div>
          <div className="font-mono text-[20px] font-bold leading-tight">{kpi.value}</div>
          <div className="font-mono text-[9px] text-muted-foreground mt-1">{kpi.sub}</div>
        </motion.div>
      ))}

      {/* Revenue Exposure by Asset */}
      <div className="col-span-12 lg:col-span-8 panel">
        <PanelHeader label="Revenue Exposure by Asset · ₹ Lakhs" />
        <div className="p-4 h-60">
          {exposureData.length ? (
            <ResponsiveContainer>
              <BarChart data={exposureData} layout="vertical" margin={{ left: 15, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid stroke="oklch(0.30 0.02 250 / 0.4)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke="oklch(0.65 0.02 240)" fontSize={10} />
                <YAxis type="category" dataKey="asset" stroke="oklch(0.65 0.02 240)" fontSize={10} width={140} tick={{ fontFamily: "JetBrains Mono" }} />
                <Tooltip
                  cursor={{ fill: "rgba(255, 255, 255, 0.03)" }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-lg border border-border bg-surface-1 p-3 shadow-xl">
                          <div className="font-mono text-[11px] font-bold text-foreground mb-2">{label}</div>
                          <div className="space-y-1.5 font-mono text-[11px]">
                            {payload.map((item) => {
                              let color = "oklch(0.90 0.01 250)";
                              if (item.name === "Total Revenue Exposure") color = "oklch(0.65 0.22 25)";
                              else if (item.name === "Cost of Inaction") color = "oklch(0.80 0.18 80)";
                              else if (item.name === "Repair Investment") color = "oklch(0.72 0.18 240)";
                              return (
                                <div key={item.name} className="flex items-center justify-between gap-6" style={{ color }}>
                                  <span>{item.name}:</span>
                                  <span className="font-semibold">{formatINR(Number(item.value) * 100_000)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="exposure" fill="oklch(0.65 0.22 25)" radius={[0, 3, 3, 0]} name="Total Revenue Exposure" />
                <Bar dataKey="inaction" fill="oklch(0.80 0.18 80)" radius={[0, 3, 3, 0]} name="Cost of Inaction" />
                <Bar dataKey="action" fill="oklch(0.72 0.18 240)" radius={[0, 3, 3, 0]} name="Repair Investment" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full grid place-items-center font-mono text-[11px] text-muted-foreground">
              {business.isLoading ? "Loading..." : "No business risk data"}
            </div>
          )}
        </div>
      </div>

      {/* ROI Analysis */}
      <div className="col-span-12 lg:col-span-4 panel">
        <PanelHeader label="Maintenance ROI Analysis" />
        <div className="p-4 space-y-3">
          {roiData.length === 0 && (
            <div className="py-4 text-center font-mono text-[11px] text-muted-foreground">No risk data available</div>
          )}
          {roiData.map((r) => (
            <div key={r.asset} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-electric">{r.asset}</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${bandTone(r.risk ?? "")} border border-current/30 bg-current/10`}>{r.risk}</span>
                  <span className="font-mono text-[11px] font-semibold text-green-signal">{formatROI(r.roi)} ROI</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-green-signal rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(r.savings / maxSavings) * 100}%` }}
                    transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                </div>
                <span className="font-mono text-[9px] text-green-signal shrink-0">{formatINR(r.savings * 100_000)} saved</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Asset Risk Matrix */}
      <div className="col-span-12 lg:col-span-7 panel flex flex-col">
        <PanelHeader label="Asset Business Risk Matrix" />
        <div className="flex-1 overflow-y-auto p-3">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-border/60">
                {["Asset", "Production Line", "Revenue Exposure", "Downtime", "Risk Level", "Action Cost", "ROI", "Report"].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {risks.map((r) => {
                const savings = (r.cost_of_inaction_inr || 0) - (r.cost_of_action_inr || 0);
                const roi = r.cost_of_action_inr ? Math.round((savings / r.cost_of_action_inr) * 100) : 0;
                return (
                  <tr key={r.asset_id} className="hover:bg-surface-1/30 transition-colors">
                    <td className="px-2 py-2 text-electric">{formatAssetId(r.asset_id)}</td>
                    <td className="px-2 py-2 text-foreground/70">{r.production_line || "—"}</td>
                    <td className="px-2 py-2 text-red-signal font-semibold">{formatINR(r.revenue_exposure_inr || 0)}</td>
                    <td className="px-2 py-2 text-amber-signal">{r.estimated_downtime_hours || 0}h</td>
                    <td className={`px-2 py-2 font-semibold ${bandTone(r.business_risk ?? "")}`}>{r.business_risk}</td>
                    <td className="px-2 py-2 text-electric">{formatINR(r.cost_of_action_inr || 0)}</td>
                    <td className={`px-2 py-2 font-semibold ${roi > 200 ? "text-green-signal" : roi > 100 ? "text-electric" : "text-amber-signal"}`}>{formatROI(roi)}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => window.open(reportApi.downloadUrl(r.asset_id, "pdf"), "_blank")}
                        className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-foreground transition-colors cursor-pointer"
                        title="Download PDF Report"
                      >
                        <Download className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Spare Parts Risk */}
      <div className="col-span-12 lg:col-span-5 panel flex flex-col">
        <PanelHeader label="Procurement Risk — Low Stock" action={<span className="font-mono text-[10px] text-amber-signal">{lowStock.length} below reorder</span>} />
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {lowStock.length === 0 && (
            <div className="py-8 text-center font-mono text-[11px] text-green-signal">All parts adequately stocked</div>
          )}
          {lowStock.map((p) => {
            const gap = p.reorder_level - p.stock_quantity;
            const urgency = gap > p.reorder_level * 0.5 ? "critical" : gap > 0 ? "warning" : "ok";
            return (
              <div key={p.part_id} className={`rounded border p-2.5 ${urgency === "critical" ? "border-red-signal/30 bg-red-signal/5" : "border-amber-signal/30 bg-amber-signal/5"}`}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="font-mono text-[10px] text-electric">{p.part_id}</span>
                    <span className="text-[11px] text-foreground ml-2">{p.part_name}</span>
                  </div>
                  <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded uppercase ${urgency === "critical" ? "bg-red-signal/15 text-red-signal" : "bg-amber-signal/15 text-amber-signal"}`}>
                    {urgency === "critical" ? "Critical" : "Low Stock"}
                  </span>
                </div>
                <div className="flex items-center gap-4 font-mono text-[9px] text-muted-foreground">
                  <span>Stock: <span className="text-red-signal font-semibold">{p.stock_quantity}</span></span>
                  <span>Reorder: {p.reorder_level}</span>
                  <span>Lead: {p.lead_time_days}d</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Production Impact Summary */}
      <div className="col-span-12 panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Executive Summary — Business Case for Proactive Maintenance</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded border border-red-signal/20 bg-red-signal/5 p-4">
            <div className="font-mono text-[9px] text-red-signal uppercase tracking-widest mb-2">Cost of Inaction</div>
            <div className="font-mono text-[22px] font-bold text-red-signal">{formatINR(totalInactionCost)}/hr</div>
            <p className="text-[11px] text-foreground/70 mt-1.5 leading-relaxed">
              Unplanned failure across critical assets halts downstream production, resulting in cascading losses across all production lines.
            </p>
          </div>
          <div className="rounded border border-electric/20 bg-electric/5 p-4">
            <div className="font-mono text-[9px] text-electric uppercase tracking-widest mb-2">Investment Required</div>
            <div className="font-mono text-[22px] font-bold text-electric">{formatINR(totalActionCost)}</div>
            <p className="text-[11px] text-foreground/70 mt-1.5 leading-relaxed">
              Total planned maintenance investment to prevent all identified critical failures. Includes spare parts, labor, and scheduled downtime costs.
            </p>
          </div>
          <div className="rounded border border-green-signal/20 bg-green-signal/5 p-4">
            <div className="font-mono text-[9px] text-green-signal uppercase tracking-widest mb-2">Net Financial Benefit</div>
            <div className="font-mono text-[22px] font-bold text-green-signal">{formatINR(totalInactionCost - totalActionCost)}</div>
            <p className="text-[11px] text-foreground/70 mt-1.5 leading-relaxed">
              Proactive maintenance delivers significant ROI by preventing unplanned downtime, extending asset life, and maintaining optimal production throughput.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Standalone Procurement page was moved to frontend/src/routes/procurement.tsx

/* ── MAIN DECISIONS COMPONENT ── */
function Decisions() {
  const [activeRole] = useActiveRole();

  // In-page tab bar — Procurement is intentionally NOT here; it's a dedicated
  // sidebar destination (rendered full-page when ?tab=procurement).
  const tabs =
    activeRole === "plant_manager" || activeRole === "reliability_engineer" || activeRole === "supervisor"
      ? [
        { id: "decisions", label: "Decision Center", icon: Target },
        { id: "reports", label: "Reports", icon: FileText },
        { id: "business-impact", label: "Business Impact", icon: BarChart3 },
      ]
      : [];

  const search = Route.useSearch();
  const activeTab = (search.tab as string) || "decisions";
  const showTabBar = tabs.length > 1;

  const queryClient = useQueryClient();
  const priority = usePriorityAssets(10);
  const business = useBusinessRisks(10);
  const actions = useMaintenanceActions(12);
  const procurement = useProcurementRisks();

  const updateAsset = useUpdateAsset();
  const createLog = useCreateLogEntry();
  const createEscalation = useCreateManualEscalation();

  const isPending = updateAsset.isPending || createLog.isPending || createEscalation.isPending;

  const top = priority.data?.[0];

  const handleApprove = async () => {
    if (!top) return;
    try {
      await updateAsset.mutateAsync({
        id: top.asset_id,
        body: { status: "maintenance", health_score: 100 }
      });
      await createLog.mutateAsync({
        asset_id: top.asset_id,
        issue: "Planned maintenance approved from Decision Center",
        root_cause: top.priority.priority_reason || "Scheduled / Priority action",
        action: "Approve maintenance schedule",
        engineer_notes: "Maintenance approved by executive command"
      });
      queryClient.invalidateQueries({ queryKey: ["priority-assets"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (err) {
      console.error("Failed to approve:", err);
    }
  };

  const handleDefer = async () => {
    if (!top) return;
    const currentRul = top.rul_days ?? 0;
    try {
      await updateAsset.mutateAsync({
        id: top.asset_id,
        body: { rul_days: currentRul + 14 }
      });
      await createLog.mutateAsync({
        asset_id: top.asset_id,
        issue: "Maintenance schedule deferred by 14 days",
        root_cause: "Operational requirements",
        action: "Defer maintenance schedule",
        engineer_notes: `Extended RUL from ${currentRul} days to ${currentRul + 14} days`
      });
      queryClient.invalidateQueries({ queryKey: ["priority-assets"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (err) {
      console.error("Failed to defer:", err);
    }
  };

  const handleEscalate = async () => {
    if (!top) return;
    try {
      await createEscalation.mutateAsync({
        asset_id: top.asset_id,
        escalation_level: "high",
        reason: `Decisions Center manual escalation. Reason: ${top.priority.priority_reason || "Degraded state/High priority score"}`
      });
      queryClient.invalidateQueries({ queryKey: ["priority-assets"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    } catch (err) {
      console.error("Failed to escalate:", err);
    }
  };
  const score = top ? Math.round(top.priority.priority_score) : 0;
  const band = top?.priority.priority_band ?? "—";
  const radar = top
    ? Object.entries(top.priority.score_components).map(([k, v]) => ({ k: titleCase(k), v: Math.round(Number(v)) }))
    : [];
  const impact = (business.data ?? []).slice(0, 6).map((b) => ({ c: formatAssetId(b.asset_id), v: Number(b.impact_score.toFixed?.(1) ?? b.impact_score) }));
  const topRisk = business.data?.[0];
  const lowStock = procurement.data?.filter((p) => p.stock_quantity <= p.reorder_level).length ?? 0;

  const subtitle = priority.isLoading
    ? "Loading decision packet…"
    : priority.isError
      ? "Backend unreachable"
      : top
        ? `${formatAssetId(top.asset_id)} · ${top.asset_name} · Score ${score}`
        : "Prioritized recommendation packet";

  // Dynamic header based on active tab
  let pageTitle = activeRole === "reliability_engineer" ? "Reliability Analytics" : "Decision Center";
  let pageSubtitle = subtitle;

  if (activeTab === "reports") {
    pageTitle = "OREON Maintenance Report";
    pageSubtitle = `Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  } else if (activeTab === "business-impact") {
    pageTitle = "Business Impact Analysis";
    pageSubtitle = "Real-time financial exposure from asset degradation";
  }

  return (
    <Shell title={pageTitle} subtitle={pageSubtitle}>
      <div className="h-full flex flex-col">

        {/* In-page tab nav — Decision Center / Reports / Business Impact. Procurement
            is a separate sidebar destination, so the bar is hidden on that view. */}
        {showTabBar && (
          <div className="shrink-0 flex items-center justify-between px-6 pt-4 pb-3 border-b border-border bg-surface-1/30">
            <div className="flex items-center gap-1">
              {tabs.map((t) => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <Link
                    key={t.id}
                    to="/decisions"
                    search={{ tab: t.id }}
                    className={`inline-flex items-center gap-2 h-9 px-4 rounded-md font-mono text-[11px] uppercase tracking-wide transition-colors ${
                      isActive
                        ? "bg-cyan/15 text-cyan border border-cyan/30"
                        : "text-text-secondary border border-transparent hover:text-foreground hover:bg-surface-2/50"
                    }`}
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                    {t.label}
                  </Link>
                );
              })}
            </div>

            {top && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md font-mono text-[11px] uppercase tracking-wide border border-border bg-surface-2 hover:bg-surface-2/80 transition-colors cursor-pointer focus:outline-none">
                    <Download className="size-3.5" />
                    Export
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {/* Page-level report first — the whole maintenance / business report
                      that this tab actually shows, not a single asset. */}
                  {activeTab === "business-impact" ? (
                    <DropdownMenuItem
                      onClick={() => window.open(reportApi.plantUrl("business", "pdf"), "_blank")}
                      className="text-xs font-mono cursor-pointer flex items-center gap-2 focus:bg-surface-2 focus:text-foreground"
                    >
                      <BarChart3 className="size-3.5 shrink-0 text-cyan" />
                      <span className="flex-1 text-foreground">Business Impact Report</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">PDF</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => window.open(reportApi.plantUrl("maintenance", "pdf"), "_blank")}
                      className="text-xs font-mono cursor-pointer flex items-center gap-2 focus:bg-surface-2 focus:text-foreground"
                    >
                      <FileText className="size-3.5 shrink-0 text-cyan" />
                      <span className="flex-1 text-foreground">Full Maintenance Report</span>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">PDF</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                    Per-asset report
                  </div>
                  {(priority.data ?? []).slice(0, 6).map((a) => {
                    const band = String(a.priority?.priority_band ?? "").toUpperCase();
                    const health = Math.round(a.health_score ?? 0);
                    // One consistent accent per row, driven by the priority band.
                    const tone =
                      band === "CRITICAL" ? "text-red-signal"
                      : band === "HIGH" ? "text-amber-signal"
                      : band === "LOW" ? "text-green-signal"
                      : "text-cyan";
                    return (
                      <DropdownMenuItem
                        key={a.asset_id}
                        onClick={() => window.open(reportApi.downloadUrl(a.asset_id, "pdf"), "_blank")}
                        className="text-xs font-mono cursor-pointer flex items-center gap-2 focus:bg-surface-2 focus:text-foreground"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-foreground">{formatAssetId(a.asset_id)}</span>
                        <span className={`tabular-nums ${tone}`}>{health}%</span>
                        <span className={`w-[60px] text-right text-[9px] uppercase tracking-wider ${tone}`}>{band || "—"}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === "reports" ? (
              <motion.div key="reports" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                <ReportsTab />
              </motion.div>
            ) : activeTab === "business-impact" ? (
              <motion.div key="business-impact" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                <BusinessImpactTab />
              </motion.div>
            ) : (
              <motion.div key="decisions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-3 grid-bg">
                <div className="col-span-12 lg:col-span-4 panel p-6 flex flex-col items-center justify-center gap-4">
                  <PanelHeader code="06.1" label="Priority Score" />
                  <Ring value={score} label={band} />
                  <div className="grid grid-cols-3 w-full gap-2 mt-2">
                    <div className="panel p-2.5 text-center"><div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Band</div><div className={`font-mono text-base ${bandTone(band)}`}>{band}</div></div>
                    <div className="panel p-2.5 text-center"><div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Risk</div><div className={`font-mono text-base ${bandTone(topRisk?.business_risk ?? "")}`}>{topRisk?.business_risk ?? "—"}</div></div>
                    <div className="panel p-2.5 text-center"><div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Low stock</div><div className="font-mono text-base text-amber-signal">{lowStock}</div></div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-4 panel">
                  <PanelHeader code="06.2" label="Decision Vector" />
                  <div className="p-3 h-48">
                    {radar.length ? (
                      <ResponsiveContainer>
                        <RadarChart data={radar}>
                          <PolarGrid stroke="oklch(0.30 0.02 250 / 0.5)" />
                          <PolarAngleAxis dataKey="k" stroke="oklch(0.65 0.02 240)" fontSize={10} />
                          <Radar dataKey="v" stroke="oklch(0.72 0.18 240)" fill="oklch(0.72 0.18 240)" fillOpacity={0.25} />
                        </RadarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full grid place-items-center font-mono text-[11px] text-muted-foreground">
                        {priority.isLoading ? "Loading…" : priority.isError ? "Backend unreachable" : "No priority data"}
                      </div>
                    )}
                  </div>
                  {radar.length > 0 && (
                    <div className="border-t border-border px-4 pb-3 pt-2 space-y-1">
                      {radar.map(({ k, v }) => (
                        <div key={k} className="flex items-center gap-2">
                          <div className="font-mono text-[10px] text-muted-foreground w-40 truncate">{k}</div>
                          <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, v)}%`, background: v >= 70 ? "oklch(0.65 0.22 25)" : v >= 40 ? "oklch(0.80 0.18 80)" : "oklch(0.72 0.18 240)" }} />
                          </div>
                          <div className="font-mono text-[10px] text-electric w-7 text-right">{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-span-12 lg:col-span-4 panel">
                  <PanelHeader code="06.3" label="Business Impact" action={<span className="font-mono text-[10px] text-muted-foreground">impact score</span>} />
                  <div className="p-3 h-72">
                    {impact.length ? (
                      <ResponsiveContainer>
                        <BarChart data={impact} layout="vertical" margin={{ left: 15, right: 10, top: 5, bottom: 5 }}>
                          <CartesianGrid stroke="oklch(0.30 0.02 250 / 0.4)" strokeDasharray="2 4" horizontal={false} />
                          <XAxis type="number" stroke="oklch(0.65 0.02 240)" fontSize={10} domain={[0, 100]} />
                          <YAxis type="category" dataKey="c" stroke="oklch(0.65 0.02 240)" fontSize={10} width={130} tick={{ fontFamily: "JetBrains Mono" }} />
                          <Tooltip contentStyle={{ background: "oklch(0.14 0.012 250)", border: "1px solid oklch(0.32 0.02 250)", fontFamily: "JetBrains Mono", fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => [v ?? 0, "Impact Score"]} />
                          <Bar dataKey="v" radius={[0, 3, 3, 0]}
                            shape={(props: any) => {
                              const { x, y, width, height, value } = props;
                              const fill = value >= 75 ? "oklch(0.65 0.22 25)" : value >= 50 ? "oklch(0.80 0.18 80)" : "oklch(0.72 0.18 240)";
                              return <rect x={x} y={y + 1} width={Math.max(2, width)} height={Math.max(1, height - 2)} fill={fill} rx={3} style={{ filter: `drop-shadow(0 0 4px ${fill}55)` }} />;
                            }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full grid place-items-center font-mono text-[11px] text-muted-foreground">
                        {business.isLoading ? "Loading…" : business.isError ? "Backend unreachable" : "No business-risk data"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-7 panel flex flex-col">
                  <PanelHeader code="06.4" label="Maintenance Plan" action={
                    <span className="font-mono text-[10px] text-muted-foreground">{(actions.data ?? []).length} actions queued</span>
                  } />
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {(actions.data ?? []).length === 0 && (
                      <div className="py-8 text-center font-mono text-[11px] text-muted-foreground">
                        {actions.isLoading ? "Loading actions…" : actions.isError ? "Backend unreachable" : "No maintenance actions queued."}
                      </div>
                    )}
                    {(actions.data ?? []).slice(0, 10).map((s, i) => {
                      const band = s.priority_band?.toLowerCase() ?? "";
                      const isCrit = band.includes("crit") || band.includes("p0");
                      const isHigh = band.includes("high") || band.includes("p1");
                      const borderColor = isCrit ? "border-l-red-signal" : isHigh ? "border-l-amber-signal" : "border-l-border";
                      const badgeBg = isCrit ? "bg-red-signal/10 text-red-signal border-red-signal/30" : isHigh ? "bg-amber-signal/10 text-amber-signal border-amber-signal/30" : "bg-secondary text-muted-foreground border-border";
                      const windowColor = isCrit ? "text-red-signal" : isHigh ? "text-amber-signal" : "text-electric";
                      return (
                        <motion.div key={`${s.asset_id}-${i}`}
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                          className={`flex items-start gap-3 p-3 rounded-md bg-card border border-border border-l-2 ${borderColor}`}
                        >
                          <div className="size-6 rounded-sm border border-electric/40 bg-card flex items-center justify-center font-mono text-[10px] text-electric shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className={`font-mono text-[10px] uppercase tracking-wider ${windowColor}`}>{s.due_window}</span>
                              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${badgeBg}`}>{s.priority_band}</span>
                            </div>
                            <div className="text-[13px] font-medium leading-snug">{s.action}</div>
                            <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                              <span className="text-electric/80">{formatAssetId(s.asset_id)}</span>
                              <span>·</span>
                              <span>{s.asset_name}</span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-5 panel flex flex-col">
                  <PanelHeader code="06.5" label="Executive Summary" action={<span className="font-mono text-[10px] text-muted-foreground">Auto-generated</span>} />
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {!top ? (
                      <div className="py-8 text-center font-mono text-[11px] text-muted-foreground">
                        {priority.isLoading ? "Loading decision packet…" : priority.isError ? "Backend unreachable — start the API server." : "No prioritized assets."}
                      </div>
                    ) : (
                      <>
                        <div className={`rounded-md border p-3 ${band?.toLowerCase().includes("crit") ? "border-red-signal/30 bg-red-signal/5" : band?.toLowerCase().includes("high") ? "border-amber-signal/30 bg-amber-signal/5" : "border-electric/30 bg-electric/5"}`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Top Priority Asset</div>
                              <div className="font-mono text-[12px] text-electric truncate">{formatAssetId(top.asset_id)}</div>
                              <div className="text-[13px] font-medium leading-tight">{top.asset_name}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className={`font-mono text-3xl font-bold leading-none ${bandTone(band)}`}>{score}</div>
                              <div className={`font-mono text-[10px] uppercase tracking-wider mt-0.5 ${bandTone(band)}`}>{band}</div>
                            </div>
                          </div>
                          {top.health_score != null && (
                            <div className="grid grid-cols-3 gap-2 mt-2">
                              {[
                                { label: "Health", value: `${Math.round(top.health_score ?? 0)}%`, tone: (top.health_score ?? 100) < 50 ? "text-red-signal" : (top.health_score ?? 100) < 75 ? "text-amber-signal" : "text-green-signal" },
                                { label: "RUL", value: `${top.rul_days ?? "—"}d`, tone: (top.rul_days ?? 30) < 7 ? "text-red-signal" : (top.rul_days ?? 30) < 14 ? "text-amber-signal" : "text-electric" },
                                { label: "Fail %", value: `${Math.round((top.failure_probability ?? 0) * 100)}%`, tone: (top.failure_probability ?? 0) > 0.6 ? "text-red-signal" : (top.failure_probability ?? 0) > 0.4 ? "text-amber-signal" : "text-green-signal" },
                              ].map((m) => (
                                <div key={m.label} className="bg-card/60 rounded border border-border/50 py-2 text-center">
                                  <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest mb-0.5">{m.label}</div>
                                  <div className={`font-mono text-[18px] font-semibold leading-none ${m.tone}`}>{m.value}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {top.priority.score_components && Object.keys(top.priority.score_components).length > 0 && (() => {
                          const drivers = Object.entries(top.priority.score_components)
                            .map(([k, v]) => ({ key: k, label: titleCase(k), value: Math.round(Number(v)) }))
                            .filter(d => d.value > 0)
                            .sort((a, b) => b.value - a.value)
                            .slice(0, 5);
                          return (
                            <div className="rounded-md border border-border bg-card/40 p-3">
                              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-2.5">Risk Drivers</div>
                              <div className="space-y-2">
                                {drivers.map((d) => {
                                  const barColor = d.value >= 80 ? "bg-red-signal" : d.value >= 50 ? "bg-amber-signal" : "bg-electric";
                                  const textColor = d.value >= 80 ? "text-red-signal" : d.value >= 50 ? "text-amber-signal" : "text-electric";
                                  return (
                                    <div key={d.key}>
                                      <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[11px] text-foreground/80">{d.label}</span>
                                        <span className={`font-mono text-[11px] font-semibold ${textColor}`}>{d.value}</span>
                                      </div>
                                      <div className="h-1 bg-border/40 rounded-full overflow-hidden">
                                        <motion.div className={`h-full rounded-full ${barColor}`} initial={{ width: 0 }} animate={{ width: `${d.value}%` }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {topRisk && (
                          <div className="rounded-md border border-amber-signal/25 bg-amber-signal/5 p-3">
                            <div className="font-mono text-[9px] uppercase tracking-widest text-amber-signal/80 mb-1.5">Business Exposure</div>
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-mono text-[11px] text-electric">{formatAssetId(topRisk.asset_id)}</div>
                                <div className="text-[11px] text-muted-foreground">Line {topRisk.production_line}</div>
                              </div>
                              <div className="text-right">
                                <div className={`font-mono text-[11px] font-medium ${bandTone(topRisk.business_risk)}`}>{topRisk.business_risk} RISK</div>
                                <div className="font-mono text-[11px] text-red-signal">{topRisk.estimated_downtime_hours}h est. downtime</div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className={`rounded-md border p-3 flex items-center gap-2.5 ${lowStock > 0 ? "border-amber-signal/25 bg-amber-signal/5" : "border-border bg-card/40"}`}>
                          <div className={`size-7 rounded-sm shrink-0 flex items-center justify-center font-mono text-[14px] font-bold ${lowStock > 0 ? "text-amber-signal" : "text-green-signal"}`}>
                            {lowStock > 0 ? "!" : "✓"}
                          </div>
                          <div>
                            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Spare Procurement</div>
                            <div className="text-[12px] mt-0.5">
                              {lowStock > 0
                                ? <><span className="font-semibold text-amber-signal">{lowStock} part{lowStock !== 1 ? "s" : ""}</span> at or below reorder level</>
                                : <span className="text-green-signal">All parts adequately stocked</span>
                              }
                            </div>
                          </div>
                        </div>

                        <div className="pt-1 border-t border-border">
                          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-2">Decision Actions</div>
                          <div className="grid grid-cols-3 gap-2">
                            <button onClick={handleApprove} disabled={activeRole !== "plant_manager" || !top || isPending}
                              className="py-2.5 rounded-sm bg-electric text-primary-foreground font-mono text-[10px] uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
                              {updateAsset.isPending ? "Approving…" : "Approve"}
                            </button>
                            <button onClick={handleDefer} disabled={activeRole !== "plant_manager" || !top || isPending}
                              className="py-2.5 rounded-sm border border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-electric/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                              {updateAsset.isPending ? "Deferring…" : "Defer 14d"}
                            </button>
                            <button onClick={handleEscalate} disabled={!top || isPending}
                              className="py-2.5 rounded-sm border border-red-signal/40 text-red-signal font-mono text-[10px] uppercase tracking-widest hover:bg-red-signal/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                              {createEscalation.isPending ? "Escalating…" : "Escalate"}
                            </button>
                          </div>
                          {activeRole !== "plant_manager" && (
                            <div className="mt-2 font-mono text-[9px] text-red-signal/85 text-center">
                              Scheduled actions (Approve / Defer) require Plant Manager authorization.
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Shell>
  );
}
