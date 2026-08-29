import { OrderStatus } from "@prisma/client"
import { BarChart3 } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Fulfilled orders are paid orders that shipped — both count as revenue. */
const REVENUE_STATUSES = [OrderStatus.PAID, OrderStatus.FULFILLED]

const MONTH_LABEL = new Intl.DateTimeFormat("en", { month: "short" })

export default async function AnalyticsPage() {
  const session = await auth()
  const store = await prisma.store.findUnique({
    where: { userId: session!.user.id },
    select: { id: true, currency: true },
  })
  if (!store) return null

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
  sixMonthsAgo.setDate(1)
  sixMonthsAgo.setHours(0, 0, 0, 0)

  const [revenue, orderCount, refunded, topProducts, monthlyOrders, cartStats] = await Promise.all([
    prisma.order.aggregate({
      where: { storeId: store.id, status: { in: REVENUE_STATUSES } },
      _sum: { total: true },
      _avg: { total: true },
    }),
    prisma.order.count({ where: { storeId: store.id, status: { in: REVENUE_STATUSES } } }),
    prisma.order.aggregate({
      where: { storeId: store.id, status: OrderStatus.REFUNDED },
      _sum: { total: true },
      _count: { id: true },
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { order: { storeId: store.id, status: { in: REVENUE_STATUSES } } },
      _sum: { price: true, quantity: true },
      _count: { productId: true },
      orderBy: { _sum: { price: "desc" } },
      take: 5,
    }),
    prisma.order.findMany({
      where: {
        storeId: store.id,
        status: { in: REVENUE_STATUSES },
        createdAt: { gte: sixMonthsAgo },
      },
      select: { total: true, createdAt: true },
    }),
    prisma.cart.groupBy({
      by: ["status"],
      where: { storeId: store.id, items: { some: {} } },
      _count: { status: true },
    }),
  ])

  const productIds = topProducts.map((p) => p.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  })
  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]))

  // Bucket the last six months, including the ones with no sales.
  const buckets: { label: string; total: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    buckets.push({ label: MONTH_LABEL.format(d), total: 0 })
  }
  for (const order of monthlyOrders) {
    const monthsAgo =
      (new Date().getFullYear() - order.createdAt.getFullYear()) * 12 +
      (new Date().getMonth() - order.createdAt.getMonth())
    const index = 5 - monthsAgo
    if (index >= 0 && index < 6) buckets[index].total += order.total
  }
  const peak = Math.max(...buckets.map((b) => b.total), 1)

  const cartsByStatus = Object.fromEntries(cartStats.map((c) => [c.status, c._count.status]))
  const converted = cartsByStatus.CONVERTED ?? 0
  const totalCarts = cartStats.reduce((sum, c) => sum + c._count.status, 0)
  const conversionRate = totalCarts > 0 ? (converted / totalCarts) * 100 : null

  const cards = [
    { title: "Total revenue", value: formatMoney(revenue._sum.total ?? 0, store.currency) },
    { title: "Paid orders", value: String(orderCount) },
    { title: "Average order value", value: formatMoney(revenue._avg.total ?? 0, store.currency) },
    {
      title: "Cart conversion",
      value: conversionRate === null ? "—" : `${conversionRate.toFixed(0)}%`,
      hint: totalCarts > 0 ? `${converted} of ${totalCarts} carts checked out` : "No carts yet",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Track your store performance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ title, value, hint }) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value}</p>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue, last 6 months</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-end gap-3">
            {buckets.map((bucket) => (
              <div key={bucket.label} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {bucket.total > 0 ? formatMoney(bucket.total, store.currency) : ""}
                </span>
                <div
                  className="w-full rounded-t bg-primary/80"
                  style={{ height: `${Math.max(2, (bucket.total / peak) * 100)}%` }}
                />
                <span className="text-xs text-muted-foreground">{bucket.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5" />
              Top products by revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No sales data yet</p>
            ) : (
              <div className="space-y-3">
                {topProducts.map((p) => (
                  <div key={p.productId} className="flex items-center justify-between">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {productMap[p.productId] ?? "Deleted product"}
                    </span>
                    <div className="ml-4 shrink-0 text-right">
                      <p className="text-sm font-bold">
                        {formatMoney(p._sum.price ?? 0, store.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p._sum.quantity ?? 0} sold across {p._count.productId} order
                        {p._count.productId !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatMoney(refunded._sum.total ?? 0, store.currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {refunded._count.id} refunded order{refunded._count.id !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
