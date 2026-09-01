"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

/**
 * Fires the storefront visit beacon.
 *
 * Renders nothing and runs entirely after paint, so it can neither block nor
 * break a storefront render. Being client-side is also the strongest bot filter
 * available: a crawler that does not execute JavaScript never reaches the
 * endpoint at all.
 *
 * Reads `window.location.search` rather than `useSearchParams()` on purpose —
 * that hook would push the whole storefront layout subtree behind a Suspense
 * boundary, a cost paid by every buyer to serve the seller's dashboard.
 */

const SKIP_WINDOW_MS = 25 * 60 * 1000 // just under the server's 30-minute session

export function VisitTracker({ storeSlug }: { storeSlug: string }) {
  const pathname = usePathname()

  useEffect(() => {
    if (shouldSkip()) return

    const key = `sf_seen:${storeSlug}`
    const lastSeen = readTimestamp(key)
    // The server would answer 204 with no DB work anyway; skipping the request
    // outright means a typical session makes exactly one network call.
    if (lastSeen !== null && Date.now() - lastSeen < SKIP_WINDOW_MS) return

    const controller = new AbortController()

    void fetch(`/api/store/${encodeURIComponent(storeSlug)}/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Survives the page being closed mid-navigation.
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify({
        path: pathname + window.location.search,
        referrer: document.referrer || null,
      }),
    })
      .then(() => writeTimestamp(key))
      // A failed beacon is not worth telling anyone about.
      .catch(() => {})

    return () => controller.abort()
  }, [storeSlug, pathname])

  return null
}

function shouldSkip(): boolean {
  // Automation drivers: Playwright, Puppeteer, Selenium.
  if (navigator.webdriver) return true
  // Speculation-rules prerender the visitor has not actually seen yet.
  if ((document as Document & { prerendering?: boolean }).prerendering) return true
  // Background tab — a speculative or restored load, not a real view.
  if (document.visibilityState !== "visible") return true
  return false
}

/** sessionStorage throws in some privacy modes, so every access is guarded. */
function readTimestamp(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeTimestamp(key: string): void {
  try {
    window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // Private mode or blocked storage — the server-side cookie still dedupes.
  }
}
