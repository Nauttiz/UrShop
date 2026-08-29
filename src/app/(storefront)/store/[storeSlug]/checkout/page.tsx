import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { CheckoutForm } from "@/components/storefront/checkout-form"
import { availableGateways } from "@/lib/payments"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"

export const metadata = { title: "Checkout" }

export default async function CheckoutPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params

  const store = await prisma.store.findUnique({
    where: { slug: storeSlug },
    select: { currency: true, themeConfig: true },
  })
  if (!store) notFound()

  const theme = { ...DEFAULT_THEME, ...((store.themeConfig ?? {}) as Partial<ThemeConfig>) }
  const gateway = availableGateways()[0]

  if (!gateway) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Checkout is unavailable</h1>
        <p className="mt-3 text-gray-600">
          This store has not finished setting up payments yet. Please try again later.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Checkout</h1>
      <CheckoutForm
        storeSlug={storeSlug}
        currency={store.currency}
        primaryColor={theme.primaryColor}
        gatewayLabel={gateway.displayName}
      />
    </main>
  )
}
