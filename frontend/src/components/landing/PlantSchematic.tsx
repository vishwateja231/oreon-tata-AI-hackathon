import { motion } from "framer-motion";

/* Animated SVG plant schematic for the landing hero.
   The real 10-asset dependency graph with flowing signal pulses —
   pure SVG (no WebGL), crisp, on-brand, and it shows the data flow moving. */

type Node = { id: string; label: string; x: number; y: number; s: "ok" | "warn" | "crit" };

const NODES: Node[] = [
  { id: "crusher", label: "CRUSHER", x: 90, y: 70, s: "ok" },
  { id: "motor", label: "MOTOR", x: 90, y: 190, s: "ok" },
  { id: "pump", label: "PUMP", x: 90, y: 310, s: "warn" },
  { id: "conveyor", label: "CONVEYOR", x: 250, y: 130, s: "ok" },
  { id: "cooling", label: "COOLING", x: 250, y: 290, s: "warn" },
  { id: "furnace", label: "FURNACE", x: 410, y: 90, s: "ok" },
  { id: "mill", label: "ROLLING MILL", x: 410, y: 250, s: "ok" },
  { id: "fan", label: "FAN", x: 560, y: 150, s: "ok" },
  { id: "gearbox", label: "GEARBOX", x: 560, y: 320, s: "crit" },
  { id: "dust", label: "DUST", x: 690, y: 90, s: "ok" },
];
const BY = Object.fromEntries(NODES.map((n) => [n.id, n]));

const EDGES: [string, string][] = [
  ["crusher", "conveyor"], ["motor", "conveyor"], ["conveyor", "furnace"],
  ["pump", "cooling"], ["cooling", "furnace"], ["cooling", "mill"],
  ["furnace", "fan"], ["fan", "dust"], ["mill", "gearbox"],
];

const C = { ok: "#10b981", warn: "#f59e0b", crit: "#ef4444" } as const;
const CYAN = "#22d3ee";

// Pulse routes through the dependency chain
const ROUTES = [
  ["crusher", "conveyor", "furnace", "fan", "dust"],
  ["pump", "cooling", "mill", "gearbox"],
  ["motor", "conveyor", "furnace", "fan", "dust"],
];

function routePath(route: string[]): string {
  return route.map((id, i) => `${i === 0 ? "M" : "L"}${BY[id].x},${BY[id].y}`).join(" ");
}

export function PlantSchematic({ className = "" }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <svg viewBox="0 0 760 400" className="h-full w-full">
        <defs>
          <radialGradient id="ps-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.25" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* faint backdrop grid */}
        <g stroke="rgba(255,255,255,0.04)">
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 50} x2="760" y2={i * 50} />
          ))}
          {Array.from({ length: 16 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 50} y1="0" x2={i * 50} y2="400" />
          ))}
        </g>

        {/* edges */}
        {EDGES.map(([a, b]) => {
          const hot = BY[a].s !== "ok" || BY[b].s !== "ok";
          return (
            <motion.line
              key={`${a}-${b}`}
              x1={BY[a].x} y1={BY[a].y} x2={BY[b].x} y2={BY[b].y}
              stroke={hot ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.13)"}
              strokeWidth="1"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
            />
          );
        })}

        {/* flowing signal pulses */}
        {ROUTES.map((r, i) => (
          <circle key={i} r="3.5" fill={CYAN}>
            <animateMotion dur={`${5 + i}s`} repeatCount="indefinite" path={routePath(r)} begin={`${i * 0.8}s`} />
            <animate attributeName="opacity" values="0;1;1;0" dur={`${5 + i}s`} repeatCount="indefinite" begin={`${i * 0.8}s`} />
          </circle>
        ))}

        {/* nodes */}
        {NODES.map((n, i) => {
          const col = C[n.s];
          const hot = n.s !== "ok";
          return (
            <motion.g
              key={n.id}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: `${n.x}px ${n.y}px` }}
            >
              {hot && <circle cx={n.x} cy={n.y} r="20" fill="url(#ps-glow)" />}
              {n.s === "crit" && (
                <circle cx={n.x} cy={n.y} r="13" fill="none" stroke={col} strokeWidth="1">
                  <animate attributeName="r" values="11;20;11" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0;0.7" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* diamond node */}
              <rect
                x={n.x - 7} y={n.y - 7} width="14" height="14"
                fill="#0a0a0b" stroke={col} strokeWidth="1.5"
                transform={`rotate(45 ${n.x} ${n.y})`}
              />
              <circle cx={n.x} cy={n.y} r="2.5" fill={col}>
                {hot && <animate attributeName="opacity" values="1;0.3;1" dur={n.s === "crit" ? "1s" : "2s"} repeatCount="indefinite" />}
              </circle>
              <text
                x={n.x} y={n.y + 24} textAnchor="middle"
                fontFamily="JetBrains Mono, monospace" fontSize="8.5" letterSpacing="1"
                fill={hot ? col : "rgba(255,255,255,0.5)"}
              >
                {n.label}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
