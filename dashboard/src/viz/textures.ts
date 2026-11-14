// Procedural canvas textures: no external assets, everything generated in
// the browser at load. Used for the cloth weave, the char cracks, and the
// honeycomb flow straightener at the inlet.

import * as THREE from 'three'

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  return [c, g]
}

function finish(c: HTMLCanvasElement, repeat: [number, number]): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat[0], repeat[1])
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Fabric weave: crossing threads with slight variation and fiber noise. */
export function makeWeaveTexture(base: string, thread: string): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)

  // over-under weave: alternate thread direction per cell
  const cell = 32
  for (let i = 0; i < 256 / cell; i++) {
    for (let j = 0; j < 256 / cell; j++) {
      const horizontal = (i + j) % 2 === 0
      g.fillStyle = thread
      g.globalAlpha = 0.28
      if (horizontal) {
        g.fillRect(i * cell, j * cell + 6, cell, cell - 12)
        g.globalAlpha = 0.14
        g.fillRect(i * cell, j * cell + 4, cell, 2)
      } else {
        g.fillRect(i * cell + 6, j * cell, cell - 12, cell)
        g.globalAlpha = 0.14
        g.fillRect(i * cell + 4, j * cell, 2, cell)
      }
      g.globalAlpha = 1
    }
  }

  // fiber noise
  for (let k = 0; k < 2600; k++) {
    g.globalAlpha = 0.05 + Math.random() * 0.07
    g.fillStyle = Math.random() > 0.5 ? '#000000' : '#ffffff'
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1)
  }
  g.globalAlpha = 1
  return finish(c, [4, 1])
}

/** Charred cloth: matte near-black with cracks and ash speckles. */
export function makeCharTexture(): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256)
  g.fillStyle = '#25211d'
  g.fillRect(0, 0, 256, 256)

  // cracks: dark branching strokes
  g.strokeStyle = '#0b0a09'
  g.lineWidth = 2.5
  for (let k = 0; k < 26; k++) {
    let x = Math.random() * 256
    let y = Math.random() * 256
    g.beginPath()
    g.moveTo(x, y)
    const steps = 3 + Math.floor(Math.random() * 4)
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 70
      y += (Math.random() - 0.5) * 40
      g.lineTo(x, y)
    }
    g.stroke()
  }

  // ash speckle: lighter flecks on the ridges between cracks
  for (let k = 0; k < 900; k++) {
    g.globalAlpha = 0.06 + Math.random() * 0.1
    g.fillStyle = Math.random() > 0.35 ? '#4b443c' : '#5c5148'
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
  }
  g.globalAlpha = 1
  return finish(c, [1, 1]) // repeat.x driven per frame to keep density steady
}

/** Floor paint: airflow direction chevrons and a label, drawn at the duct
 *  floor aspect (11 x 3). Left of the canvas is upstream (lower x), and
 *  chevrons point downstream (+x). Center-lane marks stop where the sample
 *  sits so nothing paints under the cloth. */
export function makeFloorArrowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 880
  c.height = 240
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 880, 240)
  g.lineCap = 'round'
  g.lineJoin = 'round'

  const chevron = (cx: number, cy: number, color: string, alpha: number) => {
    g.strokeStyle = color
    g.globalAlpha = alpha
    g.lineWidth = 10
    g.beginPath()
    g.moveTo(cx - 14, cy - 16)
    g.lineTo(cx + 14, cy)
    g.lineTo(cx - 14, cy + 16)
    g.stroke()
    g.globalAlpha = 1
  }

  // side lanes beside the sample: full-length chevron rows
  for (const cy of [60, 180]) {
    for (let cx = 46; cx < 860; cx += 100) chevron(cx, cy, '#38bdf8', 0.8)
  }

  // center lane: label upstream, chevrons only downstream of the sample
  g.globalAlpha = 0.55
  g.fillStyle = '#7dd3fc'
  g.font = 'bold 24px monospace'
  g.fillText('AIRFLOW', 44, 129)
  g.globalAlpha = 1
  for (let cx = 626; cx < 860; cx += 100) chevron(cx, 120, '#7dd3fc', 0.5)

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Honeycomb flow straightener grid, transparent between the cell walls.
 *  Canvas is drawn at the plane's aspect (2.4 x 0.98) so cells stay regular. */
export function makeHoneycombTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 208
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 512, 208)
  g.strokeStyle = '#5b6b7d'
  g.lineWidth = 4
  g.lineCap = 'round'

  const r = 18 // hex radius
  const hex = (cx: number, cy: number) => {
    g.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    g.stroke()
  }
  const dx = r * Math.sqrt(3)
  const dy = r * 1.5
  for (let row = -1; row * dy < 208 + r; row++) {
    for (let col = -1; col * dx < 512 + dx; col++) {
      hex(col * dx + (row % 2 ? dx / 2 : 0), row * dy)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
