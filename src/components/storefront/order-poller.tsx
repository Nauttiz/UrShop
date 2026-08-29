"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Refreshes a pending receipt while the payment webhook lands.
 *
 * Backs off after a minute and stops entirely after five, so a genuinely
 * abandoned payment does not leave a tab polling the server forever.
 */
export function OrderPoller({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const elapsed = Date.now() - startedAt
      if (elapsed > 5 * 60_000) return

      router.refresh()
      timer = setTimeout(tick, elapsed > 60_000 ? intervalMs * 4 : intervalMs)
    }

    timer = setTimeout(tick, intervalMs)
    return () => clearTimeout(timer)
  }, [router, intervalMs])

  return null
}
