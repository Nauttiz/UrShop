import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { CartProvider } from "@/components/storefront/cart-provider"
import { StoreNav } from "@/components/storefront/store-nav"
import { VisitTracker } from "@/components/storefront/visit-tracker"
import { APP_NAME } from "@/lib/brand"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ storeSlug: string }>
}) {
  const { storeSlug } = await params

  const store = await prisma.store.findUnique({
    where: { slug: storeSlug },
    select: { name: true, logoUrl: true, themeConfig: true },
  })
  if (!store) notFound()

  const theme = { ...DEFAULT_THEME, ...((store.themeConfig ?? {}) as Partial<ThemeConfig>) }

  return (
    <CartProvider storeSlug={storeSlug}>
      <VisitTracker storeSlug={storeSlug} />
      <div
        className="min-h-screen bg-gray-50"
        style={
          {
            "--store-primary": theme.primaryColor,
            "--store-accent": theme.accentColor,
          } as React.CSSProperties
        }
      >
        <StoreNav
          storeSlug={storeSlug}
          storeName={store.name}
          logoUrl={store.logoUrl}
          theme={theme}
        />
        {children}
        <footer className="border-t bg-white py-8 text-center text-xs text-gray-500">
          <p>
            {store.name} — powered by <span className="font-medium">{APP_NAME}</span>
          </p>
        </footer>
      </div>
    </CartProvider>
  )
}
