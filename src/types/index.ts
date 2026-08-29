import { Plan, ProductType, OrderStatus, CouponType } from "@prisma/client"

export type { Plan, ProductType, OrderStatus, CouponType }

export type UserWithStore = {
  id: string
  email: string
  name: string | null
  plan: Plan
  planExpiresAt: Date | null
  store: StoreBasic | null
}

export type StoreBasic = {
  id: string
  slug: string
  name: string
  description: string | null
  logoUrl: string | null
  themeConfig: ThemeConfig
  customDomain: string | null
}

export type ThemeConfig = {
  primaryColor: string
  accentColor: string
  fontFamily: string
  layout: "grid" | "list"
}

export type ProductWithStore = {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  type: ProductType
  thumbnail: string | null
  fileUrl: string | null
  stock: number | null
  isPublished: boolean
  storeId: string
  createdAt: Date
}

export type OrderWithItems = {
  id: string
  buyerEmail: string
  buyerName: string | null
  status: OrderStatus
  total: number
  currency: string
  createdAt: Date
  items: {
    id: string
    quantity: number
    price: number
    product: { name: string; thumbnail: string | null }
  }[]
}

export type CouponRow = {
  id: string
  code: string
  discount: number
  type: CouponType
  usageLimit: number | null
  usageCount: number
  isActive: boolean
  expiresAt: Date | null
  createdAt: Date
}

export const DEFAULT_THEME: ThemeConfig = {
  primaryColor: "#6366f1",
  accentColor: "#8b5cf6",
  fontFamily: "Inter",
  layout: "grid",
}
