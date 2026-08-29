import Link from "next/link"
import { OrderStatus, type Prisma } from "@prisma/client"
import { Users } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const session = await auth()

  const store = await prisma.store.findUnique({
    where: { userId: session!.user.id },
    select: { id: true, currency: true },
  })
  if (!store) return <p>Store not found.</p>

  const where: Prisma.CustomerWhereInput = {
    storeId: store.id,
    ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {}),
  }

  const [customers, aggregate] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { totalSpent: "desc" },
      take: 100,
      include: {
        orders: {
          where: { status: { in: [OrderStatus.PAID, OrderStatus.FULFILLED] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true },
        },
      },
    }),
    prisma.customer.aggregate({
      where: { storeId: store.id },
      _count: { id: true },
      _sum: { totalSpent: true },
    }),
  ])

  const totalCustomers = aggregate._count.id
  const lifetimeRevenue = aggregate._sum.totalSpent ?? 0
  const averageValue = totalCustomers > 0 ? lifetimeRevenue / totalCustomers : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">
          Everyone who has bought from your store, ranked by lifetime spend
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Customers" value={String(totalCustomers)} />
        <Stat label="Lifetime revenue" value={formatMoney(lifetimeRevenue, store.currency)} />
        <Stat label="Average customer value" value={formatMoney(averageValue, store.currency)} />
      </div>

      <form action="/dashboard/customers" className="max-w-sm">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or email…"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </form>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-1 text-lg font-semibold">
              {q ? "No matching customers" : "No customers yet"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {q
                ? "Try a different search term."
                : "A customer record is created the first time someone checks out."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Lifetime spend</TableHead>
                  <TableHead className="text-right">Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div className="min-w-0">
                        {customer.name && <p className="font-medium">{customer.name}</p>}
                        <a
                          href={`mailto:${customer.email}`}
                          className="break-all text-sm text-muted-foreground hover:underline"
                        >
                          {customer.email}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{customer.ordersCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(customer.totalSpent, store.currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {customer.orders[0] ? (
                        <Link
                          href={`/dashboard/orders/${customer.orders[0].id}`}
                          className="hover:underline"
                        >
                          {customer.orders[0].createdAt.toLocaleDateString()}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}
