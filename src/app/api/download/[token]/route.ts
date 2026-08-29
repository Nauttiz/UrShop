import { NextResponse } from "next/server"
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
 *
 * The bytes are proxied rather than redirected to, even on Blob storage, so the
 * download limit stays enforceable; handing out the underlying URL would let it
 * be shared and re-fetched without ever passing through this check again.
 */
export async function GET(req: Request, { params }: Ctx) {
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

  // Products can also point at an external URL the seller hosts themselves.
  if (!isPrivateKey(download.fileUrl)) {
    return NextResponse.redirect(new URL(download.fileUrl, req.url))
  }

  const file = await openPrivateFile(download.fileUrl)
  if (!file) {
    return NextResponse.json({ error: "The file is no longer available" }, { status: 404 })
  }

  const safeName = download.fileName.replace(/[\r\n"\\]/g, "_")
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }
  // Blob storage cannot always report a length up front. Omitting the header is
  // correct; sending "null" would break the client's progress indicator.
  if (file.size !== null) headers["Content-Length"] = String(file.size)

  return new NextResponse(file.stream, { headers })
}
