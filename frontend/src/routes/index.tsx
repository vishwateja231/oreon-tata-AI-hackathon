import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, type RefObject } from "react";
import { Header } from "@/components/landing/SiteShell";
import { Reveal, Stagger, StaggerItem, Section } from "@/components/landing/motion-primitives";
import { useLaunch } from "@/components/landing/LaunchTransition";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OREON — Industrial Maintenance Intelligence for Steel Operations" },
      { name: "description", content: "OREON Maintenance Wizard continuously monitors critical assets, predicts failures, investigates root causes and prevents downtime before production is impacted." },
      { property: "og:title", content: "OREON · Maintenance Wizard" },
      { property: "og:description", content: "Industrial Maintenance Intelligence Platform for Steel Manufacturing." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} className="relative h-screen overflow-y-auto bg-background pt-16 text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0 line-grid opacity-100" />
      <div className="relative z-10">
        <Header />
        <Hero container={scrollRef} />
        <PlantStrip />
        <Capabilities />
        <TodayTomorrow />
        <Outcomes />
        <ClosingCTA />
        <Footer />
      </div>
    </div>
  );
}

/* ============= HERO EVIDENCE CARD — what OREON actually produces ============= */
function EvidenceCard() {
  const chips = [
    { t: "Vibration ▲ 18%", c: "#fb7185" },
    { t: "Oil temp ▲ 9°C", c: "#fbbf24" },
    { t: "SOP-114 §4.2", c: "#2dd4bf" },
    { t: "Incident INC-2231", c: "#a78bfa" },
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-[oklch(0.165_0.004_270)] p-6 shadow-[0_32px_90px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-dim)]">Reduction Gearbox · Gearbox_G1</span>
        <span className="inline-flex items-center gap-2 rounded-md border border-[#fb7185]/40 bg-[#fb7185]/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#fb7185]">
          <span className="size-1.5 rotate-45 bg-[#fb7185]" />
          Critical severity
        </span>
      </div>

      <h3 className="mt-4 font-display text-[25px] leading-tight text-foreground">Bearing wear from lubrication loss</h3>
      <p className="mt-2.5 text-[13px] leading-[1.6] text-[var(--ink-dim)]">
        Failure predicted in <span className="text-[#fbbf24]">11 days</span> — root cause traced to a
        declining oil film and rising vibration harmonics.
      </p>

      {/* model confidence */}
      <div className="mt-5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-dim)]">
          <span>Model confidence</span>
          <span className="text-[#34d399]">91%</span>
        </div>
        <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-[#34d399]" style={{ width: "91%" }} />
        </div>
      </div>

      {/* evidence cited */}
      <div className="mt-5">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-dim)]">Evidence cited</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c.t}
              className="rounded-md border px-2.5 py-1 font-mono text-[10px]"
              style={{ color: c.c, borderColor: `${c.c}33`, background: `${c.c}0d` }}
            >
              {c.t}
            </span>
          ))}
        </div>
      </div>

      {/* recommended next steps — generalized post-prediction workflow */}
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-dim)]">Recommended next steps</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { n: "01", t: "Draft work order", c: "#34d399" },
            { n: "02", t: "Stage replacement spare", c: "#2dd4bf" },
            { n: "03", t: "Schedule maintenance window", c: "#a78bfa" },
          ].map((s, i) => (
            <span key={s.n} className="flex items-center gap-2">
              {i > 0 && <span className="text-[12px] text-[var(--ink-dim)]/50">→</span>}
              <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                <span className="font-mono text-[9px]" style={{ color: s.c }}>{s.n}</span>
                <span className="text-[12px] text-foreground/90">{s.t}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============= HERO ============= */
function Hero({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container, target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  const { launch } = useLaunch();
  const fire = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    launch({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, "/command");
  };

  return (
    <section ref={ref} className="relative min-h-[92vh] overflow-hidden border-b border-[var(--hairline)]">
      <motion.div style={{ y, opacity }} className="relative mx-auto grid min-h-[92vh] max-w-[1600px] items-center gap-12 px-8 py-20 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Reveal>
            <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.25em] text-[var(--ink-dim)]">
              <span className="h-px w-10 bg-brand" />
              <span className="font-mono">Industrial Operations · Built for Steel Manufacturing</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h1 className="mt-8 h-display text-[80px] leading-[0.9] sm:text-[120px]">
              OREON
            </h1>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-2 font-display text-[30px] font-light tracking-tight text-foreground sm:text-[44px]">
              Maintenance Wizard
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="mt-8 max-w-xl font-display text-[20px] leading-[1.3] text-foreground sm:text-[24px]">
              An autonomous intelligence layer between sensor and decision —
              it watches the plant, predicts failures and shows its evidence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/command" onClick={fire} className="btn-solid">Enter OREON →</a>
              <Link to="/platform" className="btn-ghost">Explore the platform</Link>
            </div>
          </Reveal>
        </div>

        <div className="hidden lg:block">
          <Reveal delay={0.25}>
            <EvidenceCard />

            <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
              {[
                ["10", "assets watched", "#2dd4bf"],
                ["08", "reasoning engines", "#a78bfa"],
                ["06", "role surfaces", "#34d399"],
                ["24/7", "sentinel watch", "#fbbf24"],
              ].map(([v, l, c]) => (
                <div key={l} className="bg-[oklch(0.165_0.004_270)] p-4 text-center">
                  <div className="font-mono text-[22px] leading-none" style={{ color: c }}>{v}</div>
                  <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--ink-dim)]">{l}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 1 }}
        className="absolute bottom-7 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2.5"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">Scroll</span>
        <span className="relative block h-10 w-px overflow-hidden bg-white/12">
          <motion.span
            className="absolute inset-x-0 top-0 block h-3 bg-foreground"
            animate={{ y: [-12, 40] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
          />
        </span>
      </motion.div>
    </section>
  );
}


/* ============= THE MONITORED PLANT ============= */
const PLANT_ASSETS = [
  { name: "Blast Furnace Hearth", s: "ok" },
  { name: "Rolling Mill Drive", s: "ok" },
  { name: "Reduction Gearbox", s: "crit" },
  { name: "Ore Belt Conveyor", s: "ok" },
  { name: "Cooling Water Pump", s: "warn" },
  { name: "Primary Cooling System", s: "warn" },
  { name: "Combustion Air Fan", s: "ok" },
  { name: "Baghouse Dust Collector", s: "ok" },
  { name: "Hot Rolling Mill", s: "ok" },
  { name: "Primary Ore Crusher", s: "ok" },
] as const;
const STATUS_HEX = { ok: "#10b981", warn: "#f59e0b", crit: "#ef4444" } as const;

function PlantStrip() {
  return (
    <section className="border-b border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--hairline)] pb-6">
          <div>
            <div className="eyebrow">The monitored plant</div>
            <h3 className="mt-3 h-display text-[28px] sm:text-[36px]">Ten assets. One dependency chain. Zero blind spots.</h3>
          </div>
          <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-dim)]">
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: STATUS_HEX.ok }} /> Healthy</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: STATUS_HEX.warn }} /> Degrading</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: STATUS_HEX.crit }} /> Critical</span>
          </div>
        </div>
        <ul className="mt-8 grid grid-cols-2 gap-px bg-[var(--hairline)] sm:grid-cols-3 lg:grid-cols-5">
          {PLANT_ASSETS.map((a, idx) => (
            <li key={a.name} className="group relative bg-background px-5 py-4 transition-colors hover:bg-surface-1">
              <span
                className="absolute inset-x-0 top-0 h-[2px] transition-opacity"
                style={{ background: STATUS_HEX[a.s], opacity: a.s === "ok" ? 0.18 : 0.85 }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${a.s !== "ok" ? "animate-pulse-dot" : ""}`}
                    style={{ background: STATUS_HEX[a.s], boxShadow: a.s !== "ok" ? `0 0 8px ${STATUS_HEX[a.s]}` : "none" }}
                  />
                  <span className="font-mono text-[10px] text-[var(--ink-dim)]">{String(idx + 1).padStart(2, "0")}</span>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.15em]" style={{ color: STATUS_HEX[a.s], opacity: a.s === "ok" ? 0.5 : 1 }}>
                  {a.s === "ok" ? "OK" : a.s === "warn" ? "Degrading" : "Critical"}
                </span>
              </div>
              <div className="mt-2.5 font-display text-[15px] leading-tight text-foreground">{a.name}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============= CAPABILITIES (compact, links to /platform) ============= */
function Capabilities() {
  const caps = [
    { n: "01", t: "Sentinel Center", c: "#2dd4bf", d: "Autonomous 24/7 monitoring. Anomalies detected, classified and routed before anyone asks." },
    { n: "02", t: "Reliability Analytics", c: "#a78bfa", d: "Remaining-useful-life forecasts with confidence intervals — failures surface 7–14 days early." },
    { n: "03", t: "Investigation Center", c: "#10b981", d: "Root cause in minutes, every claim cited to sensors, SOPs, manuals and incident history." },
    { n: "04", t: "Plant Digital Twin", c: "#f59e0b", d: "The plant as a live 3D dependency graph. See the cascade before it cascades." },
    { n: "05", t: "Scenario Simulator", c: "#ec4899", d: "Model any what-if — delay, load, spares — priced in downtime and capital exposure." },
    { n: "06", t: "Operations War Room", c: "#ef4444", d: "Plant-wide threat, revenue at risk and failure countdowns, in business terms." },
  ];
  return (
    <Section
      className="!py-20 border-b border-[var(--hairline)]"
      eyebrow="What it does"
      title={<>Six capabilities.<br /><span className="text-[#a78bfa]">One continuous system.</span></>}
    >
      <Stagger className="grid gap-px bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-3">
        {caps.map((c) => (
          <StaggerItem key={c.n}>
            <Link to="/platform" className="group relative block h-full bg-background p-7 transition-colors hover:bg-surface-1 overflow-hidden">
              {/* coloured top accent bar, brightens on hover */}
              <span className="absolute left-0 top-0 h-[2px] w-full opacity-50 group-hover:opacity-100 transition-opacity" style={{ background: c.c }} />
              <div className="relative flex items-center justify-between font-mono text-[11px]">
                <span className="inline-flex size-7 items-center justify-center rounded-md border" style={{ color: c.c, borderColor: `${c.c}33`, background: `${c.c}0d` }}>{c.n}</span>
                <span className="opacity-0 transition-all duration-300 group-hover:translate-x-0 -translate-x-1 group-hover:opacity-100" style={{ color: c.c }}>→</span>
              </div>
              <h3 className="relative mt-4 font-display text-[22px] leading-tight">{c.t}</h3>
              <p className="relative mt-2 text-[13px] leading-[1.65] text-[var(--ink-dim)]">{c.d}</p>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
      <Reveal delay={0.2}>
        <div className="mt-10">
          <Link to="/platform" className="btn-ghost">Explore each capability in depth →</Link>
        </div>
      </Reveal>
    </Section>
  );
}

/* ============= TODAY / FUTURE SCOPE ============= */
function TodayTomorrow() {
  const built = [
    "Autonomous Sentinel agent scanning all 10 assets continuously",
    "Random-Forest RUL prediction with confidence intervals",
    "Evidence-grounded investigations — Gemini + RAG over manuals & SOPs",
    "3D digital twin with live health, risk and impact overlays",
    "Scenario simulator pricing every maintenance decision",
    "Six role-adapted command surfaces with feedback learning",
  ];
  const future = [
    "Live SCADA / PLC ingestion replacing the simulated sensor stream",
    "Authentication and enforced role-based access control",
    "CMMS / SAP work-order and procurement integration",
    "Multi-plant fleet view with cross-site benchmarking",
    "Mobile alerts and push-based field workflows",
    "Vendor-API procurement triggers from RUL forecasts",
  ];
  return (
    <Section
      className="!py-20 border-b border-[var(--hairline)]"
      eyebrow="Status of the build"
      title={<>Built today.<br /><span className="text-[#34d399]">Scoped for tomorrow.</span></>}
    >
      <div className="grid gap-px bg-[var(--hairline)] lg:grid-cols-2">
        <Reveal>
          <div className="h-full bg-background p-8">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Working today
            </div>
            <ul className="mt-6 space-y-3.5">
              {built.map((item, i) => (
                <li key={item} className="grid grid-cols-[28px_1fr] items-baseline gap-3 border-l border-emerald-400/30 pl-4">
                  <span className="font-mono text-[10px] text-emerald-400/80">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[14px] leading-[1.6] text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="h-full bg-background p-8">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
              <span className="size-1.5 rounded-full bg-brand" />
              Future scope
            </div>
            <ul className="mt-6 space-y-3.5">
              {future.map((item, i) => (
                <li key={item} className="grid grid-cols-[28px_1fr] items-baseline gap-3 border-l border-brand/30 pl-4">
                  <span className="font-mono text-[10px] text-brand/80">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[14px] leading-[1.6] text-[var(--ink-dim)]">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ============= OUTCOMES ============= */
function Outcomes() {
  const rows = [
    ["Unplanned downtime", "− 38%", "by surfacing failures 7–14 days early"],
    ["Mean time to investigate", "− 72%", "evidence assembled automatically"],
    ["Engineer time per alert", "− 60%", "manuals, SOPs & history pre-fetched"],
    ["Spare stock-outs", "− 45%", "procurement triggered on RUL forecasts"],
    ["Catastrophic failures", "− 51%", "prioritized intervention windows"],
  ];
  return (
    <Section
      className="!py-20"
      eyebrow="Modelled outcomes · target impact"
      title={<>The plant runs longer.<br /><span className="text-[#fbbf24]">The team runs lighter.</span></>}
      lead="Projected impact of the OREON operating model on a steel plant of this scale. Figures are modelled targets, not audited results from a live deployment."
    >
      <div className="hairline">
        {rows.map(([k, v, sub], i) => (
          <Reveal key={k} delay={i * 0.05}>
            <div className="grid grid-cols-[60px_1.4fr_160px_2fr] items-center gap-6 border-b border-[var(--hairline)] px-6 py-6 last:border-0">
              <span className="font-mono text-[11px] text-[var(--ink-dim)]">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-[20px] leading-tight text-foreground">{k}</span>
              <span className="font-display text-[36px] leading-none text-emerald-400">{v}</span>
              <span className="text-[13px] text-[var(--ink-dim)]">{sub}</span>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ============= CLOSING ============= */
function ClosingCTA() {
  const { launch } = useLaunch();
  const fire = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    launch({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, "/command");
  };
  return (
    <section className="relative overflow-hidden border-t border-[var(--hairline)] py-32">
      <div className="relative mx-auto max-w-[1400px] px-8">
        <Reveal><div className="eyebrow">Closing statement</div></Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-6 h-display text-[56px] leading-[0.95] sm:text-[104px]">
            From reactive maintenance<br />
            <span className="text-[#fb7185]">to autonomous operations.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-12 flex flex-wrap gap-4">
            <a href="/command" onClick={fire} className="btn-solid">Enter OREON →</a>
            <Link to="/platform" className="btn-ghost">Explore the platform</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--hairline)] px-8 py-8">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-dim)]">
        <span>© OREON · Maintenance Wizard · {new Date().getFullYear()}</span>
        <div className="flex items-center gap-6">
          <Link to="/platform" className="hover:text-foreground transition-colors">Platform</Link>
          <Link to="/architecture" className="hover:text-foreground transition-colors">Architecture</Link>
          <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
        </div>
      </div>
    </footer>
  );
}
