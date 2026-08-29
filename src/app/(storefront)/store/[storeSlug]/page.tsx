import Link from "next/link"
import { notFound } from "next/navigation"
import { Prisma } from "@prisma/client"
import { Search } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { ProductCard } from "@/components/storefront/product-card"
import { StoreHero } from "@/components/storefront/store-hero"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"

type Props = {
  params: Promise<{ storeSlug: string }>
  searchParams: Promise<{ q?: string; category?: string; sort?: string }>
}

const SORTS: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  "price-asc": { price: "asc" },
  "price-desc": { price: "desc" },
  popular: { viewCount: "desc" },
}

export async function generateMetadata({ params }: Props) {
  const { storeSlug } = await params
  const store = await prisma.store.findUnique({ where: { slug: storeSlug } })
  if (!store) return {}
  return {
    title: store.name,
    description: store.description,
    openGraph: {
      title: store.name,
      description: store.description ?? undefined,
      images: store.logoUrl ? [store.logoUrl] : undefined,
    },
  }
}

export default async function StorefrontPage({ params, searchParams }: Props) {
  const { storeSlug } = await params
  const { q, category, sort } = await searchParams

  const store = await prisma.store.findUnique({ where: { slug: storeSlug } })
  if (!store) notFound()

  const theme = { ...DEFAULT_THEME, ...((store.themeConfig ?? {}) as Partial<ThemeConfig>) }

  const where: Prisma.ProductWhereInput = {
    storeId: store.id,
    isPublished: true,
    ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}),
    ...(category ? { category } : {}),
  }

  const [products, categoryGroups] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: SORTS[sort ?? "newest"] ?? SORTS.newest,
      take: 60,
    }),
    prisma.product.groupBy({
      by: ["category"],
      where: { storeId: store.id, isPublished: true, category: { not: null } },
      _count: { category: true },
    }),
  ])

  const categories = categoryGroups
    .filter((g) => g.category)
    .map((g) => ({ name: g.category as string, count: g._count.category }))

  const buildHref = (next: Record<string, string | undefined>) => {
    const sp = new URLSearchParams()
    const merged = { q, category, sort, ...next }
    for (const [key, value] of Object.entries(merged)) {
      if (value) sp.set(key, value)
    }
    const query = sp.toString()
    return `/store/${storeSlug}${query ? `?${query}` : ""}`
  }

  return (
    <>
      <StoreHero store={store} theme={theme} />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <form action={`/store/${storeSlug}`} className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search products…"
              className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2"
              style={{ ["--tw-ring-color" as string]: theme.primaryColor }}
            />
            {category && <input type="hidden" name="category" value={category} />}
            {sort && <input type="hidden" name="sort" value={sort} />}
          </form>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {Object.keys(SORTS).map((key) => (
              <Link
                key={key}
                href={buildHref({ sort: key })}
                className={`rounded-md border px-3 py-1.5 transition-colors ${
                  (sort ?? "newest") === key
                    ? "border-transparent text-white"
                    : "bg-white hover:bg-gray-50"
                }`}
                style={(sort ?? "newest") === key ? { backgroundColor: theme.primaryColor } : undefined}
              >
                {key === "newest"
                  ? "Newest"
                  : key === "popular"
                    ? "Popular"
                    : key === "price-asc"
                      ? "Price ↑"
                      : "Price ↓"}
              </Link>
            ))}
          </div>
        </div>

        {categories.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <Link
              href={buildHref({ category: undefined })}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                !category ? "border-gray-900 bg-gray-900 text-white" : "bg-white hover:bg-gray-50"
              }`}
            >
              All
            </Link>
            {categories.map((c) => (
              <Link
                key={c.name}
                href={buildHref({ category: c.name })}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  category === c.name ? "border-gray-900 bg-gray-900 text-white" : "bg-white hover:bg-gray-50"
                }`}
              >
                {c.name} ({c.count})
              </Link>
            ))}
          </div>
        )}

        {products.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            <p className="text-lg">
              {q || category ? "No products match your search." : "No products available yet."}
            </p>
            {(q || category) && (
              <Link href={`/store/${storeSlug}`} className="mt-2 inline-block text-sm underline">
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <div
            className={
              theme.layout === "grid"
                ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                : "flex flex-col gap-4"
            }
          >
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                theme={theme}
                layout={theme.layout}
                storeSlug={storeSlug}
                currency={store.currency}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
