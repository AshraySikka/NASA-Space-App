// Screen-space heat shimmer: uv distortion around the flame's projected
// position. Buoyancy driven, so strength scales with gravity (microgravity
// flames are steady, no convective shimmer) and airflow.

import { wrapEffect } from '@react-three/postprocessing'
import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec2 uPos;
uniform float uAspect;
uniform float uStrength;

float hhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float hnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hhash(i), hhash(i + vec2(1.0, 0.0)), u.x),
    mix(hhash(i + vec2(0.0, 1.0)), hhash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void mainUv(inout vec2 uv) {
  vec2 d = (uv - uPos) * vec2(uAspect, 1.0);
  float mask = smoothstep(0.30, 0.0, length(d)) * uStrength;
  if (mask <= 0.001) return;
  float n1 = hnoise(vec2(uv.x * 42.0, uv.y * 42.0 - uTime * 3.2));
  float n2 = hnoise(vec2(uv.y * 38.0 + 3.7, uv.x * 38.0 - uTime * 2.1));
  uv.y += (n1 - 0.5) * 0.014 * mask;
  uv.x += (n2 - 0.5) * 0.007 * mask;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = inputColor;
}
`

class HeatHazeEffect extends Effect {
  constructor() {
    super('HeatHaze', FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['uTime', new Uniform(0)],
        ['uPos', new Uniform({ x: 0.5, y: 0.5 })],
        ['uAspect', new Uniform(1.6)],
        ['uStrength', new Uniform(0)],
      ]),
    })
  }
}

/** React component for the composer: `<HeatHaze ref={...} />`. */
export const HeatHaze = wrapEffect(HeatHazeEffect)
