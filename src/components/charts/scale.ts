/**
 * Chart geometry. Pure maths — no React, no DOM — so the SVG components can
 * stay server-rendered and this stays trivially checkable.
 */

/**
 * Axis ticks on round numbers (1, 2, 2.5, 5, 10 × a power of ten).
 *
 * A max of 137 becomes ticks at 0/50/100/150, not 0/34.25/68.5. Readers anchor
 * on the gridline values, so arbitrary ones make a chart harder to read than no
 * gridlines at all.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]

  const rawStep = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalised = rawStep / magnitude

  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) * magnitude

  const ticks: number[] = []
  for (let value = 0; value <= max + step * 0.001; value += step) {
    // Kill float drift so 0.30000000000000004 never reaches a label.
    ticks.push(Math.round(value * 1e6) / 1e6)
  }
  return ticks.length >= 2 ? ticks : [0, step]
}

export type Box = { width: number; height: number; top: number; right: number; bottom: number; left: number }

export function plotArea(box: Box) {
  return {
    x: box.left,
    y: box.top,
    width: Math.max(1, box.width - box.left - box.right),
    height: Math.max(1, box.height - box.top - box.bottom),
  }
}

/** Maps a value in [0, max] to a y pixel, with y growing downward. */
export function yScale(value: number, max: number, area: { y: number; height: number }): number {
  if (max <= 0) return area.y + area.height
  const clamped = Math.max(0, Math.min(value, max))
  return area.y + area.height - (clamped / max) * area.height
}

/** Evenly spaced band centres — one per data point. */
export function bandCentres(count: number, area: { x: number; width: number }): number[] {
  if (count <= 0) return []
  const band = area.width / count
  return Array.from({ length: count }, (_, i) => area.x + band * i + band / 2)
}

export function bandWidth(count: number, area: { width: number }, gap = 2): number {
  if (count <= 0) return 0
  // The 2px gap is a surface-coloured spacer between adjacent bars; without it
  // neighbouring fills read as one continuous block.
  return Math.max(1, area.width / count - gap)
}

/** SVG path for a line through points, with no smoothing. */
export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ""
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
}

/** Closed path for the filled region under a line. */
export function areaPath(points: { x: number; y: number }[], baselineY: number): string {
  if (points.length === 0) return ""
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath(points)} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`
}

/**
 * A bar with a rounded top and a square base.
 *
 * The data end is rounded; the baseline end stays flat so the bar reads as
 * anchored to the axis rather than floating above it. The radius collapses on
 * very short bars, which would otherwise render as a lozenge.
 */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) return ""
  const r = Math.min(radius, width / 2, height)
  const baseline = y + height
  return [
    `M${x.toFixed(2)},${baseline.toFixed(2)}`,
    `L${x.toFixed(2)},${(y + r).toFixed(2)}`,
    `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + r).toFixed(2)},${y.toFixed(2)}`,
    `L${(x + width - r).toFixed(2)},${y.toFixed(2)}`,
    `Q${(x + width).toFixed(2)},${y.toFixed(2)} ${(x + width).toFixed(2)},${(y + r).toFixed(2)}`,
    `L${(x + width).toFixed(2)},${baseline.toFixed(2)}`,
    "Z",
  ].join(" ")
}

/**
 * A donut segment. Angles are clockwise from twelve o'clock, which is where a
 * reader expects a pie to start.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  // A full circle cannot be drawn as a single arc — its start and end points
  // coincide, so the renderer draws nothing at all. Split it in two.
  const sweep = endAngle - startAngle
  if (sweep >= 359.999) {
    const half = startAngle + 180
    return `${arcPath(cx, cy, outerR, innerR, startAngle, half)} ${arcPath(cx, cy, outerR, innerR, half, endAngle)}`
  }

  const p = (r: number, angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  const largeArc = sweep > 180 ? 1 : 0
  const o1 = p(outerR, startAngle)
  const o2 = p(outerR, endAngle)
  const i2 = p(innerR, endAngle)
  const i1 = p(innerR, startAngle)

  return [
    `M${o1.x.toFixed(2)},${o1.y.toFixed(2)}`,
    `A${outerR},${outerR} 0 ${largeArc} 1 ${o2.x.toFixed(2)},${o2.y.toFixed(2)}`,
    `L${i2.x.toFixed(2)},${i2.y.toFixed(2)}`,
    `A${innerR},${innerR} 0 ${largeArc} 0 ${i1.x.toFixed(2)},${i1.y.toFixed(2)}`,
    "Z",
  ].join(" ")
}

/** Compact axis labels: 12500 → "12.5k". */
export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${trimZero(value / 1_000_000)}M`
  if (Math.abs(value) >= 1_000) return `${trimZero(value / 1_000)}k`
  return trimZero(value)
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * How many x labels fit without colliding — a 365-day series cannot print 365
 * dates, so it prints every Nth.
 */
export function labelStride(count: number, maxLabels = 7): number {
  return Math.max(1, Math.ceil(count / maxLabels))
}
