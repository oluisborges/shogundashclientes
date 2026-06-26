import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAvailableSlots, getCurrentCycle, isBookingWindowOpen } from "@/lib/services/google-calendar"

export async function GET(request: Request) {
  try {
    console.log("[GET /api/agendamento/slots] Requisição recebida:", request.url)
    
    const { searchParams } = new URL(request.url)
    const yearParam  = searchParams.get("year")
    const monthParam = searchParams.get("month")
    const gestorIdParam = searchParams.get("gestor_id") // Opcional: para filtrar por gestor específico

    console.log("[GET /api/agendamento/slots] Parâmetros:", { yearParam, monthParam, gestorIdParam })

    if (!yearParam || !monthParam) {
      return NextResponse.json({ error: "Parâmetros year e month são obrigatórios" }, { status: 400 })
    }

    const year  = parseInt(yearParam)
    const month = parseInt(monthParam)
    
    console.log("[GET /api/agendamento/slots] Verificando janela...")
    const isOpen = isBookingWindowOpen()
    console.log("[GET /api/agendamento/slots] Janela aberta?", isOpen)

    if (!isOpen) {
      return NextResponse.json({
        open: false,
        message: "A janela de agendamento abre no dia 25 de cada mês.",
        slots: [],
      })
    }

    const monthStr = `${year}-${String(month).padStart(2, "0")}`
    console.log("[GET /api/agendamento/slots] Buscando dados para:", monthStr)
    
    const admin = createAdminClient()

    const lastDay = new Date(year, month, 0).getDate()
    const lastDate = `${monthStr}-${String(lastDay).padStart(2, "0")}`

    console.log("[GET /api/agendamento/slots] Consultando tabelas...")
    
    // Consulta bloqueios globais (admin)
    const [windowRes, slotsRes] = await Promise.all([
      admin.from("booking_window_config").select("window_end").eq("target_month", monthStr).maybeSingle(),
      admin.from("booking_blocked_slots").select("blocked_date, blocked_time")
        .gte("blocked_date", `${monthStr}-01`)
        .lte("blocked_date", lastDate),
    ])
    
    console.log("[GET /api/agendamento/slots] Resultados globais:", { 
      windowError: windowRes.error, 
      slotsError: slotsRes.error,
      windowData: windowRes.data,
      slotsCount: slotsRes.data?.length 
    })

    // Monta sets de bloqueio global
    const blockedFullDays = new Set<string>()
    const blockedTimeSlots = new Map<string, Set<string>>()

    for (const row of (slotsRes.data ?? [])) {
      if (!row.blocked_time) {
        blockedFullDays.add(row.blocked_date)
      } else {
        if (!blockedTimeSlots.has(row.blocked_date)) blockedTimeSlots.set(row.blocked_date, new Set())
        blockedTimeSlots.get(row.blocked_date)!.add(row.blocked_time)
      }
    }

    console.log("[GET /api/agendamento/slots] Bloqueios carregados:", {
      blockedFullDays: Array.from(blockedFullDays),
      blockedTimeSlots: Array.from(blockedTimeSlots.entries()).map(([date, times]) => ({ date, times: Array.from(times) }))
    })

    // Se tiver gestor_id, busca bloqueios específicos do gestor
    if (gestorIdParam) {
      console.log("[GET /api/agendamento/slots] Buscando bloqueios do gestor:", gestorIdParam)
      const { data: gestorSlots, error: gestorError } = await admin
        .from("booking_blocked_slots_gestor")
        .select("blocked_date, blocked_time")
        .eq("gestor_id", gestorIdParam)
        .gte("blocked_date", `${monthStr}-01`)
        .lte("blocked_date", lastDate)

      if (gestorError) {
        console.error("[GET /api/agendamento/slots] Erro ao buscar bloqueios do gestor:", gestorError)
      } else {
        console.log("[GET /api/agendamento/slots] Bloqueios do gestor encontrados:", gestorSlots?.length ?? 0)
        
        // Adiciona bloqueios do gestor aos sets
        for (const row of (gestorSlots ?? [])) {
          if (!row.blocked_time) {
            blockedFullDays.add(row.blocked_date)
          } else {
            if (!blockedTimeSlots.has(row.blocked_date)) blockedTimeSlots.set(row.blocked_date, new Set())
            blockedTimeSlots.get(row.blocked_date)!.add(row.blocked_time)
          }
        }
      }
    }

    // Padrão: fechar no dia 15 do mês alvo se não configurado
    const defaultWindowEnd = new Date(year, month - 1, 15, 23, 59, 59)
    const windowEnd = windowRes.data?.window_end
      ? new Date(windowRes.data.window_end + "T23:59:59")
      : defaultWindowEnd

    console.log("[GET /api/agendamento/slots] Buscando slots no Google Calendar...")
    
    const slots = await getAvailableSlots(year, month, blockedFullDays, blockedTimeSlots, windowEnd)
    
    console.log("[GET /api/agendamento/slots] Slots encontrados:", slots.length)
    
    return NextResponse.json({ open: true, slots, cycle: getCurrentCycle() })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno"
    console.error("[GET /api/agendamento/slots] ERRO 500:", error)
    return NextResponse.json({ error: message, details: String(error) }, { status: 500 })
  }
}
