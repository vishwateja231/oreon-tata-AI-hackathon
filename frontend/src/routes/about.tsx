import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/SiteShell";
import { Reveal, Stagger, StaggerItem } from "@/components/landing/motion-primitives";
import { useLaunch } from "@/components/landing/LaunchTransition";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About OREON — Origin, Meaning, Philosophy" },
      { name: "description", content: "What OREON is, what the name signifies, the philosophy behind it, and the principles guiding the Industrial Maintenance Wizard." },
      { property: "og:title", content: "About OREON" },
      { property: "og:description", content: "Origin, meaning, and philosophy behind the OREON Maintenance Wizard." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="relative h-screen overflow-y-auto bg-background pt-16 text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0 line-grid opacity-100" />
      <div className="relative z-10">
        <Header />
        <Hero />
        <NameMeaning />
        <WhatItIs />
        <Principles />
        <Origin />
        <Closing />
      </div>
    </div>
  );
}

/* ============= HERO ============= */
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-[var(--hairline)] py-32">
      <div className="relative mx-auto max-w-[1600px] px-8">
        <Reveal>
          <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.25em] text-[var(--ink-dim)]">
            <span className="h-px w-10 bg-brand" />
            <span className="font-mono">About · Origin · Philosophy</span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h1 className="mt-10 h-display text-[64px] leading-[0.92] sm:text-[140px]">
            What is<br />
            <span className="text-[#fb7185]">OREON.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="mt-10 max-w-2xl text-[16px] leading-[1.7] text-[var(--ink-dim)]">
            OREON is an autonomous industrial intelligence — a maintenance wizard built for
            the floors of heavy industry. It watches every asset, predicts every failure,
            and reasons through every decision with evidence an engineer can audit.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============= NAME ============= */
function NameMeaning() {
  const parts = [
    ["O", "Operational", "Built for live plant operations — not labs, not dashboards."],
    ["R", "Reasoning", "Every output is the terminus of a traceable evidence chain."],
    ["E", "Evidence-grounded", "No opinion without data. No recommendation without proof."],
    ["O", "Orchestrated", "Sentinel and Orchestrator agents operating as one cognitive system."],
    ["N", "Network-aware", "Reads the plant as a living dependency graph, not a list of tags."],
  ];
  return (
    <section className="border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 py-24">
        <Reveal>
          <div className="grid items-end gap-8 md:grid-cols-[1fr_auto] border-b border-[var(--hairline)] pb-12">
            <h2 className="h-display text-[40px] leading-[0.95] sm:text-[72px]">The name.</h2>
            <p className="max-w-sm text-[14px] leading-[1.7] text-[var(--ink-dim)]">
              OREON — a constructed name, drawn from the industrial core.
              Five letters. Five operating principles. One unbroken watch.
            </p>
          </div>
        </Reveal>

        <Stagger className="mt-16 grid gap-px bg-[var(--hairline)] md:grid-cols-5">
          {parts.map(([letter, word, meaning], i) => (
            <StaggerItem key={word} className="bg-background p-8">
              <div className="h-display text-[120px] leading-none" style={{ color: ["#34d399", "#2dd4bf", "#a78bfa", "#fbbf24", "#fb7185"][i] }}>{letter}</div>
              <div className="mt-6 eyebrow text-foreground">{word}</div>
              <p className="mt-3 text-[13px] leading-[1.6] text-[var(--ink-dim)]">{meaning}</p>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal delay={0.3}>
          <div className="mt-16 border-t border-[var(--hairline)] pt-12">
            <div className="eyebrow mb-8">Etymology</div>
            <div className="flex items-baseline gap-6 font-display text-[36px] leading-tight">
              <span>ORE</span>
              <span className="font-mono text-[18px] text-[var(--ink-dim)]">+</span>
              <span>ON</span>
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">ORE — Raw material</div>
                <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-dim)]">
                  Steel. Iron. The raw material that feeds heavy industry. Mining, manufacturing, smelting — the unyielding core of production where every gram matters and every minute counts.
                </p>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-dim)]">ON — Always active</div>
                <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-dim)]">
                  The furnace never sleeps. The conveyor never stops. Operations that must stay on — continuously monitored, perpetually watched, without interruption through every shift and season.
                </p>
              </div>
            </div>
            <p className="mt-8 border-l-2 border-brand pl-6 text-[16px] leading-[1.7] text-foreground">
              <span className="text-brand">Meaning:</span> The intelligence layer that keeps industrial operations always on.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============= WHAT IT IS ============= */
function WhatItIs() {
  const rows = [
    {
      eyebrow: "It is",
      title: "An autonomous maintenance intelligence.",
      body: "OREON runs continuously across every critical asset, detecting anomalies, predicting failures, building work plans, and orchestrating the response.",
    },
    {
      eyebrow: "It is not",
      title: "A dashboard. A BI layer. A monitoring tool.",
      body: "It does not wait for an engineer to query it. It acts — surfacing the right intervention to the right role before the failure window opens.",
    },
    {
      eyebrow: "It serves",
      title: "Operators, engineers, supervisors, planners.",
      body: "The same intelligence, projected through six operational lenses — each role sees only what it can act on, in the form it expects.",
    },
  ];
  return (
    <section className="border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 py-24">
        <Reveal>
          <div className="grid items-end gap-8 md:grid-cols-[1fr_auto] border-b border-[var(--hairline)] pb-12">
            <h2 className="h-display text-[40px] leading-[0.95] sm:text-[72px]">What it is.</h2>
            <p className="max-w-sm text-[14px] leading-[1.7] text-[var(--ink-dim)]">
              A short answer for the floor. A precise answer for the boardroom.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-px bg-[var(--hairline)] md:grid-cols-3">
          {rows.map((r, i) => (
            <Reveal key={r.eyebrow} delay={i * 0.08}>
              <div className="h-full bg-background p-10">
                <div className="eyebrow">{r.eyebrow}</div>
                <h3 className="mt-6 font-display text-[26px] leading-tight text-foreground">{r.title}</h3>
                <p className="mt-6 text-[14px] leading-[1.7] text-[var(--ink-dim)]">{r.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============= PRINCIPLES ============= */
function Principles() {
  const items = [
    ["Evidence before opinion", "Every conclusion ships with the data lineage that produced it."],
    ["Closed-loop autonomy", "Detect, predict, prescribe, learn — without a human in the inner loop."],
    ["Role-aware reasoning", "Output is shaped to the role consuming it, not the model producing it."],
    ["Physical first", "The plant is the source of truth. Models defer to telemetry, not the reverse."],
    ["Auditable by default", "Any decision can be replayed, inspected, contested and corrected."],
    ["Quiet by design", "Alerts only when action is required. Silence is a feature, not a gap."],
  ];
  return (
    <section className="border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 py-24">
        <Reveal>
          <div className="grid items-end gap-8 md:grid-cols-[1fr_auto] border-b border-[var(--hairline)] pb-12">
            <h2 className="h-display text-[40px] leading-[0.95] sm:text-[72px]">Principles.</h2>
            <p className="max-w-sm text-[14px] leading-[1.7] text-[var(--ink-dim)]">
              Six non-negotiables. Every product decision is measured against them.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-px bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-3">
          {items.map(([title, body], i) => (
            <Reveal key={title} delay={i * 0.05}>
              <div className="h-full bg-background p-10">
                <h3 className="font-display text-[24px] leading-tight">{title}.</h3>
                <p className="mt-4 text-[13px] leading-[1.7] text-[var(--ink-dim)]">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============= ORIGIN ============= */
function Origin() {
  return (
    <section className="border-t border-[var(--hairline)]">
      <div className="mx-auto max-w-[1600px] px-8 py-24">
        <Reveal>
          <div className="grid items-end gap-8 md:grid-cols-[1fr_auto] border-b border-[var(--hairline)] pb-12">
            <h2 className="h-display text-[40px] leading-[0.95] sm:text-[72px]">Origin.</h2>
            <p className="max-w-sm text-[14px] leading-[1.7] text-[var(--ink-dim)]">Why this exists, and the problem it answers.</p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-px bg-[var(--hairline)] lg:grid-cols-2">
          <Reveal>
            <div className="h-full bg-background p-12">
              <div className="eyebrow">The problem</div>
              <p className="mt-6 text-[18px] leading-[1.6] text-foreground">
                In heavy industry, unplanned downtime is not a cost — it is the cost.
                A single blast-furnace stop can erase a quarter of margin. And yet the
                signals are always there, buried in telemetry no human shift can read in time.
              </p>
              <p className="mt-6 text-[14px] leading-[1.7] text-[var(--ink-dim)]">
                Traditional CMMS tools log failures after they happen. Monitoring tools
                visualise tags. Neither one closes the loop. Neither one acts.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="h-full bg-background p-12">
              <div className="eyebrow">The answer</div>
              <p className="mt-6 text-[18px] leading-[1.6] text-foreground">
                Move maintenance from reactive to autonomous. Replace the dashboard with
                a reasoning system. Put the evidence chain in front of the engineer, not
                behind a query.
              </p>
              <p className="mt-6 text-[14px] leading-[1.7] text-[var(--ink-dim)]">
                OREON was built to be the layer between sensor and decision — a
                continuous, explainable, role-adapted intelligence that earns the
                trust of the plant by showing its work.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
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
    <section className="relative overflow-hidden border-t border-[var(--hairline)] py-40">
      <div className="relative mx-auto max-w-[1400px] px-8">
        <Reveal><div className="eyebrow">Continue</div></Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-6 h-display text-[64px] leading-[0.95] sm:text-[110px]">
            A watcher,<br />
            <span className="text-[var(--ink-dim)]">never blinking.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-12 flex flex-wrap gap-4">
            <a href="/command" onClick={fire} className="btn-solid">Enter OREON →</a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
