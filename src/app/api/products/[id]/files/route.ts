import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { savePrivateFile } from "@/lib/storage"

type Ctx = { params: Promise<{ id: string }> }

const MAX_SIZE_BYTES = 200 * 1024 * 1024 // 200MB

/** Confirms the signed-in seller owns the product before touching its files. */
async function ownedProduct(productId: string) {
  const session = await auth()
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const product = await prisma.product.findFirst({
    where: { id: productId, store: { userId: session.user.id } },
    select: { id: true },
  })
  if (!product) return { error: NextResponse.json({ error: "Product not found" }, { status: 404 }) }

  return { product }
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const owned = await ownedProduct(id)
  if (owned.error) return owned.error

  const files = await prisma.productFile.findMany({
    where: { productId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sizeBytes: true, mimeType: true, createdAt: true },
  })
  return NextResponse.json(files)
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params
  const owned = await ownedProduct(id)
  if (owned.error) return owned.error

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty" }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Files must be under 200MB" }, { status: 413 })
  }

  const stored = await savePrivateFile(file)
  const count = await prisma.productFile.count({ where: { productId: id } })

  const created = await prisma.productFile.create({
    data: {
      productId: id,
      name: stored.name,
      url: stored.key,
      sizeBytes: stored.sizeBytes,
      mimeType: stored.mimeType,
      sortOrder: count,
    },
    select: { id: true, name: true, sizeBytes: true, mimeType: true, createdAt: true },
  })

  return NextResponse.json(created, { status: 201 })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params
  const owned = await ownedProduct(id)
  if (owned.error) return owned.error

  const fileId = new URL(req.url).searchParams.get("fileId")
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 })

  // Scoped to the product so a valid fileId from another store is a no-op.
  const { count } = await prisma.productFile.deleteMany({ where: { id: fileId, productId: id } })
  if (count === 0) return NextResponse.json({ error: "File not found" }, { status: 404 })

  // The blob is intentionally left on disk: existing Download rows snapshot the
  // key and buyers who already paid keep working links.
  return NextResponse.json({ deleted: true })
}
