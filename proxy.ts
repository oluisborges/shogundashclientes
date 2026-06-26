import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

const isProd = process.env.NODE_ENV === "production"

// Routes only accessible by admins
const ADMIN_PATHS = [
  "/configuracoes",
  "/shogunia",
  "/disponibilidade",
  "/usuarios",
  "/clientes",
  "/criar-cliente",
]

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: isProd,
              sameSite: "lax",
              path: "/",
            })
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute       = pathname.startsWith("/login")
  const isAguardandoRoute = pathname === "/aguardando-aprovacao"
  const isApiRoute        = pathname.startsWith("/api/")
  const isPending         = user?.user_metadata?.status === "pending"

  // API routes handle their own auth — never redirect them
  if (isApiRoute) {
    supabaseResponse.headers.set("Cache-Control", "no-store, max-age=0")
    return supabaseResponse
  }

  // Unauthenticated: must go to login
  if (!user && !isAuthRoute && !isAguardandoRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Pending user: can only see /aguardando-aprovacao
  if (user && isPending && !isAguardandoRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/aguardando-aprovacao"
    return NextResponse.redirect(url)
  }

  // Approved/admin user on login page: go to dashboard
  if (user && !isPending && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  // Admin-only pages: redirect non-admins to dashboard
  if (user && !isPending && ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "admin") {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
