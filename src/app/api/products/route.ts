import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { productSchema } from "@/lib/validations"
import { uniqueSlug } from "@/lib/slug"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const store = await prisma.store.findUnique({ where: { userId: session.user.id } })
  if (!store) return NextResponse.json([])

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(products)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const store = await prisma.store.findUnique({ where: { userId: session.user.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const body = await req.json()
  const parsed = productSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const slug = await uniqueSlug(parsed.data.name, async (candidate) => {
    const clash = await prisma.product.findFirst({
      where: { storeId: store.id, slug: candidate },
      select: { id: true },
    })
    return clash !== null
  })

  const product = await prisma.product.create({
    data: { ...parsed.data, slug, storeId: store.id },
  })
  return NextResponse.json(product, { status: 201 })
}
