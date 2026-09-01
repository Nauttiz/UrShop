import { areaPath, compactNumber, labelStride, linePath, niceTicks } from "./scale"

/**
 * A single-metric time series, rendered on the server.
 *
 * Deliberately one measure per chart. Two measures on two y-scales is the most
 * common charting mistake — the crossing point is an artefact of the scales
 * rather than the data, so readers see a relationship that is not there. Visits
 * and revenue therefore get their own panels.
 *
 * ## Why the chrome is HTML and only the plot is SVG
 *
 * A server component cannot measure its container, so a plain `<svg viewBox>`
 * has to pick between two bad options: `preserveAspectRatio` letterboxes the
 * chart into a narrow strip in the middle of a wide card, or uniform scaling
 * blows the axis labels up along with the geometry.
 *
 * So nothing that must keep its size lives inside a scaled coordinate system.
 * Gridlines, tick labels and bars are absolutely-positioned HTML at percentage
 * offsets — they reflow to any width with type at a fixed 11px. Only the area
 * variant needs a real path, and that SVG is stretched with
 * `preserveAspectRatio="none"`; it contains no text and no corner radii, and
 * its stroke carries `vector-effect="non-scaling-stroke"` so the line stays 2px
 * at every width.
 */

export type SeriesPoint = {
  /** Machine key, e.g. "2026-08-30". */
  key: string
  /** Axis label, already formatted in the store's timezone. */
  label: string
  /**
   * `null` means "no data for this day", which is not the same as zero. Days
   * before tracking existed are drawn as a gap; a flat line along the baseline
   * would claim nobody visited, and reads as a broken chart.
   */
  value: number | null
}

export type TimeSeriesChartProps = {
  points: SeriesPoint[]
  variant?: "bars" | "area"
  /** Which categorical slot to paint with. */
  colorVar?: string
  height?: number
  /** Formats the y-axis ticks; defaults to a compact number. */
  formatValue?: (value: number) => string
  /** Rendered when every value is zero, instead of a flat line at the baseline. */
  emptyLabel?: string
}

/** Left gutter for y-axis labels and bottom strip for dates, both in CSS px. */
export const CHART_GEOMETRY = { axisWidth: 56, axisHeight: 22, topPad: 10 }

export function TimeSeriesChart({
  points,
  variant = "bars",
  colorVar = "var(--chart-1)",
  height = 220,
  formatValue = compactNumber,
  emptyLabel,
}: TimeSeriesChartProps) {
  const peak = points.reduce((max, p) => Math.max(max, p.value ?? 0), 0)

  // An all-zero chart is noise dressed as information — say so in words.
  if (points.length === 0 || peak === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-muted/30 text-sm text-muted-foreground"
        style={{ height }}
      >
        {emptyLabel ?? "No data in this range"}
      </div>
    )
  }

  const ticks = niceTicks(peak)
  const axisMax = ticks[ticks.length - 1]
  const stride = labelStride(points.length)

  const plotStyle = {
    left: CHART_GEOMETRY.axisWidth,
    right: 0,
    top: CHART_GEOMETRY.topPad,
    bottom: CHART_GEOMETRY.axisHeight,
  }

  return (
    <div
      className="relative w-full"
      style={{ height }}
      role="img"
      aria-label={`Time series over ${points.length} days, peak ${formatValue(peak)}`}
    >
      <div className="absolute" style={plotStyle}>
        {/* Gridlines sit behind the data and stay recessive — they orient the
            eye, they are not content. */}
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute border-t border-border"
            style={{ top: `${(1 - tick / axisMax) * 100}%`, left: 0, right: 0 }}
          />
        ))}

        {variant === "bars" ? (
          <div className="absolute inset-0 flex items-end">
            {points.map((p) => (
              <div key={p.key} className="h-full min-w-0 flex-1 px-px">
                <div className="flex h-full items-end">
                  {p.value !== null && (
                  <div
                    // The data end is rounded and the baseline end square, so
                    // the bar reads as anchored to the axis rather than
                    // floating above it.
                    className="w-full rounded-t-[3px]"
                    style={{
                      height: `${(p.value / axisMax) * 100}%`,
                      backgroundColor: colorVar,
                      // A hairline of the surface between neighbours; without
                      // it adjacent fills read as one continuous block.
                      minHeight: p.value > 0 ? 2 : 0,
                    }}
                  />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 1000 1000"
            // Stretched, not letterboxed: this SVG holds only geometry, so
            // non-uniform scaling costs nothing.
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d={areaPath(coordsOf(points, axisMax), 1000)} fill={colorVar} opacity={0.16} />
            <path
              d={linePath(coordsOf(points, axisMax))}
              fill="none"
              stroke={colorVar}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              // Keeps the stroke exactly 2px however far the x-axis is
              // stretched; without it the line would thicken with the card.
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      {/* Axis text lives outside every scaled coordinate system, so it is 11px
          on a phone and 11px on a wide monitor. */}
      <div
        className="absolute text-[11px] text-muted-foreground"
        style={{ left: 0, width: CHART_GEOMETRY.axisWidth - 8, top: plotStyle.top, bottom: plotStyle.bottom }}
      >
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2 tabular-nums"
            style={{ top: `${(1 - tick / axisMax) * 100}%` }}
          >
            {formatValue(tick)}
          </span>
        ))}
      </div>

      <div
        className="absolute bottom-0 text-[11px] text-muted-foreground"
        style={{ left: CHART_GEOMETRY.axisWidth, right: 0, height: CHART_GEOMETRY.axisHeight }}
      >
        {points.map((p, i) =>
          // A 365-day series cannot print 365 dates, so it prints every Nth.
          i % stride === 0 || i === points.length - 1 ? (
            <span
              key={p.key}
              className="absolute top-1 -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${((i + 0.5) / points.length) * 100}%` }}
            >
              {p.label}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

/**
 * Point coordinates in the plot's normalised 1000×1000 space.
 *
 * Days with no data contribute no vertex, so the line simply starts later
 * rather than climbing out of a fictional zero. The x positions of the days
 * that *do* have data are unchanged, so this panel still lines up column for
 * column with the one above it.
 */
function coordsOf(points: SeriesPoint[], axisMax: number) {
  const band = 1000 / points.length
  return points.flatMap((p, i) =>
    p.value === null
      ? []
      : [{ x: band * i + band / 2, y: 1000 - (Math.min(p.value, axisMax) / axisMax) * 1000 }]
  )
}
