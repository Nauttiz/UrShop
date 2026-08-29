"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export function MockPayForm({
  orderId,
  providerRef,
  receiptUrl,
  cancelUrl,
}: {
  orderId: string
  providerRef: string
  receiptUrl: string
  cancelUrl: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"success" | "failure" | null>(null)

  async function submit(outcome: "success" | "failure") {
    setBusy(outcome)
    try {
      const res = await fetch("/api/payments/mock/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, providerRef, outcome }),
      })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        toast.error(json?.error ?? "Could not complete the test payment")
        setBusy(null)
        return
      }

      router.push(json?.receiptUrl ?? receiptUrl)
    } catch {
      toast.error("Network error — please try again")
      setBusy(null)
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <button
        onClick={() => submit("success")}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-70"
      >
        {busy === "success" && <Loader2 className="h-4 w-4 animate-spin" />}
        Simulate successful payment
      </button>

      <button
        onClick={() => submit("failure")}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-red-200 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-70"
      >
        {busy === "failure" && <Loader2 className="h-4 w-4 animate-spin" />}
        Simulate declined card
      </button>

      <a
        href={cancelUrl}
        className="block py-2 text-center text-sm text-gray-500 hover:text-gray-800 hover:underline"
      >
        Cancel and return to cart
      </a>
    </div>
  )
}
