"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, ShoppingCart } from "lucide-react"
import { useCart } from "./cart-provider"

type Props = {
  storeSlug: string
  productId: string
  price: number
  currency: string
  isPayWhatYouWant: boolean
  minPrice: number | null
  /** null for digital goods, which never run out. */
  stock: number | null
  primaryColor: string
  /** Compact variant used on catalogue cards. */
  compact?: boolean
}

export function AddToCart({
  storeSlug,
  productId,
  price,
  currency,
  isPayWhatYouWant,
  minPrice,
  stock,
  primaryColor,
  compact = false,
}: Props) {
  const { add, pending } = useCart()
  const router = useRouter()
  const [quantity, setQuantity] = useState(1)
  const [offered, setOffered] = useState<string>(String(minPrice ?? price))
  const [busy, setBusy] = useState(false)

  const soldOut = stock !== null && stock <= 0
  const floor = minPrice ?? price

  async function handleAdd(thenCheckout: boolean) {
    setBusy(true)
    const offeredPrice = isPayWhatYouWant ? Number(offered) : null
    const ok = await add(productId, quantity, offeredPrice)
    setBusy(false)
    if (ok && thenCheckout) router.push(`/store/${storeSlug}/checkout`)
  }

  if (soldOut) {
    return (
      <button
        disabled
        className="w-full cursor-not-allowed rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500"
      >
        Sold out
      </button>
    )
  }

  const disabled = busy || pending || (isPayWhatYouWant && Number(offered) < floor)

  if (compact) {
    return (
      <button
        onClick={() => handleAdd(false)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
        style={{ backgroundColor: primaryColor }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
        Add
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {isPayWhatYouWant && (
        <div className="space-y-1.5">
          <label htmlFor="offered" className="text-sm font-medium">
            Name your price
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{currency}</span>
            <input
              id="offered"
              type="number"
              min={floor}
              step="0.01"
              value={offered}
              onChange={(e) => setOffered(e.target.value)}
              className="w-32 rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <p className={`text-xs ${Number(offered) < floor ? "text-red-600" : "text-gray-500"}`}>
            Minimum {currency} {floor.toFixed(2)}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="px-3 py-2 text-sm hover:bg-gray-50"
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-medium">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(stock ?? 99, q + 1))}
            className="px-3 py-2 text-sm hover:bg-gray-50"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        {stock !== null && stock <= 5 && (
          <span className="text-xs font-medium text-amber-600">Only {stock} left</span>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => handleAdd(true)}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: primaryColor }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Buy now
        </button>
        <button
          onClick={() => handleAdd(false)}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-gray-50 disabled:opacity-60"
        >
          <ShoppingCart className="h-4 w-4" />
          Add to cart
        </button>
      </div>
    </div>
  )
}
