/**
 * Turns a raw referrer and landing URL into a stable traffic-source key.
 *
 * Pure — no I/O, no DB, no request objects — so it can be exercised directly.
 */

export type Medium = "none" | "organic" | "referral" | "social" | "cpc" | "email"

export type NormalisedSource = {
  /** Lowercase grouping key: "direct" | "google" | "acme.com". */
  source: string
  medium: Medium
  campaign: string | null
  /** Raw host, kept only for debugging a mis-normalised source. */
  referrerHost: string | null
  /**
   * True when the referrer is the storefront itself. Such a visit is not a new
   * source and must not overwrite an existing attribution.
   */
  selfReferral: boolean
}

export const DIRECT = "direct"
export const MAX_KEY_LENGTH = 120

/**
 * Referrer values and UTM parameters are attacker-controlled and end up both in
 * a GROUP BY key and on the seller's screen, so everything is reduced to a
 * conservative character set before it is stored.
 */
export function sanitiseKey(value: string | null | undefined, maxLength = MAX_KEY_LENGTH): string | null {
  if (!value) return null
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\- ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxLength)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Collapses the subdomains that front the same site so `l.facebook.com`,
 * `m.facebook.com` and `www.facebook.com` group together.
 *
 * Deliberately not full public-suffix parsing: that needs a ~30 kB dataset to
 * tell `foo.co.uk` from `co.uk`, and the only cost of skipping it is that
 * unrelated subdomains of one site appear as separate rows.
 */
function stripHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^(www|m|l|lm|amp|mobile)\./, "")
}

const SEARCH_ENGINES: [RegExp, string][] = [
  [/^google\./, "google"],
  [/^news\.google\./, "google"],
  [/^bing\./, "bing"],
  [/^duckduckgo\./, "duckduckgo"],
  [/^search\.yahoo\./, "yahoo"],
  [/^yahoo\./, "yahoo"],
  [/^yandex\./, "yandex"],
  [/^baidu\./, "baidu"],
  [/^ecosia\./, "ecosia"],
  [/^search\.brave\./, "brave"],
  [/^coccoc\./, "coccoc"],
]

const SOCIAL: [RegExp, string][] = [
  [/^(.*\.)?facebook\.com$/, "facebook"],
  [/^fb\.(me|com)$/, "facebook"],
  [/^(.*\.)?instagram\.com$/, "instagram"],
  [/^t\.co$/, "twitter"],
  [/^(.*\.)?twitter\.com$/, "twitter"],
  [/^(.*\.)?x\.com$/, "twitter"],
  [/^(.*\.)?tiktok\.com$/, "tiktok"],
  [/^(.*\.)?pinterest\./, "pinterest"],
  [/^(.*\.)?reddit\.com$/, "reddit"],
  [/^(.*\.)?linkedin\.com$/, "linkedin"],
  [/^lnkd\.in$/, "linkedin"],
  [/^(.*\.)?youtube\.com$/, "youtube"],
  [/^youtu\.be$/, "youtube"],
  [/^(.*\.)?threads\.(net|com)$/, "threads"],
  [/^(.*\.)?discord\.(com|gg)$/, "discord"],
  [/^(.*\.)?vk\.com$/, "vk"],
  [/^(.*\.)?zalo\.me$/, "zalo"],
]

const WEBMAIL: RegExp[] = [/^mail\.google\./, /^outlook\./, /^mail\.yahoo\./, /^mail\.proton\./]

/** Paid-click parameters, for traffic whose referrer the ad network stripped. */
const CLICK_IDS: [string, string, Medium][] = [
  ["gclid", "google", "cpc"],
  ["gbraid", "google", "cpc"],
  ["wbraid", "google", "cpc"],
  ["msclkid", "bing", "cpc"],
  ["fbclid", "facebook", "social"],
  ["ttclid", "tiktok", "social"],
]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

export type NormaliseInput = {
  /** `document.referrer` as reported by the browser. */
  referrer: string | null | undefined
  /** The path and query the visitor landed on, e.g. "/store/acme?utm_source=ig". */
  landingUrl: string
  /** Hosts that count as the storefront itself: app host, custom domain. */
  selfHosts: string[]
}

/**
 * Resolves a visit to a source.
 *
 * The precedence ladder *is* the design: explicit tagging beats click ids,
 * which beat referrer inference, which beats "direct". A seller who tags a link
 * expects to see that label, whatever the browser reported.
 */
export function normaliseSource(input: NormaliseInput): NormalisedSource {
  const params = readParams(input.landingUrl)
  const referrerHost = input.referrer ? hostOf(input.referrer) : null
  const stripped = referrerHost ? stripHost(referrerHost) : null

  const selfHosts = new Set(input.selfHosts.filter(Boolean).map(stripHost))
  const selfReferral = stripped !== null && selfHosts.has(stripped)

  // 1. Explicit UTM tagging.
  const utmSource = sanitiseKey(params.get("utm_source"))
  if (utmSource) {
    return {
      source: utmSource,
      medium: normaliseMedium(params.get("utm_medium")) ?? "referral",
      campaign: sanitiseKey(params.get("utm_campaign")),
      referrerHost,
      selfReferral: false,
    }
  }

  // 2. Ad-network click ids.
  for (const [param, source, medium] of CLICK_IDS) {
    if (params.get(param)) {
      return { source, medium, campaign: sanitiseKey(params.get("utm_campaign")), referrerHost, selfReferral: false }
    }
  }

  // 3. Referrer inference.
  if (stripped) {
    // Self-referrals are internal navigation, not a source. Reporting them
    // would put the store's own domain at the top of its referral table.
    if (selfReferral) {
      return { source: DIRECT, medium: "none", campaign: null, referrerHost, selfReferral: true }
    }

    for (const [pattern, name] of SEARCH_ENGINES) {
      if (pattern.test(stripped)) {
        return { source: name, medium: "organic", campaign: null, referrerHost, selfReferral: false }
      }
    }
    for (const [pattern, name] of SOCIAL) {
      if (pattern.test(stripped)) {
        return { source: name, medium: "social", campaign: null, referrerHost, selfReferral: false }
      }
    }
    for (const pattern of WEBMAIL) {
      if (pattern.test(stripped)) {
        return {
          source: sanitiseKey(stripped) ?? DIRECT,
          medium: "email",
          campaign: null,
          referrerHost,
          selfReferral: false,
        }
      }
    }

    return {
      source: sanitiseKey(stripped) ?? DIRECT,
      medium: "referral",
      campaign: null,
      referrerHost,
      selfReferral: false,
    }
  }

  // 4. No referrer at all.
  return { source: DIRECT, medium: "none", campaign: null, referrerHost: null, selfReferral: false }
}

function readParams(landingUrl: string): URLSearchParams {
  try {
    // A relative path is normal here; the base is only needed to satisfy URL().
    return new URL(landingUrl, "http://local.invalid").searchParams
  } catch {
    return new URLSearchParams()
  }
}

const MEDIUMS: Medium[] = ["none", "organic", "referral", "social", "cpc", "email"]

function normaliseMedium(raw: string | null): Medium | null {
  const key = sanitiseKey(raw, 24)
  if (!key) return null
  if ((MEDIUMS as string[]).includes(key)) return key as Medium
  // Common synonyms sellers actually type into their links.
  if (key === "ppc" || key === "paid" || key === "paid-social") return "cpc"
  if (key === "newsletter" || key === "mail") return "email"
  if (key === "social-media") return "social"
  if (key === "search" || key === "seo") return "organic"
  return "referral"
}

/** Presentation only — the stored value stays the lowercase key. */
export const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  yandex: "Yandex",
  baidu: "Baidu",
  ecosia: "Ecosia",
  brave: "Brave Search",
  duckduckgo: "DuckDuckGo",
  coccoc: "Cốc Cốc",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "X (Twitter)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  threads: "Threads",
  discord: "Discord",
  zalo: "Zalo",
  vk: "VK",
}

/**
 * A display label for a source key.
 *
 * Known networks get their proper casing from the table above. Anything else is
 * either a UTM value the seller chose ("newsletter", "spring-sale") or a bare
 * host. Hosts are shown verbatim — "Producthunt.com" would look like a typo —
 * while a plain word is capitalised so a hand-tagged link does not read as
 * lowercase debug output next to "Google" and "Direct".
 */
export function sourceLabel(key: string): string {
  const known = SOURCE_LABELS[key]
  if (known) return known
  if (key.includes(".")) return key
  return key.charAt(0).toUpperCase() + key.slice(1)
}
