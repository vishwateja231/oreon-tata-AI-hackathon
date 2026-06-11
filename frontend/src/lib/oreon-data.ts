import type { AssetResponse, AssetStatus, AssetSummary } from "./api/types";
import { 
  Flame, 
  Wind, 
  Settings, 
  Droplets, 
  ArrowRightLeft, 
  Activity, 
  Hammer, 
  Layers, 
  Cpu, 
  Trash2 
} from "lucide-react";

export type Status = "healthy" | "warning" | "critical";

export interface Asset {
  id: string;
  name: string;
  type:
    | "Motor"
    | "Conveyor"
    | "Blast Furnace"
    | "Cooling System"
    | "Pump"
    | "Fan"
    | "Gearbox"
    | "Crusher"
    | "Dust Collector"
    | "Rolling Mill";
  zone: string;
  health: number;
  risk: number;
  rul: number; // days
  status: Status;
  temperature: number;
  vibration: number;
  load: number;
  dependencies: string[];
  position: [number, number];
  criticality: string;
  equipmentType: string;
  image: string;
  icon: any;
}

/** Map a backend asset status onto the UI's 3-state model. */
export function statusFromBackend(status: AssetStatus | string): Status {
  switch (status) {
    case "operational":
      return "healthy";
    case "critical":
    case "offline":
      return "critical";
    default:
      // degraded, maintenance, unknown
      return "warning";
  }
}

const TYPE_KEYWORDS: [RegExp, Asset["type"]][] = [
  [/blast|furnace/i, "Blast Furnace"],
  [/cool/i, "Cooling System"],
  [/conveyor/i, "Conveyor"],
  [/pump/i, "Pump"],
  [/fan/i, "Fan"],
  [/gear/i, "Gearbox"],
  [/crusher/i, "Crusher"],
  [/dust|collector/i, "Dust Collector"],
  [/roll|mill/i, "Rolling Mill"],
  [/motor/i, "Motor"],
];

function mapType(equipmentType: string): Asset["type"] {
  for (const [re, t] of TYPE_KEYWORDS) if (re.test(equipmentType)) return t;
  return "Motor";
}

/** Stable 0..1 hash from a string id (deterministic across renders/reloads). */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export const ASSET_DISPLAY_NAMES: Record<string, string> = {
  "Motor_M12": "Main Rolling Mill Drive",
  "Pump_P3": "Blast Furnace Cooling Pump",
  "Conveyor_C7": "Raw Ore Belt Conveyor",
  "BlastFurnace_BF2": "Blast Furnace Hearth #2",
  "CoolingSystem_C1": "Closed-Loop Cooling Tower",
  "Fan_F2": "Induced Draft Combustion Fan",
  "RollingMill_RM1": "Hot Strip Rolling Mill",
  "Gearbox_G1": "Main Reduction Gearbox",
  "Crusher_CR1": "Primary Ore Crusher",
  "DustCollector_DC1": "Baghouse Dust Collector",
};

export const ASSET_VISUALS: Record<Asset["type"], { icon: any; color: string; image: string }> = {
  "Blast Furnace": { icon: Flame, color: "text-red-500", image: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=400&q=80" },
  "Cooling System": { icon: Droplets, color: "text-blue-400", image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=400&q=80" },
  "Conveyor": { icon: ArrowRightLeft, color: "text-amber-400", image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=400&q=80" },
  "Pump": { icon: Activity, color: "text-emerald-400", image: "https://images.unsplash.com/photo-1581093588401-f3c22d75ba21?auto=format&fit=crop&w=400&q=80" },
  "Fan": { icon: Wind, color: "text-cyan-400", image: "https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=400&q=80" },
  "Gearbox": { icon: Settings, color: "text-purple-400", image: "https://images.unsplash.com/photo-1530124560696-a83601eb7041?auto=format&fit=crop&w=400&q=80" },
  "Crusher": { icon: Hammer, color: "text-orange-400", image: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=400&q=80" },
  "Dust Collector": { icon: Trash2, color: "text-zinc-400", image: "https://images.unsplash.com/photo-1618042164219-62c820f10723?auto=format&fit=crop&w=400&q=80" },
  "Rolling Mill": { icon: Layers, color: "text-rose-400", image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=400&q=80" },
  "Motor": { icon: Cpu, color: "text-indigo-400", image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=400&q=80" },
};

const PROCESS_FLOW_POSITIONS: Record<string, [number, number]> = {
  // Step 1: Raw Material & Supply Inputs (Left side)
  "Crusher_CR1": [12, 20],
  "Motor_M12": [12, 50],
  "Pump_P3": [12, 80],

  // Step 2: Feeder & Cooler Systems (Center-Left)
  "Conveyor_C7": [32, 35],
  "CoolingSystem_C1": [32, 65],

  // Step 3: Main Production Units (Center)
  "BlastFurnace_BF2": [52, 20],
  "RollingMill_RM1": [52, 80],

  // Step 4: Final Processing & Exhaust Systems (Center-Right)
  "Fan_F2": [72, 20],
  "Gearbox_G1": [72, 80],

  // Step 5: Finished Goods & Outlets (Right side)
  "DustCollector_DC1": [92, 20],
};

export function toUiAsset(a: AssetSummary | Partial<AssetResponse>): Asset {
  const type = mapType(a.equipment_type ?? "");
  const status = statusFromBackend(a.status ?? "operational");
  const zone =
    ("location" in a && a.location) ||
    ("production_line" in a && a.production_line) ||
    "Plant Floor";

  // Derived display telemetry (see file header note).
  const r = hash01(a.id ?? a.name ?? "x");
  const timeSec = typeof window !== "undefined" ? Math.floor(Date.now() / 4000) : 0;
  const fluc = Math.sin(timeSec + r * 12); // Fluctuates between -1 and 1

  let health = Math.round(a.health_score ?? 0);
  if (health >= 90) {
    health = Math.round(91 + r * 6 + fluc * 1.2);
  } else {
    health = Math.max(10, Math.min(89, Math.round(health + fluc * 1.5)));
  }

  let risk = Math.round((a.failure_probability ?? 0) * 100);
  if (risk <= 10) {
    risk = Math.max(1, Math.round(3 + r * 5 - fluc * 0.8));
  } else {
    risk = Math.max(11, Math.min(99, Math.round(risk - fluc * 1.5)));
  }

  const heat = type === "Blast Furnace" ? 1400 : type === "Cooling System" ? 280 : 60;
  const temperature = Math.round(heat + (100 - health) * 1.6 + r * 30 + fluc * 1.5);
  const vibration = Number((1 + (100 - health) / 12 + r * 1.4 + fluc * 0.15).toFixed(1));
  const load = Math.min(99, Math.max(5, Math.round(55 + risk * 0.35 + r * 12 + fluc * 4)));

  const visual = ASSET_VISUALS[type] || ASSET_VISUALS["Motor"];

  return {
    id: a.id ?? "",
    name: a.name ?? a.id ?? "Unknown",
    type,
    zone: String(zone),
    health,
    risk,
    rul: Math.round(a.rul_days ?? 0),
    status,
    temperature,
    vibration,
    load,
    dependencies: [],
    position: PROCESS_FLOW_POSITIONS[a.id ?? ""] ?? [10 + hash01(a.id + "x") * 80, 10 + hash01(a.id + "y") * 80],
    criticality: a.criticality ?? "medium",
    equipmentType: a.equipment_type ?? "",
    image: visual.image,
    icon: visual.icon,
  };
}

export function statusColor(s: Status | "info") {
  return s === "critical"
    ? "text-red-signal"
    : s === "warning"
      ? "text-amber-signal"
      : s === "info"
        ? "text-electric"
        : "text-green-signal";
}
export function statusBg(s: Status | "info") {
  return s === "critical"
    ? "bg-red-signal"
    : s === "warning"
      ? "bg-amber-signal"
      : s === "info"
        ? "bg-electric"
        : "bg-green-signal";
}

