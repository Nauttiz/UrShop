import Link from "next/link"
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/lib/brand"

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 px-4 text-center">
      <p className="mb-3 text-sm font-bold uppercase tracking-widest text-indigo-600">
        {APP_NAME}
      </p>
      <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
        Sell anything, anywhere
      </h1>
      <p className="text-xl text-gray-600 max-w-xl mb-8">
        Create your online store in minutes. Sell digital and physical products with zero transaction fees.
      </p>
      <div className="flex gap-4">
        <Button size="lg" nativeButton={false} render={<Link href="/register" />}>Start for free</Button>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/login" />}>Sign in</Button>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">14-day free trial · No credit card required</p>
    </main>
  )
}
