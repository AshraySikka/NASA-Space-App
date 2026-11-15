/** Outcome markers: a colourblind-safe palette plus a distinct shape per outcome family. */
export function Marker({ shape, color, size = 6, x = 0, y = 0, hollow = false }: { shape: string; color: string; size?: number; x?: number; y?: number; hollow?: boolean }) {
  const s = size
  const common = { fill: hollow ? 'var(--panel)' : color, stroke: color, strokeWidth: 1.6 }
  const t = `translate(${x} ${y})`
  switch (shape) {
    case 'square':
      return <rect transform={t} x={-s * 0.85} y={-s * 0.85} width={s * 1.7} height={s * 1.7} {...common} />
    case 'triangle-down':
      return <path transform={t} d={`M${-s} ${-s * 0.8}L${s} ${-s * 0.8}L0 ${s}Z`} {...common} />
    case 'triangle-up':
      return <path transform={t} d={`M${-s} ${s * 0.8}L${s} ${s * 0.8}L0 ${-s}Z`} {...common} />
    case 'diamond':
      return <path transform={t} d={`M0 ${-s * 1.15}L${s * 1.15} 0L0 ${s * 1.15}L${-s * 1.15} 0Z`} {...common} />
    case 'cross':
      return <path transform={t} d={`M${-s} ${-s}L${s} ${s}M${-s} ${s}L${s} ${-s}`} stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    case 'ring':
      return <circle transform={t} r={s} fill="var(--panel)" stroke={color} strokeWidth={1.8} strokeDasharray="2.5 2" />
    default:
      return <circle transform={t} r={s} {...common} />
  }
}

export function MarkerIcon({ shape, color }: { shape: string; color: string }) {
  return (
    <svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden focusable="false">
      <Marker shape={shape} color={color} size={5.5} />
    </svg>
  )
}
