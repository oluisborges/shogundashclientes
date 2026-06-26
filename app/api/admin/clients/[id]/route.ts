import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// PATCH /api/admin/clients/[id] - atualiza créditos de agendamento
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clientId = (await params).id
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    // Verifica se é admin
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "admin" && profile?.role !== "moderador") {
      return NextResponse.json({ error: "Acesso restrito a administradores e moderadores" }, { status: 403 })
    }

    const body = await request.json()
    const { booking_credits } = body

    // Verifica se o cliente existe
    const { data: client, error: fetchError } = await admin
      .from("clients")
      .select("id, business_name")
      .eq("id", clientId)
      .single()

    if (fetchError || !client) {
      console.error("Cliente não encontrado:", fetchError)
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 })
    }

    // Atualiza os créditos
    const { error: updateError } = await admin
      .from("clients")
      .update({ 
        booking_credits: booking_credits ?? 2,
        booking_credits_cycle: new Date().toISOString().slice(0, 7) // YYYY-MM
      })
      .eq("id", clientId)

    if (updateError) {
      console.error("Erro ao atualizar créditos:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    console.log("Créditos resetados para cliente:", client.business_name, "créditos:", booking_credits ?? 2)
    return NextResponse.json({ 
      message: `Créditos de "${client.business_name}" resetados para ${booking_credits ?? 2}` 
    })
  } catch (err) {
    console.error("Erro geral na API:", err)
    return NextResponse.json({ error: "Erro ao atualizar créditos" }, { status: 500 })
  }
}

// DELETE /api/admin/clients/[id] - apaga uma conta de anúncio
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clientId = (await params).id
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    // Verifica se é admin
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "admin" && profile?.role !== "moderador") {
      return NextResponse.json({ error: "Acesso restrito a administradores e moderadores" }, { status: 403 })
    }

    // Verifica se o cliente existe
    const { data: client, error: fetchError } = await admin
      .from("clients")
      .select("id, business_name")
      .eq("id", clientId)
      .single()

    if (fetchError || !client) {
      console.error("Cliente não encontrado:", fetchError)
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })
    }

    // Remove acessos vinculados primeiro
    await admin
      .from("user_client_access")
      .delete()
      .eq("client_id", clientId)

    // Apaga o cliente
    const { error: deleteError } = await admin
      .from("clients")
      .delete()
      .eq("id", clientId)

    if (deleteError) {
      console.error("Erro ao deletar:", deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    console.log("Cliente apagado com sucesso:", client.business_name)
    return NextResponse.json({ 
      message: `Conta "${client.business_name}" apagada com sucesso!` 
    })
  } catch (err) {
    console.error("Erro geral na API:", err)
    return NextResponse.json({ error: "Erro ao apagar conta" }, { status: 500 })
  }
}
