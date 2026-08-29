"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { OrderStatus } from "@prisma/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function OrderActions({
  orderId,
  status,
  total,
  currencySymbol,
}: {
  orderId: string
  status: OrderStatus
  total: number
  currencySymbol: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundAmount, setRefundAmount] = useState(total.toFixed(2))

  async function changeStatus(next: OrderStatus) {
    setBusy(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(json?.error ?? "Could not update the order")
        return
      }
      toast.success(`Order marked ${next.toLowerCase()}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function refund() {
    const amount = Number(refundAmount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > total) {
      toast.error(`Enter an amount between 0 and ${total.toFixed(2)}`)
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(json?.error ?? "Refund failed")
        return
      }
      toast.success("Refund issued")
      setRefundOpen(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const canFulfil = status === "PAID"
  const canReopen = status === "FULFILLED"
  const canRefund = status === "PAID" || status === "FULFILLED"
  const canCancel = status === "PENDING" || status === "FAILED"
  const canApprove = status === "PENDING" || status === "FAILED"

  if (!canFulfil && !canReopen && !canRefund && !canCancel && !canApprove) {
    return <p className="text-sm text-muted-foreground">No actions available for this order.</p>
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canFulfil && (
          <Button size="sm" disabled={busy} onClick={() => changeStatus("FULFILLED")}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Mark fulfilled
          </Button>
        )}
        {canReopen && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus("PAID")}>
            Reopen as paid
          </Button>
        )}
        {canApprove && (
          <Button size="sm" disabled={busy} onClick={() => changeStatus("PAID")}>
            Mark paid manually
          </Button>
        )}
        {canRefund && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setRefundOpen(true)}>
            Refund
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus("CANCELLED")}>
            Cancel order
          </Button>
        )}
      </div>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund this order</DialogTitle>
            <DialogDescription>
              The payment provider is charged first. Once it succeeds the order is marked refunded,
              stock is restored and the buyer&apos;s download links stop working.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="refund-amount" className="text-sm font-medium">
              Amount to refund
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{currencySymbol}</span>
              <input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={total}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-40 rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">Maximum {total.toFixed(2)}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={refund} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Issue refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
