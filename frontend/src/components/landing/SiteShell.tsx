import { useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useLaunch } from "@/components/landing/LaunchTransition";
import { OreonWord } from "@/components/oreon/oreon-word";

/** Strip any in-app role accent class so the landing keeps its own colour scheme. */
function useResetRoleAccent() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.forEach((c) => { if (c.startsWith("role-")) root.classList.remove(c); });
  }, []);
}

export function Header() {
  useResetRoleAccent();
  const launch = useLaunch().launch;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const nav = [
    { to: "/", label: "Overview", color: "#34d399" },
    { to: "/platform", label: "Platform", color: "#a78bfa" },
    { to: "/architecture", label: "Architecture", color: "#fbbf24" },
    { to: "/about", label: "About", color: "#fb7185" },
  ] as const;
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--hairline)] bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-8">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="OREON" width={26} height={26} className="block h-[26px] w-[26px] object-contain" />
          <OreonWord className="font-display text-[15px] font-medium tracking-tight" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--ink-dim)]">
            Maintenance Wizard
          </span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((n) => {
            const active = path === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                style={active ? { color: n.color } : undefined}
                className={`relative font-mono text-[11px] uppercase tracking-[0.2em] transition ${
                  active ? "" : "text-foreground/75 hover:text-foreground"
                }`}
              >
                {active && (
                  <span
                    className="absolute -left-3 top-1/2 size-1 -translate-y-1/2 rounded-full"
                    style={{ background: n.color }}
                  />
                )}
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            launch({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, "/command");
          }}
          className="group relative hidden items-center gap-2 border border-foreground bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background transition hover:bg-transparent hover:text-foreground md:inline-flex"
        >
          <span className="h-1.5 w-1.5 bg-background transition group-hover:bg-foreground" />
          Enter OREON
          <span aria-hidden>→</span>
        </button>
      </div>
    </header>
  );
}
