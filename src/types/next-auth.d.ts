// Extend next-auth types to include custom fields
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      plan: string
      storeSlug: string | null
    } & DefaultSession["user"]
  }
}
