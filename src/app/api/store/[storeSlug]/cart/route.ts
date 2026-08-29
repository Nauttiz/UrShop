import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  addItem,
  clearCart,
  findCart,
  quoteCart,
  serializeCart,
  setItemQuantity,
  writeCartToken,
} from "@/lib/domain/cart"
import { addToCartSchema, updateCartItemSchema } from "@/lib/validations"

type Ctx = { params: Promise<{ storeSlug: string }> }

async function resolveStore(storeSlug: string) {
  return prisma.store.findUnique({ where: { slug: storeSlug }, select: { id: true } })
}

const emptyCart = {
  id: null,
  itemCount: 0,
  coupon: null,
  couponError: null,
  items: [],
  totals: { subtotal: 0, discountTotal: 0, taxTotal: 0, shippingTotal: 0, total: 0 },
  requiresShipping: false,
}

export async function GET(_req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await resolveStore(storeSlug)
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const cart = await findCart(store.id)
  if (!cart) return NextResponse.json(emptyCart)

  const quote = await quoteCart(store.id, cart)
  return NextResponse.json(serializeCart(cart, quote))
}

export async function POST(req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await resolveStore(storeSlug)
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const parsed = addToCartSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const result = await addItem(
    store.id,
    parsed.data.productId,
    parsed.data.quantity,
    parsed.data.offeredPrice ?? null
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: 400 })
  }

  const quote = await quoteCart(store.id, result.cart)
  return NextResponse.json(serializeCart(result.cart, quote), { status: 201 })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await resolveStore(storeSlug)
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const parsed = updateCartItemSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const result = await setItemQuantity(store.id, parsed.data.productId, parsed.data.quantity)
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: 400 })
  }

  const quote = await quoteCart(store.id, result.cart)
  return NextResponse.json(serializeCart(result.cart, quote))
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await resolveStore(storeSlug)
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const cart = await clearCart(store.id)
  if (!cart) return NextResponse.json(emptyCart)

  const quote = await quoteCart(store.id, cart)
  return NextResponse.json(serializeCart(cart, quote))
}

/**
 * Recovers a cart from an abandoned-cart email by re-issuing the cookie.
 * Kept on PUT so the link in the email can be a plain page that calls it.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await resolveStore(storeSlug)
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { token?: string } | null
  if (!body?.token) return NextResponse.json({ error: "Missing token" }, { status: 400 })

  const cart = await findCart(store.id, body.token)
  if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 })

  // Adopt the recovered cart as this browser's cart.
  await writeCartToken(cart.token)

  const quote = await quoteCart(store.id, cart)
  return NextResponse.json(serializeCart(cart, quote))
}
