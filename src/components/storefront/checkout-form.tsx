"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, Lock, ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import { useCart } from "./cart-provider"
import { formatMoney } from "@/lib/money"

type FieldErrors = Record<string, string[] | undefined>

export function CheckoutForm({
  storeSlug,
  currency,
  primaryColor,
  gatewayLabel,
}: {
  storeSlug: string
  currency: string
  primaryColor: string
  gatewayLabel: string
}) {
  const { cart, loading } = useCart()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

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
        <h2 className="text-lg font-semibold">Nothing to check out</h2>
        <Link
          href={`/store/${storeSlug}`}
          className="mt-6 inline-block rounded-md px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: primaryColor }}
        >
          Browse products
        </Link>
      </div>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrors({})

    const form = new FormData(event.currentTarget)
    const requiresShipping = cart!.requiresShipping

    const payload = {
      email: String(form.get("email") ?? "").trim(),
      name: String(form.get("name") ?? "").trim() || null,
      notes: String(form.get("notes") ?? "").trim() || null,
      shippingAddress: requiresShipping
        ? {
            line1: String(form.get("line1") ?? "").trim(),
            line2: String(form.get("line2") ?? "").trim() || null,
            city: String(form.get("city") ?? "").trim(),
            state: String(form.get("state") ?? "").trim() || null,
            postalCode: String(form.get("postalCode") ?? "").trim(),
            country: String(form.get("country") ?? "").trim(),
          }
        : null,
    }

    try {
      const res = await fetch(`/api/store/${encodeURIComponent(storeSlug)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        setErrors(json?.details?.fieldErrors ?? {})
        toast.error(json?.error ?? "Checkout failed")
        setSubmitting(false)
        return
      }

      // Leave `submitting` true: the browser is on its way to the payment page
      // and re-enabling the button would invite a second order.
      router.push(json.redirectUrl)
    } catch {
      toast.error("Network error — please try again")
      setSubmitting(false)
    }
  }

  const { totals } = cart

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <section className="rounded-xl border bg-white p-5">
          <h2 className="mb-4 font-semibold">Contact details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              name="email"
              type="email"
              required
              error={errors.email?.[0]}
              hint="Your receipt and downloads are sent here"
              className="sm:col-span-2"
            />
            <Field label="Name (optional)" name="name" className="sm:col-span-2" />
          </div>
        </section>

        {cart.requiresShipping && (
          <section className="rounded-xl border bg-white p-5">
            <h2 className="mb-1 font-semibold">Shipping address</h2>
            <p className="mb-4 text-sm text-gray-500">Your order contains a physical product.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Street address" name="line1" required className="sm:col-span-2" />
              <Field label="Apartment, suite (optional)" name="line2" className="sm:col-span-2" />
              <Field label="City" name="city" required />
              <Field label="State / Province" name="state" />
              <Field label="Postal code" name="postalCode" required />
              <Field label="Country" name="country" required />
            </div>
          </section>
        )}

        <section className="rounded-xl border bg-white p-5">
          <label htmlFor="notes" className="mb-2 block font-semibold">
            Order notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={500}
            placeholder="Anything the seller should know?"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border bg-white p-5">
        <h2 className="font-semibold">Order summary</h2>

        <ul className="space-y-2 border-b pb-4 text-sm">
          {cart.items.map((item) => (
            <li key={item.productId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-gray-700">
                {item.name} × {item.quantity}
              </span>
              <span className="shrink-0 font-medium">{formatMoney(item.lineTotal, currency)}</span>
            </li>
          ))}
        </ul>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Subtotal</dt>
            <dd className="font-medium">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount {cart.coupon ? `(${cart.coupon.code})` : ""}</dt>
              <dd className="font-medium">−{formatMoney(totals.discountTotal, currency)}</dd>
            </div>
          )}
          {cart.requiresShipping && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Shipping</dt>
              <dd className="font-medium">
                {totals.shippingTotal > 0 ? formatMoney(totals.shippingTotal, currency) : "Free"}
              </dd>
            </div>
          )}
          {totals.taxTotal > 0 && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Tax</dt>
              <dd className="font-medium">{formatMoney(totals.taxTotal, currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-3 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatMoney(totals.total, currency)}</dd>
          </div>
        </dl>

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-70"
          style={{ backgroundColor: primaryColor }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {submitting ? "Redirecting…" : `Pay ${formatMoney(totals.total, currency)}`}
        </button>

        <p className="text-center text-xs text-gray-500">Payments handled by {gatewayLabel}</p>
      </aside>
    </form>
  )
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  error,
  hint,
  className = "",
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={name === "email" ? "email" : name === "name" ? "name" : "on"}
        className={`w-full rounded-md border px-3 py-2 text-sm ${error ? "border-red-500" : ""}`}
      />
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  )
}
