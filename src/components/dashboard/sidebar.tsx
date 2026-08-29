"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Tag,
  BarChart3,
  Settings,
  CreditCard,
  ExternalLink,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/brand"
import { Badge } from "@/components/ui/badge"

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/customers", label: "Customers", icon: Users },
  { href: "/dashboard/coupons", label: "Coupons", icon: Tag },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Store Settings", icon: Settings },
  { href: "/dashboard/plans", label: "Upgrade Plan", icon: CreditCard },
]

interface SidebarProps {
  storeSlug: string | null
  plan: string
}

export function DashboardSidebar({ storeSlug, plan }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="w-64 border-r bg-white flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b">
        <span className="text-xl font-bold text-primary">{APP_NAME}</span>
        <Badge variant="secondary" className="ml-2 text-xs uppercase">
          {plan}
        </Badge>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* View Store link */}
      {storeSlug && (
        <div className="p-4 border-t">
          <Link
            href={`/store/${storeSlug}`}
            target="_blank"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            View my store
          </Link>
        </div>
      )}
    </aside>
  )
}
