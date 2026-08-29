import { NextResponse } from "next/server"
import type { ReadStream } from "fs"
import { checkDownloadAccess, consumeDownload, inspectDownload } from "@/lib/domain/delivery"
import { isPrivateKey, openPrivateFile } from "@/lib/storage"

type Ctx = { params: Promise<{ token: string }> }

/**
 * Serves a purchased file.
 *
 * Access is decided entirely by the token: the order must be paid, the link
 * unexpired, and the download budget unspent. The counter is claimed before a
 * single byte is streamed so a cancelled transfer still costs a use — the
 * alternative lets a buyer replay the request indefinitely.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params

  const download = await inspectDownload(token)
  if (!download) {
    return NextResponse.json({ error: "This download link is not valid" }, { status: 404 })
  }

  const access = checkDownloadAccess(download)
  if (!access.ok) {
    // 410 Gone for spent or expired links; 402 when the order was never paid.
    const status = access.reason === "ORDER_UNPAID" ? 402 : 410
    return NextResponse.json({ error: access.message, reason: access.reason }, { status })
  }

  const claimed = await consumeDownload(download.id, download.maxDownloads)
  if (!claimed) {
    return NextResponse.json(
      { error: "This link has reached its download limit", reason: "LIMIT_REACHED" },
      { status: 410 }
    )
  }

  // Files uploaded before private storage existed still live under public/.
  if (!isPrivateKey(download.fileUrl)) {
    return NextResponse.redirect(new URL(download.fileUrl, _req.url))
  }

  const file = await openPrivateFile(download.fileUrl)
  if (!file) {
    return NextResponse.json({ error: "The file is no longer available" }, { status: 404 })
  }

  const safeName = download.fileName.replace(/["\\\r\n]/g, "_")

  return new NextResponse(nodeStreamToWeb(file.stream), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function nodeStreamToWeb(stream: ReadStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)))
      stream.on("end", () => controller.close())
      stream.on("error", (error) => controller.error(error))
    },
    cancel() {
      stream.destroy()
    },
  })
}
