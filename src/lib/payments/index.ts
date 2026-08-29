import type { PaymentGateway } from "./gateway"
import { MockGateway } from "./mock-gateway"
import { StripeGateway } from "./stripe-gateway"

export * from "./gateway"

const registry = new Map<string, PaymentGateway>()

function register(gateway: PaymentGateway) {
  registry.set(gateway.id, gateway)
  return gateway
}

const stripe = register(new StripeGateway())
const mock = register(new MockGateway())

/** Every provider that currently has working credentials. */
export function availableGateways(): PaymentGateway[] {
  return [...registry.values()].filter((g) => g.isConfigured())
}

export function getGateway(id: string): PaymentGateway | null {
  const gateway = registry.get(id)
  return gateway && gateway.isConfigured() ? gateway : null
}

/**
 * The provider a new checkout should use: Stripe when configured, otherwise the
 * mock gateway in development. Throws in production when nothing is available,
 * rather than falling back to free orders.
 */
export function defaultGateway(): PaymentGateway {
  if (stripe.isConfigured()) return stripe
  if (mock.isConfigured()) return mock
  throw new Error(
    "No payment provider is configured. Set STRIPE_SECRET_KEY in your environment to accept payments."
  )
}
