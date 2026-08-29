"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Suspense, useState } from "react"
import { loginSchema, type LoginInput } from "@/lib/validations"
import { APP_NAME } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>Sign in to your {APP_NAME} account</CardDescription>
        </CardHeader>
        {/* LoginForm reads the query string, which cannot be known at build
            time — the boundary lets the rest of the card prerender. */}
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </Card>
    </div>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  // The proxy appends ?callbackUrl when it bounces a signed-out seller off a
  // protected page. Only same-origin paths are honoured, so a crafted link
  // cannot turn the login form into an open redirect.
  const requested = searchParams.get("callbackUrl")
  const callbackUrl =
    requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard"

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginInput) {
    setError(null)
    const res = await signIn("credentials", { ...data, redirect: false })
    if (res?.error) {
      setError("Invalid email or password")
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
          {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
          {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-4">
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create one free
          </Link>
        </p>
      </CardFooter>
    </form>
  )
}

function LoginFormFallback() {
  return (
    <CardContent className="space-y-4">
      <div className="h-9 animate-pulse rounded-md bg-gray-100" />
      <div className="h-9 animate-pulse rounded-md bg-gray-100" />
      <div className="h-9 animate-pulse rounded-md bg-gray-200" />
    </CardContent>
  )
}
