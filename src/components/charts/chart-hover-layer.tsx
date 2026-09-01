"use client"

import { useRef, useState } from "react"
import { CHART_GEOMETRY } from "./time-series-chart"

/**
 * Crosshair and tooltip for a server-rendered chart.
 *
 * The chart itself stays a server component and arrives as `children`, so it
 * paints with the first byte. This wrapper is the only client JavaScript in the
 * chart set — it does nothing but map a pointer position to a data index and
 * position a div. If it never hydrates, the chart is still completely readable.
 */

export type HoverPoint = {
  label: string
  rows: { name: string; value: string; color?: string }[]
}

export function ChartHoverLayer({
  points,
  height,
  children,
}: {
  points: HoverPoint[]
  height: number
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState<number | null>(null)

  if (points.length === 0) return <>{children}</>

  /** Plot geometry in CSS pixels — the chart no longer uses a scaled viewBox. */
  const plot = (el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    return { left: rect.left + CHART_GEOMETRY.axisWidth, width: rect.width - CHART_GEOMETRY.axisWidth }
  }

  const indexFromClientX = (clientX: number): number | null => {
    const el = ref.current
    if (!el) return null
    const { left, width } = plot(el)
    if (width <= 0) return null

    const x = clientX - left
    if (x < 0 || x > width) return null
    return Math.min(points.length - 1, Math.max(0, Math.floor((x / width) * points.length)))
  }

  const active = index !== null ? points[index] : null
  /** Centre of the active band, as a percentage of the whole component. */
  const bandCenter = index === null ? 0 : ((index + 0.5) / points.length) * 100

  return (
    <div
      ref={ref}
      className="relative"
      onPointerMove={(e) => setIndex(indexFromClientX(e.clientX))}
      onPointerLeave={() => setIndex(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault()
          setIndex((i) => Math.min(points.length - 1, (i ?? -1) + 1))
        } else if (e.key === "ArrowLeft") {
          e.preventDefault()
          setIndex((i) => Math.max(0, (i ?? points.length) - 1))
        } else if (e.key === "Escape") {
          setIndex(null)
        }
      }}
      tabIndex={0}
      role="application"
      aria-label="Chart. Use the left and right arrow keys to read individual days."
    >
      {children}

      {active && (
        <>
          <div
            className="pointer-events-none absolute w-px bg-foreground/25"
            style={{
              // Positioned inside the plot area, which starts after the y-axis
              // gutter — hence the offset rather than a bare percentage.
              left: `calc(${CHART_GEOMETRY.axisWidth}px + (100% - ${CHART_GEOMETRY.axisWidth}px) * ${bandCenter / 100})`,
              top: CHART_GEOMETRY.topPad,
              height: height - CHART_GEOMETRY.topPad - CHART_GEOMETRY.axisHeight,
            }}
          />
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 shadow-lg"
            style={{
              // Clamped so the tooltip stays inside the card at both ends.
              left: `clamp(90px, calc(${CHART_GEOMETRY.axisWidth}px + (100% - ${CHART_GEOMETRY.axisWidth}px) * ${bandCenter / 100}), calc(100% - 90px))`,
            }}
          >
            <p className="text-xs font-medium text-muted-foreground">{active.label}</p>
            <div className="mt-1 space-y-0.5">
              {active.rows.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {row.color && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                    )}
                    {row.name}
                  </span>
                  <span className="font-semibold tabular-nums">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* The same numbers as a real table, for screen readers and for anyone who
          cannot use a pointer. */}
      <table className="sr-only">
        <caption>Chart data</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              {point.rows.map((row) => (
                <td key={row.name}>
                  {row.name}: {row.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
