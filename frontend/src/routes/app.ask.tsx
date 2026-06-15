import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ArrowUp, FileText, Plus, AlertTriangle, Box,
  X, MoreHorizontal, Trash2, Mic, Square,
  ChevronDown, ChevronUp, Upload, FolderOpen,
  ChevronRight, PenSquare, Paperclip,
} from "lucide-react";
import Markdown from "react-markdown";
import { Shell } from "@/components/oreon/shell";
import { OreonWord } from "@/components/oreon/oreon-word";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { z } from "zod";
import {
  useAskHistory, useAskMessages, useAssets, useIncidents,
  useActiveRole, useDeleteConversation,
} from "@/lib/api/hooks";
import { askApi } from "@/lib/api/endpoints";
import { useOREONContext } from "@/lib/context-store";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/app/ask")({
  validateSearch: z.object({ q: z.string().optional() }),
  head: () => ({ meta: [{ title: "Ask · OREON" }] }),
  component: AskPage,
});

type Pin = { kind: "asset" | "incident" | "sop" | "doc"; label: string };
type FlyoutId = "asset" | "incident" | "sop" | null;

const ALL_SOPS = [
  "motor_sop.pdf", "pump_sop.pdf", "conveyor_sop.pdf", "fan_sop.pdf",
  "gearbox_sop.pdf", "cooling_system_sop.pdf", "blast_furnace_sop.pdf",
  "hydraulic_system_sop.pdf", "crusher_sop.pdf", "dust_collector_sop.pdf",
  "rolling_mill_sop.pdf",
];

const ROLE_SUGGESTIONS: Record<string, string[]> = {
  operator: [
    "What should I check on Motor_M12 right now?",
    "What are the current safety alerts?",
    "How do I safely shut down the Rolling Mill?",
    "Any active alarms for the blast furnace?",
    "What is the required PPE for pump maintenance?",
    "Show me the operating manual for Conveyor_C2",
    "How to respond to a high vibration alert?",
  ],
  maintenance_engineer: [
    "Why is Main Rolling Mill Drive critical?",
    "SOP for bearing replacement on Motor_M12?",
    "What spare parts do I need for Pump_P3?",
    "Show me the maintenance history for the Dust Collector",
    "What's causing the temperature spike in the gearbox?",
    "Diagnose the pressure drop in the hydraulic system",
    "Which assets require immediate attention?",
  ],
  reliability_engineer: [
    "Show RUL predictions for all critical assets",
    "Degradation trend for Motor_M12?",
    "Which assets have the worst reliability?",
    "Compare failure probabilities across the plant",
    "What is the expected downtime for Pump_P3?",
    "Analyze the latest sensor anomalies",
    "Show me assets approaching their end of life",
  ],
  supervisor: [
    "What are the open escalations right now?",
    "Which team should handle Motor_M12?",
    "What decisions need my approval today?",
    "Show me the shift handover report",
    "Are there any unresolved critical alerts?",
    "Who is assigned to the blast furnace repair?",
    "Summarize current plant health",
  ],
  plant_manager: [
    "Total revenue exposure from critical assets?",
    "Business case for proactive maintenance?",
    "Which production line has highest downtime risk?",
    "What is the overall plant OEE today?",
    "Summarize the cost of recent equipment failures",
    "Top 3 reliability risks this month?",
    "Are we meeting our production targets?",
  ],
  procurement_officer: [
    "Which spare parts are below reorder level?",
    "Lead time for Motor_M12 bearings?",
    "Which parts are at risk due to low stock?",
    "Show me pending purchase orders for maintenance",
    "Are there any delays from our main suppliers?",
    "What is the inventory cost of current spares?",
    "Forecast spare parts needed for next month",
  ],
};

const THOUGHT_POOL = [
  "Reading live sensor telemetry across 10 assets...",
  "Scanning maintenance history and incident logs...",
  "Searching SOPs for relevant procedures...",
  "Evaluating failure probability signals...",
  "Checking vibration and temperature thresholds...",
  "Correlating RUL predictions with asset criticality...",
  "Reviewing active alerts and escalations...",
  "Assembling grounded evidence from plant data...",
  "Applying reliability engineering frameworks...",
  "Generating role-specific recommendations...",
];

// ─── Thinking indicator — no AnimatePresence, always visible ─────────────────
function ClaudeThinking({ statusMsg }: { statusMsg?: string }) {
  const [idx, setIdx] = useState(0);
  const [pool] = useState(() => [...THOUGHT_POOL].sort(() => Math.random() - 0.5));

  useEffect(() => {
    const iv = setInterval(() => setIdx((i) => (i + 1) % pool.length), 1200);
    return () => clearInterval(iv);
  }, [pool]);

  const text = statusMsg && statusMsg !== "Thinking" ? statusMsg : pool[idx];

  return (
    <div className="flex gap-3 items-center py-3">
      <img src="/logo.png" alt="OREON" className="size-6 shrink-0 object-contain" />
      <div className="flex items-center gap-2.5">
        {/* Bouncing dots */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="size-[5px] rounded-full bg-violet"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
        {/* Status text cross-fades as each pipeline phase completes */}
        <AnimatePresence mode="wait">
          <motion.span
            key={text}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="text-[13px]"
            style={{ color: "rgba(220,220,220,0.80)" }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Hover-flyout context panel ──────────────────────────────────────────────
const CONTEXT_ITEMS = [
  { id: "asset" as const, icon: Box, label: "Asset context", desc: "Pin an asset", iconCls: "text-violet/80", isFlyout: true },
  { id: "incident" as const, icon: AlertTriangle, label: "Incident context", desc: "Reference an incident", iconCls: "text-amber-400/80", isFlyout: true },
  { id: "sop" as const, icon: FileText, label: "SOP manual", desc: "Attach a procedure doc", iconCls: "text-cyan/80", isFlyout: true },
  { id: "upload" as const, icon: Upload, label: "Upload document", desc: "PDF or TXT as context", iconCls: "text-emerald-400/80", isFlyout: false, rightIcon: FolderOpen },
];

function ContextPanel({
  open, assets, incidents, onAddPin, onUpload, fileRef,
}: {
  open: boolean;
  assets: { id: string; name: string }[];
  incidents: { incident_id: string; root_cause: string }[];
  onAddPin: (kind: Pin["kind"], label: string) => void;
  onUpload: (files: FileList) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [flyout, setFlyout] = useState<FlyoutId>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full mb-2 left-0 z-30 w-[520px] h-[208px]"
      onMouseLeave={() => {
        setFlyout(null);
        setHoveredIndex(null);
      }}
    >
      {/* Main panel */}
      <div className="w-[268px] h-full rounded-xl border border-white/10 bg-[#1c1c1e] shadow-2xl shadow-black/70 overflow-hidden relative z-20">
        {CONTEXT_ITEMS.map((item, idx) => {
          const isUpload = item.id === "upload";
          const RightIcon = item.rightIcon || ChevronRight;
          return (
            <div key={item.id} className={isUpload ? "border-t border-white/8" : ""}>
              <button
                onMouseEnter={() => {
                  setHoveredIndex(idx);
                  if (item.id !== "upload") {
                    setFlyout(item.id);
                  } else {
                    setFlyout(null);
                  }
                }}
                onClick={() => {
                  if (isUpload) {
                    fileRef.current?.click();
                  }
                }}
                className="w-full h-[52px] flex items-center gap-3 px-3.5 transition-colors border-b border-white/5 last:border-0 text-left relative overflow-hidden group cursor-pointer"
              >
                {hoveredIndex === idx && (
                  <motion.div
                    layoutId="contextHover"
                    className="absolute inset-0 bg-white/6 z-0"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <div className="relative z-10 flex items-center gap-3 w-full">
                  <div className="size-7 rounded-lg bg-white/6 border border-white/8 flex items-center justify-center shrink-0">
                    <item.icon className={`size-3.5 ${item.iconCls}`} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-white/85 font-medium">{item.label}</div>
                    <div className="text-[11px] text-white/38 mt-0.5">{item.desc}</div>
                  </div>
                  <RightIcon className="size-3 text-white/30 shrink-0 group-hover:text-white/50 transition-colors" />
                </div>
              </button>
            </div>
          );
        })}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
          }}
        />
      </div>

      {/* Flyout */}
      <AnimatePresence>
        {flyout && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-[266px] top-0 w-[240px] z-30"
          >
            <motion.div
              layout="position"
              className="rounded-xl border border-white/10 bg-[#1c1c1e] shadow-2xl shadow-black/70 relative"
            >

              <div className="overflow-hidden rounded-xl relative z-20 bg-[#1c1c1e]">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={flyout}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="px-3 py-1.5 border-b border-white/8 bg-white/4">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-white/38">
                        {flyout === "asset" ? "Asset" : flyout === "incident" ? "Incident" : "SOP Manual"}
                      </span>
                    </div>
                    <div className="overflow-y-auto max-h-[178px]">
                      {flyout === "asset" && (
                        assets.length === 0 ? <FlyEmpty /> : assets.map((a) => (
                          <button key={a.id} onClick={() => onAddPin("asset", a.id)}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-violet/15 transition-colors border-b border-white/5 last:border-0 cursor-pointer">
                            <div className="font-mono text-[10px] text-violet/60">{a.id}</div>
                            <div className="text-[12px] text-white/75 mt-0.5">{a.name}</div>
                          </button>
                        ))
                      )}
                      {flyout === "incident" && (
                        incidents.length === 0 ? <FlyEmpty /> : incidents.slice(0, 10).map((inc) => (
                          <button key={inc.incident_id} onClick={() => onAddPin("incident", inc.incident_id)}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-amber-400/12 transition-colors border-b border-white/5 last:border-0 cursor-pointer">
                            <div className="font-mono text-[10px] text-amber-400/60">{inc.incident_id}</div>
                            <div className="text-[12px] text-white/65 mt-0.5 truncate">{inc.root_cause}</div>
                          </button>
                        ))
                      )}
                      {flyout === "sop" && ALL_SOPS.map((sop) => (
                        <button key={sop} onClick={() => onAddPin("sop", sop)}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-cyan/12 transition-colors border-b border-white/5 last:border-0 flex items-center gap-2 cursor-pointer">
                          <FileText className="size-3.5 text-cyan/40 shrink-0" strokeWidth={1.5} />
                          <span className="text-[12px] text-white/70">{sop.replace("_sop.pdf", " SOP").replace(/_/g, " ")}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FlyEmpty() {
  return <div className="py-5 text-center font-mono text-[10px] text-white/30">Nothing found</div>;
}

// ─── History sidebar ──────────────────────────────────────────────────────────
function groupByDate<T extends { created_at: string }>(items: T[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1);
  const wStart = new Date(todayStart); wStart.setDate(wStart.getDate() - 7);
  const buckets: { label: string; items: T[] }[] = [
    { label: "Today", items: [] }, { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] }, { label: "Older", items: [] },
  ];
  items.forEach((item) => {
    const d = new Date(item.created_at);
    if (d >= todayStart) buckets[0].items.push(item);
    else if (d >= yStart) buckets[1].items.push(item);
    else if (d >= wStart) buckets[2].items.push(item);
    else buckets[3].items.push(item);
  });
  return buckets.filter((b) => b.items.length > 0);
}

function ConvSidebar({
  open, onClose, history, activeId, onSelect, onNew, deleteConversation,
}: {
  open: boolean; onClose: () => void;
  history: { id: string; title?: string; created_at: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;   // NOTE: does NOT auto-close the sidebar
  onNew: () => void;
  deleteConversation: { mutate: (id: string, opts?: any) => void };
}) {
  const groups = useMemo(() => groupByDate(history), [history]);

  return (
    <aside className={`shrink-0 border-r border-border/40 bg-sidebar flex flex-col min-h-0 transition-all duration-200 ${open ? "w-[260px]" : "w-0 overflow-hidden border-r-0"}`}>
      <div className="flex items-center justify-between px-2 pt-3 pb-2 gap-1 shrink-0">
        <button onClick={onClose}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-2/60 text-text-muted hover:text-foreground transition-colors" title="Collapse">
          <svg className="size-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4}>
            <rect x="1" y="3" width="14" height="1.8" rx="0.9" />
            <rect x="1" y="7.1" width="9" height="1.8" rx="0.9" />
            <rect x="1" y="11.2" width="11" height="1.8" rx="0.9" />
          </svg>
        </button>
        <div className="flex-1" />
        <button onClick={onNew}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-2/60 text-text-muted hover:text-foreground transition-colors" title="New chat">
          <PenSquare className="size-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-4 px-1">
        {history.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-[12px] text-text-muted">No conversations yet</div>
            <div className="text-[11px] text-text-muted/50 mt-1">Ask OREON anything to start</div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="px-2.5 py-1.5 font-mono text-[10px] text-text-muted/50 uppercase tracking-widest">
                {group.label}
              </div>
              {group.items.map((p) => {
                const active = activeId === p.id;
                return (
                  <div key={p.id} role="button" tabIndex={0}
                    onClick={() => onSelect(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}
                    className={`group relative w-full text-left px-2.5 py-2 rounded-lg transition-colors mb-0.5 cursor-pointer ${active ? "bg-surface-2/70" : "hover:bg-surface-2/35"}`}>
                    {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-violet" />}
                    <div className={`text-[13px] leading-snug truncate pr-6 ${active ? "text-foreground font-medium" : "text-foreground/70"}`}>
                      {p.title || "Untitled"}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 size-5 flex items-center justify-center rounded hover:bg-surface-2 text-text-muted transition-all"
                          onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-28">
                        <DropdownMenuItem
                          className="text-xs font-mono text-red-400 focus:bg-red-500/15 focus:text-red-400"
                          onClick={(e) => { e.stopPropagation(); deleteConversation.mutate(p.id); }}>
                          <Trash2 className="size-3 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ─── Pin chip helper ──────────────────────────────────────────────────────────
function PinChip({ p, onRemove }: { p: Pin; onRemove?: () => void }) {
  const s = p.kind === "asset" ? "bg-violet/12 border-violet/30 text-violet/90"
    : p.kind === "incident" ? "bg-amber-400/10 border-amber-400/30 text-amber-400/90"
    : p.kind === "sop" ? "bg-cyan/10 border-cyan/30 text-cyan/90"
    : "bg-emerald-400/10 border-emerald-400/30 text-emerald-400/90";
  const ic = p.kind === "sop" ? <FileText className="size-2.5 shrink-0" strokeWidth={1.5} />
    : p.kind === "incident" ? <AlertTriangle className="size-2.5 shrink-0" strokeWidth={1.5} />
    : p.kind === "doc" ? <Paperclip className="size-2.5 shrink-0" strokeWidth={1.5} />
    : <Box className="size-2.5 shrink-0" strokeWidth={1.5} />;
  return (
    <span className={`inline-flex items-center gap-1 h-[22px] ${onRemove ? "pl-2 pr-1" : "px-2"} rounded-full border font-mono text-[10px] ${s}`}>
      {ic}
      {p.label.replace(/_sop\.pdf$/, "").replace(/_/g, " ")}
      {onRemove && (
        <button
          onClick={onRemove}
          className={`ml-1 -mr-0.5 p-0.5 rounded-full transition-colors shrink-0 flex items-center justify-center cursor-pointer
            ${p.kind === "asset" ? "text-violet/60 hover:text-violet hover:bg-violet/20"
              : p.kind === "incident" ? "text-amber-400/60 hover:text-amber-400 hover:bg-amber-400/20"
              : p.kind === "sop" ? "text-cyan/60 hover:text-cyan hover:bg-cyan/20"
              : "text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-400/20"
            }`}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function AskPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const initialQ = search.q ?? "";

  const [activeRole] = useActiveRole();
  const { activeAssetId, setActiveAssetId } = useOREONContext();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [contextOpen, setContextOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const abortChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreamingResult(null);
    setStreamingStatus(undefined);
    setPendingUserMsg(null);
    setPendingPins([]);
    setSendError("Request cancelled by user.");
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    const handleNewChat = () => startNew();
    window.addEventListener("oreon:new-chat", handleNewChat);
    return () => window.removeEventListener("oreon:new-chat", handleNewChat);
  }, []);

  // Track pending state including which pins were active when message was sent
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [pendingPins, setPendingPins] = useState<Pin[]>([]);
  const [streamingStatus, setStreamingStatus] = useState<string | undefined>();
  const [streamingResult, setStreamingResult] = useState<null | {
    diagnosis: string; evidence: { text: string; src: string }[];
    recommended: string; confidence: number; critical?: boolean;
    reasoning?: { t: string; d: string }[];
  }>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: assets = [] } = useAssets();
  const { data: incidents = [] } = useIncidents();
  const { data: history = [], refetch: refetchHistory } = useAskHistory();
  const { data: dbMessages = [] } = useAskMessages(activeId || undefined);
  const deleteConversation = useDeleteConversation();
  const qc = useQueryClient();

  // Length of the saved thread when the current send started — lets the optimistic
  // (pending) bubble hide exactly when the persisted messages arrive, with no flash.
  const dbLenRef = useRef(0);
  const sentAtLenRef = useRef(0);
  useEffect(() => { dbLenRef.current = dbMessages.length; }, [dbMessages]);

  // Clear the optimistic (pending) bubble the instant the persisted thread includes
  // the just-sent exchange. Combined with the forced post-send refetch in `send`, this
  // guarantees the user's question + reply never vanish (the bug where a 2nd turn
  // disappeared until refresh) and never momentarily double-render.
  useEffect(() => {
    if (pendingUserMsg && dbMessages.length > sentAtLenRef.current) {
      setPendingUserMsg(null);
      setPendingPins([]);
      setStreamingResult(null);
      setStreamingStatus(undefined);
    }
  }, [dbMessages, pendingUserMsg]);

  const assetTerms = useMemo(() => {
    const terms = new Set<string>();
    assets.forEach((a: any) => {
      if (a.id) {
        terms.add(a.id);
        terms.add(fmtId(a.id));
      }
      if (a.name) {
        terms.add(a.name);
        terms.add(fmtId(a.name));
      }
    });
    return Array.from(terms).filter(Boolean);
  }, [assets]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || pendingUserMsg) return;

    // Remember how long the saved thread is right now (drives the pending-bubble guard)
    sentAtLenRef.current = dbLenRef.current;

    // Capture pins before clearing them
    const snapshotPins = [...pins];

    setInput("");
    setSendError(null);
    setPendingUserMsg(t);
    setPendingPins(snapshotPins);
    setStreamingStatus("Connecting...");
    setStreamingResult(null);
    setContextOpen(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const payloadPins = snapshotPins
        .filter((p) => p.kind !== "doc")
        .map((p) => ({ kind: p.kind as "asset" | "incident" | "sop", label: p.label }));
      let finalConvId: string | null = null;

      await askApi.askStream(
        {
          query: t,
          conversation_id: activeId || undefined,
          pins: payloadPins,
          role: activeRole,
          context_asset_id: activeAssetId || undefined,
          context_page: "Ask OREON",
        },
        (event) => {
          if (event.type === "status") {
            setStreamingStatus(event.message);
          } else if (event.type === "result" && event.data) {
            finalConvId = event.data.conversation_id;
            setStreamingResult({
              diagnosis: event.data.diagnosis,
              evidence: event.data.evidence ?? [],
              recommended: event.data.recommended,
              confidence: event.data.confidence,
              critical: event.data.critical,
              reasoning: event.data.reasoning ?? [],
            });
            setStreamingStatus(undefined);
          } else if (event.type === "error") {
            throw new Error(event.message || "Failed.");
          }
        },
        controller.signal
      );

      setPins([]);
      // The backend is the source of truth for which conversation this landed in.
      const convId = finalConvId || activeId;
      if (convId) {
        // Force a FRESH read of the thread (staleTime: 0). The global 30s query
        // staleTime would otherwise serve the pre-reply message list from cache, so
        // a follow-up turn's question + reply never appeared until a manual refresh.
        // We refetch BEFORE clearing the optimistic bubble so the exchange never blinks.
        await Promise.all([
          refetchHistory(),
          qc.fetchQuery({
            queryKey: ["ask-messages", convId],
            queryFn: () => askApi.messages(convId),
            staleTime: 0,
          }),
        ]);
        if (convId !== activeId) setActiveId(convId);
      }
      // NOTE: the optimistic pending bubble is intentionally NOT cleared here. The
      // "clear pending once the saved thread catches up" effect removes it the instant
      // the persisted exchange is in `dbMessages`, giving a seamless, flash-free handoff.
    } catch (err: any) {
      if (err.name === "AbortError" || err.message === "The user aborted a request.") {
        return;
      }
      setSendError(err.message || "Failed to ask OREON.");
      // A failed turn: drop the optimistic bubble so the user can cleanly retry.
      setStreamingResult(null);
      setStreamingStatus(undefined);
      setPendingUserMsg(null);
      setPendingPins([]);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUserMsg, pins, activeRole, activeAssetId, activeId, refetchHistory, qc]);

  const toggleVoice = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e: any) => setInput(Array.from(e.results).map((r: any) => r[0].transcript).join(""));
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec; rec.start(); setIsListening(true);
  }, [isListening]);

  useEffect(() => {
    if (initialQ) { send(initialQ); navigate({ to: "/app/ask", search: {}, replace: true }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [dbMessages, pendingUserMsg, streamingResult]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const removePin = (i: number) => setPins((p) => p.filter((_, k) => k !== i));
  const addPin = (kind: Pin["kind"], label: string) => {
    if (!pins.some((p) => p.kind === kind && p.label === label)) setPins((p) => [...p, { kind, label }]);
    setContextOpen(false);
  };

  const renderedThread = useMemo(() => {
    const list: {
      role: "user" | "assistant"; content?: string; diagnosis?: string;
      evidence?: { text: string; src: string }[]; recommended?: string;
      confidence?: number; critical?: boolean; reasoning?: { t: string; d: string }[];
    }[] = [];
    dbMessages.forEach((m) => {
      if (m.role === "user") {
        list.push({ role: "user", content: m.content });
      } else if (m.sources && m.sources[0]) {
        const src = m.sources[0];
        list.push({ role: "assistant", diagnosis: src.diagnosis, evidence: src.evidence, recommended: src.recommended, confidence: src.confidence, critical: src.critical, reasoning: src.reasoning });
      } else {
        list.push({ role: "assistant", diagnosis: m.content, confidence: 80, evidence: [], recommended: "", reasoning: [] });
      }
    });
    return list;
  }, [dbMessages]);

  const isProcessing = !!pendingUserMsg;
  const hasActiveContext = pins.length > 0 || !!activeAssetId;

  return (
    <Shell title="Ask OREON" subtitle="Industrial Maintenance Assistant">
      <div className="flex h-full min-h-0 overflow-hidden">

        <ConvSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          history={history}
          activeId={activeId}
          onSelect={selectConversation}  // sidebar stays open — no onClose here
          onNew={startNew}
          deleteConversation={deleteConversation}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-background relative">

          {/* Slim top bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 min-h-[42px]">
            {!sidebarOpen && (
              <>
                <button onClick={() => setSidebarOpen(true)}
                  className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-2/60 text-text-muted hover:text-foreground transition-colors" title="Open history">
                  <svg className="size-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4}>
                    <rect x="1" y="3" width="14" height="1.8" rx="0.9" />
                    <rect x="1" y="7.1" width="9" height="1.8" rx="0.9" />
                    <rect x="1" y="11.2" width="11" height="1.8" rx="0.9" />
                  </svg>
                </button>
                <button onClick={startNew}
                  className="size-8 flex items-center justify-center rounded-lg hover:bg-surface-2/60 text-text-muted hover:text-foreground transition-colors" title="New chat">
                  <PenSquare className="size-4" strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            {renderedThread.length === 0 && !pendingUserMsg ? (
              <EmptyState role={activeRole} onSend={send} />
            ) : (
              <div className="max-w-[720px] mx-auto px-4 py-6 space-y-1">
                {renderedThread.map((qa, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                    {qa.role === "user"
                      ? <UserMsg content={qa.content ?? ""} />
                      : <AssistantMsg
                          diagnosis={qa.diagnosis} evidence={qa.evidence} recommended={qa.recommended}
                          confidence={qa.confidence} critical={qa.critical} reasoning={qa.reasoning}
                          expanded={expanded[i]}
                          onToggleExpand={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                          assetTerms={assetTerms}
                        />
                    }
                  </motion.div>
                ))}

                {/* Pending (in-flight) message — hides the moment the saved thread catches up */}
                {pendingUserMsg && dbMessages.length <= sentAtLenRef.current && (
                  <>
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      {/* Show user message + any attached context pins */}
                      <UserMsg content={pendingUserMsg} pins={pendingPins} />
                    </motion.div>

                    <AnimatePresence mode="wait">
                      {streamingResult ? (
                        <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                          <AssistantMsg
                            diagnosis={streamingResult.diagnosis} evidence={streamingResult.evidence}
                            recommended={streamingResult.recommended} confidence={streamingResult.confidence}
                            critical={streamingResult.critical} reasoning={streamingResult.reasoning}
                            assetTerms={assetTerms}
                          />
                        </motion.div>
                      ) : (
                        <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <ClaudeThinking statusMsg={streamingStatus} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
                <div className="h-2" />
              </div>
            )}
          </div>

          {/* Overlay to close context panel */}
          {contextOpen && <div className="fixed inset-0 z-20" onClick={() => setContextOpen(false)} />}

          {/* ── Input bar ── */}
          <div className="px-4 pb-4 pt-2">
            <div className="max-w-[720px] mx-auto">
              <div className={`relative rounded-2xl border bg-surface-1 transition-all duration-200 ${isProcessing ? "border-violet/30" : "border-border hover:border-border/80"} shadow-sm`}>

                {/* Chip row — inside the bar, appears when context is added */}
                {(hasActiveContext) && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
                    {activeAssetId && (
                      <span className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-full bg-violet/12 border border-violet/30 font-mono text-[10px] text-violet/90">
                        <Box className="size-2.5 shrink-0" strokeWidth={1.5} />
                        {activeAssetId}
                        <button
                          onClick={() => setActiveAssetId(null)}
                          className="ml-1 -mr-0.5 p-0.5 rounded-full text-violet/60 hover:text-violet hover:bg-violet/20 transition-colors shrink-0 flex items-center justify-center cursor-pointer"
                          title="Remove active asset"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    )}
                    {pins.map((p, i) => (
                      <PinChip key={i} p={p} onRemove={() => removePin(i)} />
                    ))}
                  </div>
                )}

                {/* Single-line row: + | textarea | mic | send/stop */}
                <div className="flex items-center gap-2 px-3 py-2.5">

                  {/* Context + */}
                  <div className="relative z-30 shrink-0">
                    <button
                      onClick={() => setContextOpen((o) => !o)}
                      title="Add context"
                      className={`size-7 flex items-center justify-center rounded-lg border transition-all
                        ${contextOpen
                          ? "border-violet/50 bg-violet/15 text-violet"
                          : "border-border text-text-secondary hover:text-foreground hover:bg-surface-2"
                        }`}
                    >
                      <Plus className="size-3.5" strokeWidth={2.5} />
                    </button>
                    <ContextPanel
                      open={contextOpen}
                      assets={assets as { id: string; name: string }[]}
                      incidents={incidents as { incident_id: string; root_cause: string }[]}
                      onAddPin={addPin}
                      onUpload={(files) => Array.from(files).forEach((f) => addPin("doc", f.name))}
                      fileRef={fileRef}
                    />
                  </div>

                  {/* Auto-resize textarea — flex-1 fills remaining space */}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!isProcessing) {
                          send(input);
                        }
                      }
                    }}
                    placeholder={isProcessing ? "Type your next question..." : "Ask anything about your plant..."}
                    rows={1}
                    style={{ height: "auto" }}
                    className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[14px] placeholder:text-text-muted font-sans overflow-y-auto leading-relaxed py-0.5 max-h-[100px]"
                  />

                  {/* Mic */}
                  <button onClick={toggleVoice}
                    className={`size-7 flex items-center justify-center rounded-full transition-all shrink-0 ${isListening ? "bg-red-500/20 text-red-400 border border-red-500/40" : "text-text-muted hover:text-foreground hover:bg-surface-2"}`}
                    title={isListening ? "Stop" : "Voice input"}>
                    {isListening ? <Square className="size-3" strokeWidth={2} /> : <Mic className="size-3.5" strokeWidth={1.75} />}
                  </button>

                  {/* Send or Stop */}
                  {isProcessing ? (
                    <button onClick={abortChat}
                      className="size-7 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white transition-all shrink-0 cursor-pointer animate-pulse"
                      title="Stop / Pause generation">
                      <Square className="size-2.5 fill-white" />
                    </button>
                  ) : (
                    <button onClick={() => send(input)} disabled={!input.trim()}
                      className="size-7 flex items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/85 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
                      title="Send">
                      <ArrowUp className="size-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>

              {sendError && (
                <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-1.5">
                  <AlertTriangle className="size-3 shrink-0" />{sendError}
                  <button onClick={() => setSendError(null)} className="ml-auto"><X className="size-3" /></button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );

  // Switching conversations mid-stream would land the in-flight reply in the wrong
  // thread and desync the optimistic bubble — abort and clear pending state first.
  function selectConversation(id: string) {
    if (id === activeId) return;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setPendingUserMsg(null);
      setPendingPins([]);
      setStreamingResult(null);
      setStreamingStatus(undefined);
    }
    setSendError(null);
    setExpanded({});  // details are keyed by message index — reset so they don't bleed across threads
    setActiveId(id);
  }

  function startNew() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setActiveId(null);
    setInput("");
    setPins([]);
    setPendingUserMsg(null);
    setPendingPins([]);
    setStreamingResult(null);
    setStreamingStatus(undefined);
    setSendError(null);
    setExpanded({});
    navigate({ to: "/app/ask", replace: true });
  }
}

function EmptyState({ role, onSend }: { role: string; onSend: (s: string) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const allSuggs = ROLE_SUGGESTIONS[role] ?? ROLE_SUGGESTIONS.maintenance_engineer;
    const shuffled = [...allSuggs].sort(() => 0.5 - Math.random());
    setSuggestions(shuffled.slice(0, 3));
  }, [role]);
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <img src="/logo.png" alt="OREON" className="mb-4 size-16 object-contain" />
      <h2 className="text-[22px] font-semibold tracking-tight mb-1">Ask <OreonWord /></h2>
      <p className="text-[13px] text-text-muted mb-7 max-w-[38ch]">
        Your industrial maintenance intelligence. Ask about any asset, failure, SOP, or plant risk.
      </p>
      <div className="flex flex-wrap gap-2 justify-center max-w-[560px]">
        {suggestions.map((s) => (
          <button key={s} onClick={() => onSend(s)}
            className="px-3.5 py-1.5 rounded-full border border-border bg-surface-1 hover:border-violet/40 hover:bg-violet/5 text-[12px] text-text-secondary hover:text-foreground transition-all">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// User message — shows attached context chips below the bubble
function UserMsg({ content, pins = [] }: { content: string; pins?: Pin[] }) {
  return (
    <div className="flex flex-col items-end py-2 gap-1.5">
      {/* Context chips (docs/asset/sop attached to this message) */}
      {pins.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end max-w-[80%]">
          {pins.map((p, i) => <PinChip key={i} p={p} />)}
        </div>
      )}
      <div className="max-w-[80%] bg-surface-2 rounded-2xl rounded-br-sm px-4 py-2.5 text-[14px] text-foreground leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function fmtId(text: string): string {
  return (text || "").replace(/\b([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9]+)\b/g, "$1 $2");
}

// Lightweight inline markdown for short LLM strings (evidence / recommended / reasoning),
// which aren't run through the full <Markdown> renderer. Turns **bold** into real bold so
// the literal asterisks don't show; plain text passes through untouched.
function InlineMd({ text }: { text: string }) {
  const parts = (text || "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? (
          <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

const CRITICAL_WORDS = [
  "critical",
  "breach",
  "breaches",
  "failure",
  "failures",
  "catastrophic",
  "warning",
  "danger",
  "alarm",
  "vibration breaches",
  "vibration breach",
  "unhealthy",
  "malfunction",
];

function highlightResponseText(text: string, assetTerms: string[]) {
  if (!text) return "";
  const sortedCritical = [...CRITICAL_WORDS].sort((a, b) => b.length - a.length);
  const assetSet = new Set(assetTerms.map(t => t.toLowerCase()));
  const criticalSet = new Set(sortedCritical.map(t => t.toLowerCase()));
  
  const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const allTerms = [...assetTerms, ...sortedCritical].sort((a, b) => b.length - a.length);
  
  if (allTerms.length === 0) return text;
  
  const regex = new RegExp(`\\b(${allTerms.map(escapeRegex).join("|")})\\b`, "gi");
  
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]]+\]\([^\)]+\))/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(regex, (match) => {
      const lower = match.toLowerCase();
      if (assetSet.has(lower)) {
        return `**ASSET::${match}**`;
      }
      if (criticalSet.has(lower)) {
        return `**CRITICAL::${match}**`;
      }
      return match;
    });
  }).join("");
}

function AssistantMsg({
  diagnosis, evidence = [], recommended = "", confidence = 0,
  critical = false, reasoning = [], expanded = false, onToggleExpand,
  assetTerms = [],
}: {
  diagnosis?: string; evidence?: { text: string; src: string }[];
  recommended?: string; confidence?: number; critical?: boolean;
  reasoning?: { t: string; d: string }[]; expanded?: boolean; onToggleExpand?: () => void;
  assetTerms?: string[];
}) {
  const paras = (diagnosis || "").split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  const hasDetails = evidence.length > 0 || !!recommended || (reasoning && reasoning.length > 0);
  const confPct = confidence ?? 0;
  const confLabel = confPct >= 80 ? "High" : confPct >= 60 ? "Medium" : "Low";
  const confStyle = confPct >= 80 ? "text-emerald-400 bg-emerald-400/8 border-emerald-400/20"
    : confPct >= 60 ? "text-amber-400 bg-amber-400/8 border-amber-400/20"
    : "text-red-400 bg-red-400/8 border-red-400/20";

  return (
    <div className="my-4 p-5 rounded-2xl bg-surface-1/40 border border-border/30 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="flex gap-3.5 items-start">
        <img src="/logo.png" alt="OREON" className="mt-0.5 size-7 shrink-0 object-contain" />
        <div className="flex-1 min-w-0 space-y-4">
          {paras.length > 0 ? (
            <div className="prose-oreon">
              <Markdown components={{
                p: ({ children }) => <p className="text-[14px] text-foreground/85 leading-relaxed mb-3 last:mb-0">{children}</p>,
                strong: ({ children }) => {
                  const renderText = (val: any): string => {
                    if (typeof val === "string") return val;
                    if (Array.isArray(val)) return val.map(renderText).join("");
                    if (val && val.props && val.props.children) return renderText(val.props.children);
                    return "";
                  };
                  const text = renderText(children);
                  if (text.startsWith("ASSET::")) {
                    return <span className="font-medium text-violet">{text.substring(7)}</span>;
                  }
                  if (text.startsWith("CRITICAL::")) {
                    return <span className="font-medium text-red-400/90">{text.substring(10)}</span>;
                  }
                  return <strong className="text-foreground font-semibold">{children}</strong>;
                },
                ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 text-[13px] text-foreground/80 my-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 text-[13px] text-foreground/80 my-2">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                h1: ({ children }) => <h3 className="text-[15px] font-semibold text-foreground mt-4 mb-2">{children}</h3>,
                h2: ({ children }) => <h3 className="text-[14px] font-semibold text-foreground mt-3 mb-1.5">{children}</h3>,
                h3: ({ children }) => <h4 className="text-[13px] font-semibold text-foreground mt-2 mb-1">{children}</h4>,
                code: ({ children }) => <code className="font-mono text-[12px] bg-surface-2 px-1.5 py-0.5 rounded text-violet/80">{children}</code>,
              }}>
                {highlightResponseText(fmtId(paras.join("\n\n")), assetTerms)}
              </Markdown>
            </div>
          ) : (
            /* Fallback when diagnosis is empty */
            <p className="text-[14px] text-foreground/50 italic">No response received — please try again.</p>
          )}

          {hasDetails && (
            <div className="space-y-3.5 pt-2 border-t border-border/10">
              <div className="flex items-center gap-2 flex-wrap">
                {critical && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/25 font-mono text-[10px] text-red-400">
                    <span className="size-1.5 rounded-full bg-red-400" /> Critical
                  </span>
                )}
                {confPct > 0 && (
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border font-mono text-[10px] ${confStyle}`}>
                    {confLabel} · {confPct.toFixed(0)}%
                  </span>
                )}
                {evidence.length > 0 && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-border/40 bg-surface-2/40 font-mono text-[10px] text-text-muted">
                    {evidence.length} {evidence.length === 1 ? "source" : "sources"}
                  </span>
                )}
                <button onClick={onToggleExpand}
                  className="ml-auto flex items-center gap-1 font-mono text-[10px] text-text-muted hover:text-foreground transition-colors px-2.5 py-1 rounded-md hover:bg-surface-2 border border-transparent hover:border-border/40">
                  {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {expanded ? "collapse" : "details"}
                </button>
              </div>

              <AnimatePresence>
                {expanded && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-3 pt-1">
                    {evidence.length > 0 && (
                      <div className="rounded-xl border border-border/50 overflow-hidden bg-surface-1/40">
                        <div className="px-3.5 py-2 border-b border-border/30 font-mono text-[9px] uppercase tracking-widest text-text-muted bg-surface-2/40">
                          Evidence · {evidence.length} {evidence.length === 1 ? "source" : "sources"}
                        </div>
                        {evidence.map((e, k) => {
                          const sl = e.src.toLowerCase();
                          const isInc = sl.includes("incident");
                          const isSop = sl.includes(".pdf") || sl.includes("sop");
                          const lb = isInc ? "border-l-amber-400/60" : isSop ? "border-l-violet/50" : "border-l-cyan/50";
                          const badge = isInc ? "text-amber-400/80 bg-amber-400/8 border-amber-400/20" : isSop ? "text-violet/80 bg-violet/8 border-violet/20" : "text-cyan/80 bg-cyan/8 border-cyan/20";
                          return (
                            <div key={k} className={`px-4 py-3 border-b border-border/20 last:border-0 border-l-2 ${lb}`}>
                              <div className="text-[12px] text-foreground/80 leading-relaxed"><InlineMd text={fmtId(e.text)} /></div>
                              <span className={`inline-flex mt-2 font-mono text-[9px] border rounded px-2 py-0.5 leading-none ${badge}`}>{e.src}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {recommended && (
                      <div className={`rounded-xl border-l-[3px] px-4 py-3.5 ${critical ? "border-l-red-400 border border-red-500/20 bg-red-500/5" : "border-l-cyan/60 border border-cyan/20 bg-cyan/5"}`}>
                        <div className={`font-mono text-[9px] uppercase tracking-widest mb-2 font-semibold ${critical ? "text-red-400" : "text-cyan/80"}`}>
                          {critical ? "⚠  Recommended Action" : "Recommended Action"}
                        </div>
                        <div className="text-[13px] text-foreground/85 leading-relaxed"><InlineMd text={fmtId(recommended)} /></div>
                      </div>
                    )}
                    {reasoning && reasoning.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {reasoning.map((c) => (
                          <div key={c.t} className="rounded-lg border border-border/40 bg-surface-2/25 px-3.5 py-3">
                            <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted mb-1">{c.t}</div>
                            <div className="text-[11px] text-foreground/65 leading-relaxed"><InlineMd text={fmtId(c.d)} /></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
