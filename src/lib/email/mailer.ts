import { EmailStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  /** Identifies the template for the EmailLog audit trail. */
  template: string
  storeId?: string | null
  replyTo?: string | null
}

export abstract class Mailer {
  abstract readonly id: string
  abstract isConfigured(): boolean
  protected abstract deliver(message: EmailMessage): Promise<void>

  /**
   * Sends and records the attempt. Never throws: a failed receipt must not roll
   * back a successful payment, so failures surface through EmailLog instead.
   */
  async send(message: EmailMessage): Promise<{ ok: boolean; error?: string }> {
    const log = await prisma.emailLog.create({
      data: {
        storeId: message.storeId ?? null,
        to: message.to,
        subject: message.subject,
        template: message.template,
        status: EmailStatus.QUEUED,
      },
    })

    try {
      await this.deliver(message)
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: EmailStatus.SENT, sentAt: new Date() },
      })
      return { ok: true }
    } catch (error) {
      const err = error instanceof Error ? error.message : "Unknown mailer error"
      await prisma.emailLog.update({
        where: { id: log.id },
        data: { status: EmailStatus.FAILED, error: err },
      })
      return { ok: false, error: err }
    }
  }
}

/** Development driver: prints to the server log so the flow stays observable. */
export class ConsoleMailer extends Mailer {
  readonly id = "console"
  isConfigured() {
    return true
  }
  protected async deliver(message: EmailMessage) {
    console.log(
      `\n──────── EMAIL (${message.template}) ────────\n` +
        `To:      ${message.to}\n` +
        `Subject: ${message.subject}\n\n` +
        `${message.text}\n` +
        `─────────────────────────────────────────\n`
    )
  }
}

/** Production driver backed by Resend's HTTP API — no SDK dependency. */
export class ResendMailer extends Mailer {
  readonly id = "resend"
  private readonly apiKey = process.env.RESEND_API_KEY ?? ""
  private readonly from = process.env.EMAIL_FROM ?? "onboarding@resend.dev"

  isConfigured() {
    return this.apiKey.length > 0
  }

  protected async deliver(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 300)}`)
    }
  }
}

let cached: Mailer | null = null

export function getMailer(): Mailer {
  if (cached) return cached
  const resend = new ResendMailer()
  cached = resend.isConfigured() ? resend : new ConsoleMailer()
  return cached
}
