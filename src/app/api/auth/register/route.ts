import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { registerSchema } from "@/lib/validations"
import { DEFAULT_THEME } from "@/types"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { email, name, password } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    // Generate unique slug from name
    const baseSlug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    let slug = baseSlug
    let counter = 1
    while (await prisma.store.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`
    }

    await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        store: {
          create: {
            slug,
            name: `${name}'s Store`,
            themeConfig: DEFAULT_THEME,
          },
        },
      },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
