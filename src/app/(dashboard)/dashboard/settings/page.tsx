"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { storeSchema, type StoreInput } from "@/lib/validations"
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/store-settings"
import { DEFAULT_THEME, type ThemeConfig } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageUpload } from "@/components/shared/image-upload"
import { toast } from "sonner"

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "JPY", "VND"]

/** Empty inputs must become null, not 0 — 0 means "free shipping on everything". */
function nullableNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * The zones this runtime knows, with the store's current one guaranteed present.
 *
 * `Intl.supportedValuesOf` is the browser's own list, so it needs no bundled
 * dataset and cannot drift from what day bucketing will actually accept. Older
 * engines lack it, hence the short fallback — and the saved value is prepended
 * either way so an unlisted zone is never silently reset on the next save.
 */
function timeZoneOptions(current: string): string[] {
  let zones: string[] = FALLBACK_TIME_ZONES
  try {
    const supported = Intl.supportedValuesOf?.("timeZone")
    if (supported && supported.length > 0) zones = supported
  } catch {
    // Keep the fallback.
  }
  // "UTC" is the app's default and is always offered, because some engines list
  // only "Etc/UTC" — without this, a seller who switches away from UTC could
  // never pick it again. The saved value is pinned for the same reason: an
  // engine that does not list it must not silently reset it on the next save.
  const pinned = ["UTC", current].filter((zone, i, all) => all.indexOf(zone) === i && !zones.includes(zone))
  return pinned.length > 0 ? [...pinned, ...zones] : zones
}

const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
]

export default function StoreSettingsPage() {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME)
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS)
  const [logoUrl, setLogoUrl] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [contactEmail, setContactEmail] = useState("")
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<StoreInput>({
    resolver: zodResolver(storeSchema),
  })

  useEffect(() => {
    fetch("/api/stores")
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) return
        reset({ name: data.name, slug: data.slug, description: data.description ?? "" })
        if (data.themeConfig) setTheme({ ...DEFAULT_THEME, ...data.themeConfig })
        if (data.settings) setSettings({ ...DEFAULT_STORE_SETTINGS, ...data.settings })
        setLogoUrl(data.logoUrl ?? "")
        setCurrency(data.currency ?? "USD")
        setContactEmail(data.contactEmail ?? "")
      })
  }, [reset])

  async function onSubmit(data: StoreInput) {
    setSaving(true)
    const res = await fetch("/api/stores", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        logoUrl: logoUrl || null,
        themeConfig: theme,
        settings,
        currency,
        contactEmail: contactEmail || null,
      }),
    })
    setSaving(false)

    if (res.ok) {
      toast.success("Settings saved")
      return
    }
    const json = await res.json().catch(() => null)
    const fieldErrors = json?.error?.fieldErrors as Record<string, string[]> | undefined
    toast.error(
      fieldErrors
        ? Object.values(fieldErrors).flat().join(", ")
        : (json?.error ?? "Could not save settings")
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Store settings</h1>
        <p className="text-muted-foreground">Manage your store details, look and commerce rules</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="commerce">Commerce</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ImageUpload label="Store logo" value={logoUrl} onChange={setLogoUrl} />

                <div className="space-y-2">
                  <Label htmlFor="name">Store name</Label>
                  <Input id="name" {...register("name")} />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Store URL</Label>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      {typeof window !== "undefined" ? window.location.host : ""}/store/
                    </span>
                    <Input id="slug" {...register("slug")} className="flex-1" />
                  </div>
                  {errors.slug && <p className="text-xs text-red-500">{errors.slug.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={3} placeholder="Tell buyers about your store..." {...register("description")} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Support email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="support@yourstore.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown on receipts and used as the reply-to on buyer emails
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Customize your store&apos;s look and feel</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {(["primaryColor", "accentColor"] as const).map((key) => (
                    <div key={key} className="space-y-2">
                      <Label>{key === "primaryColor" ? "Primary colour" : "Accent colour"}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={theme[key]}
                          onChange={(e) => setTheme((t) => ({ ...t, [key]: e.target.value }))}
                          className="h-9 w-16 cursor-pointer rounded border"
                        />
                        <span className="text-sm text-muted-foreground">{theme[key]}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Catalogue layout</Label>
                  <div className="flex gap-3">
                    {(["grid", "list"] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setTheme((t) => ({ ...t, layout: l }))}
                        className={`rounded border px-4 py-2 text-sm font-medium transition-colors ${
                          theme.layout === l
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {l.charAt(0).toUpperCase() + l.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commerce" className="mt-4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Currency &amp; tax</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Applies to new orders. Existing orders keep the currency they were placed in.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="taxRate">Tax rate (%)</Label>
                  <Input
                    id="taxRate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={settings.taxRate}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, taxRate: Number(e.target.value) || 0 }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">Applied to the discounted subtotal</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Shipping</CardTitle>
                <CardDescription>Charged once when a cart contains a physical product</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="flatShipping">Flat rate</Label>
                  <Input
                    id="flatShipping"
                    type="number"
                    step="0.01"
                    min="0"
                    value={settings.flatShipping}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, flatShipping: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="freeShippingOver">Free over</Label>
                  <Input
                    id="freeShippingOver"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Never"
                    value={settings.freeShippingOver ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, freeShippingOver: nullableNumber(e.target.value) }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Digital delivery</CardTitle>
                <CardDescription>Defaults for products that do not set their own</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="downloadLimit">Downloads per file</Label>
                  <Input
                    id="downloadLimit"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    value={settings.downloadLimit ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, downloadLimit: nullableNumber(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="downloadExpiryHours">Link valid for (hours)</Label>
                  <Input
                    id="downloadExpiryHours"
                    type="number"
                    min="1"
                    placeholder="Never expires"
                    value={settings.downloadExpiryHours ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        downloadExpiryHours: nullableNumber(e.target.value),
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Emails &amp; recovery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="abandonedCartHours">Abandoned cart reminder after (hours)</Label>
                  <Input
                    id="abandonedCartHours"
                    type="number"
                    min="1"
                    max="168"
                    value={settings.abandonedCartHours}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        abandonedCartHours: Number(e.target.value) || 4,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    One reminder per cart, sent only when the buyer left an email
                  </p>
                </div>

                <Separator />

                <ToggleRow
                  label="Send buyers a receipt"
                  description="Emailed automatically once payment clears"
                  checked={settings.sendReceiptEmail}
                  onChange={(v) => setSettings((s) => ({ ...s, sendReceiptEmail: v }))}
                />
                <ToggleRow
                  label="Notify me of new orders"
                  description="Sent to your support email, or your account email"
                  checked={settings.notifySellerOnOrder}
                  onChange={(v) => setSettings((s) => ({ ...s, notifySellerOnOrder: v }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Analytics</CardTitle>
                <CardDescription>
                  How the dashboard splits your traffic and sales into calendar days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Reporting timezone</Label>
                  <select
                    id="timezone"
                    value={settings.timezone}
                    onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {timeZoneOptions(settings.timezone).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Applied when a visit is recorded, so changing it affects new data only —
                    existing days are not re-bucketed.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
