/**
 * VoiceDashboard — the summonable OREON voice agent.
 *
 * Opening it drops a transparent, sound-reactive particle globe in the middle of
 * the screen, ready to talk — no card, no backdrop, no labels. It listens, the
 * globe reacts to your voice, and it replies out loud. Only when the agent
 * produces a plan or takes actions does the globe glide to the left and a
 * summary panel fade in beside it. Clicking anywhere outside the globe dismisses
 * it. The agent is aware of the operator's role, current screen, the asset in
 * view, and their recent activity.
 */
import { Canvas } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Database, Radio, Sparkles, TriangleAlert, Wrench, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useActiveRole } from "@/lib/api/hooks";
import { useOREONContext } from "@/lib/context-store";
import { ParticleSphere } from "./ParticleSphere";
import { useVoiceAgent } from "./useVoiceAgent";

/** A short rising shimmer played when the agent opens. */
function playOpenSound() {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    [523.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      const start = now + i * 0.07;
      o.frequency.setValueAtTime(f * 0.7, start);
      o.frequency.exponentialRampToValueAtTime(f, start + 0.17);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.1, start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      o.connect(g);
      g.connect(master);
      o.start(start);
      o.stop(start + 0.44);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* audio not available — non-fatal */
  }
}

const ROLE_THEMES: Record<string, {
  core: string; rim: string;
  buttonBorder: string; buttonHoverBorder: string;
  shadow: string; hoverShadow: string;
  bgGradient: string;
  pingBg: string; pulseBg: string; barBg: string;
  textColor: string; textLightColor: string; bgLight: string; borderLight: string;
}> = {
  operator: { core: "#0d9488", rim: "#5eead4", buttonBorder: "border-teal-500/30", buttonHoverBorder: "hover:border-teal-400/60", shadow: "shadow-[0_8px_32px_rgba(20,184,166,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(20,184,166,0.45)]", bgGradient: "from-teal-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-teal-500/10", pulseBg: "bg-teal-400/5", barBg: "bg-teal-400", textColor: "text-teal-400", textLightColor: "text-teal-300", bgLight: "bg-teal-500/10", borderLight: "border-teal-400/20" },
  maintenance_engineer: { core: "#2563eb", rim: "#93c5fd", buttonBorder: "border-blue-500/30", buttonHoverBorder: "hover:border-blue-400/60", shadow: "shadow-[0_8px_32px_rgba(59,130,246,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(59,130,246,0.45)]", bgGradient: "from-blue-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-blue-500/10", pulseBg: "bg-blue-400/5", barBg: "bg-blue-400", textColor: "text-blue-400", textLightColor: "text-blue-300", bgLight: "bg-blue-500/10", borderLight: "border-blue-400/20" },
  reliability_engineer: { core: "#9333ea", rim: "#d8b4fe", buttonBorder: "border-purple-500/30", buttonHoverBorder: "hover:border-purple-400/60", shadow: "shadow-[0_8px_32px_rgba(168,85,247,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(168,85,247,0.45)]", bgGradient: "from-purple-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-purple-500/10", pulseBg: "bg-purple-400/5", barBg: "bg-purple-400", textColor: "text-purple-400", textLightColor: "text-purple-300", bgLight: "bg-purple-500/10", borderLight: "border-purple-400/20" },
  supervisor: { core: "#ea580c", rim: "#fdba74", buttonBorder: "border-orange-500/30", buttonHoverBorder: "hover:border-orange-400/60", shadow: "shadow-[0_8px_32px_rgba(249,115,22,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(249,115,22,0.45)]", bgGradient: "from-orange-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-orange-500/10", pulseBg: "bg-orange-400/5", barBg: "bg-orange-400", textColor: "text-orange-400", textLightColor: "text-orange-300", bgLight: "bg-orange-500/10", borderLight: "border-orange-400/20" },
  procurement_officer: { core: "#ca8a04", rim: "#fde047", buttonBorder: "border-yellow-500/30", buttonHoverBorder: "hover:border-yellow-400/60", shadow: "shadow-[0_8px_32px_rgba(234,179,8,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(234,179,8,0.45)]", bgGradient: "from-yellow-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-yellow-500/10", pulseBg: "bg-yellow-400/5", barBg: "bg-yellow-400", textColor: "text-yellow-400", textLightColor: "text-yellow-300", bgLight: "bg-yellow-500/10", borderLight: "border-yellow-400/20" },
  plant_manager: { core: "#dc2626", rim: "#fca5a5", buttonBorder: "border-red-500/30", buttonHoverBorder: "hover:border-red-400/60", shadow: "shadow-[0_8px_32px_rgba(239,68,68,0.25)]", hoverShadow: "hover:shadow-[0_8px_32px_rgba(239,68,68,0.45)]", bgGradient: "from-red-950/80 via-slate-900/90 to-indigo-950/80", pingBg: "bg-red-500/10", pulseBg: "bg-red-400/5", barBg: "bg-red-400", textColor: "text-red-400", textLightColor: "text-red-300", bgLight: "bg-red-500/10", borderLight: "border-red-400/20" },
};

export function VoiceDashboard() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeRole] = useActiveRole();
  const activeAssetId = useOREONContext((s) => s.activeAssetId);
  const currentPage = useOREONContext((s) => s.currentPage);
  const recentActivity = useOREONContext((s) => s.recentActivity);
  const sidebarCollapsed = useOREONContext((s) => s.sidebarCollapsed);

  const agent = useVoiceAgent({ role: activeRole, contextAssetId: activeAssetId, currentPage, recentActivity });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        closeAgent();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      playOpenSound();
      agent.startListening();
    };
    window.addEventListener("oreon:voice", handler);
    return () => window.removeEventListener("oreon:voice", handler);
  }, [agent]);

  const r = agent.response;
  const hasSummary = !!r && (r.plan_of_action.length > 0 || r.execution_log.some((e) => e.kind === "write"));

  const openAgent = () => {
    setOpen(true);
    playOpenSound();
    agent.startListening(); // the click is the user gesture STT/TTS need
  };

  const closeAgent = () => {
    agent.reset();
    setOpen(false);
  };

  if (!mounted) return null;
  if (currentPage === "Digital Twin") return null;

  const theme = ROLE_THEMES[activeRole] || ROLE_THEMES.operator;

  return createPortal(
    <>
      {/* Floating summon button removed — the OREON Voice trigger now lives in the
          app header, beside the role selector (see Shell). It opens the agent by
          dispatching the `oreon:voice` window event. */}
      <AnimatePresence>
        {false && (
          <motion.button
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            onClick={openAgent}
            title="Talk to OREON"
            className={`fixed bottom-6 right-6 z-50 size-14 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 backdrop-blur-md border ${theme.buttonBorder} ${theme.buttonHoverBorder} active:scale-95 group ${theme.shadow} ${theme.hoverShadow} bg-gradient-to-tr ${theme.bgGradient}`}
          >
            {/* Concentric pulsing outer rings */}
            <span className={`absolute inset-0 rounded-full animate-ping ${theme.pingBg}`} style={{ animationDuration: "3s" }} />
            <span className={`absolute inset-1.5 rounded-full animate-pulse ${theme.pulseBg}`} style={{ animationDuration: "2s" }} />
            
            {/* Sound wave / Audio lines animation */}
            <div className="flex items-center gap-1 z-10">
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes voice-wave-1 { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.2); } }
                @keyframes voice-wave-2 { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1.4); } }
                @keyframes voice-wave-3 { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1.7); } }
                .voice-bar-1 { animation: voice-wave-1 1.2s infinite ease-in-out; transform-origin: center; }
                .voice-bar-2 { animation: voice-wave-2 1.4s infinite ease-in-out; transform-origin: center; }
                .voice-bar-3 { animation: voice-wave-3 0.9s infinite ease-in-out; transform-origin: center; }
              `}} />
              <span className={`w-0.5 h-4 rounded-full voice-bar-1 ${theme.barBg}`} />
              <span className={`w-0.5 h-6 rounded-full voice-bar-2 ${theme.barBg}`} />
              <span className={`w-0.5 h-7 rounded-full voice-bar-3 ${theme.barBg}`} />
              <span className={`w-0.5 h-5 rounded-full voice-bar-2 ${theme.barBg}`} />
              <span className={`w-0.5 h-3 rounded-full voice-bar-1 ${theme.barBg}`} />
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Transparent full-screen stage — click outside the globe to close ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 backdrop-blur-sm bg-black/55"
            onClick={closeAgent}
          >
            {/* Inner centering wrapper — spans the entire viewport */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                initial={{ opacity: 0, x: 0 }}
                animate={{
                  opacity: 1,
                  x: hasSummary ? -160 : 0
                }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
                className="flex flex-col items-center justify-start gap-5 pointer-events-none w-full h-full"
                style={{ paddingTop: "calc(42vh - min(19vmin, 130px))" }}
              >
                {/* 3D Orb */}
                <div
                  className="cursor-pointer relative shrink-0 pointer-events-auto"
                  style={{ width: "min(38vmin, 260px)", height: "min(38vmin, 260px)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    agent.toggle();
                  }}
                  title={agent.state === "listening" ? "Stop" : "Tap to speak"}
                >
                  {/* ultra-subtle depth glow, no hard background */}
                  <div className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle at 50% 50%, rgba(59,130,246,0.06), transparent 55%)" }} />
                  {mounted && (
                    <Canvas
                      camera={{ position: [0, 0, 3.2], fov: 50 }}
                      gl={{ antialias: true, alpha: true }}
                      dpr={[1, 2]}
                      className="w-full h-full [&_canvas]:!w-full [&_canvas]:!h-full [&_canvas]:!absolute [&_canvas]:!top-0 [&_canvas]:!left-0"
                      style={{ background: "transparent" }}
                    >
                      <ParticleSphere audioRef={agent.audioRef} state={agent.state} coreColor={theme.core} rimColor={theme.rim} />
                    </Canvas>
                  )}
                </div>

                {/* Premium Subtitles Panel */}
                <div
                  className="w-[min(640px,90vw)] font-sans text-left px-6 py-5 card-elevated backdrop-blur-md relative overflow-hidden shadow-[0_30px_70px_rgba(0,0,0,0.55)] transition-all duration-300 pointer-events-auto shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Left Role visual accent bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-primary" />

                  {/* Removed explicit X close button as per user request. Clicking outside closes the overlay. */}

                  {agent.state === "listening" && (
                    <div className="space-y-2 pr-6">
                      <div className="flex items-center gap-2 mb-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-primary">
                        <span className="relative flex size-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                          <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                        </span>
                        Listening
                      </div>
                      <p className="font-sans text-[15px] font-medium text-foreground tracking-wide leading-relaxed drop-shadow-sm">
                        {agent.interim || <span className="text-text-muted/65 italic">Speak now...</span>}
                      </p>
                    </div>
                  )}
                  {agent.state === "thinking" && (
                    <div className="space-y-2 pr-6">
                      <div className="flex items-center gap-2 mb-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-violet">
                        <span className="relative flex size-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet opacity-75"></span>
                          <span className="relative inline-flex rounded-full size-2 bg-violet"></span>
                        </span>
                        Thinking
                      </div>
                      {agent.lastUtterance && (
                        <p className="font-sans text-[13px] text-text-secondary italic leading-relaxed">
                          "{agent.lastUtterance}"
                        </p>
                      )}
                      <p className="font-sans text-[14px] text-violet font-medium animate-pulse tracking-wide leading-relaxed">
                        Analyzing plant telemetry & context...
                      </p>
                    </div>
                  )}
                  {agent.state === "speaking" && agent.response?.spoken_response && (
                    <div className="space-y-3 pr-6">
                      {agent.lastUtterance && (
                        <div className="border-b border-border/40 pb-2 text-left">
                          <span className="font-mono text-[9px] tracking-widest text-text-muted uppercase block mb-0.5">
                            Operator Utterance
                          </span>
                          <p className="font-sans text-[13px] text-text-secondary italic leading-relaxed">
                            "{agent.lastUtterance}"
                          </p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 mb-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-emerald-400">
                          <span className="relative flex size-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full size-2 bg-emerald-400"></span>
                          </span>
                          OREON Voice
                        </div>
                        <p className="font-sans text-[15px] leading-relaxed text-foreground font-medium tracking-wide drop-shadow-sm max-h-[140px] overflow-y-auto pr-2 custom-scrollbar">
                          {agent.response.spoken_response}
                        </p>
                      </div>
                    </div>
                  )}
                  {agent.state === "idle" && (
                    <div className="space-y-2 pr-6">
                      <div className="flex items-center gap-2 mb-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-text-muted">
                        <span className="size-1.5 rounded-full bg-text-muted/65" />
                        Voice Agent Standby
                      </div>
                      <p className="font-sans text-[14px] text-text-muted leading-relaxed">
                        {agent.lastUtterance ? `"${agent.lastUtterance}"` : "Tap the sphere to begin"}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Summary panel — overlays on the right without shifting the globe */}
              <AnimatePresence>
                {hasSummary && r && (
                  <motion.div
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 30 }}
                    transition={{ type: "spring", stiffness: 200, damping: 28 }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-6 lg:right-10 top-1/2 -translate-y-1/2 z-20 w-[min(380px,84vw)] max-h-[80vh] overflow-y-auto custom-scrollbar"
                  >
                    <div className="w-full font-sans card-elevated p-5 space-y-4 relative overflow-hidden shadow-[0_30px_70px_rgba(0,0,0,0.55)]">
                      {/* Left Role visual accent bar */}
                      <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-primary" />

                      {/* Removed explicit X close button as per user request. Clicking outside closes the overlay. */}

                      <div className="flex items-center justify-between pr-6 border-b border-border/40 pb-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 text-primary" strokeWidth={1.75} />
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">Action Summary</span>
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary">
                          {activeRole.replace("_", " ")}
                        </span>
                      </div>

                      {/* context + telemetry widgets */}
                      <div className="space-y-1.5">
                        <SectionLabel icon={<Database className="size-3" />} accentColor="text-text-muted">Target Context</SectionLabel>
                        <div className="font-sans text-[12.5px] text-text-secondary leading-snug">
                          {r.context_label ? (
                            <>Analyzing <span className="font-mono text-primary font-medium">{r.context_label}</span></>
                          ) : (
                            currentPage
                          )}
                        </div>
                        {r.widgets.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.widgets.map((w, i) => (
                              <span key={i} className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${widgetTone(w.tone)}`}>
                                {w.label}: {w.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* spoken response */}
                      {r.spoken_response && (
                        <div className="space-y-1.5 border-t border-border/30 pt-3">
                          <SectionLabel icon={<Sparkles className="size-3" />} accentColor="text-violet">Response Narrative</SectionLabel>
                          <p className="font-sans text-[13px] leading-relaxed text-text-secondary tracking-wide">{r.spoken_response}</p>
                        </div>
                      )}

                      {/* plan of action */}
                      {r.plan_of_action.length > 0 && (
                        <div className="space-y-3 border-t border-border/30 pt-3">
                          <SectionLabel icon={<Check className="size-3" />} accentColor="text-primary">Plan of Action</SectionLabel>
                          <div className="space-y-2">
                            {r.plan_of_action.map((step, i) => (
                              <div key={i} className="flex items-start gap-3 text-[12px]">
                                <span className="font-mono text-[10px] rounded-full size-5 flex items-center justify-center shrink-0 mt-0.5 border border-primary/30 bg-primary/5 text-primary font-bold">
                                  {i + 1}
                                </span>
                                <span className="font-sans text-text-secondary leading-relaxed tracking-wide">{step}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* execution log */}
                      {r.execution_log.length > 0 && (
                        <div className="space-y-3 border-t border-border/30 pt-3">
                          <SectionLabel icon={<Zap className="size-3" />}>Telemetry & API Logs</SectionLabel>
                          <div className="space-y-1.5">
                            {r.execution_log.map((entry, i) => (
                              <div key={i} className="flex items-center gap-2.5 text-[11px] font-mono py-1.5 px-3 rounded bg-surface-1/40 border border-border/30 hover:border-border/60 transition-colors">
                                {entry.kind === "write" ? (
                                  <Wrench className={`size-3.5 shrink-0 ${logTone(entry.status)}`} />
                                ) : (
                                  <Database className={`size-3.5 shrink-0 ${logTone(entry.status)}`} />
                                )}
                                <span className="font-mono text-text-secondary truncate flex-1">{entry.label}</span>
                                <span className={`shrink-0 font-bold ${logTone(entry.status)}`}>
                                  {entry.status === "ok" ? "✓" : entry.status === "error" ? "✕" : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {agent.error && (
                        <div className="font-sans flex items-center gap-2 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5">
                          <TriangleAlert className="size-3.5 shrink-0" />
                          {agent.error}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

function SectionLabel({
  children,
  icon,
  accentColor = "text-text-muted",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  accentColor?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 mb-1.5 font-mono text-[9px] uppercase tracking-[0.15em] ${accentColor}`}>
      {icon}
      {children}
    </div>
  );
}

function widgetTone(tone: string): string {
  switch (tone) {
    case "crit": return "text-crit border-crit/30 bg-crit/8";
    case "warn": return "text-warn border-warn/30 bg-warn/8";
    case "ok": return "text-ok border-ok/30 bg-ok/8";
    case "violet": return "text-violet border-violet/30 bg-violet/8";
    default: return "text-sky-300 border-sky-400/30 bg-sky-500/8";
  }
}

function logTone(status: string): string {
  switch (status) {
    case "ok": return "text-ok";
    case "error": return "text-crit";
    default: return "text-text-muted";
  }
}
