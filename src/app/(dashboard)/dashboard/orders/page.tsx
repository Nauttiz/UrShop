import Link from "next/link"
import { OrderStatus, type Prisma } from "@prisma/client"
import { ChevronRight, ShoppingBag } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { STATUS_VARIANT } from "@/lib/order-status-badge"

const FILTERS = ["ALL", ...Object.values(OrderStatus)] as const

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  const session = await auth()

  const store = await prisma.store.findUnique({
    where: { userId: session!.user.id },
    select: { id: true, currency: true },
  })

  const activeFilter = status && status in OrderStatus ? (status as OrderStatus) : null

  const where: Prisma.OrderWhereInput = {
    storeId: store?.id ?? "__none__",
    ...(activeFilter ? { status: activeFilter } : {}),
    ...(q
      ? { OR: [{ buyerEmail: { contains: q } }, { orderNumber: { contains: q } }] }
      : {}),
  }

  const [orders, counts] = store
    ? await Promise.all([
        prisma.order.findMany({
          where,
          include: { items: { select: { name: true, quantity: true } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.order.groupBy({
          by: ["status"],
          where: { storeId: store.id },
          _count: { status: true },
        }),
      ])
    : [[], []]

  const countByStatus = Object.fromEntries(counts.map((c) => [c.status, c._count.status]))
  const total = counts.reduce((sum, c) => sum + c._count.status, 0)
  const currency = store?.currency ?? "USD"

  const buildHref = (nextStatus: string) => {
    const sp = new URLSearchParams()
    if (nextStatus !== "ALL") sp.set("status", nextStatus)
    if (q) sp.set("q", q)
    const query = sp.toString()
    return `/dashboard/orders${query ? `?${query}` : ""}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted-foreground">
          {total} total order{total !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = f === "ALL" ? !activeFilter : activeFilter === f
            const count = f === "ALL" ? total : (countByStatus[f] ?? 0)
            return (
              <Link
                key={f}
                href={buildHref(f)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? "border-gray-900 bg-gray-900 text-white" : "hover:bg-gray-50"
                }`}
              >
                {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} ({count})
              </Link>
            )
          })}
        </div>

        <form action="/dashboard/orders" className="sm:w-64">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search email or order number…"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          {activeFilter && <input type="hidden" name="status" value={activeFilter} />}
        </form>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShoppingBag className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-1 text-lg font-semibold">
              {q || activeFilter ? "No matching orders" : "No orders yet"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {q || activeFilter
                ? "Try a different filter or search term."
                : "Orders will appear here once buyers purchase from your store."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Link key={order.id} href={`/dashboard/orders/${order.id}`} className="block">
              <Card className="transition-colors hover:border-gray-300">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{order.buyerEmail}</p>
                      <Badge variant={STATUS_VARIANT[order.status]} className="text-xs">
                        {order.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {order.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{order.orderNumber}</span> ·{" "}
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold">{formatMoney(order.total, currency)}</p>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
