import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Boxes,
  Search,
  Gauge,
  FlaskConical,
  Bell,
  Network,
  Sparkles,
  BookOpen,
  ChevronDown,
  Check,
  HardHat,
  Wrench,
  Shield,
  BarChart3,
  Cpu,
  Truck,
  PanelLeft,
  Radio,
  ShieldAlert,
  Lock,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useDashboard, useActiveRole, useRoleConfig } from "@/lib/api/hooks";
import { AskPalette, useAskPalette } from "@/components/oreon/ask-palette";
import { SectionErrorBoundary } from "@/components/oreon/error-boundary";

const VoiceDashboard = lazy(() => import("@/components/oreon/voice-agent/VoiceDashboard").then((m) => ({ default: m.VoiceDashboard })));
import { OreonWord } from "@/components/oreon/oreon-word";
import { useOREONContext } from "@/lib/context-store";
import { useQueryClient } from "@tanstack/react-query";

import { ASSET_DISPLAY_NAMES } from "@/lib/oreon-data";

// Restore the persisted sidebar-collapse preference exactly once per app load (see Shell).
let sidebarHydrated = false;

/** Render a header title, styling any "OREON" occurrence as the silver wordmark. */
function renderBrandTitle(title: string) {
  if (!title.includes("OREON")) return title;
  const parts = title.split("OREON");
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 && <OreonWord />}
    </span>
  ));
}

/** Map a route path to a human-friendly screen name for the voice agent. */
function friendlyPageName(pathname: string, activeRole?: string, currentTab?: string): string {
  const assetMatch = pathname.match(/^\/assets\/(.+)$/);
  if (assetMatch) {
    const id = decodeURIComponent(assetMatch[1]);
    const displayName = ASSET_DISPLAY_NAMES[id] || id;
    return `Asset ${displayName} (${id})`;
  }
  if (pathname.startsWith("/assets")) return "Asset Explorer";
  if (pathname.startsWith("/command")) return "Command Center";
  if (pathname.startsWith("/investigations")) return "Investigation Center";
  if (pathname.startsWith("/ask") || pathname.startsWith("/app/ask")) return "Ask OREON";
  if (pathname.startsWith("/decisions")) {
    if (activeRole === "reliability_engineer") return "Analytics";
    if (activeRole === "procurement_officer" || currentTab === "procurement") return "Procurement";
    if (currentTab === "reports") return "Reports";
    if (currentTab === "business-impact") return "Business Impact";
    return "Decision Center";
  }
  if (pathname.startsWith("/simulator")) return "Simulator";
  if (pathname.startsWith("/alerts")) return "Alert Center";
  if (pathname.startsWith("/twin")) return "Digital Twin";
  if (pathname.startsWith("/logbook")) return "Logbook";
  if (pathname.startsWith("/sentinel")) return "Sentinel Center";
  if (pathname.startsWith("/warroom")) return "War Room";
  return "OREON";
}

type NavItem = {
  to: string;
  label: string;
  icon: typeof Activity;
  badgeKey?: "assets" | "alerts";
  badgeTone?: "warn";
  disabled?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

/* ── Role dropdown configuration ── */
const ROLE_OPTIONS = [
  { value: "operator", label: "Operator", icon: HardHat, accent: "teal" },
  { value: "maintenance_engineer", label: "Maintenance Engineer", icon: Wrench, accent: "blue" },
  { value: "reliability_engineer", label: "Reliability Engineer", icon: Cpu, accent: "purple" },
  { value: "supervisor", label: "Supervisor", icon: Shield, accent: "orange" },
  { value: "procurement_officer", label: "Procurement Officer", icon: Truck, accent: "yellow" },
  { value: "plant_manager", label: "Plant Manager", icon: BarChart3, accent: "red" },
] as const;

const ACCENT_CLASSES: Record<string, { dot: string; text: string; ring: string; bg: string }> = {
  teal: { dot: "bg-teal-400", text: "text-teal-400", ring: "ring-teal-500/30", bg: "bg-teal-500/8" },
  blue: { dot: "bg-blue-400", text: "text-blue-400", ring: "ring-blue-500/30", bg: "bg-blue-500/8" },
  orange: { dot: "bg-orange-400", text: "text-orange-400", ring: "ring-orange-500/30", bg: "bg-orange-500/8" },
  red: { dot: "bg-red-400", text: "text-red-400", ring: "ring-red-500/30", bg: "bg-red-500/8" },
  purple: { dot: "bg-purple-400", text: "text-purple-400", ring: "ring-purple-500/30", bg: "bg-purple-500/8" },
  yellow: { dot: "bg-yellow-400", text: "text-yellow-400", ring: "ring-yellow-500/30", bg: "bg-yellow-500/8" },
};

const ALL_ROUTES = ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom", "/investigations", "/decisions", "/simulator", "/twin", "/procurement"];

const ROLE_ALLOWED_ROUTES: Record<string, string[]> = {
  operator:             ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom"],
  maintenance_engineer: ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom", "/investigations", "/simulator", "/twin"],
  // Reliability Engineer sees everything analytical — but NOT procurement (that's
  // Procurement Officer / Plant Manager only, per ITEM_ACCESS_HINT below).
  reliability_engineer: ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom", "/investigations", "/decisions", "/simulator", "/twin"],
  supervisor:           ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom", "/investigations", "/simulator", "/twin", "/decisions"],
  procurement_officer:  ["/command", "/assets", "/assets/$id", "/alerts", "/app/ask", "/logbook", "/sentinel", "/warroom", "/procurement"],
  plant_manager:        ALL_ROUTES,
};

// Tooltip shown on locked sidebar items — tells the user which role unlocks it
const ITEM_ACCESS_HINT: Record<string, string> = {
  "/investigations":              "Requires Maintenance Engineer or above",
  "/decisions":                   "Requires Supervisor, Reliability Engineer, or Plant Manager",
  "/procurement":                 "Requires Procurement Officer or Plant Manager",
  "/simulator":                   "Requires Maintenance Engineer or above",
  "/twin":                        "Requires Maintenance Engineer or above",
};

export function Shell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentTab = useRouterState({
    select: (s) => {
      const t = (s.location.search as Record<string, unknown>)?.tab;
      return typeof t === "string" ? t : undefined;
    },
  });
  const [activeRole, setActiveRole] = useActiveRole();
  const navigate = useNavigate();
  // Prevent SSR/client hydration mismatch on dynamic connection status
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Dynamic color visual identity shifts per role
  useEffect(() => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.forEach((cls) => {
        if (cls.startsWith("role-")) root.classList.remove(cls);
      });
      root.classList.add(`role-${activeRole}`);
    }
  }, [activeRole]);

  const allowedRoutes = ROLE_ALLOWED_ROUTES[activeRole] || [];
  const isPathAllowed = (path: string): boolean => {
    if (path === "/") return true;
    return allowedRoutes.some(route => {
      if (route === "/assets/$id") {
        return path.startsWith("/assets/") && path !== "/assets" && path !== "/assets/";
      }
      return path.startsWith(route.split("?")[0]);
    });
  };

  const isItemAllowed = (to: string): boolean => {
    const [path, query] = to.split("?");
    const tab = query ? new URLSearchParams(query).get("tab") : undefined;

    if (!isPathAllowed(path)) return false;

    // Decisions sub-tabs: the three valid tabs (decisions / reports /
    // business-impact) are all gated to the same roles. Any unknown tab is denied.
    if (path === "/decisions") {
      const roleOk =
        activeRole === "plant_manager" ||
        activeRole === "reliability_engineer" ||
        activeRole === "supervisor";
      if (tab && tab !== "decisions" && tab !== "reports" && tab !== "business-impact") {
        return false;
      }
      return roleOk;
    }

    return true;
  };

  const navigateToPage = (target: string) => {
    const [path, query] = target.split("?");
    const params = new URLSearchParams(query || "");
    const tab = params.get("tab");
    if (tab) {
      navigate({ to: path as any, search: { tab } as any });
    } else {
      navigate({ to: path as any });
    }
  };

  // Track last visited allowed page per role
  useEffect(() => {
    if (!mounted) return;
    const currentFullTarget = pathname + (currentTab ? `?tab=${currentTab}` : "");
    const [path] = pathname.split("?");
    if (isPathAllowed(path) && isItemAllowed(currentFullTarget)) {
      localStorage.setItem(`oreon-last-page-${activeRole}`, currentFullTarget);
    }
  }, [pathname, currentTab, activeRole, mounted]);

  // Handle automatic redirection when role switches or access is lost
  useEffect(() => {
    if (!mounted) return;

    const currentFullTarget = pathname + (currentTab ? `?tab=${currentTab}` : "");
    const [path] = pathname.split("?");

    // 1. Intercept legacy decisions?tab=procurement and redirect to /procurement if allowed
    if (path === "/decisions" && currentTab === "procurement") {
      if (isPathAllowed("/procurement")) {
        navigate({ to: "/procurement" as any });
      } else {
        navigate({ to: isPathAllowed("/decisions") ? "/decisions" : "/command" as any });
      }
      return;
    }

    // Check if the current page/tab is NOT allowed for the active role
    if (!isPathAllowed(path) || !isItemAllowed(currentFullTarget)) {
      // 1. Try to retrieve the last working page for this role from localStorage
      const lastSavedPage = localStorage.getItem(`oreon-last-page-${activeRole}`);
      if (lastSavedPage) {
        const [savedPath] = lastSavedPage.split("?");
        if (isPathAllowed(savedPath) && isItemAllowed(lastSavedPage)) {
          navigateToPage(lastSavedPage);
          return;
        }
      }

      // 2. Redirect procurement officer landing on decisions to procurement directly
      if (path === "/decisions" && activeRole === "procurement_officer") {
        navigate({ to: "/procurement" as any });
        return;
      }

      // 3. If no saved page, but we are on /decisions, try to switch to a decisions tab the role has access to
      if (path === "/decisions") {
        const possibleTabs = ["decisions", "reports", "business-impact"];
        const allowedTab = possibleTabs.find(t => {
          const itemUrl = t === "decisions" ? "/decisions" : `/decisions?tab=${t}`;
          return isItemAllowed(itemUrl);
        });
        if (allowedTab) {
          if (allowedTab === "decisions") {
            navigate({ to: "/decisions" as any });
          } else {
            navigate({ to: "/decisions" as any, search: { tab: allowedTab } as any });
          }
          return;
        }
      }

      // 3. Absolute fallback: redirect to the first allowed route for this role
      const allowed = ROLE_ALLOWED_ROUTES[activeRole] || [];
      const fallbackRoute = allowed.find(r => r !== "/assets/$id") || "/command";
      navigateToPage(fallbackRoute);
    }
  }, [activeRole, pathname, currentTab, mounted]);

  const getSidebarSections = (): NavSection[] => {
    const sections = [
      {
        title: "Operations",
        items: [
          { to: "/command", label: "Command", icon: Activity },
          { to: "/assets", label: "Assets", icon: Boxes, badgeKey: "assets" as const },
          { to: "/alerts", label: "Alerts", icon: Bell, badgeKey: "alerts" as const, badgeTone: "warn" as const },
        ]
      },
      {
        title: "Intelligence",
        items: [
          { to: "/app/ask", label: "Ask OREON", icon: Sparkles },
          { to: "/sentinel", label: "Sentinel", icon: Radio },
          { to: "/warroom", label: "War Room", icon: ShieldAlert },
          { to: "/investigations", label: "Investigate", icon: Search },
        ]
      },
      {
        title: "Analytics",
        items: [
          { to: "/twin", label: "Digital Twin", icon: Network },
          { to: "/simulator", label: "Simulator", icon: FlaskConical },
          // Reports / Business Impact live as tabs inside Decisions.
          { to: "/decisions", label: "Decisions", icon: Gauge },
          // Procurement is its own destination — locked unless Procurement Officer / Plant Manager.
          { to: "/procurement", label: "Procurement", icon: Truck },
        ]
      },
      {
        title: "Records",
        items: [
          { to: "/logbook", label: "Logbook", icon: BookOpen },
        ]
      }
    ];

    // Hide Decisions completely for the Procurement Officer role
    if (activeRole === "procurement_officer") {
      sections[2].items = sections[2].items.filter(item => item.to !== "/decisions");
    }

    return sections;
  };

  const qc = useQueryClient();
  const dashboard = useDashboard();
  const critical = dashboard.data?.critical_assets.length ?? 0;
  const open = dashboard.data?.active_alerts ?? 0;
  const badgeValue = (key?: "assets" | "alerts"): number | undefined => {
    if (key === "assets") return dashboard.data?.total_assets;
    if (key === "alerts") return dashboard.data?.active_alerts || undefined;
    return undefined;
  };
  const ask = useAskPalette();

  // Feed the voice agent situational awareness: which screen + recent trail.
  const setCurrentPage = useOREONContext((s) => s.setCurrentPage);
  const pushActivity = useOREONContext((s) => s.pushActivity);
  useEffect(() => {
    const name = friendlyPageName(pathname, activeRole, currentTab);
    setCurrentPage(name);
    pushActivity(`Opened ${name}`);
  }, [pathname, activeRole, currentTab, setCurrentPage, pushActivity]);

  /* ── Custom dropdown state ── */
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const currentRole = ROLE_OPTIONS.find((r) => r.value === activeRole) ?? ROLE_OPTIONS[0];
  const currentAccent = ACCENT_CLASSES[currentRole.accent] ?? ACCENT_CLASSES.cyan;

  const shortageCount = dashboard.data?.spare_shortages?.length ?? 0;
  const predictedFailures = dashboard.data?.predicted_failures?.length ?? 0;
  const avgHealth = dashboard.data?.avg_plant_health ?? 0;

  const renderRoleStatus = () => {
    if (!dashboard.data) return null;
    let label = "";
    switch (activeRole) {
      case "plant_manager":
        label = critical > 0 ? `${critical} Critical Asset${critical > 1 ? "s" : ""}` : "Plant Nominal";
        break;
      case "supervisor":
        label = open > 0 ? `${open} Open Alert${open > 1 ? "s" : ""}` : "No Open Alerts";
        break;
      case "maintenance_engineer":
        label = critical > 0 ? `${critical} Repair${critical > 1 ? "s" : ""} Pending` : "All Assets Stable";
        break;
      case "reliability_engineer":
        label = predictedFailures > 0 ? `${predictedFailures} Failure${predictedFailures > 1 ? "s" : ""} Predicted` : "No Failures Predicted";
        break;
      case "procurement_officer":
        label = shortageCount > 0 ? `${shortageCount} Part Shortage${shortageCount > 1 ? "s" : ""}` : "Stock Adequate";
        break;
      case "operator":
      default:
        label = `Plant Health: ${Math.round(avgHealth)}%`;
        break;
    }

    return (
      <span
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-mono transition-colors duration-200"
        style={{
          borderColor: "color-mix(in oklch, var(--primary) 30%, transparent)",
          backgroundColor: "color-mix(in oklch, var(--primary) 10%, transparent)",
          color: "var(--primary)"
        }}
      >
        {label}
      </span>
    );
  };

  const CurrentIcon = currentRole.icon;

  /* ── Sidebar collapse state ── */
  const sidebarCollapsed = useOREONContext((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useOREONContext((s) => s.setSidebarCollapsed);

  // Restore the saved collapse preference after mount. The store initializes to a
  // deterministic default so the first client render matches the server (no hydration
  // mismatch); we apply localStorage here, once, on the first Shell to mount.
  useEffect(() => {
    if (sidebarHydrated) return;
    sidebarHydrated = true;
    if (typeof window !== "undefined" && localStorage.getItem("oreon-sidebar-collapsed") === "true") {
      setSidebarCollapsed(true);
    }
  }, [setSidebarCollapsed]);

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <AskPalette {...ask} />
      {/* Sidebar — icon rail when collapsed, full labels when expanded */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 52 : 200 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="shrink-0 bg-sidebar flex flex-col overflow-hidden border-r border-border"
        style={{ minWidth: 0 }}
      >
        {/* Logo row:
            • Collapsed → entire row is the expand button (logo as affordance)
            • Expanded  → logo link + PanelLeft collapse button */}
        {sidebarCollapsed ? (
          /* Collapsed: logo = expand button, icon visible on hover only */
          <button
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar"
            className="h-11 w-full shrink-0 flex items-center justify-center border-b border-sidebar-border transition-colors group relative"
          >
            <img src="/logo.png" alt="OREON Logo" className="size-5 object-contain" />
            {/* Expand icon overlay — appears on hover */}
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-surface-1/70 backdrop-blur-[2px]">
              <PanelLeft className="size-4 text-foreground" strokeWidth={1.5} />
            </span>
          </button>
        ) : (
          /* Expanded: logo link + collapse icon that fades in on hover */
          <div className="h-11 shrink-0 flex items-center justify-between px-3 border-b border-sidebar-border group">
            <Link to="/" className="flex items-center gap-2.5 min-w-0">
              <img src="/logo.png" alt="OREON Logo" className="size-[26px] object-contain shrink-0" />
              <div className="flex flex-col">
                <OreonWord className="text-[14px] font-semibold tracking-tight leading-none whitespace-nowrap" />
                <span className="text-[8px] font-medium tracking-[0.05em] text-text-muted mt-0.5 whitespace-nowrap uppercase">Maintenance Wizard</span>
              </div>
            </Link>
            <button
              onClick={(e) => { e.preventDefault(); setSidebarCollapsed(true); }}
              title="Collapse sidebar"
              className="size-7 shrink-0 flex items-center justify-center rounded-md text-text-muted hover:text-foreground transition-all hover:bg-surface-1"
            >
              <PanelLeft className="size-[15px]" strokeWidth={1.5} />
            </button>
          </div>
        )}

        <nav className={`flex-1 py-3 overflow-y-auto ${sidebarCollapsed ? "px-1.5" : "px-2"} space-y-4`}>
          {getSidebarSections().map((section, sectionIdx) => (
            <div key={section.title} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-3 mb-1.5 text-[9px] font-mono font-bold tracking-[0.15em] text-text-muted select-none uppercase">
                  {section.title}
                </div>
              )}
              {sidebarCollapsed && sectionIdx > 0 && (
                <div className="h-2" />
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const [itemPath, itemQuery] = item.to.split("?");
                  const itemTab = itemQuery ? new URLSearchParams(itemQuery).get("tab") ?? undefined : undefined;
                  const onPath = pathname.startsWith(itemPath);
                  const active = itemTab
                    ? onPath && currentTab === itemTab
                    : itemPath === "/decisions"
                      ? onPath && !currentTab
                      : onPath;
                  const Icon = item.icon;
                  const badge = "badgeKey" in item ? badgeValue(item.badgeKey) : undefined;
                  const badgeTone = "badgeTone" in item ? item.badgeTone : undefined;
                  const linkProps = itemTab
                    ? { to: itemPath as never, search: { tab: itemTab } as never }
                    : { to: itemPath as never };

                  const isAllowed = isItemAllowed(item.to);
                  const lockHint = !isAllowed
                    ? (ITEM_ACCESS_HINT[item.to] ?? "Requires a different role")
                    : undefined;

                  const navContent = (
                    <div className={`
                      relative flex items-center h-9 rounded-[4px] transition-all duration-150
                      ${sidebarCollapsed ? "justify-center px-0" : "gap-2.5 pl-3 pr-2"}
                      ${active && isAllowed
                        ? "text-foreground bg-[color-mix(in_oklch,var(--primary)_8%,transparent)] font-medium"
                        : isAllowed
                          ? "text-text-secondary hover:text-foreground hover:bg-[color-mix(in_oklch,var(--primary)_4%,transparent)]"
                          : "text-text-secondary/40"
                      }
                    `}>
                      {active && isAllowed && (
                        <motion.span
                          layoutId="oreon-nav"
                          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                          style={{ backgroundColor: "var(--primary)", filter: "drop-shadow(0 0 4px var(--primary))" }}
                        />
                      )}
                      {item.to === "/app/ask" ? (
                        <img
                          src="/logo.png"
                          alt=""
                          className="size-4 shrink-0 object-contain"
                        />
                      ) : (
                        <Icon
                          className="size-4 shrink-0 transition-all duration-150"
                          style={{ color: active && isAllowed ? (item.label === "Ask" ? "oklch(0.72 0.15 295)" : "var(--primary)") : undefined }}
                          strokeWidth={1.5}
                        />
                      )}
                      {!sidebarCollapsed && (
                        <span className="text-[13px] flex-1 truncate">
                          {item.to === "/app/ask" ? <>Ask <OreonWord /></> : item.label}
                        </span>
                      )}
                      {!isAllowed ? (
                        <Lock className="size-3 text-text-muted/40 shrink-0" strokeWidth={2} />
                      ) : !sidebarCollapsed && badge ? (
                        <span className={`text-[10px] font-mono px-1.5 h-[18px] rounded-full inline-flex items-center ${badgeTone === "warn" ? "bg-warn/15 text-warn" : "bg-surface-2 text-text-secondary"}`}>{badge}</span>
                      ) : null}
                    </div>
                  );

                  return isAllowed ? (
                    <Link
                      key={item.to}
                      {...linkProps}
                      title={sidebarCollapsed ? item.label : undefined}
                      className="block"
                      onClick={(e) => {
                        if (item.to === "/app/ask" && pathname === "/app/ask") {
                          window.dispatchEvent(new Event("oreon:new-chat"));
                        }
                      }}
                    >
                      {navContent}
                    </Link>
                  ) : (
                    <div
                      key={item.to}
                      title={lockHint}
                      className="block cursor-not-allowed select-none"
                      aria-disabled="true"
                    >
                      {navContent}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </motion.aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="relative z-40 h-11 border-b border-border flex items-center justify-between px-5 bg-surface-1/40 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <span className="text-[13px] font-medium">{renderBrandTitle(title)}</span>
            {subtitle && <span className="text-[12px] text-text-muted">{subtitle}</span>}
          </div>
          <div className="flex items-center gap-3">
            {/* ── OREON Voice trigger — rotating logo with the active role's glow ── */}
            {pathname !== "/twin" && pathname !== "/app/ask" && (
              <button
                onClick={() => window.dispatchEvent(new Event("oreon:voice"))}
                title="Talk to OREON — Voice"
                className="group relative inline-flex items-center gap-2 h-8 pl-2 pr-3 rounded-lg border border-border bg-surface-2 hover:bg-surface-2/80 transition-colors cursor-pointer"
              >
                <span className="relative flex size-5 items-center justify-center">
                  <img
                    src="/logo.png"
                    alt=""
                    className="relative size-4 object-contain"
                    style={{ animation: "oreon-spin 9s linear infinite" }}
                  />
                </span>
                <span className="text-[12px] font-medium text-foreground"><OreonWord /> Voice</span>
              </button>
            )}
            {/* ── Custom Role Dropdown ── */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="inline-flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border border-border bg-surface-2 hover:bg-surface-2/80 transition-all duration-150 cursor-pointer focus:outline-none focus:ring-1"
                style={{
                  outlineColor: "color-mix(in oklch, var(--primary) 30%, transparent)"
                }}
              >
                <span
                  className="size-5 rounded-md flex items-center justify-center transition-colors duration-200"
                  style={{
                    backgroundColor: "color-mix(in oklch, var(--primary) 10%, transparent)"
                  }}
                >
                  <CurrentIcon
                    className="size-3 transition-colors duration-200"
                    style={{ color: "var(--primary)" }}
                    strokeWidth={2}
                  />
                </span>
                <span className="text-[12px] font-medium text-foreground">{currentRole.label}</span>
                <ChevronDown className={`size-3.5 text-text-muted transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-lg border border-border bg-surface-1 shadow-xl shadow-black/30 overflow-hidden"
                  >
                    <div className="px-3 pt-2.5 pb-1.5">
                      <span className="text-[10px] font-medium tracking-[0.1em] uppercase text-text-muted">Switch Role</span>
                    </div>
                    <div className="px-1 pb-1.5">
                      {ROLE_OPTIONS.map((role) => {
                        const isActive = role.value === activeRole;
                        const accent = ACCENT_CLASSES[role.accent];
                        const Icon = role.icon;
                        return (
                          <button
                            key={role.value}
                            onClick={() => {
                              setActiveRole(role.value as any);
                              qc.invalidateQueries();
                              setDropdownOpen(false);
                            }}
                            className={`
                              w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md
                              transition-all duration-100 cursor-pointer
                              ${isActive
                                ? `bg-surface-2 ${accent.text}`
                                : "text-text-secondary hover:text-foreground hover:bg-surface-2/60"
                              }
                            `}
                          >
                            <span className={`size-5 rounded-md flex items-center justify-center shrink-0 ${isActive ? accent.bg : "bg-surface-2"}`}>
                              <Icon className={`size-3 ${isActive ? accent.text : "text-text-muted"}`} strokeWidth={1.8} />
                            </span>
                            <span className="text-[12px] font-medium flex-1 text-left">{role.label}</span>
                            {isActive && (
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className={`size-4 rounded-full flex items-center justify-center ${accent.bg}`}
                              >
                                <Check className={`size-2.5 ${accent.text}`} strokeWidth={2.5} />
                              </motion.span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">
          {isPathAllowed(pathname) ? (
            <SectionErrorBoundary section={title}>{children}</SectionErrorBoundary>
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-background">
              <div className="max-w-md w-full p-8 rounded-xl border border-crit/20 bg-surface-1/40 backdrop-blur-md text-center space-y-6">
                <div className="size-16 rounded-full bg-crit/15 border border-crit/30 flex items-center justify-center mx-auto text-crit">
                  <ShieldAlert className="size-8" strokeWidth={1.5} />
                </div>
                <div className="space-y-2">
                  <h1 className="font-mono text-[10px] tracking-[0.2em] text-crit uppercase">ACCESS DENIED</h1>
                  <h2 className="display text-[26px] text-foreground font-semibold leading-tight">Insufficient Privileges</h2>
                  <p className="text-[13.5px] text-text-secondary leading-relaxed">
                    Your active role <span className="font-mono text-foreground font-semibold uppercase">{activeRole.replace("_", " ")}</span> is not authorized to access the requested screen: <span className="font-mono text-foreground">{pathname}</span>.
                  </p>
                </div>
                <div className="h-px bg-border/60" />
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      window.location.href = "/command";
                    }}
                    className="w-full h-11 rounded bg-foreground text-background font-mono text-[11px] uppercase tracking-wider font-semibold hover:bg-foreground/90 transition-colors cursor-pointer"
                  >
                    Return to Command Center
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Autonomous voice agent — hide on ask page (mic is integrated into chat input there) */}
      {pathname !== "/twin" && pathname !== "/app/ask" && (
        <Suspense fallback={null}>
          <VoiceDashboard />
        </Suspense>
      )}
    </div>
  );
}

export function PanelHeader({ label, code, action }: { label: string; code?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 h-9 border-b border-border">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-text-secondary">{label}</span>
      </div>
      {action}
    </div>
  );
}