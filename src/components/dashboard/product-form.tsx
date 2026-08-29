"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { productSchema, type ProductInput } from "@/lib/validations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageUpload } from "@/components/shared/image-upload"
import { ProductFiles } from "@/components/dashboard/product-files"
import { toast } from "sonner"

interface ProductFormProps {
  productId?: string
}

export function ProductForm({ productId }: ProductFormProps) {
  const router = useRouter()
  const isEditing = !!productId

  // ref avoids stale closure — always holds the latest thumbnail value
  const thumbnailRef = useRef<string>("")
  const [thumbnailUrl, setThumbnailUrl] = useState<string>("")

  function updateThumbnail(url: string) {
    thumbnailRef.current = url
    setThumbnailUrl(url)
  }

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<ProductInput>({
    resolver: zodResolver(productSchema) as any,
    defaultValues: {
      type: "DIGITAL",
      isPublished: false,
      isPayWhatYouWant: false,
      currency: "USD",
    },
  })

  useEffect(() => {
    if (isEditing) {
      fetch(`/api/products/${productId}`)
        .then((r) => r.json())
        .then((data) => {
          reset(data)
          updateThumbnail(data.thumbnail ?? "")
        })
    }
  }, [isEditing, productId, reset])

  async function onSubmit(data: ProductInput) {
    const url = isEditing ? `/api/products/${productId}` : "/api/products"
    const method = isEditing ? "PATCH" : "POST"

    // read from ref — never stale regardless of React batching
    const payload = { ...data, thumbnail: thumbnailRef.current || null }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      const product = await res.json()
      toast.success(isEditing ? "Product updated" : "Product created")
      // A brand-new digital product still needs its files, so land on the edit
      // page where the uploader lives instead of bouncing back to the list.
      if (!isEditing && data.type !== "PHYSICAL") {
        window.location.href = `/dashboard/products/${product.id}/edit`
        return
      }
      window.location.href = "/dashboard/products"
    } else {
      const json = await res.json()
      const fieldErrors = json?.error?.fieldErrors as Record<string, string[]> | undefined
      toast.error(
        fieldErrors
          ? Object.values(fieldErrors).flat().join(", ")
          : (json?.error ?? "Could not save the product")
      )
    }
  }

  const type = watch("type")
  const isPublished = watch("isPublished")
  const isPayWhatYouWant = watch("isPayWhatYouWant")
  const isDigital = type !== "PHYSICAL"

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Product name *</Label>
            <Input id="name" placeholder="e.g. My Awesome eBook" {...register("name")} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} placeholder="Describe your product..." {...register("description")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select
                value={type}
                onValueChange={(v) => setValue("type", v as ProductInput["type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIGITAL">Digital download</SelectItem>
                  <SelectItem value="PHYSICAL">Physical product</SelectItem>
                  <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input id="category" placeholder="e.g. Templates" {...register("category")} />
            </div>
          </div>

          {type === "SUBSCRIPTION" && (
            <div className="space-y-2">
              <Label>Billing interval *</Label>
              <Select
                value={watch("billingInterval") ?? "month"}
                onValueChange={(v) => setValue("billingInterval", v as "month" | "year")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                </SelectContent>
              </Select>
              {errors.billingInterval && (
                <p className="text-xs text-red-500">{errors.billingInterval.message}</p>
              )}
            </div>
          )}

          <ImageUpload label="Thumbnail" value={thumbnailUrl} onChange={updateThumbnail} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Price *</Label>
              <Input id="price" type="number" step="0.01" min="0" placeholder="0.00" {...register("price")} />
              {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="compareAtPrice">Compare-at price</Label>
              <Input
                id="compareAtPrice"
                type="number"
                step="0.01"
                min="0"
                placeholder="Optional"
                {...register("compareAtPrice")}
              />
              <p className="text-xs text-muted-foreground">Shown struck through to signal a sale</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Pay what you want</p>
              <p className="text-xs text-muted-foreground">
                Buyers choose their own price above a floor you set
              </p>
            </div>
            <Switch
              checked={isPayWhatYouWant}
              onCheckedChange={(v) => setValue("isPayWhatYouWant", v)}
            />
          </div>

          {isPayWhatYouWant && (
            <div className="space-y-2">
              <Label htmlFor="minPrice">Minimum price *</Label>
              <Input id="minPrice" type="number" step="0.01" min="0" {...register("minPrice")} />
              {errors.minPrice && <p className="text-xs text-red-500">{errors.minPrice.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {type === "PHYSICAL" && (
        <Card>
          <CardHeader>
            <CardTitle>Inventory &amp; shipping</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock">Stock</Label>
              <Input id="stock" type="number" min="0" placeholder="Leave empty for unlimited" {...register("stock")} />
              <p className="text-xs text-muted-foreground">Decremented automatically on payment</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="weightGrams">Weight (grams)</Label>
              <Input id="weightGrams" type="number" min="0" placeholder="Optional" {...register("weightGrams")} />
            </div>
          </CardContent>
        </Card>
      )}

      {isDigital && (
        <Card>
          <CardHeader>
            <CardTitle>Digital delivery</CardTitle>
            <CardDescription>
              {isEditing
                ? "Files buyers receive after paying"
                : "Save the product first, then upload the files buyers receive"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <ProductFiles productId={productId!} />
            ) : (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                The uploader appears once the product exists.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="downloadLimit">Download limit</Label>
                <Input
                  id="downloadLimit"
                  type="number"
                  min="1"
                  placeholder="Store default"
                  {...register("downloadLimit")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="downloadExpiryHours">Link valid for (hours)</Label>
                <Input
                  id="downloadExpiryHours"
                  type="number"
                  min="1"
                  placeholder="Store default"
                  {...register("downloadExpiryHours")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fileUrl">External file URL (optional)</Label>
              <Input id="fileUrl" placeholder="https://..." {...register("fileUrl")} />
              <p className="text-xs text-muted-foreground">
                Used only when no files are uploaded above
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="font-medium">Published</p>
            <p className="text-sm text-muted-foreground">Make this product visible in your store</p>
          </div>
          <Switch checked={isPublished} onCheckedChange={(v) => setValue("isPublished", v)} />
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : isEditing ? "Update product" : "Create product"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
