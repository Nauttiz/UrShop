/**
 * Server-side bot filtering for the visit beacon.
 *
 * The first and strongest filter is not here — it is structural. The beacon
 * only fires from a browser that executes JavaScript, so crawlers, `curl`,
 * uptime monitors and feed readers never reach this route at all. These checks
 * catch what is left: headless browsers, prefetchers, and the crawlers that do
 * run JS.
 */

/**
 * Matched against the User-Agent. Deliberately broad — a false positive costs
 * one uncounted visit, a false negative pollutes the seller's numbers and is
 * far harder to notice.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrap|headless|phantomjs|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|axios|node-fetch|go-http|okhttp|java\/|libwww|httpclient|monitor|pingdom|uptime|semrush|ahrefs|screaming|petal|bytespider|gptbot|claudebot|ccbot|perplexity|dataprovider|archive\.org|feedly/i

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  // An absent or empty UA is never a real browser session.
  if (!userAgent || userAgent.trim().length === 0) return true
  return BOT_PATTERN.test(userAgent)
}

/**
 * Speculative loads the user never saw.
 *
 * `Sec-Purpose: prefetch` covers Next's own `<Link>` prefetching and browser
 * speculation rules. Counting these would inflate a catalogue page by one visit
 * per product card in the viewport.
 */
export function isPrefetchRequest(headers: Headers): boolean {
  const secPurpose = headers.get("sec-purpose") ?? headers.get("purpose") ?? ""
  if (/prefetch|prerender/i.test(secPurpose)) return true
  // Legacy header still sent by some browsers.
  if ((headers.get("x-moz") ?? "").toLowerCase() === "prefetch") return true
  if (headers.get("next-router-prefetch") === "1") return true
  return false
}
