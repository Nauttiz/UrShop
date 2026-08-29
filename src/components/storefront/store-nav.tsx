"use client"

import Link from "next/link"
import { ShoppingCart } from "lucide-react"
import { useCart } from "./cart-provider"
import type { ThemeConfig } from "@/types"

export function StoreNav({
  storeSlug,
  storeName,
  logoUrl,
  theme,
}: {
  storeSlug: string
  storeName: string
  logoUrl: string | null
  theme: ThemeConfig
}) {
  const { itemCount, loading } = useCart()

  return (
    <nav className="sticky top-0 z-40 border-b bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href={`/store/${storeSlug}`} className="flex min-w-0 items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: theme.primaryColor }}
            >
              {storeName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="truncate font-semibold">{storeName}</span>
        </Link>

        <Link
          href={`/store/${storeSlug}/cart`}
          className="relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-gray-100"
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="hidden sm:inline">Cart</span>
          {!loading && itemCount > 0 && (
            <span
              className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white"
              style={{ backgroundColor: theme.primaryColor }}
            >
              {itemCount}
            </span>
          )}
        </Link>
      </div>
    </nav>
  )
}
