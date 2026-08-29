import { JobStatus, type Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type JobType =
  | "send_receipt"
  | "send_delivery"
  | "notify_seller"
  | "send_refund_email"
  | "scan_abandoned_carts"
  | "send_abandoned_cart"

export type EnqueueOptions = {
  /** Delay before the job becomes eligible to run. */
  delayMs?: number
  maxAttempts?: number
}

/** Schedules background work. Callers should never await the side effect itself. */
export async function enqueue(
  type: JobType,
  payload: Prisma.InputJsonValue,
  options: EnqueueOptions = {}
) {
  return prisma.job.create({
    data: {
      type,
      payload,
      runAt: new Date(Date.now() + (options.delayMs ?? 0)),
      maxAttempts: options.maxAttempts ?? 3,
    },
  })
}

/**
 * Claims one due job for this worker.
 *
 * The claim is a conditional UPDATE on `status: PENDING`, so if several workers
 * race for the same row exactly one sees `count === 1` and the losers move on.
 */
async function claimNext() {
  const candidate = await prisma.job.findFirst({
    where: { status: JobStatus.PENDING, runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    select: { id: true },
  })
  if (!candidate) return null

  const claim = await prisma.job.updateMany({
    where: { id: candidate.id, status: JobStatus.PENDING },
    data: { status: JobStatus.PROCESSING, lockedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claim.count === 0) return null

  return prisma.job.findUnique({ where: { id: candidate.id } })
}

export type JobHandler = (payload: any) => Promise<void>

export type ProcessResult = {
  processed: number
  succeeded: number
  failed: number
  errors: { jobId: string; type: string; error: string }[]
}

/** Exponential backoff: 1min, 4min, 9min … capped at an hour. */
function backoffMs(attempts: number): number {
  return Math.min(3600_000, attempts * attempts * 60_000)
}

/**
 * Drains up to `limit` due jobs. Failures are retried with backoff until
 * `maxAttempts`, after which the job is parked as FAILED with its last error.
 */
export async function processJobs(
  handlers: Record<string, JobHandler>,
  limit = 25
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0, errors: [] }

  for (let i = 0; i < limit; i++) {
    const job = await claimNext()
    if (!job) break
    result.processed++

    const handler = handlers[job.type]
    if (!handler) {
      result.failed++
      result.errors.push({ jobId: job.id, type: job.type, error: "No handler registered" })
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, lastError: `No handler registered for "${job.type}"` },
      })
      continue
    }

    try {
      await handler(job.payload)
      await prisma.job.update({
        where: { id: job.id },
        data: { status: JobStatus.DONE, lastError: null, lockedAt: null },
      })
      result.succeeded++
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job error"
      const exhausted = job.attempts >= job.maxAttempts
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
          runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
          lastError: message,
          lockedAt: null,
        },
      })
      result.failed++
      result.errors.push({ jobId: job.id, type: job.type, error: message })
    }
  }

  return result
}

/**
 * Releases jobs whose worker died mid-run so they are picked up again instead
 * of sitting in PROCESSING forever.
 */
export async function requeueStalledJobs(olderThanMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs)
  const { count } = await prisma.job.updateMany({
    where: { status: JobStatus.PROCESSING, lockedAt: { lt: cutoff } },
    data: { status: JobStatus.PENDING, lockedAt: null },
  })
  return count
}
