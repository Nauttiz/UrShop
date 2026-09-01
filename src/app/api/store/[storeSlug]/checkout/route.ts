import { NextResponse } from "next/server"
import { PaymentStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { findCart } from "@/lib/domain/cart"
import { createOrderFromCart } from "@/lib/domain/orders"
import { readAttribution } from "@/lib/analytics/attribution"
import { defaultGateway } from "@/lib/payments"
import { checkoutSchema } from "@/lib/validations"
import { getBaseUrl } from "@/lib/urls"

type Ctx = { params: Promise<{ storeSlug: string }> }

/**
 * Converts the buyer's cart into a PENDING order and hands back the payment
 * provider's redirect URL.
 *
 * The request body carries contact and shipping details only. Every price is
 * recomputed server-side from the database, so nothing the browser sends can
 * change what the buyer is charged.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { storeSlug } = await params

  const store = await prisma.store.findUnique({
    where: { slug: storeSlug },
    select: { id: true, slug: true, stripeAccountId: true },
  })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const parsed = checkoutSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check your details", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const cart = await findCart(store.id)
  if (!cart || cart.items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 })
  }

  // Remember the email on the cart so an abandoned checkout can still be
  // recovered by email even though no order exists yet.
  await prisma.cart.update({
    where: { id: cart.id },
    data: { email: parsed.data.email, name: parsed.data.name ?? null },
  })

  const created = await createOrderFromCart({
    storeId: store.id,
    cart,
    buyerEmail: parsed.data.email,
    buyerName: parsed.data.name ?? null,
    shippingAddress: parsed.data.shippingAddress ?? null,
    notes: parsed.data.notes ?? null,
    // A pure cookie read — no extra query, and a missing or corrupt cookie just
    // leaves the order unattributed rather than failing the checkout.
    attribution: await readAttribution(store.id),
  })

  if (!created.ok) {
    return NextResponse.json({ error: created.message, code: created.code }, { status: 409 })
  }

  const order = created.order
  const baseUrl = await getBaseUrl()

  let gateway
  try {
    gateway = defaultGateway()
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No payment provider configured" },
      { status: 503 }
    )
  }

  try {
    const session = await gateway.createCheckout({
      orderId: order.id,
      orderNumber: order.orderNumber,
      currency: order.currency,
      total: order.total,
      lines: order.items.map((item) => ({
        name: item.name,
        description: item.product.description?.slice(0, 300) ?? undefined,
        unitPrice: item.price,
        quantity: item.quantity,
        imageUrl: item.product.thumbnail,
      })),
      adjustments: {
        discount: order.discountTotal,
        tax: order.taxTotal,
        shipping: order.shippingTotal,
      },
      buyerEmail: order.buyerEmail,
      successUrl: `${baseUrl}/store/${store.slug}/orders/${order.accessToken}`,
      cancelUrl: `${baseUrl}/store/${store.slug}/cart?cancelled=1`,
      connectedAccountId: store.stripeAccountId,
      metadata: { storeId: store.id, storeSlug: store.slug },
    })

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: gateway.id,
        providerRef: session.providerRef,
        status: PaymentStatus.PENDING,
        amount: order.total,
        currency: order.currency,
      },
    })

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      redirectUrl: session.redirectUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout"
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: gateway.id,
        status: PaymentStatus.FAILED,
        amount: order.total,
        currency: order.currency,
        errorMessage: message,
      },
    })
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
