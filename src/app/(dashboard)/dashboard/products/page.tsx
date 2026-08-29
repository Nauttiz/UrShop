import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ProductActions } from "@/components/dashboard/product-actions"
import { Plus, Package } from "lucide-react"
import { ProductType } from "@prisma/client"

export default async function ProductsPage() {
  const session = await auth()
  const store = await prisma.store.findUnique({ where: { userId: session!.user.id } })
  const products = store
    ? await prisma.product.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" } })
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">{products.length} product{products.length !== 1 ? "s" : ""}</p>
        </div>
        <Button nativeButton={false} render={<Link href="/dashboard/products/new" />}>
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No products yet</h3>
            <p className="text-muted-foreground text-sm mb-4">Add your first product to start selling</p>
            <Button nativeButton={false} render={<Link href="/dashboard/products/new" />}>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <Card key={product.id}>
              <CardContent className="flex items-center gap-4 py-4">
                {/* Thumbnail */}
                <div className="h-12 w-12 rounded bg-gray-100 flex items-center justify-center shrink-0">
                  {product.thumbnail ? (
                    <img src={product.thumbnail} alt={product.name} className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {product.type === ProductType.DIGITAL ? "Digital" : "Physical"}
                    </Badge>
                    <Badge variant={product.isPublished ? "default" : "secondary"} className="text-xs">
                      {product.isPublished ? "Published" : "Draft"}
                    </Badge>
                    {product.stock !== null && (
                      <span className="text-xs text-muted-foreground">Stock: {product.stock}</span>
                    )}
                  </div>
                </div>

                <p className="font-semibold shrink-0">
                  ${product.price.toFixed(2)}
                </p>

                <ProductActions productId={product.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
