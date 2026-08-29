import { createReadStream } from "fs"
import { mkdir, stat, unlink, writeFile } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { del as blobDel, get as blobGet, put as blobPut } from "@vercel/blob"

/**
 * File storage behind a driver interface.
 *
 * Two categories with different rules:
 *
 * - **Private** files are paid digital goods. They must never be reachable by
 *   URL alone — only through a tokenised download tied to a paid order. On disk
 *   they live outside `public/`; on Vercel they are `access: "private"` blobs
 *   streamed back through our own route so the download budget still applies.
 * - **Public** files are storefront images (logos, thumbnails). Their URL goes
 *   straight into an `<img src>`, so the driver returns a servable URL.
 */

export type StoredFile = {
  /** Opaque key persisted in the DB: `private:<name>` or `blob:<pathname>`. */
  key: string
  name: string
  sizeBytes: number
  mimeType: string | null
}

export type OpenedFile = {
  stream: ReadableStream<Uint8Array>
  /** null when the driver cannot report a length up front. */
  size: number | null
}

interface StorageDriver {
  readonly id: string
  savePrivate(file: File): Promise<StoredFile>
  openPrivate(key: string): Promise<OpenedFile | null>
  deletePrivate(key: string): Promise<void>
  /** Returns a directly servable URL for an image. */
  savePublic(file: File): Promise<{ url: string }>
}

const PRIVATE_PREFIX = "private:"
const BLOB_PREFIX = "blob:"

export function isPrivateKey(key: string): boolean {
  return key.startsWith(PRIVATE_PREFIX) || key.startsWith(BLOB_PREFIX)
}

/** Random, extension-preserving name. Never trust the client's filename on disk. */
function storedName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12)
  return `${crypto.randomBytes(20).toString("hex")}${ext}`
}

// ─── Local disk (development) ────────────────────────────────────────────────

const PRIVATE_ROOT = process.env.PRIVATE_UPLOAD_DIR
  ? path.resolve(process.env.PRIVATE_UPLOAD_DIR)
  : path.join(process.cwd(), "storage", "products")

const PUBLIC_ROOT = path.join(process.cwd(), "public", "uploads")

/**
 * Resolves a storage key to a path inside PRIVATE_ROOT, rejecting anything that
 * escapes the directory (`../`, absolute paths, embedded separators).
 */
export function resolvePrivatePath(key: string): string | null {
  if (!key.startsWith(PRIVATE_PREFIX)) return null
  const name = key.slice(PRIVATE_PREFIX.length)
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null
  const full = path.join(PRIVATE_ROOT, name)
  const rel = path.relative(PRIVATE_ROOT, full)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return full
}

function nodeStreamToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)))
      stream.on("end", () => controller.close())
      stream.on("error", (error) => controller.error(error))
    },
    cancel() {
      ;(stream as { destroy?: () => void }).destroy?.()
    },
  })
}

class LocalDiskStorage implements StorageDriver {
  readonly id = "local"

  async savePrivate(file: File): Promise<StoredFile> {
    await mkdir(PRIVATE_ROOT, { recursive: true })
    const name = storedName(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(PRIVATE_ROOT, name), buffer)

    return {
      key: `${PRIVATE_PREFIX}${name}`,
      name: file.name,
      sizeBytes: buffer.byteLength,
      mimeType: file.type || null,
    }
  }

  async openPrivate(key: string): Promise<OpenedFile | null> {
    const full = resolvePrivatePath(key)
    if (!full) return null
    try {
      // Both paths are computed at runtime from a validated key. Without these
      // markers the bundler gives up on static analysis and traces the entire
      // project — public/ included — into the serverless bundle.
      const info = await stat(/*turbopackIgnore: true*/ full)
      if (!info.isFile()) return null
      const stream = createReadStream(/*turbopackIgnore: true*/ full)
      return { stream: nodeStreamToWeb(stream), size: info.size }
    } catch {
      return null
    }
  }

  async deletePrivate(key: string): Promise<void> {
    const full = resolvePrivatePath(key)
    if (!full) return
    await unlink(full).catch(() => {})
  }

  async savePublic(file: File): Promise<{ url: string }> {
    await mkdir(PUBLIC_ROOT, { recursive: true })
    const name = storedName(file.name)
    await writeFile(path.join(PUBLIC_ROOT, name), Buffer.from(await file.arrayBuffer()))
    return { url: `/uploads/${name}` }
  }
}

// ─── Vercel Blob (production) ────────────────────────────────────────────────

class VercelBlobStorage implements StorageDriver {
  readonly id = "vercel-blob"

  async savePrivate(file: File): Promise<StoredFile> {
    const result = await blobPut(`products/${storedName(file.name)}`, file, {
      access: "private",
      contentType: file.type || "application/octet-stream",
    })
    return {
      key: `${BLOB_PREFIX}${result.pathname}`,
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || null,
    }
  }

  async openPrivate(key: string): Promise<OpenedFile | null> {
    if (!key.startsWith(BLOB_PREFIX)) return null
    const result = await blobGet(key.slice(BLOB_PREFIX.length), { access: "private" })
    if (!result || result.statusCode !== 200) return null

    const length = result.headers.get("content-length")
    return { stream: result.stream, size: length ? Number(length) : null }
  }

  async deletePrivate(key: string): Promise<void> {
    if (!key.startsWith(BLOB_PREFIX)) return
    await blobDel(key.slice(BLOB_PREFIX.length)).catch(() => {})
  }

  async savePublic(file: File): Promise<{ url: string }> {
    const result = await blobPut(`images/${storedName(file.name)}`, file, {
      access: "public",
      contentType: file.type || "application/octet-stream",
    })
    return { url: result.url }
  }
}

// ─── Driver selection ────────────────────────────────────────────────────────

const local = new LocalDiskStorage()
const blob = new VercelBlobStorage()

/**
 * Vercel injects BLOB_READ_WRITE_TOKEN when a Blob store is attached, so the
 * driver follows the environment with no extra configuration.
 */
export function getStorage(): StorageDriver {
  return process.env.BLOB_READ_WRITE_TOKEN ? blob : local
}

/**
 * Opens a stored private file, dispatching on the key's own prefix rather than
 * the active driver — files uploaded to disk before a Blob store existed must
 * keep working after the switch.
 */
export async function openPrivateFile(key: string): Promise<OpenedFile | null> {
  if (key.startsWith(BLOB_PREFIX)) return blob.openPrivate(key)
  if (key.startsWith(PRIVATE_PREFIX)) return local.openPrivate(key)
  return null
}

export function savePrivateFile(file: File): Promise<StoredFile> {
  return getStorage().savePrivate(file)
}

export function savePublicFile(file: File): Promise<{ url: string }> {
  return getStorage().savePublic(file)
}

export function deletePrivateFile(key: string): Promise<void> {
  if (key.startsWith(BLOB_PREFIX)) return blob.deletePrivate(key)
  if (key.startsWith(PRIVATE_PREFIX)) return local.deletePrivate(key)
  return Promise.resolve()
}
