import { DonutChart, OTHER_COLOR, sliceColor } from "@/components/charts/donut-chart"
import { formatMoney } from "@/lib/money"
import { sourceLabel } from "@/lib/analytics/source"
import type { SourceRow, SourceSlice } from "@/lib/analytics/queries"

/**
 * Where the traffic came from, as a ring plus the numbers behind it.
 *
 * The donut earns its place because the parts genuinely sum to a whole (share
 * of visits) and the slice count is capped — past six, angles stop being
 * comparable, so `toDonutSlices` folds the tail into one "Other" rather than
 * growing the ring. Anything the eye cannot judge from an angle is read off the
 * table beside it, which carries the real numbers.
 *
 * Colour is assigned by rank within the current range, so a source can change
 * colour when the date filter reorders it. That is the accepted cost of a
 * top-N ring: every slice is directly labelled in the same row as its swatch,
 * so identity is never carried by colour alone.
 */

export function TrafficSources({
  rows,
  slices,
  totalVisits,
  currency,
}: {
  rows: SourceRow[]
  slices: SourceSlice[]
  totalVisits: number
  currency: string
}) {
  const colorByKey = new Map(slices.map((slice, i) => [slice.key, sliceColor(i, slice.key)]))

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No traffic recorded in this range yet.
      </p>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
      <div className="flex flex-col items-center gap-4 lg:w-[210px]">
        <DonutChart
          slices={slices}
          centerValue={totalVisits.toLocaleString()}
          centerLabel={totalVisits === 1 ? "visit" : "visits"}
        />

        {/* A legend is present for two or more series, so identity never rests
            on colour alone. */}
        {slices.length >= 2 && (
          <ul className="grid w-full gap-1.5">
            {slices.map((slice, i) => (
              <li key={slice.key} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: sliceColor(i, slice.key) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{slice.share.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <table className="w-full min-w-110 text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Source
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Visits
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Purchases
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Conv.
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const unattributed = row.key === null
              const color = unattributed ? OTHER_COLOR : colorByKey.get(row.key!)

              return (
                <tr
                  key={row.key ?? "__unattributed"}
                  className={`border-b border-border/60 last:border-0 ${
                    unattributed ? "text-muted-foreground" : ""
                  }`}
                >
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        // Sources outside the ring keep a swatch, drawn in the
                        // neutral so the row still aligns with the ones above.
                        style={{ backgroundColor: color ?? "var(--muted-foreground)", opacity: color ? 1 : 0.35 }}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">
                        {unattributed ? "(unattributed)" : sourceLabel(row.key!)}
                      </span>
                    </span>
                  </th>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {row.visits.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{row.purchases}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {/* Never a division by zero, and never a nonsense 900%: a
                        buyer whose session started before the window has a
                        purchase with no matching visit. */}
                    {row.conversion === null ? "—" : `${row.conversion.toFixed(1)}%`}
                  </td>
                  <td className="py-2.5 text-right font-medium tabular-nums">
                    {row.revenue > 0 ? formatMoney(row.revenue, currency) : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.some((r) => r.key === null) && (
          <p className="mt-3 text-xs text-muted-foreground">
            Unattributed orders come from buyers who blocked cookies, or who bought before traffic
            tracking was switched on. They are listed so this table&rsquo;s revenue still adds up to
            the total above.
          </p>
        )}
      </div>
    </div>
  )
}
