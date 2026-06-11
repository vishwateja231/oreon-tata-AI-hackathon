import { AnimatePresence, motion } from "framer-motion";
import { Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useActiveRole } from "@/lib/api/hooks";
import { useOREONContext } from "@/lib/context-store";

// Global trigger — call from anywhere without needing a React ref
export function triggerAskPalette(seed = "") {
  window.dispatchEvent(new CustomEvent("oreon:ask", { detail: { seed } }));
}

function isQuestion(s: string) {
  const t = s.trim().toLowerCase();
  return t.endsWith("?") || /^(why|what|how|which|should|when|where|is|are|can|will|does|do)\b/.test(t);
}

const SUGGESTIONS = [
  "Motor M12 bearing status",
  "Pump P3 cavitation risk",
  "Refractory wear SOP",
  "Spare bearing SKU-2241",
];

export function useAskPalette() {
  const [openState, setOpen] = useState(false);
  const [initial, setInitial] = useState("");

  // Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setInitial("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Global event trigger (for non-React callers and cross-page triggers)
  useEffect(() => {
    const handler = (e: Event) => {
      const seed = (e as CustomEvent).detail?.seed ?? "";
      setInitial(seed);
      setOpen(true);
    };
    window.addEventListener("oreon:ask", handler);
    return () => window.removeEventListener("oreon:ask", handler);
  }, []);

  return {
    isOpen: openState,
    initial,
    open: (seed?: string) => {
      setInitial(seed ?? "");
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}

export function AskPalette({ isOpen, initial, close }: { isOpen: boolean; initial: string; close: () => void }) {
  const [q, setQ] = useState(initial);
  const navigate = useNavigate();
  const [activeRole] = useActiveRole();
  const { activeAssetId } = useOREONContext();

  useEffect(() => {
    if (isOpen) setQ(initial);
  }, [isOpen, initial]);

  const askMode = isQuestion(q);

  // Submit → navigate to /app/ask with the query so the full chat page handles the AI response
  const submit = useCallback(() => {
    const text = q.trim();
    if (!text) return;
    close();
    navigate({ to: "/app/ask", search: { q: text } });
  }, [q, close, navigate]);

  // Suggestion click → navigate immediately
  const submitText = useCallback((text: string) => {
    close();
    navigate({ to: "/app/ask", search: { q: text } });
  }, [close, navigate]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="fixed inset-0 z-[200] bg-background/70 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4"
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[660px] rounded-lg border border-border bg-surface-1/95 backdrop-blur shadow-2xl overflow-hidden"
          >
            {/* Mode row */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={
                  "inline-flex items-center gap-1.5 h-6 px-2 rounded-full font-mono text-[10px] tracking-wide " +
                  (askMode
                    ? "bg-violet/15 text-violet border border-violet/30"
                    : "bg-surface-2 text-text-muted border border-border")
                }>
                  {askMode ? <Sparkles className="size-2.5" /> : <Search className="size-2.5" />}
                  {askMode ? "ASK" : "SEARCH"}
                </span>
                <span className="inline-flex items-center h-6 px-2 rounded-full bg-surface-2 border border-border font-mono text-[10px] text-text-secondary">
                  Role: <span className="text-violet font-semibold capitalize ml-1">{activeRole.replace(/_/g, " ")}</span>
                </span>
                {activeAssetId && (
                  <span className="inline-flex items-center h-6 px-2 rounded-full bg-violet/15 border border-violet/30 font-mono text-[10px] text-violet">
                    {activeAssetId}
                  </span>
                )}
              </div>
              <button onClick={close} className="text-text-muted hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
              {askMode
                ? <Sparkles className="size-4 text-violet shrink-0" strokeWidth={1.5} />
                : <Search className="size-4 text-text-muted shrink-0" strokeWidth={1.5} />
              }
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q.trim()) submit();
                  if (e.key === "Escape") close();
                }}
                placeholder="Search assets, incidents, SOPs — or ask a question…"
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-text-muted"
              />
              {q.trim() && (
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">↵</kbd>
              )}
            </div>

            {/* Body */}
            <div className="max-h-[55vh] overflow-y-auto">
              {!q.trim() && (
                <div className="p-4 space-y-1">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-text-muted px-2 pb-1">Recent searches</div>
                  {SUGGESTIONS.map((s) => (
                    <div
                      key={s}
                      onClick={() => submitText(s)}
                      className="flex items-center gap-3 px-2 py-2 rounded text-[13px] text-text-secondary hover:bg-surface-2 cursor-pointer transition-colors"
                    >
                      <Search className="size-3.5 text-text-muted shrink-0" />
                      {s}
                    </div>
                  ))}
                </div>
              )}
              {q.trim() && !askMode && (
                <div className="p-4 space-y-1">
                  <div
                    onClick={submit}
                    className="flex items-center gap-3 px-2 py-2 rounded text-[13px] text-text-secondary hover:bg-surface-2 cursor-pointer transition-colors"
                  >
                    <Search className="size-3.5 text-text-muted shrink-0" />
                    Search for "<span className="text-foreground">{q}</span>"
                  </div>
                </div>
              )}
              {q.trim() && askMode && (
                <div
                  onClick={submit}
                  className="p-5 flex items-start gap-3 hover:bg-surface-2/60 cursor-pointer transition-colors group"
                >
                  <Sparkles className="size-4 text-violet mt-0.5 shrink-0" strokeWidth={1.5} />
                  <div>
                    <div className="text-[14px] text-foreground group-hover:text-violet transition-colors">{q}</div>
                    <div className="font-mono text-[11px] text-text-muted mt-1">Press Enter or click to open in Ask OREON</div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[10px] font-mono text-text-muted bg-surface-2/50">
              <span>{askMode ? "Enter → open in Ask OREON" : "Ctrl+K to close"}</span>
              <span>ESC to close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
