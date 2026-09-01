import { arcPath } from "./scale"

/**
 * Visit share per traffic source.
 *
 * A donut is legitimate here because the parts genuinely sum to a whole and the
 * slice count is capped at six. Past that the angles stop being comparable, so
 * `toDonutSlices` folds the tail into a single "Other" rather than growing the
 * ring — and colour slots are assigned in fixed order, never cycled, so a
 * source keeps its colour when the date filter changes the series count.
 */

export type DonutSlice = {
  key: string
  label: string
  value: number
  share: number
}

export const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

export const OTHER_COLOR = "var(--chart-other)"

export function sliceColor(index: number, key: string): string {
  if (key === "__other") return OTHER_COLOR
  return SLICE_COLORS[index] ?? OTHER_COLOR
}

export function DonutChart({
  slices,
  size = 190,
  thickness = 30,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
}) {
  const radius = size / 2
  const inner = radius - thickness

  if (slices.length === 0) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="No data">
        <circle
          cx={radius}
          cy={radius}
          r={radius - thickness / 2}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          className="text-muted"
        />
      </svg>
    )
  }

  // Each slice starts where every slice before it ended. Computed as a prefix
  // sum rather than a running mutation so rendering stays a pure function of
  // the props.
  const arcs = slices.map((slice, i) => {
    const start = slices.slice(0, i).reduce((sum, s) => sum + (s.share / 100) * 360, 0)
    const sweep = (slice.share / 100) * 360
    return {
      ...slice,
      path: arcPath(radius, radius, radius, inner, start, start + sweep),
      color: sliceColor(i, slice.key),
    }
  })

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Visit share: ${slices.map((s) => `${s.label} ${s.share.toFixed(0)}%`).join(", ")}`}
    >
      {arcs.map((arc) => (
        <path
          key={arc.key}
          d={arc.path}
          fill={arc.color}
          // A surface-coloured ring separates touching segments; without it two
          // adjacent fills read as one larger slice.
          stroke="var(--card)"
          strokeWidth={2}
        >
          <title>{`${arc.label}: ${arc.value.toLocaleString()} (${arc.share.toFixed(1)}%)`}</title>
        </path>
      ))}

      {centerValue && (
        <text
          x={radius}
          y={radius - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground text-[22px] font-bold"
        >
          {centerValue}
        </text>
      )}
      {centerLabel && (
        <text
          x={radius}
          y={radius + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground text-[11px]"
        >
          {centerLabel}
        </text>
      )}
    </svg>
  )
}
