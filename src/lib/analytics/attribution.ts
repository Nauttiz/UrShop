import { cookies } from "next/headers"
import { sanitiseKey, type Medium } from "./source"

/**
 * Traffic attribution carried in the buyer's browser between the visit that
 * earned the sale and the checkout that completes it.
 *
 * The model is **last non-direct touch**: a returning visitor who types the URL
 * directly keeps the credit of whatever brought them the first time, while a
 * fresh click from a new channel takes it over. Pure last-touch would credit
 * "direct" for every bookmark and make every marketing channel look dead;
 * first-touch would keep crediting whatever discovered them months ago.
 */

export const ATTR_COOKIE = "sf_attr"
const ATTR_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export type OrderAttribution = {
  source: string
  medium: Medium
  campaign: string | null
  sessionId: string | null
}

type StoredAttribution = {
  v: 1
  /** Store id. Guards against crediting store A's referrer to store B. */
  sid: string
  s: string
  m: string
  c: string | null
  t: number
  vs: string | null
}

const MEDIUMS: Medium[] = ["none", "organic", "referral", "social", "cpc", "email"]

/**
 * Re-validates on read rather than signing on write.
 *
 * The cookie is httpOnly, so forging it needs the attacker's own browser and
 * only pollutes their own attribution. The real risk is the value landing in a
 * GROUP BY key and on the seller's screen, which sanitising is what fixes.
 */
function parse(raw: string | undefined, storeId: string): OrderAttribution | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<StoredAttribution>
    if (data.v !== 1 || typeof data.sid !== "string") return null
    // A cookie set while browsing another store must not leak across.
    if (data.sid !== storeId) return null

    const source = sanitiseKey(typeof data.s === "string" ? data.s : null)
    if (!source) return null

    const medium = MEDIUMS.includes(data.m as Medium) ? (data.m as Medium) : "referral"
    return {
      source,
      medium,
      campaign: sanitiseKey(typeof data.c === "string" ? data.c : null),
      sessionId: typeof data.vs === "string" ? data.vs.slice(0, 32) : null,
    }
  } catch {
    return null
  }
}

/** Reads the buyer's attribution. Safe to call anywhere cookies are readable. */
export async function readAttribution(storeId: string): Promise<OrderAttribution | null> {
  const store = await cookies()
  return parse(store.get(ATTR_COOKIE)?.value, storeId)
}

export type AttributionWrite = {
  storeId: string
  source: string
  medium: Medium
  campaign: string | null
  sessionId: string
  /** A referrer pointing back at the storefront itself is internal navigation. */
  selfReferral: boolean
}

/**
 * Applies the last-non-direct-touch rule.
 *
 * Returns true when the cookie was written, so the caller can decide whether to
 * bother serialising it. Callable only where cookies are writable — a route
 * handler or server action.
 */
export async function writeAttribution(input: AttributionWrite): Promise<boolean> {
  const jar = await cookies()
  const existing = parse(jar.get(ATTR_COOKIE)?.value, input.storeId)

  const isRealSource = input.medium !== "none" && !input.selfReferral
  // A direct return visit must not overwrite the channel that earned the buyer.
  if (!isRealSource && existing) return false

  const payload: StoredAttribution = {
    v: 1,
    sid: input.storeId,
    s: input.source,
    m: input.medium,
    c: input.campaign,
    t: Math.floor(Date.now() / 1000),
    vs: input.sessionId,
  }

  jar.set(ATTR_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ATTR_MAX_AGE,
  })
  return true
}
