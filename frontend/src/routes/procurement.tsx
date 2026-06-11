import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import { useProcurementRisks, usePriorityAssets, useActiveRole } from "@/lib/api/hooks";
import { AlertTriangle, Activity, Package, Clock } from "lucide-react";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement Control · OREON" },
      { name: "description", content: "Spare parts replenishment and purchase order pipeline." },
    ],
  }),
  component: ProcurementControl,
});

function ProcurementControl() {
  const procurement = useProcurementRisks();
  const priority = usePriorityAssets(20);
  const [activeRole] = useActiveRole();

  const parts = procurement.data ?? [];
  const lowStock = parts.filter((p) => p.stock_quantity <= p.reorder_level);
  const critical = lowStock.filter((p) => p.stock_quantity === 0 || p.stock_quantity < p.reorder_level * 0.5);
  const avgLead = parts.length
    ? Math.round(parts.reduce((s, p) => s + (p.lead_time_days || 0), 0) / parts.length)
    : 0;
  const critAssets = (priority.data ?? []).filter((a) => (a.health_score ?? 100) < 50);

  // Synthesized PO pipeline anchored to the real low-stock parts.
  const poStages = ["DRAFT", "PENDING APPROVAL", "APPROVED", "SHIPPED"];
  const pipeline = lowStock.slice(0, 6).map((p, i) => ({
    id: `PO-2026-${(910 + i).toString()}`,
    part: p.part_name,
    partId: p.part_id,
    qty: Math.max(p.reorder_level * 2 - p.stock_quantity, p.reorder_level),
    lead: p.lead_time_days,
    stage: poStages[i % poStages.length],
  }));

  const kpis = [
    { label: "Parts Below Reorder", value: lowStock.length, sub: "Need replenishment", icon: Package, color: lowStock.length > 0 ? "text-amber-signal border-amber-signal/30 bg-amber-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
    { label: "Critical Shortages", value: critical.length, sub: "At/near zero stock", icon: AlertTriangle, color: critical.length > 0 ? "text-red-signal border-red-signal/30 bg-red-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
    { label: "Avg. Lead Time", value: `${avgLead}d`, sub: "Across tracked parts", icon: Clock, color: "text-electric border-electric/30 bg-electric/8" },
    { label: "Assets Awaiting Parts", value: critAssets.length, sub: "Critical assets at risk", icon: Activity, color: critAssets.length > 0 ? "text-red-signal border-red-signal/30 bg-red-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
  ];

  return (
    <Shell title="Procurement Control" subtitle="Spare parts replenishment, lead-time risk, and purchase order pipeline">
      <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-4 grid-bg">
        {/* Header Badges */}
        <div className="col-span-12 flex justify-end">
          <span className={`inline-flex items-center gap-2 h-8 px-3 rounded border font-mono text-[10px] uppercase tracking-wider ${
            activeRole === "plant_manager"
              ? "border-red-signal/30 bg-red-signal/10 text-red-signal"
              : activeRole === "reliability_engineer"
                ? "border-violet/30 bg-violet/10 text-violet"
                : "border-amber-signal/30 bg-amber-signal/10 text-amber-signal"
          }`}>
            <Package className="size-3" /> {activeRole.replace(/_/g, " ")}
          </span>
        </div>

        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`col-span-12 md:col-span-6 lg:col-span-3 panel p-4 border ${kpi.color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{kpi.label}</span>
              <kpi.icon className="size-3.5 opacity-60" />
            </div>
            <div className="font-mono text-[28px] font-bold leading-none">{kpi.value}</div>
            <div className="font-mono text-[9px] text-muted-foreground mt-1">{kpi.sub}</div>
          </motion.div>
        ))}

        {/* Reorder recommendations */}
        <div className="col-span-12 lg:col-span-7 panel flex flex-col">
          <PanelHeader label="Reorder Recommendations" action={<span className="font-mono text-[10px] text-amber-signal">{lowStock.length} below reorder</span>} />
          <div className="flex-1 overflow-y-auto p-3">
            {lowStock.length === 0 ? (
              <div className="py-10 text-center font-mono text-[11px] text-green-signal">All parts adequately stocked.</div>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-border/60">
                    {["Part ID", "Name", "Stock", "Reorder", "Order Qty", "Lead", "Urgency"].map((h) => (
                      <th key={h} className="px-2 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {lowStock.map((p) => {
                    const orderQty = Math.max(p.reorder_level * 2 - p.stock_quantity, p.reorder_level);
                    const urgent = p.stock_quantity === 0 || p.stock_quantity < p.reorder_level * 0.5;
                    return (
                      <tr key={p.part_id} className="hover:bg-surface-1/30 transition-colors">
                        <td className="px-2 py-2 text-electric">{p.part_id}</td>
                        <td className="px-2 py-2 text-foreground/80">{p.part_name}</td>
                        <td className={`px-2 py-2 font-semibold ${urgent ? "text-red-signal" : "text-amber-signal"}`}>{p.stock_quantity}</td>
                        <td className="px-2 py-2 text-muted-foreground">{p.reorder_level}</td>
                        <td className="px-2 py-2 text-electric font-semibold">+{orderQty}</td>
                        <td className="px-2 py-2 text-amber-signal">{p.lead_time_days}d</td>
                        <td className="px-2 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${urgent ? "bg-red-signal/10 text-red-signal" : "bg-amber-signal/10 text-amber-signal"}`}>
                            {urgent ? "Critical" : "Reorder"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* PO pipeline */}
        <div className="col-span-12 lg:col-span-5 panel flex flex-col">
          <PanelHeader label="Purchase Order Pipeline" action={<span className="font-mono text-[10px] text-text-muted">{pipeline.length} active</span>} />
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {pipeline.length === 0 ? (
              <div className="py-10 text-center font-mono text-[11px] text-green-signal">No purchase orders required.</div>
            ) : pipeline.map((po) => (
              <div key={po.id} className="rounded border border-border bg-surface-1/40 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-amber-signal font-semibold">{po.id}</span>
                    <span className="text-[11px] text-foreground ml-2 truncate">{po.part}</span>
                  </div>
                  <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded uppercase shrink-0 ${po.stage === "SHIPPED" ? "bg-green-signal/10 text-green-signal" : po.stage === "APPROVED" ? "bg-electric/10 text-electric" : "bg-surface-2 text-muted-foreground border border-border"}`}>
                    {po.stage}
                  </span>
                </div>
                <div className="flex items-center gap-4 font-mono text-[9px] text-muted-foreground">
                  <span>{po.partId}</span>
                  <span>Qty: <span className="text-foreground">{po.qty}</span></span>
                  <span>Lead: <span className="text-amber-signal">{po.lead}d</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
