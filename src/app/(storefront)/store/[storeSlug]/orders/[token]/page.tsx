import Link from "next/link"
import { notFound } from "next/navigation"
import { CheckCircle2, Clock, Download, Package, XCircle } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { OrderPoller } from "@/components/storefront/order-poller"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"
import type { OrderStatus } from "@prisma/client"

type Props = { params: Promise<{ storeSlug: string; token: string }> }

export const metadata = { title: "Your order", robots: { index: false, follow: false } }

const STATUS_UI: Record<OrderStatus, { icon: typeof CheckCircle2; tone: string; title: string; body: string }> = {
  PENDING: {
    icon: Clock,
    tone: "text-amber-600",
    title: "Waiting for payment",
    body: "We have not received your payment yet. This page updates itself once it clears.",
  },
  PAID: {
    icon: CheckCircle2,
    tone: "text-green-600",
    title: "Payment received",
    body: "Thank you! Your order is confirmed and a receipt is on its way to your inbox.",
  },
  FULFILLED: {
    icon: CheckCircle2,
    tone: "text-green-600",
    title: "Order fulfilled",
    body: "Your order has been completed by the seller.",
  },
  REFUNDED: {
    icon: XCircle,
    tone: "text-gray-500",
    title: "Order refunded",
    body: "This order was refunded. Downloads are no longer available.",
  },
  CANCELLED: {
    icon: XCircle,
    tone: "text-gray-500",
    title: "Order cancelled",
    body: "This order was cancelled and you were not charged.",
  },
  FAILED: {
    icon: XCircle,
    tone: "text-red-600",
    title: "Payment failed",
    body: "Your payment did not go through. Nothing was charged — please try again.",
  },
}

export default async function OrderReceiptPage({ params }: Props) {
  const { storeSlug, token } = await params

  // The unguessable accessToken IS the authorisation: no login, and a wrong
  // token is indistinguishable from a nonexistent order.
  const order = await prisma.order.findFirst({
    where: { accessToken: token, store: { slug: storeSlug } },
    include: {
      store: { select: { name: true, slug: true, currency: true, themeConfig: true, contactEmail: true } },
      items: {
        include: {
          product: { select: { thumbnail: true, slug: true, type: true } },
          downloads: {
            select: {
              token: true,
              fileName: true,
              downloadCount: true,
              maxDownloads: true,
              expiresAt: true,
            },
          },
        },
      },
    },
  })
  if (!order) notFound()

  const theme = { ...DEFAULT_THEME, ...((order.store.themeConfig ?? {}) as Partial<ThemeConfig>) }
  const ui = STATUS_UI[order.status]
  const Icon = ui.icon
  const currency = order.currency
  const downloads = order.items.flatMap((item) => item.downloads)
  const canDownload = order.status === "PAID" || order.status === "FULFILLED"

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {order.status === "PENDING" && <OrderPoller />}

      <div className="rounded-xl border bg-white p-6 text-center">
        <Icon className={`mx-auto h-12 w-12 ${ui.tone}`} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{ui.title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">{ui.body}</p>
        <p className="mt-4 text-xs text-gray-500">
          Order <span className="font-mono font-medium">{order.orderNumber}</span> ·{" "}
          {new Date(order.createdAt).toLocaleDateString()}
        </p>
      </div>

      {canDownload && downloads.length > 0 && (
        <section className="mt-6 rounded-xl border bg-white p-6">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Download className="h-4 w-4" />
            Your files
          </h2>
          <ul className="space-y-2">
            {downloads.map((file) => {
              const spent = file.maxDownloads !== null && file.downloadCount >= file.maxDownloads
              const expired = file.expiresAt !== null && file.expiresAt.getTime() <= Date.now()
              const blocked = spent || expired

              return (
                <li
                  key={file.token}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {file.maxDownloads !== null
                        ? `${file.downloadCount} of ${file.maxDownloads} downloads used`
                        : `${file.downloadCount} downloads`}
                      {file.expiresAt && ` · expires ${file.expiresAt.toLocaleDateString()}`}
                    </p>
                  </div>
                  {blocked ? (
                    <span className="shrink-0 rounded-md bg-gray-100 px-4 py-2 text-xs font-medium text-gray-500">
                      {expired ? "Expired" : "Limit reached"}
                    </span>
                  ) : (
                    <a
                      href={`/api/download/${file.token}`}
                      className="shrink-0 rounded-md px-4 py-2 text-sm font-semibold text-white"
                      style={{ backgroundColor: theme.primaryColor }}
                    >
                      Download
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-gray-500">
            Bookmark this page — it is your permanent link to these files.
          </p>
        </section>
      )}

      <section className="mt-6 rounded-xl border bg-white p-6">
        <h2 className="mb-4 font-semibold">Order details</h2>
        <ul className="space-y-3 border-b pb-4">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3">
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
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-gray-500">Quantity {item.quantity}</p>
              </div>
              <p className="shrink-0 text-sm font-medium">
                {formatMoney(item.price * item.quantity, currency)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Subtotal" value={formatMoney(order.subtotal, currency)} />
          {order.discountTotal > 0 && (
            <Row
              label="Discount"
              value={`−${formatMoney(order.discountTotal, currency)}`}
              className="text-green-700"
            />
          )}
          {order.shippingTotal > 0 && (
            <Row label="Shipping" value={formatMoney(order.shippingTotal, currency)} />
          )}
          {order.taxTotal > 0 && <Row label="Tax" value={formatMoney(order.taxTotal, currency)} />}
          <div className="flex justify-between border-t pt-3 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatMoney(order.total, currency)}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link href={`/store/${order.store.slug}`} className="text-gray-600 hover:underline">
          ← Back to {order.store.name}
        </Link>
        {order.store.contactEmail && (
          <a href={`mailto:${order.store.contactEmail}`} className="text-gray-600 hover:underline">
            Contact the seller
          </a>
        )}
      </div>
    </main>
  )
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
