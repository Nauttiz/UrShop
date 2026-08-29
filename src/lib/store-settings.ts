import type { Prisma } from "@prisma/client"

/**
 * Per-store commerce configuration, persisted in `Store.settings` (JSON).
 * Every field has a default so existing stores keep working with a null column.
 */
export type StoreSettings = {
  /** Tax applied to the discounted subtotal, as a percentage (7.5 = 7.5%). */
  taxRate: number
  /** Flat shipping fee charged once when the cart contains a physical item. */
  flatShipping: number
  /** Subtotal above which shipping is waived. `null` disables free shipping. */
  freeShippingOver: number | null
  /** Default max downloads per purchased digital file. `null` = unlimited. */
  downloadLimit: number | null
  /** Hours a download link stays valid. `null` = never expires. */
  downloadExpiryHours: number | null
  /** Idle hours before an abandoned-cart reminder is queued. */
  abandonedCartHours: number
  /** Send the buyer a receipt email after a successful payment. */
  sendReceiptEmail: boolean
  /** Notify the seller on every new paid order. */
  notifySellerOnOrder: boolean
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  taxRate: 0,
  flatShipping: 0,
  freeShippingOver: null,
  downloadLimit: 5,
  downloadExpiryHours: 24 * 30,
  abandonedCartHours: 4,
  sendReceiptEmail: true,
  notifySellerOnOrder: true,
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

function nullableNum(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  if (value === undefined) return fallback
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/** Coerces the untyped JSON column into a fully-populated settings object. */
export function parseStoreSettings(raw: Prisma.JsonValue | null | undefined): StoreSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_STORE_SETTINGS }
  const r = raw as Record<string, unknown>
  const d = DEFAULT_STORE_SETTINGS
  return {
    taxRate: Math.min(100, Math.max(0, num(r.taxRate, d.taxRate))),
    flatShipping: Math.max(0, num(r.flatShipping, d.flatShipping)),
    freeShippingOver: nullableNum(r.freeShippingOver, d.freeShippingOver),
    downloadLimit: nullableNum(r.downloadLimit, d.downloadLimit),
    downloadExpiryHours: nullableNum(r.downloadExpiryHours, d.downloadExpiryHours),
    abandonedCartHours: Math.max(1, num(r.abandonedCartHours, d.abandonedCartHours)),
    sendReceiptEmail: bool(r.sendReceiptEmail, d.sendReceiptEmail),
    notifySellerOnOrder: bool(r.notifySellerOnOrder, d.notifySellerOnOrder),
  }
}
