# Analytics

How UrShop counts store visits, attributes sales to traffic sources, and renders
both on the dashboard.

## What is measured

| Metric | Source | Meaning |
| --- | --- | --- |
| Store visits | `Visit` rows | One row per **session**, not per page view |
| Purchases | `Order` rows with status `PAID` or `FULFILLED` | A refund removes it from both count and revenue |
| Conversion | purchases ÷ visits | `null` (rendered `—`) when there were no visits |
| Revenue | `SUM(Order.total)` over the same statuses | In the store's currency |

## Recording a visit

`src/components/storefront/visit-tracker.tsx` is a `null`-rendering client
component mounted in the storefront layout. On every pathname change it fires

```
POST /api/store/[storeSlug]/visit   { path, referrer }
```

with `keepalive: true`, and a `sessionStorage` guard skips the request entirely
within 25 minutes — so a typical browsing session makes **one** network call.

The route always answers `204`, including when it throws. Analytics must never
surface an error to a buyer, and nothing in the render tree awaits it.

### Why a beacon, and not middleware or a server component

- **Middleware** runs on the Edge runtime, and `src/lib/prisma.ts` is a bare
  `PrismaClient` with no driver adapter — it physically cannot write there. It
  also fires on RSC prefetches, so a catalogue page with 12 product cards would
  log 12 phantom visits.
- **A server component in the layout** does not re-run on soft navigation, cannot
  write cookies, and would be frozen at build time under static rendering. That
  last failure is exactly why the older `Product.viewCount` counter is
  untrustworthy.

### Grain: one row per session

This is the load-bearing performance decision. The beacon may fire on every
navigation, but the route returns `204` with **zero database queries** when a
valid `sf_sid` cookie is present. A twelve-page session writes one row.

`@@unique([storeId, sessionId])` turns the insert into an `INSERT IGNORE` via
`createMany({ skipDuplicates: true })`, which absorbs React StrictMode's
double-effect in development and two tabs racing in production without a
try/catch.

### Cookies

| Cookie | Lifetime | Purpose |
| --- | --- | --- |
| `sf_sid` | 30 min, rolling | Session id — the dedupe key |
| `sf_vid` | 1 year | Visitor id, kept for a future unique-visitor metric |
| `sf_attr` | 30 days | Last non-direct traffic source, read at checkout |

All three follow the `sf_cart` conventions in `src/lib/domain/cart.ts`:
`httpOnly`, `sameSite: lax`, `secure` in production.

### Bot and prefetch filtering

Layered, cheapest first:

1. Crawlers that do not execute JavaScript never fire the beacon at all.
2. The client skips when `navigator.webdriver` is set, when the document is
   prerendering, or when the tab is hidden.
3. The server skips on `Sec-Purpose: prefetch` (and the older `Purpose`,
   `X-Moz`, `Next-Router-Prefetch` headers), and on a user-agent denylist.

## Attribution: last non-direct touch

First-touch over-credits whatever discovered the buyer months ago. Pure
last-touch credits `direct` for anyone who bookmarks the shop, which makes every
paid channel look broken. Last non-direct touch answers the question a merchant
actually asks — *which link earned this sale* — and it is decided once, at visit
time, rather than reconstructed at query time.

The `sf_attr` write rule:

```
non-direct medium, and not a self-referral  → overwrite
no cookie yet                               → write, source "direct"
otherwise                                   → leave alone
```

The cookie carries the **store id**, because it is `path: "/"` on a host serving
many stores under `/store/:slug`. Without it, browsing store A via Google and
then buying from store B directly would credit Google in store B's dashboard.
It is validated on read (shape-checked, clamped, re-sanitised) rather than
signed: the value lands in a `GROUP BY` key and on the seller's screen, so
sanitising is the real defence.

Attribution is stamped in `createOrderFromCart`, not `markOrderPaid` — the
cookie only exists in the buyer's request, and `markOrderPaid` runs from a
Stripe webhook with no browser attached. It is a pure cookie read with no extra
queries, so the payment path gains no new failure mode.

### Source precedence

`src/lib/analytics/source.ts` resolves, in order:

1. `utm_source` / `utm_medium` / `utm_campaign` — explicit tagging always wins.
2. Ad-network click ids: `gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`, `ttclid`.
3. Referrer host — self-referral collapses to `direct`; known search engines map
   to `organic`, social networks to `social`, webmail to `email`, everything else
   to `referral`.
4. No referrer at all → `direct`.

Subdomains that front the same site (`l.`, `m.`, `www.`, `amp.`) are stripped so
`l.facebook.com` and `www.facebook.com` group together. This is deliberately not
full public-suffix parsing — that needs a ~30 kB dataset to tell `foo.co.uk`
from `co.uk`, and the only cost of skipping it is that unrelated subdomains of
one site appear as separate rows.

## Days and timezones

Everything is bucketed by **day key** — the `YYYY-MM-DD` string for a calendar
day *in the store's timezone*, set under Store Settings → Commerce → Analytics
(`StoreSettings.timezone`, default `UTC`).

The day is computed **when the visit is written** and stored as a `DATE` column.
Converting at read time instead would need `CONVERT_TZ()` or a per-row JS pass,
and either one throws away the index that makes the query fast.

`Intl.DateTimeFormat("en-CA")` formats as `YYYY-MM-DD`, which is exactly the
DATE literal needed — so day handling has zero dependencies. The same helper
buckets `Order.createdAt`, so both series land on identical day keys; otherwise
the two panels of the Sales & traffic chart would be silently offset by hours.

> **Known limitation.** Changing the timezone does not rewrite history. Old rows
> keep the day they were recorded in, so a store that switches zones has a seam
> in its data. Recomputing on read would cost the index.

## Range selection

The range lives entirely in `searchParams`, so it is shareable, bookmarkable and
correct under the back button — the same convention `dashboard/orders` uses for
`?status=`.

```
?range=7|30|90|365              preset
?from=2026-08-01&to=2026-08-30  custom, inclusive
```

`from`/`to` win when both parse; otherwise `range`; otherwise 30 days. Parsing is
total and never throws:

| Input | Result |
| --- | --- |
| unknown preset (`?range=999`) | 30 days |
| unparseable date (`?from=banana`) | 30 days |
| inverted (`from` after `to`) | swapped |
| `to` in the future | clamped to today |
| entirely in the future | 30 days |
| longer than 366 days | clamped to the last 366 |

## Queries

All of them live in `src/lib/analytics/queries.ts`, and every `where` carries an
explicit `storeId` — the tenancy convention used throughout the codebase. The id
always comes from the authenticated session, never from the URL.

| Function | Shape |
| --- | --- |
| `dailyVisits` | `visit.groupBy({ by: ["day"] })` — index-only |
| `visitsBySource` | raw SQL with `FORCE INDEX`, see below |
| `ordersInRange` | `order.findMany` bucketed in JS; also yields the stat-card totals |
| `trafficSources` | joins the two source aggregates in JS over the *union* of their keys |
| `firstVisitDay` | one index seek |

### Indexes

Exactly two on `Visit`, each earning its write cost:

- `@@unique([storeId, sessionId])` — an idempotency mechanism, not a query index.
- `@@index([storeId, day, source])` — equality on `storeId`, range on `day`,
  and `GROUP BY day` satisfied by the index's own ordering. Column order matters:
  with `source` second, the date range could not be an index range and MySQL
  would scan the store's entire history.

No new index on `Order`. The existing `@@index([storeId, status, createdAt])`
already covers the source query's three predicates with the range correctly
last; adding one would slow every checkout to speed up a query that is already
trivial.

### Why one query is raw SQL

`prisma.visit.groupBy({ by: ["source"] })` is the natural expression, but MySQL
costs the two `storeId`-prefixed indexes as a tie and picks the **unique** one —
which contains neither `day` nor `source`, so every candidate row is read from
the table. Measured on this schema at 185k visits over a 273-day range:

| Plan | `EXPLAIN` Extra | Time |
| --- | --- | --- |
| optimiser's choice | `Using where; Using temporary; Using filesort` | 451 ms |
| covering index pinned | `Using where; Using index; Using temporary; Using filesort` | 138 ms |

Both need a temp table — grouping by `source` cannot be satisfied by an index
ordered `day, source` — but that sort runs over the handful of grouped rows, not
the scan. Prisma has no index-hint API, so `visitsBySource` is raw. **The
identifiers are Prisma's default table/column mapping; a future `@@map` on
`Visit` must be mirrored there.**

`dailyVisits` needs no such help: `EXPLAIN` reports `Using where; Using index`
and 273 days over 185k visits returned in 75 ms.

### Why orders are bucketed in JS, not SQL

The asymmetry with visits is deliberate. Visits are unbounded per store, so they
must be aggregated in SQL. Orders are bounded by actual sales — a busy store
yields a few thousand two-column rows across a whole year, which costs
single-digit milliseconds to fold, and the same pass also produces the revenue
and purchase totals, so it *replaces* two aggregate queries rather than adding
one.

Adding an `Order.day` column to match would duplicate `createdAt`, need a
backfill, and could drift out of sync. If a store ever crosses ~100k orders in a
single range, add `Order.day @db.Date` plus `@@index([storeId, status, day])`
and swap that one function's body for a `groupBy` — its signature and callers
stay identical.

## Charts

Hand-rolled, in `src/components/charts/`. Recharts would add ~100 kB gzip — more
JavaScript than the rest of the dashboard combined — and is client-only, so
every chart would be an empty box until the bundle lands.

`ChartHoverLayer` is the **only** client component in the set. The chart itself
is a server component passed to it as `children`, so it paints with the first
byte and stays completely readable if that ~2 kB of JavaScript never arrives.
Arrow keys move the cursor and a visually-hidden `<table>` gives screen readers
the real numbers.

### Layout: HTML chrome, SVG plot

A server component cannot measure its container, so a plain `<svg viewBox>` has
to choose between letterboxing the chart into a strip in the middle of a wide
card, or scaling the axis labels up along with the geometry. Neither is
acceptable.

So nothing that must keep its size lives inside a scaled coordinate system.
Gridlines, tick labels and bars are absolutely-positioned HTML at percentage
offsets, with type fixed at 11px. Only the area variant needs a real path, and
that SVG is stretched with `preserveAspectRatio="none"` — it contains no text and
no corner radii, and its stroke carries `vector-effect="non-scaling-stroke"` so
the line stays 2px at any width.

### Rules the charts follow

- **Never two y-axes.** Visits and revenue have unrelated units; a second axis
  would let the two series be slid past each other at will, and the crossing
  point would be an artefact of the scales rather than the data. They are two
  stacked panels over one shared set of dates.
- **`null` is not zero.** Days before tracking existed contribute no vertex, so
  the visits line starts where tracking did instead of climbing out of a
  fictional zero — with a "Tracking started …" note in the panel header.
- **No all-zero chart.** When every value is zero the panel says so in words.
- **Categorical colours in fixed order, never cycled.** A ninth source is never
  given a generated hue; it joins "Other".
- **Conversion is `null`, not a division by zero.** A buyer whose session began
  before the window contributes a purchase with no matching visit, so a naive
  ratio could read 900%.

`--chart-1..5` and `--chart-other` are defined for light and dark in
`src/app/globals.css`. Both palettes pass a colour-vision-deficiency separation
check; in light mode three of the five fall below 3:1 against the surface, which
is why every slice is directly labelled and the table beside the donut carries
the real numbers.

## Retention

The `prune_visits` job deletes rows older than **400 days** — a full year of
history plus the year-on-year comparison, which is the longest window the
dashboard can request.

It runs in batches of 5,000 with a cap of 20 batches per tick: one unbounded
`DELETE` over a year of rows would hold locks for the whole statement and blow
the serverless time budget. Whatever is left is removed on the next tick, so the
sweep is self-healing rather than all-or-nothing.

`/api/jobs/run` enqueues it at most once every 12 hours, so a worker ticking
every few minutes does not bury the real work under no-op jobs.

`Visit` is the only table in the schema that grows with *traffic* rather than
with sales, which is why it is the only one with a retention policy.

## Known limitations

- **Cookie-blocked and JavaScript-disabled visitors are invisible**, so counts
  under-report against server logs. They under-report *self-consistently*
  though: such a buyer produces neither a visit nor an attributed purchase, so
  conversion stays sane.
- **Unattributed orders** appear as an explicit greyed `(unattributed)` row.
  Without it the source table's revenue would silently fail to add up to the
  Revenue stat card, and the seller would conclude the panel is broken.
- **The beacon can be spoofed.** Anyone can POST to inflate counts. This is
  read-only vanity data, bounded by the per-session unique constraint and the
  bot filter, and is not worth over-investing in.
- **Changing the store timezone leaves a seam** in historical data (see above).
- **`Product.viewCount` is still wrong** and still read by the storefront's
  `?sort=popular`. It counts bots and prefetches and has no time or source
  dimension. Deprecate it once `Visit.landingPath` can back a real per-product
  metric.

## Demo data

```bash
node prisma/seed-analytics.mjs                 # 120 days of visits
node prisma/seed-analytics.mjs --days=90
node prisma/seed-analytics.mjs --orders        # also create demo orders
node prisma/seed-analytics.mjs --reset         # remove all demo data
node prisma/seed-analytics.mjs --store=<slug>  # pick a store explicitly
```

Everything it writes is reversible: visits carry a `demo` session prefix and
orders a `DEMO-` order number, so `--reset` removes exactly what the script
created and never touches real data. It re-runs `--reset` before seeding, so
counts do not compound.

The generator is a seeded PRNG (`--seed=`), so the same seed reproduces the same
dashboard — debugging a chart against data that changes every run is needlessly
hard.

> Demo orders are inserted directly and do **not** decrement stock or fire
> emails. They exist to fill charts, not to exercise the checkout path.
