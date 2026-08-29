import { ProductForm } from "@/components/dashboard/product-form"

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Product</h1>
        <p className="text-muted-foreground">Update your product details</p>
      </div>
      <ProductForm productId={id} />
    </div>
  )
}
