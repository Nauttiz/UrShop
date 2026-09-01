/**
 * Day bucketing and date-range parsing for analytics.
 *
 * Everything is expressed as a **day key** — the `YYYY-MM-DD` string for a
 * calendar day *in the store's timezone*. Visits persist that day as a DATE
 * column, so the dashboard compares DATE to DATE and the per-day series stays
 * an index-only scan. Converting at read time instead would need CONVERT_TZ()
 * or a per-row pass, and either one throws away the index.
 */

export type DayKey = string // "YYYY-MM-DD"

export const RANGE_PRESETS = [7, 30, 90, 365] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const DEFAULT_PRESET: RangePreset = 30
/** Hard ceiling so a hand-edited URL cannot ask for a decade of rows. */
export const MAX_RANGE_DAYS = 366

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/**
 * Milliseconds the zone is ahead of UTC at a given instant.
 *
 * Formats the instant in the target zone, reads the wall-clock fields back as
 * though they were UTC, and takes the difference — the standard way to get a
 * zone offset from `Intl` without shipping a timezone library.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at)

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)

  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  )
  return asUtc - at.getTime()
}

/** Falls back to UTC for an unknown zone rather than throwing mid-request. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone })
    return true
  } catch {
    return false
  }
}

/** The calendar day an instant falls on, in the store's timezone. */
export function dayKeyInTimeZone(at: Date, timeZone: string): DayKey {
  // "en-CA" formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

/**
 * The UTC-midnight Date that MySQL stores for a DATE column.
 *
 * Prisma reads `@db.Date` back as midnight UTC, so writes must match or a
 * round-trip would shift the day.
 */
export function dayKeyToDate(key: DayKey): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export function dateToDayKey(date: Date): DayKey {
  return date.toISOString().slice(0, 10)
}

/**
 * The exact instant a calendar day begins in the given zone.
 *
 * Used to bound order queries, whose `createdAt` is a real timestamp rather
 * than a DATE. The second offset lookup handles days that begin inside a DST
 * transition, where the first guess lands in the wrong offset.
 */
export function zonedStartOfDay(key: DayKey, timeZone: string): Date {
  const utcMidnight = dayKeyToDate(key)
  const firstGuess = new Date(utcMidnight.getTime() - zoneOffsetMs(utcMidnight, timeZone))
  const refined = zoneOffsetMs(firstGuess, timeZone)
  return new Date(utcMidnight.getTime() - refined)
}

export function addDaysToKey(key: DayKey, days: number): DayKey {
  return dateToDayKey(new Date(dayKeyToDate(key).getTime() + days * MS_PER_DAY))
}

export function daysBetweenKeys(from: DayKey, to: DayKey): number {
  return Math.round((dayKeyToDate(to).getTime() - dayKeyToDate(from).getTime()) / MS_PER_DAY)
}

/** Every day key from `from` to `to`, inclusive — the zero-fill spine for a series. */
export function eachDayKey(from: DayKey, to: DayKey): DayKey[] {
  const keys: DayKey[] = []
  const span = daysBetweenKeys(from, to)
  for (let i = 0; i <= span; i++) keys.push(addDaysToKey(from, i))
  return keys
}

export type AnalyticsRange = {
  /** Inclusive first day, in store time. */
  fromKey: DayKey
  /** Inclusive last day, in store time. */
  toKey: DayKey
  /** UTC-midnight Dates for comparing against the DATE column. */
  fromDay: Date
  toDay: Date
  /** Absolute instants bounding the same span, for timestamp columns. */
  from: Date
  toExclusive: Date
  /** Inclusive day count. */
  days: number
  /** Set when the range came from a preset rather than explicit dates. */
  preset: RangePreset | null
  timeZone: string
}

function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string" || !DAY_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  // Rejects "2026-02-31", which Date would silently roll into March.
  return !Number.isNaN(parsed.getTime()) && dateToDayKey(parsed) === value
}

function buildRange(fromKey: DayKey, toKey: DayKey, preset: RangePreset | null, timeZone: string): AnalyticsRange {
  return {
    fromKey,
    toKey,
    fromDay: dayKeyToDate(fromKey),
    toDay: dayKeyToDate(toKey),
    from: zonedStartOfDay(fromKey, timeZone),
    toExclusive: zonedStartOfDay(addDaysToKey(toKey, 1), timeZone),
    days: daysBetweenKeys(fromKey, toKey) + 1,
    preset,
    timeZone,
  }
}

function presetRange(days: RangePreset, todayKey: DayKey, timeZone: string): AnalyticsRange {
  return buildRange(addDaysToKey(todayKey, -(days - 1)), todayKey, days, timeZone)
}

/**
 * Resolves `?range=` / `?from=&to=` into a concrete window.
 *
 * Total by construction — every malformed, inverted, future or oversized input
 * degrades to the default preset. A seller editing the URL by hand gets a
 * chart, not a 500.
 */
export function parseRange(
  params: { range?: string; from?: string; to?: string },
  timeZone: string,
  now: Date = new Date()
): AnalyticsRange {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC"
  const todayKey = dayKeyInTimeZone(now, zone)

  // Explicit dates win over a preset when both are present and usable.
  if (isDayKey(params.from) && isDayKey(params.to)) {
    let fromKey = params.from
    let toKey = params.to

    if (daysBetweenKeys(fromKey, toKey) < 0) [fromKey, toKey] = [toKey, fromKey]
    // No data can exist after today, and an open-ended future range would
    // stretch the axis over empty space.
    if (daysBetweenKeys(toKey, todayKey) < 0) toKey = todayKey

    // The whole window is in the future — a mistyped year, most likely. After
    // clamping there is nothing left to plot, so fall through to the default
    // preset rather than silently rendering a one-day chart of today.
    if (daysBetweenKeys(fromKey, toKey) >= 0) {
      if (daysBetweenKeys(fromKey, toKey) + 1 > MAX_RANGE_DAYS) {
        fromKey = addDaysToKey(toKey, -(MAX_RANGE_DAYS - 1))
      }
      return buildRange(fromKey, toKey, null, zone)
    }
  }

  const requested = Number(params.range)
  const preset = RANGE_PRESETS.find((p) => p === requested) ?? DEFAULT_PRESET
  return presetRange(preset, todayKey, zone)
}

/** Axis tick label, rendered server-side so it cannot disagree with the buckets. */
export function formatDayLabel(
  key: DayKey,
  timeZone: string,
  style: "short" | "long" = "short"
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", // the key is already store-local; treat it as a plain date
    day: "numeric",
    month: style === "long" ? "long" : "short",
    ...(style === "long" ? { year: "numeric" } : {}),
  }).format(dayKeyToDate(key))
}

/**
 * Both ends of a range, as one label.
 *
 * The year appears only when the two ends disagree on it. Without that rule a
 * range clamped to the 366-day ceiling renders as "31 Aug – 31 Aug", which
 * reads as a single day rather than a full year.
 */
export function formatDayRange(from: DayKey, to: DayKey, timeZone: string): string {
  const style = from.slice(0, 4) === to.slice(0, 4) ? "short" : "long"
  return `${formatDayLabel(from, timeZone, style)} – ${formatDayLabel(to, timeZone, style)}`
}

/**
 * The equally-long window immediately before a range, for period-over-period
 * deltas on the stat cards.
 */
export function previousRange(range: AnalyticsRange): AnalyticsRange {
  const toKey = addDaysToKey(range.fromKey, -1)
  const fromKey = addDaysToKey(toKey, -(range.days - 1))
  return buildRange(fromKey, toKey, null, range.timeZone)
}
