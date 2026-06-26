import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// Helper para verificar se usuário é gestor e retornar o gestor_id
async function requireGestor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: "Não autorizado", status: 401 }
  }

  const admin = createAdminClient()
  
  // Busca o gestor pelo user_id
  const { data: gestor, error } = await admin
    .from("gestores")
    .select("id, name, email")
    .eq("user_id", user.id)
    .eq("active", true)
    .single()
  
  if (error || !gestor) {
    return { error: "Acesso restrito a gestores", status: 403 }
  }

  return { gestorId: gestor.id, gestor }
}

// Helper para verificar se é admin
async function isAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  
  const admin = createAdminClient()
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).single()
  return data?.role === "admin" || data?.role === "moderador"
}

// GET - Listar bloqueios do gestor (ou de um gestor específico se admin)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gestorIdParam = searchParams.get("gestor_id")
  const month = searchParams.get("month") // Formato: YYYY-MM
  
  const gestorCheck = await requireGestor()
  const adminCheck = await isAdmin()
  
  if ("error" in gestorCheck && !adminCheck) {
    return NextResponse.json({ error: gestorCheck.error }, { status: gestorCheck.status })
  }

  const admin = createAdminClient()
  
  // Define qual gestor buscar
  let targetGestorId: string
  if (adminCheck && gestorIdParam) {
    targetGestorId = gestorIdParam
  } else if ("gestorId" in gestorCheck) {
    targetGestorId = gestorCheck.gestorId
  } else {
    return NextResponse.json({ error: "Gestor não identificado" }, { status: 400 })
  }

  let query = admin
    .from("booking_blocked_slots_gestor")
    .select("*")
    .eq("gestor_id", targetGestorId)
    .order("blocked_date", { ascending: true })
    .order("blocked_time", { ascending: true })

  // Filtra por mês se fornecido
  if (month) {
    const [year, monthNum] = month.split("-")
    const startDate = `${year}-${monthNum}-01`
    const endDate = `${year}-${String(parseInt(monthNum) + 1).padStart(2, "0")}-01`
    query = query.gte("blocked_date", startDate).lt("blocked_date", endDate)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST - Criar novo bloqueio
export async function POST(request: Request) {
  const body = await request.json()
  const { gestor_id: gestorIdParam, blocked_date, blocked_time, reason } = body
  
  const gestorCheck = await requireGestor()
  const adminCheck = await isAdmin()
  
  if ("error" in gestorCheck && !adminCheck) {
    return NextResponse.json({ error: gestorCheck.error }, { status: gestorCheck.status })
  }

  const admin = createAdminClient()
  
  // Define qual gestor modificar
  let targetGestorId: string
  if (adminCheck && gestorIdParam) {
    targetGestorId = gestorIdParam
  } else if ("gestorId" in gestorCheck) {
    targetGestorId = gestorCheck.gestorId
  } else {
    return NextResponse.json({ error: "Gestor não identificado" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("booking_blocked_slots_gestor")
    .insert({
      gestor_id: targetGestorId,
      blocked_date,
      blocked_time: blocked_time || null,
      reason: reason || null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Já existe um bloqueio para esta data/horário" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// DELETE - Remover bloqueio
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  
  if (!id) {
    return NextResponse.json({ error: "ID do bloqueio é obrigatório" }, { status: 400 })
  }

  const gestorCheck = await requireGestor()
  const adminCheck = await isAdmin()
  
  if ("error" in gestorCheck && !adminCheck) {
    return NextResponse.json({ error: gestorCheck.error }, { status: gestorCheck.status })
  }

  const admin = createAdminClient()

  // Se não for admin, verifica se o bloqueio pertence ao gestor
  if (!adminCheck && "gestorId" in gestorCheck) {
    const { data: block } = await admin
      .from("booking_blocked_slots_gestor")
      .select("gestor_id")
      .eq("id", id)
      .single()
    
    if (!block || block.gestor_id !== gestorCheck.gestorId) {
      return NextResponse.json({ error: "Acesso negado a este bloqueio" }, { status: 403 })
    }
  }

  const { error } = await admin
    .from("booking_blocked_slots_gestor")
    .delete()
    .eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
