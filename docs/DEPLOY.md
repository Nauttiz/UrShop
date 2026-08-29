# Deploying to Vercel

The app runs on Vercel with a managed MySQL database and Vercel Blob for files.
Nothing in the code needs changing — the storage driver and the payment gateway
both pick themselves based on which environment variables exist.

## 1. Create a MySQL database

Vercel does not host MySQL, so this comes from elsewhere. Any provider works as
long as it accepts connections over the public internet with TLS. Free tiers
change often, so check current terms before committing:

- **TiDB Cloud Serverless** — MySQL-compatible, scales to zero, generous free tier
- **Aiven for MySQL** — has a free plan
- **Railway / PlanetScale** — both host MySQL; check whether a free tier still applies

Take the connection string and **append a connection limit**:

```
mysql://user:pass@host:3306/dbname?sslaccept=strict&connection_limit=1
```

`connection_limit=1` matters. Every serverless invocation opens its own pool, so
the default (derived from CPU count) multiplied by concurrent lambdas will
exhaust the database's connection cap under any real traffic.

Then apply the schema from your machine:

```bash
DATABASE_URL="<the connection string>" npx prisma migrate deploy
```

## 2. Create a Blob store

In the Vercel dashboard: **Storage → Create → Blob**, then connect it to the
project. Vercel injects `BLOB_READ_WRITE_TOKEN` automatically, and that variable
alone is what flips `src/lib/storage.ts` from local disk to Blob.

Paid product files are stored with `access: "private"` and streamed back through
`/api/download/[token]`, so the download limit and expiry stay enforced. Only
storefront images are stored publicly.

## 3. Set environment variables

In **Project Settings → Environment Variables**:

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | your MySQL URL | include `connection_limit=1` |
| `AUTH_SECRET` | `openssl rand -base64 32` | must NOT be the placeholder from `.env.local` |
| `AUTH_URL` | `https://<project>.vercel.app` | NextAuth callbacks break if this is wrong |
| `NEXTAUTH_URL` | same as `AUTH_URL` | |
| `APP_URL` | same as `AUTH_URL` | used in emails and payment redirects |
| `CRON_SECRET` | a long random string | required; the worker refuses to run in production without it |
| `BLOB_READ_WRITE_TOKEN` | *(set by Vercel)* | appears once the Blob store is connected |
| `RESEND_API_KEY` | optional | without it, emails only reach the server log |
| `EMAIL_FROM` | optional | needed with Resend |

### Payments — pick one deliberately

**Demo (recommended for a portfolio):** set `ALLOW_MOCK_PAYMENTS=true` and leave
Stripe unset. Visitors can complete a real order end to end — cart, checkout,
receipt, download — without a card.

**Real payments:** set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and make
sure `ALLOW_MOCK_PAYMENTS` is **absent**. With both configured, anyone could mark
an order paid for free through the mock endpoint.

For Stripe, add a webhook in the Stripe dashboard pointing at
`https://<project>.vercel.app/api/webhooks/stripe`, subscribed to
`checkout.session.completed`, `checkout.session.expired`,
`payment_intent.payment_failed` and `charge.refunded`.

## 4. Background jobs

`vercel.json` schedules `/api/jobs/run` every 5 minutes. Vercel Cron sends a GET
request and supplies `CRON_SECRET` as a bearer token itself, which is why the
route accepts both GET and POST behind the same authorisation check.

**The Hobby plan only allows one cron run per day.** At that cadence receipts and
download links would arrive up to 24 hours late. Two ways out:

- Upgrade to Pro, or
- Delete the `crons` block from `vercel.json` and point an external scheduler
  (cron-job.org, GitHub Actions) at the endpoint every few minutes:

  ```
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
    https://<project>.vercel.app/api/jobs/run
  ```

## 5. Deploy

```bash
npx vercel        # preview
npx vercel --prod # production
```

Or connect the GitHub repo in the Vercel dashboard and let it deploy on push.

## After the first deploy — check these

1. Register a seller account and create a store.
2. Upload a store logo. It should land on Blob (`https://….public.blob.vercel-storage.com/…`),
   not `/uploads/…`. A `/uploads/` URL means `BLOB_READ_WRITE_TOKEN` is missing.
3. Create a digital product, upload a file, publish it.
4. Buy it from the storefront and confirm the receipt page shows a download link
   that actually returns the file.
5. Trigger the worker manually once and confirm it returns a JSON summary rather
   than `401`.

## Known gaps in this setup

- Existing rows that reference `/uploads/…` were uploaded to local disk and will
  404 in production. Re-upload those images after deploying, or copy them to the
  Blob store and update the URLs.
- MySQL on serverless has no connection pooler in this setup. `connection_limit=1`
  keeps it stable at demo traffic; heavier use wants a proxy such as PlanetScale's
  HTTP driver or Prisma Accelerate.
- Downloads are proxied through the function, so large files consume function
  execution time. Fine for typical digital goods, not for multi-gigabyte assets.
