import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

// GET - Listar clientes do gestor logado
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const admin = createAdminClient()
  
  // Busca o gestor pelo user_id
  const { data: gestor, error: gestorError } = await admin
    .from("gestores")
    .select("id")
    .eq("user_id", user.id)
    .eq("active", true)
    .single()
  
  if (gestorError || !gestor) {
    return NextResponse.json({ error: "Gestor não encontrado" }, { status: 403 })
  }

  // Busca os clientes vinculados ao gestor
  const { data: clients, error: clientsError } = await admin
    .from("clients")
    .select(`
      id,
      business_name,
      meta_account_id,
      cnpj,
      niche,
      active,
      profile_id,
      profiles:profile_id (email, full_name)
    `)
    .eq("gestor_id", gestor.id)
    .order("business_name")

  if (clientsError) {
    return NextResponse.json({ error: clientsError.message }, { status: 500 })
  }

  // Formata a resposta
  const formattedClients = clients?.map((client: any) => ({
    id: client.id,
    business_name: client.business_name,
    meta_account_id: client.meta_account_id,
    cnpj: client.cnpj,
    niche: client.niche,
    active: client.active,
    profile_id: client.profile_id,
    email: client.profiles?.[0]?.email,
    full_name: client.profiles?.[0]?.full_name,
  })) || []

  return NextResponse.json(formattedClients)
}
