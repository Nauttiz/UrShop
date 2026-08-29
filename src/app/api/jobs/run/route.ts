import { NextResponse } from "next/server"
import crypto from "crypto"
import { jobHandlers } from "@/lib/jobs/handlers"
import { enqueue, processJobs, requeueStalledJobs } from "@/lib/jobs/queue"

/**
 * Worker tick. Point a cron at it (Vercel Cron, GitHub Actions, or a plain
 * `curl` on a timer) to drain queued emails and sweep abandoned carts.
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/run
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  // Without a secret, allow local runs only — an open worker endpoint in
  // production lets anyone drain the queue or force reminder emails.
  if (secret) {
    if (!authorised(req, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET must be set to run jobs in production" },
      { status: 503 }
    )
  }

  const requeued = await requeueStalledJobs()

  const url = new URL(req.url)
  if (url.searchParams.get("scan") !== "0") {
    await enqueue("scan_abandoned_carts", {})
  }

  const result = await processJobs(jobHandlers, Number(url.searchParams.get("limit") ?? 25))

  return NextResponse.json({ requeued, ...result })
}

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? ""
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
