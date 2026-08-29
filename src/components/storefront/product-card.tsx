import Link from "next/link"
import { Package } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { AddToCart } from "@/components/storefront/add-to-cart"
import { formatMoney } from "@/lib/money"
import type { ThemeConfig } from "@/types"
import type { Product } from "@prisma/client"

interface ProductCardProps {
  product: Product
  theme: ThemeConfig
  layout: "grid" | "list"
  storeSlug: string
  currency: string
}

function typeLabel(type: Product["type"]): string {
  if (type === "DIGITAL") return "Digital"
  if (type === "SUBSCRIPTION") return "Subscription"
  return "Physical"
}

function PriceTag({ product, currency }: { product: Product; currency: string }) {
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.price
  return (
    <div className="flex items-baseline gap-2">
      <p className="text-lg font-bold">
        {product.isPayWhatYouWant
          ? `From ${formatMoney(product.minPrice ?? product.price, currency)}`
          : formatMoney(product.price, currency)}
      </p>
      {onSale && (
        <span className="text-sm text-gray-400 line-through">
          {formatMoney(product.compareAtPrice!, currency)}
        </span>
      )}
    </div>
  )
}

export function ProductCard({ product, theme, layout, storeSlug, currency }: ProductCardProps) {
  const href = `/store/${storeSlug}/products/${product.slug ?? product.id}`
  const stock = product.type === "PHYSICAL" ? product.stock : null

  const cartButton = (
    <AddToCart
      compact
      storeSlug={storeSlug}
      productId={product.id}
      price={product.price}
      currency={currency}
      isPayWhatYouWant={product.isPayWhatYouWant}
      minPrice={product.minPrice}
      stock={stock}
      primaryColor={theme.primaryColor}
    />
  )

  if (layout === "list") {
    return (
      <Card className="flex flex-row overflow-hidden py-0">
        <Link href={href} className="w-28 shrink-0 bg-gray-100">
          {product.thumbnail ? (
            <img src={product.thumbnail} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <Package className="h-8 w-8 text-gray-300" />
            </div>
          )}
        </Link>
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link href={href}>
                <h3 className="font-semibold hover:underline">{product.name}</h3>
              </Link>
              {product.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <PriceTag product={product} currency={currency} />
              <Badge variant="outline" className="mt-1 text-xs">
                {typeLabel(product.type)}
              </Badge>
            </div>
          </div>
          <div className="mt-3">{cartButton}</div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col overflow-hidden py-0">
      <Link href={href} className="aspect-square bg-gray-100">
        {product.thumbnail ? (
          <img src={product.thumbnail} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Package className="h-12 w-12 text-gray-300" />
          </div>
        )}
      </Link>
      <CardContent className="flex-1 p-4">
        <Link href={href}>
          <h3 className="truncate font-semibold hover:underline">{product.name}</h3>
        </Link>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {typeLabel(product.type)}
          </Badge>
          {stock !== null && stock <= 5 && (
            <Badge variant="destructive" className="text-xs">
              {stock === 0 ? "Sold out" : `Only ${stock} left`}
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between p-4 pt-0">
        <PriceTag product={product} currency={currency} />
        {cartButton}
      </CardFooter>
    </Card>
  )
}
