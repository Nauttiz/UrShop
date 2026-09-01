import { Suspense } from "react"
import Link from "next/link"
import { CartStatus, OrderStatus } from "@prisma/client"
import {
  AlertTriangle,
  DollarSign,
  Package,
  ShoppingBag,
  ShoppingCart,
  Users,
} from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { parseStoreSettings } from "@/lib/store-settings"
import { parseRange, type AnalyticsRange } from "@/lib/analytics/dates"
import { buildSeries, dailyVisits, firstVisitDay, ordersInRange } from "@/lib/analytics/queries"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { RangePills } from "@/components/dashboard/analytics/range-pills"
import { SalesTrafficChart } from "@/components/dashboard/sales-traffic-chart"
import { STATUS_VARIANT } from "@/lib/order-status-badge"

const PAID_STATUSES = [OrderStatus.PAID, OrderStatus.FULFILLED]

/**
 * Reading the clock is a side effect, so it is done in a helper rather than in
 * the component body — the lint rule that flags it is guarding against a render
 * that produces different output each time it runs.
 */
function rollingWindows() {
  const now = Date.now()
  return {
    thirtyDaysAgo: new Date(now - 30 * 24 * 3600_000),
    sixtyDaysAgo: new Date(now - 60 * 24 * 3600_000),
  }
}

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const session = await auth()
  const store = await prisma.store.findUnique({
    where: { userId: session!.user.id },
    select: { id: true, name: true, slug: true, currency: true, settings: true },
  })
  if (!store) return <p>Store not found.</p>

  const { timezone } = parseStoreSettings(store.settings)
  const range = parseRange(params, timezone)

  const { thirtyDaysAgo, sixtyDaysAgo } = rollingWindows()

  const [
    products,
    paidOrders,
    revenue,
    recentRevenue,
    priorRevenue,
    customers,
    openCarts,
    lowStock,
    recentOrders,
  ] = await Promise.all([
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.order.count({ where: { storeId: store.id, status: { in: PAID_STATUSES } } }),
    prisma.order.aggregate({
      where: { storeId: store.id, status: { in: PAID_STATUSES } },
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: {
        storeId: store.id,
        status: { in: PAID_STATUSES },
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: {
        storeId: store.id,
        status: { in: PAID_STATUSES },
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
      _sum: { total: true },
    }),
    prisma.customer.count({ where: { storeId: store.id } }),
    prisma.cart.count({
      where: { storeId: store.id, status: CartStatus.ACTIVE, items: { some: {} } },
    }),
    prisma.product.findMany({
      where: { storeId: store.id, type: "PHYSICAL", stock: { lte: 5, not: null } },
      select: { id: true, name: true, stock: true },
      orderBy: { stock: "asc" },
      take: 5,
    }),
    prisma.order.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        buyerEmail: true,
        total: true,
        status: true,
        createdAt: true,
      },
    }),
  ])

  const last30 = recentRevenue._sum.total ?? 0
  const prior30 = priorRevenue._sum.total ?? 0
  // Growing from zero has no meaningful percentage, so it renders as a dash.
  const change = prior30 > 0 ? ((last30 - prior30) / prior30) * 100 : null

  const cards = [
    {
      title: "Total revenue",
      value: formatMoney(revenue._sum.total ?? 0, store.currency),
      icon: DollarSign,
      color: "text-green-600",
      hint: `${formatMoney(last30, store.currency)} in the last 30 days`,
    },
    {
      title: "Paid orders",
      value: String(paidOrders),
      icon: ShoppingBag,
      color: "text-blue-600",
      hint: change === null ? "No prior period to compare" : `${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs previous 30 days`,
    },
    {
      title: "Customers",
      value: String(customers),
      icon: Users,
      color: "text-purple-600",
      hint: `${products} product${products !== 1 ? "s" : ""} in catalogue`,
    },
    {
      title: "Open carts",
      value: String(openCarts),
      icon: ShoppingCart,
      color: "text-orange-600",
      hint: openCarts > 0 ? "Reminders are sent automatically" : "Nothing waiting",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground">Welcome back to {store.name}</p>
        </div>
        <Link
          href={`/store/${store.slug}`}
          target="_blank"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          View storefront →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, value, icon: Icon, color, hint }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className={`h-5 w-5 ${color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Sales &amp; traffic</CardTitle>
          <RangePills basePath="/dashboard" range={range} />
        </CardHeader>
        <CardContent>
          {/* Its own boundary: the stat cards above resolve from cheap counts,
              while this panel scans the visit index. Streaming it separately
              keeps the headline numbers instant on a busy store. */}
          <Suspense
            key={`chart-${range.fromKey}-${range.toKey}`}
            fallback={<Skeleton className="h-115 w-full" />}
          >
            <OverviewChart storeId={store.id} currency={store.currency} range={range} />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent orders</CardTitle>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="space-y-3">
                {recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{order.buyerEmail}</p>
                      <p className="font-mono text-xs text-muted-foreground">{order.orderNumber}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[order.status]} className="text-xs">
                      {order.status}
                    </Badge>
                    <p className="shrink-0 text-sm font-medium">
                      {formatMoney(order.total, store.currency)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Low stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing running low. Digital products never run out.
              </p>
            ) : (
              <div className="space-y-3">
                {lowStock.map((product) => (
                  <Link
                    key={product.id}
                    href={`/dashboard/products/${product.id}/edit`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50"
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 truncate text-sm">{product.name}</p>
                    <Badge
                      variant={product.stock === 0 ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {product.stock === 0 ? "Sold out" : `${product.stock} left`}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

async function OverviewChart({
  storeId,
  currency,
  range,
}: {
  storeId: string
  currency: string
  range: AnalyticsRange
}) {
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
      height={180}
    />
  )
}
