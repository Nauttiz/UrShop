"use client"

import Link from "next/link"
import { useState } from "react"
import { Loader2, Package, ShoppingCart, Tag, Trash2, X } from "lucide-react"
import { useCart } from "./cart-provider"
import { formatMoney } from "@/lib/money"

export function CartView({
  storeSlug,
  currency,
  primaryColor,
}: {
  storeSlug: string
  currency: string
  primaryColor: string
}) {
  const { cart, loading, pending, setQuantity, remove, clear, applyCoupon, removeCoupon } = useCart()
  const [code, setCode] = useState("")
  const [applying, setApplying] = useState(false)

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="rounded-xl border bg-white py-20 text-center">
        <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-gray-300" />
        <h2 className="text-lg font-semibold">Your cart is empty</h2>
        <p className="mt-1 text-sm text-gray-500">Browse the store and add something you like.</p>
        <Link
          href={`/store/${storeSlug}`}
          className="mt-6 inline-block rounded-md px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: primaryColor }}
        >
          Continue shopping
        </Link>
      </div>
    )
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setApplying(true)
    const ok = await applyCoupon(code.trim())
    setApplying(false)
    if (ok) setCode("")
  }

  const { totals } = cart

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {cart.items.map((item) => (
          <div key={item.productId} className="flex gap-4 rounded-xl border bg-white p-4">
            <Link
              href={`/store/${storeSlug}/products/${item.slug ?? item.productId}`}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-gray-100"
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <Package className="h-7 w-7 text-gray-300" />
                </div>
              )}
            </Link>

            <div className="min-w-0 flex-1">
              <Link
                href={`/store/${storeSlug}/products/${item.slug ?? item.productId}`}
                className="font-medium hover:underline"
              >
                {item.name}
              </Link>
              <p className="mt-0.5 text-sm text-gray-500">
                {formatMoney(item.unitPrice, currency)} each
              </p>

              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center rounded-md border">
                  <button
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    disabled={pending}
                    className="px-2.5 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                    aria-label={`Decrease quantity of ${item.name}`}
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    disabled={pending || (item.stock !== null && item.quantity >= item.stock)}
                    className="px-2.5 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                    aria-label={`Increase quantity of ${item.name}`}
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => remove(item.productId)}
                  disabled={pending}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            </div>

            <p className="shrink-0 font-semibold">{formatMoney(item.lineTotal, currency)}</p>
          </div>
        ))}

        <div className="flex justify-between pt-1">
          <Link href={`/store/${storeSlug}`} className="text-sm text-gray-600 hover:underline">
            ← Continue shopping
          </Link>
          <button
            onClick={clear}
            disabled={pending}
            className="text-sm text-gray-500 hover:text-red-600 disabled:opacity-50"
          >
            Clear cart
          </button>
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border bg-white p-5">
        <h2 className="font-semibold">Order summary</h2>

        {cart.coupon ? (
          <div className="flex items-center justify-between rounded-md bg-green-50 px-3 py-2 text-sm">
            <span className="flex items-center gap-1.5 font-medium text-green-800">
              <Tag className="h-3.5 w-3.5" />
              {cart.coupon.code}
            </span>
            <button
              onClick={removeCoupon}
              disabled={pending}
              className="text-green-700 hover:text-green-900 disabled:opacity-50"
              aria-label="Remove coupon"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleApply} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Coupon code"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm uppercase"
            />
            <button
              type="submit"
              disabled={applying || !code.trim()}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </button>
          </form>
        )}

        <dl className="space-y-2 border-t pt-4 text-sm">
          <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
          {totals.discountTotal > 0 && (
            <Row
              label="Discount"
              value={`−${formatMoney(totals.discountTotal, currency)}`}
              className="text-green-700"
            />
          )}
          {cart.requiresShipping && (
            <Row
              label="Shipping"
              value={totals.shippingTotal > 0 ? formatMoney(totals.shippingTotal, currency) : "Free"}
            />
          )}
          {totals.taxTotal > 0 && <Row label="Tax" value={formatMoney(totals.taxTotal, currency)} />}
          <div className="flex justify-between border-t pt-3 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatMoney(totals.total, currency)}</dd>
          </div>
        </dl>

        <Link
          href={`/store/${storeSlug}/checkout`}
          className="block w-full rounded-md py-2.5 text-center text-sm font-semibold text-white"
          style={{ backgroundColor: primaryColor }}
        >
          Checkout
        </Link>
      </aside>
    </div>
  )
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
