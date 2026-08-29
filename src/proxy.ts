import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"

/**
 * Anything a buyer must reach without an account: the marketing page, the auth
 * screens, every storefront route (catalogue, cart, checkout, receipts) and the
 * hosted payment stand-in.
 */
const PUBLIC_PATHS: (string | RegExp)[] = [
  "/",
  "/login",
  "/register",
  /^\/store\/[^/]+(\/.*)?$/,
  /^\/pay\//,
]

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  const isPublic = PUBLIC_PATHS.some((p) => (typeof p === "string" ? pathname === p : p.test(pathname)))

  if (!isLoggedIn && !isPublic) {
    const login = new URL("/login", req.url)
    // Send the seller back where they were headed after signing in.
    login.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(login)
  }

  if (isLoggedIn && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
