/**
 * ParticleSphere — the airy, sound-reactive voice globe.
 *
 * A thin shell of points on a sphere, rendered transparently with additive
 * blending so only the particles (and a bright rim) are visible — no card, no
 * background. Audio levels arrive via a ref (updated every frame from the Web
 * Audio analyser) so the globe reacts to the voice without React re-renders.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { fragmentShader, vertexShader } from "./shaders";
import type { AudioLevels, VoiceState } from "./useVoiceAgent";

interface ParticleSphereProps {
  audioRef: React.MutableRefObject<AudioLevels>;
  state: VoiceState;
  count?: number;
  coreColor?: string;
  rimColor?: string;
}

export function ParticleSphere({ audioRef, state, count = 18000, coreColor = "#1d4ed8", rimColor = "#7dd3fc" }: ParticleSphereProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const smooth = useRef<AudioLevels>({ bass: 0, mid: 0, high: 0, amp: 0 });
  const stateRef = useRef<VoiceState>(state);
  stateRef.current = state;
  // Opening burst — starts high on mount, decays to zero.
  const intro = useRef(1);

  const { positions, scales, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const seeds = new Float32Array(count);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
      scales[i] = 0.5 + Math.random() * 1.1;
      seeds[i] = Math.random() * 10;
    }
    return { positions, scales, seeds };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uSwirl: { value: 0 },
      uIntro: { value: 1 },
      uPixelRatio: { value: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2) },
      uSize: { value: 7 },
      uColorCore: { value: new THREE.Color(coreColor) },
      uColorRim: { value: new THREE.Color(rimColor) },
      uOpacity: { value: 0.75 },
    }),
    [coreColor, rimColor],
  );

  useFrame((st, delta) => {
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms;
    const live = audioRef.current;
    const s = smooth.current;
    
    // Increased smoothing responsiveness slightly for better voice reactivity
    const k = Math.min(1, delta * 12);
    s.bass += (live.bass - s.bass) * k;
    s.mid += (live.mid - s.mid) * k;
    s.high += (live.high - s.high) * k;
    s.amp += (live.amp - s.amp) * k;

    // Opening burst decays away over ~1.4s.
    intro.current += (0 - intro.current) * Math.min(1, delta * 1.6);
    if (intro.current < 0.001) intro.current = 0;

    u.uTime.value = st.clock.elapsedTime;
    u.uBass.value = s.bass;
    u.uMid.value = s.mid;
    u.uHigh.value = s.high;
    u.uAmp.value = s.amp;
    u.uIntro.value = intro.current;
    u.uSwirl.value += ((stateRef.current === "thinking" ? 1 : 0) - u.uSwirl.value) * Math.min(1, delta * 3);

    if (pointsRef.current) {
      // Lively base spin, faster with energy / thinking / the opening burst.
      const spin = 0.12 + s.amp * 0.45 + intro.current * 0.9 + (stateRef.current === "thinking" ? 0.35 : 0);
      pointsRef.current.rotation.y += delta * spin;
      pointsRef.current.rotation.x = Math.sin(st.clock.elapsedTime * 0.13) * 0.16;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
