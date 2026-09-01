import { OrderStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { dayKeyInTimeZone, dateToDayKey, eachDayKey, type AnalyticsRange, type DayKey } from "./dates"
import { DIRECT, sourceLabel } from "./source"

/**
 * Every dashboard analytics read.
 *
 * All queries carry an explicit `storeId`, matching the tenancy convention used
 * throughout the codebase — a store owner can never see another store's data,
 * and the id always comes from the authenticated session, never from the URL.
 */

/** Revenue counts paid and fulfilled orders; a refund removes both automatically. */
const REVENUE_STATUSES = [OrderStatus.PAID, OrderStatus.FULFILLED]

export type DailyPoint = {
  day: DayKey
  visits: number
  orders: number
  revenue: number
}

/**
 * Visits per calendar day.
 *
 * Uses `[storeId, day, source]` as a covering, index-only scan: equality on
 * storeId, range on day, and the GROUP BY satisfied by the index's own ordering
 * so MySQL needs no filesort and no temp table. Verified — `EXPLAIN` reports
 * `Using where; Using index` on that index, and 273 days over 185k visits
 * returned in 75 ms.
 */
export async function dailyVisits(storeId: string, range: AnalyticsRange): Promise<Map<DayKey, number>> {
  const rows = await prisma.visit.groupBy({
    by: ["day"],
    where: { storeId, day: { gte: range.fromDay, lte: range.toDay } },
    _count: { _all: true },
    orderBy: { day: "asc" },
  })

  return new Map(rows.map((r) => [dateToDayKey(r.day), r._count._all]))
}

export type OrdersInRange = {
  byDay: Map<DayKey, { orders: number; revenue: number }>
  totalOrders: number
  totalRevenue: number
}

/**
 * Orders per calendar day, bucketed in JS rather than by the database.
 *
 * The asymmetry with visits is deliberate. Visits are unbounded per store, so
 * they must be aggregated in SQL. Orders are bounded by actual sales — a busy
 * store yields a few thousand two-column rows across a whole year, which costs
 * single-digit milliseconds to fold. Adding an `Order.day` column to match
 * would duplicate `createdAt`, need a backfill, and could drift out of sync.
 *
 * The same pass also produces the revenue and purchase totals, so it replaces
 * two aggregate queries rather than adding one.
 *
 * If a store ever crosses ~100k orders in a single range, add
 * `Order.day @db.Date` plus `@@index([storeId, status, day])` and swap this
 * function's body for a groupBy — its signature and callers stay identical.
 */
export async function ordersInRange(storeId: string, range: AnalyticsRange): Promise<OrdersInRange> {
  const rows = await prisma.order.findMany({
    where: {
      storeId,
      status: { in: REVENUE_STATUSES },
      createdAt: { gte: range.from, lt: range.toExclusive },
    },
    select: { total: true, createdAt: true },
  })

  const byDay = new Map<DayKey, { orders: number; revenue: number }>()
  let totalRevenue = 0

  for (const row of rows) {
    // Bucketed with the same timezone helper the visit writer uses, so the two
    // series land on identical day keys instead of drifting by hours.
    const key = dayKeyInTimeZone(row.createdAt, range.timeZone)
    const bucket = byDay.get(key) ?? { orders: 0, revenue: 0 }
    bucket.orders += 1
    bucket.revenue += row.total
    byDay.set(key, bucket)
    totalRevenue += row.total
  }

  return { byDay, totalOrders: rows.length, totalRevenue }
}

/** Zero-filled series spanning every day in the range, ready to plot. */
export function buildSeries(
  range: AnalyticsRange,
  visits: Map<DayKey, number>,
  orders: OrdersInRange
): DailyPoint[] {
  return eachDayKey(range.fromKey, range.toKey).map((day) => {
    const o = orders.byDay.get(day)
    return {
      day,
      visits: visits.get(day) ?? 0,
      orders: o?.orders ?? 0,
      revenue: o?.revenue ?? 0,
    }
  })
}

export type SourceRow = {
  /** Normalised key, or null for orders that carry no attribution. */
  key: string | null
  visits: number
  purchases: number
  /** Null when there were no visits, so the UI shows "—" instead of dividing by zero. */
  conversion: number | null
  revenue: number
}

/**
 * Visits per source, as raw SQL so the index can be pinned.
 *
 * `prisma.visit.groupBy({ by: ["source"] })` is the natural expression, but
 * MySQL costs the two storeId-prefixed indexes as a tie and picks the *unique*
 * one — which does not contain `day` or `source`, so every candidate row has to
 * be read from the table. Measured on this schema at 185k visits over a
 * 273-day range: 451 ms for the optimiser's choice, 138 ms with the covering
 * index pinned. Both plans need a temp table (grouping by `source` cannot be
 * satisfied by an index ordered `day, source`), but that sort runs over the
 * handful of grouped rows, not the scan.
 *
 * The `EXPLAIN` difference is `Using where; Using temporary; Using filesort`
 * versus `Using where; Using index; Using temporary; Using filesort` — the
 * `Using index` is the whole point. Prisma has no index-hint API, so this one
 * query is raw. The identifiers are Prisma's default table/column mapping; a
 * future `@@map` on `Visit` must be mirrored here.
 */
async function visitsBySource(
  storeId: string,
  range: AnalyticsRange
): Promise<{ source: string; visits: number }[]> {
  const rows = await prisma.$queryRaw<{ source: string; visits: bigint }[]>`
    SELECT source, COUNT(*) AS visits
    FROM \`Visit\` FORCE INDEX (\`Visit_storeId_day_source_idx\`)
    WHERE storeId = ${storeId} AND day >= ${range.fromDay} AND day <= ${range.toDay}
    GROUP BY source
    ORDER BY visits DESC
    LIMIT 200
  `
  // COUNT() arrives as BigInt over the MySQL wire protocol, which JSON cannot
  // serialise into the RSC payload.
  return rows.map((r) => ({ source: r.source, visits: Number(r.visits) }))
}

/**
 * The traffic-source table: visits, purchases, conversion and revenue per source.
 *
 * Two grouped queries joined in JS over the *union* of their keys, so a source
 * with visits but no sales and a source with sales but no visits both appear.
 */
export async function trafficSources(storeId: string, range: AnalyticsRange): Promise<SourceRow[]> {
  const [visitRows, orderRows] = await Promise.all([
    visitsBySource(storeId, range),
    prisma.order.groupBy({
      by: ["visitSource"],
      where: {
        storeId,
        status: { in: REVENUE_STATUSES },
        createdAt: { gte: range.from, lt: range.toExclusive },
      },
      _count: { _all: true },
      _sum: { total: true },
    }),
  ])

  const visits = new Map(visitRows.map((r) => [r.source, r.visits]))
  const orders = new Map(
    orderRows.map((r) => [r.visitSource, { purchases: r._count._all, revenue: r._sum.total ?? 0 }])
  )

  const keys = new Set<string | null>([...visits.keys(), ...orders.keys()])

  const rows: SourceRow[] = [...keys].map((key) => {
    const v = key === null ? 0 : (visits.get(key) ?? 0)
    const o = orders.get(key) ?? { purchases: 0, revenue: 0 }
    return {
      key,
      visits: v,
      purchases: o.purchases,
      conversion: v > 0 ? (o.purchases / v) * 100 : null,
      revenue: o.revenue,
    }
  })

  // Visits first, then revenue — the table is primarily a traffic report.
  rows.sort((a, b) => b.visits - a.visits || b.revenue - a.revenue)

  // Unattributed orders belong at the bottom, but must stay visible: without
  // them the table's revenue silently fails to match the Revenue stat card.
  const unattributed = rows.filter((r) => r.key === null && (r.purchases > 0 || r.revenue > 0))
  return [...rows.filter((r) => r.key !== null), ...unattributed]
}

/**
 * The first day this store ever recorded a visit.
 *
 * A single index seek to the leftmost entry of `[storeId, day, source]`. Lets
 * the chart omit the visits series entirely before tracking existed, rather
 * than drawing a flat line of zeros that reads as a broken chart.
 */
export async function firstVisitDay(storeId: string): Promise<DayKey | null> {
  const row = await prisma.visit.findFirst({
    where: { storeId },
    orderBy: { day: "asc" },
    select: { day: true },
  })
  return row ? dateToDayKey(row.day) : null
}

/** Shaped to drop straight into `DonutChart` without a mapping step. */
export type SourceSlice = { key: string; label: string; value: number; share: number }

/**
 * Folds the source list into at most `max` donut slices plus "Other".
 *
 * Categorical colour slots are assigned in fixed order and never cycled, so a
 * ninth source is never given a generated hue — it joins Other.
 */
export function toDonutSlices(rows: SourceRow[], max = 5): { slices: SourceSlice[]; total: number } {
  const withVisits = rows.filter((r) => r.key !== null && r.visits > 0) as (SourceRow & { key: string })[]
  const total = withVisits.reduce((sum, r) => sum + r.visits, 0)
  if (total === 0) return { slices: [], total: 0 }

  const head = withVisits.slice(0, max)
  const tail = withVisits.slice(max)

  const slices: SourceSlice[] = head.map((r) => ({
    key: r.key,
    label: sourceLabel(r.key),
    value: r.visits,
    share: (r.visits / total) * 100,
  }))

  if (tail.length > 0) {
    const rest = tail.reduce((sum, r) => sum + r.visits, 0)
    slices.push({ key: "__other", label: `Other (${tail.length})`, value: rest, share: (rest / total) * 100 })
  }

  return { slices, total }
}

export { DIRECT }
