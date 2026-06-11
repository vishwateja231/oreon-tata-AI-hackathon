import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — OREON" },
      { name: "description", content: "Access your OREON industrial command center." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("operator@oreon.ai");
  const [password, setPassword] = useState("demopassword");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ to: "/command" });
  };
  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="min-h-full flex flex-col justify-center px-8 py-16">
        <div className="w-full max-w-[400px] mx-auto">
          <div className="text-[14px] font-semibold tracking-[0.18em] mb-12">OREON</div>

          <div className="font-mono text-[10px] text-text-muted tracking-[0.3em] mb-4">DEMO ACCESS PORTAL</div>
          <h1 className="display text-[48px] leading-[1.0] tracking-[-0.03em]">OREON Demo Portal</h1>
          <p className="mt-4 text-[15px] text-text-secondary">Explore OREON using the pre-configured demo operator account.</p>

          <form onSubmit={submit} className="mt-10 space-y-5">
            <Field label="EMAIL" type="email" value={email} onChange={setEmail} placeholder="operator@oreon.ai" />
            <Field label="PASSWORD" type="password" value={password} onChange={setPassword} placeholder="••••••••••" />

            <label className="flex items-center gap-2.5 pt-1 cursor-pointer group">
              <input type="checkbox" className="size-4 rounded border-border bg-surface-1 accent-foreground" defaultChecked />
              <span className="text-[13px] text-text-secondary group-hover:text-foreground transition-colors">Remember this session</span>
            </label>

            <button type="submit" className="group w-full h-12 rounded-md bg-foreground text-background text-[14px] font-medium inline-flex items-center justify-center gap-2 hover:bg-foreground/90 transition-colors mt-4">
              Enter Command Center
              <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[13px] text-text-muted">Tata Steel AI Hackathon</span>
            <Link to="/" className="font-mono text-[11px] text-text-muted hover:text-foreground tracking-[0.15em] transition-colors">← BACK</Link>
          </div>

        </div>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder }: { label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] text-text-muted tracking-[0.2em]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full h-12 px-4 rounded-md border border-border bg-surface-1 text-[14px] text-foreground placeholder:text-text-muted/60 focus:outline-none focus:border-foreground/40 transition-colors"
      />
    </label>
  );
}