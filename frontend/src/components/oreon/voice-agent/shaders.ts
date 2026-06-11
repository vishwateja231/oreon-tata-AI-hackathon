/**
 * Particle-sphere shaders for the OREON voice agent.
 *
 * A thin, airy globe of points: particles ride a unit sphere, ripple with
 * flowing simplex noise, and brighten toward the silhouette (Fresnel rim) so the
 * sphere reads as a clean, transparent shell rather than a solid orb. Audio
 * (uAmp / uBass / uMid / uHigh) swells the surface and the glow, so it visibly
 * reacts to the voice. `cameraPosition`, `modelMatrix`, etc. are three.js
 * built-ins and must not be redeclared.
 */

export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uSwirl;       // extra motion while thinking
  uniform float uIntro;       // opening burst (decays 1 -> 0)
  uniform float uPixelRatio;
  uniform float uSize;

  attribute float aScale;
  attribute float aSeed;

  varying float vFresnel;
  varying float vEnergy;
  varying float vSeed;

  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vSeed = aSeed;
    vec3 dir = normalize(position);

    // Always-alive motion: layered flow that keeps rolling even at idle.
    float t = uTime * 0.26 + uSwirl * uTime * 0.5 + uIntro * uTime * 0.6;
    float n1 = snoise(dir * 1.8 + vec3(t));
    float n2 = snoise(dir * 3.6 - vec3(t * 1.4) + aSeed);
    float n3 = snoise(dir * 6.0 + vec3(t * 0.7) + aSeed * 0.5);
    float flow = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;

    float audio = uBass * 0.5 + uMid * 0.3 + uHigh * 0.2;
    // Thin shell: lively base ripple, swells with audio, bursts on open.
    float disp = flow * (0.05 + audio * 0.28 + uIntro * 0.35) + uAmp * 0.08 + uIntro * 0.08;
    vec3 pos = dir * (1.0 + disp);

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vec3 worldNormal = normalize(mat3(modelMatrix) * dir);
    vec3 viewDir = normalize(cameraPosition - worldPos.xyz);
    float fres = pow(1.0 - abs(dot(worldNormal, viewDir)), 2.6);

    vFresnel = fres;
    vEnergy = clamp(audio + abs(flow) * 0.35 + uAmp * 0.25 + uIntro * 0.5, 0.0, 1.1);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = uSize * aScale * (0.5 + fres * 0.9 + audio * 0.7 + uIntro * 0.8);
    gl_PointSize = size * uPixelRatio * (1.0 / -mv.z);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uColorCore;   // deep blue (interior)
  uniform vec3  uColorRim;    // bright blue/white (silhouette)
  uniform float uOpacity;

  varying float vFresnel;
  varying float vEnergy;
  varying float vSeed;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float disc = smoothstep(0.5, 0.0, d);
    if (disc <= 0.01) discard;

    float mixv = clamp(vFresnel * 1.2 + vEnergy * 0.5, 0.0, 1.0);
    vec3 color = mix(uColorCore, uColorRim, mixv);
    // occasional brighter sparkle
    color += smoothstep(0.85, 1.0, fract(vSeed * 7.0)) * vEnergy * 0.25;

    // Transparent interior, opaque rim — gives a clean shell.
    float alpha = disc * (0.08 + vFresnel * 0.7) * uOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`;
