import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Network,
  TriangleAlert,
  UserCheck,
  Waves,
  ThumbsUp,
  ThumbsDown,
  Wrench,
  Truck,
  ShieldAlert,
  Eye,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Shell } from "@/components/oreon/shell";
import {
  useAsset,
  useAssetImpact,
  useAssetInvestigation,
  useSubmitFeedback,
  useActiveRole,
  useDecisionReport,
  useReadAlert,
  useAlerts,
  useCreateLogEntry,
} from "@/lib/api/hooks";
import { toUiAsset, ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";
import { reportApi } from "@/lib/api/endpoints";
import { useOREONContext } from "@/lib/context-store";
import { useSensorStream } from "@/lib/api/use-sensor-stream";

export const Route = createFileRoute("/assets/$id")({
  head: ({ params }) => {
    const displayName = ASSET_DISPLAY_NAMES[params.id] || params.id;
    return {
      meta: [
        { title: `${displayName} (${params.id}) · Asset Detail — OREON` },
        { name: "description", content: `Explainable diagnosis and recommended action for ${displayName} (${params.id}).` },
      ],
    };
  },
  component: AssetDetail,
});

const vibrationSeriesFallback = Array.from({ length: 96 }, (_, i) => {
  const base = 5.5 + Math.sin(i / 6) * 0.4;
  const ramp = i > 50 ? (i - 50) * 0.09 : 0;
  return { t: i, v: +(base + ramp).toFixed(2) };
});

function AssetDetail() {
  const { id } = useParams({ from: "/assets/$id" });
  const [activeRole] = useActiveRole();
  const assetQuery = useAsset(id);
  const impactQuery = useAssetImpact(id);
  const investigateQuery = useAssetInvestigation(id);
  const decisionQuery = useDecisionReport(id);
  const feedbackMutation = useSubmitFeedback();

  // Alert and log mutations
  const readAlert = useReadAlert();
  const alertsQuery = useAlerts({ asset_id: id, status: "active" });
  const createLog = useCreateLogEntry();

  const activeAlerts = alertsQuery.data?.alerts ?? [];

  const handleAcknowledge = async () => {
    if (activeAlerts.length === 0) return;
    try {
      await Promise.all(
        activeAlerts.map((alert) =>
          readAlert.mutateAsync({ alertId: alert.id, role: activeRole })
        )
      );
    } catch (err) {
      console.error("Failed to acknowledge alerts:", err);
    }
  };

  const handleAssignToCrew = async () => {
    try {
      await createLog.mutateAsync({
        asset_id: id || "",
        issue: "Maintenance crew dispatch requested",
        root_cause: "High priority anomaly alert",
        action: "Assign Mechanical Team 3",
        engineer_notes: `Assigned Mechanical Team 3 to inspect asset ${id} in role ${activeRole}`
      });
    } catch (err) {
      console.error("Failed to assign crew:", err);
    }
  };

  // Context store connection
  const { setActiveAssetId } = useOREONContext();
  useEffect(() => {
    setActiveAssetId(id);
    return () => setActiveAssetId(null);
  }, [id, setActiveAssetId]);

  // Real-time sensor stream
  const { getAssetHistory, getAssetLatest, isConnected } = useSensorStream();

  const [feedbackSaved, setFeedbackSaved] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [walkAroundLogged, setWalkAroundLogged] = useState(false);
  const [shutdownTriggered, setShutdownTriggered] = useState(false);
  const triggerAuthorize = () => setAuthorized(true);

  const raw = assetQuery.data;
  const downstream = impactQuery.data?.downstream_assets ?? [];
  const inv = investigateQuery.data;

  // Live telemetry for vibration history chart
  const vibrationSeries = useMemo(() => {
    const liveHistory = getAssetHistory(id || "");
    if (liveHistory && liveHistory.length > 5) {
      return liveHistory.map((reading, idx) => ({
        t: idx * 3,
        v: reading.vibration
      }));
    }
    return vibrationSeriesFallback;
  }, [id, getAssetHistory]);

  // Live sensor values
  const liveSensor = getAssetLatest(id || "");

  if (!raw) {
    return (
      <Shell title="Asset" subtitle={id}>
        <div className="px-8 py-20 text-center font-mono text-[13px] text-text-muted">
          {assetQuery.isError ? `Asset ${id} not found.` : "Loading asset…"}
        </div>
      </Shell>
    );
  }

  const asset = toUiAsset(raw);
  
  // Overlay live values if available
  const temperature = liveSensor ? liveSensor.temperature : asset.temperature;
  const vibration = liveSensor ? liveSensor.vibration : asset.vibration;
  const health = liveSensor ? Math.round(liveSensor.health_score) : asset.health;
  
  const status = health < 50 ? "critical" : health < 75 ? "warning" : "operational";
  const critTone = status === "critical" ? "crit" : status === "warning" ? "warn" : "cyan";

  const handleFeedback = (value: "helpful" | "not_helpful") => {
    feedbackMutation.mutate(
      {
        asset_id: asset.id,
        decision_type: "investigation",
        feedback_value: value,
        user_comments: `Feedback from asset detail screen for ${asset.id} in role ${activeRole}`,
      },
      {
        onSuccess: () => {
          setFeedbackSaved("Thank you for your feedback!");
          setTimeout(() => setFeedbackSaved(null), 3000);
        },
      }
    );
  };

  // Safe variables for dynamic evidence
  const diagnosisText = inv?.diagnosis ?? `${asset.id} status is currently ${status}.`;
  const rootCauseText = inv?.root_cause ?? "Check casing vibrations, thermal expansion, or SOP limits.";
  const confidenceScore = inv ? (inv.confidence <= 1 ? Math.round(inv.confidence * 100) : Math.round(inv.confidence)) : 80;

  // Sensor Evidence — categorise for display
  const sensorEvidenceList: string[] = inv?.evidence?.sensor_evidence ?? [
    `Elevated temperature detected (${temperature}°C).`,
    `Vibration is reading at ${vibration} mm/s.`,
  ];

  const sensorCritical = sensorEvidenceList.filter((e) => /^critical/i.test(e));
  const sensorWarning  = sensorEvidenceList.filter((e) => /^warning/i.test(e));
  const sensorTrend    = sensorEvidenceList.filter((e) => /increased|decreased/i.test(e));
  const sensorInsight  = sensorEvidenceList.filter(
    (e) => !/^(critical|warning)/i.test(e) && !/increased|decreased/i.test(e),
  );

  const sensorSummary =
    sensorEvidenceList.length === 0
      ? "Sensor parameters are inside normal threshold bands."
      : [
          sensorCritical.length > 0 && `${sensorCritical.length} critical`,
          sensorWarning.length  > 0 && `${sensorWarning.length} warning`,
          sensorTrend.length    > 0 && `${sensorTrend.length} trend`,
          sensorInsight.length  > 0 && `${sensorInsight.length} insight`,
        ]
          .filter(Boolean)
          .join(" · ") + " — expand to view breakdown";

  // SOP Evidence
  const sopEvidenceItem = inv?.evidence?.sop_evidence?.[0] || inv?.evidence?.manual_evidence?.[0];
  const sopText = sopEvidenceItem?.text ?? `Conduct diagnostic inspection of ${asset.id} if sensor telemetry exceeds limits.`;
  const sopDoc = sopEvidenceItem?.source_document ?? `${asset.equipmentType.toLowerCase()}_maintenance_sop.pdf`;

  // Historical Incidents
  const historicalIncidentsList = inv?.similar_incidents || [];

  // Business Impact metrics (Phase C)
  const bi = decisionQuery.data?.business_impact;

  /* ============ Center Section Render Panels ============ */
  
  const sensorTone: "crit" | "warn" | "cyan" =
    sensorCritical.length > 0 ? "crit" : sensorWarning.length > 0 ? "warn" : "cyan";

  const sensorPanel = (
    <Evidence
      key="sensor"
      tone={sensorTone}
      ok={sensorCritical.length === 0 && sensorWarning.length === 0}
      icon={<Waves className="size-4" strokeWidth={1.5} />}
      title="Sensor Analysis"
      finding={sensorSummary}
      source={`Source · PLC Tag database · ${asset.id}`}
      details={
        <div className="space-y-5">
          {/* Categorised evidence rows */}
          {sensorEvidenceList.length > 0 && (
            <div className="space-y-1">
              {sensorCritical.length > 0 && (
                <div className="mb-2">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-crit mb-1.5 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-crit inline-block" /> Critical
                  </div>
                  {sensorCritical.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1 px-2.5 rounded bg-crit/5 border border-crit/15 mb-1 last:mb-0">
                      <span className="size-1.5 rounded-full bg-crit shrink-0 mt-1.5" />
                      <span className="font-mono text-[11px] leading-[1.6] text-crit/90">{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {sensorWarning.length > 0 && (
                <div className="mb-2">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-warn mb-1.5 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-warn inline-block" /> Warning
                  </div>
                  {sensorWarning.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1 px-2.5 rounded bg-warn/5 border border-warn/15 mb-1 last:mb-0">
                      <span className="size-1.5 rounded-full bg-warn shrink-0 mt-1.5" />
                      <span className="font-mono text-[11px] leading-[1.6] text-warn/90">{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {sensorInsight.length > 0 && (
                <div className="mb-2">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-text-muted mb-1.5 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-text-muted inline-block" /> Insight
                  </div>
                  {sensorInsight.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1 px-2.5 rounded bg-surface-2 border border-border mb-1 last:mb-0">
                      <span className="size-1.5 rounded-full bg-text-muted shrink-0 mt-1.5" />
                      <span className="font-mono text-[11px] leading-[1.6] text-text-secondary">{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {sensorTrend.length > 0 && (
                <div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-cyan mb-1.5 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-cyan inline-block" /> Trend
                  </div>
                  {sensorTrend.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1 px-2.5 rounded bg-cyan/5 border border-cyan/15 mb-1 last:mb-0">
                      <span className="size-1.5 rounded-full bg-cyan shrink-0 mt-1.5" />
                      <span className="font-mono text-[11px] leading-[1.6] text-cyan/80">{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Vibration sparkline chart */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-text-muted mb-2">
              <span>Vibration Trend (last 60 ticks)</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={vibrationSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="t" stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} axisLine={false} domain={[2, 12]} />
                  <ReferenceLine y={9} stroke="var(--state-crit)" strokeDasharray="4 4" label={{ value: "9.0 mm/s limit", position: "right", fill: "var(--state-crit)", fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Line type="monotone" dataKey="v" stroke="var(--accent-cyan)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      }
    />
  );

  const manualPanel = (
    <Evidence
      key="manual"
      tone="cyan"
      ok
      icon={<BookOpen className="size-4" strokeWidth={1.5} />}
      title="Manual Match"
      finding={<>SOP match: <span className="font-mono text-cyan">{sopDoc}</span></>}
      source={`Matched via procedural knowledge retrieval`}
      details={
        <pre className="font-mono text-[12px] leading-[1.7] bg-surface-2 border border-border rounded p-4 text-text-secondary whitespace-pre-wrap">
          {sopText}
        </pre>
      }
    />
  );

  const historicalPanel = (
    <Evidence
      key="historical"
      tone="cyan"
      ok
      icon={<Clock className="size-4" strokeWidth={1.5} />}
      title="Historical Incidents"
      finding={historicalIncidentsList.length > 0
        ? `${historicalIncidentsList.length} matching incident(s) found in historical database.`
        : "No identical failure signatures logged in past 90 days."}
      source="Source · Incident log ledger"
      details={
        <table className="w-full text-[13px] font-mono">
          <thead>
            <tr className="border-b border-border/80 text-text-muted text-[10px] uppercase text-left">
              <th className="pb-2">ID</th>
              <th className="pb-2">Date</th>
              <th className="pb-2">Asset</th>
              <th className="pb-2">Root Cause</th>
            </tr>
          </thead>
          <tbody>
            {historicalIncidentsList.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-text-muted italic">No prior incidents found.</td>
              </tr>
            ) : (
              historicalIncidentsList.map((row: any) => (
                <tr key={row.incident_id || row.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 text-cyan">{row.incident_id || row.id}</td>
                  <td className="py-2 pr-4 text-text-secondary">
                    {row.timestamp ? new Date(row.timestamp).toLocaleDateString() : "Recent"}
                  </td>
                  <td className="py-2 pr-4 text-text-secondary">{row.asset_id}</td>
                  <td className="py-2 pr-4 text-text-secondary">{row.root_cause}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      }
    />
  );

  const impactPanel = (
    <Evidence
      key="impact"
      tone="warn"
      icon={<Network className="size-4" strokeWidth={1.5} />}
      title="Plant Impact"
      finding={
        downstream.length
          ? `Failure of ${asset.id} propagates to ${downstream.length} downstream asset${downstream.length > 1 ? "s" : ""} across ${impactQuery.data?.affected_production_lines.length ?? 0} production line(s).`
          : `${asset.id} has no mapped downstream dependencies.`
      }
      source={`Source · Plant topology graph · impact score ${impactQuery.data?.total_impact_score ?? 0}`}
      details={
        <div className="flex items-center gap-3 font-mono text-[12px] flex-wrap">
          <NodeChip label={asset.id} tone={critTone === "cyan" ? "ok" : critTone} />
          {downstream.slice(0, 5).map((ds) => (
            <span key={ds.id} className="flex items-center gap-3">
              <ChevronRight className="size-3 text-text-muted" />
              <NodeChip label={ds.id} tone={ds.status === "critical" || ds.status === "offline" ? "crit" : ds.status === "operational" ? "ok" : "warn"} />
            </span>
          ))}
        </div>
      }
    />
  );

  const timelinePanel = (
    <div key="timeline" className="border border-border/80 bg-surface-1/40 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4 border-b border-border pb-2">
        <span className="text-[11px] font-mono uppercase tracking-widest text-text-secondary">Operations Command Lifecycle Timeline</span>
        <span className="font-mono text-[10px] text-text-muted">Status: {status.toUpperCase()}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 relative pt-2">
        {[
          { num: 1, label: "Anomaly Detected", desc: "Telemetry limits breached" },
          { num: 2, label: "AI Investigation", desc: "Dual RAG SOP lookup" },
          { num: 3, label: "Risk Classified", desc: "Health & RUL scores" },
          { num: 4, label: "Escalation Routed", desc: "Roles & SLAs assigned" },
          { num: 5, label: "SLA Maintenance", desc: "Crew & spares dispatch" },
          { num: 6, label: "Feedback Loop", desc: "Helpfulness logs saved" },
        ].map((step) => {
          const getStepStatus = (num: number) => {
            const activeStep = status === "operational" ? 1 : status === "warning" ? 3 : 4;
            if (num <= activeStep) {
              if (num === 4 && (status === "warning" || status === "critical")) {
                return "bg-crit/15 border-crit text-crit shadow-[0_0_8px_rgba(239,68,68,0.2)]";
              }
              return "bg-cyan/15 border-cyan text-cyan shadow-[0_0_8px_rgba(6,182,212,0.2)]";
            }
            return "bg-surface-2 border-border text-text-muted";
          };
          const statusClass = getStepStatus(step.num);
          return (
            <div key={step.num} className="flex flex-col items-center text-center space-y-2 relative">
              <div className={`size-8 rounded-full border flex items-center justify-center font-mono text-[12px] font-bold transition-all ${statusClass}`}>
                {step.num}
              </div>
              <div className="text-[12px] font-semibold text-foreground leading-tight">{step.label}</div>
              <p className="text-[10px] text-text-muted leading-tight">{step.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  const businessImpactPanel = (
    <div key="business" className="card-flat p-5 space-y-4 border-l-2 border-red-500">
      <div className="flex justify-between items-center border-b border-border pb-2">
        <span className="text-[11px] font-mono uppercase tracking-widest text-red-400">Financial Business Impact</span>
        <span className="font-mono text-[10px] text-text-muted">Exposure Tier: {bi?.impact_level || "SEVERE"}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
        <div className="p-3 bg-surface-2 rounded border border-border">
          <div className="text-[10px] text-text-muted">REVENUE EXPOSURE</div>
          <div className="text-[18px] font-bold text-red-400 mt-1">
            ₹{bi?.revenue_exposure_inr ? (bi.revenue_exposure_inr / 1_00_000).toFixed(1) : "45.8"} Lakhs
          </div>
        </div>
        <div className="p-3 bg-surface-2 rounded border border-border">
          <div className="text-[10px] text-text-muted">COST OF INACTION</div>
          <div className="text-[18px] font-bold text-red-400 mt-1">
            ₹{bi?.cost_of_inaction_inr ? (bi.cost_of_inaction_inr / 1_00_000).toFixed(1) : "52.4"} Lakhs
          </div>
        </div>
        <div className="p-3 bg-surface-2 rounded border border-border">
          <div className="text-[10px] text-text-muted">ESTIMATED REPAIR COST</div>
          <div className="text-[18px] font-bold text-emerald-400 mt-1">
            ₹{bi?.cost_of_action_inr ? (bi.cost_of_action_inr / 1_000).toFixed(0) : "185"}k
          </div>
        </div>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed font-mono">
        {bi?.executive_summary || "Outage propagates to downstream operations, resulting in estimated production loss of 1,375 tonnes of steel."}
      </p>
    </div>
  );

  const rulLower = inv?.rul_lower ?? (asset.rul * 0.75);
  const rulUpper = inv?.rul_upper ?? (asset.rul * 1.25);
  const rulConfidence = inv?.rul_confidence ?? 89.4;

  const reliabilityPanel = (
    <div key="reliability" className="card-flat p-5 space-y-4 border-l-2 border-purple-500">
      <div className="flex justify-between items-center border-b border-border pb-2">
        <span className="text-[11px] font-mono uppercase tracking-widest text-purple-400">RUL Estimator Range & Confidence</span>
        <span className="font-mono text-[10px] text-text-muted">Confidence: {rulConfidence}%</span>
      </div>
      <div className="space-y-3 font-mono text-[12px]">
        <div className="flex justify-between">
          <span>Predicted Remaining Useful Life (RUL):</span>
          <span className="text-foreground font-bold">{asset.rul} Days</span>
        </div>
        <div className="flex justify-between text-[11px] text-text-muted">
          <span>80% Confidence Interval Bounds:</span>
          <span>{rulLower.toFixed(0)} to {rulUpper.toFixed(0)} Days</span>
        </div>
        <div className="relative pt-2">
          <div className="overflow-hidden h-2.5 text-xs flex rounded bg-surface-2 relative">
            <div
              style={{
                marginLeft: `${(rulLower / 120) * 100}%`,
                width: `${((rulUpper - rulLower) / 120) * 100}%`
              }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-purple-500/35"
            />
            <div
              style={{
                left: `${(asset.rul / 120) * 100}%`
              }}
              className="absolute size-3 -top-0.5 rounded-full bg-purple-500 border border-white"
            />
          </div>
        </div>
        <div className="text-[10px] text-text-muted pt-1">
          Estimator variance calculation derived from random forest trees disagreement. Deviation coefficient: 0.12.
        </div>
      </div>
    </div>
  );

  const renderCenterSection = () => {
    const panelsMap = {
      sensor: sensorPanel,
      manual: manualPanel,
      historical: historicalPanel,
      impact: impactPanel,
      timeline: timelinePanel,
      business: businessImpactPanel,
      reliability: reliabilityPanel,
    };

    let order: Array<keyof typeof panelsMap> = [];
    
    switch (activeRole) {
      case "plant_manager":
        order = ["business", "impact", "timeline"];
        break;
      case "maintenance_engineer":
        order = ["sensor", "manual", "historical", "timeline"];
        break;
      case "reliability_engineer":
        order = ["reliability", "sensor", "historical"];
        break;
      case "procurement_officer":
        order = ["manual", "business", "timeline"];
        break;
      case "supervisor":
        order = ["timeline", "impact", "historical"];
        break;
      case "operator":
      default:
        order = ["timeline", "sensor"];
        break;
    }

    return (
      <div className="space-y-4">
        {order.map((key) => panelsMap[key])}
      </div>
    );
  };

  /* ============ Sidebars Render Logic ============ */

  const renderLeftSidebar = () => {
    if (activeRole === "plant_manager") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-8">
          <FactBlock heading="ASSET FACTS" rows={[
            ["ID", asset.id],
            ["Type", asset.equipmentType || asset.type],
            ["Manufacturer", raw.manufacturer ?? "—"],
            ["Location", raw.location ?? asset.zone],
            ["Line", raw.production_line ?? "—"],
            ["Installed", raw.installation_year ? String(raw.installation_year) : "—"],
          ]} />
          
          <div className="card-flat p-4 border-l-2 border-red-500">
            <div className="label mb-2">Cost of Inaction</div>
            <div className="font-mono text-[24px] leading-none text-red-400">
              ₹{bi?.cost_of_inaction_inr ? (bi.cost_of_inaction_inr / 1_00_000).toFixed(1) : "52.4"} Lakhs
            </div>
            <div className="text-[10px] text-text-muted mt-2">Downtime: {bi?.downtime_hours || 12.5} hrs estimated</div>
          </div>
          
          <div className="card-flat p-4 border-l-2 border-emerald-500">
            <div className="label mb-2">Mitigation Budget</div>
            <div className="font-mono text-[24px] leading-none text-emerald-400">
              ₹{bi?.cost_of_action_inr ? (bi.cost_of_action_inr / 1_000).toFixed(0) : "185"}k
            </div>
            <div className="text-[10px] text-text-muted mt-2">Expedited replacement cost</div>
          </div>
        </aside>
      );
    }

    if (activeRole === "procurement_officer") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-8">
          <FactBlock heading="PART VULNERABILITY" rows={[
            ["Asset ID", asset.id],
            ["Asset Type", raw.equipment_type ?? asset.type],
            ["Criticality", asset.criticality.toUpperCase()],
            ["Production Line", raw.production_line ?? asset.zone],
            ["Location", raw.location ?? asset.zone],
          ]} />
          
          <div className="card-flat p-4 border-l-2 border-amber-500">
            <div className="label mb-2">Stock Availability</div>
            <div className="font-mono text-[20px] leading-none text-amber-400">0 Available</div>
            <div className="text-[10px] text-text-muted mt-2">Reorder threshold: 2 units</div>
          </div>

          <div className="card-flat p-4 border-l-2 border-amber-500">
            <div className="label mb-2">Supplier Lead Time</div>
            <div className="font-mono text-[20px] leading-none text-amber-400">14 Days</div>
            <div className="text-[10px] text-text-muted mt-2">SKF India Standard Delivery</div>
          </div>
        </aside>
      );
    }

    if (activeRole === "operator") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-8 flex flex-col items-center">
          <div className="w-full">
            <FactBlock heading="OPERATOR FACTS" rows={[
              ["Asset ID", asset.id],
              ["Location", raw.location ?? asset.zone],
              ["Production Line", raw.production_line ?? "—"],
            ]} />
          </div>
          <div className="flex flex-col items-center pt-2">
            <HealthGauge value={health} />
            <div className="label mt-3">Current Health</div>
          </div>
          <div className="card-flat p-4 w-full">
            <div className="label mb-2">OPERATOR STATUS</div>
            <div className="font-mono text-[16px] leading-none uppercase text-amber-400">CHECK LUBRICATION</div>
            <div className="text-[10px] text-text-muted mt-2">Confirm status with Supervisor</div>
          </div>
        </aside>
      );
    }

    // Default left side (Maintenance Eng, Reliability Eng, Supervisor)
    return (
      <aside className="col-span-12 lg:col-span-3 space-y-8">
        <FactBlock heading="ASSET FACTS" rows={[
          ["ID", asset.id],
          ["Type", asset.equipmentType || asset.type],
          ["Manufacturer", raw.manufacturer ?? "—"],
          ["Model", raw.model_number ?? "—"],
          ["Location", raw.location ?? asset.zone],
          ["Line", raw.production_line ?? "—"],
          ["Installed", raw.installation_year ? String(raw.installation_year) : "—"],
          ["Last service", raw.last_maintenance_date ? new Date(raw.last_maintenance_date).toLocaleDateString("en-GB") : "—"],
        ]} />

        <div>
          <div className="label mb-3">Live sensors <span className="text-text-muted/60 normal-case tracking-normal">· telemetry</span></div>
          <div className="space-y-2.5">
            <Sensor name="Vibration" value={vibration.toFixed(1)} unit="mm/s" tone={vibration > 7 ? "crit" : vibration > 4 ? "warn" : "ok"} />
            <Sensor name="Temp" value={temperature.toFixed(1)} unit="°C" tone={health < 50 ? "crit" : health < 75 ? "warn" : "ok"} />
            <Sensor name="Load" value={String(asset.load)} unit="%" tone={asset.load > 90 ? "warn" : "ok"} />
            <Sensor name="Health" value={String(health)} unit="%" tone={health < 50 ? "crit" : health < 75 ? "warn" : "ok"} />
          </div>
        </div>

        <div className="flex flex-col items-center pt-2">
          <HealthGauge value={health} />
          <div className="label mt-3">Health</div>
        </div>

        <div className="card-flat p-4">
          <div className="label mb-2">Remaining useful life</div>
          <div className="font-mono text-[28px] leading-none">{asset.rul} <span className="text-[14px] text-text-muted">days</span></div>
          <div className="font-mono text-[11px] text-text-muted mt-2">Failure probability {asset.risk}%</div>
        </div>
      </aside>
    );
  };

  const renderRightSidebar = () => {
    const topAssetId = asset.id;
    const recText = decisionQuery.data?.recommendations_by_role?.[activeRole] || inv?.recommended_actions?.[0] || "Inspect component bearing casing & lube levels immediately.";

    if (activeRole === "plant_manager") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="text-[14px] font-semibold mb-3 flex items-center justify-between">
              <span>Financial Summary</span>
              <span className="text-[9px] font-mono text-cyan uppercase bg-cyan/15 border border-cyan/20 px-2 py-0.5 rounded font-bold shrink-0">
                Plant Manager
              </span>
            </div>
            <div className="rounded-lg border border-red-500/40 bg-red-500/[0.04] p-4 flex flex-col justify-between min-h-[200px]">
              <div>
                <div className="text-[13px] mb-4 leading-relaxed font-mono text-foreground">
                  Delaying maintenance beyond the 12-day RUL window risks severe shut-down costs. Immediate repair is highly cost-effective.
                </div>
                <KV label="Exposure" value={`₹${bi?.revenue_exposure_inr ? (bi.revenue_exposure_inr / 1_00_000).toFixed(1) : "45.8"}L`} />
                <KV label="Operating Loss" value="₹3.5L/hr" />
                <KV label="Approved Budget" value="₹1.85L" />
              </div>
              <button
                onClick={triggerAuthorize}
                className={`w-full py-2 border rounded font-mono text-[11px] uppercase tracking-wider transition-all mt-4 ${authorized ? "bg-emerald-500 border-emerald-500 text-white" : "border-red-500 text-red-400 bg-red-500/5 hover:bg-red-500/10 cursor-pointer"}`}
              >
                {authorized ? "Repair Approved ✓" : "Approve Repair Budget"}
              </button>
            </div>
          </div>
          <div>
            <div className="label mb-3">Downstream Risk Details</div>
            <div className="space-y-2 font-mono text-[11px] text-text-muted">
              <div>• PL-1 line will stop operations completely.</div>
              <div>• Downstream Conveyor C7 will experience starvation trip.</div>
              <div>• Coke Oven B scheduling delays will accrue bottleneck fees.</div>
            </div>
          </div>
        </aside>
      );
    }

    if (activeRole === "procurement_officer") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="text-[14px] font-semibold mb-3 flex items-center justify-between">
              <span>Spare Reorder PO</span>
              <span className="text-[9px] font-mono text-amber-400 uppercase bg-amber-500/15 border border-amber-500/20 px-2 py-0.5 rounded font-bold shrink-0">
                Procurement
              </span>
            </div>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-4 flex flex-col justify-between min-h-[200px]">
              <div>
                <div className="text-[13px] mb-4 leading-relaxed font-mono text-foreground">
                  Spherical Roller Bearing SKU-2241 (SKF India) needs immediate procurement. Lead time exceeds RUL by 2 days.
                </div>
                <KV label="Unit Cost" value="₹1.85 Lakhs" />
                <KV label="Lead Time" value="14 Days" />
                <KV label="Emergency Fee" value="₹25,000" />
              </div>
              <button
                onClick={triggerAuthorize}
                className={`w-full py-2 border rounded font-mono text-[11px] uppercase tracking-wider transition-all mt-4 ${authorized ? "bg-emerald-500 border-emerald-500 text-white" : "border-amber-500 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer"}`}
              >
                {authorized ? "Expedited PO Issued ✓" : "Issue Expedited PO"}
              </button>
            </div>
          </div>
          <div>
            <div className="label mb-3">Alternate Sourcing</div>
            <div className="space-y-2">
              <Alternate title="NEI Bearings Ltd" meta="Delivery: 3 days · Unit Cost: ₹2.1L · In Stock" />
              <Alternate title="FAG India" meta="Delivery: 8 days · Unit Cost: ₹1.9L · In Stock" />
            </div>
          </div>
        </aside>
      );
    }

    if (activeRole === "supervisor") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="text-[14px] font-semibold mb-3 flex items-center justify-between">
              <span>Escalation & SLA Control</span>
              <span className="text-[9px] font-mono text-rose-400 uppercase bg-rose-500/15 border border-rose-500/20 px-2 py-0.5 rounded font-bold shrink-0">
                Supervisor
              </span>
            </div>
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.04] p-4 flex flex-col justify-between min-h-[220px]">
              <div>
                <div className="text-[13px] mb-3 leading-relaxed font-mono text-foreground">
                  SLA Response: 24 mins remaining of 4h window. Escalated to Mech Team 3.
                </div>
                <KV label="Incident logged" value="14:36 IST" />
                <KV label="SLA Window" value="4 Hours" />
                <KV label="Shift On-Duty" value="Mechanical Team 3" />
              </div>
              <button
                onClick={triggerAuthorize}
                className={`w-full py-2 border rounded font-mono text-[11px] uppercase tracking-wider transition-all mt-4 ${authorized ? "bg-emerald-500 border-emerald-500 text-white" : "border-rose-500 text-rose-400 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer"}`}
              >
                {authorized ? "Radio Dispatch Sent ✓" : "Radio Dispatch Crew"}
              </button>
            </div>
          </div>
          <div>
            <div className="label mb-3">Supervisor Actions</div>
            <div className="space-y-2">
              <button className="w-full text-left py-2 px-3 bg-surface-2 border border-border text-[12px] font-mono rounded hover:bg-surface-1 flex justify-between items-center cursor-pointer">
                <span>Reassign to Mech Team 2</span>
                <ChevronRight className="size-3.5" />
              </button>
              <button className="w-full text-left py-2 px-3 bg-surface-2 border border-border text-[12px] font-mono rounded hover:bg-surface-1 flex justify-between items-center cursor-pointer">
                <span>Extend SLA Response Window</span>
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </aside>
      );
    }

    if (activeRole === "operator") {
      return (
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div>
            <div className="text-[14px] font-semibold mb-3 flex items-center justify-between">
              <span>Field Quick Guide</span>
              <span className="text-[9px] font-mono text-emerald-400 uppercase bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 rounded font-bold shrink-0">
                Operator
              </span>
            </div>
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.04] p-4 flex flex-col justify-between min-h-[200px]">
              <div>
                <div className="text-[13px] mb-4 leading-relaxed font-sans text-foreground">
                  Check lubrication, casing temperature, and listen for loud grinding noise. Report back.
                </div>
                <div className="space-y-2 text-[12px] font-mono">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded border-border" />
                    <span>Lubrication level OK</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded border-border" />
                    <span>No audible grinding</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded border-border" />
                    <span>Housing temp &lt; 80°C</span>
                  </div>
                </div>
              </div>
              <button
                onClick={triggerAuthorize}
                className={`w-full py-2 border rounded font-mono text-[11px] uppercase tracking-wider transition-all mt-4 ${authorized ? "bg-emerald-500 border-emerald-500 text-white" : "border-emerald-500 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer"}`}
              >
                {authorized ? "Log Completed ✓" : "Save Inspection Log"}
              </button>
            </div>
          </div>
          <button
            onClick={() => { triggerAuthorize(); setShutdownTriggered(true); }}
            disabled={shutdownTriggered}
            className={`w-full py-2.5 border font-mono rounded text-[11px] uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all ${shutdownTriggered ? "border-red-500 bg-red-500 text-white opacity-90" : "border-red-500 text-red-400 hover:bg-red-500/10"}`}
          >
            <ShieldAlert className="size-4" />
            {shutdownTriggered ? "Shutdown Triggered ✓" : "Trigger Emergency Shutdown"}
          </button>
        </aside>
      );
    }

    // Default right sidebar (Maintenance Eng, Reliability Eng)
    return (
      <aside className="col-span-12 lg:col-span-3 space-y-6">
        <div>
          <div className="text-[14px] font-semibold mb-3 flex items-center justify-between">
            <span>Role Recommendation</span>
            <span className="text-[9px] font-mono text-cyan uppercase bg-cyan/15 border border-cyan/20 px-2 py-0.5 rounded font-bold shrink-0">
              {activeRole === "maintenance_engineer" ? "Maint Eng" : activeRole === "reliability_engineer" ? "Reliability" : (activeRole as string).replace("_", " ")}
            </span>
          </div>
          <div className="rounded-lg border border-cyan/40 bg-cyan/[0.04] p-4 flex flex-col justify-between min-h-[200px]">
            <div>
              <div className="text-[13px] mb-4 leading-relaxed font-medium text-foreground">
                {recText}
              </div>
              <KV label="RUL Days" value={`${asset.rul} days`} />
              <KV label="Health Score" value={`${health}%`} />
              <KV label="Risk Level" value={inv?.risk_level?.toUpperCase() || status.toUpperCase()} />
            </div>
            
            {/* Helpfulness feedback loop */}
            <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                <span>Was this recommendation helpful?</span>
              </div>
              {feedbackSaved ? (
                <div className="text-[10px] font-mono text-ok">{feedbackSaved}</div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFeedback("helpful")}
                    className="flex-1 py-1 px-2 border border-ok/30 hover:border-ok/80 bg-ok/5 hover:bg-ok/10 text-ok transition-all rounded flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-wider"
                  >
                    <ThumbsUp className="size-3" /> Yes
                  </button>
                  <button
                    onClick={() => handleFeedback("not_helpful")}
                    className="flex-1 py-1 px-2 border border-crit/30 hover:border-crit/80 bg-crit/5 hover:bg-crit/10 text-crit transition-all rounded flex items-center justify-center gap-1.5 font-mono text-[9px] uppercase tracking-wider"
                  >
                    <ThumbsDown className="size-3" /> No
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="label mb-3">Procurement</div>
          <div className="space-y-2 font-mono text-[12px]">
            <div className="flex items-center gap-2 text-ok"><span className="size-1.5 rounded-full bg-ok" /> Spare in stock <span className="text-text-muted ml-auto">SKU-2241</span></div>
            <KV label="Quantity" value="Available" />
            <KV label="Lead time" value="Immediate dispatch" />
            <KV label="Location" value="Warehouse A · Bin 14" />
          </div>
        </div>

        <div>
          <div className="label mb-3">Alternate options</div>
          <Alternate
            title="Planned schedule replacement"
            meta="Risk → medium · ₹1.8L · 91% within RUL"
          />
          <Alternate
            title="Continue running (no shutdown)"
            meta="Risk → critical · High downtime cost · NOT RECOMMENDED"
            bad
          />
        </div>
      </aside>
    );
  };

  return (
    <Shell title="Asset" subtitle={`${asset.name} (${asset.id})`}>
      <div className="h-full overflow-y-auto px-8 py-6 max-w-[1600px] mx-auto">
        {/* Breadcrumb */}
        <div className="font-mono text-[12px] text-text-muted mb-6">
          <Link to="/command" className="hover:text-foreground">Command</Link>
          <span className="text-border mx-2">/</span>
          <Link to="/assets" className="hover:text-foreground">Assets</Link>
          <span className="text-border mx-2">/</span>
          <span className="text-foreground">{asset.name} ({asset.id})</span>
        </div>

        {/* Page header */}
        <div className="flex items-start justify-between gap-8 pb-8 border-b border-border">
          <div>
            <div className="label mb-3">Asset detail · updated 12s ago</div>
            <div className="font-sans text-[32px] font-bold leading-none mb-2 tracking-tight text-foreground">{asset.name}</div>
            <div className="font-mono text-[16px] text-text-muted mb-3">{asset.id}</div>
            <div className="text-[18px] text-text-secondary">
              {asset.type} · {asset.zone}{raw.installation_year ? ` · Installed ${raw.installation_year}` : ""}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Pill label={status.toUpperCase()} tone={critTone} dot />
            <Pill label={`${asset.criticality.toUpperCase()} CRITICALITY`} tone="warn" />
            <Pill label={`${asset.risk}% FAILURE PROB`} tone="cyan" />
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-12 gap-8 mt-8">
          {/* LEFT fact panel */}
          {renderLeftSidebar()}

          {/* CENTER evidence rail */}
          <section className="col-span-12 lg:col-span-6">
            <h2 className="text-[14px] font-semibold mb-1">Evidence Trail</h2>
            <p className="text-[13px] text-text-muted mb-6">
              Corroborated decision metrics indexed by OREON RAG.
            </p>
            
            {renderCenterSection()}
            
            <div className="h-px bg-border my-6" />
            <p className="text-[14px] leading-[1.6] text-violet mb-6">
              Diagnosis: {diagnosisText} Root Cause: {rootCauseText} Confidence score evaluated at {confidenceScore}%.
            </p>
          </section>

          {/* RIGHT recommendation & actions */}
          {renderRightSidebar()}
        </div>

        {/* Bottom strip */}
        <div className="mt-10 pt-6 border-t border-border flex flex-wrap items-center gap-3">
          {activeRole === "operator" ? (
            <>
              <button
                onClick={() => {
                  triggerAuthorize();
                  setWalkAroundLogged(true);
                  setTimeout(() => setWalkAroundLogged(false), 4000);
                }}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-md border font-mono text-[12px] transition-all cursor-pointer ${walkAroundLogged ? "border-ok/40 bg-ok/10 text-ok" : "border-border bg-surface-1 hover:bg-surface-2 text-text-secondary hover:text-foreground"}`}
              >
                {walkAroundLogged ? <><Check className="size-3.5" /> Walk-Around Logged</> : <><Eye className="size-3.5" /> Log local walk-around check</>}
              </button>
            </>
          ) : (
            <>
              <ActionBtn
                icon={<UserCheck className="size-3.5" />}
                onClick={handleAcknowledge}
                disabled={activeAlerts.length === 0 || readAlert.isPending}
              >
                {readAlert.isPending ? "Acknowledging..." : activeAlerts.length === 0 ? "Acknowledged" : "Mark as acknowledged"}
              </ActionBtn>
              <ActionBtn
                icon={<Activity className="size-3.5" />}
                onClick={handleAssignToCrew}
                disabled={createLog.isPending}
              >
                {createLog.isPending ? "Assigning..." : "Assign to crew"}
              </ActionBtn>
            </>
          )}
          
          <a
            href={reportApi.downloadUrl(asset.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-electric/40 bg-electric/5 hover:bg-electric/10 hover:border-electric/70 font-mono text-[12px] text-electric hover:text-foreground transition-colors"
          >
            <Download className="size-3.5" />
            Export report (PDF)
          </a>
        </div>
      </div>
    </Shell>
  );
}

/* ============ Subcomponents ============ */

function Pill({ label, tone, dot }: { label: string; tone: "crit" | "warn" | "cyan"; dot?: boolean }) {
  const map = {
    crit: "bg-crit/10 text-crit border-crit/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    cyan: "bg-cyan/10 text-cyan border-cyan/30",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border font-mono text-[11px] tracking-wide ${map[tone]}`}>
      {dot && <span className={"size-1.5 rounded-full bg-" + tone} />}
      {label}
    </span>
  );
}

function FactBlock({ heading, rows }: { heading: string; rows: [string, string][] }) {
  return (
    <div>
      <div className="label mb-3">{heading}</div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-text-muted">{k}</span>
            <span className="font-mono text-[13px] text-foreground text-right">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sensor({ name, value, unit, tone }: { name: string; value: string; unit: string; tone: "crit" | "warn" | "ok" }) {
  const color = tone === "crit" ? "var(--state-crit)" : tone === "warn" ? "var(--state-warn)" : "var(--state-ok)";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-text-muted w-[68px] shrink-0">{name}</span>
      <span className="font-mono text-[13px] text-foreground w-[68px] shrink-0">{value}<span className="text-text-muted text-[11px] ml-0.5">{unit}</span></span>
      <svg viewBox="0 0 60 16" className="w-[60px] h-[16px]">
        <polyline
          points={Array.from({ length: 12 }, (_, i) => `${i * 5},${8 + Math.sin(i + name.length) * (tone === "crit" ? 6 : tone === "warn" ? 4 : 2)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function HealthGauge({ value }: { value: number }) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  const color = value < 50 ? "var(--state-crit)" : value < 75 ? "var(--state-warn)" : "var(--state-ok)";
  return (
    <div className="relative size-[120px]">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
        <motion.circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${dash} ${c}` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[28px] leading-none" style={{ color }}>{value}<span className="text-[14px] text-text-muted">%</span></span>
      </div>
    </div>
  );
}

function Evidence({
  tone, icon, title, finding, source, details, ok,
}: {
  tone: "cyan" | "warn" | "crit";
  icon: React.ReactNode;
  title: string;
  finding: React.ReactNode;
  source: string;
  details: React.ReactNode;
  ok?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const accent = tone === "cyan" ? "var(--accent-cyan)" : tone === "warn" ? "var(--state-warn)" : "var(--state-crit)";
  return (
    <div className="card-flat overflow-hidden" style={{ borderLeft: `2px solid ${accent}` }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-4 cursor-pointer">
        <div className="flex items-start gap-3">
          <span style={{ color: accent }} className="mt-0.5">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-semibold">{title}</span>
              <span className="flex items-center gap-2">
                {ok ? <Check className="size-3.5 text-ok" /> : <TriangleAlert className="size-3.5 text-warn" />}
                <ChevronDown className={"size-3.5 text-text-muted transition-transform " + (open ? "rotate-180" : "")} />
              </span>
            </div>
            <div className="text-[15px] leading-[1.5] text-foreground">{finding}</div>
            <div className="font-mono text-[10px] text-text-muted mt-3">{source}</div>
          </div>
        </div>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-border bg-background/40 overflow-hidden"
        >
          <div className="px-4 pb-4 pt-2 max-h-[400px] overflow-y-auto overscroll-contain">
            {details}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function NodeChip({ label, tone }: { label: string; tone: "crit" | "warn" | "ok" }) {
  const color = tone === "crit" ? "var(--state-crit)" : tone === "warn" ? "var(--state-warn)" : "var(--state-ok)";
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border" style={{ borderColor: color, color }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[12px]">
      <span className="text-text-muted">{label}</span>
      <span className={"font-mono " + (tone === "ok" ? "text-ok" : "text-foreground")}>{value}</span>
    </div>
  );
}

function Alternate({ title, meta, bad }: { title: string; meta: string; bad?: boolean }) {
  return (
    <div className="card-flat p-3 mb-2">
      <div className="flex items-center justify-between">
        <div className="text-[13px]">{title}</div>
        <button className="font-mono text-[11px] text-cyan hover:underline cursor-pointer">Simulate →</button>
      </div>
      <div className={"text-[11px] mt-1 " + (bad ? "text-crit" : "text-text-muted")}>{meta}</div>
    </div>
  );
}

function ActionBtn({ icon, children, onClick, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-surface-1 hover:bg-surface-2 font-mono text-[12px] text-text-secondary hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}
