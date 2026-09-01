import { ChartHoverLayer, type HoverPoint } from "@/components/charts/chart-hover-layer"
import { TimeSeriesChart } from "@/components/charts/time-series-chart"
import { formatDayLabel, type DayKey } from "@/lib/analytics/dates"
import type { DailyPoint } from "@/lib/analytics/queries"
import { formatMoney } from "@/lib/money"

/**
 * Sales and traffic over the selected range, as two stacked small multiples
 * sharing one x-axis.
 *
 * They are deliberately *not* one chart with two y-axes. Visits and revenue
 * have unrelated units, so a second axis would let the two lines be slid past
 * each other at will — the crossing point becomes an artefact of the chosen
 * scales, and readers see a relationship that is not in the data. Stacking two
 * panels over the same dates answers the same question ("did traffic move with
 * sales?") without inventing one.
 *
 * Both panels render entirely on the server. `ChartHoverLayer` is the only
 * client component involved and it adds nothing but the crosshair; with
 * JavaScript off, or before hydration, the charts are already complete and
 * readable.
 */

const VISITS_COLOR = "var(--chart-1)"
const REVENUE_COLOR = "var(--chart-3)"

export type SalesTrafficChartProps = {
  points: DailyPoint[]
  currency: string
  timeZone: string
  /** First day this store ever recorded a visit; null when tracking is brand new. */
  firstVisitDay: DayKey | null
  height?: number
}

export function SalesTrafficChart({
  points,
  currency,
  timeZone,
  firstVisitDay,
  height = 200,
}: SalesTrafficChartProps) {
  const labelled = points.map((p) => ({
    key: p.day,
    label: formatDayLabel(p.day, timeZone),
    point: p,
  }))

  // Before tracking existed there is no such thing as "zero visits" — there is
  // no data. Plotting a flat line along the baseline would read as a broken
  // chart, so the panel says what actually happened instead.
  const trackingCovers =
    firstVisitDay !== null && points.length > 0 && firstVisitDay <= points[points.length - 1].day
  const trackingStartsMidRange = trackingCovers && firstVisitDay! > points[0].day

  const revenuePoints: HoverPoint[] = labelled.map(({ label, point }) => ({
    label,
    rows: [
      { name: "Revenue", value: formatMoney(point.revenue, currency), color: REVENUE_COLOR },
      { name: "Orders", value: String(point.orders) },
    ],
  }))

  /** `null` before tracking began, so those days render as a gap, not a zero. */
  const visitValue = (point: DailyPoint): number | null =>
    firstVisitDay !== null && point.day < firstVisitDay ? null : point.visits

  const visitPoints: HoverPoint[] = labelled.map(({ label, point }) => {
    const value = visitValue(point)
    return {
      label,
      rows: [
        {
          name: "Visits",
          value: value === null ? "not tracked" : value.toLocaleString(),
          color: VISITS_COLOR,
        },
      ],
    }
  })

  return (
    <div className="space-y-6">
      <Panel
        title="Revenue"
        swatch={REVENUE_COLOR}
        total={formatMoney(
          points.reduce((sum, p) => sum + p.revenue, 0),
          currency
        )}
      >
        <ChartHoverLayer points={revenuePoints} height={height}>
          <TimeSeriesChart
            points={labelled.map(({ key, label, point }) => ({ key, label, value: point.revenue }))}
            variant="bars"
            colorVar={REVENUE_COLOR}
            height={height}
            formatValue={(value) => formatMoney(value, currency)}
            emptyLabel="No paid orders in this range"
          />
        </ChartHoverLayer>
      </Panel>

      <Panel
        title="Store visits"
        swatch={VISITS_COLOR}
        total={points.reduce((sum, p) => sum + p.visits, 0).toLocaleString()}
        note={
          trackingStartsMidRange
            ? `Tracking started ${formatDayLabel(firstVisitDay!, timeZone, "long")}`
            : undefined
        }
      >
        {trackingCovers ? (
          <ChartHoverLayer points={visitPoints} height={height}>
            <TimeSeriesChart
              points={labelled.map(({ key, label, point }) => ({
                key,
                label,
                value: visitValue(point),
              }))}
              variant="area"
              colorVar={VISITS_COLOR}
              height={height}
              emptyLabel="No visits recorded in this range"
            />
          </ChartHoverLayer>
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-md bg-muted/40 text-center text-sm text-muted-foreground"
            style={{ height }}
          >
            <p className="font-medium text-foreground">Traffic tracking has no data yet</p>
            <p className="max-w-sm text-xs">
              Visits are recorded from the moment a buyer opens your storefront. Share your store
              link and this chart fills in.
            </p>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Panel({
  title,
  swatch,
  total,
  note,
  children,
}: {
  title: string
  swatch: string
  total: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: swatch }} aria-hidden />
          {title}
        </h3>
        <div className="flex items-baseline gap-2">
          {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
          <span className="text-base font-semibold tabular-nums">{total}</span>
        </div>
      </div>
      {children}
    </section>
  )
}
