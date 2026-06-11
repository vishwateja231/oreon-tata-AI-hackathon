import { motion } from "framer-motion";

/**
 * Editorial isometric plant illustration.
 * Single-stroke line art with state colors, animated dataflow on conveyors,
 * pulsing critical asset, and slow ambient drift.
 */
export function IsometricPlant() {
  return (
    <div className="relative w-full aspect-[16/10] select-none">
      {/* Soft cyan-violet wash backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 30% 30%, oklch(0.80 0.14 200 / 0.10), transparent 70%), radial-gradient(50% 40% at 75% 70%, oklch(0.72 0.15 295 / 0.08), transparent 70%)",
        }}
      />
      <svg
        viewBox="0 0 1200 750"
        className="w-full h-full"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <defs>
          <pattern id="grid" width="40" height="23" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <path d="M0 0H40M0 0V23" stroke="oklch(0.265 0.005 270)" strokeWidth="0.5" opacity="0.6" />
          </pattern>
          <linearGradient id="cyan" x1="0" x2="1">
            <stop offset="0" stopColor="oklch(0.80 0.14 200)" stopOpacity="0" />
            <stop offset="0.5" stopColor="oklch(0.80 0.14 200)" stopOpacity="1" />
            <stop offset="1" stopColor="oklch(0.80 0.14 200)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Ground grid */}
        <rect x="80" y="220" width="1040" height="430" fill="url(#grid)" opacity="0.5" />

        {/* === Blast furnace BlastFurnace_BF2 (left, warning) === */}
        <g transform="translate(180,260)">
          {/* base */}
          <path d="M0 120 L100 170 L200 120 L100 70 Z" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
          {/* body */}
          <path d="M30 30 L30 100 L100 135 L170 100 L170 30" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M30 30 L100 65 L170 30 L100 -5 Z" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M100 -5 L100 65" stroke="oklch(0.475 0.006 270)" strokeWidth="0.75" strokeDasharray="2 3" />
          {/* stack */}
          <path d="M70 -5 L70 -70 L130 -70 L130 -5" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <ellipse cx="100" cy="-70" rx="30" ry="10" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          {/* warning glow */}
          <circle cx="100" cy="40" r="6" fill="oklch(0.78 0.16 75)" />
          <circle cx="100" cy="40" r="14" fill="none" stroke="oklch(0.78 0.16 75)" strokeWidth="1" opacity="0.4" />
          {/* label */}
          <g transform="translate(210,40)" fontFamily="JetBrains Mono" fontSize="11" fill="oklch(0.705 0.005 270)">
            <line x1="-10" y1="0" x2="0" y2="0" stroke="oklch(0.78 0.16 75)" />
            <text x="4" y="3">BlastFurnace_BF2 · 72% · warning</text>
          </g>
        </g>

        {/* === Cooling system CoolingSystem_C1 (right, healthy) === */}
        <g transform="translate(820,240)">
          <path d="M0 120 L100 170 L200 120 L100 70 Z" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
          <path d="M30 30 L30 100 L100 135 L170 100 L170 30" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M30 30 L100 65 L170 30 L100 -5 Z" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M70 -5 L70 -70 L130 -70 L130 -5" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <ellipse cx="100" cy="-70" rx="30" ry="10" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <circle cx="100" cy="40" r="6" fill="oklch(0.74 0.16 160)" />
          <g transform="translate(210,40)" fontFamily="JetBrains Mono" fontSize="11" fill="oklch(0.705 0.005 270)">
            <line x1="-10" y1="0" x2="0" y2="0" stroke="oklch(0.74 0.16 160)" />
            <text x="4" y="3">CoolingSystem_C1 · 88% · healthy</text>
          </g>
        </g>

        {/* === Conveyor Motor_M12 (center bottom, critical) === */}
        <g transform="translate(380,520)">
          {/* belt iso rect */}
          <path d="M0 0 L320 0 L380 30 L60 30 Z" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M0 0 L0 16 L60 46 L60 30" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
          <path d="M320 0 L320 16 L380 46 L380 30" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
          {/* rollers */}
          {[60, 150, 240, 320].map((x) => (
            <line key={x} x1={x} y1="0" x2={x + 18} y2="9" stroke="oklch(0.475 0.006 270)" strokeWidth="0.75" />
          ))}
          {/* dataflow */}
          <path
            d="M10 -4 L370 -4"
            stroke="url(#cyan)"
            strokeWidth="1.5"
            strokeDasharray="3 4"
            className="animate-dash-flow"
          />
          {/* critical pulse */}
          <circle cx="180" cy="-2" r="6" fill="oklch(0.65 0.22 25)">
            <animate attributeName="r" values="5;9;5" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <g transform="translate(-160,-8)" fontFamily="JetBrains Mono" fontSize="11" fill="oklch(0.65 0.22 25)">
            <line x1="0" y1="0" x2="160" y2="0" stroke="oklch(0.65 0.22 25)" strokeOpacity="0.4" />
            <text x="0" y="-6">Motor_M12 · 41% · critical · RUL 9d</text>
          </g>
        </g>

        {/* Pipes from BFs into conveyor */}
        <path d="M280 410 L450 510" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
        <path d="M920 390 L700 510" stroke="oklch(0.475 0.006 270)" strokeWidth="1" />
        <path d="M280 410 L450 510" stroke="url(#cyan)" strokeWidth="1" strokeDasharray="2 6" className="animate-dash-flow" />
        <path d="M920 390 L700 510" stroke="url(#cyan)" strokeWidth="1" strokeDasharray="2 6" className="animate-dash-flow" />

        {/* Small auxiliary unit — pump Pump_P3 */}
        <g transform="translate(580,360)">
          <path d="M0 0 L60 0 L80 12 L20 12 Z" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M0 0 L0 24 L20 36 L20 12" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M60 0 L60 24 L80 36 L80 12" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <circle cx="40" cy="-4" r="4" fill="oklch(0.65 0.22 25)" />
          <g transform="translate(95,4)" fontFamily="JetBrains Mono" fontSize="10" fill="oklch(0.705 0.005 270)">
            <text>Pump_P3</text>
          </g>
        </g>

        {/* Cooling loop CS-03 (small box top-center) */}
        <g transform="translate(560,200)">
          <path d="M0 0 L70 0 L90 12 L20 12 Z" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M0 0 L0 20 L20 32 L20 12" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <path d="M70 0 L70 20 L90 32 L90 12" stroke="oklch(0.705 0.005 270)" strokeWidth="1" />
          <circle cx="45" cy="-4" r="4" fill="oklch(0.78 0.16 75)" />
        </g>

        {/* Legend */}
        <g transform="translate(80,690)" fontFamily="JetBrains Mono" fontSize="10" fill="oklch(0.705 0.005 270)">
          <circle cx="0" cy="0" r="3" fill="oklch(0.74 0.16 160)" />
          <text x="10" y="3">healthy</text>
          <circle cx="90" cy="0" r="3" fill="oklch(0.78 0.16 75)" />
          <text x="100" y="3">warning</text>
          <circle cx="190" cy="0" r="3" fill="oklch(0.65 0.22 25)" />
          <text x="200" y="3">critical</text>
          <line x1="290" y1="0" x2="310" y2="0" stroke="oklch(0.80 0.14 200)" strokeDasharray="3 3" />
          <text x="316" y="3">live telemetry</text>
        </g>
      </svg>

      {/* Floating provenance card overlay */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="absolute right-4 top-4 card-elevated px-3 py-2.5 w-[200px] hidden md:block"
      >
        <div className="label mb-1.5" style={{ color: "var(--state-crit)" }}>Active anomaly</div>
        <div className="text-[13px] mb-1">Bearing failure imminent</div>
        <div className="font-mono text-[11px] text-text-muted">Motor_M12 · RUL 9d · 96.7%</div>
      </motion.div>
    </div>
  );
}