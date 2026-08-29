/**
 * Money helpers.
 *
 * Prices are stored as `Float` columns for backwards compatibility, but every
 * calculation in the commerce path runs on integer cents so repeated
 * percentage discounts and tax never drift (0.1 + 0.2 !== 0.3).
 * Convert at the edges: `toCents` on the way in, `toAmount` on the way out.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

export function toAmount(cents: number): number {
  return Math.round(cents) / 100
}

/** Percentage of a cent amount, rounded half-up. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100)
}

export function clampCents(cents: number, min = 0): number {
  return Math.max(min, Math.round(cents))
}

const CURRENCY_LOCALE: Record<string, string> = {
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  VND: "vi-VN",
  JPY: "ja-JP",
  AUD: "en-AU",
  CAD: "en-CA",
}

/** Zero-decimal currencies per the ISO-4217 / Stripe list we support. */
const ZERO_DECIMAL = new Set(["VND", "JPY", "KRW"])

export function formatMoney(amount: number, currency = "USD"): string {
  const locale = CURRENCY_LOCALE[currency] ?? "en-US"
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
      maximumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Smallest unit expected by the payment provider. Stripe wants 100 for $1.00
 * but 100 for ¥100 — zero-decimal currencies are not multiplied.
 */
export function toProviderMinorUnit(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100)
}

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(currency)
}
