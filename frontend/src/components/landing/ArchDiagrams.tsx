import { motion } from "framer-motion";

/* ============================================================
   Shared industrial-command primitives
   ============================================================ */
const BG = "#0a0a0b"; // matches app --background
const CYAN = "#22d3ee";
const CRIT = "#ef4444";
const WARN = "#f59e0b";

function DiagramFrame({
  fig, caption, children,
}: { fig: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden border border-[var(--hairline)] bg-background">
      <Corners />
      <div className="relative flex items-center justify-between border-b border-[var(--hairline)] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
        <span>{fig}</span>
        <span>{caption}</span>
      </div>
      {children}
    </div>
  );
}

function Corners() {
  const c = "absolute h-3 w-3 border-white/70";
  return (
    <>
      <div className={`${c} left-0 top-0 border-l border-t`} />
      <div className={`${c} right-0 top-0 border-r border-t`} />
      <div className={`${c} bottom-0 left-0 border-b border-l`} />
      <div className={`${c} bottom-0 right-0 border-b border-r`} />
    </>
  );
}

function Box({
  x, y, w = 150, h = 40, label, sub, filled,
}: { x: number; y: number; w?: number; h?: number; label: string; sub?: string; filled?: boolean }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h}
        fill={filled ? CYAN : BG}
        stroke={filled ? CYAN : "rgba(255,255,255,0.55)"} />
      <text x={x} y={sub ? y - 1 : y + 4} textAnchor="middle"
        fill={filled ? "#06181c" : "#fff"} fontSize="11"
        fontFamily="ui-monospace, monospace" letterSpacing="1.5">
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 12} textAnchor="middle"
          fill={filled ? "#06181c" : "rgba(255,255,255,0.55)"} fontSize="8"
          fontFamily="ui-monospace, monospace" letterSpacing="2">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({
  x1, y1, x2, y2, dashed,
}: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ah = 6;
  const ax = x2 - Math.cos(angle) * ah;
  const ay = y2 - Math.sin(angle) * ah;
  return (
    <g>
      <line x1={x1} y1={y1} x2={ax} y2={ay}
        stroke="rgba(255,255,255,0.55)" strokeWidth={1}
        strokeDasharray={dashed ? "4 4" : undefined} />
      <polygon
        points={`${x2},${y2} ${x2 - ah * Math.cos(angle - 0.4)},${y2 - ah * Math.sin(angle - 0.4)} ${x2 - ah * Math.cos(angle + 0.4)},${y2 - ah * Math.sin(angle + 0.4)}`}
        fill="rgba(255,255,255,0.75)" />
    </g>
  );
}

/* ===================================================================
   FIG.01 — SYSTEM COGNITION MAP
   Central core surrounded by 8 engines on a clean orbital ring
   =================================================================== */
export function CognitionMapSVG() {
  const W = 1600, H = 900;
  const cx = W / 2, cy = H / 2;
  const R = 340;

  const engines = [
    "Sentinel Agent",
    "Orchestrator Agent",
    "Digital Twin",
    "RUL Engine",
    "Root Cause Engine",
    "Evidence Engine",
    "Decision Engine",
    "Feedback Learning",
  ];

  return (
    <DiagramFrame fig="FIG.01 · System cognition map" caption="OREON intelligence core · 8 cognitive engines">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        {/* faint backdrop grid */}
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={`h${i}`} x1={0} x2={W} y1={(H / 12) * i} y2={(H / 12) * i} />
          ))}
          {Array.from({ length: 20 }).map((_, i) => (
            <line key={`v${i}`} y1={0} y2={H} x1={(W / 20) * i} x2={(W / 20) * i} />
          ))}
        </g>

        {/* orbital rings */}
        {[R - 60, R, R + 70].map((r, i) => (
          <circle key={i} cx={cx ?? 0} cy={cy ?? 0} r={r}
            fill="none" stroke="rgba(255,255,255,0.12)"
            strokeDasharray={i === 1 ? "1 0" : "2 8"} />
        ))}

        {/* radial axis ticks */}
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return (
            <line key={i}
              x1={cx + Math.cos(a) * (R - 12)} y1={cy + Math.sin(a) * (R - 12)}
              x2={cx + Math.cos(a) * (R + 12)} y2={cy + Math.sin(a) * (R + 12)}
              stroke="rgba(255,255,255,0.18)" />
          );
        })}

        {/* core */}
        <circle cx={cx} cy={cy} r={150} fill={BG} stroke="rgba(34,211,238,0.3)" />
        <motion.circle cx={cx} cy={cy} r={110} fill={BG} stroke={CYAN}
          initial={{ scale: 0.6, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }} transition={{ duration: 0.7 }} />
        <text x={cx} y={cy - 14} textAnchor="middle" fill="#fff" fontSize="13" fontFamily="ui-monospace, monospace" letterSpacing="4">OREON</text>
        <text x={cx} y={cy + 4} textAnchor="middle" fill={CYAN} fontSize="13" fontFamily="ui-monospace, monospace" letterSpacing="4">INTELLIGENCE</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fill="#fff" fontSize="13" fontFamily="ui-monospace, monospace" letterSpacing="4">CORE</text>
        <line x1={cx - 50} y1={cy + 34} x2={cx + 50} y2={cy + 34} stroke="rgba(34,211,238,0.4)" />
        <text x={cx} y={cy + 50} textAnchor="middle" fill="#888" fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="2.5">REASONING RUNTIME</text>

        {/* engines */}
        {engines.map((e, i) => {
          const a = (i / engines.length) * Math.PI * 2 - Math.PI / 2;
          const ex = cx + Math.cos(a) * R;
          const ey = cy + Math.sin(a) * R;
          const cxe = cx + Math.cos(a) * 150;
          const cye = cy + Math.sin(a) * 150;
          return (
            <motion.g key={e}
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
              viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.06 }}>
              <Arrow x1={cxe} y1={cye} x2={ex - Math.cos(a) * 26} y2={ey - Math.sin(a) * 14} />
              <rect x={ex - 100} y={ey - 22} width={200} height={44} fill={BG} stroke="#fff" />
              <text x={ex} y={ey - 2} textAnchor="middle" fill="#fff" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="2">
                {e.toUpperCase()}
              </text>
              <text x={ex} y={ey + 12} textAnchor="middle" fill="#888" fontSize="8" fontFamily="ui-monospace, monospace" letterSpacing="2">
                ENGINE · {String(i + 1).padStart(2, "0")}
              </text>
            </motion.g>
          );
        })}

        {/* signal pulses on orbit */}
        {[0, 1, 2, 3].map((i) => (
          <motion.circle key={i} r={3} fill={CYAN}
            initial={{ opacity: 0 }}
            animate={{
              cx: Array.from({ length: 60 }).map((_, k) => cx + Math.cos((k / 60) * Math.PI * 2 + (i / 4) * Math.PI * 2) * R),
              cy: Array.from({ length: 60 }).map((_, k) => cy + Math.sin((k / 60) * Math.PI * 2 + (i / 4) * Math.PI * 2) * R),
              opacity: 1,
            }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }} />
        ))}
      </svg>
    </DiagramFrame>
  );
}

/* ===================================================================
   FIG.02 — AUTONOMOUS MONITORING LOOP
   9-stage horizontal lifecycle (wraps row 2)
   =================================================================== */
export function MonitoringLoopSVG() {
  const stages = [
    "Telemetry",
    "Health Analysis",
    "Anomaly Detection",
    "Failure Prediction",
    "Root Cause Analysis",
    "Maintenance Planning",
    "Alert Generation",
    "Role Assignment",
    "Feedback Learning",
  ];
  const W = 1600, H = 500;
  const perRow = 5;
  const padX = 80;
  const colW = (W - padX * 2) / (perRow - 1);
  const rowY = [H * 0.32, H * 0.72];

  return (
    <DiagramFrame fig="FIG.02 · Autonomous monitoring loop" caption="9 stages · continuous closed-loop">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1={0} x2={W} y1={(H / 10) * i} y2={(H / 10) * i} />
          ))}
        </g>

        {stages.map((s, i) => {
          const row = Math.floor(i / perRow);
          const col = row === 0 ? i : perRow - 1 - (i - perRow);
          const x = padX + col * colW;
          const y = rowY[row];
          return (
            <motion.g key={s}
              initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.07 }}>
              <Box x={x} y={y} w={220} h={56} label={s.toUpperCase()} sub={`STAGE ${String(i + 1).padStart(2, "0")}`} />
            </motion.g>
          );
        })}

        {/* connecting arrows */}
        {stages.map((_, i) => {
          if (i === stages.length - 1) return null;
          const fromRow = Math.floor(i / perRow);
          const toRow = Math.floor((i + 1) / perRow);
          const fromCol = fromRow === 0 ? i : perRow - 1 - (i - perRow);
          const toCol = toRow === 0 ? i + 1 : perRow - 1 - (i + 1 - perRow);
          const x1 = padX + fromCol * colW;
          const y1 = rowY[fromRow];
          const x2 = padX + toCol * colW;
          const y2 = rowY[toRow];
          if (fromRow !== toRow) {
            // vertical step
            return (
              <g key={i}>
                <line x1={x1 + 110} y1={y1} x2={x1 + 140} y2={y1} stroke="rgba(255,255,255,0.5)" />
                <line x1={x1 + 140} y1={y1} x2={x1 + 140} y2={y2} stroke="rgba(255,255,255,0.5)" />
                <Arrow x1={x1 + 140} y1={y2} x2={x2 + 110} y2={y2} />
              </g>
            );
          }
          const dir = x2 > x1 ? 1 : -1;
          return <Arrow key={i} x1={x1 + dir * 110} y1={y1} x2={x2 - dir * 110} y2={y2} />;
        })}

        {/* feedback wrap arrow */}
        <g>
          <line x1={padX - 30} y1={rowY[1]} x2={padX - 30} y2={rowY[1] + 60} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 4" />
          <line x1={padX - 30} y1={rowY[1] + 60} x2={W - padX + 30} y2={rowY[1] + 60} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 4" />
          <line x1={W - padX + 30} y1={rowY[1] + 60} x2={W - padX + 30} y2={rowY[0]} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 4" />
          <Arrow x1={W - padX + 30} y1={rowY[0]} x2={W - padX - 110} y2={rowY[0]} dashed />
          <text x={W / 2} y={rowY[1] + 78} textAnchor="middle" fill="#666" fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="3">
            CLOSED-LOOP · FEEDBACK RETURNS TO TELEMETRY CALIBRATION
          </text>
        </g>
      </svg>
    </DiagramFrame>
  );
}

/* ===================================================================
   FIG.04 — EVIDENCE CHAIN
   Vertical evidence ladder, each step proves the next
   =================================================================== */
export function EvidenceChainSVG() {
  const W = 1200, H = 900;
  const stages = [
    "Sensor Evidence",
    "Historical Failures",
    "Maintenance Records",
    "SOP References",
    "Manual References",
    "RUL Prediction",
    "Risk Analysis",
    "Recommendation",
  ];
  const padY = 60;
  const step = (H - padY * 2) / (stages.length - 1);
  const cx = W / 2;

  return (
    <DiagramFrame fig="FIG.04 · Evidence chain" caption="no opinion without sources · every output grounded">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 14 }).map((_, i) => (
            <line key={i} x1={0} x2={W} y1={(H / 14) * i} y2={(H / 14) * i} />
          ))}
        </g>

        {stages.map((s, i) => {
          const y = padY + i * step;
          const isFinal = i === stages.length - 1;
          return (
            <motion.g key={s}
              initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.08 }}>
              {/* index column */}
              <text x={cx - 320} y={y + 4} textAnchor="end" fill="#666"
                fontSize="10" fontFamily="ui-monospace, monospace" letterSpacing="3">
                E·{String(i + 1).padStart(2, "0")}
              </text>
              <line x1={cx - 300} y1={y} x2={cx - 220} y2={y} stroke="rgba(255,255,255,0.3)" />
              <Box x={cx} y={y} w={420} h={50} label={s.toUpperCase()} filled={isFinal} />
              <line x1={cx + 220} y1={y} x2={cx + 320} y2={y} stroke="rgba(255,255,255,0.3)" />
              <text x={cx + 340} y={y + 4} fill="#666"
                fontSize="10" fontFamily="ui-monospace, monospace" letterSpacing="2">
                {isFinal ? "OUTPUT" : "INPUT"}
              </text>
              {i < stages.length - 1 && (
                <Arrow x1={cx} y1={y + 25} x2={cx} y2={y + step - 25} />
              )}
            </motion.g>
          );
        })}

        {/* signal pulse */}
        <motion.circle r={4} fill={CYAN} cx={cx}
          initial={{ cy: padY, opacity: 0 }}
          animate={{ cy: [padY, H - padY], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }} />
      </svg>
    </DiagramFrame>
  );
}

/* ===================================================================
   FIG.06 — DIGITAL TWIN DEPENDENCY NETWORK
   Asset graph with propagation edges (no 3D)
   =================================================================== */
export function TwinNetworkSVG() {
  const W = 1600, H = 760;
  type N = { id: string; x: number; y: number; tag: string; s: "ok" | "warn" | "crit" };
  // the real OREON plant dependency graph
  const nodes: N[] = [
    { id: "Ore Crusher", x: 150, y: 160, tag: "Crusher_CR1", s: "ok" },
    { id: "Mill Drive Motor", x: 150, y: 380, tag: "Motor_M12", s: "ok" },
    { id: "Cooling Pump", x: 150, y: 600, tag: "Pump_P3", s: "warn" },
    { id: "Belt Conveyor", x: 470, y: 270, tag: "Conveyor_C7", s: "ok" },
    { id: "Cooling System", x: 470, y: 600, tag: "CoolingSystem_C1", s: "warn" },
    { id: "Blast Furnace", x: 790, y: 270, tag: "BlastFurnace_BF2", s: "ok" },
    { id: "Rolling Mill", x: 790, y: 600, tag: "RollingMill_RM1", s: "ok" },
    { id: "Combustion Fan", x: 1110, y: 270, tag: "Fan_F2", s: "ok" },
    { id: "Gearbox", x: 1110, y: 600, tag: "Gearbox_G1", s: "crit" },
    { id: "Dust Collector", x: 1420, y: 270, tag: "DustCollector_DC1", s: "ok" },
  ];
  const edges: [string, string, string][] = [
    ["Ore Crusher", "Belt Conveyor", "FEEDS"],
    ["Mill Drive Motor", "Belt Conveyor", "DRIVES"],
    ["Belt Conveyor", "Blast Furnace", "FEEDS"],
    ["Cooling Pump", "Cooling System", "SUPPLIES"],
    ["Cooling System", "Blast Furnace", "COOLS"],
    ["Cooling System", "Rolling Mill", "COOLS"],
    ["Blast Furnace", "Combustion Fan", "REQUIRES"],
    ["Combustion Fan", "Dust Collector", "EXHAUSTS"],
    ["Rolling Mill", "Gearbox", "DRIVES"],
  ];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const sHex = { ok: "rgba(255,255,255,0.55)", warn: WARN, crit: CRIT } as const;
  const dotHex = { ok: "#10b981", warn: WARN, crit: CRIT } as const;

  return (
    <DiagramFrame fig="FIG.06 · Digital twin dependency network" caption="the real plant graph · 10 assets · impact propagation">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={i} x1={0} x2={W} y1={(H / 12) * i} y2={(H / 12) * i} />
          ))}
        </g>

        {/* edges */}
        {edges.map(([a, b, lbl], i) => {
          const A = byId[a], B = byId[b];
          return (
            <motion.g key={`${a}-${b}`}
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
              viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.05 }}>
              <Arrow x1={A.x + 90} y1={A.y} x2={B.x - 90} y2={B.y} />
              <text x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 8}
                textAnchor="middle" fill="#666" fontSize="8"
                fontFamily="ui-monospace, monospace" letterSpacing="2">
                {lbl}
              </text>
            </motion.g>
          );
        })}

        {/* nodes */}
        {nodes.map((n, i) => (
          <motion.g key={n.id}
            initial={{ opacity: 0, scale: 0.85 }} whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.05 }}>
            {n.s !== "ok" && <rect x={n.x - 96} y={n.y - 36} width={192} height={72} fill="none" stroke={dotHex[n.s]} opacity={0.35} />}
            <rect x={n.x - 90} y={n.y - 30} width={180} height={60} fill={BG} stroke={sHex[n.s]} />
            <circle cx={n.x - 76} cy={n.y - 16} r={3} fill={dotHex[n.s]} />
            <text x={n.x} y={n.y - 6} textAnchor="middle" fill={n.s === "crit" ? CRIT : "#fff"} fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="2">
              {n.id.toUpperCase()}
            </text>
            <line x1={n.x - 60} y1={n.y + 4} x2={n.x + 60} y2={n.y + 4} stroke="rgba(255,255,255,0.3)" />
            <text x={n.x} y={n.y + 18} textAnchor="middle" fill="#888" fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="2">
              {n.tag}
            </text>
          </motion.g>
        ))}

        {/* business impact bar at bottom */}
        <g>
          <line x1={60} y1={H - 40} x2={W - 60} y2={H - 40} stroke="rgba(255,255,255,0.25)" />
          <text x={60} y={H - 50} fill="#666" fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="3">
            BUSINESS IMPACT FLOW · UPSTREAM FAILURE → DOWNSTREAM REVENUE EXPOSURE
          </text>
          <text x={W - 60} y={H - 50} textAnchor="end" fill={WARN} fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="3">
            ₹ EXPOSURE / SHIFT
          </text>
        </g>

        {/* propagation pulse along Pump → Cooling → Mill → Gearbox */}
        {[0, 1].map((i) => (
          <motion.circle key={i} r={4} fill={CYAN}
            initial={{ opacity: 0 }}
            animate={{
              cx: [byId["Cooling Pump"].x, byId["Cooling System"].x, byId["Rolling Mill"].x, byId["Gearbox"].x],
              cy: [byId["Cooling Pump"].y, byId["Cooling System"].y, byId["Rolling Mill"].y, byId["Gearbox"].y],
              opacity: [0, 1, 1, 0],
            }}
            transition={{ duration: 5, repeat: Infinity, delay: i * 2.5, ease: "easeInOut" }} />
        ))}
      </svg>
    </DiagramFrame>
  );
}

/* ===================================================================
   FIG.07 — TECHNOLOGY STACK (layered blueprint)
   =================================================================== */
export function TechStackSVG() {
  const layers = [
    { t: "Presentation Layer", items: ["React 19", "TanStack Start", "Tailwind", "Three.js"] },
    { t: "AI Layer", items: ["Gemini", "Qdrant RAG", "Embeddings", "Trust Gate"] },
    { t: "Intelligence Layer", items: ["Sentinel Agent", "Orchestrator Agent", "RUL Random Forest", "Plant Graph", "Evidence Engine"] },
    { t: "Data Layer", items: ["PostgreSQL · Supabase", "Qdrant Vector DB", "Maintenance Records", "Sensor Telemetry", "SOP + Manual KB"] },
    { t: "Infrastructure", items: ["FastAPI", "Docker", "Uvicorn"] },
  ];
  const W = 1600;
  const layerH = 140;
  const padX = 80;
  const H = layers.length * layerH + 80;

  return (
    <DiagramFrame fig="FIG.07 · Technology stack" caption="executive architecture blueprint · 5 layers">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        {layers.map((l, i) => {
          const y = 40 + i * layerH;
          return (
            <motion.g key={l.t}
              initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.1 }}>
              {/* layer band */}
              <rect x={padX} y={y} width={W - padX * 2} height={layerH - 30}
                fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" />
              {/* layer index */}
              <rect x={padX} y={y - 22} width={60} height={22} fill={CYAN} />
              <text x={padX + 30} y={y - 7} textAnchor="middle" fill="#06181c" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="3">
                L{i + 1}
              </text>
              <text x={padX + 76} y={y - 7} fill="#fff" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="3">
                {l.t.toUpperCase()}
              </text>
              <text x={W - padX} y={y - 7} textAnchor="end" fill="#666" fontSize="9" fontFamily="ui-monospace, monospace" letterSpacing="2">
                {l.items.length} COMPONENTS
              </text>

              {/* component boxes */}
              {l.items.map((it, ii) => {
                const slotW = (W - padX * 2 - 40) / l.items.length;
                const cx = padX + 20 + slotW * ii + slotW / 2;
                return (
                  <g key={it}>
                    <Box x={cx} y={y + (layerH - 30) / 2} w={slotW - 20} h={56} label={it.toUpperCase()} />
                  </g>
                );
              })}

              {/* interlayer arrow */}
              {i < layers.length - 1 && (
                <Arrow x1={W / 2} y1={y + layerH - 30} x2={W / 2} y2={y + layerH - 2} />
              )}
            </motion.g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

/* ===================================================================
   FIG.08 — END TO END DATA FLOW
   Funnel: many inputs → reasoning → many outputs
   =================================================================== */
export function EndToEndFlowSVG() {
  const W = 1600, H = 820;
  const inputs = ["Sensor Data", "Fault Logs", "Maintenance Records", "Manuals", "SOPs", "Engineer Queries"];
  const stages = ["Knowledge Processing", "Reasoning Engines", "Predictions", "Recommendations"];
  const outputs = ["Alerts", "Maintenance Decisions", "Feedback Learning"];

  const inputX = 230;
  const hubX = 620;          // convergence hub
  const stageX = W / 2 + 40; // pipeline column
  const outputX = W - 230;
  const midY = H / 2 - 40;

  const inputY = (i: number) => 120 + i * 96;
  const stageY = (i: number) => midY - 132 + i * 88;
  const outputY = (i: number) => 200 + i * 210;
  const lastStageY = stageY(stages.length - 1);

  return (
    <DiagramFrame fig="FIG.08 · End-to-end data flow" caption="inputs → reasoning → decisions → feedback">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 13 }).map((_, i) => (
            <line key={i} x1={0} x2={W} y1={(H / 13) * i} y2={(H / 13) * i} />
          ))}
        </g>

        {/* inputs → converge into the hub node */}
        <text x={inputX} y={64} textAnchor="middle" fill="#888" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="3">INPUTS</text>
        {inputs.map((s, i) => (
          <motion.g key={s}
            initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.06 }}>
            <Box x={inputX} y={inputY(i)} w={250} h={48} label={s.toUpperCase()} />
            <Arrow x1={inputX + 125} y1={inputY(i)} x2={hubX - 30} y2={midY} />
          </motion.g>
        ))}

        {/* convergence hub */}
        <circle cx={hubX} cy={midY} r="26" fill={CYAN} opacity="0.12" />
        <circle cx={hubX} cy={midY} r="14" fill="#0a0a0b" stroke={CYAN} strokeWidth="1.5" />
        {/* clean 2-segment elbow: hub → up → right into the first pipeline stage */}
        <polyline
          points={`${hubX + 30},${midY} ${hubX + 30},${stageY(0)} ${stageX - 162},${stageY(0)}`}
          fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1"
        />
        <Arrow x1={stageX - 168} y1={stageY(0)} x2={stageX - 156} y2={stageY(0)} />

        {/* central reasoning pipeline */}
        <text x={stageX} y={64} textAnchor="middle" fill="#888" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="3">REASONING PIPELINE</text>
        {stages.map((s, i) => (
          <motion.g key={s}
            initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
            viewport={{ once: true }} transition={{ delay: 0.4 + i * 0.1 }}>
            <Box x={stageX} y={stageY(i)} w={310} h={54} label={s.toUpperCase()} sub={`PHASE ${String(i + 1).padStart(2, "0")}`} filled={i === stages.length - 1} />
            {i < stages.length - 1 && <Arrow x1={stageX} y1={stageY(i) + 27} x2={stageX} y2={stageY(i + 1) - 27} />}
          </motion.g>
        ))}

        {/* recommendations fan out to outcomes */}
        <text x={outputX} y={64} textAnchor="middle" fill="#888" fontSize="11" fontFamily="ui-monospace, monospace" letterSpacing="3">OUTCOMES</text>
        {outputs.map((s, i) => (
          <motion.g key={s}
            initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ delay: 0.7 + i * 0.08 }}>
            <Arrow x1={stageX + 155} y1={lastStageY} x2={outputX - 125} y2={outputY(i)} />
            <Box x={outputX} y={outputY(i)} w={250} h={48} label={s.toUpperCase()} />
          </motion.g>
        ))}

        {/* feedback loop — clean rounded rail under everything */}
        <g stroke="rgba(34,211,238,0.4)" fill="none" strokeDasharray="4 5">
          <path d={`M ${outputX} ${outputY(2) + 30} L ${outputX} ${H - 40} L ${inputX} ${H - 40} L ${inputX} ${inputY(5) + 30}`} />
        </g>
        <Arrow x1={inputX} y1={H - 40} x2={inputX} y2={inputY(5) + 34} dashed />
        <text x={W / 2} y={H - 22} textAnchor="middle" fill={CYAN} fontSize="10" fontFamily="ui-monospace, monospace" letterSpacing="3" opacity="0.7">
          FEEDBACK LOOP · OUTCOMES RECALIBRATE INPUTS
        </text>

        {/* flowing pulse — up the elbow into the pipeline, then down the spine */}
        <circle r="4" fill={CYAN}>
          <animateMotion dur="4s" repeatCount="indefinite"
            path={`M ${hubX + 30},${midY} L ${hubX + 30},${stageY(0)} L ${stageX},${stageY(0)} L ${stageX},${lastStageY}`} />
        </circle>
      </svg>
    </DiagramFrame>
  );
}
