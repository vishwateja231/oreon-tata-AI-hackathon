import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import { Shell, PanelHeader } from "@/components/oreon/shell";
import {
  useProcurementRisks, usePriorityAssets, useActiveRole,
  usePurchaseOrders, usePurchaseOrderSummary,
  useCreatePurchaseOrder, useAdvancePurchaseOrder,
  useNudgeProcurement, useClearPurchaseOrders,
} from "@/lib/api/hooks";
import type { PurchaseOrder, POStage } from "@/lib/api/types";
import {
  AlertTriangle, Package, ShoppingCart, Check, IndianRupee,
  FileText, ClipboardCheck, Truck, CircleCheck, RotateCcw, BellRing,
  Zap, Activity, TrendingUp,
} from "lucide-react";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement Control · OREON" },
      { name: "description", content: "Spare parts replenishment, ordering, and purchase order management." },
    ],
  }),
  component: ProcurementControl,
});

// ── PO lifecycle ─────────────────────────────────────────────────────────────
const STAGE_ORDER: POStage[] = ["PENDING_APPROVAL", "APPROVED", "SHIPPED", "RECEIVED"];
const STAGE_LABEL: Record<POStage, string> = {
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  SHIPPED: "Shipped",
  RECEIVED: "Received",
};
const STAGE_ICON = { PENDING_APPROVAL: FileText, APPROVED: ClipboardCheck, SHIPPED: Truck, RECEIVED: CircleCheck };
const ADVANCE_LABEL: Record<POStage, string> = {
  PENDING_APPROVAL: "Approve",
  APPROVED: "Mark shipped",
  SHIPPED: "Receive",
  RECEIVED: "Done",
};

function fmtINR(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function ProcurementControl() {
  const procurement = useProcurementRisks();
  const priority = usePriorityAssets(20);
  const [activeRole] = useActiveRole();

  const posQuery = usePurchaseOrders();
  const summaryQuery = usePurchaseOrderSummary();
  const createPO = useCreatePurchaseOrder();
  const advancePO = useAdvancePurchaseOrder();
  const nudge = useNudgeProcurement();
  const clearPOs = useClearPurchaseOrders();

  const [flash, setFlash] = useState<string | null>(null);

  const isPM = activeRole === "plant_manager";
  const canOrder = !isPM; // procurement officer (+ others) order; plant manager oversees/nudges

  const parts = procurement.data ?? [];
  const orders = posQuery.data ?? [];
  const summary = summaryQuery.data;

  const lowStock = parts.filter((p) => p.stock_quantity <= p.reorder_level);
  const critical = lowStock.filter((p) => p.stock_quantity === 0 || p.stock_quantity < p.reorder_level * 0.5);
  const critAssets = (priority.data ?? []).filter((a) => (a.health_score ?? 100) < 50);

  const orderedParts = useMemo(
    () => new Set(orders.filter((o) => o.stage !== "RECEIVED").map((o) => o.part_id)),
    [orders],
  );
  const openOrders = orders.filter((o) => o.stage !== "RECEIVED");

  function flashRow(partId: string) {
    setFlash(partId);
    setTimeout(() => setFlash(null), 1400);
  }

  function order(partId: string, qty: number) {
    if (orderedParts.has(partId)) return;
    createPO.mutate({ part_id: partId, qty, requested_by_role: activeRole });
    flashRow(partId);
  }

  function requestOrder(partId: string) {
    nudge.mutate({ part_id: partId, from_role: activeRole });
    flashRow(partId);
  }

  function orderAllCritical() {
    critical.forEach((p) => {
      const qty = Math.max(p.reorder_level * 2 - p.stock_quantity, p.reorder_level);
      if (!orderedParts.has(p.part_id)) order(p.part_id, qty);
    });
  }

  // Plant manager may only approve a pending PO (governance); officer drives fulfilment.
  function canAdvance(o: PurchaseOrder): boolean {
    if (o.stage === "RECEIVED") return false;
    if (isPM) return o.stage === "PENDING_APPROVAL";
    return true;
  }

  const onOrderSpend = summary?.on_order_value_inr ?? openOrders.reduce((s, o) => s + o.order_value_inr, 0);

  const kpis = [
    { label: "Parts Below Reorder", value: lowStock.length, sub: "Need replenishment", icon: Package,
      color: lowStock.length > 0 ? "text-amber-signal border-amber-signal/30 bg-amber-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
    { label: "Critical Shortages", value: critical.length, sub: "At/near zero stock", icon: AlertTriangle,
      color: critical.length > 0 ? "text-red-signal border-red-signal/30 bg-red-signal/8" : "text-green-signal border-green-signal/30 bg-green-signal/8" },
    { label: "Open Orders", value: openOrders.length, sub: `${critAssets.length} assets awaiting parts`, icon: ShoppingCart,
      color: openOrders.length > 0 ? "text-electric border-electric/30 bg-electric/8" : "text-text-muted border-border bg-surface-1/40" },
    { label: "On-Order Spend", value: fmtINR(onOrderSpend), sub: "Committed, not yet received", icon: IndianRupee,
      color: "text-violet border-violet/30 bg-violet/8" },
  ];

  return (
    <Shell title="Procurement Control" subtitle="Spare parts replenishment, ordering, and purchase order tracking">
      <div className="h-full overflow-y-auto p-6 grid grid-cols-12 gap-4 grid-bg">
        {/* Header */}
        <div className="col-span-12 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {parts.length} tracked parts · {orders.length} purchase orders
          </span>
          <span className={`inline-flex items-center gap-2 h-8 px-3 rounded border font-mono text-[10px] uppercase tracking-wider ${
            isPM ? "border-red-signal/30 bg-red-signal/10 text-red-signal"
              : activeRole === "reliability_engineer" ? "border-violet/30 bg-violet/10 text-violet"
              : "border-amber-signal/30 bg-amber-signal/10 text-amber-signal"
          }`}>
            <Package className="size-3" /> {activeRole.replace(/_/g, " ")}
            <span className="ml-1 opacity-60">· {isPM ? "oversight" : "ordering"}</span>
          </span>
        </div>

        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`col-span-12 md:col-span-6 lg:col-span-3 panel p-4 border ${kpi.color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{kpi.label}</span>
              <kpi.icon className="size-3.5 opacity-60" />
            </div>
            <div className="font-mono text-[26px] font-bold leading-none">{kpi.value}</div>
            <div className="font-mono text-[9px] text-muted-foreground mt-1">{kpi.sub}</div>
          </motion.div>
        ))}

        {/* Reorder recommendations */}
        <div className="col-span-12 lg:col-span-7 panel flex flex-col">
          <PanelHeader
            label="Reorder Recommendations"
            action={
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-amber-signal">{lowStock.length} below reorder</span>
                {canOrder && critical.length > 0 && (
                  <button onClick={orderAllCritical}
                    className="inline-flex items-center gap-1 rounded border border-red-signal/40 bg-red-signal/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-red-signal hover:bg-red-signal/20 transition-colors">
                    <ShoppingCart className="size-3" /> Order all critical
                  </button>
                )}
              </div>
            }
          />
          <div className="flex-1 overflow-y-auto p-3">
            {lowStock.length === 0 ? (
              <div className="py-10 text-center font-mono text-[11px] text-green-signal">All parts adequately stocked.</div>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-border/60">
                    {["Part ID", "Name", "Stock", "Order Qty", "Lead", "Urgency", ""].map((h) => (
                      <th key={h} className="px-2 py-2 text-left text-[9px] text-muted-foreground uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {lowStock.map((p) => {
                    const orderQty = Math.max(p.reorder_level * 2 - p.stock_quantity, p.reorder_level);
                    const urgent = p.stock_quantity === 0 || p.stock_quantity < p.reorder_level * 0.5;
                    const isOrdered = orderedParts.has(p.part_id);
                    const justFlashed = flash === p.part_id;
                    return (
                      <motion.tr key={p.part_id}
                        animate={justFlashed ? { backgroundColor: ["rgba(34,211,238,0.18)", "rgba(0,0,0,0)"] } : {}}
                        transition={{ duration: 1.3 }}
                        className="hover:bg-surface-1/30 transition-colors">
                        <td className="px-2 py-2 text-electric">{p.part_id}</td>
                        <td className="px-2 py-2 text-foreground/80">{p.part_name}</td>
                        <td className={`px-2 py-2 font-semibold ${urgent ? "text-red-signal" : "text-amber-signal"}`}>{p.stock_quantity}</td>
                        <td className="px-2 py-2 text-electric font-semibold">+{orderQty}</td>
                        <td className="px-2 py-2 text-amber-signal">{p.lead_time_days}d</td>
                        <td className="px-2 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${urgent ? "bg-red-signal/10 text-red-signal" : "bg-amber-signal/10 text-amber-signal"}`}>
                            {urgent ? "Critical" : "Reorder"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {isOrdered ? (
                            <span className="inline-flex items-center gap-1 rounded border border-green-signal/30 bg-green-signal/10 px-2 py-1 text-[9px] uppercase tracking-wider text-green-signal">
                              <Check className="size-3" /> Ordered
                            </span>
                          ) : canOrder ? (
                            <button onClick={() => order(p.part_id, orderQty)} disabled={createPO.isPending}
                              className="inline-flex items-center gap-1 rounded border border-electric/40 bg-electric/10 px-2 py-1 text-[9px] uppercase tracking-wider text-electric hover:bg-electric/20 transition-colors disabled:opacity-50">
                              <ShoppingCart className="size-3" /> Order
                            </button>
                          ) : (
                            <button onClick={() => requestOrder(p.part_id)} disabled={nudge.isPending}
                              className="inline-flex items-center gap-1 rounded border border-amber-signal/40 bg-amber-signal/10 px-2 py-1 text-[9px] uppercase tracking-wider text-amber-signal hover:bg-amber-signal/20 transition-colors disabled:opacity-50">
                              <BellRing className="size-3" /> {flash === p.part_id ? "Requested" : "Request"}
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Replenishment summary footer */}
          {lowStock.length > 0 && (() => {
            const totalUnits = lowStock.reduce(
              (s, p) => s + Math.max(p.reorder_level * 2 - p.stock_quantity, p.reorder_level), 0);
            const bottleneck = lowStock.reduce((a, b) => (b.lead_time_days > a.lead_time_days ? b : a));
            const orderedCount = lowStock.filter((p) => orderedParts.has(p.part_id)).length;
            const coverage = Math.round((orderedCount / lowStock.length) * 100);
            return (
              <div className="border-t border-border/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Replenishment Summary</span>
                  <span className="font-mono text-[9px] text-muted-foreground">{orderedCount}/{lowStock.length} lines ordered</span>
                </div>
                {/* coverage bar — square, theme-matched */}
                <div className="h-1.5 bg-border/50 overflow-hidden mb-3">
                  <motion.div className="h-full bg-gradient-to-r from-electric to-green-signal"
                    initial={{ width: 0 }} animate={{ width: `${coverage}%` }} transition={{ duration: 0.6 }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded border border-border bg-surface-1/40 p-2 text-center">
                    <div className="font-mono text-[16px] font-bold text-electric leading-none">{totalUnits}</div>
                    <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground mt-1">Units to order</div>
                  </div>
                  <div className="rounded border border-border bg-surface-1/40 p-2 text-center">
                    <div className="font-mono text-[16px] font-bold text-amber-signal leading-none">{bottleneck.lead_time_days}d</div>
                    <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground mt-1">Longest lead · {bottleneck.part_id}</div>
                  </div>
                  <div className="rounded border border-border bg-surface-1/40 p-2 text-center">
                    <div className="font-mono text-[16px] font-bold text-red-signal leading-none">{critical.length}</div>
                    <div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground mt-1">Critical lines</div>
                  </div>
                </div>
                {/* Procurement insights */}
                {(() => {
                  const fastest = lowStock.reduce((a, b) => (b.lead_time_days < a.lead_time_days ? b : a));
                  return (
                    <div className="mt-2.5 space-y-1.5">
                      {/* Bottleneck (amber) */}
                      {critical.length > 0 && (
                        <div className="flex items-start gap-1.5 rounded border border-amber-signal/20 bg-amber-signal/5 px-2.5 py-1.5">
                          <AlertTriangle className="size-3 text-amber-signal shrink-0 mt-0.5" />
                          <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">
                            Bottleneck: <span className="text-amber-signal">{bottleneck.part_name}</span> at {bottleneck.lead_time_days}d lead —
                            order now to avoid a stock-out window on dependent assets.
                          </span>
                        </div>
                      )}
                      {/* Quick win (green) */}
                      <div className="flex items-start gap-1.5 rounded border border-green-signal/20 bg-green-signal/5 px-2.5 py-1.5">
                        <Zap className="size-3 text-green-signal shrink-0 mt-0.5" />
                        <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">
                          Quick win: <span className="text-green-signal">{fastest.part_name}</span> restocks in just {fastest.lead_time_days}d — fastest line to close.
                        </span>
                      </div>
                      {/* Committed spend (violet) */}
                      <div className="flex items-start gap-1.5 rounded border border-violet/20 bg-violet/5 px-2.5 py-1.5">
                        <IndianRupee className="size-3 text-violet shrink-0 mt-0.5" />
                        <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">
                          <span className="text-violet">{fmtINR(onOrderSpend)}</span> committed across {openOrders.length} open orders;
                          {" "}{lowStock.length - orderedCount} lines still need raising.
                        </span>
                      </div>
                      {/* Critical-asset linkage (red) */}
                      {critAssets.length > 0 && (
                        <div className="flex items-start gap-1.5 rounded border border-red-signal/20 bg-red-signal/5 px-2.5 py-1.5">
                          <Activity className="size-3 text-red-signal shrink-0 mt-0.5" />
                          <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">
                            <span className="text-red-signal">{critAssets.length} critical asset{critAssets.length > 1 ? "s" : ""}</span> awaiting parts —
                            prioritise these lines to protect uptime.
                          </span>
                        </div>
                      )}
                      {/* Coverage status (electric) */}
                      <div className="flex items-start gap-1.5 rounded border border-electric/20 bg-electric/5 px-2.5 py-1.5">
                        <TrendingUp className="size-3 text-electric shrink-0 mt-0.5" />
                        <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">
                          Replenishment coverage at <span className="text-electric">{coverage}%</span> —
                          {coverage === 100 ? " all reorder lines raised." : ` ${lowStock.length - orderedCount} of ${lowStock.length} lines still open.`}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>

        {/* Purchase orders */}
        <div className="col-span-12 lg:col-span-5 panel flex flex-col">
          <PanelHeader
            label="Purchase Orders"
            action={
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-text-muted">{openOrders.length} open</span>
                {canOrder && orders.length > 0 && (
                  <button onClick={() => clearPOs.mutate()} title="Clear all orders"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
                    <RotateCcw className="size-3" /> Clear
                  </button>
                )}
              </div>
            }
          />
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {orders.length === 0 ? (
              <div className="py-12 text-center">
                <ShoppingCart className="size-6 mx-auto mb-3 text-text-muted opacity-50" />
                <div className="font-mono text-[11px] text-muted-foreground">No purchase orders yet.</div>
                <div className="font-mono text-[9px] text-text-muted mt-1">
                  {canOrder ? <>Click <span className="text-electric">Order</span> on a part to raise a PO.</>
                    : <>Use <span className="text-amber-signal">Request</span> to alert the procurement officer.</>}
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {orders.map((po) => <POCard key={po.id} po={po} canAdvance={canAdvance(po)} isPM={isPM}
                  onAdvance={() => advancePO.mutate(po.id)} pending={advancePO.isPending} />)}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── PO card with a real 4-node stepper ───────────────────────────────────────
function POCard({ po, canAdvance, isPM, onAdvance, pending }: {
  po: PurchaseOrder; canAdvance: boolean; isPM: boolean; onAdvance: () => void; pending: boolean;
}) {
  const idx = STAGE_ORDER.indexOf(po.stage);
  const isDone = po.stage === "RECEIVED";

  return (
    <motion.div layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-lg border border-border bg-surface-1/40 p-3">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <span className="font-mono text-[10px] text-amber-signal font-semibold">{po.po_number}</span>
          <span className="text-[11px] text-foreground ml-2">{po.part_name}</span>
        </div>
        <span className="font-mono text-[11px] font-semibold text-violet shrink-0">{fmtINR(po.order_value_inr)}</span>
      </div>

      {/* stepper */}
      <div className="flex items-center mb-3">
        {STAGE_ORDER.map((stage, i) => {
          const reached = i <= idx;
          const StageIcon = STAGE_ICON[stage];
          const isCurrent = i === idx;
          return (
            <div key={stage} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: reached ? (isDone ? "rgba(16,185,129,0.15)" : "rgba(34,211,238,0.15)") : "rgba(255,255,255,0.02)",
                    borderColor: reached ? (isDone ? "#10b981" : "#22d3ee") : "rgba(255,255,255,0.12)",
                  }}
                  className="grid place-items-center size-6 rounded-full border">
                  <StageIcon className={`size-3 ${reached ? (isDone ? "text-green-signal" : "text-electric") : "text-text-muted"}`} />
                </motion.div>
                <span className={`font-mono text-[7px] uppercase tracking-wider whitespace-nowrap ${isCurrent ? (isDone ? "text-green-signal" : "text-electric") : "text-text-muted"}`}>
                  {STAGE_LABEL[stage].split(" ")[0]}
                </span>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <div className="flex-1 h-px mx-1 -mt-3 bg-border relative overflow-hidden">
                  <motion.div initial={false} animate={{ width: i < idx ? "100%" : "0%" }} transition={{ duration: 0.4 }}
                    className={`absolute inset-y-0 left-0 ${isDone ? "bg-green-signal" : "bg-electric"}`} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
          <span>{po.part_id}</span>
          <span>Qty <span className="text-foreground">{po.qty}</span></span>
          <span className="text-amber-signal">{po.lead_time_days}d lead</span>
        </div>
        {isDone ? (
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-green-signal">
            <Check className="size-3" /> Stock replenished
          </span>
        ) : canAdvance ? (
          <button onClick={onAdvance} disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-electric/40 bg-electric/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-electric hover:bg-electric/20 transition-colors disabled:opacity-50">
            {ADVANCE_LABEL[po.stage]}
          </button>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            {isPM ? "Awaiting procurement" : STAGE_LABEL[po.stage]}
          </span>
        )}
      </div>
    </motion.div>
  );
}
