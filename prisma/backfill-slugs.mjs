/**
 * One-off backfill: products created before slugs existed have `slug = null`
 * and fall back to their id in storefront URLs. Run once after migrating:
 *
 *   node prisma/backfill-slugs.mjs
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const COMBINING_MARKS = /[̀-ͯ]/g

function slugify(input) {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

const products = await prisma.product.findMany({
  where: { slug: null },
  select: { id: true, name: true, storeId: true },
})

let updated = 0
for (const product of products) {
  const root = slugify(product.name) || "product"
  let candidate = root
  let n = 2

  while (
    await prisma.product.findFirst({
      where: { storeId: product.storeId, slug: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${root}-${n++}`
  }

  await prisma.product.update({ where: { id: product.id }, data: { slug: candidate } })
  console.log(`  ${product.name} -> ${candidate}`)
  updated++
}

console.log(`Backfilled ${updated} product slug(s).`)
await prisma.$disconnect()
