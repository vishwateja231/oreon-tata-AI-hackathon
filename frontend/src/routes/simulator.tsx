import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Play, RotateCcw, AlertTriangle, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAssets, useScenario } from "@/lib/api/hooks";
import { statusBg, statusColor, toUiAsset } from "@/lib/oreon-data";
import { ThinkingState } from "@/components/oreon/thinking-state";
import type { ScenarioAnalysisData } from "@/lib/api/types";
import { useOREONContext } from "@/lib/context-store";

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [
      { title: "Scenario Simulator · OREON" },
      { name: "description", content: "What-if maintenance simulation." },
    ],
  }),
  component: Simulator,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtId(s: string): string {
  return s.replace(/\b([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9]+)\b/g, "$1 $2");
}

function buildChallenges(
  result: ScenarioAnalysisData,
  assetType: string,
  loadPct: number
): string[] {
  const risk = Math.round(result.future_failure_probability * 100);
  const healthDrop = Math.max(0, Math.round(result.current_health - result.future_health));
  const ratePerDay = result.delay_days > 0
    ? Math.round((healthDrop / result.delay_days) * 10) / 10
    : 0;
  const downCount = result.affected_assets.length;
  const out: string[] = [];

  if (risk >= 85) {
    out.push(`Failure probability is ${risk}% — exceeds the safe operating threshold. Unplanned shutdown is statistically likely before the delay window closes.`);
  } else if (risk >= 65) {
    out.push(`At ${risk}% failure probability the asset is in the high-risk zone, where unexpected downtime becomes probable during the delay period.`);
  } else {
    out.push(`Failure probability climbs to ${risk}% — operator vigilance and sensor monitoring are essential throughout the delay.`);
  }

  if (ratePerDay > 2) {
    out.push(`Degradation rate of ${ratePerDay} health points per day is ${Math.round(ratePerDay / 0.4)}× faster than the normal baseline — components are aging rapidly under ${loadPct}% load.`);
  } else if (healthDrop > 8) {
    out.push(`Sustained ${loadPct}% load accelerates component wear — health falls ${healthDrop} points over the delay window, shortening time to next maintenance interval.`);
  }

  const t = assetType.toLowerCase();
  if (t.includes("motor") || t.includes("drive")) {
    out.push("Bearing fatigue and winding insulation breakdown are the primary risks under extended operation without inspection or lubrication.");
  } else if (t.includes("pump")) {
    out.push("Cavitation damage and mechanical seal degradation compound rapidly when the pump runs past its maintenance interval.");
  } else if (t.includes("furnace")) {
    out.push("Refractory wear and repeated thermal cycling increase structural risk — delayed inspection can miss early crack propagation.");
  } else if (t.includes("gearbox")) {
    out.push("Gear tooth fatigue and lubricant breakdown are critical failure modes — metallic debris in oil signals imminent failure.");
  } else if (t.includes("conveyor")) {
    out.push("Belt tension loss and roller bearing wear accumulate at high throughput — a belt snap during operation causes immediate line stoppage.");
  } else if (t.includes("fan") || t.includes("compressor")) {
    out.push("Blade imbalance from debris accumulation can cause sudden vibration spikes and shaft damage under continuous operation.");
  } else {
    out.push(`Key components skip their inspection window — pre-failure signatures that maintenance would catch go undetected for the ${result.delay_days}-day delay.`);
  }

  if (downCount > 3) {
    out.push(`Cascade failure risk spans ${downCount} downstream assets — a single unplanned event here could trigger a multi-system production halt.`);
  } else if (downCount > 0) {
    out.push(`${downCount} downstream asset${downCount !== 1 ? "s are" : " is"} directly dependent — failure propagates immediately to connected systems.`);
  }

  return out;
}

function buildActions(
  result: ScenarioAnalysisData,
  assetName: string,
  assetType: string
): string[] {
  const risk = Math.round(result.future_failure_probability * 100);
  const downCount = result.affected_assets.length;
  const out: string[] = [];

  if (risk >= 85 || result.recommendation.toLowerCase().includes("do not delay")) {
    out.push(`Halt the delay — schedule maintenance for ${assetName} immediately or initiate a controlled shutdown to prevent an unplanned failure.`);
  } else if (risk >= 65) {
    out.push(`Escalate to the maintenance supervisor now and lock in the earliest available maintenance window for ${assetName}.`);
  } else {
    out.push(`Confirm ${assetName} is on the maintenance schedule with spare parts pre-staged at the work location.`);
  }

  const t = assetType.toLowerCase();
  if (t.includes("motor") || t.includes("drive")) {
    out.push("Monitor vibration (alert if >4 mm/s) and winding temperature (alert if >85°C) every hour — these are the earliest indicators of imminent motor failure.");
  } else if (t.includes("pump")) {
    out.push("Check suction pressure, flow rate, and listen for cavitation noise each shift — a sudden flow drop is a hard stop condition.");
  } else if (t.includes("gearbox")) {
    out.push("Pull an oil sample every 48 hours and inspect for metallic debris — visible particles indicate gear tooth wear requiring immediate shutdown.");
  } else if (t.includes("furnace")) {
    out.push("Inspect refractory lining visually each shift and log any new hot spots on the shell — escalate immediately if shell temperature exceeds limits.");
  } else {
    out.push("Increase sensor polling to hourly readings — set alert thresholds at 80% of critical limits so warnings fire before hard failures.");
  }

  if (downCount > 0) {
    const names = result.affected_assets
      .slice(0, 2)
      .map((a: any) => fmtId(a.asset_id || String(a)))
      .join(" and ");
    out.push(`Notify operators at ${names} of upstream risk — identify any backup routing or buffer capacity that can absorb a partial-capacity scenario.`);
  }

  out.push("Verify spare parts inventory now — confirm critical replacement components are in stock and that lead times fall within the planned delay window.");

  if (risk >= 70) {
    out.push("Brief the plant manager and shift supervisor — prepare a contingency production plan covering a partial-capacity or temporary-shutdown scenario.");
  }

  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

function Simulator() {
  const [delay, setDelay] = useState(7);
  const [loadPct, setLoadPct] = useState(90);
  const { data: raw = [] } = useAssets();
  const assets = useMemo(() => raw.map(toUiAsset), [raw]);
  const [assetId, setAssetId] = useState<string>("");
  const subject = assets.find((a) => a.id === assetId) ?? assets[0];
  const scenario = useScenario();
  const result = scenario.data as ScenarioAnalysisData | undefined;

  const { setActiveAssetId } = useOREONContext();
  useEffect(() => {
    if (subject?.id) {
      setActiveAssetId(subject.id);
    }
    return () => setActiveAssetId(null);
  }, [subject?.id, setActiveAssetId]);

  // Chart uses real API degradation rate when scenario has run
  const chartData = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      let health: number;
      if (result && result.delay_days > 0) {
        const ratePerDay = (result.current_health - result.future_health) / result.delay_days;
        health = Math.max(0, result.current_health - ratePerDay * i);
      } else {
        health = Math.max(0, 100 - Math.pow(i / (30 - delay * 0.6), 2) * 60 - i * (loadPct / 90) * 0.6);
      }
      const baseStart = result ? result.current_health : 100;
      const baseline = Math.max(0, baseStart - i * 0.4);
      const risk = Math.min(100, 20 + Math.pow(i / 6, 2) * (1 + delay / 20) * (loadPct / 80));
      return { d: i, baseline, health, risk };
    });
  }, [delay, loadPct, result]);

  const finalHealth = result
    ? Math.round(result.future_health)
    : Math.round(chartData[chartData.length - 1].health);
  const finalRisk = result
    ? Math.round(result.future_failure_probability * 100)
    : Math.round(chartData[chartData.length - 1].risk);

  const affectedItems = useMemo(() => {
    if (result) {
      return result.affected_assets.slice(0, 8).map((a: any) => ({
        id: a.asset_id ?? String(a),
        name: a.asset_name ?? a.name ?? "",
        depth: a.depth ?? 0,
        status: a.status ?? "warning",
      }));
    }
    return assets.slice(0, delay > 4 ? 3 : 1).map((a) => ({
      id: a.id, name: a.name, depth: 0, status: a.status,
    }));
  }, [result, assets, delay]);

  // Derived data for summary section
  const challenges = result
    ? buildChallenges(result, subject?.type ?? "", loadPct)
    : [];
  const actions = result
    ? buildActions(result, fmtId(subject?.name ?? subject?.id ?? ""), subject?.type ?? "")
    : [];
  const summaryLead = result ? (() => {
    const health = Math.round(result.future_health);
    const risk = Math.round(result.future_failure_probability * 100);
    const currentHealth = Math.round(result.current_health);
    const healthDrop = Math.max(0, currentHealth - health);
    const riskIncrease = Math.max(0, risk - Math.round(result.current_failure_probability * 100));
    const severity = risk >= 85 ? "critical failure" : risk >= 65 ? "severe degradation" : risk >= 40 ? "significant risk increase" : "manageable stress";
    return `Delaying maintenance on ${fmtId(subject?.name ?? subject?.id ?? "")} by ${result.delay_days} days at ${loadPct}% continued load projects ${severity}. Health drops ${healthDrop} points to ${health}% while failure probability rises ${riskIncrease} points to ${risk}%.`;
  })() : "";

  const runScenario = () => {
    if (subject) scenario.mutate({ asset_id: subject.id, delay_days: delay });
  };

  const reset = () => {
    setDelay(7);
    setLoadPct(90);
    scenario.reset();
  };

  return (
    <Shell
      title="Scenario Simulator"
      subtitle={subject ? `What-if · ${fmtId(subject.id)} maintenance delay` : "What-if simulation"}
    >
      <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-4 grid-bg">

        {/* ── LEFT: Inputs ─────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="panel">
            <PanelHeader code="07.1" label="Scenario Inputs" />
            <div className="p-5 space-y-6">

              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Asset</label>
                <Select value={subject?.id ?? ""} onValueChange={setAssetId}>
                  <SelectTrigger className="w-full mt-2 bg-card border border-border rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:border-electric [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1">
                    <SelectValue placeholder="Select asset…" />
                  </SelectTrigger>
                  <SelectContent className="font-mono text-sm max-h-60">
                    {assets.map((a) => {
                      const Icon = a.icon;
                      return (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center gap-2.5 w-full py-1 text-left">
                            <div className={`p-1 rounded shrink-0 ${statusBg(a.status)}/10`}>
                              <Icon className={`size-3.5 ${statusColor(a.status)}`} />
                            </div>
                            <div className="flex-1 min-w-0 font-sans">
                              <div className="text-xs font-semibold truncate leading-tight">{a.name}</div>
                              <div className="text-[10px] font-mono opacity-65 truncate">{a.id}</div>
                            </div>
                            <div className="text-right shrink-0 ml-4 font-mono">
                              <div className={`text-xs font-bold ${statusColor(a.status)}`}>{a.health}%</div>
                              <div className="text-[9px] uppercase opacity-65">{a.status}</div>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Maintenance Delay</label>
                  <span className="font-mono text-2xl text-electric text-glow">
                    {delay}<span className="text-xs text-muted-foreground ml-1">days</span>
                  </span>
                </div>
                <input
                  type="range" min={0} max={21} value={delay}
                  onChange={(e) => { setDelay(Number(e.target.value)); scenario.reset(); }}
                  className="w-full accent-[oklch(0.72_0.18_240)]"
                />
                <div className="flex justify-between font-mono text-[9px] text-muted-foreground mt-1">
                  <span>Now</span><span>21d</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Continued Load</label>
                  <span className="font-mono text-2xl text-electric text-glow">
                    {loadPct}<span className="text-xs text-muted-foreground ml-1">%</span>
                  </span>
                </div>
                <input
                  type="range" min={40} max={100} value={loadPct}
                  onChange={(e) => { setLoadPct(Number(e.target.value)); scenario.reset(); }}
                  className="w-full accent-[oklch(0.72_0.18_240)]"
                />
                <div className="flex justify-between font-mono text-[9px] text-muted-foreground mt-1">
                  <span>40%</span><span>100%</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runScenario}
                  disabled={!subject || scenario.isPending}
                  className="flex-1 py-2.5 bg-electric text-primary-foreground font-mono text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-electric/90 disabled:opacity-50 rounded-sm transition-colors"
                >
                  <Play className="size-3" />
                  {scenario.isPending ? "Running…" : "Run Simulation"}
                </button>
                <button onClick={reset} title="Reset" className="px-3 py-2.5 border border-border hover:bg-secondary rounded-sm transition-colors">
                  <RotateCcw className="size-3" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="panel p-4">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Projected Health</div>
                  <div className={`font-mono text-3xl font-bold ${finalHealth < 20 ? "text-red-signal" : finalHealth < 50 ? "text-amber-signal" : "text-green-signal"}`}>
                    {finalHealth}%
                  </div>
                  {result && (
                    <div className="font-mono text-[9px] text-muted-foreground mt-1">was {Math.round(result.current_health)}%</div>
                  )}
                </div>
                <div className="panel p-4">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Failure Risk</div>
                  <div className={`font-mono text-3xl font-bold ${finalRisk > 70 ? "text-red-signal" : finalRisk > 40 ? "text-amber-signal" : "text-green-signal"}`}>
                    {finalRisk}%
                  </div>
                  {result && (
                    <div className="font-mono text-[9px] text-muted-foreground mt-1">
                      was {Math.round(result.current_failure_probability * 100)}%
                    </div>
                  )}
                </div>
              </div>

              {scenario.isError && (
                <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-400">
                  <AlertTriangle className="size-3 shrink-0" />
                  Simulation failed — check asset selection and try again.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Charts ────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="panel">
            <PanelHeader
              code="07.2"
              label="Health Degradation Curve"
              action={<span className="font-mono text-[10px] text-muted-foreground">30-day projection</span>}
            />
            <div className="p-3 h-64">
              <ResponsiveContainer>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gH" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.78 0.20 155)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="oklch(0.65 0.24 27)" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="oklch(0.30 0.02 250 / 0.4)" strokeDasharray="2 4" />
                  <XAxis dataKey="d" stroke="oklch(0.65 0.02 240)" fontSize={10}
                    label={{ value: "days", fill: "oklch(0.55 0.02 240)", fontSize: 10, position: "insideBottomRight", offset: -2 }} />
                  <YAxis stroke="oklch(0.65 0.02 240)" fontSize={10} domain={[0, 100]} />
                  <Tooltip
                    formatter={(val) => typeof val === "number" ? `${val.toFixed(1)}%` : String(val ?? "")}
                    contentStyle={{ background: "oklch(0.14 0.012 250)", border: "1px solid oklch(0.32 0.02 250)", fontFamily: "JetBrains Mono", fontSize: 11 }}
                  />
                  <Area dataKey="health" name="Projected health" stroke="oklch(0.72 0.18 240)" fill="url(#gH)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-7 panel">
              <PanelHeader code="07.3" label="Risk Propagation" />
              <div className="p-3 h-52">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="oklch(0.30 0.02 250 / 0.4)" strokeDasharray="2 4" />
                    <XAxis dataKey="d" stroke="oklch(0.65 0.02 240)" fontSize={10} />
                    <YAxis stroke="oklch(0.65 0.02 240)" fontSize={10} domain={[0, 100]} />
                    <Tooltip
                      formatter={(val) => typeof val === "number" ? `${val.toFixed(1)}%` : String(val ?? "")}
                      contentStyle={{ background: "oklch(0.14 0.012 250)", border: "1px solid oklch(0.32 0.02 250)", fontFamily: "JetBrains Mono", fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10 }} />
                    <Line dataKey="risk" name="With delay" stroke="oklch(0.65 0.24 27)" strokeWidth={2} dot={false} />
                    <Line dataKey="baseline" name="Baseline" stroke="oklch(0.65 0.02 240)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="col-span-12 md:col-span-5 panel">
              <PanelHeader
                code="07.4"
                label="Affected Assets"
                action={
                  <span className={`font-mono text-[10px] ${affectedItems.length > 0 ? "text-amber-signal" : "text-green-signal"}`}>
                    {affectedItems.length} downstream
                  </span>
                }
              />
              <div className="divide-y divide-border min-h-[120px]">
                {affectedItems.length === 0 ? (
                  <div className="px-4 py-6 text-center font-mono text-[11px] text-muted-foreground">No downstream assets affected.</div>
                ) : (
                  affectedItems.map((a) => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className={`size-1.5 rounded-full shrink-0 ${statusBg(a.status as any)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] truncate">{fmtId(a.id)}</div>
                        {a.name && <div className="text-[10px] text-muted-foreground truncate">{a.name}</div>}
                      </div>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(90, 40 + affectedItems.length * 6)}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="h-1 bg-amber-signal/60 rounded-full shrink-0"
                        style={{ maxWidth: 56 }}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── BOTTOM: Scenario Analysis Summary ────────────────────────────── */}
        <div className="col-span-12 panel">
          <PanelHeader code="07.5" label="Scenario Analysis Summary" />
          <div className="p-5">
            {scenario.isPending ? (
              <ThinkingState message="Simulating scenario — computing degradation curve and downstream impact…" />
            ) : result ? (
              <div className="space-y-6">

                {/* Lead sentence */}
                <p className="text-[15px] text-foreground/90 leading-relaxed">{summaryLead}</p>

                {/* Two-column: Challenges | Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Challenges & Risks */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      <AlertTriangle className="size-3 text-amber-signal/70" />
                      Key Challenges & Risks
                    </div>
                    <ul className="space-y-3">
                      {challenges.map((c, i) => (
                        <li key={i} className="flex gap-2.5 leading-snug">
                          <span className="mt-1 size-1.5 rounded-full bg-amber-signal/50 shrink-0" />
                          <span className="text-[13px] text-foreground/70">{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Immediate Actions */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      <Zap className="size-3 text-cyan/70" />
                      Immediate Actions
                    </div>
                    <ol className="space-y-3">
                      {actions.map((a, i) => (
                        <li key={i} className="flex gap-2.5 leading-snug">
                          <span className="font-mono text-[10px] text-cyan/50 shrink-0 tabular-nums mt-0.5">{i + 1}</span>
                          <span className="text-[13px] text-foreground/70">{a}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Production Impact row */}
                {result.production_impact && (
                  <div className="flex items-start gap-3 rounded border border-border/50 bg-surface-2/40 px-4 py-3">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground shrink-0 pt-0.5 w-36">
                      Estimated Impact
                    </div>
                    <div className="text-[13px] text-foreground/80 leading-snug">{result.production_impact}</div>
                  </div>
                )}

              </div>
            ) : (
              <div className="py-8 text-center font-mono text-[11px] text-muted-foreground">
                Configure a scenario above and click{" "}
                <span className="text-electric font-semibold">Run Simulation</span>{" "}
                to generate the analysis.
              </div>
            )}
          </div>
        </div>

      </div>
    </Shell>
  );
}
