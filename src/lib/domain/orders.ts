import crypto from "crypto"
import { CartStatus, OrderStatus, PaymentStatus, ProductType, type Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PricingEngine } from "@/lib/domain/pricing"
import { issueDownloadsForOrder } from "@/lib/domain/delivery"
import { parseStoreSettings } from "@/lib/store-settings"
import { enqueue } from "@/lib/jobs/queue"
import type { CartWithItems } from "@/lib/domain/cart"

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1

/** Human-quotable, unguessable order reference. */
function generateOrderNumber(): string {
  const bytes = crypto.randomBytes(8)
  let out = ""
  for (let i = 0; i < 8; i++) out += ORDER_ALPHABET[bytes[i] % ORDER_ALPHABET.length]
  return `ORD-${out.slice(0, 4)}-${out.slice(4)}`
}

export type ShippingAddress = {
  line1: string
  line2?: string | null
  city: string
  state?: string | null
  postalCode: string
  country: string
}

export type CreateOrderInput = {
  storeId: string
  cart: CartWithItems
  buyerEmail: string
  buyerName?: string | null
  shippingAddress?: ShippingAddress | null
  notes?: string | null
}

export type CreateOrderResult =
  | { ok: true; order: Awaited<ReturnType<typeof loadOrderForCheckout>> }
  | { ok: false; code: "EMPTY_CART" | "UNAVAILABLE" | "OUT_OF_STOCK" | "SHIPPING_REQUIRED"; message: string }

function loadOrderForCheckout(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { thumbnail: true, description: true } } } },
      store: { select: { slug: true, name: true, currency: true, stripeAccountId: true } },
    },
  })
}

/**
 * Turns a cart into a PENDING order.
 *
 * Prices are recomputed from the database here — the client sends product ids
 * and quantities only, so a tampered cart payload cannot alter what is charged.
 * Stock is verified but not yet decremented; that happens on payment, so an
 * abandoned checkout does not hold inventory hostage.
 */
export async function createOrderFromCart(input: CreateOrderInput): Promise<CreateOrderResult> {
  const { cart, storeId } = input

  if (cart.items.length === 0) {
    return { ok: false, code: "EMPTY_CART", message: "Your cart is empty" }
  }

  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { settings: true, currency: true },
  })

  // Re-read products so an unpublished or deleted item cannot slip through.
  const products = await prisma.product.findMany({
    where: { id: { in: cart.items.map((i) => i.productId) }, storeId },
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  for (const item of cart.items) {
    const product = byId.get(item.productId)
    if (!product || !product.isPublished) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: `"${item.product.name}" is no longer available`,
      }
    }
    if (product.type === ProductType.PHYSICAL && product.stock !== null && item.quantity > product.stock) {
      return {
        ok: false,
        code: "OUT_OF_STOCK",
        message: `Only ${product.stock} of "${product.name}" left in stock`,
      }
    }
  }

  const settings = parseStoreSettings(store.settings)
  const engine = new PricingEngine(settings)
  const quote = engine.quote(
    cart.items.map((i) => {
      const product = byId.get(i.productId)!
      return {
        productId: i.productId,
        name: product.name,
        // Honour the pay-what-you-want amount captured at add-to-cart time,
        // but never below the current list price for fixed-price products.
        unitPrice: product.isPayWhatYouWant ? Math.max(i.unitPrice, product.minPrice ?? 0) : product.price,
        quantity: i.quantity,
        type: product.type,
      }
    }),
    cart.coupon
  )

  if (quote.requiresShipping && !input.shippingAddress) {
    return {
      ok: false,
      code: "SHIPPING_REQUIRED",
      message: "A shipping address is required for physical products",
    }
  }

  const customer = await upsertCustomer(storeId, input.buyerEmail, input.buyerName ?? null)

  const order = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      accessToken: crypto.randomBytes(24).toString("base64url"),
      storeId,
      customerId: customer.id,
      buyerEmail: input.buyerEmail,
      buyerName: input.buyerName ?? null,
      status: OrderStatus.PENDING,
      currency: store.currency,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      taxTotal: quote.taxTotal,
      shippingTotal: quote.shippingTotal,
      total: quote.total,
      couponId: quote.appliedCoupon?.id ?? null,
      shippingAddress: (input.shippingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
      notes: input.notes ?? null,
      items: {
        create: quote.lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          price: line.unitPrice,
        })),
      },
    },
  })

  return { ok: true, order: await loadOrderForCheckout(order.id) }
}

async function upsertCustomer(storeId: string, email: string, name: string | null) {
  const normalised = email.trim().toLowerCase()
  return prisma.customer.upsert({
    where: { storeId_email: { storeId, email: normalised } },
    create: { storeId, email: normalised, name },
    // Keep the latest name the buyer supplied, but never blank an existing one.
    update: name ? { name } : {},
  })
}

export type MarkPaidInput = {
  orderId: string
  provider: string
  providerRef: string
  amount?: number | null
  rawPayload?: Prisma.InputJsonValue
}

/**
 * Promotes an order to PAID and runs every post-payment side effect.
 *
 * Idempotent by design: payment providers retry webhooks, and a duplicate
 * delivery would decrement stock twice and re-mail the buyer. The status guard
 * inside the transaction is the single point that decides whether the side
 * effects run at all.
 */
export async function markOrderPaid(input: MarkPaidInput): Promise<{ applied: boolean }> {
  const transition = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: { include: { product: { select: { type: true } } } } },
    })
    if (!order) return { applied: false as const }
    // Already processed by an earlier delivery of the same webhook.
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.FAILED) {
      return { applied: false as const }
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID, paidAt: new Date() },
    })

    // One Payment row per provider reference, so a retried webhook updates the
    // existing attempt instead of stacking duplicates.
    const attempt = await tx.payment.findFirst({
      where: { orderId: order.id, providerRef: input.providerRef },
      select: { id: true },
    })
    if (attempt) {
      await tx.payment.update({
        where: { id: attempt.id },
        data: { status: PaymentStatus.SUCCEEDED, rawPayload: input.rawPayload },
      })
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: input.provider,
          providerRef: input.providerRef,
          status: PaymentStatus.SUCCEEDED,
          amount: input.amount ?? order.total,
          currency: order.currency,
          rawPayload: input.rawPayload,
        },
      })
    }

    // Decrement stock only for physical goods that track it.
    for (const item of order.items) {
      if (item.product.type !== ProductType.PHYSICAL) continue
      await tx.product.updateMany({
        where: { id: item.productId, stock: { not: null } },
        data: { stock: { decrement: item.quantity } },
      })
    }

    if (order.couponId) {
      await tx.coupon.update({
        where: { id: order.couponId },
        data: { usageCount: { increment: 1 } },
      })
    }

    if (order.customerId) {
      await tx.customer.update({
        where: { id: order.customerId },
        data: { ordersCount: { increment: 1 }, totalSpent: { increment: order.total } },
      })
    }

    await tx.cart.updateMany({
      where: { storeId: order.storeId, email: order.buyerEmail, status: { not: CartStatus.CONVERTED } },
      data: { status: CartStatus.CONVERTED, convertedAt: new Date() },
    })

    return { applied: true as const }
  })

  if (!transition.applied) return { applied: false }

  // Side effects that must not roll back the payment if they fail.
  await issueDownloadsForOrder(input.orderId)
  await enqueue("send_receipt", { orderId: input.orderId })
  await enqueue("send_delivery", { orderId: input.orderId })
  await enqueue("notify_seller", { orderId: input.orderId })

  return { applied: true }
}

export async function markOrderFailed(orderId: string, provider: string, providerRef: string, reason: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, total: true, currency: true } })
  // Never downgrade an order that already succeeded.
  if (!order || order.status !== OrderStatus.PENDING) return { applied: false }

  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.FAILED } }),
    prisma.payment.create({
      data: {
        orderId,
        provider,
        providerRef,
        status: PaymentStatus.FAILED,
        amount: order.total,
        currency: order.currency,
        errorMessage: reason,
      },
    }),
  ])
  return { applied: true }
}

/**
 * Reverses a paid order: restores stock, rolls back customer lifetime value,
 * releases the coupon use, and revokes outstanding download links.
 */
export async function markOrderRefunded(orderId: string, amount?: number | null) {
  const applied = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { type: true } } } } },
    })
    if (!order) return false
    if (order.status === OrderStatus.REFUNDED) return false
    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.FULFILLED) return false

    const refunded = amount ?? order.total

    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUNDED, refundedAt: new Date() },
    })

    await tx.payment.updateMany({
      where: { orderId, status: PaymentStatus.SUCCEEDED },
      data: { status: PaymentStatus.REFUNDED },
    })

    for (const item of order.items) {
      if (item.product.type !== ProductType.PHYSICAL) continue
      await tx.product.updateMany({
        where: { id: item.productId, stock: { not: null } },
        data: { stock: { increment: item.quantity } },
      })
    }

    if (order.couponId) {
      await tx.coupon.updateMany({
        where: { id: order.couponId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } },
      })
    }

    if (order.customerId) {
      await tx.customer.update({
        where: { id: order.customerId },
        data: { totalSpent: { decrement: refunded }, ordersCount: { decrement: 1 } },
      })
    }

    // Cut off further downloads without deleting the audit trail.
    await tx.download.updateMany({
      where: { orderItem: { orderId } },
      data: { expiresAt: new Date() },
    })

    return true
  })

  if (applied) {
    await enqueue("send_refund_email", { orderId, amount: amount ?? null })
  }
  return { applied }
}
