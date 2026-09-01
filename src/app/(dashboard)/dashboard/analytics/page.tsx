import { Suspense } from "react"
import { OrderStatus } from "@prisma/client"
import { BarChart3 } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { parseStoreSettings } from "@/lib/store-settings"
import { parseRange, previousRange, type AnalyticsRange } from "@/lib/analytics/dates"
import {
  buildSeries,
  dailyVisits,
  firstVisitDay,
  ordersInRange,
  toDonutSlices,
  trafficSources,
} from "@/lib/analytics/queries"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { RangePills } from "@/components/dashboard/analytics/range-pills"
import { StatCard } from "@/components/dashboard/analytics/stat-card"
import { TrafficSources } from "@/components/dashboard/analytics/traffic-sources"
import { SalesTrafficChart } from "@/components/dashboard/sales-traffic-chart"

/**
 * The analytics dashboard.
 *
 * The selected range lives entirely in `searchParams`, so it is shareable,
 * bookmarkable and correct under the back button — the same convention the
 * orders list uses for `?status=`. No client state is involved.
 *
 * Stat cards resolve from one cheap pair of queries and paint immediately; the
 * two heavier panels stream in behind their own `<Suspense>` boundaries, so a
 * store with a year of traffic still shows its headline numbers at once.
 */

const REVENUE_STATUSES = [OrderStatus.PAID, OrderStatus.FULFILLED]

const BASE_PATH = "/dashboard/analytics"

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const session = await auth()

  const store = await prisma.store.findUnique({
    where: { userId: session!.user.id },
    select: { id: true, currency: true, settings: true },
  })
  if (!store) return <p>Store not found.</p>

  const { timezone } = parseStoreSettings(store.settings)
  const range = parseRange(params, timezone)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            {range.days} day{range.days !== 1 ? "s" : ""} · days counted in{" "}
            {range.timeZone.replace(/_/g, " ")}
          </p>
        </div>
        <RangePills basePath={BASE_PATH} range={range} />
      </div>

      <Suspense key={`stats-${range.fromKey}-${range.toKey}`} fallback={<StatsSkeleton />}>
        <Stats storeId={store.id} currency={store.currency} range={range} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Sales &amp; traffic</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            key={`chart-${range.fromKey}-${range.toKey}`}
            fallback={<Skeleton className="h-115 w-full" />}
          >
            <SalesTraffic storeId={store.id} currency={store.currency} range={range} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traffic sources</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense
            key={`src-${range.fromKey}-${range.toKey}`}
            fallback={<Skeleton className="h-64 w-full" />}
          >
            <Sources storeId={store.id} currency={store.currency} range={range} />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TopProducts storeId={store.id} currency={store.currency} range={range} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Refunds storeId={store.id} currency={store.currency} range={range} />
        </Suspense>
      </div>
    </div>
  )
}

type PanelProps = { storeId: string; currency: string; range: AnalyticsRange }

/**
 * The four headline numbers, each against the equally-long window immediately
 * before the current one.
 */
async function Stats({ storeId, currency, range }: PanelProps) {
  const prior = previousRange(range)

  const [visits, orders, priorVisits, priorOrders] = await Promise.all([
    prisma.visit.count({ where: { storeId, day: { gte: range.fromDay, lte: range.toDay } } }),
    ordersInRange(storeId, range),
    prisma.visit.count({ where: { storeId, day: { gte: prior.fromDay, lte: prior.toDay } } }),
    ordersInRange(storeId, prior),
  ])

  // A purchase whose session began before the window has no matching visit, so
  // the ratio only means anything when there were visits at all.
  const conversion = visits > 0 ? (orders.totalOrders / visits) * 100 : null
  const priorConversion = priorVisits > 0 ? (priorOrders.totalOrders / priorVisits) * 100 : 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Store visits"
        value={visits.toLocaleString()}
        current={visits}
        previous={priorVisits}
      />
      <StatCard
        label="Purchases"
        value={orders.totalOrders.toLocaleString()}
        current={orders.totalOrders}
        previous={priorOrders.totalOrders}
      />
      <StatCard
        label="Conversion"
        value={conversion === null ? "—" : `${conversion.toFixed(2)}%`}
        current={conversion ?? undefined}
        previous={conversion === null ? undefined : priorConversion}
        hint={visits === 0 ? "No visits recorded yet" : undefined}
      />
      <StatCard
        label="Revenue"
        value={formatMoney(orders.totalRevenue, currency)}
        current={orders.totalRevenue}
        previous={priorOrders.totalRevenue}
      />
    </div>
  )
}

async function SalesTraffic({ storeId, currency, range }: PanelProps) {
  const [visits, orders, tracked] = await Promise.all([
    dailyVisits(storeId, range),
    ordersInRange(storeId, range),
    firstVisitDay(storeId),
  ])

  return (
    <SalesTrafficChart
      points={buildSeries(range, visits, orders)}
      currency={currency}
      timeZone={range.timeZone}
      firstVisitDay={tracked}
    />
  )
}

async function Sources({ storeId, currency, range }: PanelProps) {
  const rows = await trafficSources(storeId, range)
  const { slices, total } = toDonutSlices(rows)

  return <TrafficSources rows={rows} slices={slices} totalVisits={total} currency={currency} />
}

async function TopProducts({ storeId, currency, range }: PanelProps) {
  const top = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      order: {
        storeId,
        status: { in: REVENUE_STATUSES },
        createdAt: { gte: range.from, lt: range.toExclusive },
      },
    },
    _sum: { price: true, quantity: true },
    _count: { productId: true },
    orderBy: { _sum: { price: "desc" } },
    take: 5,
  })

  const products = await prisma.product.findMany({
    where: { id: { in: top.map((p) => p.productId) } },
    select: { id: true, name: true },
  })
  const names = new Map(products.map((p) => [p.id, p.name]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Top products by revenue
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No sales in this range yet.
          </p>
        ) : (
          <div className="space-y-3">
            {top.map((row) => (
              <div key={row.productId} className="flex items-center justify-between gap-4">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {names.get(row.productId) ?? "Deleted product"}
                </span>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums">
                    {formatMoney(row._sum.price ?? 0, currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row._sum.quantity ?? 0} sold across {row._count.productId} order
                    {row._count.productId !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

async function Refunds({ storeId, currency, range }: PanelProps) {
  const [refunded, carts] = await Promise.all([
    prisma.order.aggregate({
      where: {
        storeId,
        status: OrderStatus.REFUNDED,
        createdAt: { gte: range.from, lt: range.toExclusive },
      },
      _sum: { total: true },
      _count: { id: true },
    }),
    prisma.cart.groupBy({
      by: ["status"],
      where: {
        storeId,
        items: { some: {} },
        createdAt: { gte: range.from, lt: range.toExclusive },
      },
      _count: { status: true },
    }),
  ])

  const converted = carts.find((c) => c.status === "CONVERTED")?._count.status ?? 0
  const totalCarts = carts.reduce((sum, c) => sum + c._count.status, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refunds &amp; carts</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Refunded
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {formatMoney(refunded._sum.total ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {refunded._count.id} order{refunded._count.id !== 1 ? "s" : ""} in this range
          </p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Cart checkout rate
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {totalCarts > 0 ? `${((converted / totalCarts) * 100).toFixed(0)}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalCarts > 0
              ? `${converted} of ${totalCarts} carts with items checked out`
              : "No carts started in this range"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-26 w-full" />
      ))}
    </div>
  )
}
