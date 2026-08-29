import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { applyCoupon, findCart, quoteCart, removeCoupon, serializeCart } from "@/lib/domain/cart"
import { couponCodeSchema } from "@/lib/validations"

type Ctx = { params: Promise<{ storeSlug: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await prisma.store.findUnique({ where: { slug: storeSlug }, select: { id: true } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const parsed = couponCodeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Enter a coupon code" }, { status: 400 })

  const result = await applyCoupon(store.id, parsed.data.code)
  // A wrong code is expected user input, not a server fault — 422 keeps it out
  // of error monitoring while still failing the request.
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 422 })

  return NextResponse.json(serializeCart(result.cart, result.quote))
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { storeSlug } = await params
  const store = await prisma.store.findUnique({ where: { slug: storeSlug }, select: { id: true } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const cart = (await removeCoupon(store.id)) ?? (await findCart(store.id))
  if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 })

  const quote = await quoteCart(store.id, cart)
  return NextResponse.json(serializeCart(cart, quote))
}
