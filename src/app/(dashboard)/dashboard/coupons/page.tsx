"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { couponSchema, type CouponInput } from "@/lib/validations"
import type { CouponRow } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Tag, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<CouponRow[]>([])
  const [open, setOpen] = useState(false)

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<CouponInput>({
    resolver: zodResolver(couponSchema) as any,
    defaultValues: { type: "PERCENT" },
  })
  const type = watch("type")

  async function load() {
    const res = await fetch("/api/coupons")
    setCoupons(await res.json())
  }

  useEffect(() => { load() }, [])

  async function onSubmit(data: CouponInput) {
    const res = await fetch("/api/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, code: data.code.toUpperCase() }),
    })
    if (res.ok) {
      toast.success("Coupon created")
      reset()
      setOpen(false)
      load()
    } else {
      const json = await res.json()
      toast.error(JSON.stringify(json.error))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this coupon?")) return
    await fetch("/api/coupons", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    toast.success("Coupon deleted")
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coupons</h1>
          <p className="text-muted-foreground">Create discount codes for your store</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />New Coupon
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Coupon</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input placeholder="SAVE20" {...register("code")} className="uppercase" />
                {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Discount</Label>
                  <Input type="number" min="1" {...register("discount")} />
                  {errors.discount && <p className="text-xs text-red-500">{errors.discount.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setValue("type", v as "PERCENT" | "FIXED")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Percent (%)</SelectItem>
                      <SelectItem value="FIXED">Fixed ($)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Usage Limit</Label>
                  <Input type="number" min="1" placeholder="Unlimited" {...register("usageLimit")} />
                </div>
                <div className="space-y-2">
                  <Label>Expires At</Label>
                  <Input type="date" {...register("expiresAt")} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Coupon"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {coupons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Tag className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">No coupons yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create discount codes to boost your sales</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono font-bold text-sm bg-muted px-2 py-0.5 rounded">{c.code}</code>
                    <Badge variant={c.isActive ? "default" : "secondary"} className="text-xs">
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {c.type === "PERCENT" ? `${c.discount}% off` : `$${c.discount} off`}
                    {" · "}
                    {c.usageCount} used{c.usageLimit ? ` / ${c.usageLimit}` : ""}
                    {c.expiresAt ? ` · Expires ${new Date(c.expiresAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleDelete(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
