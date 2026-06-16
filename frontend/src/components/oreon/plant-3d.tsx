import { useMemo, useRef, useEffect, memo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls, Html, Grid, Box, Cylinder, Cone, Torus, Sphere,
  ContactShadows, MeshReflectorMaterial, Environment, Lightformer,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { Asset } from "@/lib/oreon-data";

export const ASSET_REVENUE_EXPOSURE: Record<string, number> = {
  "BlastFurnace_BF2": 79_00_00_000,
  "RollingMill_RM1": 62_00_00_000,
  "Gearbox_G1": 41_00_00_000,
  "Conveyor_C7": 28_00_00_000,
  "CoolingSystem_C1": 24_00_00_000,
  "Motor_M12": 18_00_00_000,
  "Pump_P3": 15_00_00_000,
  "Fan_F2": 12_00_00_000,
  "Crusher_CR1": 9_00_00_000,
  "DustCollector_DC1": 6_00_00_000,
};

export function nodeColorForMode(mode: string, a: Asset, isDownstream: boolean, isSelected: boolean): string {
  if (mode === "propagation") {
    if (isSelected) return "#22d3ee";
    if (isDownstream) return "#f43f5e";
    return "#1e293b";
  }
  if (mode === "maintenance") return a.health < 75 ? "#a78bfa" : "#22d3ee";
  if (mode === "topology") {
    switch (a.type) {
      case "Blast Furnace": return "#ef4444";
      case "Conveyor": return "#f59e0b";
      case "Rolling Mill": return "#ec4899";
      case "Pump": return "#10b981";
      case "Fan": return "#14b8a6";
      case "Gearbox": return "#8b5cf6";
      case "Crusher": return "#d97706";
      case "Dust Collector": return "#64748b";
      case "Motor": return "#3b82f6";
      case "Cooling System": return "#06b6d4";
      default: return "#94a3b8";
    }
  }
  if (mode === "health") return a.health < 50 ? "#ef4444" : a.health < 75 ? "#f59e0b" : "#22d3ee";
  if (mode === "risk") return a.risk >= 60 ? "#ef4444" : a.risk >= 30 ? "#f59e0b" : "#22d3ee";
  if (mode === "rul") return a.rul < 15 ? "#ef4444" : a.rul <= 60 ? "#f59e0b" : "#22d3ee";
  if (mode === "business") {
    const exp = ASSET_REVENUE_EXPOSURE[a.id] ?? 0;
    return exp >= 50_00_00_000 ? "#ef4444" : exp >= 15_00_00_000 ? "#f59e0b" : "#22d3ee";
  }
  return "#22d3ee";
}

const FLOOR_Y = -4.5;

/* ─── Realistic industrial material palette (machines stay neutral; status lives in accents) ─── */
const MAT = {
  paint: { color: "#46525f", roughness: 0.5, metalness: 0.55, envMapIntensity: 0.9 },
  paintDark: { color: "#323b46", roughness: 0.48, metalness: 0.6, envMapIntensity: 0.9 },
  paintBlue: { color: "#3b4d63", roughness: 0.5, metalness: 0.55, envMapIntensity: 0.9 },
  paintGreen: { color: "#3e5247", roughness: 0.52, metalness: 0.5, envMapIntensity: 0.85 },
  hull: { color: "#2a313b", roughness: 0.45, metalness: 0.7, envMapIntensity: 1.0 },
  steel: { color: "#9aa3ad", roughness: 0.22, metalness: 0.95, envMapIntensity: 1.3 },
  dark: { color: "#181d24", roughness: 0.5, metalness: 0.6, envMapIntensity: 0.7 },
  yellow: { color: "#c9972e", roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8 },
  rust: { color: "#6e4a33", roughness: 0.85, metalness: 0.3, envMapIntensity: 0.5 },
  concrete: { color: "#33363c", roughness: 0.95, metalness: 0.05, envMapIntensity: 0.3 },
  concreteLight: { color: "#7d838c", roughness: 0.92, metalness: 0.05, envMapIntensity: 0.35 },
  refractory: { color: "#403a35", roughness: 0.8, metalness: 0.35, envMapIntensity: 0.5 },
} as const;

/* ─── Atmospheric dust ─── */
const DustParticles = memo(function DustParticles() {
  const count = 200;
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 70;
      arr[i * 3 + 1] = FLOOR_Y + Math.random() * 16;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    return arr;
  }, []);
  const positionArgs = useMemo(() => [positions, 3] as [THREE.BufferAttribute["array"], number], [positions]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.012;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={positionArgs} />
      </bufferGeometry>
      <pointsMaterial size={0.045} color="#4b5563" transparent opacity={0.3} sizeAttenuation depthWrite={false} />
    </points>
  );
});

/* ─── Rising particle column (embers / steam / smoke) ─── */
const RisingParticles = memo(function RisingParticles({
  count = 24, radius = 0.5, height = 3.2, color, size = 0.09, opacity = 0.7, speed = 1, drift = 0.12,
  position = [0, 0, 0] as [number, number, number],
}: {
  count?: number; radius?: number; height?: number; color: string;
  size?: number; opacity?: number; speed?: number; drift?: number; position?: [number, number, number];
}) {
  const ref = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * height;
      pos[i * 3 + 2] = Math.sin(a) * r;
      vel[i] = 0.4 + Math.random() * 0.8;
    }
    return { pos, vel };
  }, [count, radius, height]);

  const positionArgs = useMemo(() => [seeds.pos.slice(), 3] as [THREE.BufferAttribute["array"], number], [seeds.pos]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const attr = ref.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += seeds.vel[i] * speed * delta;
      arr[i * 3] += Math.sin(arr[i * 3 + 1] * 2 + i) * drift * delta;
      if (arr[i * 3 + 1] > height) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = Math.sin(a) * r;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} position={position}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={positionArgs} />
      </bufferGeometry>
      <pointsMaterial size={size} color={color} transparent opacity={opacity} sizeAttenuation depthWrite={false} />
    </points>
  );
});

/* ─── Flickering furnace fire light ─── */
const FurnaceLight = memo(function FurnaceLight({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.intensity = 1.4 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.7) * 0.2;
  });
  return <pointLight ref={ref} position={position} color="#fb923c" distance={8} decay={2} />;
}, (prev, next) => prev.position[0] === next.position[0] && prev.position[1] === next.position[1] && prev.position[2] === next.position[2]);

/* ═══════════════════════ MACHINE MODELS (base sits at local y=0.35, on plinth) ═══════════════════════ */

const BlastFurnaceGeo = memo(function BlastFurnaceGeo() {
  return (
    <group position={[0, 0.35, 0]}>
      {/* support legs */}
      {[45, 135, 225, 315].map((deg) => (
        <Box key={deg} args={[0.28, 1.1, 0.28]} position={[Math.cos((deg * Math.PI) / 180) * 1.75, 0.55, Math.sin((deg * Math.PI) / 180) * 1.75]}>
          <meshStandardMaterial {...MAT.dark} />
        </Box>
      ))}
      {/* hearth */}
      <Cylinder args={[1.55, 1.65, 1.3, 28]} position={[0, 0.95, 0]}>
        <meshStandardMaterial {...MAT.refractory} />
      </Cylinder>
      {/* taphole glow */}
      <Cylinder args={[1.57, 1.57, 0.16, 28]} position={[0, 0.62, 0]}>
        <meshStandardMaterial color="#ff5e0a" emissive="#ff5e0a" emissiveIntensity={2.2} roughness={0.5} />
      </Cylinder>
      {/* bosh (widens) */}
      <Cylinder args={[1.95, 1.55, 1.2, 28]} position={[0, 2.2, 0]}>
        <meshStandardMaterial {...MAT.hull} />
      </Cylinder>
      {/* stack (tapers) */}
      <Cylinder args={[1.2, 1.95, 3.4, 28]} position={[0, 4.5, 0]}>
        <meshStandardMaterial {...MAT.hull} />
      </Cylinder>
      {/* throat + top cone */}
      <Cylinder args={[1.2, 1.2, 0.8, 28]} position={[0, 6.6, 0]}>
        <meshStandardMaterial {...MAT.paintDark} />
      </Cylinder>
      <Cone args={[1.2, 0.9, 28]} position={[0, 7.45, 0]}>
        <meshStandardMaterial {...MAT.dark} />
      </Cone>
      {/* bustle pipe ring */}
      <Torus args={[1.95, 0.14, 10, 36]} position={[0, 2.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial {...MAT.steel} />
      </Torus>
      {/* stiffening rings */}
      {[3.4, 4.6, 5.8].map((y) => (
        <Torus key={y} args={[1.2 + (6.2 - y) * 0.21, 0.05, 8, 32]} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...MAT.dark} />
        </Torus>
      ))}
      {/* uptake + downcomer to dust catcher */}
      <Cylinder args={[0.22, 0.22, 1.4, 10]} position={[0.55, 7.55, 0.4]} rotation={[0.5, 0, -0.45]}>
        <meshStandardMaterial {...MAT.steel} />
      </Cylinder>
      <Cylinder args={[0.2, 0.2, 5.2, 10]} position={[1.55, 5.0, 1.0]} rotation={[0.12, 0, -0.42]}>
        <meshStandardMaterial {...MAT.steel} />
      </Cylinder>
      {/* dust catcher */}
      <Cylinder args={[0.62, 0.62, 1.6, 16]} position={[2.55, 1.6, 1.45]}>
        <meshStandardMaterial {...MAT.paintDark} />
      </Cylinder>
      <Cone args={[0.62, 0.9, 16]} position={[2.55, 0.45, 1.45]} rotation={[Math.PI, 0, 0]}>
        <meshStandardMaterial {...MAT.dark} />
      </Cone>
      {/* hot blast stoves */}
      {[-1.2, 1.2].map((z) => (
        <group key={z} position={[-2.35, 0, z]}>
          <Cylinder args={[0.68, 0.68, 3.6, 18]} position={[0, 1.85, 0]}>
            <meshStandardMaterial {...MAT.rust} />
          </Cylinder>
          <Sphere args={[0.68, 18, 12]} position={[0, 3.7, 0]}>
            <meshStandardMaterial {...MAT.rust} />
          </Sphere>
          {/* hot blast main to bustle */}
          <Cylinder args={[0.14, 0.14, 1.6, 8]} position={[0.95, 2.6, z * -0.35]} rotation={[0, 0, Math.PI / 2.6]}>
            <meshStandardMaterial {...MAT.steel} />
          </Cylinder>
        </group>
      ))}
      {/* cast house shed */}
      <Box args={[1.7, 1.1, 1.5]} position={[1.7, 0.9, -1.7]}>
        <meshStandardMaterial {...MAT.paintDark} />
      </Box>
      <Box args={[1.9, 0.12, 1.7]} position={[1.7, 1.5, -1.7]}>
        <meshStandardMaterial {...MAT.dark} />
      </Box>
      <FurnaceLight position={[0, 1.1, 0]} />
      {/* embers + smoke from the top */}
      <RisingParticles position={[0, 7.9, 0]} count={18} radius={0.3} height={2.4} color="#fb923c" size={0.07} opacity={0.8} speed={1.1} />
      <RisingParticles position={[0, 8.0, 0]} count={14} radius={0.45} height={4.5} color="#5b6470" size={0.5} opacity={0.12} speed={0.65} />
    </group>
  );
});

const CoolingTowerGeo = memo(function CoolingTowerGeo() {
  const shellPts = useMemo(() => {
    const arr: THREE.Vector2[] = [];
    for (let i = 0; i <= 18; i++) {
      const y = (i / 18) * 5.0;
      const r = 1.2 * Math.sqrt(1 + Math.pow((y - 3.3) / 2.1, 2));
      arr.push(new THREE.Vector2(r, y));
    }
    return arr;
  }, []);
  return (
    <group position={[0, 0.35, 0]}>
      {/* basin */}
      <Cylinder args={[2.35, 2.45, 0.5, 28]} position={[0, 0.25, 0]}>
        <meshStandardMaterial {...MAT.concrete} />
      </Cylinder>
      {/* support columns */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <Cylinder key={i} args={[0.06, 0.06, 0.85, 6]} position={[Math.cos(a) * 2.05, 0.9, Math.sin(a) * 2.05]} rotation={[0, 0, Math.cos(a) * 0.18]}>
            <meshStandardMaterial {...MAT.concreteLight} />
          </Cylinder>
        );
      })}
      {/* hyperboloid shell */}
      <mesh position={[0, 1.3, 0]}>
        <latheGeometry args={[shellPts, 28]} />
        <meshStandardMaterial {...MAT.concreteLight} side={THREE.DoubleSide} />
      </mesh>
      {/* rim */}
      <Torus args={[1.42, 0.06, 8, 28]} position={[0, 6.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial {...MAT.concrete} />
      </Torus>
      {/* riser pipe */}
      <Cylinder args={[0.16, 0.16, 1.6, 10]} position={[2.0, 0.9, 0.8]} rotation={[0, 0, 0.5]}>
        <meshStandardMaterial {...MAT.paintBlue} />
      </Cylinder>
      {/* steam plume */}
      <RisingParticles position={[0, 6.4, 0]} count={26} radius={0.9} height={3.8} color="#cbd5e1" size={0.55} opacity={0.12} speed={0.8} drift={0.3} />
    </group>
  );
});

const ConveyorGeo = memo(function ConveyorGeo() {
  const lumps = useRef<THREE.Group>(null);
  const pulleys = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  useFrame(({ clock }, delta) => {
    pulleys.forEach((p) => { if (p.current) p.current.rotation.y += delta * 2.4; });
    if (lumps.current) {
      const t = clock.getElapsedTime() * 0.85;
      lumps.current.children.forEach((c, i) => {
        c.position.x = ((i * 0.78 + t) % 5.4) - 2.7;
      });
    }
  });
  return (
    <group position={[0, 0.35, 0]}>
      {/* A-frame legs */}
      {[-2.2, 0, 2.2].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Box args={[0.09, 1.5, 0.09]} position={[0, 0.75, 0.55]} rotation={[0.12, 0, 0]}><meshStandardMaterial {...MAT.paint} /></Box>
          <Box args={[0.09, 1.5, 0.09]} position={[0, 0.75, -0.55]} rotation={[-0.12, 0, 0]}><meshStandardMaterial {...MAT.paint} /></Box>
          <Box args={[0.07, 0.07, 1.25]} position={[0, 0.8, 0]}><meshStandardMaterial {...MAT.paint} /></Box>
        </group>
      ))}
      {/* stringer truss */}
      <Box args={[6.0, 0.16, 0.1]} position={[0, 1.42, 0.62]}><meshStandardMaterial {...MAT.paint} /></Box>
      <Box args={[6.0, 0.16, 0.1]} position={[0, 1.42, -0.62]}><meshStandardMaterial {...MAT.paint} /></Box>
      {/* belt */}
      <Box args={[5.9, 0.08, 1.1]} position={[0, 1.55, 0]}>
        <meshStandardMaterial color="#15181d" roughness={0.85} metalness={0.2} />
      </Box>
      {/* ore lumps travelling */}
      <group ref={lumps}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[i * 0.78 - 2.7, 1.68, (i % 3 - 1) * 0.18]}>
            <dodecahedronGeometry args={[0.13 + (i % 3) * 0.03]} />
            <meshStandardMaterial color="#4a3527" roughness={0.95} metalness={0.1} />
          </mesh>
        ))}
      </group>
      {/* head / tail pulleys */}
      {[-2.95, 2.95].map((x, i) => (
        <group key={x} position={[x, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Cylinder ref={pulleys[i]} args={[0.22, 0.22, 1.2, 14]}>
            <meshStandardMaterial {...MAT.steel} />
          </Cylinder>
        </group>
      ))}
      {/* idler rollers */}
      {[-1.8, -0.6, 0.6, 1.8].map((x) => (
        <group key={x} position={[x, 1.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Cylinder args={[0.07, 0.07, 1.1, 8]}><meshStandardMaterial {...MAT.dark} /></Cylinder>
        </group>
      ))}
      {/* yellow safety railing */}
      <Box args={[6.0, 0.05, 0.05]} position={[0, 2.05, 0.72]}><meshStandardMaterial {...MAT.yellow} /></Box>
      {[-2.6, -1.3, 0, 1.3, 2.6].map((x) => (
        <Box key={x} args={[0.04, 0.5, 0.04]} position={[x, 1.8, 0.72]}><meshStandardMaterial {...MAT.yellow} /></Box>
      ))}
    </group>
  );
});

const RollingMillGeo = memo(function RollingMillGeo() {
  const rolls = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const slab = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (rolls[0].current) rolls[0].current.rotation.y += delta * 1.8;
    if (rolls[1].current) rolls[1].current.rotation.y -= delta * 1.8;
    if (slab.current) slab.current.position.x = ((clock.getElapsedTime() * 1.1) % 6.0) - 3.0;
  });
  return (
    <group position={[0, 0.35, 0]}>
      {/* mill housings */}
      {[-1.15, 1.15].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Box args={[0.55, 3.1, 1.9]} position={[0, 1.55, 0]}><meshStandardMaterial {...MAT.paintGreen} /></Box>
          <Box args={[0.65, 0.3, 2.0]} position={[0, 0.15, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
        </group>
      ))}
      {/* crossbeam + screw-down */}
      <Box args={[2.85, 0.4, 1.9]} position={[0, 3.3, 0]}><meshStandardMaterial {...MAT.paintGreen} /></Box>
      <Cylinder args={[0.18, 0.18, 0.5, 10]} position={[0, 3.75, 0]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      {/* work rolls */}
      <group position={[0, 1.55, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder ref={rolls[0]} args={[0.42, 0.42, 1.85, 18]} position={[0.52, 0, 0]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
        <Cylinder ref={rolls[1]} args={[0.42, 0.42, 1.85, 18]} position={[-0.52, 0, 0]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      {/* roller tables both sides */}
      {[-2.1, -1.55, 1.55, 2.1, 2.65].map((x) => (
        <group key={x} position={[x, 0.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Cylinder args={[0.12, 0.12, 1.5, 10]}><meshStandardMaterial {...MAT.dark} /></Cylinder>
        </group>
      ))}
      <Box args={[5.8, 0.1, 0.12]} position={[0, 0.7, 0.8]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      <Box args={[5.8, 0.1, 0.12]} position={[0, 0.7, -0.8]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      {/* glowing slab passing through */}
      <Box ref={slab} args={[1.9, 0.14, 1.15]} position={[0, 1.02, 0]}>
        <meshStandardMaterial color="#ff7a1f" emissive="#ff7a1f" emissiveIntensity={2.0} roughness={0.5} />
      </Box>
    </group>
  );
});

const PumpGeo = memo(function PumpGeo() {
  const shaft = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (shaft.current) shaft.current.rotation.y += delta * 6; });
  return (
    <group position={[0, 0.35, 0]}>
      {/* baseplate */}
      <Box args={[3.2, 0.18, 1.4]} position={[0, 0.09, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
      {/* motor */}
      <group position={[-0.95, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder args={[0.45, 0.45, 1.3, 18]}><meshStandardMaterial {...MAT.paintBlue} /></Cylinder>
      </group>
      <Box args={[0.3, 0.25, 0.4]} position={[-0.95, 1.15, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
      {/* coupling guard */}
      <group position={[-0.05, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder ref={shaft} args={[0.14, 0.14, 0.5, 10]}><meshStandardMaterial {...MAT.yellow} /></Cylinder>
      </group>
      {/* volute casing */}
      <group position={[0.85, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder args={[0.55, 0.55, 0.6, 20]}><meshStandardMaterial {...MAT.paintBlue} /></Cylinder>
      </group>
      <Torus args={[0.56, 0.05, 8, 24]} position={[0.62, 0.62, 0]} rotation={[0, Math.PI / 2, 0]}><meshStandardMaterial {...MAT.steel} /></Torus>
      {/* suction inlet */}
      <group position={[1.45, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder args={[0.24, 0.3, 0.55, 12]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      {/* discharge pipe + valve */}
      <Cylinder args={[0.16, 0.16, 1.2, 10]} position={[0.85, 1.45, 0]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      <Torus args={[0.22, 0.045, 8, 16]} position={[0.85, 1.75, 0]} rotation={[Math.PI / 2, 0, 0]}><meshStandardMaterial {...MAT.yellow} /></Torus>
    </group>
  );
});

const FanGeo = memo(function FanGeo() {
  const hub = useRef<THREE.Group>(null);
  const shaft = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (hub.current) hub.current.rotation.z += delta * 4.5;
    if (shaft.current) shaft.current.rotation.y += delta * 4.5;
  });
  return (
    <group position={[0, 0.35, 0]}>
      {/* concrete base */}
      <Box args={[3.0, 0.3, 1.8]} position={[0, 0.15, 0]}><meshStandardMaterial {...MAT.concrete} /></Box>
      {/* scroll casing */}
      <group position={[0.7, 1.35, 0]}>
        <Cylinder args={[1.05, 1.05, 0.95, 26]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...MAT.paint} />
        </Cylinder>
        {/* outlet duct (tangential, going up) */}
        <Box args={[0.8, 1.4, 0.9]} position={[-0.75, 0.95, 0]}>
          <meshStandardMaterial {...MAT.paint} />
        </Box>
        <Box args={[0.92, 0.14, 1.0]} position={[-0.75, 1.72, 0]}>
          <meshStandardMaterial {...MAT.dark} />
        </Box>
        {/* inlet cone + spinning hub visible */}
        <group position={[0, 0, 0.62]}>
          <Cylinder args={[0.62, 0.78, 0.35, 20]} rotation={[Math.PI / 2, 0, 0]}>
            <meshStandardMaterial {...MAT.paintDark} />
          </Cylinder>
          <group ref={hub} position={[0, 0, 0.1]}>
            <Sphere args={[0.18, 12, 10]}><meshStandardMaterial {...MAT.steel} /></Sphere>
            {[0, 90, 180, 270].map((deg) => (
              <Box key={deg} args={[0.06, 0.5, 0.1]} position={[
                Math.cos((deg * Math.PI) / 180) * 0.3,
                Math.sin((deg * Math.PI) / 180) * 0.3, 0,
              ]} rotation={[0, 0, (deg * Math.PI) / 180]}>
                <meshStandardMaterial {...MAT.steel} />
              </Box>
            ))}
          </group>
        </group>
      </group>
      {/* drive motor + shaft */}
      <group position={[0.7, 1.35, -1.15]} rotation={[Math.PI / 2, 0, 0]}>
        <Cylinder args={[0.4, 0.4, 0.9, 16]}><meshStandardMaterial {...MAT.paintBlue} /></Cylinder>
      </group>
      <group position={[0.7, 1.35, -0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <Cylinder ref={shaft} args={[0.09, 0.09, 0.35, 8]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      {/* motor pedestal */}
      <Box args={[0.7, 0.85, 0.7]} position={[0.7, 0.7, -1.15]}><meshStandardMaterial {...MAT.dark} /></Box>
    </group>
  );
});

const GearboxGeo = memo(function GearboxGeo() {
  const inS = useRef<THREE.Mesh>(null);
  const outS = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (inS.current) inS.current.rotation.y += delta * 6;
    if (outS.current) outS.current.rotation.y += delta * 1.6;
  });
  return (
    <group position={[0, 0.35, 0]}>
      <Box args={[2.6, 0.18, 1.7]} position={[0, 0.09, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
      {/* stepped ribbed case */}
      <Box args={[2.1, 1.25, 1.35]} position={[0, 0.8, 0]}><meshStandardMaterial {...MAT.paintGreen} /></Box>
      <Box args={[1.4, 0.55, 1.2]} position={[-0.3, 1.7, 0]}><meshStandardMaterial {...MAT.paintGreen} /></Box>
      {[-0.6, -0.2, 0.2, 0.6].map((x) => (
        <Box key={x} args={[0.05, 1.35, 1.42]} position={[x, 0.8, 0]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      ))}
      {/* shafts with yellow guards */}
      <group position={[-1.35, 1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder ref={inS} args={[0.11, 0.11, 0.65, 10]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      <group position={[1.4, 0.65, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder ref={outS} args={[0.22, 0.22, 0.75, 12]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      <Box args={[0.45, 0.4, 0.55]} position={[1.45, 0.95, 0]}><meshStandardMaterial {...MAT.yellow} /></Box>
      {/* inspection hatch + breather */}
      <Cylinder args={[0.07, 0.07, 0.2, 8]} position={[0.3, 2.05, 0]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
    </group>
  );
});

const CrusherGeo = memo(function CrusherGeo() {
  const cone = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!cone.current) return;
    const t = clock.getElapsedTime() * 5;
    cone.current.rotation.x = Math.sin(t) * 0.02;
    cone.current.rotation.z = Math.cos(t) * 0.02;
  });
  return (
    <group position={[0, 0.35, 0]}>
      {/* platform legs + bracing */}
      {[[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].map(([x, z], i) => (
        <Box key={i} args={[0.18, 2.0, 0.18]} position={[x, 1.0, z]}><meshStandardMaterial {...MAT.paint} /></Box>
      ))}
      <Box args={[2.9, 0.08, 0.08]} position={[0, 1.0, 1.3]} rotation={[0, 0, 0.0]}><meshStandardMaterial {...MAT.paint} /></Box>
      <Box args={[2.9, 0.08, 0.08]} position={[0, 1.0, -1.3]}><meshStandardMaterial {...MAT.paint} /></Box>
      {/* platform deck */}
      <Box args={[3.0, 0.18, 3.0]} position={[0, 2.05, 0]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      {/* hopper (4-sided) */}
      <group rotation={[0, Math.PI / 4, 0]}>
        <Cylinder args={[1.55, 0.8, 1.3, 4]} position={[0, 2.8, 0]}>
          <meshStandardMaterial {...MAT.rust} />
        </Cylinder>
      </group>
      {/* gyrating mantle cone */}
      <group ref={cone} position={[0, 3.55, 0]}>
        <Cone args={[0.65, 1.1, 16]}>
          <meshStandardMaterial {...MAT.steel} />
        </Cone>
        {/* spider cap */}
        <Cylinder args={[0.16, 0.16, 0.35, 8]} position={[0, 0.7, 0]}><meshStandardMaterial {...MAT.dark} /></Cylinder>
      </group>
      {/* discharge chute */}
      <Cone args={[0.6, 1.0, 4]} position={[0, 1.45, 0]} rotation={[Math.PI, Math.PI / 4, 0]}>
        <meshStandardMaterial {...MAT.dark} />
      </Cone>
      {/* dust haze above hopper */}
      <RisingParticles position={[0, 3.6, 0]} count={10} radius={0.9} height={1.1} color="#8d8478" size={0.25} opacity={0.1} speed={0.45} />
    </group>
  );
});

const DustCollectorGeo = memo(function DustCollectorGeo() {
  return (
    <group position={[0, 0.35, 0]}>
      {/* legs */}
      {[[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]].map(([x, z], i) => (
        <Box key={i} args={[0.16, 1.3, 0.16]} position={[x, 0.65, z]}><meshStandardMaterial {...MAT.paint} /></Box>
      ))}
      {/* hopper cones */}
      {[-0.55, 0.55].map((x) =>
        [-0.55, 0.55].map((z) => (
          <Cone key={`${x}${z}`} args={[0.52, 0.9, 4]} position={[x, 1.45, z]} rotation={[Math.PI, Math.PI / 4, 0]}>
            <meshStandardMaterial {...MAT.paintDark} />
          </Cone>
        ))
      )}
      {/* casing */}
      <Box args={[2.4, 2.0, 2.4]} position={[0, 2.9, 0]}><meshStandardMaterial {...MAT.paintBlue} /></Box>
      {/* casing panel seams */}
      {[-0.6, 0, 0.6].map((x) => (
        <Box key={x} args={[0.04, 2.05, 2.45]} position={[x, 2.9, 0]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      ))}
      {/* clean air plenum + outlet stack */}
      <Box args={[2.5, 0.4, 2.5]} position={[0, 4.1, 0]}><meshStandardMaterial {...MAT.paintDark} /></Box>
      <Cylinder args={[0.3, 0.3, 1.6, 12]} position={[0.7, 5.1, 0.7]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      {/* pulse-jet headers */}
      {[-0.5, 0, 0.5].map((z) => (
        <Cylinder key={z} args={[0.07, 0.07, 2.2, 8]} position={[0, 4.45, z]} rotation={[0, 0, Math.PI / 2]}>
          <meshStandardMaterial {...MAT.steel} />
        </Cylinder>
      ))}
      {/* inlet duct */}
      <Cylinder args={[0.32, 0.32, 1.3, 12]} position={[-1.55, 2.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <meshStandardMaterial {...MAT.paint} />
      </Cylinder>
      {/* ladder rails */}
      <Cylinder args={[0.03, 0.03, 3.6, 6]} position={[1.28, 2.2, -0.25]}><meshStandardMaterial {...MAT.yellow} /></Cylinder>
      <Cylinder args={[0.03, 0.03, 3.6, 6]} position={[1.28, 2.2, 0.25]}><meshStandardMaterial {...MAT.yellow} /></Cylinder>
    </group>
  );
});

const MotorGeo = memo(function MotorGeo() {
  const shaft = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (shaft.current) shaft.current.rotation.y += delta * 7; });
  return (
    <group position={[0, 0.35, 0]}>
      <Box args={[2.6, 0.2, 1.5]} position={[0, 0.1, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
      {/* finned body */}
      <group position={[0, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder args={[0.62, 0.62, 1.9, 20]}><meshStandardMaterial {...MAT.paintBlue} /></Cylinder>
      </group>
      {[-0.7, -0.35, 0, 0.35, 0.7].map((x) => (
        <Torus key={x} args={[0.65, 0.03, 6, 22]} position={[x, 0.85, 0]} rotation={[0, Math.PI / 2, 0]}>
          <meshStandardMaterial {...MAT.paintDark} />
        </Torus>
      ))}
      {/* fan cowl + end bell */}
      <group position={[-1.15, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder args={[0.5, 0.62, 0.4, 20]}><meshStandardMaterial {...MAT.paintDark} /></Cylinder>
      </group>
      {/* shaft */}
      <group position={[1.25, 0.85, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Cylinder ref={shaft} args={[0.1, 0.1, 0.6, 10]}><meshStandardMaterial {...MAT.steel} /></Cylinder>
      </group>
      {/* terminal box */}
      <Box args={[0.4, 0.32, 0.45]} position={[0.2, 1.6, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
    </group>
  );
});

const MACHINE_HEIGHTS: Record<string, number> = {
  "blast furnace": 8.6, "cooling system": 6.8, "rolling mill": 4.2, "conveyor": 2.6,
  "pump": 2.3, "fan": 3.4, "gearbox": 2.6, "crusher": 4.8, "dust collector": 5.4, "motor": 2.5,
};
function machineHeight(type: string): number {
  const t = type.toLowerCase();
  for (const k of Object.keys(MACHINE_HEIGHTS)) if (t.includes(k.split(" ")[0])) return MACHINE_HEIGHTS[k];
  return 2.6;
}

const MachineModel = memo(function MachineModel({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t.includes("furnace")) return <BlastFurnaceGeo />;
  if (t.includes("cooling")) return <CoolingTowerGeo />;
  if (t.includes("conveyor")) return <ConveyorGeo />;
  if (t.includes("rolling") || t.includes("mill")) return <RollingMillGeo />;
  if (t.includes("pump")) return <PumpGeo />;
  if (t.includes("fan")) return <FanGeo />;
  if (t.includes("gearbox")) return <GearboxGeo />;
  if (t.includes("crusher")) return <CrusherGeo />;
  if (t.includes("dust") || t.includes("collector")) return <DustCollectorGeo />;
  return <MotorGeo />;
});

/* ═══════════════════════ STATUS ACCENTS (small, on the ground / a stanchion) ═══════════════════════ */

/* Concrete plinth with a thin status light-ring inset around it */
const Plinth = memo(function Plinth({ color, health }: { color: string; health: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const m = ringRef.current.material as THREE.MeshBasicMaterial;
    const t = clock.getElapsedTime();
    if (health < 50) m.opacity = 0.5 + Math.abs(Math.sin(t * 3)) * 0.5;
    else if (health < 75) m.opacity = 0.45 + Math.sin(t * 1.4) * 0.2;
    else m.opacity = 0.55;
  });
  return (
    <group>
      <Cylinder args={[2.5, 2.62, 0.35, 8]} position={[0, 0.175, 0]}>
        <meshStandardMaterial {...MAT.concrete} />
      </Cylinder>
      {/* thin status ring inset in the floor */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[2.72, 2.8, 64]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} />
      </mesh>
    </group>
  );
});

/* Status stanchion: small industrial signal post beside the machine */
const StatusStanchion = memo(function StatusStanchion({ color, critical }: { color: string; critical: boolean }) {
  const lampRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!lampRef.current) return;
    const m = lampRef.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = critical ? (Math.sin(clock.getElapsedTime() * 6) > 0 ? 3.2 : 0.4) : 2.2;
  });
  return (
    <group position={[2.05, 0.35, 1.45]}>
      <Cylinder args={[0.035, 0.045, 1.5, 8]} position={[0, 0.75, 0]}>
        <meshStandardMaterial {...MAT.dark} />
      </Cylinder>
      <mesh ref={lampRef} position={[0, 1.62, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.24, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} roughness={0.4} />
      </mesh>
      <Cylinder args={[0.11, 0.11, 0.05, 12]} position={[0, 1.77, 0]}>
        <meshStandardMaterial {...MAT.dark} />
      </Cylinder>
    </group>
  );
});

/* Expanding alert ring on the floor for critical assets */
const Shockwave = memo(function Shockwave({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() * 0.5) % 2.2;
    ref.current.scale.setScalar(1 + t * 0.8);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.3 * (1 - t / 2.2));
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[2.85, 2.95, 64]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} />
    </mesh>
  );
});

/* ─── Per-mode metric badge rendered inside each node label ─── */
function getModeMetric(asset: any, mode: string) {
  const hc = asset.health < 50 ? "#ef4444" : asset.health < 75 ? "#f59e0b" : "#10b981";

  if (mode === "health") return (
    <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px]">
      <span style={{ color: "#a1a1aa" }}>HEALTH</span>
      <span className="font-bold text-[10px] leading-none" style={{ color: hc }}>{asset.health}%</span>
      <span className="inline-block w-6 h-[3px] rounded-full bg-white/10 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${asset.health}%`, background: hc }} />
      </span>
    </div>
  );

  if (mode === "risk") {
    const c = asset.risk >= 60 ? "#ef4444" : asset.risk >= 30 ? "#f59e0b" : "#10b981";
    return (
      <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px]">
        <span style={{ color: "#a1a1aa" }}>RISK</span>
        <span className="font-bold text-[10px] leading-none" style={{ color: c }}>{asset.risk}%</span>
      </div>
    );
  }

  if (mode === "rul") {
    const c = asset.rul < 15 ? "#ef4444" : asset.rul <= 60 ? "#f59e0b" : "#10b981";
    return (
      <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px]">
        <span style={{ color: "#a1a1aa" }}>RUL</span>
        <span className="font-bold text-[10px] leading-none" style={{ color: c }}>{asset.rul}d</span>
      </div>
    );
  }

  if (mode === "business") {
    const exp = ASSET_REVENUE_EXPOSURE[asset.id] ?? 0;
    const c = exp >= 50_00_00_000 ? "#ef4444" : exp >= 15_00_00_000 ? "#f59e0b" : "#10b981";
    const str = exp >= 1_00_00_000 ? `₹${(exp / 1_00_00_000).toFixed(0)}Cr` : `₹${(exp / 1_00_000).toFixed(0)}L`;
    return (
      <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px]">
        <span style={{ color: "#a1a1aa" }}>IMPACT</span>
        <span className="font-bold text-[10px] leading-none" style={{ color: c }}>{str}</span>
      </div>
    );
  }

  if (mode === "maintenance") {
    const label = asset.health < 50 ? "URGENT" : asset.health < 75 ? "SCHEDULE" : "OK";
    const c = asset.health < 50 ? "#ef4444" : asset.health < 75 ? "#f59e0b" : "#10b981";
    return (
      <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px]">
        <span className="inline-block size-[5px] rounded-full" style={{ background: c }} />
        <span className="font-semibold" style={{ color: c }}>{label}</span>
      </div>
    );
  }

  // topology / default: health dot + bar
  return (
    <div className="flex items-center justify-center gap-1.5 mt-1 font-mono text-[7.5px] text-[#a1a1aa]">
      <span className="inline-block size-[5px] rounded-full" style={{ background: hc }} />
      {asset.health}%
      <span className="inline-block w-7 h-[3px] rounded-full bg-white/10 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${asset.health}%`, background: hc }} />
      </span>
    </div>
  );
}

/* ─── Node: machine + plinth + status accents + label ─── */
const Node = memo(
  function Node({ asset, position, color, isSelected, isDownstream, mode, onClick }: any) {
    const selRing = useRef<THREE.Mesh>(null);
    const isCritical = asset.status === "critical";
    const isTargeted = mode === "propagation" ? (isSelected || isDownstream) : true;
    const h = machineHeight(asset.type);

    useFrame(({ clock }) => {
      if (selRing.current && isSelected) selRing.current.rotation.z = clock.getElapsedTime() * 0.45;
    });

    return (
      <group position={position} onClick={(e: any) => { e.stopPropagation(); onClick(asset); }}>
        <MachineModel type={asset.type} />
        <Plinth color={color} health={asset.health} />
        <StatusStanchion color={color} critical={isCritical} />
        {isCritical && <Shockwave color={color} />}

        {isSelected && (
          <mesh ref={selRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <torusGeometry args={[3.05, 0.035, 10, 72]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}

        {/* annotation label above the machine */}
        <Html position={[0, h + 0.9, 0]} center zIndexRange={[100, 0]} distanceFactor={22}>
          <div className={`pointer-events-none whitespace-nowrap transition-opacity duration-200 ${isTargeted ? "opacity-100" : "opacity-15"}`}>
            <div className={`px-2.5 py-1.5 rounded-md text-center backdrop-blur-md ${
              isSelected
                ? "bg-[#0c0c12]/95 border border-[color:var(--primary)]/50"
                : "bg-[#08080c]/80 border border-white/[0.08]"
            }`}>
              <div className="font-mono text-[8.5px] font-semibold tracking-[0.12em] uppercase leading-none" style={{ color }}>
                {asset.name}
              </div>
              {getModeMetric(asset, mode)}
            </div>
            {/* leader line */}
            <div className="mx-auto w-px h-3 bg-white/15" />
          </div>
        </Html>
      </group>
    );
  },
  (prev, next) => {
    return (
      prev.isSelected === next.isSelected &&
      prev.isDownstream === next.isDownstream &&
      prev.color === next.color &&
      prev.mode === next.mode &&
      prev.onClick === next.onClick &&
      prev.position[0] === next.position[0] &&
      prev.position[1] === next.position[1] &&
      prev.position[2] === next.position[2] &&
      prev.asset.id === next.asset.id &&
      prev.asset.name === next.asset.name &&
      prev.asset.health === next.asset.health &&
      prev.asset.status === next.asset.status &&
      prev.asset.risk === next.asset.risk &&
      prev.asset.rul === next.asset.rul
    );
  }
);

/* ─── Pipe run between assets, with material-flow pulses ─── */
const PipeRun = memo(
  function PipeRun({ from, to, color, active }: { from: [number, number, number]; to: [number, number, number]; color: string; active: boolean }) {
    const dots = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
    const { center, yaw, len, a, b } = useMemo(() => {
      const av = new THREE.Vector3(from[0], FLOOR_Y + 0.42, from[2]);
      const bv = new THREE.Vector3(to[0], FLOOR_Y + 0.42, to[2]);
      const d = bv.clone().sub(av);
      return {
        a: av, b: bv,
        center: av.clone().add(bv).multiplyScalar(0.5),
        yaw: -Math.atan2(d.z, d.x),
        len: d.length(),
      };
    }, [from, to]);

    useFrame(({ clock }) => {
      const speed = active ? 0.4 : 0.12;
      dots.forEach((r, i) => {
        if (!r.current) return;
        const t = (clock.getElapsedTime() * speed + i / 3) % 1;
        r.current.position.lerpVectors(a, b, t);
        r.current.position.y += 0.12;
        (r.current.material as THREE.MeshBasicMaterial).opacity = (active ? 0.95 : 0.45) * Math.sin(t * Math.PI);
      });
    });

    const nSupports = Math.max(1, Math.floor(len / 2.6));
    const dotCount = active ? 3 : 1;
    return (
      <group>
        <group position={center} rotation={[0, yaw, 0]}>
          {/* main connecting pipe — tinted to the link's status colour and softly lit so
              the connections read clearly against the dark floor */}
          <Cylinder args={[0.12, 0.12, len, 12]} rotation={[0, 0, Math.PI / 2]}>
            <meshStandardMaterial
              color={active ? "#f43f5e" : color}
              emissive={active ? "#f43f5e" : color}
              emissiveIntensity={active ? 0.65 : 0.35}
              roughness={0.35}
              metalness={0.6}
            />
          </Cylinder>
          {/* secondary rack pipe for industrial detail */}
          <Cylinder args={[0.06, 0.06, len, 8]} position={[0, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
            <meshStandardMaterial {...MAT.steel} />
          </Cylinder>
          {/* supports down to the floor */}
          {Array.from({ length: nSupports }).map((_, i) => {
            const x = -len / 2 + (len / (nSupports + 1)) * (i + 1);
            return (
              <group key={i} position={[x, -0.21, 0]}>
                <Box args={[0.06, 0.42, 0.06]}><meshStandardMaterial {...MAT.dark} /></Box>
                <Box args={[0.3, 0.05, 0.3]} position={[0, -0.21, 0]}><meshStandardMaterial {...MAT.dark} /></Box>
              </group>
            );
          })}
        </group>
        {/* flow pulses gliding along the rod */}
        {dots.slice(0, dotCount).map((r, i) => (
          <mesh key={i} ref={r}>
            <sphereGeometry args={[active ? 0.16 : 0.1, 10, 10]} />
            <meshBasicMaterial color={active ? "#ff5e74" : color} transparent depthWrite={false} />
          </mesh>
        ))}
      </group>
    );
  },
  (prev, next) => {
    return (
      prev.active === next.active &&
      prev.color === next.color &&
      prev.from[0] === next.from[0] &&
      prev.from[1] === next.from[1] &&
      prev.from[2] === next.from[2] &&
      prev.to[0] === next.to[0] &&
      prev.to[1] === next.to[1] &&
      prev.to[2] === next.to[2]
    );
  }
);

/* ─── Background skyline: distant chimneys + plant buildings ─── */
const FarChimney = memo(
  function FarChimney({ position, height = 14 }: { position: [number, number, number]; height?: number }) {
    const lamp = useRef<THREE.Mesh>(null);
    const phase = useMemo(() => Math.random() * Math.PI * 2, []);
    useFrame(({ clock }) => {
      if (!lamp.current) return;
      (lamp.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        Math.sin(clock.getElapsedTime() * 1.5 + phase) > 0 ? 2.5 : 0.2;
    });
    return (
      <group position={position}>
        <Cylinder args={[0.55, 0.85, height, 12]} position={[0, height / 2, 0]}>
          <meshStandardMaterial color="#12161d" roughness={0.8} metalness={0.3} />
        </Cylinder>
        <mesh ref={lamp} position={[0, height + 0.2, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} />
        </mesh>
        <RisingParticles position={[0, height + 0.3, 0]} count={10} radius={0.5} height={5} color="#3f4854" size={0.8} opacity={0.07} speed={0.5} drift={0.4} />
      </group>
    );
  },
  (prev, next) => {
    return (
      prev.height === next.height &&
      prev.position[0] === next.position[0] &&
      prev.position[1] === next.position[1] &&
      prev.position[2] === next.position[2]
    );
  }
);

const Backdrop = memo(function Backdrop() {
  return (
    <group position={[0, FLOOR_Y, 0]}>
      {/* long mill building */}
      <Box args={[42, 7, 7]} position={[0, 3.5, -36]}>
        <meshStandardMaterial color="#0b0e14" roughness={0.9} metalness={0.2} />
      </Box>
      <Box args={[42, 0.5, 7.4]} position={[0, 7.2, -36]}>
        <meshStandardMaterial color="#080a0f" roughness={0.9} metalness={0.2} />
      </Box>
      {/* lit window strip */}
      <Box args={[40, 0.22, 0.05]} position={[0, 4.6, -32.25]}>
        <meshStandardMaterial color="#caa45a" emissive="#caa45a" emissiveIntensity={0.7} />
      </Box>
      {/* side warehouse */}
      <Box args={[8, 4.5, 18]} position={[-34, 2.25, 4]}>
        <meshStandardMaterial color="#0c0f15" roughness={0.9} metalness={0.2} />
      </Box>
      <Box args={[7, 5.5, 14]} position={[34, 2.75, -6]}>
        <meshStandardMaterial color="#0c0f15" roughness={0.9} metalness={0.2} />
      </Box>
      {/* distant stacks */}
      <FarChimney position={[-26, 0, -28]} height={15} />
      <FarChimney position={[-18, 0, -32]} height={11} />
      <FarChimney position={[26, 0, -26]} height={13} />
    </group>
  );
});

/* ─── Floor: wet concrete reflector + faint grid + lane markings ─── */
const PlantFloor = memo(function PlantFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.02, 0]}>
        <planeGeometry args={[170, 170]} />
        <MeshReflectorMaterial
          blur={[260, 80]}
          resolution={1024}
          mixBlur={1}
          mixStrength={9}
          roughness={0.92}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#07080c"
          metalness={0.4}
          mirror={0.35}
        />
      </mesh>
      <Grid
        infiniteGrid
        fadeDistance={50}
        sectionColor="#141c2c"
        cellColor="#0a0e16"
        position={[0, FLOOR_Y, 0]}
        sectionSize={4}
        cellSize={1}
      />
    </group>
  );
});

function ContextLossHandler() {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("WebGL Renderer context lost. Prevented default to allow restoration.");
    };
    const handleContextRestored = () => {
      console.log("WebGL Renderer context successfully restored.");
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [gl]);
  return null;
}

const CAMERA_CONFIG = { position: [-12, 13, 30] as [number, number, number], fov: 40 };
const DPR_CONFIG = [1, 1.5] as [number, number];
const GL_CONFIG = { antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 };

/* ─── Main Export ─── */
export function Plant3D({ assets, edges, mode, selected, onSelect, downstreamList }: any) {
  const positions = useMemo(() => {
    const pos: Record<string, [number, number, number]> = {};
    assets.forEach((a: Asset) => {
      const x = (a.position[0] - 50) * 0.52;
      const z = (a.position[1] - 50) * 0.46;
      pos[a.id] = [x, FLOOR_Y, z];
    });
    return pos;
  }, [assets]);

  return (
    <Canvas
      camera={CAMERA_CONFIG}
      dpr={DPR_CONFIG}
      shadows="percentage"
      gl={GL_CONFIG}
    >
      <ContextLossHandler />
      <color attach="background" args={["#05060a"]} />
      <fog attach="fog" args={["#05060a", 48, 100]} />

      {/* Lighting: warm high-bay key + cool fill, like a night-shift plant */}
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#2a3550", "#0a0c10", 0.5]} />
      <directionalLight position={[14, 26, 10]} intensity={1.15} color="#ffe8cf" castShadow shadow-mapSize={2048} shadow-bias={-0.0004}>
        <orthographicCamera attach="shadow-camera" args={[-32, 32, 32, -32, 1, 70]} />
      </directionalLight>
      <directionalLight position={[-18, 12, -14]} intensity={0.3} color="#7dd3fc" />
      <pointLight position={[0, 14, 0]} intensity={0.4} color="#fff4e0" distance={45} decay={2} />

      {/* Local env reflections (no network fetch) */}
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={1.2} position={[0, 14, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[24, 24, 1]} color="#fff2e0" form="rect" />
        <Lightformer intensity={0.7} position={[-16, 5, -10]} scale={[14, 5, 1]} color="#1e3a4f" form="rect" />
        <Lightformer intensity={0.5} position={[16, 7, 10]} scale={[14, 5, 1]} color="#252447" form="rect" />
      </Environment>

      <PlantFloor />
      <ContactShadows position={[0, FLOOR_Y + 0.01, 0]} opacity={0.6} scale={75} blur={2.2} far={18} color="#000" />
      <Backdrop />
      <DustParticles />

      {/* Pipe runs between connected assets */}
      {edges.map((e: any, i: number) => {
        const fromPos = positions[e.from.id];
        const toPos = positions[e.to.id];
        if (!fromPos || !toPos) return null;
        const isBlast = mode === "propagation" && selected &&
          (selected.id === e.from.id || (downstreamList && downstreamList.has(e.from.id))) &&
          downstreamList && downstreamList.has(e.to.id);
        const worst = [e.from, e.to].find((a: any) => a.status === "critical") ??
          [e.from, e.to].find((a: any) => a.status === "warning") ?? e.from;
        const c = mode === "propagation"
          ? (isBlast ? "#f43f5e" : "#334155")
          : (mode === "topology" ? "#64748b" : nodeColorForMode(mode, worst, false, false));
        return <PipeRun key={i} from={fromPos} to={toPos} color={c} active={!!isBlast} />;
      })}

      {/* Machines */}
      {assets.map((a: Asset) => {
        const isSelected = selected?.id === a.id;
        const isDownstream = downstreamList ? downstreamList.has(a.id) : false;
        const color = nodeColorForMode(mode, a, isDownstream, isSelected);
        return (
          <Node key={a.id} asset={a} position={positions[a.id]} color={color}
            isSelected={isSelected} isDownstream={isDownstream} mode={mode} onClick={onSelect} />
        );
      })}

      {/* Subtle bloom: only hot metal, lamps and beacons glow */}
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.55} luminanceSmoothing={0.4} radius={0.7} />
        <Vignette eskil={false} offset={0.2} darkness={0.72} />
      </EffectComposer>

      <OrbitControls
        makeDefault
        autoRotate={!selected && mode !== "propagation"}
        autoRotateSpeed={0.15}
        maxPolarAngle={Math.PI / 2.25}
        minPolarAngle={Math.PI / 7}
        minDistance={10}
        maxDistance={55}
        enableDamping
        dampingFactor={0.05}
      />
    </Canvas>
  );
}
