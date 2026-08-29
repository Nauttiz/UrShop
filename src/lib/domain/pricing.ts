import { CouponType, ProductType } from "@prisma/client"
import { clampCents, percentOf, toAmount, toCents } from "@/lib/money"
import type { StoreSettings } from "@/lib/store-settings"

/** The minimum a line needs to expose for pricing — works for cart rows and order rows alike. */
export type PricedLine = {
  productId: string
  name: string
  unitPrice: number
  quantity: number
  type: ProductType
}

export type CouponLike = {
  id: string
  code: string
  type: CouponType
  discount: number
  minSubtotal: number | null
  usageLimit: number | null
  usageCount: number
  isActive: boolean
  expiresAt: Date | null
}

export type CouponRejection =
  | "NOT_FOUND"
  | "INACTIVE"
  | "EXPIRED"
  | "USAGE_LIMIT_REACHED"
  | "MIN_SUBTOTAL_NOT_MET"

export type CouponEvaluation =
  | { ok: true; coupon: CouponLike; discountCents: number }
  | { ok: false; reason: CouponRejection; message: string; requiredSubtotal?: number }

export type Quote = {
  lines: Array<PricedLine & { lineTotal: number }>
  subtotal: number
  discountTotal: number
  taxTotal: number
  shippingTotal: number
  total: number
  /** Present only when a coupon was supplied AND accepted. */
  appliedCoupon: { id: string; code: string; type: CouponType; discount: number } | null
  /** Present when a coupon was supplied and rejected, so the UI can explain why. */
  couponError: { reason: CouponRejection; message: string } | null
  requiresShipping: boolean
  hasDigitalItems: boolean
}

/**
 * Single source of truth for what a basket costs.
 *
 * The storefront calls it to preview totals and the checkout API calls it again
 * to compute the authoritative amount — the client never sends a total, only
 * product ids and quantities, so a tampered payload cannot change the price.
 */
export class PricingEngine {
  constructor(private readonly settings: StoreSettings) {}

  /**
   * Validates a coupon against a subtotal (in cents) and returns the discount
   * it would grant. Percentage discounts are capped at the subtotal so a
   * coupon can never produce a negative order.
   */
  evaluateCoupon(coupon: CouponLike | null | undefined, subtotalCents: number, now = new Date()): CouponEvaluation {
    if (!coupon) {
      return { ok: false, reason: "NOT_FOUND", message: "Coupon code not found" }
    }
    if (!coupon.isActive) {
      return { ok: false, reason: "INACTIVE", message: "This coupon is no longer active" }
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "EXPIRED", message: "This coupon has expired" }
    }
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      return { ok: false, reason: "USAGE_LIMIT_REACHED", message: "This coupon has reached its usage limit" }
    }
    if (coupon.minSubtotal !== null && subtotalCents < toCents(coupon.minSubtotal)) {
      return {
        ok: false,
        reason: "MIN_SUBTOTAL_NOT_MET",
        message: `Spend at least ${coupon.minSubtotal.toFixed(2)} to use this coupon`,
        requiredSubtotal: coupon.minSubtotal,
      }
    }

    const raw =
      coupon.type === CouponType.PERCENT
        ? percentOf(subtotalCents, coupon.discount)
        : toCents(coupon.discount)

    return { ok: true, coupon, discountCents: Math.min(raw, subtotalCents) }
  }

  /** Computes every total for a basket. All arithmetic happens in integer cents. */
  quote(lines: PricedLine[], coupon?: CouponLike | null, now = new Date()): Quote {
    const priced = lines.map((line) => ({
      ...line,
      lineTotal: toAmount(toCents(line.unitPrice) * line.quantity),
    }))

    const subtotalCents = lines.reduce((sum, l) => sum + toCents(l.unitPrice) * l.quantity, 0)

    let discountCents = 0
    let appliedCoupon: Quote["appliedCoupon"] = null
    let couponError: Quote["couponError"] = null

    if (coupon) {
      const evaluation = this.evaluateCoupon(coupon, subtotalCents, now)
      if (evaluation.ok) {
        discountCents = evaluation.discountCents
        appliedCoupon = {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          discount: coupon.discount,
        }
      } else {
        couponError = { reason: evaluation.reason, message: evaluation.message }
      }
    }

    const requiresShipping = lines.some((l) => l.type === ProductType.PHYSICAL)
    const hasDigitalItems = lines.some((l) => l.type !== ProductType.PHYSICAL)

    const discountedCents = clampCents(subtotalCents - discountCents)
    const shippingCents = this.shippingFor(requiresShipping, discountedCents)
    const taxCents = percentOf(discountedCents, this.settings.taxRate)
    const totalCents = clampCents(discountedCents + shippingCents + taxCents)

    return {
      lines: priced,
      subtotal: toAmount(subtotalCents),
      discountTotal: toAmount(discountCents),
      taxTotal: toAmount(taxCents),
      shippingTotal: toAmount(shippingCents),
      total: toAmount(totalCents),
      appliedCoupon,
      couponError,
      requiresShipping,
      hasDigitalItems,
    }
  }

  private shippingFor(requiresShipping: boolean, discountedCents: number): number {
    if (!requiresShipping) return 0
    const { freeShippingOver, flatShipping } = this.settings
    if (freeShippingOver !== null && discountedCents >= toCents(freeShippingOver)) return 0
    return toCents(flatShipping)
  }
}

/**
 * The price a buyer must pay for one unit, honouring pay-what-you-want.
 * `offered` is what the buyer typed; it is floored at the product's minimum
 * (or list price for fixed-price products) so the seller is never underpaid.
 */
export function resolveUnitPrice(
  product: { price: number; isPayWhatYouWant: boolean; minPrice: number | null },
  offered?: number | null
): number {
  if (!product.isPayWhatYouWant) return product.price
  const floor = product.minPrice ?? product.price
  if (offered === null || offered === undefined || !Number.isFinite(offered)) return floor
  return Math.max(floor, offered)
}
