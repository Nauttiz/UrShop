import { auth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Check } from "lucide-react"

const plans = [
  {
    id: "FREE",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Try out the platform for 14 days",
    features: ["1 store", "10 products", "Basic analytics", "Coupon codes"],
    cta: "Current Plan",
    disabled: true,
  },
  {
    id: "STARTER",
    name: "Starter",
    price: "$19",
    period: "/month",
    description: "For creators just getting started",
    features: ["Unlimited products", "Custom domain", "Advanced analytics", "Priority support"],
    cta: "Upgrade to Starter",
    disabled: false,
    highlighted: false,
  },
  {
    id: "BUSINESS",
    name: "Business",
    price: "$49",
    period: "/month",
    description: "For growing businesses",
    features: ["Everything in Starter", "Email marketing", "Upsells", "Affiliate program"],
    cta: "Upgrade to Business",
    disabled: false,
    highlighted: true,
  },
  {
    id: "PREMIUM",
    name: "Premium",
    price: "$99",
    period: "/month",
    description: "For established brands",
    features: ["Everything in Business", "Unlimited revenue", "White-label", "Dedicated support"],
    cta: "Upgrade to Premium",
    disabled: false,
    highlighted: false,
  },
]

export default async function PlansPage() {
  const session = await auth()
  const currentPlan = session?.user.plan ?? "FREE"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upgrade Plan</h1>
        <p className="text-muted-foreground">Choose the plan that fits your needs</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan
          return (
            <Card
              key={plan.id}
              className={plan.highlighted ? "border-primary shadow-lg" : ""}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.highlighted && <Badge>Popular</Badge>}
                  {isCurrent && <Badge variant="secondary">Current</Badge>}
                </div>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={plan.highlighted ? "default" : "outline"}
                  disabled={isCurrent || plan.disabled}
                >
                  {isCurrent ? "Current Plan" : plan.cta}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Payment integration coming soon. All plans available after launch.
      </p>
    </div>
  )
}
