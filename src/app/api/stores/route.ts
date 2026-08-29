import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { parseStoreSettings } from "@/lib/store-settings"
import { storeSchema, storeSettingsSchema } from "@/lib/validations"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const store = await prisma.store.findUnique({ where: { userId: session.user.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  // Hand back fully-defaulted settings so the form never renders undefined fields.
  return NextResponse.json({ ...store, settings: parseStoreSettings(store.settings) })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()

  // Theme and commerce settings are JSON columns with their own shapes; the
  // rest goes through the flat store schema.
  const { themeConfig, settings, currency, contactEmail, logoUrl, ...rest } = body
  const parsed = storeSchema.partial().safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.slug) {
    const existing = await prisma.store.findFirst({
      where: { slug: parsed.data.slug, NOT: { userId: session.user.id } },
    })
    if (existing) return NextResponse.json({ error: "Slug already taken" }, { status: 409 })
  }

  let parsedSettings
  if (settings !== undefined) {
    const result = storeSettingsSchema.safeParse(settings)
    if (!result.success) {
      return NextResponse.json({ error: result.error.flatten() }, { status: 400 })
    }
    parsedSettings = result.data
  }

  if (currency !== undefined && !/^[A-Z]{3}$/.test(String(currency))) {
    return NextResponse.json({ error: "Currency must be a 3-letter code like USD" }, { status: 400 })
  }

  const store = await prisma.store.update({
    where: { userId: session.user.id },
    data: {
      ...parsed.data,
      ...(themeConfig ? { themeConfig } : {}),
      ...(parsedSettings ? { settings: parsedSettings } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(contactEmail !== undefined ? { contactEmail: contactEmail || null } : {}),
      ...(logoUrl !== undefined ? { logoUrl: logoUrl || null } : {}),
    },
  })

  return NextResponse.json({ ...store, settings: parseStoreSettings(store.settings) })
}
