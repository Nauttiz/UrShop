import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { productPatchSchema } from "@/lib/validations"
import { uniqueSlug } from "@/lib/slug"

type Params = { params: Promise<{ id: string }> }

async function getOwnedProduct(userId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, store: { userId } },
  })
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const product = await getOwnedProduct(session.user.id, id)
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(product)
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await getOwnedProduct(session.user.id, id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const parsed = productPatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Renaming refreshes the storefront URL, but only while nothing has linked to
  // the old one yet — an existing slug stays put so buyers' links keep working.
  const data = { ...parsed.data } as Record<string, unknown>
  if (parsed.data.name && !existing.slug) {
    data.slug = await uniqueSlug(parsed.data.name, async (candidate) => {
      const clash = await prisma.product.findFirst({
        where: { storeId: existing.storeId, slug: candidate, NOT: { id } },
        select: { id: true },
      })
      return clash !== null
    })
  }

  const product = await prisma.product.update({ where: { id }, data })
  return NextResponse.json(product)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await getOwnedProduct(session.user.id, id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.product.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
