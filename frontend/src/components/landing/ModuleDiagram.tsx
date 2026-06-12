import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Generated industrial SVG diagrams used as placeholders for product modules.
 * Each variant is a self-contained, diagrammatic visual (NOT a screenshot).
 */
type Variant =
  | "reliability"
  | "sentinel"
  | "warroom"
  | "twin"
  | "simulator"
  | "investigation";

export function ModuleDiagram({ variant, label }: { variant: Variant; label: string }) {
  // Client-only: the SVGs use SMIL <animate> which mutates attributes before React
  // hydrates, causing a hydration mismatch. Render after mount to avoid it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden border border-[var(--hairline)] bg-surface-1/40">
      <div className="absolute inset-0 dot-grid opacity-50" />
      <div className="absolute left-5 top-5 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
        {label}
      </div>
      <div className="absolute right-5 top-5 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
        <span className="h-1.5 w-1.5 bg-brand" />
        OREON · TELEMETRY
      </div>
      <div className="absolute bottom-5 left-5 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
        Node {Math.abs(variant.charCodeAt(0) * 7) % 900} / 1240
      </div>
      <div className="absolute inset-0 grid place-items-center p-10">
        {mounted && variant === "reliability" && <ReliabilitySVG />}
        {mounted && variant === "sentinel" && <SentinelSVG />}
        {mounted && variant === "warroom" && <WarRoomSVG />}
        {mounted && variant === "twin" && <TwinSVG />}
        {mounted && variant === "simulator" && <SimulatorSVG />}
        {mounted && variant === "investigation" && <InvestigationSVG />}
      </div>
    </div>
  );
}

const stroke = "rgba(255,255,255,0.55)";
const dim = "rgba(255,255,255,0.18)";
const CYAN = "#22d3ee";
const CRIT = "#ef4444";
const WARN = "#f59e0b";
const OK = "#10b981";

function ReliabilitySVG() {
  // degradation curve with confidence band
  const points = Array.from({ length: 60 }, (_, i) => {
    const x = (i / 59) * 800;
    const y = 250 - i * 2.3 + Math.sin(i * 0.5) * 8;
    return [x, y];
  });
  const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const upper = points.map(([x, y]) => [x, y - 22 - (x / 800) * 30]);
  const lower = points.map(([x, y]) => [x, y + 22 + (x / 800) * 30]);
  const band = [
    ...upper.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`),
    ...lower.reverse().map(([x, y]) => `L${x},${y}`),
    "Z",
  ].join(" ");
  return (
    <svg viewBox="0 0 800 320" className="h-full w-full">
      {[60, 120, 180, 240].map((y) => (
        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke={dim} strokeDasharray="2 4" />
      ))}
      <path d={band} fill="rgba(34,211,238,0.07)" />
      <motion.path
        d={path}
        fill="none"
        stroke={CYAN}
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.8, ease: "easeInOut" }}
      />
      <line x1="540" y1="0" x2="540" y2="320" stroke={CRIT} strokeDasharray="3 3" opacity="0.7" />
      {/* live signal tracing the degradation curve */}
      <circle r="5" fill={CYAN}>
        <animateMotion dur="7s" repeatCount="indefinite" path={path} />
      </circle>
      <circle r="10" fill="none" stroke={CYAN} opacity="0.35">
        <animateMotion dur="7s" repeatCount="indefinite" path={path} />
      </circle>
      <text x="546" y="20" fontFamily="JetBrains Mono" fontSize="9" fill={CRIT}>
        RUL THRESHOLD · 14d
      </text>
      <text x="10" y="20" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.55)">
        HEALTH SCORE
      </text>
      <text x="10" y="310" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.35)">
        T-30d
      </text>
      <text x="770" y="310" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.35)" textAnchor="end">
        T-0
      </text>
    </svg>
  );
}

function SentinelSVG() {
  // a radial radar with detected anomalies
  return (
    <svg viewBox="0 0 600 320" className="h-full w-full">
      <g transform="translate(170 160)">
        {[40, 80, 120, 150].map((r) => (
          <circle key={r} cx="0" cy="0" r={r} fill="none" stroke={dim} />
        ))}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <line key={i} x1={Math.cos(a) * 30} y1={Math.sin(a) * 30}
              x2={Math.cos(a) * 150} y2={Math.sin(a) * 150}
              stroke={dim} />
          );
        })}
        <g>
          <line x1="0" y1="0" x2="0" y2="-150" stroke={CYAN} strokeWidth="1.2" />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to="360 0 0"
            dur="6s"
            repeatCount="indefinite"
          />
        </g>
        {([
          [60, -40, CRIT], [-90, 30, WARN], [40, 90, WARN], [-30, -110, OK], [110, 10, OK],
        ] as const).map(([x, y, c], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="4" fill={c} />
            <circle cx={x} cy={y} r="10" fill="none" stroke={c} opacity="0.4" />
          </g>
        ))}
      </g>
      <g transform="translate(360 60)" fontFamily="JetBrains Mono" fontSize="10">
        <text fill={CRIT}>● GEARBOX_G1   ANOMALY · 0.92</text>
        <text y="22" fill={WARN}>● PUMP_P3      ANOMALY · 0.71</text>
        <text y="44" fill={WARN}>● COOLING_C1   ANOMALY · 0.64</text>
        <text y="66" fill="rgba(255,255,255,0.4)">○ MOTOR_M12    ANOMALY · 0.31</text>
        <text y="88" fill="rgba(255,255,255,0.4)">○ FAN_F2       ANOMALY · 0.22</text>
        <line x1="-10" y1="110" x2="220" y2="110" stroke={dim} />
        <text y="130" fill="rgba(255,255,255,0.5)">ASSETS MONITORED · 10</text>
        <text y="150" fill="rgba(255,255,255,0.5)">OPEN ESCALATIONS · 01</text>
        <text y="170" fill="rgba(255,255,255,0.5)">SCANS THIS SHIFT · 134</text>
      </g>
    </svg>
  );
}

function WarRoomSVG() {
  // a KPI dashboard layout
  return (
    <svg viewBox="0 0 800 320" className="h-full w-full">
      <g fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.55)">
        {([
          ["THREAT LEVEL", "ELEVATED", 0, WARN],
          ["REVENUE @ RISK", "₹ 4.2 Cr", 200, CRIT],
          ["OPEN CRITICALS", "03", 400, CRIT],
          ["UNPLANNED HRS", "18.5", 600, "white"],
        ] as const).map(([k, v, x, c], i) => (
          <g key={i} transform={`translate(${x as number} 20)`}>
            <rect width="180" height="90" fill="none" stroke={dim} />
            <text x="12" y="22">{k as string}</text>
            <text x="12" y="64" fontFamily="Inter, sans-serif" fontSize="28" fill={c as string}>
              {v as string}
            </text>
            {i === 0 && (
              <circle cx="160" cy="16" r="4" fill={WARN}>
                <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        ))}
      </g>
      {/* failure countdown bars */}
      <g transform="translate(0 140)">
        <text x="0" y="0" fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.55)">
          FAILURE COUNTDOWN — TOP ASSETS
        </text>
        {([
          ["GEARBOX_G1", 0.85, CRIT],
          ["PUMP_P3", 0.62, WARN],
          ["COOLING_C1", 0.48, WARN],
          ["MOTOR_M12", 0.34, OK],
          ["FAN_F2", 0.21, OK],
        ] as const).map(([k, v, c], i) => (
          <g key={i} transform={`translate(0 ${20 + i * 24})`}>
            <text x="0" y="10" fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.7)">
              {k as string}
            </text>
            <rect x="160" y="2" width="600" height="10" fill="none" stroke={dim} />
            <motion.rect
              x="160" y="2" height="10" fill={c as string}
              initial={{ width: 0 }}
              whileInView={{ width: 600 * (v as number) }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: i * 0.1, ease: "easeOut" }}
            />
            <text x={770} y="10" fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">
              {Math.round((1 - (v as number)) * 30)}d
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function TwinSVG() {
  // the real plant dependency graph (simplified)
  const nodes = [
    [110, 80, "CRUSHER", OK],
    [110, 220, "MOTOR M12", OK],
    [280, 150, "CONVEYOR C7", OK],
    [450, 80, "FURNACE BF2", OK],
    [450, 220, "COOLING C1", WARN],
    [620, 150, "MILL RM1", OK],
    [740, 240, "GEARBOX G1", CRIT],
  ] as const;
  const edges: [number, number][] = [
    [0, 2], [1, 2], [2, 3], [4, 3], [4, 5], [5, 6],
  ];
  return (
    <svg viewBox="0 0 800 320" className="h-full w-full">
      {edges.map(([a, b], i) => {
        const hot = nodes[b][3] !== OK || nodes[a][3] !== OK;
        return (
          <motion.line
            key={i}
            x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
            stroke={hot ? "rgba(239,68,68,0.45)" : dim} strokeWidth="1"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1, delay: i * 0.1 }}
          />
        );
      })}
      {nodes.map(([x, y, n, c], i) => {
        const hot = c !== OK;
        return (
          <g key={i}>
            {hot && (
              <circle cx={(x as number) || 0} cy={(y as number) || 0} r="24" fill="none" stroke={c as string} opacity="0.5">
                <animate attributeName="r" values="24;36;24" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            <rect x={(x as number) - 16} y={(y as number) - 16} width="32" height="32" fill="#0a0a0b" stroke={c as string} />
            <circle cx={(x as number) || 0} cy={(y as number) || 0} r="3.5" fill={c as string} />
            <text x={x as number} y={(y as number) + 38} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9"
              fill={hot ? (c as string) : "rgba(255,255,255,0.55)"}>{n as string}</text>
          </g>
        );
      })}
      {/* signal flow pulses along the two production paths */}
      <circle r="4" fill={CYAN}>
        <animateMotion dur="5s" repeatCount="indefinite" path="M110,220 L280,150 L450,80" />
      </circle>
      <circle r="4" fill={CYAN}>
        <animateMotion dur="5s" begin="2.5s" repeatCount="indefinite" path="M450,220 L620,150 L740,240" />
      </circle>
    </svg>
  );
}

function SimulatorSVG() {
  // multi-scenario projection
  return (
    <svg viewBox="0 0 800 320" className="h-full w-full">
      {[60, 120, 180, 240].map((y) => (
        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke={dim} strokeDasharray="2 4" />
      ))}
      {[
        { c: CYAN, o: 1, off: 0, lbl: "BASELINE" },
        { c: WARN, o: 0.9, off: 35, lbl: "DELAY 7d" },
        { c: CRIT, o: 0.9, off: 70, lbl: "DELAY 14d" },
      ].map((s, i) => {
        const pts = Array.from({ length: 50 }, (_, k) => {
          const x = (k / 49) * 800;
          const y = 80 + k * 2.2 + s.off + Math.sin(k * 0.3) * 5;
          return `${k ? "L" : "M"}${x},${y}`;
        }).join(" ");
        return (
          <g key={i}>
            <motion.path d={pts} fill="none" stroke={s.c} strokeOpacity={s.o} strokeWidth="1.4"
              initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
              transition={{ duration: 1.4, delay: i * 0.2 }} />
            <text x="710" y={250 + i * 18} fontFamily="JetBrains Mono" fontSize="9"
              fill={s.c}>{s.lbl}</text>
          </g>
        );
      })}
      <text x="10" y="20" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.55)">
        30-DAY HEALTH PROJECTION · SCENARIO COMPARISON
      </text>
      {/* projection scan line sweeping the window */}
      <line y1="30" y2="290" stroke={CYAN} strokeWidth="1" opacity="0.5">
        <animate attributeName="x1" values="0;800" dur="6s" repeatCount="indefinite" />
        <animate attributeName="x2" values="0;800" dur="6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.5;0.5;0" keyTimes="0;0.1;0.9;1" dur="6s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

function InvestigationSVG() {
  // evidence assembly diagram
  const inputs = ["Telemetry", "SOPs", "Manuals", "Incidents", "Asset Graph", "RUL"];
  return (
    <svg viewBox="0 0 800 320" className="h-full w-full">
      {inputs.map((t, i) => {
        const y = 30 + i * 42;
        return (
          <g key={t}>
            <rect x="20" y={y - 14} width="170" height="28" fill="none" stroke={dim} />
            <text x="30" y={y + 4} fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.7)">
              {t.toUpperCase()}
            </text>
            <motion.line x1="190" y1={y} x2="420" y2="160" stroke={stroke} strokeOpacity={0.4}
              initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
              transition={{ duration: 1, delay: i * 0.1 }} />
          </g>
        );
      })}
      <g>
        <circle cx="450" cy="160" r="44" fill="#0a0a0b" stroke={CYAN} />
        <circle cx="450" cy="160" r="52" fill="none" stroke={CYAN} opacity="0.3">
          <animate attributeName="r" values="46;60;46" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.05;0.4" dur="3s" repeatCount="indefinite" />
        </circle>
        <text x="450" y="156" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(255,255,255,0.6)">
          FUSION
        </text>
        <text x="450" y="172" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill={CYAN}>
          ENGINE
        </text>
      </g>
      {/* evidence flowing in, recommendation flowing out */}
      <circle r="3.5" fill={CYAN}>
        <animateMotion dur="3.5s" repeatCount="indefinite" path="M190,114 L420,155" />
      </circle>
      <circle r="3.5" fill={CYAN}>
        <animateMotion dur="3.5s" begin="1.2s" repeatCount="indefinite" path="M190,240 L420,168" />
      </circle>
      <circle r="4" fill={OK}>
        <animateMotion dur="2.5s" begin="0.5s" repeatCount="indefinite" path="M496,160 L598,160" />
      </circle>
      <motion.line x1="494" y1="160" x2="600" y2="160" stroke={CYAN}
        initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.8 }} />
      <g>
        <rect x="600" y="100" width="180" height="120" fill="rgba(34,211,238,0.05)" stroke={CYAN} />
        <text x="612" y="124" fontFamily="JetBrains Mono" fontSize="10" fill={CYAN}>
          RECOMMENDATION
        </text>
        <text x="612" y="150" fontFamily="Inter, sans-serif" fontSize="14" fill="white">
          REPLACE BEARING
        </text>
        <text x="612" y="170" fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.55)">
          confidence 0.94
        </text>
        <text x="612" y="186" fontFamily="JetBrains Mono" fontSize="10" fill="rgba(255,255,255,0.55)">
          evidence    11
        </text>
        <text x="612" y="202" fontFamily="JetBrains Mono" fontSize="10" fill={WARN}>
          exposure ₹2.3Cr
        </text>
      </g>
    </svg>
  );
}
