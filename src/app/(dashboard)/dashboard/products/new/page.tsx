import { ProductForm } from "@/components/dashboard/product-form"

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add Product</h1>
        <p className="text-muted-foreground">Create a new product for your store</p>
      </div>
      <ProductForm />
    </div>
  )
}
