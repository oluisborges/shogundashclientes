import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCurrentCycle,
  isBookingWindowOpen,
} from "@/lib/services/google-calendar"

export async function POST(request: Request) {
  try {
    if (!isBookingWindowOpen()) {
      return NextResponse.json(
        { error: "A janela de agendamento abre no dia 25 de cada mês." },
        { status: 403 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    console.log("[book] Auth check:", { user: user?.id, error: authError })
    
    if (!user) {
      console.error("[book] User not found, authError:", authError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }

    const { slot, clientId: clientIdParam, adminReschedule } = await request.json() as { slot: string; clientId?: string; adminReschedule?: boolean }
    if (!slot) return NextResponse.json({ error: "Slot inválido" }, { status: 400 })

    const adminClient = createAdminClient()

    const { data: profile } = await adminClient
      .from("profiles").select("role").eq("id", user.id).single()
    const isAdmin = profile?.role === "admin" || profile?.role === "moderador" || profile?.role === "gestor"

    // Carrega cliente com gestor e perfil do usuário
    let clientQuery = adminClient
      .from("clients")
      .select(`
        id, booking_credits, booking_credits_cycle, business_name, niche, profile_id,
        gestor:gestor_id ( email ),
        profile:profile_id ( full_name )
      `)

    if (isAdmin && clientIdParam) {
      // Admin agendando para um cliente específico
      clientQuery = clientQuery.eq("id", clientIdParam) as typeof clientQuery
    } else if (isAdmin) {
      // Admin sem clientId especificado - busca qualquer cliente ativo (incluindo compartilhados)
      clientQuery = clientQuery.eq("active", true).order("created_at", { ascending: false }).limit(1) as typeof clientQuery
    } else {
      // Cliente comum agendando para si mesmo - usa limit(1) para evitar erro com múltiplos clientes
      clientQuery = clientQuery.eq("profile_id", user.id).eq("active", true).limit(1) as typeof clientQuery
    }

    const { data: client } = await clientQuery.maybeSingle()

    if (!client) {
      console.error("[book] Cliente não encontrado para user.id:", user.id, "isAdmin:", isAdmin, "clientIdParam:", clientIdParam)
      // Se for admin e não encontrar cliente, cria um cliente temporário para teste
      if (isAdmin) {
        console.warn("[book] Criando cliente temporário para admin:", user.id)
        const { data: newClient, error: insertError } = await adminClient
          .from("clients")
          .insert({
            profile_id: user.id,
            business_name: "Admin Test",
            active: true,
            booking_credits: 2,
            booking_credits_cycle: getCurrentCycle(),
          })
          .select(`
            id, booking_credits, booking_credits_cycle, business_name, niche, profile_id,
            gestor:gestor_id ( email ),
            profile:profile_id ( full_name )
          `)
          .single()
        if (insertError) {
          console.error("[book] Erro ao criar cliente temporário:", insertError)
          return NextResponse.json({ error: "Cliente não encontrado e não foi possível criar temporário" }, { status: 404 })
        }
        // Continua com o novo cliente - usa diretamente o user.email em vez de buscar no auth
        const clientName = (newClient.profile as { full_name?: string } | null)?.full_name ?? newClient.business_name
        const gestorEmail = (newClient.gestor as { email?: string } | null)?.email
        const clientEmail = user.email
        const cycle = getCurrentCycle()
        const credits = 2
        const scheduledAt = new Date(`${slot}:00-03:00`)
        const googleEventId = await createCalendarEvent({
          scheduledAt,
          clientName,
          businessName: newClient.business_name,
          niche: newClient.niche ?? undefined,
          clientEmail,
          gestorEmail,
        })
        const { data: booking, error: bookingInsertError } = await adminClient
          .from("bookings")
          .insert({
            client_id: newClient.id,
            google_event_id: googleEventId,
            scheduled_at: scheduledAt.toISOString(),
            status: "confirmed",
          })
          .select()
          .single()
        if (bookingInsertError) throw bookingInsertError
        console.log("[book] Agendamento criado para admin:", { bookingId: booking?.id, clientId: newClient.id, scheduledAt: scheduledAt.toISOString() })

        // Bloqueia o slot para outros clientes (usa horário local de São Paulo)
        const blockedDate = scheduledAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-') // YYYY-MM-DD
        const blockedTime = scheduledAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) // HH:MM
        await adminClient
          .from("booking_blocked_slots")
          .insert({
            blocked_date: blockedDate,
            blocked_time: blockedTime,
          })
        console.log("[book] Slot bloqueado para admin:", { blockedDate, blockedTime })

        await adminClient
          .from("clients")
          .update({ booking_credits: 1, booking_credits_cycle: cycle })
          .eq("id", newClient.id)
        return NextResponse.json({ booking, credits: 1 })
      }
      return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 })
    }

    // Busca email do cliente via auth - só para clientes normais (não admin)
    let clientEmail = user.email
    if (client.profile_id && client.profile_id !== user.id) {
      try {
        const { data: authUser } = await adminClient.auth.admin.getUserById(client.profile_id)
        clientEmail = authUser?.user?.email ?? user.email
      } catch (err) {
        console.warn("[book] Erro ao buscar email do cliente via auth, usando email do user:", err)
        clientEmail = user.email
      }
    }

    const cycle = getCurrentCycle()

    // Reset de créditos se novo ciclo
    let credits = client.booking_credits ?? 2
    if (client.booking_credits_cycle !== cycle) {
      credits = 2
      await adminClient
        .from("clients")
        .update({ booking_credits: 2, booking_credits_cycle: cycle })
        .eq("id", client.id)
    }

    if (credits <= 0) {
      return NextResponse.json(
        { error: "Você não tem mais créditos para agendar neste ciclo." },
        { status: 403 }
      )
    }

    // Verifica se já tem agendamento ativo no ciclo
    const [cycleYear, cycleMonth] = cycle.split("-").map(Number)
    const cycleStart = new Date(cycleYear, cycleMonth - 1, 1).toISOString()
    const cycleEnd   = new Date(cycleYear, cycleMonth, 0, 23, 59, 59).toISOString()

    const { data: existing } = await adminClient
      .from("bookings")
      .select("id, google_event_id")
      .eq("client_id", client.id)
      .eq("status", "confirmed")
      .gte("scheduled_at", cycleStart)
      .lte("scheduled_at", cycleEnd)
      .maybeSingle()

    // Cancela agendamento anterior (remarcação)
    if (existing) {
      await adminClient
        .from("bookings")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      
      // Se for admin remarcar, devolve o crédito ao cliente
      if (isAdmin && adminReschedule) {
        const { data: creditClientData } = await adminClient
          .from("clients")
          .select("booking_credits, business_name")
          .eq("id", client.id)
          .single()

        if (creditClientData) {
          await adminClient
            .from("clients")
            .update({ booking_credits: (creditClientData.booking_credits || 0) + 1 })
            .eq("id", client.id)
          console.log("[book] Crédito devolvido ao cliente (remarcação por admin):", client.id, "nome:", creditClientData.business_name)
        }
      }
      
      if (existing.google_event_id) {
        await deleteCalendarEvent(existing.google_event_id).catch(() => {})
      }
    }

    // Resolve nome do cliente e gestor
    const profileData = client.profile as { full_name?: string } | null
    const gestorData  = client.gestor  as { email?: string }     | null

    const clientName  = profileData?.full_name ?? client.business_name
    const gestorEmail = gestorData?.email

    // Cria evento no Google Calendar
    const scheduledAt = new Date(`${slot}:00-03:00`) // São Paulo UTC-3
    
    // Verifica se o agendamento é com pelo menos 12h de antecedência
    const now = new Date()
    const hoursUntilBooking = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60)
    if (hoursUntilBooking < 12) {
      return NextResponse.json(
        { error: "Agendamento deve ser feito com pelo menos 12 horas de antecedência." },
        { status: 400 }
      )
    }
    
    const googleEventId = await createCalendarEvent({
      scheduledAt,
      clientName,
      businessName: client.business_name,
      niche:        client.niche ?? undefined,
      clientEmail,
      gestorEmail,
    })

    // Cria novo agendamento no banco
    const { data: booking, error: insertError } = await adminClient
      .from("bookings")
      .insert({
        client_id:       client.id,
        google_event_id: googleEventId,
        scheduled_at:    scheduledAt.toISOString(),
        status:          "confirmed",
      })
      .select()
      .single()

    if (insertError) throw insertError

    console.log("[book] Agendamento criado:", { bookingId: booking?.id, clientId: client.id, scheduledAt: scheduledAt.toISOString() })

    // Bloqueia o slot para outros clientes (usa horário local de São Paulo)
    const blockedDate = scheduledAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-') // YYYY-MM-DD
    const blockedTime = scheduledAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) // HH:MM
    await adminClient
      .from("booking_blocked_slots")
      .insert({
        blocked_date: blockedDate,
        blocked_time: blockedTime,
      })
    console.log("[book] Slot bloqueado:", { blockedDate, blockedTime })

    // Desconta 1 crédito
    await adminClient
      .from("clients")
      .update({ booking_credits: credits - 1, booking_credits_cycle: cycle })
      .eq("id", client.id)

    return NextResponse.json({ booking, credits: credits - 1 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno"
    console.error("Erro ao criar agendamento:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
