/**
 * Demo data for the analytics dashboard.
 *
 * A brand-new store has no visit history, so every chart renders its empty
 * state — accurate, but useless for a demo or a screenshot. This fills the
 * window with plausible traffic and, optionally, orders.
 *
 * Everything it writes is reversible: visits carry a `demo-` session prefix and
 * seeded orders carry a `DEMO-` order number, so `--reset` removes exactly what
 * this script created and never touches real data.
 *
 *   node prisma/seed-analytics.mjs                    120 days of visits
 *   node prisma/seed-analytics.mjs --days=90
 *   node prisma/seed-analytics.mjs --orders           also create demo orders
 *   node prisma/seed-analytics.mjs --reset            remove all demo data
 *   node prisma/seed-analytics.mjs --store=<slug>     pick a store explicitly
 */

import { PrismaClient } from "@prisma/client"
import { randomBytes } from "node:crypto"

const prisma = new PrismaClient()

const DEMO_SESSION_PREFIX = "demo"
const DEMO_ORDER_PREFIX = "DEMO-"
const MS_PER_DAY = 86_400_000

/**
 * Weights are roughly what a small store actually sees: direct and organic
 * search dominate, paid and referral trail. A uniform mix would make the donut
 * five equal slices, which looks synthetic at a glance.
 */
const SOURCES = [
  { source: "direct", medium: "none", weight: 30, convert: 0.021 },
  { source: "google", medium: "organic", weight: 26, convert: 0.028 },
  { source: "instagram", medium: "social", weight: 15, convert: 0.014 },
  { source: "facebook", medium: "social", weight: 9, convert: 0.011 },
  { source: "tiktok", medium: "social", weight: 7, convert: 0.008 },
  { source: "newsletter", medium: "email", weight: 5, convert: 0.062, campaign: "monthly-drop" },
  { source: "google", medium: "cpc", weight: 4, convert: 0.033, campaign: "brand-search" },
  { source: "producthunt.com", medium: "referral", weight: 2, convert: 0.019 },
  { source: "reddit", medium: "social", weight: 2, convert: 0.006 },
]

const LANDING_PATHS = ["/", "/products", "/product/starter-pack", "/product/pro-bundle", "/about"]

const TOTAL_WEIGHT = SOURCES.reduce((sum, s) => sum + s.weight, 0)

function pickSource(rand) {
  let ticket = rand() * TOTAL_WEIGHT
  for (const entry of SOURCES) {
    ticket -= entry.weight
    if (ticket <= 0) return entry
  }
  return SOURCES[0]
}

/**
 * Deterministic PRNG (mulberry32), so re-running with the same seed reproduces
 * the same dashboard. Debugging a chart against data that changes every run is
 * needlessly hard.
 */
function makeRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Visits for one day: a slow upward trend, a weekend dip, and per-day noise.
 * A flat line would hide exactly the axis-scaling bugs this data exists to
 * exercise.
 */
function visitsForDay(dayIndex, totalDays, weekday, rand) {
  const trend = 18 + (dayIndex / Math.max(1, totalDays - 1)) * 34
  const weekendFactor = weekday === 0 || weekday === 6 ? 0.62 : 1
  const noise = 0.55 + rand() * 0.95
  return Math.max(0, Math.round(trend * weekendFactor * noise))
}

function token(bytes = 16) {
  return randomBytes(bytes).toString("hex")
}

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return null
  const eq = hit.indexOf("=")
  return eq === -1 ? "" : hit.slice(eq + 1)
}

async function resolveStore() {
  const slug = arg("store")
  const store = slug
    ? await prisma.store.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } })
    : await prisma.store.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, slug: true, name: true },
      })
  if (!store) throw new Error(slug ? `No store with slug "${slug}"` : "No stores exist yet")
  return store
}

async function reset(store) {
  const visits = await prisma.visit.deleteMany({
    where: { storeId: store.id, sessionId: { startsWith: DEMO_SESSION_PREFIX } },
  })

  // Order items and payments cascade; customers are left alone because a real
  // buyer may share an email with a demo one.
  const orders = await prisma.order.deleteMany({
    where: { storeId: store.id, orderNumber: { startsWith: DEMO_ORDER_PREFIX } },
  })

  console.log(`Removed ${visits.count} demo visits and ${orders.count} demo orders from ${store.slug}.`)
}

async function seedVisits(store, days, rand) {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  /** @type {{visits: object[], purchases: object[]}} */
  const rows = []
  const purchases = []

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * MS_PER_DAY)
    const day = new Date(`${dayKey(date)}T00:00:00.000Z`)
    const count = visitsForDay(days - 1 - i, days, date.getUTCDay(), rand)

    for (let n = 0; n < count; n++) {
      const entry = pickSource(rand)
      const landingPath = LANDING_PATHS[Math.floor(rand() * LANDING_PATHS.length)]
      const sessionId = `${DEMO_SESSION_PREFIX}${token(13)}`.slice(0, 32)

      rows.push({
        storeId: store.id,
        sessionId,
        visitorId: token(16),
        day,
        source: entry.source,
        medium: entry.medium,
        campaign: entry.campaign ?? null,
        referrerHost: entry.medium === "none" ? null : `${entry.source}.com`,
        landingPath,
        // Spread through the day so the raw rows look like real traffic rather
        // than a burst at midnight.
        createdAt: new Date(day.getTime() + Math.floor(rand() * MS_PER_DAY)),
      })

      if (rand() < entry.convert) {
        purchases.push({ entry, sessionId, day, at: new Date(day.getTime() + Math.floor(rand() * MS_PER_DAY)) })
      }
    }
  }

  // Chunked so a large range does not build one enormous statement.
  const CHUNK = 1000
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.visit.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true })
  }

  console.log(`Seeded ${rows.length} visits across ${days} days.`)
  return purchases
}

async function seedOrders(store, purchases) {
  const products = await prisma.product.findMany({
    where: { storeId: store.id, isPublished: true },
    select: { id: true, name: true, price: true },
    take: 20,
  })
  if (products.length === 0) {
    console.log("No published products — skipping demo orders.")
    return
  }

  const currency = (await prisma.store.findUnique({ where: { id: store.id }, select: { currency: true } }))
    ?.currency ?? "USD"

  let created = 0
  for (const purchase of purchases) {
    const product = products[Math.floor(Math.random() * products.length)]
    const quantity = Math.random() < 0.82 ? 1 : 2
    // Cents throughout, matching the app's money convention.
    const subtotal = Math.round(product.price * quantity * 100) / 100

    await prisma.order.create({
      data: {
        orderNumber: `${DEMO_ORDER_PREFIX}${token(4).toUpperCase()}`,
        storeId: store.id,
        buyerEmail: `demo+${token(4)}@urshop.test`,
        buyerName: "Demo Buyer",
        status: "PAID",
        currency,
        subtotal,
        total: subtotal,
        accessToken: token(24),
        visitSource: purchase.entry.source,
        visitMedium: purchase.entry.medium,
        visitCampaign: purchase.entry.campaign ?? null,
        visitSessionId: purchase.sessionId,
        paidAt: purchase.at,
        createdAt: purchase.at,
        notes: "Demo data — created by prisma/seed-analytics.mjs",
        items: {
          create: [{ productId: product.id, name: product.name, quantity, price: product.price }],
        },
      },
    })
    created++
  }

  console.log(`Seeded ${created} demo orders (order numbers prefixed ${DEMO_ORDER_PREFIX}).`)
}

async function main() {
  const store = await resolveStore()

  if (arg("reset") !== null) {
    await reset(store)
    return
  }

  const days = Math.min(366, Math.max(1, Number(arg("days")) || 120))
  const rand = makeRandom(Number(arg("seed")) || 20260830)

  console.log(`Seeding analytics demo data for "${store.name}" (${store.slug})…`)

  // Idempotent: clear anything a previous run left so counts do not compound.
  await reset(store)

  const purchases = await seedVisits(store, days, rand)

  if (arg("orders") !== null) {
    await seedOrders(store, purchases)
  } else {
    console.log(
      `Skipped demo orders (${purchases.length} simulated). Pass --orders to create them; ` +
        "without it, the traffic table shows real conversions only."
    )
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
