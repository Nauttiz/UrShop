import { NextResponse } from "next/server"
import { OrderStatus } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { issueDownloadsForOrder } from "@/lib/domain/delivery"
import { orderStatusSchema } from "@/lib/validations"

type Ctx = { params: Promise<{ id: string }> }

async function ownedOrder(orderId: string) {
  const session = await auth()
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const order = await prisma.order.findFirst({
    where: { id: orderId, store: { userId: session.user.id } },
    select: { id: true, status: true },
  })
  if (!order) return { error: NextResponse.json({ error: "Order not found" }, { status: 404 }) }

  return { order }
}

/**
 * Manual status changes by the seller — marking a shipped parcel FULFILLED, or
 * cancelling an order that never got paid.
 *
 * Refunds are deliberately NOT reachable here: they must move money at the
 * provider first, which is what /api/orders/[id]/refund does.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params
  const owned = await ownedOrder(id)
  if (owned.error) return owned.error

  const parsed = orderStatusSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid status" }, { status: 400 })

  const next = parsed.data.status as OrderStatus
  const current = owned.order.status

  if (next === OrderStatus.REFUNDED) {
    return NextResponse.json(
      { error: "Use the refund action so the payment is reversed at the provider" },
      { status: 400 }
    )
  }

  const allowed: Record<OrderStatus, OrderStatus[]> = {
    PENDING: [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FAILED],
    FAILED: [OrderStatus.PAID, OrderStatus.CANCELLED],
    PAID: [OrderStatus.FULFILLED],
    FULFILLED: [OrderStatus.PAID],
    CANCELLED: [],
    REFUNDED: [],
  }

  if (!allowed[current].includes(next)) {
    return NextResponse.json(
      { error: `An order cannot move from ${current} to ${next}` },
      { status: 409 }
    )
  }

  const order = await prisma.order.update({
    where: { id },
    data: {
      status: next,
      ...(next === OrderStatus.PAID && current !== OrderStatus.PAID ? { paidAt: new Date() } : {}),
    },
  })

  // A manually-approved order still owes the buyer their files.
  if (next === OrderStatus.PAID) await issueDownloadsForOrder(id)

  return NextResponse.json(order)
}
