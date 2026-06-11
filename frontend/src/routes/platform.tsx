import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/landing/SiteShell";
import { Reveal, Stagger, StaggerItem, Section } from "@/components/landing/motion-primitives";
import { ModuleDiagram } from "@/components/landing/ModuleDiagram";
import { useLaunch } from "@/components/landing/LaunchTransition";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: "OREON Platform — Six Capabilities, One Continuous System" },
      { name: "description", content: "Sentinel monitoring, RUL prediction, evidence-grounded investigation, digital twin, scenario simulation and the operations war room — the OREON platform in depth." },
      { property: "og:title", content: "OREON · Platform" },
      { property: "og:description", content: "Six capabilities. One continuous system." },
    ],
  }),
  component: PlatformPage,
});

function PlatformPage() {
  return (
    <div className="relative h-screen overflow-y-auto bg-background pt-16 text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0 line-grid opacity-100" />
      <div className="relative z-10">
        <Header />
        <PlatformHero />
        <ModuleSection variant="sentinel" n="01" name="Sentinel Center"
          title="Autonomous monitoring across every critical asset."
          beats={[
            { t: "Continuous observation", d: "Temperature, vibration, current and pressure streamed from every critical asset in real time." },
            { t: "Anomaly classification", d: "Statistical and ML detectors classify every drift with a confidence score." },
            { t: "Auto-routing", d: "Severity and role authority decide who gets paged before the engineer notices." },
          ]}
          problem="20+ alerts per shift across dozens of assets. Operators triage from gut feel; critical signals get lost in noise."
          solution="Sentinel runs the loop — scan, detect, predict, diagnose, route — without a human in the loop."
          outcome="Mean time to investigate drops ~72%. Engineers stop chasing alerts and start running the plant."
        />
        <ModuleSection variant="reliability" n="02" name="Reliability Analytics"
          title="Predict failure before it happens."
          beats={[
            { t: "Per-asset health scoring", d: "Multi-variate health scores with drift-aware baselines tuned per failure mode." },
            { t: "RUL forecasting", d: "Random-Forest remaining-useful-life forecasts with confidence intervals, 7–30 days ahead." },
            { t: "Threshold-driven triggers", d: "Investigations launch automatically when health drops below operational threshold." },
          ]}
          problem="Engineers learn an asset is failing when production stops. By then, options have collapsed and the cost is booked."
          solution="OREON models degradation per failure mode and projects remaining useful life — days, not minutes, ahead of failure."
          outcome="Catastrophic failures fall ~51% as intervention windows open earlier and stay open longer."
        />
        <ModuleSection variant="investigation" n="03" name="Investigation Center"
          title="Evidence-grounded root cause in minutes."
          beats={[
            { t: "Evidence fusion", d: "Sensor evidence, SOPs, OEM manuals and historical incidents fused into one inspectable report." },
            { t: "Citation tracking", d: "Every claim links to its source. Every recommendation has a sourced rationale." },
            { t: "Confidence-gated trust", d: "A deterministic trust gate refuses to answer without evidence — no hallucinated conclusions." },
          ]}
          problem="Investigations stretch across hours because evidence lives in five places — SCADA, SOP binders, OEM manuals, incident PDFs, tribal knowledge."
          solution="OREON assembles every source into a single explainable report with full citations."
          outcome="Engineer time per alert drops ~60%. Every decision is traceable, every claim has a source."
        />
        <ModuleSection variant="twin" n="04" name="Plant Digital Twin"
          title="The plant as a live dependency graph."
          beats={[
            { t: "Asset dependency graph", d: "Every asset, every dependency, every flow — modeled as a first-class operational graph." },
            { t: "Live health overlay", d: "Per-asset health, RUL and risk pinned to every node in a 3D plant view, in real time." },
            { t: "Impact propagation", d: "Downstream impact of any failure scenario traced across the dependency chain." },
          ]}
          problem="A failure on a gearbox isn't a gearbox problem — it's a downstream rolling-mill, cooling-line and casting problem."
          solution="The Digital Twin maps the hierarchy, dependencies and live overlays — making cascades visible at a glance."
          outcome="Cross-asset failure cascades are anticipated before they cascade. Plant-wide awareness in seconds."
        />
        <ModuleSection variant="simulator" n="05" name="Scenario Simulator"
          title="Every decision, modelled before it's made."
          beats={[
            { t: "Lever-based inputs", d: "Maintenance delay, continued load, spare availability — every variable a modelled lever." },
            { t: "30-day projection", d: "Health degradation, propagation risk and downstream impact forecast across the window." },
            { t: "Cost surface", d: "Every scenario priced in downtime, production loss and capital exposure." },
          ]}
          problem="Maintenance delay, spare unavailability, continued load — every choice has a cost, and most are made without modelling it."
          solution="The simulator projects health, risk propagation and downstream-asset impact for any what-if scenario."
          outcome="Engineering and operations argue with the same numbers. Unplanned downtime drops ~38%."
        />
        <ModuleSection variant="warroom" n="06" name="Operations War Room"
          title="The plant, priced in real time."
          beats={[
            { t: "Threat composite", d: "Plant-wide threat level fused from health, open criticals and revenue exposure." },
            { t: "Failure countdown", d: "Top assets predicted to fail in the next 7 / 14 / 30 days, ranked by impact." },
            { t: "Active escalations", d: "Routed to the right role with full evidence attached and a full audit trail." },
          ]}
          problem="Leadership sees maintenance as a cost centre because it has no view of the exposure a single failure represents."
          solution="The War Room translates plant-wide signal into business terms — threat, exposure, predicted failures, escalations."
          outcome="Plant managers make capital and shift decisions on numbers, not narratives."
        />
        <RoleStrip />
        <Closing />
      </div>
    </div>
  );
}

/* ============= HERO ============= */
function PlatformHero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--hairline)] py-28">
      <div className="relative mx-auto max-w-[1600px] px-8">
        <Reveal>
          <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.25em] text-[var(--ink-dim)]">
            <span className="h-px w-10 bg-brand" />
            <span className="font-mono">The platform · In depth</span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h1 className="mt-8 h-display text-[56px] leading-[0.92] sm:text-[110px]">
            Six capabilities.<br />
            <span className="text-[#a78bfa]">One continuous system.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="mt-8 max-w-2xl text-[16px] leading-[1.7] text-[var(--ink-dim)]">
            Each capability runs autonomously, and each one feeds the next — detect, predict,
            investigate, visualize, simulate, command. This is the full tour.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============= MODULE SECTION ============= */
function ModuleSection({
  variant, n, name, title, beats, problem, solution, outcome,
}: {
  variant: "reliability" | "sentinel" | "warroom" | "twin" | "simulator" | "investigation";
  n: string;
  name: string;
  title: string;
  beats: { t: string; d: string }[];
  problem: string;
  solution: string;
  outcome: string;
}) {
  return (
    <Section eyebrow={`Capability ${n} · ${name}`} title={title} className="!py-20 border-b border-[var(--hairline)]">
      <Reveal>
        <ModuleDiagram variant={variant} label={`${n} · ${name}`} />
      </Reveal>

      <div className="mt-8 grid gap-px bg-[var(--hairline)] md:grid-cols-3">
        {beats.map((b, i) => (
          <Reveal key={b.t} delay={i * 0.05}>
            <div className="h-full bg-background p-6">
              <div className="flex items-center gap-3 border-b border-[var(--hairline)] pb-2.5 font-mono text-[10px] uppercase tracking-[0.3em]">
                <span className="text-brand">{String(i + 1).padStart(2, "0")}</span>
                <span className="h-px flex-1 bg-[var(--hairline)]" />
              </div>
              <h4 className="mt-4 font-display text-[18px] leading-tight text-foreground">{b.t}</h4>
              <p className="mt-2 text-[13px] leading-[1.65] text-[var(--ink-dim)]">{b.d}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-px grid gap-px bg-[var(--hairline)] md:grid-cols-3">
        {[
          ["Problem", problem, "#ef4444"],
          ["Solution", solution, "#22d3ee"],
          ["Outcome", outcome, "#10b981"],
        ].map(([k, v, c]) => (
          <div key={k as string} className="bg-background p-6">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: c as string }}>
              <span className="size-1 rounded-full" style={{ background: c as string }} />
              {k as string}
            </div>
            <p className="mt-3 text-[13.5px] leading-[1.65] text-[var(--ink-dim)]">
              {v as string}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ============= ROLE STRIP ============= */
function RoleStrip() {
  const roles = [
    { name: "Operator", obj: "Keep the line running, respond to field commands." },
    { name: "Maintenance Engineer", obj: "Execute the right work order with the right parts at the right window." },
    { name: "Reliability Engineer", obj: "Lower failure probability across the fleet." },
    { name: "Supervisor", obj: "Command the shift, allocate the team, clear escalations." },
    { name: "Procurement Officer", obj: "Right spare in stock before the failure window opens." },
    { name: "Plant Manager", obj: "Manage plant-wide business exposure and capital deployment." },
  ];
  return (
    <Section
      className="!py-20 border-b border-[var(--hairline)]"
      eyebrow="One platform · six perspectives"
      title={<>A different surface,<br /><span className="text-[var(--ink-dim)]">for every hand on the plant.</span></>}
      lead="The same intelligence, projected through six operational lenses. The sidebar, the KPIs, the actions — all of it changes with the badge."
    >
      <Stagger className="grid gap-px bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-3">
        {roles.map((r, i) => (
          <StaggerItem key={r.name} className="bg-background p-7">
            <div className="font-mono text-[11px] text-brand">{String(i + 1).padStart(2, "0")}</div>
            <h3 className="mt-4 font-display text-[22px] leading-tight">{r.name}</h3>
            <p className="mt-2 text-[13px] leading-[1.65] text-[var(--ink-dim)]">{r.obj}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  );
}

/* ============= CLOSING ============= */
function Closing() {
  const { launch } = useLaunch();
  const fire = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    launch({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, "/command");
  };
  return (
    <section className="relative overflow-hidden py-32">
      <div className="relative mx-auto max-w-[1400px] px-8">
        <Reveal><div className="eyebrow">See it live</div></Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-6 h-display text-[56px] leading-[0.95] sm:text-[96px]">
            Stop reading about it.<br />
            <span className="text-[var(--ink-dim)]">Walk the floor.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-12 flex flex-wrap gap-4">
            <a href="/command" onClick={fire} className="btn-solid">Enter OREON →</a>
            <Link to="/architecture" className="btn-ghost">System architecture</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
