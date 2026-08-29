import { formatMoney } from "@/lib/money"

type Line = { name: string; quantity: number; price: number }

export type ReceiptData = {
  storeName: string
  orderNumber: string
  buyerName: string | null
  currency: string
  lines: Line[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  shippingTotal: number
  total: number
  receiptUrl: string
  downloadUrl: string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb"><tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:700">${escapeHtml(title)}</h1>
${body}
</td></tr></table></body></html>`
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(label)}</a>`
}

function lineRows(lines: Line[], currency: string): string {
  return lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;font-size:14px">${escapeHtml(l.name)} × ${l.quantity}</td>
         <td style="padding:6px 0;font-size:14px;text-align:right">${formatMoney(l.price * l.quantity, currency)}</td></tr>`
    )
    .join("")
}

function totalRow(label: string, amount: number, currency: string, bold = false): string {
  const weight = bold ? "700" : "400"
  return `<tr><td style="padding:4px 0;font-size:14px;font-weight:${weight}">${escapeHtml(label)}</td>
  <td style="padding:4px 0;font-size:14px;text-align:right;font-weight:${weight}">${formatMoney(amount, currency)}</td></tr>`
}

export function receiptEmail(data: ReceiptData) {
  const greeting = data.buyerName ? `Hi ${data.buyerName},` : "Hi,"
  const html = shell(
    `Your ${data.storeName} receipt`,
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">${escapeHtml(greeting)} thanks for your purchase. Order <strong>${escapeHtml(data.orderNumber)}</strong> is confirmed.</p>
     <table role="presentation" width="100%" style="border-collapse:collapse">
       ${lineRows(data.lines, data.currency)}
       <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px"></td></tr>
       ${totalRow("Subtotal", data.subtotal, data.currency)}
       ${data.discountTotal > 0 ? totalRow("Discount", -data.discountTotal, data.currency) : ""}
       ${data.shippingTotal > 0 ? totalRow("Shipping", data.shippingTotal, data.currency) : ""}
       ${data.taxTotal > 0 ? totalRow("Tax", data.taxTotal, data.currency) : ""}
       ${totalRow("Total", data.total, data.currency, true)}
     </table>
     <p style="margin:24px 0 0">${button(data.downloadUrl ?? data.receiptUrl, data.downloadUrl ? "Download your files" : "View your receipt")}</p>`
  )

  const text = [
    `${greeting} thanks for your purchase.`,
    `Order ${data.orderNumber} at ${data.storeName} is confirmed.`,
    "",
    ...data.lines.map((l) => `  ${l.name} x${l.quantity}  ${formatMoney(l.price * l.quantity, data.currency)}`),
    "",
    `  Subtotal: ${formatMoney(data.subtotal, data.currency)}`,
    data.discountTotal > 0 ? `  Discount: -${formatMoney(data.discountTotal, data.currency)}` : "",
    data.shippingTotal > 0 ? `  Shipping: ${formatMoney(data.shippingTotal, data.currency)}` : "",
    data.taxTotal > 0 ? `  Tax: ${formatMoney(data.taxTotal, data.currency)}` : "",
    `  Total: ${formatMoney(data.total, data.currency)}`,
    "",
    data.downloadUrl ? `Download your files: ${data.downloadUrl}` : `View your receipt: ${data.receiptUrl}`,
  ]
    .filter(Boolean)
    .join("\n")

  return { subject: `Your ${data.storeName} order ${data.orderNumber}`, html, text }
}

export type DeliveryData = {
  storeName: string
  orderNumber: string
  downloadUrl: string
  files: { name: string }[]
  expiresAt: Date | null
  maxDownloads: number | null
}

export function deliveryEmail(data: DeliveryData) {
  const expiryNote = data.expiresAt
    ? `The link expires on ${data.expiresAt.toUTCString()}.`
    : "The link does not expire."
  const limitNote = data.maxDownloads ? ` Each file can be downloaded ${data.maxDownloads} times.` : ""

  const html = shell(
    "Your files are ready",
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Your download for order <strong>${escapeHtml(data.orderNumber)}</strong> from ${escapeHtml(data.storeName)} is ready.</p>
     <ul style="font-size:14px;line-height:1.8;padding-left:18px;margin:0 0 20px">
       ${data.files.map((f) => `<li>${escapeHtml(f.name)}</li>`).join("")}
     </ul>
     <p style="margin:0 0 16px">${button(data.downloadUrl, "Download files")}</p>
     <p style="font-size:12px;color:#6b7280;margin:0">${escapeHtml(expiryNote + limitNote)}</p>`
  )

  const text = [
    `Your download for order ${data.orderNumber} from ${data.storeName} is ready.`,
    "",
    ...data.files.map((f) => `  - ${f.name}`),
    "",
    data.downloadUrl,
    "",
    expiryNote + limitNote,
  ].join("\n")

  return { subject: `Your files from ${data.storeName}`, html, text }
}

export type AbandonedCartData = {
  storeName: string
  checkoutUrl: string
  currency: string
  lines: Line[]
  total: number
}

export function abandonedCartEmail(data: AbandonedCartData) {
  const html = shell(
    "You left something behind",
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Your cart at ${escapeHtml(data.storeName)} is still waiting. Pick up where you left off:</p>
     <table role="presentation" width="100%" style="border-collapse:collapse">
       ${lineRows(data.lines, data.currency)}
       <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px"></td></tr>
       ${totalRow("Total", data.total, data.currency, true)}
     </table>
     <p style="margin:24px 0 0">${button(data.checkoutUrl, "Complete your order")}</p>`
  )

  const text = [
    `Your cart at ${data.storeName} is still waiting.`,
    "",
    ...data.lines.map((l) => `  ${l.name} x${l.quantity}  ${formatMoney(l.price * l.quantity, data.currency)}`),
    "",
    `  Total: ${formatMoney(data.total, data.currency)}`,
    "",
    `Complete your order: ${data.checkoutUrl}`,
  ].join("\n")

  return { subject: `You left items in your ${data.storeName} cart`, html, text }
}

export type SellerNotificationData = {
  storeName: string
  orderNumber: string
  buyerEmail: string
  currency: string
  total: number
  dashboardUrl: string
}

export function sellerNotificationEmail(data: SellerNotificationData) {
  const html = shell(
    `New order — ${formatMoney(data.total, data.currency)}`,
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">You received order <strong>${escapeHtml(data.orderNumber)}</strong> from ${escapeHtml(data.buyerEmail)} on ${escapeHtml(data.storeName)}.</p>
     <p style="margin:20px 0 0">${button(data.dashboardUrl, "Open in dashboard")}</p>`
  )
  const text = `New order ${data.orderNumber} for ${formatMoney(data.total, data.currency)} from ${data.buyerEmail}.\n\n${data.dashboardUrl}`
  return { subject: `New order ${data.orderNumber} — ${formatMoney(data.total, data.currency)}`, html, text }
}

export type RefundData = {
  storeName: string
  orderNumber: string
  currency: string
  amount: number
}

export function refundEmail(data: RefundData) {
  const html = shell(
    "Your refund is on the way",
    `<p style="font-size:14px;line-height:1.6;margin:0">We refunded ${formatMoney(data.amount, data.currency)} for order <strong>${escapeHtml(data.orderNumber)}</strong> at ${escapeHtml(data.storeName)}. It can take 5–10 business days to appear on your statement.</p>`
  )
  const text = `We refunded ${formatMoney(data.amount, data.currency)} for order ${data.orderNumber} at ${data.storeName}. It can take 5-10 business days to appear on your statement.`
  return { subject: `Refund issued for order ${data.orderNumber}`, html, text }
}
