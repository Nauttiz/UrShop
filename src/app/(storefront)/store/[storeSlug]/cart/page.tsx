import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { CartView } from "@/components/storefront/cart-view"
import { CartRecovery } from "@/components/storefront/cart-recovery"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"

export const metadata = { title: "Your cart" }

export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>
  searchParams: Promise<{ recover?: string; cancelled?: string }>
}) {
  const { storeSlug } = await params
  const { recover, cancelled } = await searchParams

  const store = await prisma.store.findUnique({
    where: { slug: storeSlug },
    select: { currency: true, themeConfig: true },
  })
  if (!store) notFound()

  const theme = { ...DEFAULT_THEME, ...((store.themeConfig ?? {}) as Partial<ThemeConfig>) }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Your cart</h1>

      {cancelled && (
        <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Checkout was cancelled — your cart is exactly as you left it.
        </p>
      )}

      {recover && <CartRecovery storeSlug={storeSlug} token={recover} />}

      <CartView storeSlug={storeSlug} currency={store.currency} primaryColor={theme.primaryColor} />
    </main>
  )
}
