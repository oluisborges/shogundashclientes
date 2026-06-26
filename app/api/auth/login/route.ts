import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { rateLimit, getClientIp } from "@/lib/rate-limit"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = rateLimit(ip, { prefix: "login", limit: 5, windowSec: 900 })
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em alguns minutos." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetAt),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Requisição inválida" },
      {
        status: 400,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAt),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    )
  }

  const email = typeof body?.email === "string" ? body.email.trim() : ""
  const password = typeof body?.password === "string" ? body.password : ""

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email e senha são obrigatórios" },
      {
        status: 400,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAt),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    )
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Email ou senha inválidos." },
      {
        status: 400,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAt),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    return NextResponse.json(
      { error: "Email ou senha inválidos." },
      {
        status: 401,
        headers: {
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.resetAt),
          "Cache-Control": "no-store, max-age=0",
        },
      }
    )
  }

  const pending = data.user.user_metadata?.status === "pending"
  
  // Verifica se é gestor
  const admin = createAdminClient()
  const { data: gestor } = await admin
    .from("gestores")
    .select("id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .single()
  
  return NextResponse.json(
    { ok: true, pending, is_gestor: !!gestor, gestor_id: gestor?.id || null },
    {
      headers: {
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.resetAt),
        "Cache-Control": "no-store, max-age=0",
      },
    }
  )
}
