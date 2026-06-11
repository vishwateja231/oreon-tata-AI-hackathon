import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";

/* The OREON mark, extruded — six segments orbiting an empty core. */

const R_OUTER = 1.5;
const R_INNER = 0.38;
const HALF = (28 * Math.PI) / 180;

function segmentShape(bisectorDeg: number): THREE.Shape {
  const t = (bisectorDeg * Math.PI) / 180;
  const a1 = t - HALF;
  const a2 = t + HALF;
  const innerRadial = R_INNER / Math.cos(HALF);
  const s = new THREE.Shape();
  s.moveTo(innerRadial * Math.cos(a1), innerRadial * Math.sin(a1));
  s.lineTo(R_OUTER * Math.cos(a1), R_OUTER * Math.sin(a1));
  s.absarc(0, 0, R_OUTER, a1, a2, false);
  s.lineTo(innerRadial * Math.cos(a2), innerRadial * Math.sin(a2));
  s.closePath();
  return s;
}

function Mark() {
  const group = useRef<THREE.Group>(null);
  const geos = useMemo(() => {
    const opts: THREE.ExtrudeGeometryOptions = {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 3,
      curveSegments: 48,
    };
    return [-120, -60, 0, 60, 120, 180].map((b) => new THREE.ExtrudeGeometry(segmentShape(b), opts));
  }, []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.z = t * 0.12;
    group.current.rotation.x = -0.45 + Math.sin(t * 0.3) * 0.06;
    group.current.rotation.y = Math.sin(t * 0.22) * 0.18;
  });

  return (
    <group ref={group}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshStandardMaterial color="#f4f4f5" metalness={0.25} roughness={0.3} />
        </mesh>
      ))}
      {/* core pulse */}
      <mesh>
        <sphereGeometry args={[0.09, 24, 24]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {/* thin command ring */}
      <mesh rotation={[0, 0, 0]}>
        <torusGeometry args={[R_OUTER + 0.14, 0.006, 8, 96]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.1} transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function OreonMark3D({ className = "" }: { className?: string }) {
  // client-only guard: keeps SSR of the landing page trivially safe
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className={className} aria-hidden />;

  return (
    <div className={className} aria-hidden>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0, 4.4], fov: 40 }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 5]} intensity={2.2} />
        <directionalLight position={[-5, 2, -3]} intensity={0.6} color="#7dd3fc" />
        <pointLight position={[-4, -2, 3]} intensity={22} color="#22d3ee" />
        <Mark />
        <ContactShadows position={[0, -1.95, 0]} opacity={0.5} scale={7} blur={2.6} far={3.2} color="#000000" />
      </Canvas>
    </div>
  );
}
