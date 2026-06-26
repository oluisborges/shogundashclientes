import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single()
  return profile?.role === "admin" ? user : null
}

// GET /api/admin/settings — return all settings as { key: value }
export async function GET() {
  const user = await assertAdmin()
  if (!user) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.from("app_settings").select("key, value")
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  }

  const settings: Record<string, string> = {}
  for (const row of data ?? []) settings[row.key] = row.value ?? ""

  const hasMetaGlobalToken = !!settings.meta_global_token
  delete settings.meta_global_token

  return NextResponse.json(
    {
      ...settings,
      meta_global_token_configured: hasMetaGlobalToken,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
}

// PUT /api/admin/settings — upsert { key, value } pairs
export async function PUT(req: NextRequest) {
  const user = await assertAdmin()
  if (!user) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  }

  const body: Record<string, string> = await req.json()
  const admin = createAdminClient()

  const rows = Object.entries(body).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await admin
    .from("app_settings")
    .upsert(rows, { onConflict: "key" })

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    )
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } })
}
