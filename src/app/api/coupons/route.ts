import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { couponSchema } from "@/lib/validations"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const store = await prisma.store.findUnique({ where: { userId: session.user.id } })
  if (!store) return NextResponse.json([])

  const coupons = await prisma.coupon.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(coupons)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const store = await prisma.store.findUnique({ where: { userId: session.user.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const body = await req.json()
  const parsed = couponSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.type === "PERCENT" && parsed.data.discount > 100) {
    return NextResponse.json({ error: "A percentage discount cannot exceed 100" }, { status: 400 })
  }

  const { expiresAt, ...rest } = parsed.data
  try {
    const coupon = await prisma.coupon.create({
      data: {
        ...rest,
        storeId: store.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    })
    return NextResponse.json(coupon, { status: 201 })
  } catch (error) {
    // Unique index on [storeId, code] — surface it as a conflict, not a 500.
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "You already have a coupon with that code" }, { status: 409 })
    }
    throw error
  }
}

/** Toggles a coupon on or off without deleting its usage history. */
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { id?: string; isActive?: boolean } | null
  if (!body?.id || typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "id and isActive are required" }, { status: 400 })
  }

  const { count } = await prisma.coupon.updateMany({
    where: { id: body.id, store: { userId: session.user.id } },
    data: { isActive: body.isActive },
  })
  if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ id: body.id, isActive: body.isActive })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  const coupon = await prisma.coupon.findFirst({
    where: { id, store: { userId: session.user.id } },
  })
  if (!coupon) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.coupon.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
