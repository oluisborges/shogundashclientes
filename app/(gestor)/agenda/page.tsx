"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, X, CalendarRange, LogOut, User } from "lucide-react"

interface BlockedSlot {
  id: string
  blocked_date: string
  blocked_time: string | null
  reason: string | null
}

const MORNING_SLOTS   = ["10:00","11:00"]
const AFTERNOON_SLOTS = ["14:00","15:00","16:00"]
const WORKING_SLOTS   = [...MORNING_SLOTS, ...AFTERNOON_SLOTS]

function isDefaultBlocked(dayOfWeek: number, slot: string): boolean {
  if (dayOfWeek === 1) return true
  if (dayOfWeek === 2 && MORNING_SLOTS.includes(slot)) return true
  return false
}

const DAYS_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"]

function pad(n: number) { return String(n).padStart(2, "0") }

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

export default function GestorAgendaPage() {
  const router = useRouter()
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const [slots, setSlots] = useState<BlockedSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gestorName, setGestorName] = useState<string>("")

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1
  const monthKey = getMonthKey(viewDate)

  const loadSlots = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/gestor/blocked-slots?month=${monthKey}`)
      if (!res.ok) {
        const e = await res.json()
        setError(e.error ?? "Erro ao carregar bloqueios")
        return
      }
      const data = await res.json()
      setSlots(data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setLoading(false)
    }
  }, [monthKey])

  useEffect(() => {
    loadSlots()
  }, [loadSlots])

  useEffect(() => {
    // Busca dados do gestor
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(data => {
        if (!data.is_gestor) {
          router.push("/dashboard")
          return
        }
        setGestorName(data.full_name || "Gestor")
      })
  }, [router])

  // Índices para lookup rápido
  const blockedFullDays = new Set(slots.filter(s => !s.blocked_time).map(s => s.blocked_date))
  const blockedTimeMap = new Map<string, Map<string, BlockedSlot>>()
  for (const s of slots) {
    if (s.blocked_time) {
      if (!blockedTimeMap.has(s.blocked_date)) blockedTimeMap.set(s.blocked_date, new Map())
      blockedTimeMap.get(s.blocked_date)!.set(s.blocked_time, s)
    }
  }

  async function toggleFullDay(dateStr: string) {
    setSaving(true)
    setError(null)
    try {
      if (blockedFullDays.has(dateStr)) {
        // Remove bloqueio do dia
        const slot = slots.find(s => s.blocked_date === dateStr && !s.blocked_time)
        if (slot) {
          const res = await fetch(`/api/gestor/blocked-slots?id=${slot.id}`, { method: "DELETE" })
          if (!res.ok) {
            const e = await res.json()
            setError(e.error ?? "Erro ao desbloquear")
            return
          }
        }
      } else {
        // Remove bloqueios individuais do dia
        const timeSlots = slots.filter(s => s.blocked_date === dateStr && s.blocked_time)
        for (const s of timeSlots) {
          await fetch(`/api/gestor/blocked-slots?id=${s.id}`, { method: "DELETE" })
        }
        // Adiciona bloqueio do dia inteiro
        const res = await fetch("/api/gestor/blocked-slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocked_date: dateStr, reason: reason || null }),
        })
        if (!res.ok) {
          const e = await res.json()
          setError(e.error ?? "Erro ao bloquear dia")
          return
        }
      }
      await loadSlots()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
      setReason("")
    }
  }

  async function toggleSlot(dateStr: string, time: string) {
    setSaving(true)
    setError(null)
    try {
      const existing = blockedTimeMap.get(dateStr)?.get(time)
      if (existing) {
        const res = await fetch(`/api/gestor/blocked-slots?id=${existing.id}`, { method: "DELETE" })
        if (!res.ok) {
          const e = await res.json()
          setError(e.error ?? "Erro ao desbloquear horário")
          return
        }
      } else {
        const res = await fetch("/api/gestor/blocked-slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocked_date: dateStr, blocked_time: time, reason: reason || null }),
        })
        if (!res.ok) {
          const e = await res.json()
          setError(e.error ?? "Erro ao bloquear horário")
          return
        }
      }
      await loadSlots()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
    }
  }

  // Gera grid do calendário
  const firstDow = new Date(year, month - 1, 1).getDay()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  const daysTotal = getDaysInMonth(year, month)
  for (let d = 1; d <= daysTotal; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  function dayStyle(day: number) {
    const d = new Date(year, month - 1, day)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) return { bg: "#111F1A", border: "transparent", color: "#2a3d3a", cursor: "default" }

    const dateStr = toDateStr(year, month, day)
    if (blockedFullDays.has(dateStr)) return { bg: "rgba(255,80,80,0.12)", border: "rgba(255,80,80,0.5)", color: "#ff6060", cursor: "pointer" }
    if ((blockedTimeMap.get(dateStr)?.size ?? 0) > 0) return { bg: "rgba(255,160,40,0.1)", border: "rgba(255,160,40,0.5)", color: "#ffa028", cursor: "pointer" }
    if (dow === 1) return { bg: "rgba(100,120,180,0.08)", border: "rgba(100,120,180,0.3)", color: "#8090c0", cursor: "pointer" }
    if (dow === 2) return { bg: "rgba(100,120,180,0.05)", border: "rgba(100,120,180,0.2)", color: "#90a0c0", cursor: "pointer" }
    return { bg: "rgba(149,214,0,0.06)", border: "rgba(149,214,0,0.25)", color: "#95D600", cursor: "pointer" }
  }

  const selectedDateStr = selectedDay
  const selFullBlocked = selectedDateStr ? blockedFullDays.has(selectedDateStr) : false
  const selTimeBlocked = selectedDateStr ? (blockedTimeMap.get(selectedDateStr) ?? new Map()) : new Map<string, BlockedSlot>()

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  return (
    <div className="min-h-screen bg-shogun-bg-base">
      {/* Header */}
      <header className="bg-shogun-bg-elevated border-b border-shogun-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-shogun-accent/10 flex items-center justify-center">
              <User className="w-5 h-5 text-shogun-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold font-[var(--font-display)] text-shogun-text-primary">
                Configurar Agenda
              </h1>
              <p className="text-sm text-shogun-text-secondary">{gestorName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/area")}
              className="flex items-center gap-2 px-4 py-2 border border-shogun-border rounded-lg text-sm font-[var(--font-display)] text-shogun-text-secondary hover:text-shogun-text-primary hover:border-shogun-accent transition-colors"
            >
              <ChevronLeft size={16} />
              Voltar
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 border border-shogun-border rounded-lg text-sm font-[var(--font-display)] text-shogun-text-secondary hover:text-shogun-text-primary hover:border-shogun-accent transition-colors"
            >
              <LogOut size={16} />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm font-[var(--font-display)] flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-xl font-bold font-[var(--font-display)] text-shogun-text-primary flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-shogun-accent" />
            Minha Disponibilidade
          </h2>
          <p className="text-sm text-shogun-text-secondary mt-1">
            Bloqueie dias ou horários para que seus clientes não possam agendar reuniões nesses períodos
          </p>
        </div>

        {/* Navegação de mês */}
        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-[#1A3A31] border border-[#2A5040]">
          <button
            onClick={() => setViewDate(new Date(year, month - 2, 1))}
            className="p-1.5 rounded-lg text-shogun-text-muted hover:text-shogun-text-primary hover:bg-white/5 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-semibold font-[var(--font-display)] text-shogun-text-primary min-w-[160px] text-center">
            {MONTHS_PT[month - 1]} {year}
          </span>
          <button
            onClick={() => setViewDate(new Date(year, month, 1))}
            className="p-1.5 rounded-lg text-shogun-text-muted hover:text-shogun-text-primary hover:bg-white/5 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-4 text-xs font-[var(--font-display)] mb-4 flex-wrap">
          {[
            { color: "rgba(149,214,0,0.4)", label: "Disponível" },
            { color: "rgba(255,80,80,0.5)", label: "Dia Bloqueado" },
            { color: "rgba(255,160,40,0.5)", label: "Horários Bloqueados" },
            { color: "rgba(100,120,180,0.4)", label: "Padrão (Seg/Ter)" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-shogun-text-muted">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Calendário */}
          <div className="rounded-xl overflow-hidden" style={{ background: "#1A3A31", border: "1px solid #2A5040" }}>
            {/* Cabeçalho dias da semana */}
            <div className="grid grid-cols-7 border-b border-shogun-border">
              {DAYS_PT.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold font-[var(--font-display)] text-shogun-text-muted">
                  {d}
                </div>
              ))}
            </div>

            {/* Semanas */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-shogun-accent" />
              </div>
            ) : (
              weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-shogun-border/30 last:border-0">
                  {week.map((day, di) => {
                    if (!day) return <div key={di} className="h-16" />
                    const dateStr = toDateStr(year, month, day)
                    const { bg, border, color, cursor } = dayStyle(day)
                    const isSelected = selectedDay === dateStr
                    const timeBlockCount = blockedTimeMap.get(dateStr)?.size ?? 0

                    return (
                      <button
                        key={di}
                        disabled={cursor === "default"}
                        onClick={() => {
                          if (cursor === "default") return
                          setSelectedDay(selectedDay === dateStr ? null : dateStr)
                          setReason("")
                        }}
                        className="h-16 flex flex-col items-center justify-center gap-0.5 transition-all relative"
                        style={{
                          background: isSelected ? (blockedFullDays.has(dateStr) ? "rgba(255,80,80,0.22)" : "rgba(149,214,0,0.14)") : bg,
                          border: `1px solid ${isSelected ? (blockedFullDays.has(dateStr) ? "rgba(255,80,80,0.8)" : "#95D600") : border}`,
                          color,
                          cursor,
                          margin: "2px",
                          borderRadius: "8px",
                        }}
                      >
                        <span className="text-sm font-semibold font-[var(--font-data)]">{day}</span>
                        {blockedFullDays.has(dateStr) && <span className="text-[9px] font-[var(--font-display)]">Bloqueado</span>}
                        {!blockedFullDays.has(dateStr) && timeBlockCount > 0 && (
                          <span className="text-[9px] font-[var(--font-display)]">{timeBlockCount} bloq.</span>
                        )}
                        {!blockedFullDays.has(dateStr) && timeBlockCount === 0 && new Date(year, month - 1, day).getDay() === 1 && (
                          <span className="text-[8px] font-[var(--font-display)]">Padrão</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Painel lateral do dia selecionado */}
          <div className="rounded-xl p-4 space-y-4 bg-[#1A3A31] border border-[#2A5040]" style={{ minHeight: "200px" }}>
            {!selectedDay ? (
              <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                <CalendarRange size={28} className="text-shogun-text-muted mb-2" />
                <p className="text-sm text-shogun-text-muted font-[var(--font-display)]">
                  Clique em um dia para gerenciar disponibilidade
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold font-[var(--font-display)] text-shogun-text-primary">
                      {DAYS_PT[new Date(selectedDay + "T12:00:00").getDay()]}, {selectedDay.split("-").reverse().slice(0, 2).join("/")}
                    </p>
                    <p className="text-xs text-shogun-text-muted font-[var(--font-display)] mt-0.5">
                      {selFullBlocked ? "Dia inteiro bloqueado" : `${selTimeBlocked.size} horário(s) bloqueado(s)`}
                    </p>
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="text-shogun-text-muted hover:text-shogun-text-primary">
                    <X size={16} />
                  </button>
                </div>

                {/* Motivo */}
                <div>
                  <label className="block text-xs text-shogun-text-muted font-[var(--font-display)] mb-1">Motivo (opcional)</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ex: Reunião interna, feriado…"
                    className="w-full bg-shogun-bg-base border border-shogun-border rounded px-2 py-1.5 text-xs text-shogun-text-primary font-[var(--font-display)] focus:outline-none focus:border-shogun-accent"
                  />
                </div>

                {/* Botão bloquear/desbloquear dia inteiro */}
                <button
                  onClick={() => toggleFullDay(selectedDay)}
                  disabled={saving}
                  className="w-full py-2 rounded-lg text-xs font-semibold font-[var(--font-display)] transition-all disabled:opacity-50"
                  style={selFullBlocked
                    ? { background: "rgba(149,214,0,0.1)", border: "1px solid rgba(149,214,0,0.4)", color: "#95D600" }
                    : { background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff6060" }
                  }
                >
                  {selFullBlocked ? "✓ Desbloquear dia inteiro" : "Bloquear dia inteiro"}
                </button>

                {/* Horários individuais (só se o dia não estiver totalmente bloqueado) */}
                {!selFullBlocked && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold font-[var(--font-display)] text-shogun-text-secondary">Horários individuais</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {WORKING_SLOTS.map((slot) => {
                        const isBlocked = selTimeBlocked.has(slot)
                        const dow = new Date(selectedDay + "T12:00:00").getDay()
                        const isDefault = isDefaultBlocked(dow, slot)
                        return (
                          <button
                            key={slot}
                            onClick={() => toggleSlot(selectedDay, slot)}
                            disabled={saving}
                            className="py-1.5 rounded text-[11px] font-[var(--font-data)] transition-all disabled:opacity-50 flex flex-col items-center leading-tight"
                            style={isBlocked
                              ? { background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.5)", color: "#ff6060" }
                              : isDefault
                              ? { background: "rgba(100,120,180,0.1)", border: "1px solid rgba(100,120,180,0.4)", color: "#8090c0" }
                              : { background: "rgba(149,214,0,0.05)", border: "1px solid #2A5040", color: "#6a9a70" }
                            }
                          >
                            <span>{slot}</span>
                            {isDefault && !isBlocked && <span className="text-[8px] opacity-70">Padrão</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
