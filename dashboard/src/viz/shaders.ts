// GLSL for the procedural flame. One noise source shared by the sheet,
// the glow, and the smoke. Kept to 3 fbm octaves so integrated graphics
// stay smooth.

export const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}
`

// Flame sheet vertex. Geometry is a unit-height plane: y in [0, 1].
// uWidthAxis 0 = width along x (side-profile sheet), 1 = width along z
// (sheet spanning the cloth, seen arc-on from above).
export const FLAME_VERT = /* glsl */ `
uniform float uTime;
uniform float uLean;
uniform float uFlutter;
uniform float uWidthAxis;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 p = position;
  float h = p.y;
  float w = mix(p.x, p.z, uWidthAxis);

  // ragged tongue heights across the sheet: real fabric spread is a line
  // of tongues, never one uniform height (static shape, honest at 0g)
  float tongues = 0.74 + 0.26 * (0.5 + 0.5 * sin(w * 19.0 + 1.3) * sin(w * 7.7 + 0.4));
  float hh = h * tongues;
  float h2 = hh * hh;

  // tips curl downstream and the sheet narrows toward the top
  float wn = w * mix(1.0, 0.6, h2);
  float lateral = uFlutter * 0.05 * sin(uTime * 17.0 + h * 9.0 + w * 5.0) * h;
  if (uWidthAxis > 0.5) p.z = wn + lateral;
  else p.x = wn + lateral;

  // lean downstream with height, torn by flow flutter
  float lean = uLean * h2
    + uFlutter * 0.08 * sin(uTime * 21.0 + w * 14.0) * h;
  // leading edge bulges downstream at mid width (the arc seen from above)
  float arc = 0.22 * (1.0 - 4.0 * w * w) * hh;
  p.x += lean + arc;
  p.y = hh;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

export const FLAME_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uOpacity;
uniform float uHot;      // 0 at low O2 (dim, sooty red) to 1 at high O2
uniform float uFlutter;
uniform float uRise;
varying vec2 vUv;

void main() {
  float across = vUv.x - 0.5;   // -0.5 .. 0.5
  float hgt = vUv.y;            // 0 base .. 1 top

  // two noise fields: body shape and fine tearing
  float n = fbm(vec2(across * 6.0, hgt * 2.4 - uTime * uRise));
  float n2 = fbm(vec2(across * 14.0 + 5.0, hgt * 6.0 - uTime * uRise * 1.6));

  // vertical silhouette: rounded top torn by noise, bright steady base
  float top = 1.0 - smoothstep(0.42, 1.0, hgt + (n - 0.5) * 0.55 + uFlutter * 0.12 * (n2 - 0.5));
  float side = smoothstep(0.5, 0.26, abs(across));
  float base = smoothstep(0.0, 0.05, hgt);
  float alpha = top * side * base * uOpacity;
  if (alpha < 0.003) discard;

  // color ramp: blue base, white-hot core, yellow body, orange-red tips
  float t = clamp(hgt + (n2 - 0.5) * 0.28, 0.0, 1.0);
  vec3 blue = vec3(0.16, 0.40, 1.00);
  vec3 core = vec3(1.00, 0.96, 0.82);
  vec3 yellow = vec3(1.00, 0.80, 0.32);
  vec3 orange = vec3(0.98, 0.46, 0.10);
  vec3 red = vec3(0.82, 0.14, 0.04);
  vec3 col;
  if (t < 0.16) col = mix(blue, core, t / 0.16);
  else if (t < 0.45) col = mix(core, yellow, (t - 0.16) / 0.29);
  else if (t < 0.75) col = mix(yellow, orange, (t - 0.45) / 0.30);
  else col = mix(orange, red, (t - 0.75) / 0.25);

  // oxygen response: lean O2 burns dim and deep red, rich O2 burns whiter
  col = mix(mix(vec3(0.7, 0.16, 0.04), col, 0.55), col, uHot);
  col = mix(col, vec3(1.0, 0.98, 0.92), uHot * 0.22);

  // hot pool near the base keeps the core overexposed for bloom
  float hot = (1.0 - smoothstep(0.0, 0.34, hgt)) * side;
  float brightness = mix(0.55, 1.5, uHot) * (1.0 + 1.6 * hot);

  gl_FragColor = vec4(col * brightness, alpha);
}
`

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Soft radial halo behind the flame core (billboarded).
export const GLOW_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uHot;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(1.0, 0.34, 0.07), vec3(1.0, 0.78, 0.40), uHot);
  gl_FragColor = vec4(col, a);
}
`

// Warm pool of light on the cloth under the flame (flat on the sample).
export const POOL_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uHot;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.05, d);
  a = a * a * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.72, 0.34), uHot);
  gl_FragColor = vec4(col, a);
}
`

// Pyrolysis preheat glow: the strip of cloth just downstream of the char
// line that is heating up but has not ignited yet. Bright at the char line
// (uv.x = 0), fading to nothing at the leading edge of the strip.
export const PREHEAT_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uHot;
varying vec2 vUv;
void main() {
  float grad = pow(1.0 - vUv.x, 2.2);
  float side = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
  float a = grad * side * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.85, 0.22, 0.05), vec3(1.0, 0.52, 0.16), uHot);
  gl_FragColor = vec4(col, a);
}
`

// Buoyant smoke: only above ~0.25 g (no buoyant plume in 0g).
export const SMOKE_VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 90.0 / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`

export const SMOKE_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.42, 0.44, 0.48), a);
}
`
