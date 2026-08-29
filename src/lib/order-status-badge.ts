import type { OrderStatus } from "@prisma/client"

/**
 * Badge colour per order status, shared by the dashboard overview, the order
 * list and the order detail page so one status never renders two ways.
 *
 * Presentation only — the rules about which transitions are legal live in
 * the order API route, not here.
 */
export const STATUS_VARIANT: Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "secondary",
  PAID: "default",
  FULFILLED: "outline",
  REFUNDED: "destructive",
  CANCELLED: "secondary",
  FAILED: "destructive",
}
