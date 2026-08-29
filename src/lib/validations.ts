import { z } from "zod"

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
})

export const storeSchema = z.object({
  name: z.string().min(2, "Store name must be at least 2 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens"),
  description: z.string().max(500).optional(),
})

/**
 * Plain object shape, kept separate from `productSchema` because `.refine()`
 * returns an effects wrapper that has no `.partial()` — PATCH needs the object.
 */
export const productBaseSchema = z
  .object({
    name: z.string().min(1, "Product name is required"),
    description: z.string().optional(),
    price: z.coerce.number().min(0, "Price must be positive"),
    compareAtPrice: z.coerce.number().min(0).optional().nullable(),
    currency: z.string().default("USD"),
    type: z.enum(["DIGITAL", "PHYSICAL", "SUBSCRIPTION"]),
    category: z.string().max(60).optional().nullable(),
    thumbnail: z.string().optional().nullable(),
    fileUrl: z.string().optional().nullable(),
    stock: z.coerce.number().int().min(0).optional().nullable(),
    weightGrams: z.coerce.number().int().min(0).optional().nullable(),
    isPayWhatYouWant: z.boolean().default(false),
    minPrice: z.coerce.number().min(0).optional().nullable(),
    downloadLimit: z.coerce.number().int().min(1).optional().nullable(),
    downloadExpiryHours: z.coerce.number().int().min(1).optional().nullable(),
    billingInterval: z.enum(["month", "year"]).optional().nullable(),
    isPublished: z.boolean().default(false),
  })

const withProductRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((v: any) => !v.isPayWhatYouWant || (v.minPrice !== null && v.minPrice !== undefined), {
      message: "Pay-what-you-want products need a minimum price",
      path: ["minPrice"],
    })
    .refine((v: any) => v.type !== "SUBSCRIPTION" || !!v.billingInterval, {
      message: "Subscriptions need a billing interval",
      path: ["billingInterval"],
    })

export const productSchema = withProductRules(productBaseSchema)
export const productPatchSchema = withProductRules(productBaseSchema.partial())

export const couponSchema = z.object({
  code: z
    .string()
    .min(3, "Code must be at least 3 characters")
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Only uppercase letters, numbers, - and _"),
  discount: z.coerce.number().min(1, "Discount must be at least 1"),
  type: z.enum(["PERCENT", "FIXED"]),
  minSubtotal: z.coerce.number().min(0).optional().nullable(),
  usageLimit: z.coerce.number().int().min(1).optional().nullable(),
  expiresAt: z.string().optional().nullable(),
})

// ─── Storefront / buyer-facing ───────────────────────────────────────────────

export const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  /** Buyer-chosen amount for pay-what-you-want products. */
  offeredPrice: z.coerce.number().min(0).optional().nullable(),
})

export const updateCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(0).max(99),
})

export const couponCodeSchema = z.object({
  code: z.string().min(1, "Enter a coupon code").max(40),
})

export const shippingAddressSchema = z.object({
  line1: z.string().min(1, "Street address is required").max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1, "City is required").max(100),
  state: z.string().max(100).optional().nullable(),
  postalCode: z.string().min(1, "Postal code is required").max(20),
  country: z.string().min(2, "Country is required").max(60),
})

export const checkoutSchema = z.object({
  email: z.string().email("A valid email is required — we send your files there"),
  name: z.string().max(120).optional().nullable(),
  shippingAddress: shippingAddressSchema.optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
})

export const storeSettingsSchema = z.object({
  taxRate: z.coerce.number().min(0).max(100).default(0),
  flatShipping: z.coerce.number().min(0).default(0),
  freeShippingOver: z.coerce.number().min(0).optional().nullable(),
  downloadLimit: z.coerce.number().int().min(1).optional().nullable(),
  downloadExpiryHours: z.coerce.number().int().min(1).optional().nullable(),
  abandonedCartHours: z.coerce.number().int().min(1).max(168).default(4),
  sendReceiptEmail: z.boolean().default(true),
  notifySellerOnOrder: z.boolean().default(true),
})

export const storeProfileSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(500).optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  currency: z.string().length(3),
  contactEmail: z.string().email().optional().nullable().or(z.literal("")),
  themeConfig: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1"),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #8b5cf6"),
    fontFamily: z.string().max(40),
    layout: z.enum(["grid", "list"]),
  }),
})

export const orderStatusSchema = z.object({
  status: z.enum(["PENDING", "PAID", "FULFILLED", "REFUNDED", "CANCELLED", "FAILED"]),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type StoreInput = z.infer<typeof storeSchema>
export type ProductInput = z.infer<typeof productSchema>
export type CouponInput = z.infer<typeof couponSchema>
export type CheckoutInput = z.infer<typeof checkoutSchema>
export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>
export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>
export type StoreProfileInput = z.infer<typeof storeProfileSchema>
