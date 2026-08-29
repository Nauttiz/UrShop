import crypto from "crypto"
import { cookies } from "next/headers"
import { CartStatus, ProductType, type Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PricingEngine, resolveUnitPrice, type Quote } from "@/lib/domain/pricing"
import { parseStoreSettings } from "@/lib/store-settings"

export const CART_COOKIE = "sf_cart"
const CART_MAX_AGE = 60 * 60 * 24 * 30 // 30 days
export const MAX_QUANTITY_PER_LINE = 99

const cartInclude = {
  coupon: true,
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          thumbnail: true,
          type: true,
          stock: true,
          isPublished: true,
          isPayWhatYouWant: true,
          minPrice: true,
        },
      },
    },
    orderBy: { id: "asc" },
  },
} as const

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>

export async function readCartToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(CART_COOKIE)?.value ?? null
}

/** Route handlers and server actions may write cookies; server components may not. */
export async function writeCartToken(token: string): Promise<void> {
  const store = await cookies()
  store.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_MAX_AGE,
  })
}

/** Read-only lookup safe to call from a server component. */
export async function findCart(storeId: string, token?: string | null): Promise<CartWithItems | null> {
  const cartToken = token ?? (await readCartToken())
  if (!cartToken) return null

  const cart = await prisma.cart.findUnique({ where: { token: cartToken }, include: cartInclude })
  // A token from another store must not leak that store's basket.
  if (!cart || cart.storeId !== storeId) return null
  return cart
}

/**
 * Returns the buyer's cart for this store, creating one when needed.
 * Only callable where cookies are writable (route handler / server action).
 */
export async function getOrCreateCart(storeId: string): Promise<CartWithItems> {
  const existing = await findCart(storeId)
  if (existing && existing.status !== CartStatus.CONVERTED) return existing

  const token = crypto.randomBytes(24).toString("base64url")
  const cart = await prisma.cart.create({
    data: { storeId, token },
    include: cartInclude,
  })
  await writeCartToken(token)
  return cart
}

export type CartMutationError =
  | { code: "PRODUCT_NOT_FOUND"; message: string }
  | { code: "PRODUCT_UNAVAILABLE"; message: string }
  | { code: "OUT_OF_STOCK"; message: string; available: number }
  | { code: "INVALID_QUANTITY"; message: string }
  | { code: "PRICE_BELOW_MINIMUM"; message: string; minimum: number }

export type CartMutationResult =
  | { ok: true; cart: CartWithItems }
  | { ok: false; error: CartMutationError }

function reload(cartId: string) {
  return prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude })
}

export async function addItem(
  storeId: string,
  productId: string,
  quantity: number,
  offeredPrice?: number | null
): Promise<CartMutationResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
    return { ok: false, error: { code: "INVALID_QUANTITY", message: "Quantity must be between 1 and 99" } }
  }

  const product = await prisma.product.findFirst({ where: { id: productId, storeId } })
  if (!product) {
    return { ok: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } }
  }
  if (!product.isPublished) {
    return { ok: false, error: { code: "PRODUCT_UNAVAILABLE", message: "This product is not for sale" } }
  }

  const cart = await getOrCreateCart(storeId)
  const existing = cart.items.find((i) => i.productId === productId)
  const desired = Math.min(MAX_QUANTITY_PER_LINE, (existing?.quantity ?? 0) + quantity)

  // Digital goods have no stock; physical goods must not oversell.
  if (product.type === ProductType.PHYSICAL && product.stock !== null && desired > product.stock) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_STOCK",
        message: product.stock === 0 ? "This product is sold out" : `Only ${product.stock} left in stock`,
        available: product.stock,
      },
    }
  }

  const unitPrice = resolveUnitPrice(product, offeredPrice)
  if (product.isPayWhatYouWant && offeredPrice !== null && offeredPrice !== undefined) {
    const floor = product.minPrice ?? product.price
    if (offeredPrice < floor) {
      return {
        ok: false,
        error: { code: "PRICE_BELOW_MINIMUM", message: `Minimum price is ${floor.toFixed(2)}`, minimum: floor },
      }
    }
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    create: { cartId: cart.id, productId, quantity: desired, unitPrice },
    update: { quantity: desired, unitPrice },
  })
  // Touch the cart so the abandonment sweep measures real inactivity.
  await prisma.cart.update({
    where: { id: cart.id },
    data: { updatedAt: new Date(), status: CartStatus.ACTIVE, reminderSentAt: null },
  })

  return { ok: true, cart: await reload(cart.id) }
}

export async function setItemQuantity(
  storeId: string,
  productId: string,
  quantity: number
): Promise<CartMutationResult> {
  const cart = await findCart(storeId)
  if (!cart) return { ok: false, error: { code: "PRODUCT_NOT_FOUND", message: "Cart not found" } }

  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } })
    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } })
    return { ok: true, cart: await reload(cart.id) }
  }
  if (!Number.isInteger(quantity) || quantity > MAX_QUANTITY_PER_LINE) {
    return { ok: false, error: { code: "INVALID_QUANTITY", message: "Quantity must be between 1 and 99" } }
  }

  const item = cart.items.find((i) => i.productId === productId)
  if (!item) return { ok: false, error: { code: "PRODUCT_NOT_FOUND", message: "Item not in cart" } }

  if (item.product.type === ProductType.PHYSICAL && item.product.stock !== null && quantity > item.product.stock) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_STOCK",
        message: `Only ${item.product.stock} left in stock`,
        available: item.product.stock,
      },
    }
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } })
  await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } })
  return { ok: true, cart: await reload(cart.id) }
}

export async function removeItem(storeId: string, productId: string): Promise<CartMutationResult> {
  return setItemQuantity(storeId, productId, 0)
}

/** Returns null when this browser has no cart for the store yet. */
export async function clearCart(storeId: string): Promise<CartWithItems | null> {
  const cart = await findCart(storeId)
  if (!cart) return null
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } })
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: null, updatedAt: new Date() } })
  return reload(cart.id)
}

export type CouponApplication =
  | { ok: true; cart: CartWithItems; quote: Quote }
  | { ok: false; message: string }

export async function applyCoupon(storeId: string, code: string): Promise<CouponApplication> {
  const cart = await findCart(storeId)
  if (!cart) return { ok: false, message: "Your cart is empty" }

  const coupon = await prisma.coupon.findUnique({
    where: { storeId_code: { storeId, code: code.trim().toUpperCase() } },
  })

  const quote = await quoteCart(storeId, { ...cart, coupon: coupon ?? null })
  if (!coupon || quote.couponError) {
    return { ok: false, message: quote.couponError?.message ?? "Coupon code not found" }
  }

  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } })
  return { ok: true, cart: await reload(cart.id), quote }
}

export async function removeCoupon(storeId: string): Promise<CartWithItems | null> {
  const cart = await findCart(storeId)
  if (!cart) return null
  await prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } })
  return reload(cart.id)
}

/** Prices a cart with the owning store's settings. Always server-computed. */
export async function quoteCart(storeId: string, cart: CartWithItems): Promise<Quote> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { settings: true },
  })
  const engine = new PricingEngine(parseStoreSettings(store.settings))
  return engine.quote(
    cart.items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      type: i.product.type,
    })),
    cart.coupon
  )
}

/** Compact shape sent to the browser — never includes prices the client can edit. */
export function serializeCart(cart: CartWithItems, quote: Quote) {
  return {
    id: cart.id,
    itemCount: cart.items.reduce((n, i) => n + i.quantity, 0),
    coupon: quote.appliedCoupon,
    couponError: quote.couponError,
    items: cart.items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      slug: i.product.slug,
      thumbnail: i.product.thumbnail,
      type: i.product.type,
      stock: i.product.stock,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: Math.round(i.unitPrice * i.quantity * 100) / 100,
    })),
    totals: {
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      taxTotal: quote.taxTotal,
      shippingTotal: quote.shippingTotal,
      total: quote.total,
    },
    requiresShipping: quote.requiresShipping,
  }
}

export type SerializedCart = ReturnType<typeof serializeCart>
