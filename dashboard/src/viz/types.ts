// What the 3D scene needs to draw. Nothing here is a measurement: the flame is an
// illustration driven by the outcome recorded for the nearest real test.

export interface SceneControls {
  flow_cm_s: number
  o2_pct: number
  gravity_g: number // 0 = microgravity look, 1 = Earth look (teardrop, smoke)
  material: string
}

export type FlameMode = 'steady' | 'fade' | 'blow' | 'flash' | 'ghost'

export interface VizState {
  mode: FlameMode
  /** Illustrative sweep speed of the animation. Not a spread rate. */
  anim_speed: number
  /** Fraction of the sample the animated front crosses before the flame dies (1 = whole sample). */
  stop_at: number
  flame: {
    alive: boolean
    length: number
    tilt_deg: number
    aspect: number
    intensity: number
  }
}
