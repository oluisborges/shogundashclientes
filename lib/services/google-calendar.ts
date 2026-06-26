import { google } from "googleapis"
import { v4 as uuidv4 } from "uuid"
import { createAdminClient } from "@/lib/supabase/admin"

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
const FREEBUSY_CALENDAR_ID = process.env.GOOGLE_FREEBUSY_CALENDAR_ID ?? CALENDAR_ID

const TZ = "America/Sao_Paulo"

const MORNING_SLOTS   = ["09:30","10:00","10:30","11:00","11:30"]
const AFTERNOON_SLOTS = ["14:00","14:30","15:00","15:30","16:00","16:30"]
const WORKING_SLOTS   = [...MORNING_SLOTS, ...AFTERNOON_SLOTS]

const FIXED_ATTENDEES = ["leandrosamurait@gmail.com", "xluisborges@gmail.com"]
const MARMITARIAS_ATTENDEE = "leo.gon.dacruz@gmail.com"

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

async function getOAuthAuth() {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais OAuth2 não configuradas (GOOGLE_OAUTH_CLIENT_ID/GOOGLE_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_CLIENT_SECRET).")
  }

  let refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? process.env.GOOGLE_CALENDAR_REFRESH_TOKEN

  if (!refreshToken) {
    try {
      const adminClient = createAdminClient()
      const { data } = await adminClient
        .from("system_settings")
        .select("value")
        .eq("key", "google_calendar_refresh_token")
        .single()
      refreshToken = data?.value ?? undefined
    } catch (err) {
      console.warn("[getOAuthAuth] Erro ao buscar refresh token do banco:", err)
    }
  }

  if (!refreshToken) {
    throw new Error("Refresh token não configurado. Configure GOOGLE_OAUTH_REFRESH_TOKEN ou conecte o Google Calendar via /configuracoes.")
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })
  return oauth2
}

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

export function getCurrentCycle(): string {
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
    ? new Date(year, month, 1)
    : new Date(year, month - 1, 1)

  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

export function isBookingWindowOpen(): boolean {
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

  console.log("[isBookingWindowOpen] Dia:", day, "- Janela aberta?", day <= 15 || day >= 25)

  return day <= 15 || day >= 25
}

export interface AvailableDay {
  date:  string
  label: string
  slots: string[]
}

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
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    const dateStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    if (blockedFullDays.has(dateStr)) continue
    if (windowEnd && date > windowEnd) continue

    const daySlots = dayOfWeek === 1
      ? WORKING_SLOTS.filter(slot => slot >= "11:00")
      : WORKING_SLOTS

    const slots: string[] = []
    for (const slot of daySlots) {
      const blockedTimes = blockedTimeSlots.get(dateStr)
      if (!blockedTimes || !blockedTimes.has(slot)) {
        slots.push(slot)
      }
    }

    if (slots.length > 0) {
      const label = date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
      result.push({ date: dateStr, label, slots })
    }
  }

  return result
}

export async function getAvailableSlots(
  targetYear: number,
  targetMonth: number,
  blockedFullDays: Set<string> = new Set(),
  blockedTimeSlots: Map<string, Set<string>> = new Map(),
  windowEnd?: Date
): Promise<AvailableDay[]> {
  let auth: ReturnType<typeof getAuth> | undefined
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

      const dayWorkingSlots = dow === 1
        ? WORKING_SLOTS.filter(slot => slot >= "11:00")
        : WORKING_SLOTS

      const now = new Date()
      const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000)

      const availableSlots = dayWorkingSlots.filter(
        (slot) => {
          if (busySet.has(`${dateStr}T${slot}`) || dayBlockedTimes.has(slot)) {
            return false
          }
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

export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  if (!CALENDAR_ID) {
    throw new Error("GOOGLE_CALENDAR_ID não configurado.")
  }

  const auth = await getOAuthAuth()
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

  console.log("[createCalendarEvent] Criando evento:", { title, attendees: allAttendees.map(a => a.email) })

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

  console.log("[createCalendarEvent] Evento criado com sucesso:", res.data.id)
  return res.data.id!
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (!CALENDAR_ID) {
    console.warn("[deleteCalendarEvent] GOOGLE_CALENDAR_ID não configurado, ignorando deleção")
    return
  }

  if (eventId.startsWith("mock-event-")) {
    console.warn("[deleteCalendarEvent] Evento mockado, ignorando deleção:", eventId)
    return
  }

  const auth = await getOAuthAuth()
  const calendar = google.calendar({ version: "v3", auth })

  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: "all" })
  console.log("[deleteCalendarEvent] Evento deletado:", eventId)
}
