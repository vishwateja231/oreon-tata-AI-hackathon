import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";

/* The real OREON plant dependency graph, floating in 3D.
   Signal pulses travel the edges — the plant's data flow, alive. */

type NodeDef = { id: string; label: string; pos: [number, number, number]; s: "ok" | "warn" | "crit" };

const NODES: NodeDef[] = [
  { id: "crusher", label: "Crusher", pos: [-2.5, 0.9, -0.4], s: "ok" },
  { id: "motor", label: "Motor", pos: [-2.5, -0.4, 0.5], s: "ok" },
  { id: "pump", label: "Pump", pos: [-2.5, -1.5, -0.5], s: "warn" },
  { id: "conveyor", label: "Conveyor", pos: [-1.15, 0.2, 0.1], s: "ok" },
  { id: "cooling", label: "Cooling", pos: [-0.95, -1.3, -0.2], s: "warn" },
  { id: "furnace", label: "Blast Furnace", pos: [0.15, 0.85, 0.25], s: "ok" },
  { id: "mill", label: "Rolling Mill", pos: [0.6, -0.75, 0.45], s: "ok" },
  { id: "fan", label: "Fan", pos: [1.45, 0.15, -0.35], s: "ok" },
  { id: "gearbox", label: "Gearbox", pos: [2.05, -1.35, 0.15], s: "crit" },
  { id: "dust", label: "Dust Collector", pos: [2.6, 1.0, 0.05], s: "ok" },
];

const EDGES: [string, string][] = [
  ["crusher", "conveyor"],
  ["motor", "conveyor"],
  ["conveyor", "furnace"],
  ["pump", "cooling"],
  ["cooling", "furnace"],
  ["cooling", "mill"],
  ["furnace", "fan"],
  ["fan", "dust"],
  ["mill", "gearbox"],
];

const COLOR = { ok: "#10b981", warn: "#f59e0b", crit: "#ef4444" } as const;
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

/* Pulse routes: each follows a chain of nodes, looping forever */
const ROUTES: string[][] = [
  ["crusher", "conveyor", "furnace", "fan", "dust"],
  ["pump", "cooling", "mill", "gearbox"],
  ["motor", "conveyor", "furnace", "fan", "dust"],
  ["cooling", "furnace", "fan", "dust"],
];

function Pulse({ route, offset, speed }: { route: string[]; offset: number; speed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const points = useMemo(() => route.map((id) => new THREE.Vector3(...byId[id].pos)), [route]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() * speed + offset) % 1;
    const segs = points.length - 1;
    const f = t * segs;
    const i = Math.min(Math.floor(f), segs - 1);
    ref.current.position.lerpVectors(points[i], points[i + 1], f - i);
    const m = ref.current.material as THREE.MeshStandardMaterial;
    m.opacity = Math.min(1, Math.sin(t * Math.PI) * 2.2);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.045, 12, 12]} />
      <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={3} transparent toneMapped={false} />
    </mesh>
  );
}

function Node({ n }: { n: NodeDef }) {
  const ref = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const c = COLOR[n.s];
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current && n.s !== "ok") {
      const m = ref.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.9 + Math.sin(t * (n.s === "crit" ? 5 : 2.6)) * 0.6;
    }
    if (ringRef.current && n.s === "crit") {
      const k = 1 + ((t * 0.9) % 1) * 0.9;
      ringRef.current.scale.setScalar(k);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - ((t * 0.9) % 1));
    }
  });
  return (
    <group position={n.pos}>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.13, 0]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.9} metalness={0.2} roughness={0.35} toneMapped={false} />
      </mesh>
      {n.s === "crit" && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.22, 0.008, 8, 40]} />
          <meshBasicMaterial color={c} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      )}
      <Html center distanceFactor={7} style={{ pointerEvents: "none" }}>
        <div style={{
          fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: "0.12em",
          color: n.s === "ok" ? "rgba(255,255,255,0.55)" : c,
          whiteSpace: "nowrap", transform: "translateY(20px)", textTransform: "uppercase",
        }}>
          {n.label}
        </div>
      </Html>
    </group>
  );
}

function Network() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.y = Math.sin(t * 0.18) * 0.32;
    group.current.rotation.x = -0.12 + Math.sin(t * 0.13) * 0.05;
  });
  return (
    <group ref={group}>
      {EDGES.map(([a, b]) => {
        const hot = byId[a].s !== "ok" || byId[b].s !== "ok";
        return (
          <Line
            key={`${a}-${b}`}
            points={[byId[a].pos, byId[b].pos]}
            color={hot ? "#7f1d1d" : "#2a2a32"}
            lineWidth={1}
            transparent
            opacity={hot ? 0.9 : 0.7}
          />
        );
      })}
      {ROUTES.map((r, i) => (
        <Pulse key={i} route={r} offset={i * 0.27} speed={0.085 + i * 0.012} />
      ))}
      {NODES.map((n) => (
        <Node key={n.id} n={n} />
      ))}
    </group>
  );
}

export function PlantNetwork3D({ className = "" }: { className?: string }) {
  // client-only guard keeps SSR of the landing page trivially safe
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className={className} aria-hidden />;

  return (
    <div className={className} aria-hidden>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0.25, 5.2], fov: 42 }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.2} />
        <pointLight position={[-4, -2, 4]} intensity={14} color="#22d3ee" />
        <Network />
      </Canvas>
    </div>
  );
}
