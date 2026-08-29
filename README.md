# UrShop

A multi-tenant e-commerce SaaS: sellers sign up, get their own storefront at
`/store/{slug}`, and sell digital downloads, physical goods or subscriptions.

## Getting started

```bash
npm install
npx prisma migrate deploy      # apply the schema to MySQL
npx prisma generate
npm run dev                    # http://localhost:3000
```

The dev and start scripts pin port 3000 on purpose. `AUTH_URL`, `NEXTAUTH_URL`
and `APP_URL` in `.env.local` are absolute, so an app that silently moved to
3001 would generate auth callbacks and payment redirects pointing at the wrong
origin. Failing loudly on a busy port beats debugging that later.

Copy `.env.local` and fill in what you need — every variable is documented in
[docs/COMMERCE.md](docs/COMMERCE.md#environment-variables). With no payment or
email keys set the app still runs end to end: checkout uses a built-in test
gateway and emails print to the server log.

## Layout

```
src/
  app/
    (auth)/          login, register
    (dashboard)/     seller admin: products, orders, customers, coupons, analytics, settings
    (storefront)/    buyer-facing: catalogue, product, cart, checkout, receipt
    api/             route handlers
    pay/mock/        stand-in payment page used when no provider is configured
  components/
    dashboard/       seller-side widgets
    storefront/      buyer-side widgets
    payments/        payment-provider UI
    shared/ ui/      cross-cutting and shadcn primitives
  lib/
    domain/          cart, pricing, orders, delivery — the business rules
    payments/        PaymentGateway abstraction + Stripe and mock drivers
    email/           Mailer abstraction + templates
    jobs/            DB-backed queue and its handlers
prisma/              schema and migrations
docs/                architecture notes
```

Business rules live in `src/lib/domain` and never import from `app/`. Route
handlers are thin: they authenticate, validate with a zod schema from
`src/lib/validations.ts`, call a domain function, and shape the response.

## Background worker

Emails and abandoned-cart reminders run through a queue that needs an external
timer:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/run
```

## Documentation

- [docs/COMMERCE.md](docs/COMMERCE.md) — the purchase pipeline, payment
  gateways, digital delivery, jobs, email, settings, and known limits.
