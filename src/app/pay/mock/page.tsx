import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { getGateway } from "@/lib/payments"
import { MockPayForm } from "@/components/payments/mock-pay-form"

export const metadata = { title: "Test checkout", robots: { index: false, follow: false } }

// Whether the mock gateway is enabled is read from the environment at request
// time, so this page must never be baked into the static build.
export const dynamic = "force-dynamic"

/**
 * Simulated hosted payment page.
 *
 * Only reachable while the mock gateway is enabled, which is development-only
 * unless ALLOW_MOCK_PAYMENTS is deliberately set.
 */
export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; order?: string }>
}) {
  if (!getGateway("mock")) notFound()

  const { ref, order: orderId } = await searchParams
  if (!ref || !orderId) notFound()

  const order = await prisma.order.findFirst({
    where: { id: orderId, payments: { some: { providerRef: ref, provider: "mock" } } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      currency: true,
      buyerEmail: true,
      accessToken: true,
      store: { select: { name: true, slug: true } },
    },
  })
  if (!order) notFound()

  return (
    <main className="grid min-h-screen place-items-center bg-gray-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Test mode.</strong> No real payment provider is
          configured, so this page stands in for the checkout form. Set{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">STRIPE_SECRET_KEY</code> to take
          real payments.
        </div>

        <div className="rounded-xl border bg-white p-6">
          <p className="text-sm text-gray-500">{order.store.name}</p>
          <h1 className="mt-1 text-2xl font-bold">{formatMoney(order.total, order.currency)}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Order <span className="font-mono">{order.orderNumber}</span> · {order.buyerEmail}
          </p>

          <MockPayForm
            orderId={order.id}
            providerRef={ref}
            receiptUrl={`/store/${order.store.slug}/orders/${order.accessToken}`}
            cancelUrl={`/store/${order.store.slug}/cart?cancelled=1`}
          />
        </div>
      </div>
    </main>
  )
}
