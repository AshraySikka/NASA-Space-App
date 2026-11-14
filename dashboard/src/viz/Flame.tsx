// Procedural flame built from two crossed shader sheets plus a billboarded
// glow, a warm light pool on the cloth, and buoyant smoke.
//
// Physical behavior (2026-11-13 sanity pass):
// - The front sweeps from the upwind edge to the downwind edge at the
//   interpolated spread rate, then the sample is consumed and resets.
// - Flicker scales with gravity: steady at 0g, buoyant chaos at 1g.
// - Flow adds turbulence flutter; O2 drives color and brightness
//   (dim sooty red at low O2, white-hot at high O2).
// - Smoke rises only above ~0.25 g: no buoyant plume in microgravity.
// - Illustrative motion driven by the engine, not a CFD solution (label in UI).

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import {
  FLAME_FRAG,
  FLAME_VERT,
  GLOW_FRAG,
  POOL_FRAG,
  PREHEAT_FRAG,
  QUAD_VERT,
  SMOKE_FRAG,
  SMOKE_VERT,
} from './shaders'
import type { Controls, VizState } from './types'

/** Shared between Flame (writes) and Duct (reads for the char zone). */
export interface FrontState {
  x: number
  phase: 'burning' | 'done'
  doneAt: number
}

export const SAMPLE_HALF = 2.0 // sample spans x in [-2, 2]

function sheetUniforms(widthAxis: number) {
  return {
    uTime: { value: 0 },
    uLean: { value: 0.35 },
    uFlutter: { value: 0 },
    uWidthAxis: { value: widthAxis },
    uOpacity: { value: 0 },
    uHot: { value: 0.7 },
    uRise: { value: 1.1 },
  }
}

const SMOKE_N = 26

function Smoke({
  burning,
  gravity,
  flow_cm_s,
  hot,
  front,
}: {
  burning: boolean
  gravity: number
  flow_cm_s: number
  hot: number
  front: { current: FrontState }
}) {
  const points = useRef<THREE.Points>(null)
  const parts = useMemo(
    () =>
      Array.from({ length: SMOKE_N }, () => ({
        x: 0,
        y: -1,
        z: 0,
        vy: 0,
        life: -Math.random() * 2,
      })),
    [],
  )
  const pos = useMemo(() => new Float32Array(SMOKE_N * 3), [])
  const alpha = useMemo(() => new Float32Array(SMOKE_N), [])
  const uniforms = useMemo(() => ({ uOpacity: { value: 0 } }), [])

  useFrame((_, dt) => {
    if (!points.current) return
    const vis = burning ? Math.max(0, (gravity - 0.25) / 0.75) : 0
    // low O2 burns sootier: more smoke for the same buoyancy
    uniforms.uOpacity.value = vis * (0.22 + 0.55 * (1 - hot))
    points.current.visible = vis > 0.01
    if (!points.current.visible) return

    const step = Math.min(dt, 0.1)
    for (let i = 0; i < SMOKE_N; i++) {
      const p = parts[i]
      p.life -= step
      if (p.life <= 0) {
        p.x = front.current.x + 0.15
        p.y = 0.18
        p.z = (Math.random() - 0.5) * 0.5
        p.vy = 0.3 + Math.random() * 0.25
        p.life = 1.2 + Math.random() * 1.4
      }
      p.y += p.vy * step * (0.35 + gravity * 1.1)
      p.x += flow_cm_s * 0.012 * step
      pos[i * 3] = p.x
      pos[i * 3 + 1] = p.y
      pos[i * 3 + 2] = p.z
      alpha[i] = Math.min(1, p.life * 1.4) * Math.min(1, (2.6 - p.life) * 2)
    }
    const geo = points.current.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.aAlpha.needsUpdate = true
  })

  return (
    <points ref={points} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
        <bufferAttribute attach="attributes-aAlpha" args={[alpha, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={SMOKE_VERT}
        fragmentShader={SMOKE_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  )
}

export function Flame({
  viz,
  controls,
  front,
}: {
  viz: VizState
  controls: Controls
  front: { current: FrontState }
}) {
  const group = useRef<THREE.Group>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const poolRef = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)

  const gravity = (viz.flame.aspect - 1) / 1.8
  const hot = THREE.MathUtils.clamp((controls.o2_pct - 16) / 20, 0, 1)
  const flutter = THREE.MathUtils.clamp(controls.flow_cm_s / 40, 0, 1)

  // two crossed sheets: one spanning the cloth width, one the side profile
  const geos = useMemo(() => {
    const a = new THREE.PlaneGeometry(0.9, 1, 24, 36)
    a.rotateY(Math.PI / 2)
    a.translate(0, 0.5, 0)
    const b = new THREE.PlaneGeometry(0.7, 1, 24, 36)
    b.translate(0, 0.5, 0)
    return { width: a, profile: b }
  }, [])

  const matWidth = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        uniforms: sheetUniforms(1),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const matProfile = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        uniforms: sheetUniforms(0),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const glowUniforms = useMemo(
    () => ({ uOpacity: { value: 0 }, uHot: { value: 0.7 } }),
    [],
  )
  const poolUniforms = useMemo(
    () => ({ uOpacity: { value: 0 }, uHot: { value: 0.7 } }),
    [],
  )
  const preheatUniforms = useMemo(
    () => ({ uOpacity: { value: 0 }, uHot: { value: 0.7 } }),
    [],
  )
  const preheatRef = useRef<THREE.Mesh>(null)

  useFrame((state, dt) => {
    if (!group.current || !light.current) return
    const t = state.clock.elapsedTime
    const f = front.current
    const burning = viz.flame.alive && f.phase === 'burning'

    // front sweeps downwind once, then the sample is consumed and resets
    if (f.phase === 'burning') {
      if (burning && viz.spread_rate_mm_s > 0) {
        f.x += viz.spread_rate_mm_s * 0.35 * Math.min(dt, 0.1)
        if (f.x >= SAMPLE_HALF) {
          f.x = SAMPLE_HALF
          f.phase = 'done'
          f.doneAt = t
        }
      }
    } else if (t - f.doneAt > 2.0) {
      f.x = -SAMPLE_HALF
      f.phase = 'burning'
    }

    // envelope: grow in, hold, taper near the downwind edge, extinguish
    const p = (f.x + SAMPLE_HALF) / (2 * SAMPLE_HALF)
    const rampIn = Math.min(1, p / 0.12)
    const taper = p > 0.8 ? Math.max(0.3, 1 - (p - 0.8) * 3.4) : 1
    const envelope = rampIn * taper

    // buoyancy flicker: zero at 1g scaled, plus flow flutter in the shader
    const amp = gravity
    const flicker = 1 + amp * (0.035 * Math.sin(t * 13.7) + 0.025 * Math.sin(t * 29.3))
    const yScale = 1 + amp * 0.05 * Math.sin(t * 7.1)

    const L = viz.flame.length * envelope
    const opacity = (burning ? 1 : 0) * Math.min(1, envelope * 1.4)

    group.current.position.x = f.x
    group.current.scale.set(Math.max(L * flicker, 0.001), Math.max(L * yScale, 0.001), 1)
    group.current.rotation.z = (-viz.flame.tilt_deg * Math.PI) / 180

    for (const m of [matWidth, matProfile]) {
      const u = m.uniforms
      u.uTime.value = t
      u.uHot.value = hot
      u.uFlutter.value = flutter
      u.uOpacity.value += (opacity - u.uOpacity.value) * 0.12
    }
    glowUniforms.uHot.value = hot
    glowUniforms.uOpacity.value += (opacity * 0.55 - glowUniforms.uOpacity.value) * 0.12
    poolUniforms.uHot.value = hot
    poolUniforms.uOpacity.value += (opacity * 0.5 - poolUniforms.uOpacity.value) * 0.12

    // pyrolysis preheat: cloth glowing ahead of the char line, only while
    // the front is actually burning (nothing to preheat after extinction)
    preheatUniforms.uHot.value = hot
    const preTarget = burning ? 0.8 * envelope : 0
    preheatUniforms.uOpacity.value += (preTarget - preheatUniforms.uOpacity.value) * 0.12
    if (preheatRef.current) {
      const len = 0.3 + 0.4 * L
      preheatRef.current.position.x = f.x + len / 2
      preheatRef.current.scale.set(Math.max(len, 0.001), 0.9, 1)
    }

    if (glowRef.current) {
      const g = Math.max(L * 2.6, 0.001)
      glowRef.current.scale.set(g, g * 0.8, 1)
      glowRef.current.position.y = 0.45 * Math.max(L, 0.2)
    }
    if (poolRef.current) {
      poolRef.current.position.x = f.x + 0.3 * L
      poolRef.current.scale.set(Math.max(1.2 + L, 0.001), Math.max(0.8 + L * 0.5, 0.001), 1)
    }

    light.current.intensity = (burning ? 8 : 0) * viz.flame.intensity * viz.flame.length
    light.current.position.set(f.x, 0.5 * Math.max(L, 0.2), 0)
  })

  return (
    <>
      <group ref={group} position={[-SAMPLE_HALF, 0.06, 0]}>
        <mesh geometry={geos.width} material={matWidth} />
        <mesh geometry={geos.profile} material={matProfile} />
        <Billboard>
          <mesh ref={glowRef}>
            <planeGeometry args={[1, 1]} />
            <shaderMaterial
              vertexShader={QUAD_VERT}
              fragmentShader={GLOW_FRAG}
              uniforms={glowUniforms}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </Billboard>
        <pointLight ref={light} color="#fb923c" intensity={0} distance={6} decay={2} />
      </group>

      {/* warm pool of light on the cloth under the flame */}
      <mesh ref={poolRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.095, 0]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={QUAD_VERT}
          fragmentShader={POOL_FRAG}
          uniforms={poolUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* pyrolysis preheat strip on the cloth just ahead of the front */}
      <mesh ref={preheatRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={QUAD_VERT}
          fragmentShader={PREHEAT_FRAG}
          uniforms={preheatUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <Smoke
        burning={viz.flame.alive}
        gravity={gravity}
        flow_cm_s={controls.flow_cm_s}
        hot={hot}
        front={front}
      />
    </>
  )
}
