"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { SerializedCart } from "@/lib/domain/cart"

type CartContextValue = {
  cart: SerializedCart | null
  itemCount: number
  loading: boolean
  /** True while a mutation is in flight, so buttons can disable themselves. */
  pending: boolean
  add: (productId: string, quantity?: number, offeredPrice?: number | null) => Promise<boolean>
  setQuantity: (productId: string, quantity: number) => Promise<void>
  remove: (productId: string) => Promise<void>
  clear: () => Promise<void>
  applyCoupon: (code: string) => Promise<boolean>
  removeCoupon: () => Promise<void>
  refresh: () => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const value = useContext(CartContext)
  if (!value) throw new Error("useCart must be used inside <CartProvider>")
  return value
}

export function CartProvider({
  storeSlug,
  children,
  recoverToken,
}: {
  storeSlug: string
  children: React.ReactNode
  /** Cart token from an abandoned-cart email link. */
  recoverToken?: string | null
}) {
  const [cart, setCart] = useState<SerializedCart | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)

  const endpoint = `/api/store/${encodeURIComponent(storeSlug)}/cart`

  const request = useCallback(
    async (init: RequestInit & { path?: string }): Promise<{ ok: boolean; error?: string }> => {
      setPending(true)
      try {
        const res = await fetch(`${endpoint}${init.path ?? ""}`, {
          ...init,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) return { ok: false, error: json?.error ?? "Something went wrong" }
        setCart(json as SerializedCart)
        return { ok: true }
      } catch {
        return { ok: false, error: "Network error — please try again" }
      } finally {
        setPending(false)
      }
    },
    [endpoint]
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(endpoint)
      if (res.ok) setCart((await res.json()) as SerializedCart)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    // A recovery link restores the emailed cart before the first read.
    if (recoverToken) {
      void (async () => {
        await request({ method: "PUT", body: JSON.stringify({ token: recoverToken }) })
        setLoading(false)
      })()
      return
    }
    void refresh()
  }, [recoverToken, refresh, request])

  const add = useCallback<CartContextValue["add"]>(
    async (productId, quantity = 1, offeredPrice = null) => {
      const result = await request({
        method: "POST",
        body: JSON.stringify({ productId, quantity, offeredPrice }),
      })
      if (!result.ok) {
        toast.error(result.error!)
        return false
      }
      toast.success("Added to cart")
      return true
    },
    [request]
  )

  const setQuantity = useCallback<CartContextValue["setQuantity"]>(
    async (productId, quantity) => {
      const result = await request({ method: "PATCH", body: JSON.stringify({ productId, quantity }) })
      if (!result.ok) toast.error(result.error!)
    },
    [request]
  )

  const remove = useCallback<CartContextValue["remove"]>(
    async (productId) => {
      await setQuantity(productId, 0)
    },
    [setQuantity]
  )

  const clear = useCallback(async () => {
    const result = await request({ method: "DELETE" })
    if (!result.ok) toast.error(result.error!)
  }, [request])

  const applyCoupon = useCallback<CartContextValue["applyCoupon"]>(
    async (code) => {
      const result = await request({
        method: "POST",
        path: "/coupon",
        body: JSON.stringify({ code }),
      })
      if (!result.ok) {
        toast.error(result.error!)
        return false
      }
      toast.success("Coupon applied")
      return true
    },
    [request]
  )

  const removeCoupon = useCallback(async () => {
    await request({ method: "DELETE", path: "/coupon" })
  }, [request])

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      itemCount: cart?.itemCount ?? 0,
      loading,
      pending,
      add,
      setQuantity,
      remove,
      clear,
      applyCoupon,
      removeCoupon,
      refresh,
    }),
    [cart, loading, pending, add, setQuantity, remove, clear, applyCoupon, removeCoupon, refresh]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
