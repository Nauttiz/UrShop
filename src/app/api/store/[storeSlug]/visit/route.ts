import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isBotUserAgent, isPrefetchRequest } from "@/lib/analytics/bots"
import { recordVisit } from "@/lib/analytics/visit"
import { visitBeaconSchema } from "@/lib/validations"

type Ctx = { params: Promise<{ storeSlug: string }> }

/** Nothing this endpoint can say is useful to a buyer's browser. */
const NO_CONTENT = new NextResponse(null, { status: 204 })

/**
 * Storefront visit beacon.
 *
 * Always answers 204, whatever happens — including on validation failure and on
 * an unhandled throw. Analytics is the least important thing on the page and
 * must never produce a console error for a buyer or a retry storm.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    if (isPrefetchRequest(req.headers)) return NO_CONTENT
    if (isBotUserAgent(req.headers.get("user-agent"))) return NO_CONTENT

    const parsed = visitBeaconSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NO_CONTENT

    const { storeSlug } = await params

    await recordVisit({
      storeSlug,
      path: parsed.data.path,
      referrer: parsed.data.referrer ?? null,
      selfHosts: selfHosts(req),
      // Resolved lazily: the session lookup only happens once per session, on
      // the branch that is about to write, not on every beacon.
      isOwner: async (storeUserId) => {
        const session = await auth().catch(() => null)
        return session?.user?.id === storeUserId
      },
    })

    return NO_CONTENT
  } catch {
    return NO_CONTENT
  }
}

/** Hosts a referrer may carry that still mean "came from this storefront". */
function selfHosts(req: Request): string[] {
  const hosts = [
    req.headers.get("x-forwarded-host"),
    req.headers.get("host"),
    hostOf(process.env.APP_URL),
    hostOf(process.env.NEXT_PUBLIC_APP_URL),
  ]
  return hosts.filter((h): h is string => typeof h === "string" && h.length > 0).map(stripPort)
}

function stripPort(host: string): string {
  return host.split(":")[0]
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
