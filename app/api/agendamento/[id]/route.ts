import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { deleteCalendarEvent, getCurrentCycle } from "@/lib/services/google-calendar"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from("profiles").select("role").eq("id", user.id).single()
    const isAdmin = profile?.role === "admin" || profile?.role === "moderador" || profile?.role === "gestor"

    // Admin pode cancelar passando clientId como query param
    const { searchParams } = new URL(_request.url)
    const clientIdParam = searchParams.get("clientId")

    // Para admins, busca o booking diretamente pelo ID se clientIdParam for fornecido
    // Para não-admins, verifica se o booking pertence ao cliente do usuário
    let bookingQuery = adminClient
      .from("bookings")
      .select("id, google_event_id, client_id, status, scheduled_at")
      .eq("id", id)

    if (isAdmin && clientIdParam) {
      // Admin com clientIdParam: verifica se o booking pertence ao cliente especificado
      bookingQuery = bookingQuery.eq("client_id", clientIdParam) as typeof bookingQuery
    } else if (isAdmin) {
      // Admin sem clientIdParam: pode cancelar qualquer booking (área admin)
      // Não adiciona filtro de client_id
    } else {
      // Não-admin: deve verificar se o booking pertence ao cliente do usuário
      const { data: userClient } = await adminClient
        .from("clients")
        .select("id")
        .eq("profile_id", user.id)
        .single()
      if (!userClient) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 })
      bookingQuery = bookingQuery.eq("client_id", userClient.id) as typeof bookingQuery
    }

    const { data: booking } = await bookingQuery.maybeSingle()

    if (!booking) return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 })
    if (booking.status !== "confirmed") {
      return NextResponse.json({ error: "Agendamento já cancelado" }, { status: 400 })
    }

    // Cancela no banco
    await adminClient
      .from("bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)

    // Devolve o crédito ao cliente (admin ou cliente cancelando)
    const { data: creditClientData } = await adminClient
      .from("clients")
      .select("booking_credits, business_name")
      .eq("id", booking.client_id)
      .single()

    if (creditClientData) {
      await adminClient
        .from("clients")
        .update({ booking_credits: Math.min((creditClientData.booking_credits || 0) + 1, 2) })
        .eq("id", booking.client_id)
      console.log("[cancel] Crédito devolvido ao cliente:", booking.client_id, "nome:", creditClientData.business_name, "por:", isAdmin ? "admin" : "cliente")
    }

    // Libera o slot para outros clientes (usa horário local de São Paulo)
    if (booking.scheduled_at) {
      const scheduledAt = new Date(booking.scheduled_at)
      const blockedDate = scheduledAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-') // YYYY-MM-DD
      const blockedTime = scheduledAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) // HH:MM
      await adminClient
        .from("booking_blocked_slots")
        .delete()
        .eq("blocked_date", blockedDate)
        .eq("blocked_time", blockedTime)
      console.log("[cancel] Slot liberado:", { blockedDate, blockedTime })
    }

    // Remove do Google Calendar (ignora erro se evento já não existe)
    if (booking.google_event_id) {
      await deleteCalendarEvent(booking.google_event_id).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno"
    console.error("Erro ao cancelar agendamento:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
