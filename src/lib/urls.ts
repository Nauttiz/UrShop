import { headers } from "next/headers"

/**
 * Absolute origin of the running app.
 *
 * Prefers the explicit env var so emails and payment redirect URLs are stable,
 * and falls back to the request headers for local development.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL
  if (configured) return configured.replace(/\/+$/, "")

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

export function storeUrl(baseUrl: string, storeSlug: string, path = ""): string {
  return `${baseUrl}/store/${storeSlug}${path}`
}
