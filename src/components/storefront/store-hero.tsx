import type { ThemeConfig } from "@/types"

interface StoreHeroProps {
  store: { name: string; description: string | null; logoUrl: string | null }
  theme: ThemeConfig
}

/**
 * The big branded banner at the top of a store's catalogue page.
 *
 * Distinct from `StoreNav`, which is the sticky bar carrying the cart — this
 * one is purely presentational and only appears on the catalogue.
 */
export function StoreHero({ store, theme }: StoreHeroProps) {
  return (
    <header
      className="px-4 py-12 text-center text-white"
      style={{ backgroundColor: theme.primaryColor }}
    >
      {store.logoUrl && (
        <img
          src={store.logoUrl}
          alt={store.name}
          className="mx-auto mb-4 h-16 w-16 rounded-full object-cover"
        />
      )}
      <h1 className="text-3xl font-bold">{store.name}</h1>
      {store.description && (
        <p className="mx-auto mt-2 max-w-xl text-white/80">{store.description}</p>
      )}
    </header>
  )
}
