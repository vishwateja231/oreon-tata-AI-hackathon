import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Activity, BookOpen, Brain, CheckCircle2, FileSearch, History, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAssets, useInvestigationTimeline, useActiveRole } from "@/lib/api/hooks";
import { investigationApi } from "@/lib/api/endpoints";
import { statusBg, statusColor, toUiAsset } from "@/lib/oreon-data";
import { useOREONContext } from "@/lib/context-store";
import { z } from "zod";

export const Route = createFileRoute("/investigations")({
  validateSearch: z.object({ asset_id: z.string().optional() }),
  head: () => ({ meta: [{ title: "Investigation Center · OREON" }, { name: "description", content: "Run an explainable root-cause investigation." }] }),
  component: Investigations,
});

const STAGE_ICONS = [Activity, BookOpen, FileSearch, History, Brain, Sparkles];

function Investigations() {
  const search = Route.useSearch();
  const initialAssetId = search.asset_id || "";
  const [activeRole] = useActiveRole();
  const { data: raw = [] } = useAssets();
  const assets = useMemo(() => raw.map(toUiAsset), [raw]);
  const timeline = useInvestigationTimeline();

  const [assetId, setAssetId] = useState(initialAssetId);
  const subject = assets.find((a) => a.id === assetId) ?? assets[0];

  const { setActiveAssetId } = useOREONContext();
  useEffect(() => {
    if (subject?.id) {
      setActiveAssetId(subject.id);
    }
    return () => setActiveAssetId(null);
  }, [subject?.id, setActiveAssetId]);
  const [fault, setFault] = useState("Abnormal vibration and rising temperature");
  const [vibration, setVibration] = useState(9);
  const [temperature, setTemperature] = useState(87);
  const [current, setCurrent] = useState(38);
  const [rpm, setRpm] = useState(1450);

  const stages = (timeline.data?.steps?.length ? timeline.data.steps : [
    "Analyzing sensors", "Searching manuals", "Searching SOPs", "Checking historical incidents", "Finding root cause", "Generating recommendations",
  ]).slice(0, 6);

  const [step, setStep] = useState(stages.length);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [isError, setIsError] = useState(false);

  const run = async () => {
    if (!subject) return;
    setRunning(true);
    setDone(false);
    setReport(null);
    setIsError(false);
    setStep(0);

    try {
      await investigationApi.investigateStream(
        {
          asset_id: subject.id,
          fault_description: fault,
          sensor_snapshot: { vibration_mms: vibration, temperature_c: temperature, current_amps: current, rpm },
        },
        (event) => {
          if (event.progress === "COMPLETE" && event.report) {
            setReport(event.report);
            setStep(stages.length);
            setDone(true);
            setRunning(false);
          } else {
            const idx = stages.findIndex((s: any) => s.toLowerCase() === event.progress.toLowerCase());
            if (idx !== -1) setStep(idx);
          }
        }
      );
    } catch (e) {
      console.error(e);
      setIsError(true);
      setRunning(false);
    }
  };

  // Role-specific framing of the investigation workspace.
  const roleFraming: Record<string, { title: string; runIdle: string; runBusy: string }> = {
    maintenance_engineer: { title: "Root Cause Investigation", runIdle: "Run Investigation", runBusy: "Investigating…" },
    reliability_engineer: { title: "Degradation Analysis", runIdle: "Analyze Degradation", runBusy: "Analyzing…" },
    supervisor: { title: "Incident Review", runIdle: "Review Incident", runBusy: "Reviewing…" },
  };
  const framing = roleFraming[activeRole] ?? { title: "Investigation Center", runIdle: "Run Investigation", runBusy: "Investigating…" };

  const riskTone = (risk: string): "crit" | "warn" | "ok" =>
    risk === "critical" ? "crit" : risk === "high" || risk === "warning" ? "warn" : "ok";

  return (
    <Shell title={framing.title} subtitle={subject ? `${subject.id} · ${subject.name}` : "Root-cause analysis"}>
      <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-3 grid-bg">
        {/* LEFT — inputs + pipeline */}
        <div className="col-span-12 lg:col-span-5 space-y-3">
          <div className="panel">
            <PanelHeader code="05.0" label="Investigation Inputs" />
            <div className="p-5 space-y-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Asset</label>
                <Select value={subject?.id || undefined} onValueChange={setAssetId}>
                  <SelectTrigger className="w-full mt-1.5 bg-card border border-border rounded-sm px-3 py-2 text-sm font-mono focus:outline-none focus:border-electric [&>span]:flex [&>span]:flex-1 [&>span]:min-w-0">
                    <SelectValue placeholder="Select asset..." />
                  </SelectTrigger>
                  <SelectContent className="font-mono text-sm max-h-60">
                    {assets.map((a) => {
                      const Icon = a.icon;
                      return (
                        <SelectItem key={a.id} value={a.id} className="[&>span:last-child]:flex-1 [&>span:last-child]:min-w-0">
                          <div className="flex items-center gap-2.5 w-full py-1 text-left">
                            <div className={`p-1 rounded shrink-0 ${statusBg(a.status)}/10`}>
                              <Icon className={`size-3.5 ${statusColor(a.status)}`} />
                            </div>
                            <div className="flex-1 min-w-0 font-sans">
                              <div className="text-xs font-semibold truncate leading-tight">{a.name}</div>
                              <div className="text-[10px] font-mono opacity-65 truncate">{a.id}</div>
                            </div>
                            <div className="text-right shrink-0 ml-auto pl-4 font-mono">
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
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Fault description</label>
                <textarea value={fault} onChange={(e) => setFault(e.target.value)} rows={2}
                  className="w-full mt-1.5 bg-card border border-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-electric resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SensorInput label="Vibration mm/s" value={vibration} onChange={setVibration} />
                <SensorInput label="Temp °C" value={temperature} onChange={setTemperature} />
                <SensorInput label="Current A" value={current} onChange={setCurrent} />
                <SensorInput label="RPM" value={rpm} onChange={setRpm} />
              </div>
              <button onClick={run} disabled={activeRole === "supervisor" || !subject || running}
                className="w-full py-2.5 bg-electric text-primary-foreground font-mono text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-electric-glow disabled:opacity-50 cursor-pointer">
                <Play className="size-3" /> {running ? framing.runBusy : framing.runIdle}
              </button>
              {activeRole === "supervisor" && (
                <div className="mt-2 font-mono text-[9px] text-amber-signal text-center">
                  * Root-cause execution is restricted to Maintenance and Reliability roles.
                </div>
              )}
              {isError && (
                <div className="font-mono text-[11px] text-red-signal">Investigation failed. Check the backend is running.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <PanelHeader code="05.1" label="Analysis Pipeline" action={
              <span className={`font-mono text-[10px] ${done ? "text-ok" : running ? "text-electric" : "text-muted-foreground"}`}>
                {done ? "COMPLETE" : running ? "RUNNING" : "IDLE"}
              </span>
            } />
            <div className="p-5 space-y-1">
              {stages.map((label: any, i: number) => {
                const state = i < step ? "done" : i === step && running ? "active" : "queued";
                const Icon = STAGE_ICONS[i % STAGE_ICONS.length];
                return (
                  <div key={label} className="flex gap-3 items-start py-2.5 relative">
                    <div className={`size-8 shrink-0 rounded-sm border flex items-center justify-center ${state === "done" ? "border-ok text-ok bg-ok/5" : state === "active" ? "border-electric text-electric animate-pulse-ring" : "border-border text-muted-foreground"}`}>
                      {state === "done" ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                    </div>
                    {i < stages.length - 1 && <div className={`absolute left-4 top-12 bottom-0 w-px ${i < step ? "bg-ok/40" : "bg-border"}`} />}
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">0{i + 1}</span>
                        <span className={`text-sm ${state === "done" ? "text-foreground" : state === "active" ? "text-electric" : "text-muted-foreground"}`}>{label}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — report, fills full height and scrolls internally */}
        <div className="col-span-12 lg:col-span-7 flex flex-col min-h-0">
          <div className="panel flex flex-col flex-1 min-h-0">
            <PanelHeader
              code="05.2"
              label="Investigation Report"
              action={
                report ? (
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-ok" />
                      <span className="font-mono text-[10px] text-ok">COMPLETE</span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground border-l border-border pl-3">
                      Confidence {Math.round(report.confidence * 100)}%
                    </span>
                  </div>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">—</span>
                )
              }
            />
            <motion.div initial={false} animate={{ opacity: report ? 1 : 0.45 }} className="p-5 space-y-5 flex-1 min-h-0 overflow-y-auto">
              {!report ? (
                <div className="py-12 flex flex-col items-center text-center gap-3">
                  <Brain className="size-10 text-border" strokeWidth={1} />
                  <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                    Select an asset, describe the fault, and run an investigation to generate an explainable root-cause report from live sensor, SOP, manual, and historical evidence.
                  </p>
                </div>
              ) : (
                <>
                  {/* Diagnosis — severity-colored banner */}
                  {(() => {
                    const tone = riskTone(report.risk_level);
                    const borderColor = tone === "crit" ? "border-l-crit" : tone === "warn" ? "border-l-warn" : "border-l-ok";
                    const bg = tone === "crit" ? "bg-crit/[0.04]" : tone === "warn" ? "bg-warn/[0.04]" : "bg-ok/[0.04]";
                    const labelColor = tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-ok";
                    const dotColor = tone === "crit" ? "bg-crit" : tone === "warn" ? "bg-warn" : "bg-ok";
                    return (
                      <div className={`rounded-lg border border-border border-l-2 ${borderColor} ${bg} p-4`}>
                        <div className={`font-mono text-[10px] uppercase tracking-widest mb-2 flex items-center gap-2 ${labelColor}`}>
                          <span className={`size-1.5 rounded-full ${dotColor}`} />
                          Diagnosis · {report.risk_level.toUpperCase()} RISK
                        </div>
                        <p className="text-[14px] leading-relaxed font-medium text-foreground">{report.diagnosis}</p>
                      </div>
                    );
                  })()}

                  {/* Root Cause */}
                  <div className="rounded-lg border border-border bg-surface-2/40 p-4 flex items-start gap-3">
                    <div className="size-8 rounded-md border border-border bg-surface-2 flex items-center justify-center shrink-0">
                      <Brain className="size-4 text-violet" strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Root Cause</div>
                      <p className="text-[15px] font-semibold text-foreground">{report.root_cause}</p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-3 gap-3">
                    <ReportMetric
                      label="Risk Level"
                      value={report.risk_level}
                      tone={riskTone(report.risk_level)}
                      sub={report.risk_level === "critical" ? "Immediate action" : report.risk_level === "high" ? "Urgent attention" : "Monitor closely"}
                    />
                    <ReportMetric
                      label="RUL Remaining"
                      value={`${report.rul_days}d`}
                      tone={report.rul_days < 14 ? "crit" : report.rul_days < 30 ? "warn" : "ok"}
                      sub="days to failure"
                    />
                    <ReportMetric
                      label="Confidence"
                      value={`${Math.round(report.confidence * 100)}%`}
                      tone={report.confidence >= 0.85 ? "ok" : report.confidence >= 0.70 ? "warn" : "crit"}
                      sub="evidence-based"
                    />
                  </div>

                  {/* Evidence + Similar Cases */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Sensor Evidence */}
                    <div className="panel p-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-3 flex items-center gap-1.5">
                        <Activity className="size-3" />
                        Sensor Evidence
                      </div>
                      <div className="space-y-1">
                        {report.evidence.sensor_evidence.slice(0, 6).map((e: any, i: number) => {
                          const isCrit = /^critical/i.test(e);
                          const isWarn = /^warning/i.test(e);
                          return (
                            <div key={i} className={`flex items-start gap-2 text-[11px] py-1 px-2 rounded leading-snug ${isCrit ? "bg-crit/8 text-crit/90" : isWarn ? "bg-warn/8 text-warn/85" : "text-text-secondary"}`}>
                              <span className={`size-1.5 rounded-full shrink-0 mt-1 ${isCrit ? "bg-crit" : isWarn ? "bg-warn" : "bg-text-muted"}`} />
                              {e}
                            </div>
                          );
                        })}
                        {report.evidence.sensor_evidence.length === 0 && (
                          <p className="text-[11px] text-muted-foreground py-1">No anomalies detected</p>
                        )}
                      </div>
                    </div>

                    {/* Similar Past Cases */}
                    <div className="panel p-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                        <History className="size-3" />
                        Similar Past Cases
                      </div>
                      <div className="space-y-0">
                        {report.similar_incidents?.map((inc: any, i: number) => {
                          const id = String((inc as Record<string, unknown>).incident_id ?? `INC-${i}`);
                          const rc = String((inc as Record<string, unknown>).root_cause ?? "");
                          const asset = String((inc as Record<string, unknown>).asset_id ?? "");
                          return (
                            <div key={i} className="flex items-start gap-2.5 py-2 border-b border-border/60 last:border-0">
                              <span className="font-mono text-[10px] text-cyan bg-cyan/8 border border-cyan/15 px-1.5 py-0.5 rounded shrink-0">{id}</span>
                              <div className="min-w-0">
                                {rc && <p className="text-[11px] text-text-secondary leading-snug truncate">{rc}</p>}
                                {asset && <p className="text-[10px] text-muted-foreground mt-0.5">{asset}</p>}
                              </div>
                            </div>
                          );
                        })}
                        {report.similar_incidents.length === 0 && (
                          <p className="text-[11px] text-muted-foreground py-1">No matching incidents found</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Recommended Actions */}
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-3 flex items-center gap-1.5">
                      <CheckCircle2 className="size-3" />
                      Recommended Actions
                    </div>
                    <div className="space-y-2">
                      {report.recommended_actions?.map((action: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 py-2.5 px-3 bg-surface-2/40 border border-border rounded-md hover:border-cyan/30 transition-colors group">
                          <span className="font-mono text-[11px] text-cyan bg-cyan/10 border border-cyan/20 rounded size-5 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-cyan/15 transition-colors">
                            {i + 1}
                          </span>
                          <span className="text-[13px] text-foreground leading-snug">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI Explanation */}
                  {report.llm_explanation && (
                    <div className="rounded-lg border border-violet/30 bg-violet/[0.04] p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="size-3.5 text-violet" strokeWidth={1.5} />
                        <span className="font-mono text-[10px] uppercase tracking-widest text-violet">AI Explanation</span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-text-secondary">
                        {report.llm_explanation.natural_language_explanation}
                      </p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SensorInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 bg-card border border-border rounded-sm px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-electric" />
    </div>
  );
}

function ReportMetric({ label, value, tone, sub }: { label: string; value: string; tone: "crit" | "warn" | "ok"; sub?: string }) {
  const styles = {
    crit: { wrapper: "border-crit/30 bg-crit/[0.04]", value: "text-crit", label: "text-crit/60" },
    warn: { wrapper: "border-warn/30 bg-warn/[0.04]", value: "text-warn", label: "text-warn/60" },
    ok:   { wrapper: "border-ok/30 bg-ok/[0.04]",   value: "text-ok",   label: "text-ok/60"   },
  }[tone];
  return (
    <div className={`rounded-lg border p-3.5 ${styles.wrapper}`}>
      <div className={`font-mono text-[9px] uppercase tracking-widest mb-2 ${styles.label}`}>{label}</div>
      <div className={`font-mono text-xl font-bold capitalize ${styles.value}`}>{value}</div>
      {sub && <div className={`font-mono text-[9px] mt-1 ${styles.label}`}>{sub}</div>}
    </div>
  );
}
