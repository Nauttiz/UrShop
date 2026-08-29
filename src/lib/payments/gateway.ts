/**
 * Payment gateway abstraction.
 *
 * Checkout, webhooks and refunds all talk to this interface, never to a
 * specific provider. Adding PayPal means adding one subclass and one entry in
 * the registry — nothing in the order pipeline changes.
 */

export type CheckoutLine = {
  name: string
  description?: string
  unitPrice: number
  quantity: number
  imageUrl?: string | null
}

export type CheckoutInput = {
  orderId: string
  orderNumber: string
  currency: string
  /** Authoritative amount computed server-side by PricingEngine. */
  total: number
  lines: CheckoutLine[]
  /** Aggregate of discount + tax + shipping, folded into a single adjustment line. */
  adjustments: { discount: number; tax: number; shipping: number }
  buyerEmail: string
  successUrl: string
  cancelUrl: string
  /** Seller's Stripe Connect account, when the platform charges on their behalf. */
  connectedAccountId?: string | null
  metadata?: Record<string, string>
}

export type CheckoutResult = {
  /** Where to send the buyer's browser. */
  redirectUrl: string
  /** Provider-side id we store on Payment.providerRef for reconciliation. */
  providerRef: string
}

export type WebhookVerification =
  | {
      ok: true
      eventId: string
      type: string
      payload: unknown
      /** Normalised outcome the order pipeline acts on. */
      intent:
        | { kind: "payment_succeeded"; providerRef: string; orderId: string | null; amount: number | null }
        | { kind: "payment_failed"; providerRef: string; orderId: string | null; reason: string | null }
        | { kind: "refunded"; providerRef: string; orderId: string | null; amount: number | null }
        | { kind: "ignored" }
    }
  | { ok: false; error: string }

export type RefundResult = { ok: true; providerRef: string } | { ok: false; error: string }

export abstract class PaymentGateway {
  abstract readonly id: string
  abstract readonly displayName: string

  /** False when the provider is missing credentials, so the UI can hide it. */
  abstract isConfigured(): boolean

  abstract createCheckout(input: CheckoutInput): Promise<CheckoutResult>

  /**
   * Verifies the signature and normalises the event. Implementations must not
   * trust the body before the signature check passes.
   */
  abstract verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookVerification>

  abstract refund(providerRef: string, amount?: number): Promise<RefundResult>
}
