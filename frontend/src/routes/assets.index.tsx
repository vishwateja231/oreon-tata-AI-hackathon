import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Filter, Search, TrendingDown, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Shell } from "@/components/oreon/shell";
import { useAssets, useLogbook, useActiveRole } from "@/lib/api/hooks";
import { statusBg, statusColor, toUiAsset, type Asset, statusFromBackend } from "@/lib/oreon-data";
import { useSensorStream } from "@/lib/api/use-sensor-stream";

export const Route = createFileRoute("/assets/")({
  head: () => ({ meta: [{ title: "Asset Explorer · OREON" }, { name: "description", content: "Browse every motor, conveyor, furnace and pump in the plant." }] }),
  component: Assets,
});

const TYPES = ["All", "Motor", "Conveyor", "Blast Furnace", "Cooling System", "Pump", "Fan", "Gearbox", "Crusher", "Dust Collector", "Rolling Mill"] as const;

function trend(seed: number) {
  return Array.from({ length: 24 }, (_, i) => ({ t: i, v: 60 + Math.sin(i / 3 + seed) * 14 + Math.cos(i / 5 + seed) * 6 }));
}

function Assets() {
  const [activeRole] = useActiveRole();
  const [q, setQ] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("All");
  const [selected, setSelected] = useState<Asset | null>(null);
  const { data: raw = [], isLoading, isError } = useAssets();
  const { latestByAsset } = useSensorStream();

  const assets = useMemo(() => {
    return raw.map((a) => {
      const uiAsset = toUiAsset(a);
      const live = latestByAsset.get(a.id);
      if (live) {
        const health = Math.round(live.health_score);
        const status = statusFromBackend(health < 50 ? "critical" : health < 75 ? "warning" : "operational");
        
        // Compute dynamic load and risk relative to live variables
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

  const zones = useMemo(() => new Set(assets.map((a) => a.zone)).size, [assets]);
  const activeSelected = useMemo(() => selected ? assets.find((a) => a.id === selected.id) ?? selected : null, [selected, assets]);
  // Live maintenance history for the selected asset (replaces hardcoded dates).
  const { data: serviceHistory = [] } = useLogbook(activeSelected?.id);
  const filtered = assets.filter((a) => (type === "All" || a.type === type) && (q === "" || a.name.toLowerCase().includes(q.toLowerCase()) || a.id.toLowerCase().includes(q.toLowerCase())));

  return (
    <Shell title="Asset Explorer" subtitle={isLoading ? "Loading assets…" : isError ? "Error — API unreachable" : `${assets.length} monitored assets · ${zones} zones`}>
      <div className="flex h-full">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Filter bar */}
          <div className="px-6 py-4 border-b border-border flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset id or name…"
                className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-sm text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:border-electric" />
            </div>
            <Filter className="size-3.5 text-muted-foreground" />
            <div className="flex flex-wrap gap-1">
              {TYPES.map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border ${type === t ? "border-electric text-electric bg-electric/10" : "border-border text-muted-foreground hover:text-foreground"}`}>{t}</button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6 grid-bg">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {isError && (
                <div className="col-span-full py-16 flex flex-col items-center gap-3 font-mono text-[12px] text-red-400">
                  <AlertTriangle className="size-6" />
                  <span>Backend unreachable — ensure the API server is running at localhost:8000</span>
                </div>
              )}
              {!isError && filtered.map((a, i) => (
                <motion.button key={a.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}
                  onClick={() => setSelected(a)}
                  className={`panel p-4 text-left hover:panel-glow transition-colors group ${selected?.id === a.id ? "panel-glow" : ""}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center justify-center size-[18px] rounded-sm shrink-0 ${
                          a.status === "critical" ? "bg-red-signal/15 text-red-signal border border-red-signal/40" :
                          a.status === "warning"  ? "bg-amber-signal/15 text-amber-signal border border-amber-signal/40" :
                          "bg-green-signal/15 text-green-signal border border-green-signal/40"
                        }`}>
                          {a.status === "critical" ? <Zap className="size-2.5" /> :
                           a.status === "warning"  ? <TrendingDown className="size-2.5" /> :
                           <Activity className="size-2.5" />}
                        </span>
                        <span className="font-mono text-[11px] text-foreground truncate flex items-center gap-1.5">
                          {a.id}
                        </span>
                      </div>
                      <div className="text-sm mt-1.5 leading-tight truncate flex items-center gap-1.5">
                        <a.icon className="size-3.5 text-muted-foreground/70" />
                        {a.name}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {a.type} · <span className={a.status === "critical" ? "text-red-signal/80" : a.status === "warning" ? "text-amber-signal/80" : "text-green-signal/70"}>
                          {a.status === "critical" ? "CRITICAL" : a.status === "warning" ? "DEGRADED" : "NORMAL"}
                        </span>
                      </div>
                    </div>
                    <div className={`font-mono text-2xl shrink-0 ${statusColor(a.status)} ${
                      a.status === "critical" ? "animate-pulse" :
                      a.status === "warning"  ? "animate-pulse [animation-duration:3s]" :
                      "animate-pulse [animation-duration:5s]"
                    }`}>{a.health}</div>
                  </div>
                  <div className="h-12">
                    <ResponsiveContainer>
                      <AreaChart data={trend(a.health)}>
                        <defs>
                          <linearGradient id={`g${a.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={a.status === "critical" ? "oklch(0.65 0.24 27)" : a.status === "warning" ? "oklch(0.80 0.17 75)" : "oklch(0.78 0.20 155)"} stopOpacity={0.6} />
                            <stop offset="100%" stopColor="oklch(0.72 0.18 240)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area dataKey="v" stroke={a.status === "critical" ? "oklch(0.65 0.24 27)" : a.status === "warning" ? "oklch(0.80 0.17 75)" : "oklch(0.78 0.20 155)"} fill={`url(#g${a.id})`} strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 font-mono text-[10px]">
                    <div><div className="text-muted-foreground">RISK</div><div>{a.risk}</div></div>
                    <div><div className="text-muted-foreground">RUL</div><div>{a.rul}d</div></div>
                    <div><div className="text-muted-foreground">LOAD</div><div>{a.load}%</div></div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {activeSelected && (
            <motion.aside
              initial={{ x: 420, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 420, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 240 }}
              className="w-[420px] border-l border-border bg-card overflow-auto">
              <div className="p-5 border-b border-border flex items-start justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-electric">Asset · {activeSelected.id}</div>
                  <div className="text-lg mt-1.5 flex items-center gap-2">
                    <activeSelected.icon className="size-5 text-muted-foreground/50" />
                    {activeSelected.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{activeSelected.type} · {activeSelected.zone}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              </div>
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { l: "Health", v: activeSelected.health, suffix: "%", tone: activeSelected.status },
                    { l: "Risk", v: activeSelected.risk, suffix: "%", tone: activeSelected.risk > 60 ? "critical" : activeSelected.risk > 30 ? "warning" : "healthy" },
                    { l: "RUL", v: activeSelected.rul, suffix: "d", tone: activeSelected.rul < 20 ? "critical" : activeSelected.rul < 60 ? "warning" : "healthy" },
                  ].map((m) => (
                    <div key={m.l} className="panel p-3">
                      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{m.l}</div>
                      <div className={`font-mono text-2xl ${statusColor(m.tone as any)}`}>{m.v}<span className="text-xs text-muted-foreground">{m.suffix}</span></div>
                    </div>
                  ))}
                </div>

                <div className="panel p-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Realtime Telemetry</div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-[12px]">
                    <div><div className="text-muted-foreground text-[10px]">TEMP</div><div>{activeSelected.temperature}°C</div></div>
                    <div><div className="text-muted-foreground text-[10px]">VIB</div><div>{activeSelected.vibration} mm/s</div></div>
                    <div><div className="text-muted-foreground text-[10px]">LOAD</div><div>{activeSelected.load}%</div></div>
                  </div>
                  <div className="h-24 mt-2">
                    <ResponsiveContainer>
                      <AreaChart data={trend(activeSelected.health)}>
                        <defs>
                          <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="oklch(0.72 0.18 240)" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="oklch(0.72 0.18 240)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area dataKey="v" stroke="oklch(0.72 0.18 240)" fill="url(#gd)" strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Dependencies</div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeSelected.dependencies.length ? activeSelected.dependencies.map((d) => (
                      <span key={d} className="font-mono text-[11px] px-2 py-1 border border-border bg-secondary/40">{d}</span>
                    )) : <span className="font-mono text-[11px] text-muted-foreground">None</span>}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Service History</div>
                  <div className="space-y-2">
                    {serviceHistory.length === 0 ? (
                      <div className="font-mono text-[11px] text-muted-foreground">No maintenance logged for this asset yet.</div>
                    ) : (
                      serviceHistory.slice(0, 5).map((h) => (
                        <div key={h.id} className="flex gap-3 font-mono text-[11px]">
                          <span className="text-muted-foreground shrink-0">{new Date(h.timestamp).toLocaleDateString("en-GB")}</span>
                          <span className="truncate" title={`${h.issue} · ${h.action}`}>{h.issue} · {h.action}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Role-Specific Quick Actions */}
                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Quick Actions</div>
                  {activeRole === "operator" && (
                    <Link
                      to="/logbook"
                      search={{ asset_id: activeSelected.id }}
                      className="block w-full py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-500/20 text-center"
                    >
                      Log Field Inspection
                    </Link>
                  )}
                  {activeRole === "maintenance_engineer" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        to="/logbook"
                        search={{ asset_id: activeSelected.id }}
                        className="block w-full py-2 bg-cyan/10 border border-cyan/30 text-cyan font-mono text-[10px] uppercase tracking-widest hover:bg-cyan/20 text-center"
                      >
                        Create Work Order
                      </Link>
                      <Link
                        to="/investigations"
                        search={{ asset_id: activeSelected.id }}
                        className="block w-full py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 font-mono text-[10px] uppercase tracking-widest hover:bg-purple-500/20 text-center"
                      >
                        Open Investigation
                      </Link>
                    </div>
                  )}
                  {activeRole === "reliability_engineer" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        to="/investigations"
                        search={{ asset_id: activeSelected.id }}
                        className="block w-full py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 font-mono text-[10px] uppercase tracking-widest hover:bg-purple-500/20 text-center"
                      >
                        Open Investigation
                      </Link>
                      <Link
                        to="/twin"
                        className="block w-full py-2 bg-cyan/10 border border-cyan/30 text-cyan font-mono text-[10px] uppercase tracking-widest hover:bg-cyan/20 text-center"
                      >
                        View Digital Twin
                      </Link>
                    </div>
                  )}
                  {activeRole === "supervisor" && (
                    <Link
                      to="/logbook"
                      search={{ asset_id: activeSelected.id }}
                      className="block w-full py-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono text-[10px] uppercase tracking-widest hover:bg-rose-500/20 text-center"
                    >
                      Log Shift Observation
                    </Link>
                  )}
                  {activeRole === "procurement_officer" && (
                    <Link
                      to="/procurement"
                      className="block w-full py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-[10px] uppercase tracking-widest hover:bg-amber-500/20 text-center"
                    >
                      Check Spare Stock
                    </Link>
                  )}
                  {activeRole === "plant_manager" && (
                    <Link
                      to="/decisions"
                      search={{ tab: "business-impact" }}
                      className="block w-full py-2 bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-[10px] uppercase tracking-widest hover:bg-red-500/20 text-center"
                    >
                      Analyze Business Impact
                    </Link>
                  )}
                </div>

                <Link
                  to="/assets/$id"
                  params={{ id: activeSelected.id }}
                  className="block w-full py-2.5 bg-electric text-primary-foreground font-mono text-[11px] uppercase tracking-widest hover:bg-electric-glow text-center"
                >
                  Open Full Detail
                </Link>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </Shell>
  );
}