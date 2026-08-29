import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { savePublicFile } from "@/lib/storage"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

/**
 * Uploads a storefront image (store logo, product thumbnail).
 *
 * These are meant to be publicly readable — the returned URL goes straight into
 * an `<img src>` — which is why they use the public side of the storage driver
 * rather than the token-gated path that paid product files take.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG, PNG, WebP or GIF allowed" }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File must be under 5MB" }, { status: 413 })
  }

  const { url } = await savePublicFile(file)
  return NextResponse.json({ url })
}
