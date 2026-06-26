import { google } from "googleapis"
import { v4 as uuidv4 } from "uuid"

// Calendário onde os eventos de reunião são CRIADOS
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
// Calendário usado para verificar horários OCUPADOS (ex: agenda do time)
const FREEBUSY_CALENDAR_ID = process.env.GOOGLE_FREEBUSY_CALENDAR_ID ?? CALENDAR_ID

const TZ = "America/Sao_Paulo"

// Horários disponíveis para reunião: 09:30–11:30 e 14:00–16:30
const MORNING_SLOTS   = ["09:30","10:00","10:30","11:00","11:30"]
const AFTERNOON_SLOTS = ["14:00","14:30","15:00","15:30","16:00","16:30"]
const WORKING_SLOTS   = [...MORNING_SLOTS, ...AFTERNOON_SLOTS]

// Sempre convidados em todas as reuniões (donos do Grupo Shogun)
const FIXED_ATTENDEES = ["leandrosamurait@gmail.com", "xluisborges@gmail.com"]
// Convidado apenas em reuniões do nicho marmitarias (coordenador)
const MARMITARIAS_ATTENDEE = "leo.gon.dacruz@gmail.com"

/** Auth via Service Account — para Sheets, Drive e leitura de Calendar */
function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL
  const key   = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (!email || !key) throw new Error("Credenciais do Google não configuradas.")
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  })
}

/** Auth via OAuth2 — para criar/deletar eventos com convidados */
function getOAuthAuth() {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Credenciais OAuth2 não configuradas (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN).")
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })
  return oauth2
}

/** Retorna o 2º dia útil (seg-sex) de um mês */
export function getSecondBusinessDay(year: number, month: number): Date {
  let count = 0
  let day = 1
  while (count < 2) {
    const d = new Date(year, month - 1, day)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    if (count < 2) day++
  }
  return new Date(year, month - 1, day)
}

/**
 * Retorna o ciclo atual "YYYY-MM":
 * - Dia 25+: próximo mês
 * - Dia 1-15: mês atual
 * - Dia 16-24: mês atual (janela fechada, mas ciclo ainda é o atual)
 */
export function getCurrentCycle(): string {
  // Usa timezone fixo do Brasil para evitar problemas com UTC
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }
  const formatter = new Intl.DateTimeFormat("en-US", options)
  const parts = formatter.formatToParts(now)
  
  const getPart = (type: string) => parts.find(p => p.type === type)?.value ?? ""
  const day = parseInt(getPart("day"))
  const month = parseInt(getPart("month"))
  const year = parseInt(getPart("year"))
  
  const target = day >= 25
    ? new Date(year, month, 1)  // Próximo mês (month já está 1-based)
    : new Date(year, month - 1, 1)  // Mês atual (month é 1-based, precisa subtrair 1)
  
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Verifica se a janela de agendamento está aberta:
 * - Dia 1-15: agendar mês atual
 * - Dia 16-24: janela fechada
 * - Dia 25+: agendar próximo mês
 */
export function isBookingWindowOpen(): boolean {
  // Usa timezone fixo do Brasil para evitar problemas com UTC
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false
  }
  const formatter = new Intl.DateTimeFormat("en-US", options)
  const parts = formatter.formatToParts(now)
  
  const getPart = (type: string) => parts.find(p => p.type === type)?.value ?? ""
  const day = parseInt(getPart("day"))
  const month = parseInt(getPart("month"))
  const year = parseInt(getPart("year"))
  const hour = parseInt(getPart("hour"))
  
  console.log("[isBookingWindowOpen] Data atual (America/Sao_Paulo):", { year, month, day, hour })
  
  const isOpen = day <= 15 || day >= 25
  console.log("[isBookingWindowOpen] Dia:", day, "- Janela aberta?", isOpen)
  
  return isOpen
}

export interface AvailableDay {
  date:  string    // "2026-04-02"
  label: string    // "Qui, 02/04"
  slots: string[]  // ["09:00", "09:30", ...]
}

/**
 * Retorna slots mockados para desenvolvimento local quando as credenciais do Google não estão configuradas
 */
function getMockSlots(
  targetYear: number,
  targetMonth: number,
  blockedFullDays: Set<string> = new Set(),
  blockedTimeSlots: Map<string, Set<string>> = new Map(),
  windowEnd?: Date
): AvailableDay[] {
  const result: AvailableDay[] = []
  const lastDay = new Date(targetYear, targetMonth, 0).getDate()

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(targetYear, targetMonth - 1, day)
    const dayOfWeek = date.getDay()
    
    // Pula fins de semana (0 = domingo, 6 = sábado)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    
    // Pula dias bloqueados
    if (blockedFullDays.has(dateStr)) continue

    // Verifica windowEnd
    if (windowEnd && date > windowEnd) continue

    // Segunda-feira: slots começam às 11h (igual terça)
    // Demais dias: slots normais
    const daySlots = dayOfWeek === 1
      ? WORKING_SLOTS.filter(slot => slot >= "11:00")
      : WORKING_SLOTS

    const slots: string[] = []
    for (const slot of daySlots) {
      const blockedTimes = blockedTimeSlots.get(dateStr)
      if (!blockedTimes || !blockedTimes.has(slot)) {
        slots.push(slot)
      } else {
        console.log("[getMockSlots] Slot bloqueado:", { dateStr, slot, blockedTimes: Array.from(blockedTimes) })
      }
    }

    if (slots.length > 0) {
      const label = date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
      result.push({ date: dateStr, label, slots })
    }
  }

  return result
}

/**
 * Retorna os slots disponíveis para o mês alvo consultando o Google Calendar.
 * Usa GOOGLE_FREEBUSY_CALENDAR_ID para checar horários ocupados.
 */
export async function getAvailableSlots(
  targetYear: number,
  targetMonth: number,
  blockedFullDays: Set<string> = new Set(),
  blockedTimeSlots: Map<string, Set<string>> = new Map(),
  windowEnd?: Date
): Promise<AvailableDay[]> {
  // Se não tiver credenciais, retorna slots mockados para desenvolvimento local
  let auth: any
  try {
    if (!FREEBUSY_CALENDAR_ID) throw new Error("GOOGLE_FREEBUSY_CALENDAR_ID não configurado.")
    auth = getAuth()
  } catch (err) {
    console.warn("[getAvailableSlots] Credenciais não configuradas, usando slots mockados para desenvolvimento")
    return getMockSlots(targetYear, targetMonth, blockedFullDays, blockedTimeSlots, windowEnd)
  }

  const calendar = google.calendar({ version: "v3", auth })

  const startDay = getSecondBusinessDay(targetYear, targetMonth)
  const lastDay  = new Date(targetYear, targetMonth, 0)

  const timeMin = new Date(targetYear, targetMonth - 1, startDay.getDate(), 0, 0, 0).toISOString()
  const timeMax = new Date(targetYear, targetMonth - 1, lastDay.getDate(), 23, 59, 59).toISOString()

  const eventsRes = await calendar.events.list({
    calendarId:   FREEBUSY_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy:      "startTime",
    timeZone:     TZ,
  })

  const events = eventsRes.data.items ?? []

  // Indexa slots ocupados como "2026-04-02T09:00"
  const busySet = new Set<string>()
  for (const ev of events) {
    if (ev.status === "cancelled") continue
    const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null
    const end   = ev.end?.dateTime   ? new Date(ev.end.dateTime)   : null
    if (!start || !end) continue

    for (const slot of WORKING_SLOTS) {
      const [h, m] = slot.split(":").map(Number)
      const slotStart = new Date(start)
      slotStart.setHours(h, m, 0, 0)
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000)
      if (slotStart < end && slotEnd > start) {
        const dateStr = slotStart.toISOString().split("T")[0]
        busySet.add(`${dateStr}T${slot}`)
      }
    }
  }

  // Gera dias úteis do período
  const result: AvailableDay[] = []
  const cur = new Date(startDay)
  cur.setHours(0, 0, 0, 0)
  const DAYS_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]

  while (cur <= lastDay) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) {
      const dateStr = cur.toISOString().split("T")[0]
      const dd = String(cur.getDate()).padStart(2, "0")
      const mm = String(cur.getMonth() + 1).padStart(2, "0")

      if (windowEnd && cur > windowEnd) break

      if (blockedFullDays.has(dateStr)) {
        cur.setDate(cur.getDate() + 1)
        continue
      }

      const dayBlockedTimes = blockedTimeSlots.get(dateStr) ?? new Set<string>()

      // Segunda-feira: slots começam às 11h (igual terça)
      // Demais dias: slots normais
      const dayWorkingSlots = dow === 1
        ? WORKING_SLOTS.filter(slot => slot >= "11:00")
        : WORKING_SLOTS

      // Filtra slots que estão a menos de 12h de antecedência
      const now = new Date()
      const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000)

      const availableSlots = dayWorkingSlots.filter(
        (slot) => {
          // Verifica se o slot está ocupado ou bloqueado
          if (busySet.has(`${dateStr}T${slot}`) || dayBlockedTimes.has(slot)) {
            return false
          }
          
          // Verifica se o slot está a menos de 12h de antecedência
          const [h, m] = slot.split(":").map(Number)
          const slotDate = new Date(cur)
          slotDate.setHours(h, m, 0, 0)
          
          return slotDate.getTime() >= twelveHoursFromNow.getTime()
        }
      )

      if (availableSlots.length > 0) {
        result.push({ date: dateStr, label: `${DAYS_PT[dow]}, ${dd}/${mm}`, slots: availableSlots })
      }
    }
    cur.setDate(cur.getDate() + 1)
  }

  return result
}

export interface CreateEventParams {
  scheduledAt:  Date
  clientName:   string
  businessName: string
  niche?:       string
  clientEmail?: string
  gestorEmail?: string
}

/**
 * Cria evento de reunião no Google Calendar com Meet automático e convidados.
 * Usa OAuth2 para poder adicionar attendees.
 * Retorna o eventId do Google Calendar.
 */
export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  // Se não tiver OAuth2 configurado, retorna um ID mockado para desenvolvimento
  let auth: any
  try {
    if (!CALENDAR_ID) throw new Error("GOOGLE_CALENDAR_ID não configurado.")
    auth = getOAuthAuth()
  } catch (err) {
    console.warn("[createCalendarEvent] OAuth2 não configurado, usando ID mockado para desenvolvimento")
    return `mock-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  const { scheduledAt, clientName, businessName, niche, clientEmail, gestorEmail } = params

  const calendar = google.calendar({ version: "v3", auth })

  const endAt = new Date(scheduledAt.getTime() + 30 * 60 * 1000)

  const dateFmt = scheduledAt.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ,
  })
  const timeFmt = scheduledAt.toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: TZ,
  })

  const allAttendees = Array.from(new Set([
    ...FIXED_ATTENDEES,
    ...(niche === "marmitarias" ? [MARMITARIAS_ATTENDEE] : []),
    ...(clientEmail ? [clientEmail] : []),
    ...(gestorEmail ? [gestorEmail] : []),
  ])).map((email) => ({ email }))

  const title = `Grupo Shogun - Alinhamento (${clientName} | ${businessName})`

  const description = `Reunião individual de acompanhamento mensal entre ${businessName} e a equipe Grupo Shogun.

Neste encontro revisamos:
- Resultados e métricas do período
- Oportunidades de melhoria
- Prioridades e próximos passos para o mês seguinte

---

Data: ${dateFmt} às ${timeFmt}
Duração: 30 minutos
Frequência: Mensal`

  try {
    const res = await calendar.events.insert({
      calendarId:            CALENDAR_ID,
      conferenceDataVersion: 1,
      sendUpdates:           "all",
      requestBody: {
        summary:     title,
        description,
        start: { dateTime: scheduledAt.toISOString(), timeZone: TZ },
        end:   { dateTime: endAt.toISOString(),        timeZone: TZ },
        attendees:   allAttendees,
        conferenceData: {
          createRequest: {
            requestId:             uuidv4(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 60 },
            { method: "popup", minutes: 15 },
          ],
        },
      },
    })
    return res.data.id!
  } catch (err) {
    console.error("[createCalendarEvent] Erro ao criar evento no Google Calendar:", err)
    // Se falhar por OAuth (invalid_grant), retorna ID mockado para não quebrar o fluxo
    if (err instanceof Error && err.message.includes("invalid_grant")) {
      console.warn("[createCalendarEvent] OAuth invalid_grant, usando ID mockado")
      return `mock-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }
    throw err
  }
}

/** Exclui um evento do Google Calendar */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  // Se não tiver OAuth2 configurado, apenas loga e retorna (desenvolvimento)
  let auth: any
  try {
    if (!CALENDAR_ID) throw new Error("GOOGLE_CALENDAR_ID não configurado.")
    auth = getOAuthAuth()
  } catch (err) {
    console.warn("[deleteCalendarEvent] OAuth2 não configurado, ignorando deleção (desenvolvimento)")
    return
  }
  const calendar = google.calendar({ version: "v3", auth })
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId })
  } catch (err) {
    console.error("[deleteCalendarEvent] Erro ao deletar evento no Google Calendar:", err)
    // Se falhar por OAuth, apenas ignora
    if (err instanceof Error && err.message.includes("invalid_grant")) {
      console.warn("[deleteCalendarEvent] OAuth invalid_grant, ignorando deleção")
      return
    }
    throw err
  }
}
