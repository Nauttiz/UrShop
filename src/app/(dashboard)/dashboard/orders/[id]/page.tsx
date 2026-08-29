import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink, Package } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { OrderActions } from "@/components/dashboard/order-actions"
import { STATUS_VARIANT } from "@/lib/order-status-badge"
import type { ShippingAddress } from "@/lib/domain/orders"

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  const order = await prisma.order.findFirst({
    where: { id, store: { userId: session!.user.id } },
    include: {
      store: { select: { slug: true, currency: true } },
      coupon: { select: { code: true } },
      customer: { select: { id: true, email: true, ordersCount: true, totalSpent: true } },
      payments: { orderBy: { createdAt: "desc" } },
      items: {
        include: {
          product: { select: { id: true, name: true, slug: true, thumbnail: true, type: true } },
          downloads: {
            select: { fileName: true, downloadCount: true, maxDownloads: true, expiresAt: true },
          },
        },
      },
    },
  })
  if (!order) notFound()

  const currency = order.currency
  const address = order.shippingAddress as ShippingAddress | null
  const downloads = order.items.flatMap((i) => i.downloads)

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/orders"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight">{order.orderNumber}</h1>
            <Badge variant={STATUS_VARIANT[order.status]}>{order.status}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            Placed {new Date(order.createdAt).toLocaleString()}
            {order.paidAt && ` · paid ${new Date(order.paidAt).toLocaleString()}`}
          </p>
        </div>
        <Link
          href={`/store/${order.store.slug}/orders/${order.accessToken}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          Buyer&apos;s receipt
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100">
                    {item.product.thumbnail ? (
                      <img src={item.product.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center">
                        <Package className="h-5 w-5 text-gray-300" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/products/${item.product.id}/edit`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(item.price, currency)} × {item.quantity}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium">
                    {formatMoney(item.price * item.quantity, currency)}
                  </p>
                </div>
              ))}

              <Separator />

              <dl className="space-y-2 text-sm">
                <Row label="Subtotal" value={formatMoney(order.subtotal, currency)} />
                {order.discountTotal > 0 && (
                  <Row
                    label={`Discount${order.coupon ? ` (${order.coupon.code})` : ""}`}
                    value={`−${formatMoney(order.discountTotal, currency)}`}
                    className="text-green-700"
                  />
                )}
                {order.shippingTotal > 0 && (
                  <Row label="Shipping" value={formatMoney(order.shippingTotal, currency)} />
                )}
                {order.taxTotal > 0 && <Row label="Tax" value={formatMoney(order.taxTotal, currency)} />}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{formatMoney(order.total, currency)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {downloads.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Digital delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {downloads.map((file, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate">{file.fileName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {file.maxDownloads !== null
                        ? `${file.downloadCount}/${file.maxDownloads} downloads`
                        : `${file.downloadCount} downloads`}
                      {file.expiresAt && ` · expires ${file.expiresAt.toLocaleDateString()}`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {order.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment attempts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.payments.map((payment) => (
                  <div key={payment.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{payment.provider}</span>
                      <Badge
                        variant={
                          payment.status === "SUCCEEDED"
                            ? "default"
                            : payment.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-xs"
                      >
                        {payment.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {payment.providerRef ?? "no reference"}
                    </p>
                    {payment.errorMessage && (
                      <p className="mt-0.5 text-xs text-red-600">{payment.errorMessage}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderActions
                orderId={order.id}
                status={order.status}
                total={order.total}
                currencySymbol={currency}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {order.buyerName && <p className="font-medium">{order.buyerName}</p>}
              <a href={`mailto:${order.buyerEmail}`} className="block break-all hover:underline">
                {order.buyerEmail}
              </a>
              {order.customer && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {order.customer.ordersCount} order{order.customer.ordersCount !== 1 ? "s" : ""} ·{" "}
                  {formatMoney(order.customer.totalSpent, currency)} lifetime
                </p>
              )}
            </CardContent>
          </Card>

          {address && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Shipping address</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed">
                <p>{address.line1}</p>
                {address.line2 && <p>{address.line2}</p>}
                <p>
                  {address.city}
                  {address.state ? `, ${address.state}` : ""} {address.postalCode}
                </p>
                <p>{address.country}</p>
              </CardContent>
            </Card>
          )}

          {order.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Buyer notes</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm">{order.notes}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
