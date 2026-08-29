import crypto from "crypto"
import { ProductType } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { parseStoreSettings } from "@/lib/store-settings"

export type DownloadDenial =
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "ORDER_UNPAID"; message: string }
  | { ok: false; reason: "EXPIRED"; message: string }
  | { ok: false; reason: "LIMIT_REACHED"; message: string }

/**
 * Materialises download grants for every digital line on a paid order.
 *
 * Idempotent: replaying a webhook re-enters here and finds the grants already
 * present, so a buyer never ends up with duplicate links or a reset counter.
 */
export async function issueDownloadsForOrder(orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      store: { select: { settings: true } },
      items: {
        include: {
          product: {
            include: { files: { orderBy: { sortOrder: "asc" } } },
          },
          downloads: { select: { id: true } },
        },
      },
    },
  })
  if (!order) return 0

  const settings = parseStoreSettings(order.store.settings)
  let created = 0

  for (const item of order.items) {
    // Already granted — replayed webhook, nothing to do.
    if (item.downloads.length > 0) continue
    if (item.product.type === ProductType.PHYSICAL) continue

    const limit = item.product.downloadLimit ?? settings.downloadLimit
    const expiryHours = item.product.downloadExpiryHours ?? settings.downloadExpiryHours
    const expiresAt = expiryHours === null ? null : new Date(Date.now() + expiryHours * 3600_000)

    const sources = item.product.files.length
      ? item.product.files.map((f) => ({ id: f.id as string | null, url: f.url, name: f.name }))
      : item.product.fileUrl
        ? [{ id: null, url: item.product.fileUrl, name: item.product.name }]
        : []

    for (const source of sources) {
      await prisma.download.create({
        data: {
          orderItemId: item.id,
          productFileId: source.id,
          fileUrl: source.url,
          fileName: source.name,
          token: crypto.randomBytes(24).toString("base64url"),
          maxDownloads: limit,
          expiresAt,
        },
      })
      created++
    }
  }

  return created
}

/** Checks a download token without consuming a use. */
export async function inspectDownload(token: string) {
  const download = await prisma.download.findUnique({
    where: { token },
    include: {
      orderItem: {
        include: {
          order: { select: { id: true, status: true, orderNumber: true, storeId: true } },
        },
      },
    },
  })
  if (!download) return null
  return download
}

type InspectedDownload = NonNullable<Awaited<ReturnType<typeof inspectDownload>>>

export function checkDownloadAccess(
  download: InspectedDownload,
  now = new Date()
): { ok: true } | DownloadDenial {
  const status = download.orderItem.order.status
  if (status !== "PAID" && status !== "FULFILLED") {
    return { ok: false, reason: "ORDER_UNPAID", message: "This order has not been paid for" }
  }
  if (download.expiresAt && download.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "EXPIRED", message: "This download link has expired" }
  }
  if (download.maxDownloads !== null && download.downloadCount >= download.maxDownloads) {
    return { ok: false, reason: "LIMIT_REACHED", message: "This link has reached its download limit" }
  }
  return { ok: true }
}

/**
 * Atomically claims one use of a download.
 *
 * The limit is enforced inside the UPDATE's WHERE clause, so two concurrent
 * requests on the last remaining use cannot both succeed — the second one
 * updates zero rows and is rejected.
 */
export async function consumeDownload(
  downloadId: string,
  maxDownloads: number | null
): Promise<boolean> {
  const affected = await prisma.download.updateMany({
    where: {
      id: downloadId,
      ...(maxDownloads !== null ? { downloadCount: { lt: maxDownloads } } : {}),
    },
    data: {
      downloadCount: { increment: 1 },
      lastDownloadAt: new Date(),
    },
  })
  return affected.count > 0
}
