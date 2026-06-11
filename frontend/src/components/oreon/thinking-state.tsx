import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Claude-style "thinking" status with rotating, context-aware industrial messages.
 *
 * Instead of a dead "Loading…", we narrate what OREON is actually doing across the
 * real pipeline phases (retrieval → reasoning → report), which dramatically improves
 * perceived performance even while the model takes 8–15s.
 */

// Phased so early messages match retrieval, later ones match reasoning/report.
export const THINKING_MESSAGES: string[] = [
  // retrieval
  "Inspecting maintenance records…",
  "Reviewing equipment history…",
  "Consulting engineering documentation…",
  "Comparing historical incidents…",
  // analysis
  "Analyzing sensor patterns…",
  "Cross-checking operating limits…",
  "Investigating probable causes…",
  "Evaluating maintenance procedures…",
  // reasoning / report
  "Building root-cause analysis…",
  "Validating recommendations…",
  "Generating action plan…",
  "Preparing engineering report…",
];

const VARIANTS: Record<string, string[]> = {
  ask: THINKING_MESSAGES,
  investigation: [
    "Loading asset telemetry…",
    "Analyzing sensor patterns…",
    "Cross-checking operating limits…",
    "Searching maintenance manuals…",
    "Comparing historical incidents…",
    "Building root-cause analysis…",
    "Estimating remaining useful life…",
    "Validating recommendations…",
    "Preparing engineering report…",
  ],
  decision: [
    "Assessing plant impact…",
    "Scoring maintenance priority…",
    "Checking spare-parts availability…",
    "Estimating business & downtime cost…",
    "Simulating delay scenarios…",
    "Building the maintenance plan…",
    "Preparing decision report…",
  ],
};

export function ThinkingState({
  variant = "ask",
  intervalMs = 2600,
  className = "",
  message,
}: {
  variant?: keyof typeof VARIANTS;
  intervalMs?: number;
  className?: string;
  message?: string;
}) {
  const messages = VARIANTS[variant] ?? THINKING_MESSAGES;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (message) return;
    // Advance through the phases, then gently hold near the end until the answer lands.
    const id = setInterval(() => {
      setI((prev) => (prev < messages.length - 1 ? prev + 1 : prev));
    }, intervalMs);
    return () => clearInterval(id);
  }, [messages.length, intervalMs, message]);

  const currentMsg = message ?? messages[i];

  return (
    <div className={"flex items-center gap-3 font-mono text-[12px] text-text-muted " + className}>
      <span className="relative flex size-3 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-violet/40 animate-ping" />
        <span className="relative inline-flex size-3 rounded-full bg-violet" />
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={currentMsg}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="text-text-secondary"
        >
          {currentMsg}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
