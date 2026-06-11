import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLogbook, useCreateLogEntry, useAssets } from "@/lib/api/hooks";
import { toUiAsset, statusBg, statusColor, ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";
import { AlertTriangle, Book, PlusCircle, Wrench, Search, Clock, ShieldAlert } from "lucide-react";
import { useOREONContext } from "@/lib/context-store";
import { z } from "zod";

export const Route = createFileRoute("/logbook")({
  validateSearch: z.object({ asset_id: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Digital Maintenance Logbook · OREON" },
      { name: "description", content: "Chronological ledger of asset issues, root-cause investigations, and engineering repairs." },
    ],
  }),
  component: Logbook,
});

function Logbook() {
  const search = Route.useSearch();
  const initialAssetId = search.asset_id || "";
  const [selectedAsset, setSelectedAsset] = useState<string>(initialAssetId);
  const [filterAsset, setFilterAsset] = useState<string>(initialAssetId);
  const [issue, setIssue] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [action, setAction] = useState("");
  const [notes, setNotes] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [formError, setFormError] = useState("");

  const { setActiveAssetId } = useOREONContext();
  const activeAsset = filterAsset || selectedAsset;
  useEffect(() => {
    if (activeAsset) {
      setActiveAssetId(activeAsset);
    }
    return () => setActiveAssetId(null);
  }, [activeAsset, setActiveAssetId]);

  const { data: assets = [] } = useAssets();
  const { data: logs = [], isLoading, isError, refetch } = useLogbook(filterAsset || undefined);
  const createMutation = useCreateLogEntry();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!selectedAsset || !issue || !rootCause || !action) {
      setFormError("Please fill in all required fields.");
      return;
    }

    try {
      await createMutation.mutateAsync({
        asset_id: selectedAsset,
        issue,
        root_cause: rootCause,
        action,
        engineer_notes: notes || undefined,
      });

      setIssue("");
      setRootCause("");
      setAction("");
      setNotes("");
      setSuccessMsg("Maintenance log recorded successfully!");
      refetch();
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: any) {
      setFormError(err.message || "Failed to create log entry.");
    }
  };

  // Group stats
  const totalLogs = logs.length;
  const uniqueAssets = new Set(logs.map((l) => l.asset_id)).size;
  const recentLogs = logs.filter(
    (l) => new Date().getTime() - new Date(l.timestamp).getTime() < 24 * 3600 * 1000
  ).length;

  return (
    <Shell title="Digital Logbook" subtitle="Official Plant Maintenance Ledger">
      <div className="h-full overflow-y-auto p-6 grid-bg space-y-4">
        {/* KPI Overview */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { l: "Total Ledger Entries", v: totalLogs, sub: "Historical operations log", icon: Book },
            { l: "Assets Repaired", v: uniqueAssets, sub: "Unique equipment serviced", icon: Wrench },
            { l: "Logged (Last 24h)", v: recentLogs, sub: "Recent engineering cycles", icon: Clock },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.l} className="panel p-4 flex items-start justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                  <div className="font-mono text-3xl text-cyan text-glow mt-1">{isLoading ? "…" : s.v}</div>
                  <div className="font-mono text-[10px] text-muted-foreground mt-1">{s.sub}</div>
                </div>
                <Icon className="size-5 text-cyan/70 border border-cyan/20 p-0.5 rounded" />
              </div>
            );
          })}
        </div>

        {/* Workspace Layout */}
        <div className="grid grid-cols-12 gap-4">
          {/* History Panel */}
          <div className="col-span-12 lg:col-span-8 panel flex flex-col">
            <PanelHeader
              code="09.1"
              label="Chronological Maintenance Ledger"
              action={
                <div className="flex items-center gap-2">
                  <Search className="size-3 text-muted-foreground" />
                  <Select value={filterAsset || "all"} onValueChange={(val) => setFilterAsset(val === "all" ? "" : val)}>
                    <SelectTrigger className="bg-background border border-border rounded px-2 h-7 font-mono text-[10px] uppercase text-text-secondary focus:outline-none focus:border-cyan min-w-[160px]">
                      <SelectValue placeholder="Filter by Asset (All)" />
                    </SelectTrigger>
                    <SelectContent className="font-mono text-[11px] max-h-60">
                      <SelectItem value="all">Filter by Asset (All)</SelectItem>
                      {assets.map((rawAsset) => {
                        const a = toUiAsset(rawAsset);
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
              }
            />

            <div className="flex-1 overflow-auto">
              {isLoading ? (
                <div className="py-12 text-center font-mono text-xs text-text-muted">
                  Fetching ledger logs...
                </div>
              ) : isError ? (
                <div className="py-12 text-center space-y-2">
                  <AlertTriangle className="size-6 text-red-400 mx-auto" />
                  <p className="font-mono text-xs text-red-400">Backend unreachable — ensure the API server is running.</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <Book className="size-8 text-border mx-auto" />
                  <p className="font-mono text-xs text-text-muted">No maintenance logs found matching the filter.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  <AnimatePresence initial={false}>
                    {logs.map((log, i) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        className="p-5 space-y-3 hover:bg-secondary/10 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1 pr-4">
                            <span className="font-mono text-[11px] text-violet border border-violet/30 bg-violet/8 px-2 py-0.5 rounded">
                              {ASSET_DISPLAY_NAMES[log.asset_id] || log.asset_id} ({log.asset_id})
                            </span>
                            <h3 className="text-[13px] font-medium mt-2 text-foreground/90 leading-snug break-words line-clamp-2" title={log.issue}>{log.issue}</h3>
                          </div>
                          <span className="font-mono text-[10px] text-text-muted whitespace-nowrap shrink-0 mt-1">
                            {new Date(log.timestamp).toLocaleString()}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs font-mono mt-3">
                          <div className="min-w-0">
                            <span className="text-text-muted uppercase text-[9px] tracking-wider block truncate">Root Cause Analysis</span>
                            <p className="text-text-secondary mt-0.5 whitespace-pre-wrap break-words line-clamp-2" title={log.root_cause}>{log.root_cause}</p>
                          </div>
                          <div className="min-w-0">
                            <span className="text-text-muted uppercase text-[9px] tracking-wider block truncate">Corrective Action Taken</span>
                            <p className="text-text-secondary mt-0.5 whitespace-pre-wrap break-words line-clamp-2" title={log.action}>{log.action}</p>
                          </div>
                        </div>

                        {log.engineer_notes && (
                          <div className="bg-surface-2/40 border-l border-border px-3 py-2 rounded text-[11px] text-text-secondary font-mono">
                            <span className="text-text-muted text-[9px] uppercase tracking-wider block">Engineer Notes</span>
                            {log.engineer_notes}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* Form Panel */}
          <div className="col-span-12 lg:col-span-4 panel">
            <PanelHeader code="09.2" label="Manual Log Dispatcher" />
            <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
              {successMsg && (
                <div className="bg-ok/10 border border-ok/30 text-ok px-3 py-2 rounded font-mono text-[11px] flex items-center gap-1.5 animate-fade-in">
                  <ShieldAlert className="size-3.5" />
                  {successMsg}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-mono uppercase text-[9px] tracking-wider text-text-secondary">Target Asset *</label>
                <Select value={selectedAsset || undefined} onValueChange={setSelectedAsset} required>
                  <SelectTrigger className="w-full bg-background border border-border rounded px-2.5 h-9 text-foreground focus:outline-none focus:border-cyan text-xs">
                    <SelectValue placeholder="Select Asset..." />
                  </SelectTrigger>
                   <SelectContent className="text-xs max-h-60">
                    {assets.map((rawAsset) => {
                      const a = toUiAsset(rawAsset);
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

              <div className="space-y-1.5">
                <label className="font-mono uppercase text-[9px] tracking-wider text-text-secondary">Observed Issue *</label>
                <input
                  type="text"
                  placeholder="e.g. Elevated casing vibrations matching harmonic fatigue"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2.5 py-2 text-foreground focus:outline-none focus:border-cyan text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-mono uppercase text-[9px] tracking-wider text-text-secondary">Identified Root Cause *</label>
                <input
                  type="text"
                  placeholder="e.g. Unbalanced dynamic loads on motor shafts"
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2.5 py-2 text-foreground focus:outline-none focus:border-cyan text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-mono uppercase text-[9px] tracking-wider text-text-secondary">Corrective Action Taken *</label>
                <textarea
                  placeholder="e.g. Conducted dynamically balanced alignment; greased bearings"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2.5 py-2 text-foreground focus:outline-none focus:border-cyan text-xs min-h-[70px]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-mono uppercase text-[9px] tracking-wider text-text-secondary">Engineer Notes (Optional)</label>
                <textarea
                  placeholder="Additional observations, calibrations, spare parts or SOP references..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2.5 py-2 text-foreground focus:outline-none focus:border-cyan text-xs min-h-[60px]"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 font-mono text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                  <AlertTriangle className="size-3 shrink-0" />
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full h-8 mt-2 bg-cyan/15 hover:bg-cyan/20 border border-cyan/40 hover:border-cyan/60 text-cyan flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-widest transition-all"
              >
                <PlusCircle className="size-3.5" />
                {createMutation.isPending ? "Logging..." : "Append to Ledger"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </Shell>
  );
}
