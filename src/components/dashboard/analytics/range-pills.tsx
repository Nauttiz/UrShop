import Link from "next/link"
import { RANGE_PRESETS, formatDayRange, type AnalyticsRange } from "@/lib/analytics/dates"

/**
 * The date-range control: preset links plus a custom `from`/`to` form.
 *
 * Both halves are plain HTML. The pills are `<Link>`s and the custom range is a
 * GET `<form>`, so the whole control server-renders, needs no hydration, and
 * keeps working with JavaScript disabled. The range lives entirely in the URL,
 * which also makes it shareable, bookmarkable and back-button correct.
 *
 * The dual-month calendar from a hosted SaaS is deliberately not reproduced:
 * `<input type="date">` is already localised, keyboard-accessible and opens the
 * platform picker on mobile, for none of the ~350 lines a hand-written grid
 * would cost.
 */

const PRESET_LABELS: Record<number, string> = {
  7: "7 days",
  30: "30 days",
  90: "90 days",
  365: "12 months",
}

export function RangePills({ basePath, range }: { basePath: string; range: AnalyticsRange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {RANGE_PRESETS.map((preset) => {
          const active = range.preset === preset
          return (
            <Link
              key={preset}
              href={`${basePath}?range=${preset}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {PRESET_LABELS[preset] ?? `${preset} days`}
            </Link>
          )
        })}
      </div>

      <details className="group relative">
        <summary
          className={`flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted ${
            range.preset === null ? "border-foreground/40 bg-muted" : ""
          }`}
        >
          <CalendarGlyph />
          {range.preset === null
            ? formatDayRange(range.fromKey, range.toKey, range.timeZone)
            : "Custom range"}
        </summary>

        <form
          action={basePath}
          method="get"
          className="absolute right-0 z-20 mt-2 w-max rounded-xl border bg-popover p-3 shadow-lg"
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              From
              <input
                type="date"
                name="from"
                defaultValue={range.fromKey}
                max={range.toKey}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              To
              <input
                type="date"
                name="to"
                defaultValue={range.toKey}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Apply
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Days are counted in {range.timeZone.replace(/_/g, " ")}.
          </p>
        </form>
      </details>
    </div>
  )
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}
