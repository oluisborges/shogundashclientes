import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).single()
  if (!data || !["admin", "moderador", "gestor"].includes(data.role)) return null
  return user
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  const { id } = await params
  const { name, email, active, password } = await request.json()

  const admin = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (name  !== undefined) updates.name   = name.trim()
  if (email !== undefined) updates.email  = email.trim().toLowerCase()
  if (active !== undefined) updates.active = active

  // If password is provided, attempt to update the Supabase Auth user that matches the gestor email
  if (typeof password === "string" && password.trim()) {
    const targetEmail = (typeof email === "string" && email.trim()) ? email.trim().toLowerCase() : undefined

    if (!targetEmail) {
      const { data: current } = await admin.from("gestores").select("email").eq("id", id).single()
      if (!current?.email) {
        return NextResponse.json({ error: "E-mail do gestor não encontrado" }, { status: 400 })
      }
      ;(updates as any).email = current.email
    }

    const emailToFind = (targetEmail ?? (updates.email as string)).toLowerCase()

    // Find auth user by email (best-effort)
    const { data: authData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listErr) return NextResponse.json({ error: "Erro ao buscar usuário de autenticação" }, { status: 500 })
    const authUser = authData.users.find((u) => (u.email ?? "").toLowerCase() === emailToFind)
    if (!authUser) return NextResponse.json({ error: "Usuário de autenticação não encontrado para este e-mail" }, { status: 400 })

    const { error: updErr } = await admin.auth.admin.updateUserById(authUser.id, { password })
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })
  }

  const { data, error } = await admin
    .from("gestores")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: "Sem permissão" }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  // Desvincula clientes antes de deletar
  await admin.from("clients").update({ gestor_id: null }).eq("gestor_id", id)

  const { error } = await admin.from("gestores").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
