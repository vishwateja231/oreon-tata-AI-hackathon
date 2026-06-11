import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/landing/SiteShell";
import { Reveal, Stagger, StaggerItem, Section } from "@/components/landing/motion-primitives";
import { useLaunch } from "@/components/landing/LaunchTransition";
import {
  CognitionMapSVG,
  MonitoringLoopSVG,
  EvidenceChainSVG,
  TwinNetworkSVG,
  TechStackSVG,
  EndToEndFlowSVG,
} from "@/components/landing/ArchDiagrams";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "OREON — System Intelligence Architecture" },
      { name: "description", content: "How OREON thinks, reasons, monitors, predicts and decides — the operational intelligence architecture behind the Industrial Maintenance Wizard." },
      { property: "og:title", content: "OREON · System Intelligence Architecture" },
      { property: "og:description", content: "Operational intelligence architecture for industrial maintenance." },
    ],
  }),
  component: ArchPage,
});

function ArchPage() {
  return (
    <div className="relative h-screen overflow-y-auto bg-background pt-16 text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0 line-grid opacity-100" />
      <div className="relative z-10">
        <Header />
        <ArchHero />

        <Chapter n="01" t="System cognition map" sub="The intelligence core, and the engines that orbit it.">
          <Section eyebrow="Section 01 · Cognition" title="How OREON is organised."
            lead="One reasoning core. Eight cognitive engines. A single operational intelligence map — not an infrastructure diagram.">
            <CognitionMapSVG />
          </Section>
        </Chapter>

        <Chapter n="02" t="Autonomous monitoring loop" sub="The watch that never sleeps.">
          <Section eyebrow="Section 02 · Monitoring" title="How OREON monitors."
            lead="A closed-loop lifecycle — every stage runs continuously, and the feedback returns to recalibrate the loop.">
            <MonitoringLoopSVG />
          </Section>
        </Chapter>

        <Chapter n="03" t="Dual agent architecture" sub="Two agents. One operating model.">
          <Section eyebrow="Section 03 · Agents" title="How OREON acts."
            lead="Sentinel watches the plant. Orchestrator reasons for the engineer. Both share the same evidence substrate.">
            <DualAgentSplit />
          </Section>
        </Chapter>

        <Chapter n="04" t="Explainable AI engine" sub="No opinion without evidence.">
          <Section eyebrow="Section 04 · Reasoning" title="How OREON explains."
            lead="Every recommendation is the terminus of an evidence chain. Inspect any link — the chain holds.">
            <EvidenceChainSVG />
          </Section>
        </Chapter>

        <Chapter n="05" t="Role intelligence" sub="Six roles. Six surfaces. One platform.">
          <Section eyebrow="Section 05 · Roles" title="How OREON adapts."
            lead="The same intelligence, projected through six operational lenses — each role sees what it can act on.">
            <RoleCards />
          </Section>
        </Chapter>

        <Chapter n="06" t="Digital twin intelligence" sub="The plant as a dependency network.">
          <Section eyebrow="Section 06 · Twin" title="How OREON sees the plant."
            lead="A live operational graph. Asset relationships, impact propagation, failure chains and business-impact flow — visible at a glance.">
            <TwinNetworkSVG />
          </Section>
        </Chapter>

        <Chapter n="07" t="Technology stack" sub="The substrate beneath every layer.">
          <Section eyebrow="Section 07 · Stack" title="What OREON is built on."
            lead="Five layers, every component chosen for an industrial deployment posture. Read top-down — the surface to the substrate.">
            <TechStackSVG />
          </Section>
        </Chapter>

        <Chapter n="08" t="End-to-end data flow" sub="Plant signal in. Plant decision out.">
          <Section eyebrow="Section 08 · Flow" title="How OREON closes the loop."
            lead="Inputs converge into the reasoning pipeline. Outcomes diverge into alerts, decisions and learning. The loop closes — and tightens.">
            <EndToEndFlowSVG />
          </Section>
        </Chapter>

        <ClosingArch />
      </div>
    </div>
  );
}

/* ============= CHAPTER WRAPPER ============= */
function Chapter({ n, t, sub, children }: { n: string; t: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 pt-24">
        <Reveal>
          <div className="grid items-end gap-8 md:grid-cols-[180px_1fr_auto] border-b border-[var(--hairline)] pb-12">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
              Section {n}
            </div>
            <h2 className="h-display text-[40px] leading-[0.95] sm:text-[72px]">{t}.</h2>
            <p className="max-w-sm text-[14px] leading-[1.7] text-[var(--ink-dim)]">{sub}</p>
          </div>
        </Reveal>
      </div>
      {children}
    </section>
  );
}

/* ============= HERO ============= */
function ArchHero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--hairline)] py-32">
      <div className="relative mx-auto max-w-[1600px] px-8">
        <Reveal>
          <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.25em] text-[var(--ink-dim)]">
            <span className="h-px w-10 bg-brand" />
            <span className="font-mono">System intelligence architecture · As built</span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h1 className="mt-10 h-display text-[64px] leading-[0.92] sm:text-[120px]">
            How OREON<br />
            <span className="text-[#fbbf24]">thinks.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="mt-10 max-w-2xl text-[16px] leading-[1.7] text-[var(--ink-dim)]">
            The operational intelligence architecture behind the OREON Maintenance Wizard.
            How it monitors. How it reasons. How it predicts. How it decides.
          </p>
        </Reveal>

        <Stagger className="mt-20 grid gap-px bg-[var(--hairline)] md:grid-cols-4">
          {[
            ["Cognitive engines", "08"],
            ["Loop stages", "09"],
            ["Stack layers", "05"],
            ["Operational roles", "06"],
          ].map(([k, v]) => (
            <StaggerItem key={k} className="bg-background p-8">
              <div className="eyebrow">{k}</div>
              <div className="mt-4 h-display text-[56px] leading-none text-brand">{v}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

/* ============= SECTION 03 — DUAL AGENT ============= */
function DualAgentSplit() {
  const agents = [
    {
      name: "OREON Sentinel",
      tag: "Agent · A1",
      purpose: "Continuous monitoring",
      role: "Operates autonomously on every critical asset, every second of every shift.",
      responsibilities: [
        "Detect anomalies",
        "Predict failures",
        "Launch investigations",
        "Generate alerts",
        "Create maintenance plans",
        "Route tasks",
      ],
    },
    {
      name: "OREON Orchestrator",
      tag: "Agent · A2",
      purpose: "Industrial reasoning",
      role: "Answers engineer queries with role-adapted, evidence-grounded reasoning.",
      responsibilities: [
        "Understand queries",
        "Select tools",
        "Collect evidence",
        "Build explanations",
        "Generate recommendations",
        "Adapt to user role",
      ],
    },
  ];
  return (
    <div className="grid gap-px bg-[var(--hairline)] lg:grid-cols-2">
      {agents.map((a, idx) => (
        <Reveal key={a.name} delay={idx * 0.1}>
          <div className="relative h-full bg-background p-10">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-4 font-mono text-[10px] uppercase tracking-[0.3em]">
              <span className="text-[var(--ink-dim)]">{a.tag}</span>
              <span className="flex items-center gap-2 text-brand">
                <span className="size-1 animate-pulse rounded-full bg-brand" />
                {idx === 0 ? "AUTONOMOUS" : "INTERACTIVE"}
              </span>
            </div>
            <h3 className="mt-8 h-display text-[44px] leading-[0.95]">{a.name}.</h3>
            <div className="mt-6 eyebrow">Purpose</div>
            <div className="mt-2 font-display text-[22px]">{a.purpose}</div>
            <p className="mt-6 max-w-md text-[14px] leading-[1.7] text-[var(--ink-dim)]">{a.role}</p>
            <div className="mt-10 eyebrow">Responsibilities</div>
            <ul className="mt-4 grid gap-2">
              {a.responsibilities.map((r, i) => (
                <li key={r} className="grid grid-cols-[40px_1fr] items-baseline gap-3 border-l border-[var(--hairline)] pl-4 py-1">
                  <span className="font-mono text-[10px] text-[var(--ink-dim)]">R·{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-mono text-[12px] text-foreground">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ============= SECTION 05 — ROLE CARDS ============= */
function RoleCards() {
  const roles = [
    {
      name: "Operator",
      inputs: ["Live alarms", "Round logs", "Shift instructions"],
      recs: ["Field actions", "Containment steps"],
      actions: ["Acknowledge alerts", "Log observations"],
    },
    {
      name: "Maintenance Engineer",
      inputs: ["Asset health", "RUL forecasts", "SOP references"],
      recs: ["Work orders", "Spare reservations"],
      actions: ["Execute work order", "Close evidence"],
    },
    {
      name: "Reliability Engineer",
      inputs: ["Failure history", "Degradation curves", "Cause patterns"],
      recs: ["Threshold tuning", "Root-cause initiatives"],
      actions: ["Re-baseline", "Approve model updates"],
    },
    {
      name: "Supervisor",
      inputs: ["Open criticals", "Crew load", "Shift exposure"],
      recs: ["Crew allocation", "Window selection"],
      actions: ["Reassign tasks", "Escalate to manager"],
    },
    {
      name: "Procurement Officer",
      inputs: ["Spare demand", "Vendor lead times", "Forecast windows"],
      recs: ["Purchase orders", "Stock buffers"],
      actions: ["Raise PO", "Lock vendor SLA"],
    },
    {
      name: "Plant Manager",
      inputs: ["Plant threat level", "Revenue exposure", "Top-risk assets"],
      recs: ["Capital decisions", "Cross-line tradeoffs"],
      actions: ["Approve capex", "Set policy"],
    },
  ];
  return (
    <div className="grid gap-px bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-3">
      {roles.map((r, i) => (
        <Reveal key={r.name} delay={i * 0.05}>
          <div className="relative h-full bg-background p-8">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">
              <span>Role · {String(i + 1).padStart(2, "0")}</span>
              <span>OREON</span>
            </div>
            <h3 className="mt-6 h-display text-[28px] leading-tight">{r.name}.</h3>
            <RoleBlock title="Inputs seen" items={r.inputs} />
            <RoleBlock title="Recommendations" items={r.recs} />
            <RoleBlock title="Actions available" items={r.actions} />
          </div>
        </Reveal>
      ))}
    </div>
  );
}
function RoleBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-6">
      <div className="eyebrow">{title}</div>
      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li key={it} className="border-l border-[var(--hairline)] pl-3 font-mono text-[12px] text-foreground">{it}</li>
        ))}
      </ul>
    </div>
  );
}

/* ============= CLOSING ============= */
function ClosingArch() {
  const { launch } = useLaunch();
  const fire = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    launch({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, "/command");
  };
  return (
    <section className="relative overflow-hidden border-t border-[var(--hairline)] py-40">
      <div className="relative mx-auto max-w-[1400px] px-8">
        <Reveal><div className="eyebrow">Operating manual</div></Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-6 h-display text-[64px] leading-[0.95] sm:text-[110px]">
            Built for the floor.<br />
            <span className="text-[var(--ink-dim)]">Engineered for the plant.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-12 flex flex-wrap gap-4">
            <a href="/command" onClick={fire} className="btn-solid">Enter OREON →</a>
            <Link to="/about" className="btn-ghost">About OREON →</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
