import { createReadStream } from "fs"
import { mkdir, stat, writeFile } from "fs/promises"
import path from "path"
import crypto from "crypto"

/**
 * Where paid digital goods live.
 *
 * Deliberately OUTSIDE `public/`: anything under `public/` is served by the
 * static handler, so a product file placed there could be downloaded by anyone
 * who guesses the URL, with no order and no payment. Files here are reachable
 * only through a signed download token.
 */
const PRIVATE_ROOT = process.env.PRIVATE_UPLOAD_DIR
  ? path.resolve(process.env.PRIVATE_UPLOAD_DIR)
  : path.join(process.cwd(), "storage", "products")

export type StoredFile = {
  /** Opaque key stored in the DB, e.g. `private:abc123.zip`. */
  key: string
  name: string
  sizeBytes: number
  mimeType: string | null
}

export function isPrivateKey(key: string): boolean {
  return key.startsWith("private:")
}

/**
 * Resolves a storage key to a path inside PRIVATE_ROOT, rejecting anything that
 * escapes the directory (`../`, absolute paths, embedded separators).
 */
export function resolvePrivatePath(key: string): string | null {
  if (!isPrivateKey(key)) return null
  const name = key.slice("private:".length)
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null
  const full = path.join(PRIVATE_ROOT, name)
  const rel = path.relative(PRIVATE_ROOT, full)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return full
}

export async function savePrivateFile(file: File): Promise<StoredFile> {
  await mkdir(PRIVATE_ROOT, { recursive: true })

  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12)
  const storedName = `${crypto.randomBytes(20).toString("hex")}${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(PRIVATE_ROOT, storedName), buffer)

  return {
    key: `private:${storedName}`,
    name: file.name,
    sizeBytes: buffer.byteLength,
    mimeType: file.type || null,
  }
}

export async function openPrivateFile(key: string) {
  const full = resolvePrivatePath(key)
  if (!full) return null
  try {
    const info = await stat(full)
    if (!info.isFile()) return null
    return { stream: createReadStream(full), size: info.size }
  } catch {
    return null
  }
}
