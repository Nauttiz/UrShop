import { CartStatus, ProductType } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getMailer } from "@/lib/email/mailer"
import {
  abandonedCartEmail,
  deliveryEmail,
  receiptEmail,
  refundEmail,
  sellerNotificationEmail,
} from "@/lib/email/templates"
import { parseStoreSettings } from "@/lib/store-settings"
import { PricingEngine } from "@/lib/domain/pricing"
import { enqueue, type JobHandler } from "./queue"

/**
 * Base URL for links inside emails. Jobs run outside a request, so there are no
 * headers to fall back on — the env var is the only source.
 */
function baseUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "")
}

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      store: { select: { id: true, name: true, slug: true, contactEmail: true, settings: true, user: { select: { email: true } } } },
      items: {
        include: {
          product: { select: { type: true } },
          downloads: { select: { token: true, fileName: true, expiresAt: true, maxDownloads: true } },
        },
      },
    },
  })
}

const sendReceipt: JobHandler = async ({ orderId }: { orderId: string }) => {
  const order = await loadOrder(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  const settings = parseStoreSettings(order.store.settings)
  if (!settings.sendReceiptEmail) return

  const receiptUrl = `${baseUrl()}/store/${order.store.slug}/orders/${order.accessToken}`
  const hasDigital = order.items.some((i) => i.product.type !== ProductType.PHYSICAL)

  const template = receiptEmail({
    storeName: order.store.name,
    orderNumber: order.orderNumber,
    buyerName: order.buyerName,
    currency: order.currency,
    lines: order.items.map((i) => ({ name: i.name || "Item", quantity: i.quantity, price: i.price })),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    shippingTotal: order.shippingTotal,
    total: order.total,
    receiptUrl,
    downloadUrl: hasDigital ? receiptUrl : null,
  })

  const result = await getMailer().send({
    to: order.buyerEmail,
    storeId: order.storeId,
    template: "receipt",
    replyTo: order.store.contactEmail,
    ...template,
  })
  if (!result.ok) throw new Error(result.error ?? "Receipt delivery failed")
}

const sendDelivery: JobHandler = async ({ orderId }: { orderId: string }) => {
  const order = await loadOrder(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  const downloads = order.items.flatMap((i) => i.downloads)
  // Physical-only orders have nothing to deliver.
  if (downloads.length === 0) return

  const template = deliveryEmail({
    storeName: order.store.name,
    orderNumber: order.orderNumber,
    downloadUrl: `${baseUrl()}/store/${order.store.slug}/orders/${order.accessToken}`,
    files: downloads.map((d) => ({ name: d.fileName })),
    expiresAt: downloads[0]?.expiresAt ?? null,
    maxDownloads: downloads[0]?.maxDownloads ?? null,
  })

  const result = await getMailer().send({
    to: order.buyerEmail,
    storeId: order.storeId,
    template: "delivery",
    replyTo: order.store.contactEmail,
    ...template,
  })
  if (!result.ok) throw new Error(result.error ?? "Delivery email failed")
}

const notifySeller: JobHandler = async ({ orderId }: { orderId: string }) => {
  const order = await loadOrder(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  const settings = parseStoreSettings(order.store.settings)
  if (!settings.notifySellerOnOrder) return

  const to = order.store.contactEmail ?? order.store.user.email
  if (!to) return

  const template = sellerNotificationEmail({
    storeName: order.store.name,
    orderNumber: order.orderNumber,
    buyerEmail: order.buyerEmail,
    currency: order.currency,
    total: order.total,
    dashboardUrl: `${baseUrl()}/dashboard/orders/${order.id}`,
  })

  const result = await getMailer().send({
    to,
    storeId: order.storeId,
    template: "seller_notification",
    ...template,
  })
  if (!result.ok) throw new Error(result.error ?? "Seller notification failed")
}

const sendRefundEmail: JobHandler = async ({ orderId, amount }: { orderId: string; amount: number }) => {
  const order = await loadOrder(orderId)
  if (!order) throw new Error(`Order ${orderId} not found`)

  const template = refundEmail({
    storeName: order.store.name,
    orderNumber: order.orderNumber,
    currency: order.currency,
    amount: amount ?? order.total,
  })

  const result = await getMailer().send({
    to: order.buyerEmail,
    storeId: order.storeId,
    template: "refund",
    ...template,
  })
  if (!result.ok) throw new Error(result.error ?? "Refund email failed")
}

/**
 * Sweeps carts that have gone quiet and queues one reminder each.
 *
 * `reminderSentAt` is stamped before the reminder job is queued so a rerun of
 * the scan cannot double-mail the same cart.
 */
const scanAbandonedCarts: JobHandler = async () => {
  const stores = await prisma.store.findMany({ select: { id: true, settings: true } })

  for (const store of stores) {
    const { abandonedCartHours } = parseStoreSettings(store.settings)
    const cutoff = new Date(Date.now() - abandonedCartHours * 3600_000)

    const carts = await prisma.cart.findMany({
      where: {
        storeId: store.id,
        status: CartStatus.ACTIVE,
        reminderSentAt: null,
        email: { not: null },
        updatedAt: { lt: cutoff },
        items: { some: {} },
      },
      select: { id: true },
      take: 200,
    })

    for (const cart of carts) {
      const claimed = await prisma.cart.updateMany({
        where: { id: cart.id, reminderSentAt: null },
        data: { reminderSentAt: new Date(), status: CartStatus.ABANDONED },
      })
      if (claimed.count === 0) continue
      await enqueue("send_abandoned_cart", { cartId: cart.id })
    }
  }
}

const sendAbandonedCart: JobHandler = async ({ cartId }: { cartId: string }) => {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      store: { select: { id: true, name: true, slug: true, settings: true, contactEmail: true, currency: true } },
      coupon: true,
      items: { include: { product: { select: { name: true, type: true } } } },
    },
  })
  if (!cart || !cart.email || cart.items.length === 0) return
  // The buyer completed checkout between the scan and now.
  if (cart.status === CartStatus.CONVERTED) return

  const engine = new PricingEngine(parseStoreSettings(cart.store.settings))
  const quote = engine.quote(
    cart.items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      type: i.product.type,
    })),
    cart.coupon
  )

  const template = abandonedCartEmail({
    storeName: cart.store.name,
    checkoutUrl: `${baseUrl()}/store/${cart.store.slug}/cart?recover=${cart.token}`,
    currency: cart.store.currency,
    lines: quote.lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unitPrice })),
    total: quote.total,
  })

  const result = await getMailer().send({
    to: cart.email,
    storeId: cart.storeId,
    template: "abandoned_cart",
    replyTo: cart.store.contactEmail,
    ...template,
  })
  if (!result.ok) throw new Error(result.error ?? "Abandoned cart email failed")
}

export const jobHandlers: Record<string, JobHandler> = {
  send_receipt: sendReceipt,
  send_delivery: sendDelivery,
  notify_seller: notifySeller,
  send_refund_email: sendRefundEmail,
  scan_abandoned_carts: scanAbandonedCarts,
  send_abandoned_cart: sendAbandonedCart,
}
