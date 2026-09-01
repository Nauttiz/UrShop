import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

/**
 * A headline number with its period-over-period change.
 *
 * The number is the content, so it wears text tokens rather than a series
 * colour; only the small delta chip is tinted, and it carries an arrow so the
 * direction survives a colourblind reader or a greyscale print.
 */

export type StatCardProps = {
  label: string
  value: string
  /** Same metric over the immediately preceding window, for the delta. */
  current?: number
  previous?: number
  /** True where a decrease is the good outcome (refunds, bounce). */
  lowerIsBetter?: boolean
  hint?: string
}

function deltaOf(current: number, previous: number): number | null {
  // Growing from nothing has no meaningful percentage — 0 → 5 is not "+500%",
  // it is "there was nothing before". Rendering a dash is the honest answer.
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function StatCard({ label, value, current, previous, lowerIsBetter, hint }: StatCardProps) {
  const delta =
    current !== undefined && previous !== undefined ? deltaOf(current, previous) : null

  const up = delta !== null && delta > 0
  const flat = delta !== null && Math.abs(delta) < 0.5
  const good = lowerIsBetter ? !up : up

  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>

        {delta === null ? (
          <p className="text-xs text-muted-foreground">{hint ?? "No prior period"}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium ${
                flat
                  ? "bg-muted text-muted-foreground"
                  : good
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
              }`}
            >
              {!flat &&
                (up ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3 w-3" aria-hidden />
                ))}
              {flat ? "flat" : `${up ? "+" : ""}${delta.toFixed(0)}%`}
            </span>
            <span className="text-muted-foreground">{hint ?? "vs previous period"}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
