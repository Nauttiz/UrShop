import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getGateway } from "@/lib/payments"
import { markOrderFailed, markOrderPaid, markOrderRefunded } from "@/lib/domain/orders"

/** Stripe signs the exact bytes it sent, so the body must not be re-parsed first. */
export async function POST(req: Request) {
  const gateway = getGateway("stripe")
  if (!gateway) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 })
  }

  const rawBody = await req.text()
  const verified = await gateway.verifyWebhook(rawBody, req.headers.get("stripe-signature"))

  if (!verified.ok) {
    // 400 tells Stripe not to retry — a bad signature will never become valid.
    return NextResponse.json({ error: verified.error }, { status: 400 })
  }

  // Idempotency gate: the unique (provider, eventId) index means a redelivered
  // event loses the insert race and returns here without re-running side effects.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: "stripe",
        eventId: verified.eventId,
        type: verified.type,
        payload: verified.payload as object,
      },
    })
  } catch {
    return NextResponse.json({ received: true, duplicate: true })
  }

  const intent = verified.intent

  try {
    switch (intent.kind) {
      case "payment_succeeded": {
        const orderId = intent.orderId ?? (await orderIdFromRef(intent.providerRef))
        if (orderId) {
          await markOrderPaid({
            orderId,
            provider: "stripe",
            providerRef: intent.providerRef,
            amount: intent.amount,
            rawPayload: verified.payload as object,
          })
        }
        break
      }
      case "payment_failed": {
        const orderId = intent.orderId ?? (await orderIdFromRef(intent.providerRef))
        if (orderId) await markOrderFailed(orderId, "stripe", intent.providerRef, intent.reason)
        break
      }
      case "refunded": {
        const orderId = intent.orderId ?? (await orderIdFromRef(intent.providerRef))
        if (orderId) await markOrderRefunded(orderId, intent.amount)
        break
      }
      case "ignored":
        break
    }

    await prisma.webhookEvent.updateMany({
      where: { provider: "stripe", eventId: verified.eventId },
      data: { processedAt: new Date() },
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed"
    await prisma.webhookEvent.updateMany({
      where: { provider: "stripe", eventId: verified.eventId },
      data: { error: message },
    })
    // 500 asks Stripe to retry; the ledger row records why the first pass failed.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Falls back to the Payment row when the event carries no order metadata. */
async function orderIdFromRef(providerRef: string): Promise<string | null> {
  const payment = await prisma.payment.findFirst({
    where: { providerRef },
    select: { orderId: true },
  })
  return payment?.orderId ?? null
}
