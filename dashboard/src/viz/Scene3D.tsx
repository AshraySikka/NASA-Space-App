// Live 3D scene: the SPICE-style flow duct with a fabric sample, animated
// airflow streamlines, and the flame. This is the MVP product surface.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { Effect } from 'postprocessing'
import * as THREE from 'three'
import { Flame, SAMPLE_HALF, type FrontState } from './Flame'
import { HeatHaze } from './heat-haze'
import { makeCharTexture, makeFloorArrowTexture, makeHoneycombTexture, makeWeaveTexture } from './textures'
import type { SceneControls as Controls, VizState } from './types'

const FLOW_L = -5.0
const FLOW_R = 5.0

function FlowLines({
  flow_cm_s,
  viz,
  front,
}: {
  flow_cm_s: number
  viz: VizState
  front: { current: FrontState }
}) {
  const group = useRef<THREE.Group>(null)
  const baseSpeed = flow_cm_s / 9 // world units per second at centerline
  const visible = flow_cm_s > 0.5

  const lines = useRef<Array<{ y: number; z: number; len: number }>>(
    Array.from({ length: 18 }, (_, i) => ({
      y: 0.18 + ((i * 0.37) % 1.0),
      z: -1.25 + ((i * 0.61) % 2.5),
      len: 0.35 + ((i * 0.23) % 0.5),
    })),
  ).current

  useFrame((_, dt) => {
    if (!group.current || !visible) return
    const step = Math.min(dt, 0.1)
    const f = front.current
    const gravity = (viz.flame.aspect - 1) / 1.8
    const alive = viz.flame.alive && f.phase === 'burning'
    const flowNorm = Math.min(flow_cm_s / 40, 1)
    // buoyant plume over the flame: none at 0g, flatter at high flow
    const plume = alive ? gravity * (1 - 0.6 * flowNorm) * 0.5 : 0

    group.current.children.forEach((child, i) => {
      const l = lines[i]
      // parabolic profile: slower near the floor and near the side rails
      const profile =
        (0.45 + 0.55 * Math.min(l.y / 0.8, 1)) *
        (0.6 + 0.4 * (1 - Math.min((l.z / 1.5) * (l.z / 1.5), 1)))
      child.position.x += baseSpeed * profile * step
      if (child.position.x > FLOW_R) child.position.x = FLOW_L

      // deflection: streamlines bow upward over the burning zone
      let defl = 0
      const dx = child.position.x - f.x
      if (plume > 0.01 && dx > -0.3 && dx < 3) {
        const near = Math.max(0, 1 - Math.abs(l.z) / 1.0) * Math.max(0, 1 - l.y / 1.2)
        defl = plume * Math.sin((Math.PI * (dx + 0.3)) / 3) * near
      }
      child.position.y = l.y + defl
    })
  })

  return (
    <group ref={group}>
      {lines.map((l, i) => (
        <mesh key={i} position={[FLOW_L + (i % 6), l.y, l.z]}>
          <boxGeometry args={[l.len, 0.018, 0.018]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={visible ? 0.55 : 0} />
        </mesh>
      ))}
    </group>
  )
}

function Duct({
  material,
  viz,
  front,
}: {
  material: string
  viz: VizState
  front: { current: FrontState }
}) {
  const charRef = useRef<THREE.Mesh>(null)
  const emberRef = useRef<THREE.Group>(null)

  // procedural weave for the virgin cloth, procedural cracks for the char
  const weave = useMemo(() => {
    // cloth tint only tells materials apart on screen; it is not a material property
    const m = material.toLowerCase()
    const [a, b] = m.includes('nomex') ? ['#d9a441', '#f2c66a'] : m.includes('pmma') ? ['#cfe3ee', '#f4fbff'] : ['#e7e0d0', '#ffffff']
    return makeWeaveTexture(a, b)
  }, [material])
  const charTex = useMemo(() => makeCharTexture(), [])
  const honey = useMemo(() => makeHoneycombTexture(), [])
  const floorArrows = useMemo(() => makeFloorArrowTexture(), [])
  useEffect(() => () => weave.dispose(), [weave])
  useEffect(() => () => charTex.dispose(), [charTex])
  useEffect(() => () => honey.dispose(), [honey])
  useEffect(() => () => floorArrows.dispose(), [floorArrows])

  // char zone covers the burned region behind the sweep front; the char
  // texture repeat tracks the zone length so cracks never stretch
  useFrame((state) => {
    if (charRef.current) {
      const len = Math.max(0.001, front.current.x - -SAMPLE_HALF)
      charRef.current.scale.x = len
      charRef.current.position.x = -SAMPLE_HALF + len / 2
      charTex.repeat.x = len * 0.5
    }
    // ember line pulsing along the char boundary
    if (emberRef.current) {
      const f = front.current
      const alive = viz.flame.alive && f.phase === 'burning'
      const len = Math.max(0.001, f.x - -SAMPLE_HALF)
      emberRef.current.visible = alive && len > 0.05
      if (emberRef.current.visible) {
        const t = state.clock.elapsedTime
        emberRef.current.position.x = f.x
        emberRef.current.children.forEach((c, i) => {
          const s = 0.026 * (0.6 + 0.4 * Math.sin(t * 9 + i * 1.9))
          c.scale.setScalar(Math.max(s, 0.004))
        })
      }
    }
  })

  return (
    <group>
      {/* duct floor */}
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[11, 0.12, 3]} />
        <meshStandardMaterial color="#111827" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* painted airflow direction markers on the test section floor */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11, 3]} />
        <meshStandardMaterial map={floorArrows} transparent roughness={0.8} />
      </mesh>
      {/* low edge rails: keep the tunnel readable from any angle without
          glass walls blocking the view of the flame */}
      {[-1.5, 1.5].map((z) => (
        <mesh key={z} position={[0, 0.03, z]}>
          <boxGeometry args={[11, 0.05, 0.07]} />
          <meshStandardMaterial color="#0ea5e9" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      {/* fabric sample: virgin woven strip, char zone grows behind the front */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[4, 0.08, 0.9]} />
        <meshStandardMaterial map={weave} roughness={0.9} />
      </mesh>
      <mesh ref={charRef} position={[-SAMPLE_HALF, 0.043, 0]}>
        <boxGeometry args={[1, 0.086, 0.9]} />
        <meshStandardMaterial map={charTex} roughness={1} />
      </mesh>
      {/* sample holder clips at the four corners */}
      {([-2.0, 2.0] as const).flatMap((x) =>
        ([-0.42, 0.42] as const).map((z) => (
          <mesh key={`${x},${z}`} position={[x, 0.075, z]}>
            <boxGeometry args={[0.22, 0.055, 0.16]} />
            <meshStandardMaterial color="#a8b4c2" roughness={0.35} metalness={0.85} />
          </mesh>
        )),
      )}
      {/* ember line pulsing at the char boundary */}
      <group ref={emberRef} position={[-SAMPLE_HALF, 0.1, 0]} visible={false}>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[0, 0, -0.36 + i * 0.09]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#ff8a2a" />
          </mesh>
        ))}
      </group>
      {/* inlet cone and honeycomb flow straightener */}
      <mesh position={[FLOW_L - 0.4, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.35, 0.7, 24]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.4} />
      </mesh>
      <mesh position={[FLOW_L - 0.15, 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 0.98]} />
        <meshStandardMaterial
          map={honey}
          transparent
          side={THREE.DoubleSide}
          roughness={0.5}
          metalness={0.5}
        />
      </mesh>
    </group>
  )
}

type ViewMode = 'side' | 'top'

const SIDE_CAM = new THREE.Vector3(0, 3.2, 6.8)
const TOP_CAM = new THREE.Vector3(0, 9, 0.7)

// Snaps the camera to the preset for the selected view. OrbitControls keeps
// ownership after that (makeDefault), so the user can still drag from either.
function CameraRig({ view }: { view: ViewMode }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null

  useEffect(() => {
    const preset = view === 'top' ? TOP_CAM : SIDE_CAM
    camera.position.copy(preset)
    if (controls) {
      controls.target.set(0, 0.4, 0)
      controls.update()
    } else {
      camera.lookAt(0, 0.4, 0)
    }
  }, [view, camera, controls])

  return null
}

// Screen-space heat shimmer driven by buoyancy: off at 0g (diffusion
// dominated), grows with gravity and flow. Mask follows the flame front.
function HeatHazeLayer({
  viz,
  controls,
  front,
}: {
  viz: VizState
  controls: Controls
  front: { current: FrontState }
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const ref = useRef<Effect>(null)
  const world = useMemo(() => new THREE.Vector3(), [])
  const gravity = (viz.flame.aspect - 1) / 1.8

  useFrame((state) => {
    const e = ref.current
    if (!e) return
    const u = e.uniforms
    u.get('uTime')!.value = state.clock.elapsedTime
    u.get('uAspect')!.value = size.width / Math.max(size.height, 1)

    const burning = viz.flame.alive && front.current.phase === 'burning'
    const flowNorm = THREE.MathUtils.clamp(controls.flow_cm_s / 40, 0, 1)
    const target = burning ? gravity * (0.45 + 0.55 * flowNorm) : 0
    const cur = u.get('uStrength')!.value as number
    u.get('uStrength')!.value = cur + (target - cur) * 0.1

    world.set(front.current.x + 0.3, 0.5, 0).project(camera)
    const pos = u.get('uPos')!.value as { x: number; y: number }
    pos.x = world.x * 0.5 + 0.5
    pos.y = world.y * 0.5 + 0.5
  })

  return <HeatHaze ref={ref} />
}

function SceneContents({
  viz,
  controls,
  front,
  view,
  effects,
}: {
  viz: VizState
  controls: Controls
  front: { current: FrontState }
  view: ViewMode
  effects: 'full' | 'bloom' | 'none'
}) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 5]} intensity={0.7} />
      <Duct material={controls.material} viz={viz} front={front} />
      <FlowLines flow_cm_s={controls.flow_cm_s} viz={viz} front={front} />
      <Flame viz={viz} controls={controls} front={front} />
      <CameraRig view={view} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 0.4, 0]}
        minPolarAngle={view === 'top' ? 0.05 : 0.4}
        maxPolarAngle={1.45}
        minDistance={4}
        maxDistance={14}
      />
      {/* bloom makes the flame core glow; dropped on the Low quality setting */}
      {effects === 'full' && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.32} luminanceSmoothing={0.25} />
          <Vignette offset={0.28} darkness={0.75} />
          <HeatHazeLayer viz={viz} controls={controls} front={front} />
        </EffectComposer>
      )}
      {effects === 'bloom' && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.34} luminanceSmoothing={0.25} />
        </EffectComposer>
      )}
    </>
  )
}

export type SceneQuality = 'high' | 'balanced' | 'low'

/** The 3D scene only. Labels, rating and citations live in the panels that own them. */
export function Scene3D({ viz, controls, front, quality, paused, background }: {
  viz: VizState
  controls: Controls
  front: { current: FrontState }
  quality: SceneQuality
  paused: boolean
  background: string
}) {
  const [view, setView] = useState<ViewMode>('side')
  const dpr: [number, number] = quality === 'high' ? [1, 2] : quality === 'balanced' ? [1, 1.5] : [1, 1]
  return (
    <div className="scene-wrap">
      <Canvas camera={{ position: [0, 3.2, 6.8], fov: 42 }} dpr={dpr} frameloop={paused ? 'demand' : 'always'} gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}>
        <color attach="background" args={[background]} />
        <SceneContents viz={viz} controls={controls} front={front} view={view} effects={quality === 'high' ? 'full' : quality === 'balanced' ? 'bloom' : 'none'} />
      </Canvas>
      <div className="scene-view" role="group" aria-label="Camera view">
        {(['side', 'top'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={view === v ? 'seg on' : 'seg'}>
            {v === 'side' ? 'Side view' : 'Top-down view'}
          </button>
        ))}
      </div>
    </div>
  )
}

export default Scene3D
