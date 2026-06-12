import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Flame,
  Layers,
  Maximize2,
  Minus,
  Plus,
  X,
  Clock,
  DollarSign,
  Settings,
  HelpCircle,
  FileText,
  Radio,
  Box,
  Grid3X3,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
const Plant3D = lazy(() => import("@/components/oreon/plant-3d").then((m) => ({ default: m.Plant3D })));
import { Shell } from "@/components/oreon/shell";
import { useAssets, usePlantGraph, useSpares, useLogbook } from "@/lib/api/hooks";
import { reportApi } from "@/lib/api/endpoints";
import { useOREONContext } from "@/lib/context-store";
import { toUiAsset, type Asset, type Status, ASSET_DISPLAY_NAMES, statusFromBackend } from "@/lib/oreon-data";
import { useSensorStream } from "@/lib/api/use-sensor-stream";

export const Route = createFileRoute("/twin")({
  head: () => ({
    meta: [
      { title: "Digital Twin · OREON" },
      { name: "description", content: "Interactive plant topology." },
    ],
  }),
  component: Twin,
});

type TwinMode = "topology" | "health" | "risk" | "rul" | "business" | "maintenance";

const NODE_R = 16;

const ASSET_BUSINESS_CASE: Record<string, { exposure: number; downtimeCost: number; expectedDowntime: number }> = {
  "BlastFurnace_BF2": { exposure: 79_00_00_000, downtimeCost: 15_00_000, expectedDowntime: 14 },
  "RollingMill_RM1": { exposure: 62_00_00_000, downtimeCost: 12_00_00_000, expectedDowntime: 12 },
  "Gearbox_G1": { exposure: 41_00_00_000, downtimeCost: 8_00_000, expectedDowntime: 10 },
  "Conveyor_C7": { exposure: 28_00_00_000, downtimeCost: 6_00_00_000, expectedDowntime: 8 },
  "CoolingSystem_C1": { exposure: 24_00_00_000, downtimeCost: 5_50_000, expectedDowntime: 8 },
  "Motor_M12": { exposure: 18_00_00_000, downtimeCost: 4_50_000, expectedDowntime: 6 },
  "Pump_P3": { exposure: 15_00_00_000, downtimeCost: 3_50_000, expectedDowntime: 6 },
  "Fan_F2": { exposure: 12_00_00_000, downtimeCost: 3_00_000, expectedDowntime: 5 },
  "Crusher_CR1": { exposure: 9_00_00_000, downtimeCost: 2_50_000, expectedDowntime: 4 },
  "DustCollector_DC1": { exposure: 6_00_00_000, downtimeCost: 1_80_000, expectedDowntime: 4 },
};

function conditionSummary(a: Asset): string {
  if (a.status === "critical")
    return `Failure trajectory detected — health at ${a.health}% with ${a.risk}% failure probability. Estimated ${a.rul} days to functional failure. Immediate maintenance intervention recommended.`;
  if (a.status === "warning")
    return `Early degradation indicators present — health at ${a.health}%. Recommend inspection within ${Math.max(3, Math.round(a.rul * 0.4))} days to prevent escalation.`;
  return `Operating within normal parameters — health at ${a.health}%, failure risk ${a.risk}%. No intervention required before next scheduled service.`;
}

function formatINR(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)} Cr`;
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function getDownstreamReachable(startId: string, edges: { from: string; to: string }[]): Set<string> {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    edges.forEach((e) => { if (e.from === curr && !visited.has(e.to)) { visited.add(e.to); queue.push(e.to); } });
  }
  return visited;
}

function nodeColor(mode: TwinMode, a: Asset, isDownstream: boolean, isSelected: boolean): string {
  if (mode === "maintenance") {
    // Purple for needs-maintenance, green for healthy — everything visible
    return a.health < 75 ? "oklch(0.72 0.15 295)" : "oklch(0.60 0.12 160)";
  }
  if (mode === "topology") {
    switch (a.type) {
      case "Blast Furnace": return "oklch(0.65 0.24 27)";
      case "Conveyor": return "oklch(0.78 0.16 75)";
      case "Rolling Mill": return "oklch(0.69 0.22 350)";
      case "Pump": return "oklch(0.74 0.16 160)";
      case "Fan": return "oklch(0.74 0.14 200)";
      case "Gearbox": return "oklch(0.68 0.20 290)";
      case "Crusher": return "oklch(0.71 0.18 50)";
      case "Dust Collector": return "oklch(0.55 0.04 240)";
      case "Motor": return "oklch(0.60 0.16 260)";
      case "Cooling System": return "oklch(0.80 0.14 200)";
      default: return "oklch(0.55 0.04 240)";
    }
  }
  if (mode === "health") return a.health < 50 ? "oklch(0.65 0.22 25)" : a.health < 75 ? "oklch(0.78 0.16 75)" : "oklch(0.74 0.16 160)";
  if (mode === "risk") return a.risk >= 60 ? "oklch(0.65 0.22 25)" : a.risk >= 30 ? "oklch(0.78 0.16 75)" : "oklch(0.74 0.16 160)";
  if (mode === "rul") return a.rul < 15 ? "oklch(0.65 0.22 25)" : a.rul <= 60 ? "oklch(0.78 0.16 75)" : "oklch(0.74 0.16 160)";
  if (mode === "business") {
    const exp = ASSET_BUSINESS_CASE[a.id]?.exposure ?? 0;
    return exp >= 50_00_00_000 ? "oklch(0.65 0.22 25)" : exp >= 15_00_00_000 ? "oklch(0.78 0.16 75)" : "oklch(0.74 0.16 160)";
  }
  return "oklch(0.80 0.14 200)";
}

const MODES: { v: TwinMode; label: string; I: any }[] = [
  { v: "topology", label: "Topology", I: Layers },
  { v: "health", label: "Health", I: Activity },
  { v: "risk", label: "Risk", I: Flame },
  { v: "rul", label: "RUL", I: Clock },
  { v: "business", label: "Impact", I: DollarSign },
  { v: "maintenance", label: "Maintenance", I: Settings },
];

function Twin() {
  const [mode, setMode] = useState<TwinMode>("health");
  const [is3D, setIs3D] = useState(true);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [timeShift, setTimeShift] = useState<number>(0);
  const [showTimeMachine, setShowTimeMachine] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 900, h: 650 });
  const [vt, setVt] = useState({ scale: 1, tx: 0, ty: 0 });
  const panRef = useRef<{ active: boolean; startX: number; startY: number; startTx: number; startTy: number }>({ active: false, startX: 0, startY: 0, startTx: 0, startTy: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const { data: raw = [] } = useAssets();
  const graphQuery = usePlantGraph();
  const setSidebarCollapsed = useOREONContext((s) => s.setSidebarCollapsed);
  const { setActiveAssetId } = useOREONContext();
  const { latestByAsset } = useSensorStream();

  useEffect(() => { setSidebarCollapsed(true); return () => { setSidebarCollapsed(false); }; }, [setSidebarCollapsed]);

  const rawAssets = useMemo(() => {
    return raw.map((a) => {
      const uiAsset = toUiAsset(a);
      const live = latestByAsset.get(a.id);
      if (live) {
        const health = Math.round(live.health_score);
        const status = statusFromBackend(health < 50 ? "critical" : health < 75 ? "warning" : "operational");
        const risk = live.is_anomaly ? Math.min(99, Math.round(uiAsset.risk + (live.vibration > 9.0 ? 30 : 10))) : uiAsset.risk;
        const load = Math.min(99, Math.max(5, Math.round(55 + (health < 75 ? 30 : 5) * 0.35 + (live.temperature % 15))));

        return {
          ...uiAsset,
          health,
          temperature: live.temperature,
          vibration: live.vibration,
          load,
          status,
          risk: Math.max(1, Math.min(99, risk)),
        };
      }
      return uiAsset;
    });
  }, [raw, latestByAsset]);

  const assets = useMemo(() => {
    return rawAssets.map((a) => {
      let health = a.health, rul = a.rul, risk = a.risk;
      if (timeShift === -30) { health = Math.min(100, a.health + 8); rul = a.rul + 30; risk = Math.max(5, a.risk - 12); }
      else if (timeShift === 30) { health = Math.max(10, a.health - Math.round(a.risk * 0.22) - 4); rul = Math.max(0, a.rul - 30); risk = Math.min(99, a.risk + 8); }
      else if (timeShift === 60) { health = Math.max(10, a.health - Math.round(a.risk * 0.52) - 9); rul = Math.max(0, a.rul - 60); risk = Math.min(99, a.risk + 20); }
      else if (timeShift === 90) { health = Math.max(10, a.health - Math.round(a.risk * 0.82) - 16); rul = Math.max(0, a.rul - 90); risk = Math.min(99, a.risk + 32); }
      const status: Status = health < 50 ? "critical" : health < 75 ? "warning" : "healthy";
      return { ...a, health, rul, risk, status };
    });
  }, [rawAssets, timeShift]);

  const activeSelectedAsset = useMemo(() => selected ? assets.find(a => a.id === selected.id) ?? selected : null, [selected, assets]);
  const logbook = useLogbook(selected?.id || undefined, 5);
  const spares = useSpares({ equipment_type: selected?.equipmentType });
  const px = (pct: number) => (pct / 100) * svgSize.w;
  const py = (pct: number) => (pct / 100) * svgSize.h;

  const edges = useMemo(() => (graphQuery.data?.edges ?? []).flatMap((edge) => {
    const from = assets.find((x) => x.id === edge.from), to = assets.find((x) => x.id === edge.to);
    return from && to ? [{ from, to }] : [];
  }), [assets, graphQuery.data]);

  const downstreamList = useMemo(() => new Set<string>(), []);

  useEffect(() => { const el = containerRef.current; if (!el) return; const update = () => setSvgSize({ w: el.clientWidth, h: el.clientHeight }); update(); const ro = new ResizeObserver(update); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { const svg = svgRef.current; if (!svg) return; const onWheel = (e: WheelEvent) => { e.preventDefault(); const rect = svg.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; setVt(p => { const ns = Math.max(0.25, Math.min(6, p.scale * f)); return { scale: ns, tx: mx - (mx - p.tx) * (ns / p.scale), ty: my - (my - p.ty) * (ns / p.scale) }; }); }; svg.addEventListener("wheel", onWheel, { passive: false }); return () => svg.removeEventListener("wheel", onWheel); }, []);

  const zoomCenter = (f: number) => { const mx = svgSize.w / 2, my = svgSize.h / 2; setVt(p => { const ns = Math.max(0.25, Math.min(6, p.scale * f)); return { scale: ns, tx: mx - (mx - p.tx) * (ns / p.scale), ty: my - (my - p.ty) * (ns / p.scale) }; }); };
  const startPan = (e: React.MouseEvent) => { panRef.current = { active: true, startX: e.clientX, startY: e.clientY, startTx: vt.tx, startTy: vt.ty }; setIsPanning(true); };
  const movePan = (e: React.MouseEvent) => { if (!panRef.current.active) return; setVt(p => ({ ...p, tx: panRef.current.startTx + e.clientX - panRef.current.startX, ty: panRef.current.startTy + e.clientY - panRef.current.startY })); };
  const endPan = () => { panRef.current.active = false; setIsPanning(false); };

  const kpis = useMemo(() => {
    if (assets.length === 0) return { health: 100, critical: 0, predicted: 0 };
    return { health: Math.round(assets.reduce((s, a) => s + a.health, 0) / assets.length), critical: assets.filter(a => a.health < 50).length, predicted: assets.filter(a => a.rul > 0 && a.rul < 30).length };
  }, [assets]);

  return (
    <Shell title="Digital Twin" subtitle="Operations Command Center">
      <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">

        {/* ━━━ Toolbar ━━━ */}
        <div className="h-10 shrink-0 border-b border-border bg-surface-1 flex items-center px-3 gap-1">

          {/* Mode selector buttons — each has icon + label, always readable */}
          <div className="flex items-center gap-0.5 mr-3">
            {MODES.map(({ v, label, I }) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md font-mono text-[10px] transition-colors cursor-pointer border ${
                  mode === v
                    ? "bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-primary border-primary/20 font-semibold"
                    : "text-text-muted hover:text-foreground hover:bg-surface-2 border-transparent"
                }`}
              >
                <I className="size-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-border mx-1" />

          {/* View toggle */}
          <div className="flex items-center gap-0.5 bg-surface-2 rounded-md p-0.5">
            <button onClick={() => setIs3D(true)} className={`inline-flex items-center gap-1 h-6 px-2 rounded font-mono text-[10px] cursor-pointer transition-colors ${is3D ? "bg-surface-1 text-foreground shadow-sm border border-border" : "text-text-muted hover:text-foreground"}`}>
              <Box className="size-3" /> 3D
            </button>
            <button onClick={() => setIs3D(false)} className={`inline-flex items-center gap-1 h-6 px-2 rounded font-mono text-[10px] cursor-pointer transition-colors ${!is3D ? "bg-surface-1 text-foreground shadow-sm border border-border" : "text-text-muted hover:text-foreground"}`}>
              <Grid3X3 className="size-3" /> 2D
            </button>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-border mx-1" />

          {/* Time Machine toggle */}
          <button
            onClick={() => setShowTimeMachine(!showTimeMachine)}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md font-mono text-[10px] cursor-pointer border transition-colors ${
              showTimeMachine
                ? "bg-[color-mix(in_oklch,var(--state-warn)_10%,transparent)] text-warn border-warn/20 font-semibold"
                : "text-text-muted hover:text-foreground border-transparent hover:bg-surface-2"
            }`}
          >
            <Clock className="size-3" />
            <span>Time Machine</span>
            {timeShift !== 0 && <span className="text-[9px] ml-0.5 opacity-80">({timeShift > 0 ? "+" : ""}{timeShift}d)</span>}
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Status indicators */}
          <div className="flex items-center gap-3 mr-3">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] text-text-muted uppercase">Health</span>
              <span className={`font-mono text-[11px] font-semibold ${kpis.health >= 75 ? "text-ok" : kpis.health >= 50 ? "text-warn" : "text-crit"}`}>{kpis.health}%</span>
            </div>
            {kpis.critical > 0 && (
              <div className="flex items-center gap-1">
                <span className="size-[5px] rounded-full bg-crit" />
                <span className="font-mono text-[10px] text-crit">{kpis.critical} critical</span>
              </div>
            )}
          </div>

          {/* War Room — link to dedicated page */}
          <Link
            to="/warroom"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md font-mono text-[10px] cursor-pointer border transition-colors text-text-muted hover:text-foreground border-transparent hover:bg-surface-2"
          >
            <Radio className="size-3" />
            <span>War Room</span>
          </Link>
        </div>

        {/* ━━━ Main Area ━━━ */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Canvas */}
          <div className="flex-1 flex flex-col min-w-0">
            <div ref={containerRef} className="flex-1 relative overflow-hidden min-h-0">
              {is3D ? (
                <div className="absolute inset-0">
                  <Suspense fallback={<div className="flex h-full w-full items-center justify-center font-mono text-xs text-text-muted">Initializing 3D Engine...</div>}>
                    <Plant3D assets={assets} edges={edges} mode={mode} selected={selected} onSelect={setSelected} downstreamList={downstreamList} />
                  </Suspense>
                </div>
              ) : (
                /* ─── 2D SVG View ─── */
                <svg ref={svgRef} className="absolute inset-0 w-full h-full bg-background" onMouseMove={movePan} onMouseUp={endPan} onMouseLeave={endPan} style={{ cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}>
                  <rect x={0} y={0} width="100%" height="100%" fill="var(--color-background)" onMouseDown={startPan} />
                  <g transform={`translate(${vt.tx}, ${vt.ty}) scale(${vt.scale})`}>
                    {/* Section labels */}
                    {[{ l: "RAW MATERIALS", x: 12 }, { l: "UTILITY", x: 32 }, { l: "PRODUCTION", x: 52 }, { l: "DRIVES", x: 72 }, { l: "EXHAUST", x: 92 }].map((z) => (
                      <g key={z.l}>
                        <line x1={px(z.x - 1)} y1={py(5)} x2={px(z.x - 1)} y2={py(95)} stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="4 8" strokeOpacity={0.4} />
                        <text x={px(z.x)} y={py(3.5)} textAnchor="middle" fontSize={8} fontFamily="JetBrains Mono, monospace" letterSpacing="2" fill="var(--color-text-muted)" fillOpacity={0.5} style={{ pointerEvents: "none" }}>{z.l}</text>
                      </g>
                    ))}
                    {/* Edges */}
                    {edges.map((e, idx) => {
                      const x1 = px(e.from.position[0]), y1 = py(e.from.position[1]), x2 = px(e.to.position[0]), y2 = py(e.to.position[1]);
                      const worst = [e.from, e.to].find(a => a.status === "critical") ?? [e.from, e.to].find(a => a.status === "warning") ?? e.from;
                      const c = mode === "topology" ? "var(--color-border)" : nodeColor(mode, worst, false, false);
                      const mx2 = (x1 + x2) / 2, my2 = (y1 + y2) / 2, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                      return (
                        <g key={idx} style={{ pointerEvents: "none" }}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={0.8} strokeOpacity={0.2} />
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={1} strokeOpacity={0.35} strokeDasharray="3 7" style={{ animation: "flowDash 2s linear infinite" }} />
                          <g transform={`translate(${mx2},${my2}) rotate(${ang})`} opacity={0.3}><path d="M-4-2.5L0 0L-4 2.5" fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" /></g>
                        </g>
                      );
                    })}
                    {/* Nodes */}
                    {assets.map((a) => {
                      const cx = px(a.position[0]), cy = py(a.position[1]);
                      const isSel = selected?.id === a.id;
                      const c = nodeColor(mode, a, false, isSel);
                      return (
                        <g key={a.id} transform={`translate(${cx},${cy})`} onClick={() => setSelected(isSel ? null : a)} onMouseDown={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
                          {a.status === "critical" && <><circle r={NODE_R + 6} fill="none" stroke={c} strokeWidth={1.2} style={{ animation: "twinPulseCrit 2s ease-out infinite" }} /><circle r={NODE_R + 6} fill="none" stroke={c} strokeWidth={0.8} style={{ animation: "twinPulseCrit 2s ease-out 0.7s infinite" }} /></>}
                          {a.status === "warning" && <circle r={NODE_R + 4} fill="none" stroke={c} strokeWidth={0.8} style={{ animation: "twinPulseWarn 2.5s ease-out infinite" }} />}
                          {isSel && <circle r={NODE_R + 6} fill="none" stroke={c} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} />}
                          <circle r={NODE_R} fill={c} fillOpacity={isSel ? 0.35 : 0.15} stroke={c} strokeWidth={isSel ? 2.5 : 1.5} />
                          <text y={4} textAnchor="middle" fontSize={9} fill={c} fontWeight="700" fontFamily="Inter, system-ui">{a.type.split(" ").map(w => w[0]).join("")}</text>
                          <text y={NODE_R + 12} textAnchor="middle" fontSize={8} fill={c} fontWeight="600" fontFamily="Inter, system-ui">{a.name}</text>
                          <text y={NODE_R + 22} textAnchor="middle" fontSize={7} fill="var(--color-text-muted)" fontFamily="JetBrains Mono, monospace">
                            {mode === "health" ? `${a.health}% health` : mode === "risk" ? `${a.risk}% risk` : mode === "rul" ? `${a.rul}d RUL` : mode === "business" ? (ASSET_BUSINESS_CASE[a.id] ? `₹${(ASSET_BUSINESS_CASE[a.id].exposure / 1_00_00_000).toFixed(0)}Cr` : "—") : mode === "maintenance" ? (a.health < 50 ? "URGENT" : a.health < 75 ? "SCHEDULE" : "OK") : `${a.health}% · ${a.rul}d`}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
              {/* 2D zoom controls */}
              {!is3D && (
                <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-0.5">
                  {[{ icon: Plus, fn: () => zoomCenter(1.3), t: "Zoom in" }, { icon: Maximize2, fn: () => setVt({ scale: 1, tx: 0, ty: 0 }), t: "Reset" }, { icon: Minus, fn: () => zoomCenter(1 / 1.3), t: "Zoom out" }].map(({ icon: Ic, fn, t }) => (
                    <button key={t} onClick={fn} title={t} className="size-7 flex items-center justify-center rounded-md bg-surface-1 border border-border text-text-muted hover:text-foreground hover:bg-surface-2 cursor-pointer transition-colors"><Ic className="size-3.5" /></button>
                  ))}
                </div>
              )}
            </div>

            {/* Time Machine bar */}
            <AnimatePresence>
              {showTimeMachine && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 38, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }} className="shrink-0 border-t border-border bg-surface-1 flex items-center px-4 gap-3 overflow-hidden">
                  <Clock className="size-3 text-text-muted shrink-0" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted shrink-0">Simulate</span>
                  <div className="flex-1 flex items-center relative">
                    <input type="range" min="-30" max="90" step="30" value={timeShift} onChange={(e) => setTimeShift(Number(e.target.value))} className="absolute inset-0 w-full opacity-0 cursor-pointer z-10" aria-label="Time shift in days" />
                    <div className="flex-1 flex items-center justify-between px-2">
                      {[-30, 0, 30, 60, 90].map((t) => { const active = timeShift === t; return (
                        <div key={t} className="flex flex-col items-center gap-0.5">
                          <div className={`size-2 rounded-full border transition-all duration-150 ${active ? "bg-primary border-primary scale-125" : "bg-surface-2 border-border"}`} />
                          <span className={`font-mono text-[8px] leading-none ${active ? "text-primary font-semibold" : "text-text-muted"}`}>{t === -30 ? "-30d" : t === 0 ? "Now" : `+${t}d`}</span>
                        </div>
                      ); })}
                    </div>
                  </div>
                  {timeShift !== 0 && <button onClick={() => setTimeShift(0)} className="text-[9px] font-mono text-text-muted hover:text-foreground cursor-pointer">Reset</button>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ━━━ Detail Panel ━━━ */}
          <AnimatePresence>
            {activeSelectedAsset && (
              <motion.aside initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }} transition={{ type: "spring", damping: 26, stiffness: 240 }} className="w-[320px] shrink-0 border-l border-border bg-surface-1 overflow-y-auto flex flex-col">
                <div className="p-3 border-b border-border flex items-start justify-between">
                  <div><div className="font-mono text-[8px] uppercase tracking-[0.1em] text-primary">{activeSelectedAsset.type} · {activeSelectedAsset.id}</div><div className="text-[13px] font-medium text-foreground mt-0.5">{activeSelectedAsset.name}</div><div className="font-mono text-[9px] text-text-muted mt-0.5">{activeSelectedAsset.zone}</div></div>
                  <button onClick={() => setSelected(null)} className="text-text-muted hover:text-foreground cursor-pointer"><X className="size-3.5" /></button>
                </div>
                <div className="p-3 space-y-3 flex-1">
                  {/* Condition summary */}
                  <div className={`card-flat p-3 ${
                    activeSelectedAsset.status === "critical" ? "border-crit/25" : activeSelectedAsset.status === "warning" ? "border-warn/25" : "border-ok/20"
                  }`}>
                    <div className={`font-mono text-[8px] uppercase tracking-[0.1em] flex items-center gap-1.5 ${
                      activeSelectedAsset.status === "critical" ? "text-crit" : activeSelectedAsset.status === "warning" ? "text-warn" : "text-ok"
                    }`}>
                      <span className={`size-[5px] rounded-full ${
                        activeSelectedAsset.status === "critical" ? "bg-crit" : activeSelectedAsset.status === "warning" ? "bg-warn" : "bg-ok"
                      }`} />
                      {activeSelectedAsset.status === "critical" ? "Action Required" : activeSelectedAsset.status === "warning" ? "Monitor Closely" : "Nominal"}
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-foreground/90 mt-1.5">{conditionSummary(activeSelectedAsset)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[{ l: "Health", v: `${activeSelectedAsset.health}%`, c: activeSelectedAsset.health < 50 ? "text-crit" : activeSelectedAsset.health < 75 ? "text-warn" : "text-ok" }, { l: "Risk", v: `${activeSelectedAsset.risk}%`, c: activeSelectedAsset.risk >= 60 ? "text-crit" : activeSelectedAsset.risk >= 30 ? "text-warn" : "text-ok" }, { l: "RUL", v: `${activeSelectedAsset.rul}d`, c: activeSelectedAsset.rul < 15 ? "text-crit" : activeSelectedAsset.rul <= 60 ? "text-warn" : "text-ok" }].map((m) => (
                      <div key={m.l} className="card-flat p-2.5 text-center"><div className="font-mono text-[7px] uppercase tracking-[0.15em] text-text-muted">{m.l}</div><div className={`font-mono text-[16px] font-semibold mt-0.5 leading-none ${m.c}`}>{m.v}</div></div>
                    ))}
                  </div>
                  {ASSET_BUSINESS_CASE[activeSelectedAsset.id] && (
                    <div className="card-flat p-3 border-crit/15"><div className="font-mono text-[8px] uppercase tracking-[0.1em] text-crit flex items-center gap-1"><DollarSign className="size-2.5" />Financial Risk</div><div className="grid grid-cols-2 gap-2 mt-2"><div><span className="font-mono text-[7px] text-text-muted uppercase">Exposure</span><div className="font-mono text-[13px] font-semibold text-crit mt-0.5">{formatINR(ASSET_BUSINESS_CASE[activeSelectedAsset.id].exposure)}</div></div><div><span className="font-mono text-[7px] text-text-muted uppercase">Cost/hr</span><div className="font-mono text-[12px] font-semibold text-foreground mt-0.5">{formatINR(ASSET_BUSINESS_CASE[activeSelectedAsset.id].downtimeCost)}</div></div></div></div>
                  )}
                  <div className="card-flat p-3"><span className="font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">Sensors</span><div className="grid grid-cols-3 gap-2 mt-2">{[{ l: "Temp", v: `${activeSelectedAsset.temperature}°C` }, { l: "Vib", v: `${activeSelectedAsset.vibration} mm/s` }, { l: "Load", v: `${activeSelectedAsset.load}%` }].map(({ l, v }) => (<div key={l} className="text-center font-mono"><div className="text-[7px] text-text-muted uppercase">{l}</div><div className="text-[11px] text-foreground mt-0.5 font-medium">{v}</div></div>))}</div></div>
                  <div className="card-flat p-3"><span className="font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">Spares</span><div className="space-y-1.5 mt-2">{spares.isLoading ? <div className="text-[9px] text-text-muted text-center py-1 font-mono">Loading…</div> : (spares.data ?? []).slice(0, 2).map((part: any) => (<div key={part.part_id} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0"><span className="text-[10px] text-foreground">{part.part_name}</span><span className={`font-mono text-[9px] ${part.stock_quantity <= part.reorder_level ? "text-warn" : "text-text-muted"}`}>×{part.stock_quantity}</span></div>))}{!spares.isLoading && (!spares.data || spares.data.length === 0) && <div className="text-[9px] text-text-muted text-center py-1">None listed</div>}</div></div>
                  <div className="card-flat p-3"><span className="font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">History</span><div className="space-y-1.5 mt-2">{logbook.isLoading ? <div className="text-[9px] text-text-muted text-center py-1 font-mono">Loading…</div> : (logbook.data ?? []).filter((log: any, i: number, arr: any[]) => arr.findIndex((l: any) => l.issue === log.issue) === i).slice(0, 3).map((log: any) => (<div key={log.id} className="py-1.5 border-b border-border/50 last:border-0"><div className="text-[9px] text-text-muted font-mono">{new Date(log.timestamp).toLocaleDateString()}</div><div className="text-[10px] text-foreground font-medium mt-0.5">{log.issue}</div></div>))}{!logbook.isLoading && (!logbook.data || logbook.data.length === 0) && <div className="text-[9px] text-text-muted text-center py-1">No records</div>}</div></div>
                  <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-border">
                    <Link to="/app/ask" onClick={() => setActiveAssetId(activeSelectedAsset.id)} className="flex items-center justify-center gap-1 h-8 border border-border hover:border-primary/30 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted hover:text-primary transition-colors rounded-md cursor-pointer"><HelpCircle className="size-3" />Ask OREON</Link>
                    <button onClick={() => window.open(reportApi.downloadUrl(activeSelectedAsset.id, "pdf"), "_blank")} className="flex items-center justify-center gap-1 h-8 border border-border hover:border-primary/30 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted hover:text-primary transition-colors rounded-md cursor-pointer"><FileText className="size-3" />Export</button>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Shell>
  );
}
