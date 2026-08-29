import crypto from "crypto"
import {
  PaymentGateway,
  type CheckoutInput,
  type CheckoutResult,
  type RefundResult,
  type WebhookVerification,
} from "./gateway"

/**
 * Development gateway used when no real provider is configured.
 *
 * It redirects the buyer to an in-app page that plays the role of the hosted
 * payment form, so the whole funnel — order, webhook, digital delivery, receipt
 * email — is exercisable end to end without Stripe credentials.
 *
 * `assertNotProduction` refuses to run outside development so a missing key in
 * production fails loudly instead of silently handing out free orders.
 */
export class MockGateway extends PaymentGateway {
  readonly id = "mock"
  readonly displayName = "Test payment (no card required)"

  isConfigured(): boolean {
    return process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_PAYMENTS === "true"
  }

  private assertAllowed() {
    if (!this.isConfigured()) {
      throw new Error(
        "No payment provider configured. Set STRIPE_SECRET_KEY, or set ALLOW_MOCK_PAYMENTS=true to accept test payments."
      )
    }
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    this.assertAllowed()
    const providerRef = `mock_${crypto.randomBytes(12).toString("hex")}`
    const url = new URL(input.successUrl)
    // Point at the simulated payment form rather than straight at success.
    const pay = new URL("/pay/mock", url.origin)
    pay.searchParams.set("ref", providerRef)
    pay.searchParams.set("order", input.orderId)
    return { redirectUrl: pay.toString(), providerRef }
  }

  async verifyWebhook(rawBody: string): Promise<WebhookVerification> {
    this.assertAllowed()
    try {
      const event = JSON.parse(rawBody)
      return {
        ok: true,
        eventId: event.id ?? crypto.randomUUID(),
        type: event.type ?? "payment_succeeded",
        payload: event,
        intent: {
          kind: "payment_succeeded",
          providerRef: event.providerRef,
          orderId: event.orderId ?? null,
          amount: event.amount ?? null,
        },
      }
    } catch {
      return { ok: false, error: "Body is not valid JSON" }
    }
  }

  async refund(providerRef: string): Promise<RefundResult> {
    return { ok: true, providerRef: `mock_refund_${providerRef}` }
  }
}
