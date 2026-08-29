import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getGateway } from "@/lib/payments"
import { markOrderFailed, markOrderPaid } from "@/lib/domain/orders"

/**
 * Stand-in for the payment provider's webhook while developing without keys.
 *
 * Guarded by `MockGateway.isConfigured()`, which is false in production unless
 * ALLOW_MOCK_PAYMENTS is explicitly set — otherwise this endpoint would be a
 * way to mark any order paid for free.
 */
export async function POST(req: Request) {
  const gateway = getGateway("mock")
  if (!gateway) {
    return NextResponse.json({ error: "Mock payments are disabled" }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    | { orderId?: string; providerRef?: string; outcome?: "success" | "failure" }
    | null

  if (!body?.orderId || !body?.providerRef) {
    return NextResponse.json({ error: "orderId and providerRef are required" }, { status: 400 })
  }

  // The reference must already belong to this order, so a caller cannot mark an
  // arbitrary order paid by inventing a reference.
  const payment = await prisma.payment.findFirst({
    where: { orderId: body.orderId, providerRef: body.providerRef, provider: "mock" },
    select: { id: true },
  })
  if (!payment) {
    return NextResponse.json({ error: "Unknown payment reference" }, { status: 404 })
  }

  if (body.outcome === "failure") {
    await markOrderFailed(body.orderId, "mock", body.providerRef, "Declined in test checkout")
    return NextResponse.json({ status: "failed" })
  }

  const result = await markOrderPaid({
    orderId: body.orderId,
    provider: "mock",
    providerRef: body.providerRef,
    rawPayload: { simulated: true },
  })

  const order = await prisma.order.findUnique({
    where: { id: body.orderId },
    select: { accessToken: true, store: { select: { slug: true } } },
  })

  return NextResponse.json({
    status: "paid",
    applied: result.applied,
    receiptUrl: order ? `/store/${order.store.slug}/orders/${order.accessToken}` : null,
  })
}
