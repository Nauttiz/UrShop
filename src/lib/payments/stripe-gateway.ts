import crypto from "crypto"
import { toProviderMinorUnit } from "@/lib/money"
import {
  PaymentGateway,
  type CheckoutInput,
  type CheckoutResult,
  type RefundResult,
  type WebhookVerification,
} from "./gateway"

const STRIPE_API = "https://api.stripe.com/v1"

/**
 * Stripe Checkout over the raw REST API — no SDK dependency.
 *
 * Amounts are sent in the provider's minor unit and are always the
 * server-computed order total; the browser never supplies a price.
 */
export class StripeGateway extends PaymentGateway {
  readonly id = "stripe"
  readonly displayName = "Stripe"

  private readonly secretKey = process.env.STRIPE_SECRET_KEY ?? ""
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ""

  isConfigured(): boolean {
    return this.secretKey.length > 0
  }

  private async post(path: string, form: URLSearchParams, connectedAccountId?: string | null) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    }
    // Charge on behalf of the seller's connected account when present.
    if (connectedAccountId) headers["Stripe-Account"] = connectedAccountId

    const res = await fetch(`${STRIPE_API}${path}`, { method: "POST", headers, body: form })
    const json = (await res.json()) as Record<string, any>
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `Stripe request failed with ${res.status}`)
    }
    return json
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!this.isConfigured()) throw new Error("STRIPE_SECRET_KEY is not set")

    const form = new URLSearchParams()
    form.set("mode", "payment")
    form.set("success_url", input.successUrl)
    form.set("cancel_url", input.cancelUrl)
    form.set("customer_email", input.buyerEmail)
    form.set("client_reference_id", input.orderId)
    form.set("metadata[orderId]", input.orderId)
    form.set("metadata[orderNumber]", input.orderNumber)
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      form.set(`metadata[${k}]`, v)
    }

    input.lines.forEach((line, i) => {
      form.set(`line_items[${i}][quantity]`, String(line.quantity))
      form.set(`line_items[${i}][price_data][currency]`, input.currency.toLowerCase())
      form.set(
        `line_items[${i}][price_data][unit_amount]`,
        String(toProviderMinorUnit(line.unitPrice, input.currency))
      )
      form.set(`line_items[${i}][price_data][product_data][name]`, line.name)
      if (line.description) {
        form.set(`line_items[${i}][price_data][product_data][description]`, line.description.slice(0, 500))
      }
      if (line.imageUrl && /^https?:\/\//.test(line.imageUrl)) {
        form.set(`line_items[${i}][price_data][product_data][images][0]`, line.imageUrl)
      }
    })

    // Stripe has no "order-level discount" on ad-hoc line items, so tax and
    // shipping become their own lines and the discount becomes a coupon.
    let index = input.lines.length
    const { tax, shipping, discount } = input.adjustments
    for (const [label, amount] of [
      ["Shipping", shipping],
      ["Tax", tax],
    ] as const) {
      if (amount <= 0) continue
      form.set(`line_items[${index}][quantity]`, "1")
      form.set(`line_items[${index}][price_data][currency]`, input.currency.toLowerCase())
      form.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(toProviderMinorUnit(amount, input.currency))
      )
      form.set(`line_items[${index}][price_data][product_data][name]`, label)
      index++
    }

    if (discount > 0) {
      const coupon = await this.post(
        "/coupons",
        new URLSearchParams({
          amount_off: String(toProviderMinorUnit(discount, input.currency)),
          currency: input.currency.toLowerCase(),
          duration: "once",
          name: "Discount",
        }),
        input.connectedAccountId
      )
      form.set("discounts[0][coupon]", coupon.id)
    }

    const session = await this.post("/checkout/sessions", form, input.connectedAccountId)
    return { redirectUrl: session.url as string, providerRef: session.id as string }
  }

  /**
   * Verifies Stripe's `t=…,v1=…` signature header with a constant-time compare
   * and rejects timestamps outside a 5-minute window to blunt replay attacks.
   */
  async verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookVerification> {
    if (!this.webhookSecret) return { ok: false, error: "STRIPE_WEBHOOK_SECRET is not set" }
    if (!signature) return { ok: false, error: "Missing stripe-signature header" }

    const parts = Object.fromEntries(
      signature.split(",").map((p) => {
        const idx = p.indexOf("=")
        return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()]
      })
    )
    const timestamp = parts["t"]
    const provided = parts["v1"]
    if (!timestamp || !provided) return { ok: false, error: "Malformed stripe-signature header" }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      return { ok: false, error: "Webhook timestamp outside tolerance" }
    }

    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex")

    const a = Buffer.from(expected, "utf8")
    const b = Buffer.from(provided, "utf8")
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "Signature mismatch" }
    }

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return { ok: false, error: "Body is not valid JSON" }
    }

    return {
      ok: true,
      eventId: event.id,
      type: event.type,
      payload: event,
      intent: this.normalise(event),
    }
  }

  private normalise(event: any): Extract<WebhookVerification, { ok: true }>["intent"] {
    const object = event?.data?.object ?? {}
    const orderId: string | null = object?.metadata?.orderId ?? object?.client_reference_id ?? null

    switch (event?.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        // `payment_status` guards against completed-but-unpaid async methods.
        if (object.payment_status && object.payment_status !== "paid") {
          return { kind: "ignored" }
        }
        return {
          kind: "payment_succeeded",
          providerRef: object.id,
          orderId,
          amount: typeof object.amount_total === "number" ? object.amount_total / 100 : null,
        }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
      case "payment_intent.payment_failed":
        return {
          kind: "payment_failed",
          providerRef: object.id,
          orderId,
          reason: object?.last_payment_error?.message ?? event?.type ?? null,
        }

      case "charge.refunded":
        return {
          kind: "refunded",
          providerRef: object.payment_intent ?? object.id,
          orderId,
          amount: typeof object.amount_refunded === "number" ? object.amount_refunded / 100 : null,
        }

      default:
        return { kind: "ignored" }
    }
  }

  async refund(providerRef: string, amount?: number): Promise<RefundResult> {
    if (!this.isConfigured()) return { ok: false, error: "STRIPE_SECRET_KEY is not set" }
    try {
      // providerRef is a Checkout Session id; resolve it to the PaymentIntent.
      let paymentIntent = providerRef
      if (providerRef.startsWith("cs_")) {
        const res = await fetch(`${STRIPE_API}/checkout/sessions/${providerRef}`, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
        })
        const session = (await res.json()) as Record<string, any>
        if (!res.ok) return { ok: false, error: session?.error?.message ?? "Session lookup failed" }
        if (!session.payment_intent) return { ok: false, error: "Session has no payment intent" }
        paymentIntent = session.payment_intent
      }

      const form = new URLSearchParams({ payment_intent: paymentIntent })
      if (amount !== undefined) form.set("amount", String(Math.round(amount * 100)))

      const refund = await this.post("/refunds", form)
      return { ok: true, providerRef: refund.id as string }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Refund failed" }
    }
  }
}
