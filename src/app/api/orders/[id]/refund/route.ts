import { NextResponse } from "next/server"
import { OrderStatus, PaymentStatus } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { markOrderRefunded } from "@/lib/domain/orders"
import { getGateway } from "@/lib/payments"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Refunds a paid order.
 *
 * The provider is called FIRST. Only once the money has actually moved does the
 * local order flip to REFUNDED — the reverse order would leave the app claiming
 * a refund the buyer never received.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params

  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const order = await prisma.order.findFirst({
    where: { id, store: { userId: session.user.id } },
    include: {
      payments: {
        where: { status: PaymentStatus.SUCCEEDED },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  })
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

  if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.FULFILLED) {
    return NextResponse.json(
      { error: `Only paid orders can be refunded (this one is ${order.status})` },
      { status: 409 }
    )
  }

  const body = (await req.json().catch(() => null)) as { amount?: number } | null
  const amount = typeof body?.amount === "number" ? body.amount : undefined
  if (amount !== undefined && (amount <= 0 || amount > order.total)) {
    return NextResponse.json(
      { error: `Refund amount must be between 0 and ${order.total.toFixed(2)}` },
      { status: 400 }
    )
  }

  const payment = order.payments[0]
  if (!payment?.providerRef) {
    return NextResponse.json(
      { error: "This order has no completed payment to reverse" },
      { status: 409 }
    )
  }

  const gateway = getGateway(payment.provider)
  if (!gateway) {
    return NextResponse.json(
      { error: `${payment.provider} is no longer configured, so it cannot issue the refund` },
      { status: 503 }
    )
  }

  const refund = await gateway.refund(payment.providerRef, amount)
  if (!refund.ok) {
    return NextResponse.json({ error: refund.error }, { status: 502 })
  }

  const { applied } = await markOrderRefunded(id, amount)
  return NextResponse.json({ refunded: applied, providerRef: refund.providerRef })
}
