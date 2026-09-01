import crypto from "crypto"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { parseStoreSettings } from "@/lib/store-settings"
import { dayKeyInTimeZone, dayKeyToDate } from "./dates"
import { normaliseSource } from "./source"
import { writeAttribution } from "./attribution"

/**
 * Records one storefront session.
 *
 * The grain is a session, not a pageview. The beacon fires on every navigation,
 * but while `sf_sid` is valid this returns immediately without touching the
 * database — so a twelve-page visit costs one INSERT and eleven cookie
 * refreshes, not twelve INSERTs.
 */

const SESSION_COOKIE = "sf_sid"
const VISITOR_COOKIE = "sf_vid"
const SESSION_MAX_AGE = 30 * 60 // rolling 30-minute window
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365

export type RecordVisitInput = {
  storeSlug: string
  path: string
  referrer: string | null
  /** Hosts that count as the storefront itself, for self-referral detection. */
  selfHosts: string[]
  /** Skips the insert when the store's own owner is browsing their shop. */
  isOwner: (storeUserId: string) => boolean | Promise<boolean>
}

export type RecordVisitResult =
  | { recorded: true }
  | { recorded: false; reason: "session_active" | "store_not_found" | "owner" }

function token(): string {
  return crypto.randomBytes(16).toString("hex")
}

export async function recordVisit(input: RecordVisitInput): Promise<RecordVisitResult> {
  const jar = await cookies()

  const existingSession = jar.get(SESSION_COOKIE)?.value
  const visitorId = jar.get(VISITOR_COOKIE)?.value ?? token()

  // Hot path: an active session needs no work beyond extending the window.
  if (existingSession && /^[a-f0-9]{32}$/.test(existingSession)) {
    setSessionCookies(jar, existingSession, visitorId)
    return { recorded: false, reason: "session_active" }
  }

  const store = await prisma.store.findUnique({
    where: { slug: input.storeSlug },
    select: { id: true, userId: true, customDomain: true, settings: true },
  })
  if (!store) return { recorded: false, reason: "store_not_found" }

  if (await input.isOwner(store.userId)) {
    // Still set the session cookie, so the owner's own browsing does not
    // re-query the store on every page they open.
    setSessionCookies(jar, token(), visitorId)
    return { recorded: false, reason: "owner" }
  }

  const settings = parseStoreSettings(store.settings)
  const resolved = normaliseSource({
    referrer: input.referrer,
    landingUrl: input.path,
    selfHosts: [...input.selfHosts, store.customDomain ?? ""].filter(Boolean),
  })

  const sessionId = token()
  const day = dayKeyToDate(dayKeyInTimeZone(new Date(), settings.timezone))

  // createMany maps to INSERT IGNORE on MySQL, so the unique (storeId,
  // sessionId) guard silently absorbs a retried beacon, React StrictMode's
  // double effect in development, and two tabs opening at once.
  await prisma.visit.createMany({
    data: [
      {
        storeId: store.id,
        sessionId,
        visitorId,
        day,
        source: resolved.source,
        medium: resolved.medium,
        campaign: resolved.campaign,
        referrerHost: resolved.referrerHost?.slice(0, 190) ?? null,
        landingPath: input.path.slice(0, 255),
      },
    ],
    skipDuplicates: true,
  })

  await writeAttribution({
    storeId: store.id,
    source: resolved.source,
    medium: resolved.medium,
    campaign: resolved.campaign,
    sessionId,
    selfReferral: resolved.selfReferral,
  })

  setSessionCookies(jar, sessionId, visitorId)
  return { recorded: true }
}

type CookieJar = Awaited<ReturnType<typeof cookies>>

function setSessionCookies(jar: CookieJar, sessionId: string, visitorId: string): void {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  }
  jar.set(SESSION_COOKIE, sessionId, { ...base, maxAge: SESSION_MAX_AGE })
  jar.set(VISITOR_COOKIE, visitorId, { ...base, maxAge: VISITOR_MAX_AGE })
}
