import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download, Package, RefreshCw, ShieldCheck } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { formatMoney } from "@/lib/money"
import { formatBytes } from "@/lib/bytes"
import { AddToCart } from "@/components/storefront/add-to-cart"
import { ProductCard } from "@/components/storefront/product-card"
import { Badge } from "@/components/ui/badge"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"

type Props = { params: Promise<{ storeSlug: string; productSlug: string }> }

/** Products created before slugs existed are still reachable by id. */
function bySlugOrId(storeId: string, key: string) {
  return prisma.product.findFirst({
    where: { storeId, isPublished: true, OR: [{ slug: key }, { id: key }] },
    include: { files: { orderBy: { sortOrder: "asc" } } },
  })
}

export async function generateMetadata({ params }: Props) {
  const { storeSlug, productSlug } = await params
  const store = await prisma.store.findUnique({ where: { slug: storeSlug }, select: { id: true, name: true } })
  if (!store) return {}
  const product = await bySlugOrId(store.id, productSlug)
  if (!product) return {}

  return {
    title: `${product.name} — ${store.name}`,
    description: product.description?.slice(0, 160),
    openGraph: {
      title: product.name,
      description: product.description?.slice(0, 160) ?? undefined,
      images: product.thumbnail ? [product.thumbnail] : undefined,
      type: "website",
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const { storeSlug, productSlug } = await params

  const store = await prisma.store.findUnique({
    where: { slug: storeSlug },
    select: { id: true, name: true, currency: true, themeConfig: true },
  })
  if (!store) notFound()

  const product = await bySlugOrId(store.id, productSlug)
  if (!product) notFound()

  // Fire-and-forget: a failed counter must never break the page render.
  void prisma.product
    .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => {})

  const theme = { ...DEFAULT_THEME, ...((store.themeConfig ?? {}) as Partial<ThemeConfig>) }

  const related = await prisma.product.findMany({
    where: { storeId: store.id, isPublished: true, NOT: { id: product.id } },
    orderBy: { createdAt: "desc" },
    take: 3,
  })

  const isDigital = product.type !== "PHYSICAL"
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.price

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href={`/store/${storeSlug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to store
      </Link>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border bg-white">
          {product.thumbnail ? (
            <img
              src={product.thumbnail}
              alt={product.name}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-gray-100">
              <Package className="h-16 w-16 text-gray-300" />
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {product.type === "DIGITAL"
                ? "Digital download"
                : product.type === "SUBSCRIPTION"
                  ? `Subscription · per ${product.billingInterval ?? "month"}`
                  : "Physical product"}
            </Badge>
            {product.category && <Badge variant="secondary">{product.category}</Badge>}
            {onSale && <Badge className="bg-red-600 text-white hover:bg-red-600">Sale</Badge>}
          </div>

          <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-3xl font-bold" style={{ color: theme.primaryColor }}>
              {product.isPayWhatYouWant
                ? `From ${formatMoney(product.minPrice ?? product.price, store.currency)}`
                : formatMoney(product.price, store.currency)}
            </span>
            {onSale && (
              <span className="text-lg text-gray-400 line-through">
                {formatMoney(product.compareAtPrice!, store.currency)}
              </span>
            )}
          </div>

          {product.description && (
            <p className="mt-5 whitespace-pre-wrap leading-relaxed text-gray-700">
              {product.description}
            </p>
          )}

          {product.files.length > 0 && (
            <div className="mt-6 rounded-lg border bg-white p-4">
              <p className="mb-2 text-sm font-semibold">
                {product.files.length} file{product.files.length !== 1 ? "s" : ""} included
              </p>
              <ul className="space-y-1.5">
                {product.files.map((file) => (
                  <li key={file.id} className="flex items-center justify-between text-sm text-gray-600">
                    <span className="flex min-w-0 items-center gap-2">
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{file.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{formatBytes(file.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8">
            <AddToCart
              storeSlug={storeSlug}
              productId={product.id}
              price={product.price}
              currency={store.currency}
              isPayWhatYouWant={product.isPayWhatYouWant}
              minPrice={product.minPrice}
              stock={product.type === "PHYSICAL" ? product.stock : null}
              primaryColor={theme.primaryColor}
            />
          </div>

          <ul className="mt-8 space-y-2 border-t pt-6 text-sm text-gray-600">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              Secure checkout
            </li>
            {isDigital && (
              <li className="flex items-center gap-2">
                <Download className="h-4 w-4 text-green-600" />
                Instant download after payment
              </li>
            )}
            <li className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-green-600" />
              Contact the seller for refund requests
            </li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-5 text-xl font-bold">More from {store.name}</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                theme={theme}
                layout="grid"
                storeSlug={storeSlug}
                currency={store.currency}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
