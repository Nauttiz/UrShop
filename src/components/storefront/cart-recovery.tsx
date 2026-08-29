"use client"

import { useEffect, useRef } from "react"
import { useCart } from "./cart-provider"

/**
 * Adopts a cart referenced by an abandoned-cart email link.
 *
 * The provider only auto-recovers on its first mount, and the cart page mounts
 * under an already-running provider, so the swap happens here instead.
 */
export function CartRecovery({ storeSlug, token }: { storeSlug: string; token: string }) {
  const { refresh } = useCart()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true

    void (async () => {
      await fetch(`/api/store/${encodeURIComponent(storeSlug)}/cart`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      await refresh()
    })()
  }, [storeSlug, token, refresh])

  return null
}
