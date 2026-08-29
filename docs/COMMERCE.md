# Commerce engine

Everything from "buyer sees a product" to "seller gets their money and the buyer
gets their file". Before this existed the app had a catalogue and an admin UI,
but the Buy button did nothing — there was no cart, no checkout, no payment, no
delivery, and no email.

## The purchase pipeline

```
Storefront                  Server                          Provider
──────────                  ──────                          ────────
Add to cart      ──POST──▶  Cart + CartItem (cookie token)
                            PricingEngine.quote()
Apply coupon     ──POST──▶  PricingEngine.evaluateCoupon()
Checkout         ──POST──▶  createOrderFromCart()
                            └ re-reads products from the DB
                            └ Order(PENDING) + OrderItem snapshots
                            └ Payment(PENDING)
                                   │
                            gateway.createCheckout()  ──────▶ hosted page
                                                              │
                            ◀────── webhook ──────────────────┘
                            verifyWebhook() → signature + replay check
                            WebhookEvent insert = idempotency gate
                            markOrderPaid()
                            ├ Order → PAID, stock decremented
                            ├ coupon.usageCount++, customer stats
                            ├ issueDownloadsForOrder()
                            └ enqueue receipt / delivery / seller email
                                   │
Receipt page     ◀──────────  /store/{slug}/orders/{accessToken}
Download         ──GET───▶  /api/download/{token}
```

### Prices are never trusted from the client

The browser sends product ids and quantities. `PricingEngine` recomputes every
total from the database at checkout, so editing the cart payload changes nothing
about what is charged. All arithmetic runs in integer cents (`src/lib/money.ts`)
so percentage discounts and tax do not drift.

### Payment is idempotent

Providers retry webhooks. Two things stop a retry from charging twice as much
work: the unique `(provider, eventId)` index on `WebhookEvent` rejects the
duplicate before any handler runs, and `markOrderPaid` re-checks the order status
inside its transaction. A replayed webhook returns `applied: false` and no stock
is decremented twice, no second receipt is sent.

## Payment providers

`PaymentGateway` (`src/lib/payments/gateway.ts`) is the only thing the order
pipeline knows about. Adding PayPal means one subclass plus one line in the
registry.

| Gateway | When it is used | Notes |
| --- | --- | --- |
| `StripeGateway` | `STRIPE_SECRET_KEY` is set | Raw REST, no SDK dependency. Supports Stripe Connect via `Store.stripeAccountId`. |
| `MockGateway` | Nothing else is configured | Redirects to `/pay/mock`, an in-app stand-in for the hosted form. Refuses to run in production unless `ALLOW_MOCK_PAYMENTS=true`. |

Webhook signatures are verified with a constant-time compare and a 5-minute
timestamp window.

**Local Stripe testing:**

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the whsec_… it prints into STRIPE_WEBHOOK_SECRET
```

## Digital delivery

Product files never sit anywhere a URL alone can reach. On disk that means
`storage/products`, deliberately **outside `public/`** — anything under
`public/` is served by the static handler, so a paid file placed there could be
downloaded by anyone who guessed the URL. On Vercel it means `access: "private"`
blobs, which are proxied back through our own route rather than redirected to,
so the download budget still applies to every request.

A paid order gets one `Download` row per file, each with an unguessable token, a
download budget and an expiry. `/api/download/{token}` claims a use with a
conditional `UPDATE` before streaming a byte, so two concurrent requests on the
last remaining use cannot both succeed.

Limits come from the product first, then the store's settings:

| Setting | Product field | Store default |
| --- | --- | --- |
| Downloads per file | `downloadLimit` | `settings.downloadLimit` (5) |
| Link lifetime | `downloadExpiryHours` | `settings.downloadExpiryHours` (30 days) |

Refunding an order stamps every download `expiresAt = now`, which cuts off
access without destroying the audit trail.

## Background jobs

`Job` is a durable DB-backed queue standing in for Redis/SQS on a single node.
Claiming is a conditional `UPDATE` on `status: PENDING`, so competing workers
cannot double-process a job. Failures retry with quadratic backoff (1min, 4min,
9min…) up to `maxAttempts`, then park as `FAILED` with the last error.

| Job | Fired by | Does |
| --- | --- | --- |
| `send_receipt` | payment | Emails the buyer their receipt |
| `send_delivery` | payment | Emails download links (skips physical-only orders) |
| `notify_seller` | payment | Emails the seller |
| `send_refund_email` | refund | Tells the buyer money is coming back |
| `scan_abandoned_carts` | worker tick | Finds quiet carts, queues one reminder each |
| `send_abandoned_cart` | the scan | Emails a recovery link |

Run the worker on a timer:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/jobs/run
```

`CRON_SECRET` is required in production — an open worker endpoint lets anyone
drain the queue or force reminder emails. Add `?scan=0` to skip the abandoned
cart sweep, `?limit=N` to change the batch size.

## Email

`Mailer` picks a driver at runtime: `ResendMailer` when `RESEND_API_KEY` is set,
otherwise `ConsoleMailer`, which prints to the server log. Every send is recorded
in `EmailLog` either way, so failures are visible without a provider dashboard.

`Mailer.send` never throws. A receipt that fails to send must not roll back a
payment that succeeded.

## Store settings

`Store.settings` is a JSON column parsed through `parseStoreSettings`, which
fills in every default — existing stores with a `NULL` column keep working.

| Setting | Default | Effect |
| --- | --- | --- |
| `taxRate` | 0 | Percentage applied to the discounted subtotal |
| `flatShipping` | 0 | Charged once when the cart has a physical item |
| `freeShippingOver` | `null` | Waives shipping above this subtotal |
| `downloadLimit` | 5 | Downloads per purchased file |
| `downloadExpiryHours` | 720 | Link lifetime |
| `abandonedCartHours` | 4 | Idle time before a reminder |
| `sendReceiptEmail` | true | Buyer receipt on payment |
| `notifySellerOnOrder` | true | Seller notification on payment |

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | MySQL connection |
| `AUTH_SECRET` | yes | NextAuth signing key |
| `APP_URL` | recommended | Absolute origin for emails and payment redirects |
| `STRIPE_SECRET_KEY` | for real payments | Enables `StripeGateway` |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Verifies inbound webhooks |
| `ALLOW_MOCK_PAYMENTS` | dev only | Keeps the test gateway alive under `next start` |
| `RESEND_API_KEY` | for real email | Otherwise emails print to the log |
| `EMAIL_FROM` | with Resend | Sender address |
| `CRON_SECRET` | in production | Authorises `/api/jobs/run` (GET and POST) |
| `BLOB_READ_WRITE_TOKEN` | on Vercel | Switches file storage from local disk to Vercel Blob |
| `PRIVATE_UPLOAD_DIR` | no | Overrides `storage/products` |

## Known limits

- Money is stored in `Float` columns inherited from the original schema.
  Calculations are done in integer cents, but the columns themselves should
  become `Decimal(10,2)` before this handles serious volume.
- Storage has two drivers behind `src/lib/storage.ts`: local disk in
  development, Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set. Adding S3 means
  one more class implementing the same interface. Download keys carry their own
  prefix (`private:` vs `blob:`), so files uploaded before a switch keep working
  after it.
- `ProductType.SUBSCRIPTION` charges once at checkout. Recurring billing needs
  Stripe Subscriptions and a `subscription.*` webhook branch.
- The job worker is pull-based. It needs an external timer (cron, Vercel Cron, a
  GitHub Action) — nothing runs it automatically.
