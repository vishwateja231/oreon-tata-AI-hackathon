import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";

type Ctx = { launch: (origin: { x: number; y: number }, to: string) => void };
const LaunchCtx = createContext<Ctx | null>(null);

export function useLaunch() {
  const c = useContext(LaunchCtx);
  if (!c) throw new Error("useLaunch must be inside LaunchProvider");
  return c;
}

// Timing (ms)
const ASSEMBLE_MS = 1500;   // logo assembles
const HOLD_MS = 200;        // brief lock hold
const OPEN_MS = 750;        // O opens / aperture expands
const TOTAL_MS = ASSEMBLE_MS + HOLD_MS + OPEN_MS;
// Navigate EARLY, while the black cover is still fully closed, so the destination
// route mounts behind the overlay and is ready by the time the aperture opens.
// (Previously we navigated 50ms before the reveal — the new page had no time to load,
// so the aperture briefly revealed the old landing page and "redirected after a while".)
const NAV_AT = 450;

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ to: string } | null>(null);
  const navigate = useNavigate();
  const navigatedRef = useRef(false);

  const launch = useCallback((_origin: { x: number; y: number }, to: string) => {
    navigatedRef.current = false;
    setActive({ to });
  }, []);

  useEffect(() => {
    if (!active) return;
    const nav = setTimeout(() => {
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        navigate({ to: active.to });
      }
    }, NAV_AT);
    const end = setTimeout(() => setActive(null), TOTAL_MS + 100);
    return () => { clearTimeout(nav); clearTimeout(end); };
  }, [active, navigate]);

  return (
    <LaunchCtx.Provider value={{ launch }}>
      {children}
      <AnimatePresence>
        {active && <LaunchOverlay key="launch" />}
      </AnimatePresence>
    </LaunchCtx.Provider>
  );
}

function LaunchOverlay() {
  const total = TOTAL_MS / 1000;
  const openStart = (ASSEMBLE_MS + HOLD_MS) / 1000;
  const tStart = openStart / total;

  return (
    <motion.div
      className="fixed inset-0 z-[200] grid place-items-center overflow-hidden pointer-events-none"
    >
      {/* Black mask with a hole that GROWS from the center outward (no edges moving inward) */}
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <mask id="oreon-aperture">
            <rect width="100%" height="100%" fill="white" />
            <motion.circle
              cx="50%"
              cy="50%"
              fill="black"
              initial={{ r: 0 }}
              animate={{ r: [0, 0, 2400] }}
              transition={{
                duration: total,
                times: [0, tStart, 1],
                ease: [0.7, 0, 0.2, 1],
              }}
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="#0a0a0b" mask="url(#oreon-aperture)" />
      </svg>

      {/* The logo assembly — assembles, then expands outward with the opening */}
      <motion.div
        className="relative"
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: [1, 1, 6.5], opacity: [1, 1, 0] }}
        transition={{
          duration: total,
          times: [0, tStart, 1],
          ease: [0.7, 0, 0.2, 1],
        }}
      >
        <OreonAssembly />
      </motion.div>
    </motion.div>
  );
}

/* ---------- OREON exact logo assembly ---------- */

const CX = 200;
const CY = 200;
const R_OUTER = 150;
const R_INNER = 38;
const HALF_DEG = 28;

function segmentPath(bisectorDeg: number): string {
  const a = HALF_DEG * Math.PI / 180;
  const t = bisectorDeg * Math.PI / 180;
  const a1 = t - a;
  const a2 = t + a;
  const innerRadial = R_INNER / Math.cos(a);
  const p1x = CX + innerRadial * Math.cos(a1);
  const p1y = CY + innerRadial * Math.sin(a1);
  const p2x = CX + R_OUTER * Math.cos(a1);
  const p2y = CY + R_OUTER * Math.sin(a1);
  const p3x = CX + R_OUTER * Math.cos(a2);
  const p3y = CY + R_OUTER * Math.sin(a2);
  const p4x = CX + innerRadial * Math.cos(a2);
  const p4y = CY + innerRadial * Math.sin(a2);
  return `M ${p1x} ${p1y} L ${p2x} ${p2y} A ${R_OUTER} ${R_OUTER} 0 0 1 ${p3x} ${p3y} L ${p4x} ${p4y} Z`;
}

function OreonAssembly() {
  const bisectors = [-120, -60, 0, 60, 120, 180];
  const assembleDur = ASSEMBLE_MS / 1000;

  return (
    <div style={{ width: 420, height: 420 }}>
      <svg width="420" height="420" viewBox="0 0 400 400">
        {bisectors.map((b) => {
          const t = b * Math.PI / 180;
          const dx = Math.cos(t);
          const dy = Math.sin(t);
          const dist = 120;
          return (
            <motion.path
              key={b}
              d={segmentPath(b)}
              fill="white"
              initial={{ x: -dx * dist, y: -dy * dist, opacity: 0 }}
              animate={{
                x: [-dx * dist, -dx * dist, dx * 2, 0],
                y: [-dy * dist, -dy * dist, dy * 2, 0],
                opacity: [0, 1, 1, 1],
              }}
              transition={{
                duration: assembleDur,
                times: [0, 0.2, 0.85, 1],
                ease: [0.16, 0.84, 0.24, 1],
              }}
            />
          );
        })}

        {/* Thin command ring */}
        <motion.circle
          cx={CX} cy={CY} r={R_OUTER + 8}
          fill="none"
          stroke="white"
          strokeWidth={1}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 0, 1], opacity: [0, 0, 0.55] }}
          transition={{ duration: assembleDur, times: [0, 0.85, 1], ease: [0.7, 0, 0.2, 1] }}
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        />
      </svg>
    </div>
  );
}
