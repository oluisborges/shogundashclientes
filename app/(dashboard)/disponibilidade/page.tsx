"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, X, CalendarRange, AlertCircle, Lock } from "lucide-react"

interface BlockedSlot { id: string; blocked_date: string; blocked_time: string | null; reason: string | null }
interface WindowConfig { target_month: string; window_end: string }
interface BookedSlot { id: string; date: string; time: string; clientName: string; clientId: string }
interface Gestor { id: string; name: string; email: string }

const WORKING_SLOTS = ["10:00","11:00","14:00","15:00","16:00"]
const MORNING_SLOTS = ["10:00","11:00"]

function isDefaultBlocked(dayOfWeek: number, slot: string): boolean {
  if (dayOfWeek === 1) return true
  if (dayOfWeek === 2 && MORNING_SLOTS.includes(slot)) return true
  return false
}

function getDaySlots(_dayOfWeek: number): string[] {
  return WORKING_SLOTS
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

export default function DisponibilidadePage() {
  const router = useRouter()
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date()
    if (now.getDate() >= 25) return new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const [slots, setSlots]         = useState<BlockedSlot[]>([])
  const [bookings, setBookings]   = useState<BookedSlot[]>([])
  const [windowCfg, setWindowCfg] = useState<WindowConfig | null>(null)
  const [loading, setLoading]     = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [reason, setReason]       = useState("")
  const [saving, setSaving]       = useState(false)
  const [windowEndInput, setWindowEndInput] = useState("")
  const [savingWindow, setSavingWindow] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false)
  const [showBookingCancelModal, setShowBookingCancelModal] = useState(false)
  const [bookingToCancel, setBookingToCancel] = useState<BookedSlot | null>(null)

  const [gestores, setGestores] = useState<Gestor[]>([])
  const [selectedGestorId, setSelectedGestorId] = useState<string>("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [gestorSlots, setGestorSlots] = useState<BlockedSlot[]>([])

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1
  const monthKey = getMonthKey(viewDate)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [meRes, gestoresRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/admin/gestores")
      ])

      const meData = await meRes.json()
      setIsAdmin(meData.role === "admin" || meData.role === "moderador")

      if (gestoresRes.ok) {
        const gestoresData = await gestoresRes.json()
        setGestores(gestoresData || [])
      }

      const res = await fetch(`/api/admin/booking-config?month=${monthKey}`)
      if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao carregar config"); return }
      const data = await res.json()
      setSlots(data.slots ?? [])
      setBookings(data.bookings ?? [])
      setWindowCfg(data.window ?? null)
      setWindowEndInput(data.window?.window_end ?? "")

      if (selectedGestorId) {
        const gestorRes = await fetch(`/api/gestor/blocked-slots?month=${monthKey}&gestor_id=${selectedGestorId}`)
        if (gestorRes.ok) {
          const gestorData = await gestorRes.json()
          setGestorSlots(gestorData || [])
        }
      } else {
        setGestorSlots([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setLoading(false)
    }
  }, [monthKey, selectedGestorId])

  useEffect(() => { loadConfig() }, [loadConfig])

  // Bloqueios globais (excluindo overrides)
  const blockedFullDays = new Set<string>()
  const blockedTimeMap = new Map<string, Map<string, BlockedSlot>>()
  const overrideSet = new Set<string>()

  for (const s of slots) {
    if (s.reason === "DESBLOQUEIO_PADRAO") {
      if (s.blocked_time) overrideSet.add(`${s.blocked_date}:${s.blocked_time}`)
      continue
    }
    if (!s.blocked_time) {
      blockedFullDays.add(s.blocked_date)
    } else {
      if (!blockedTimeMap.has(s.blocked_date)) blockedTimeMap.set(s.blocked_date, new Map())
      blockedTimeMap.get(s.blocked_date)!.set(s.blocked_time, s)
    }
  }

  // Bloqueios do gestor
  const gestorBlockedFullDays = new Set<string>()
  const gestorBlockedTimeMap = new Map<string, Map<string, BlockedSlot>>()
  for (const s of gestorSlots) {
    if (!s.blocked_time) {
      gestorBlockedFullDays.add(s.blocked_date)
    } else {
      if (!gestorBlockedTimeMap.has(s.blocked_date)) gestorBlockedTimeMap.set(s.blocked_date, new Map())
      gestorBlockedTimeMap.get(s.blocked_date)!.set(s.blocked_time, s)
    }
  }

  // Agendamentos
  const bookedTimeMap = new Map<string, Map<string, BookedSlot>>()
  for (const b of bookings) {
    if (!bookedTimeMap.has(b.date)) bookedTimeMap.set(b.date, new Map())
    bookedTimeMap.get(b.date)!.set(b.time, b)
  }

  const daysTotal = getDaysInMonth(year, month)
  const windowEndDate = windowCfg?.window_end
    ? new Date(windowCfg.window_end + "T23:59:59")
    : new Date(year, month - 1, 15, 23, 59, 59)

  async function toggleFullDay(dateStr: string) {
    setSaving(true)
    setError(null)
    try {
      if (selectedGestorId) {
        if (gestorBlockedFullDays.has(dateStr)) {
          const slot = gestorSlots.find(s => s.blocked_date === dateStr && !s.blocked_time)
          if (slot) {
            const res = await fetch(`/api/gestor/blocked-slots?id=${slot.id}`, { method: "DELETE" })
            if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao desbloquear"); return }
          }
        } else {
          const res = await fetch("/api/gestor/blocked-slots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gestor_id: selectedGestorId, blocked_date: dateStr, reason: reason || null }),
          })
          if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao bloquear"); return }
        }
      } else {
        if (blockedFullDays.has(dateStr)) {
          const slot = slots.find(s => s.blocked_date === dateStr && !s.blocked_time && s.reason !== "DESBLOQUEIO_PADRAO")
          if (slot) {
            const res = await fetch(`/api/admin/booking-config/${slot.id}`, { method: "DELETE" })
            if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao desbloquear"); return }
          }
        } else {
          const timeSlots = slots.filter(s => s.blocked_date === dateStr && s.blocked_time && s.reason !== "DESBLOQUEIO_PADRAO")
          for (const s of timeSlots) {
            await fetch(`/api/admin/booking-config/${s.id}`, { method: "DELETE" })
          }
          const res = await fetch("/api/admin/booking-config", {
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
      }
      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
      setReason("")
    }
  }

  async function toggleDefaultOverride(dateStr: string, time: string) {
    setSaving(true)
    setError(null)
    try {
      const overrideKey = `${dateStr}:${time}`
      if (overrideSet.has(overrideKey)) {
        const slot = slots.find(s => s.blocked_date === dateStr && s.blocked_time === time && s.reason === "DESBLOQUEIO_PADRAO")
        if (slot) {
          const res = await fetch(`/api/admin/booking-config/${slot.id}`, { method: "DELETE" })
          if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao re-bloquear"); return }
        }
      } else {
        const res = await fetch("/api/admin/booking-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocked_date: dateStr, blocked_time: time, reason: "DESBLOQUEIO_PADRAO" }),
        })
        if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao desbloquear"); return }
      }
      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
    }
  }

  async function toggleSlot(dateStr: string, time: string) {
    const booked = bookedTimeMap.get(dateStr)?.get(time)
    if (booked) {
      setBookingToCancel(booked)
      setShowBookingCancelModal(true)
      return
    }

    const dayOfWeek = new Date(dateStr + "T12:00:00").getDay()
    if (isDefaultBlocked(dayOfWeek, time)) {
      await toggleDefaultOverride(dateStr, time)
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (selectedGestorId) {
        const existing = gestorBlockedTimeMap.get(dateStr)?.get(time)
        if (existing) {
          const res = await fetch(`/api/gestor/blocked-slots?id=${existing.id}`, { method: "DELETE" })
          if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao desbloquear"); return }
        } else {
          const res = await fetch("/api/gestor/blocked-slots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gestor_id: selectedGestorId, blocked_date: dateStr, blocked_time: time, reason: reason || null }),
          })
          if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao bloquear"); return }
        }
      } else {
        const existing = blockedTimeMap.get(dateStr)?.get(time)
        if (existing) {
          const res = await fetch(`/api/admin/booking-config/${existing.id}`, { method: "DELETE" })
          if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao desbloquear horário"); return }
        } else {
          const res = await fetch("/api/admin/booking-config", {
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
      }
      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
    }
  }

  async function cancelBookingAndRefund() {
    if (!bookingToCancel) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/agendamento/${bookingToCancel.id}`, { method: "DELETE" })
      if (!res.ok) {
        const e = await res.json()
        setError(e.error ?? "Erro ao cancelar agendamento")
        return
      }
      setShowBookingCancelModal(false)
      setBookingToCancel(null)
      await loadConfig()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSaving(false)
    }
  }

  async function saveWindowEnd() {
    if (!windowEndInput) return
    setShowCloseConfirmModal(true)
  }

  async function confirmSaveWindowEnd() {
    setSavingWindow(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/booking-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_month: monthKey, window_end: windowEndInput }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error ?? "Erro ao salvar janela"); return }
      await loadConfig()
      setShowCloseConfirmModal(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de rede")
    } finally {
      setSavingWindow(false)
    }
  }

  // Grid do calendário
  const firstDow = new Date(year, month - 1, 1).getDay()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysTotal; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  function dayStatus(day: number): "weekend" | "after-window" | "full-blocked" | "partial-blocked" | "default-blocked" | "available" {
    const d = new Date(year, month - 1, day)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) return "weekend"
    if (windowEndDate && d > windowEndDate) return "after-window"
    const dateStr = toDateStr(year, month, day)

    const isGlobalBlocked = blockedFullDays.has(dateStr)
    const isGestorBlocked = selectedGestorId && gestorBlockedFullDays.has(dateStr)
    if (isGlobalBlocked || isGestorBlocked) return "full-blocked"

    const timeBlockCount = (blockedTimeMap.get(dateStr)?.size ?? 0) + (gestorBlockedTimeMap.get(dateStr)?.size ?? 0)
    if (timeBlockCount > 0) return "partial-blocked"

    if (dow === 1) {
      const allOverridden = WORKING_SLOTS.every(s => overrideSet.has(`${dateStr}:${s}`))
      if (!allOverridden) return "default-blocked"
    }
    if (dow === 2) {
      const morningOverridden = MORNING_SLOTS.every(s => overrideSet.has(`${dateStr}:${s}`))
      if (!morningOverridden) return "partial-blocked"
    }

    return "available"
  }

  function dayStyle(status: ReturnType<typeof dayStatus>) {
    switch (status) {
      case "weekend":         return { bg: "#111F1A", border: "transparent", color: "#2a3d3a", cursor: "default" }
      case "after-window":    return { bg: "#152E25", border: "#1A3A31", color: "#4A6A5A", cursor: "pointer" }
      case "full-blocked":    return { bg: "rgba(255,80,80,0.12)", border: "rgba(255,80,80,0.5)", color: "#ff6060", cursor: "pointer" }
      case "partial-blocked": return { bg: "rgba(255,160,40,0.1)", border: "rgba(255,160,40,0.5)", color: "#ffa028", cursor: "pointer" }
      case "default-blocked": return { bg: "rgba(255,160,40,0.08)", border: "rgba(255,160,40,0.3)", color: "#cc8820", cursor: "pointer" }
      case "available":       return { bg: "rgba(149,214,0,0.06)", border: "rgba(149,214,0,0.25)", color: "#95D600", cursor: "pointer" }
    }
  }

  const selectedDateStr = selectedDay
  const selFullBlocked = selectedDateStr ? (blockedFullDays.has(selectedDateStr) || (selectedGestorId ? gestorBlockedFullDays.has(selectedDateStr) : false)) : false
  const selTimeBlocked = selectedDateStr ? (blockedTimeMap.get(selectedDateStr) ?? new Map()) : new Map<string, BlockedSlot>()
  const selGestorTimeBlocked = selectedDateStr ? (gestorBlockedTimeMap.get(selectedDateStr) ?? new Map()) : new Map<string, BlockedSlot>()
  const selTimeBooked = selectedDateStr ? (bookedTimeMap.get(selectedDateStr) ?? new Map()) : new Map<string, BookedSlot>()
  const selDayOfWeek = selectedDay ? new Date(selectedDay + "T12:00:00").getDay() : 0

  function CloseConfirmModal() {
    if (!showCloseConfirmModal) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCloseConfirmModal(false)} />
        <div className="relative w-full max-w-md bg-shogun-bg-elevated border border-shogun-border rounded-xl shadow-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle size={20} className="text-red-500" />
            </div>
            <div>
              <h3 className="font-[var(--font-display)] text-lg font-bold text-shogun-text-primary">
                Confirmar Fechamento da Agenda
              </h3>
              <p className="text-sm text-shogun-text-secondary mt-1">
                Esta ação impedirá novos agendamentos após a data selecionada.
              </p>
            </div>
          </div>
          <div className="bg-shogun-bg-base border border-shogun-border rounded-lg p-3 mb-4">
            <p className="text-sm font-[var(--font-display)] text-shogun-text-secondary">Data de fechamento:</p>
            <p className="text-base font-semibold font-[var(--font-display)] text-shogun-text-primary">
              {windowEndInput.split("-").reverse().join("/")}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowCloseConfirmModal(false)} className="flex-1 px-4 py-2 bg-shogun-bg-base border border-shogun-border rounded-lg text-sm font-[var(--font-display)] text-shogun-text-primary hover:bg-shogun-bg-surface transition-colors">Cancelar</button>
            <button onClick={confirmSaveWindowEnd} disabled={savingWindow} className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-[var(--font-display)] font-semibold transition-colors disabled:opacity-50">
              {savingWindow ? "Fechando..." : "Confirmar Fechamento"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function BookingCancelConfirmModal() {
    if (!showBookingCancelModal || !bookingToCancel) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBookingCancelModal(false)} />
        <div className="relative w-full max-w-md bg-shogun-bg-elevated border border-shogun-border rounded-xl shadow-2xl p-6 z-50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
              <AlertCircle size={20} className="text-orange-500" />
            </div>
            <div>
              <h3 className="font-[var(--font-display)] text-lg font-bold text-shogun-text-primary">Cancelar Agendamento</h3>
              <p className="text-sm text-shogun-text-secondary mt-1">Esta ação removerá a reunião e devolverá o crédito ao cliente.</p>
            </div>
          </div>
          <div className="bg-shogun-bg-base border border-shogun-border rounded-lg p-3 mb-4">
            <p className="text-sm font-[var(--font-display)] text-shogun-text-secondary">Data e horário:</p>
            <p className="text-base font-semibold font-[var(--font-display)] text-shogun-text-primary">
              {bookingToCancel.date.split("-").reverse().join("/")} às {bookingToCancel.time}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowBookingCancelModal(false)} className="flex-1 px-4 py-2 bg-shogun-bg-base border border-shogun-border rounded-lg text-sm font-[var(--font-display)] text-shogun-text-primary hover:bg-shogun-bg-surface transition-colors">Cancelar</button>
            <button onClick={cancelBookingAndRefund} disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-[var(--font-display)] font-semibold transition-colors disabled:opacity-50">
              {saving ? "Cancelando..." : "Confirmar Cancelamento"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <CloseConfirmModal />
      <BookingCancelConfirmModal />

      <div className="flex items-center gap-3">
        <CalendarRange size={22} className="text-shogun-accent" />
        <h1 className="text-2xl font-bold font-[var(--font-display)] text-shogun-text-primary">Disponibilidade</h1>
      </div>

      {/* Seletor de Gestor */}
      {isAdmin && gestores.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-shogun-bg-elevated border border-shogun-border">
          <span className="text-sm font-[var(--font-display)] text-shogun-text-secondary">Visualizar como:</span>
          <select
            value={selectedGestorId}
            onChange={(e) => { setSelectedGestorId(e.target.value); setSelectedDay(null) }}
            className="bg-shogun-bg-base border border-shogun-border rounded px-3 py-1.5 text-sm text-shogun-text-primary font-[var(--font-display)] focus:outline-none focus:border-shogun-accent"
          >
            <option value="">Agenda Global (todos)</option>
            {gestores.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {selectedGestorId && (
            <span className="text-xs text-shogun-accent font-[var(--font-display)]">
              Bloqueios afetam apenas clientes deste gestor
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg text-sm font-[var(--font-display)]" style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff6060" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Navegação de mês + janela */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl" style={{ background: "#1A3A31", border: "1px solid #2A5040" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setViewDate(new Date(year, month - 2, 1))} className="p-1.5 rounded-lg text-shogun-text-muted hover:text-shogun-text-primary hover:bg-white/5 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-semibold font-[var(--font-display)] text-shogun-text-primary min-w-[160px] text-center">
            {MONTHS_PT[month - 1]} {year}
          </span>
          <button onClick={() => setViewDate(new Date(year, month, 1))} className="p-1.5 rounded-lg text-shogun-text-muted hover:text-shogun-text-primary hover:bg-white/5 transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-[var(--font-display)] text-shogun-text-muted">Fechar agenda em:</span>
          <input
            type="date"
            value={windowEndInput}
            onChange={(e) => setWindowEndInput(e.target.value)}
            className="bg-shogun-bg-base border border-shogun-border rounded px-2 py-1 text-sm text-shogun-text-primary font-[var(--font-display)] focus:outline-none focus:border-shogun-accent"
          />
          <button onClick={saveWindowEnd} disabled={savingWindow || !windowEndInput} className="px-3 py-1 rounded text-xs font-semibold font-[var(--font-display)] bg-shogun-accent text-shogun-bg-base hover:bg-shogun-accent/80 disabled:opacity-40 transition-colors">
            {savingWindow ? "…" : "Salvar"}
          </button>
          {windowCfg?.window_end && (
            <span className="text-xs text-shogun-text-muted font-[var(--font-display)]">
              Até {windowCfg.window_end.split("-").reverse().join("/")}
            </span>
          )}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-[var(--font-display)]">
        {[
          { color: "rgba(149,214,0,0.4)", label: "Disponível" },
          { color: "rgba(255,80,80,0.5)", label: "Bloqueado" },
          { color: "rgba(255,160,40,0.4)", label: "Padrão (Seg/Ter)" },
          { color: "rgba(99,102,241,0.55)", label: "Agendado" },
          { color: "#2A5040", label: "Fora da janela" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-shogun-text-muted">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Calendário */}
        <div className="rounded-xl overflow-hidden" style={{ background: "#1A3A31", border: "1px solid #2A5040" }}>
          <div className="grid grid-cols-7 border-b border-shogun-border">
            {DAYS_PT.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold font-[var(--font-display)] text-shogun-text-muted">{d}</div>
            ))}
          </div>

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
                  const status = dayStatus(day)
                  const { bg, border, color, cursor } = dayStyle(status)
                  const isSelected = selectedDay === dateStr
                  const bookedCount = bookedTimeMap.get(dateStr)?.size ?? 0

                  return (
                    <button
                      key={di}
                      disabled={status === "weekend"}
                      onClick={() => {
                        if (status === "weekend") return
                        setSelectedDay(selectedDay === dateStr ? null : dateStr)
                        setReason("")
                      }}
                      className="h-16 flex flex-col items-center justify-center gap-0.5 transition-all relative"
                      style={{
                        background: isSelected ? (status === "full-blocked" ? "rgba(255,80,80,0.22)" : "rgba(149,214,0,0.14)") : bg,
                        border: `1px solid ${isSelected ? (status === "full-blocked" ? "rgba(255,80,80,0.8)" : "#95D600") : border}`,
                        color,
                        cursor,
                        margin: "2px",
                        borderRadius: "8px",
                      }}
                    >
                      <span className="text-sm font-semibold font-[var(--font-data)]">{day}</span>
                      {status === "full-blocked" && <span className="text-[9px] font-[var(--font-display)]">Bloqueado</span>}
                      {status === "default-blocked" && <span className="text-[9px] font-[var(--font-display)]">Padrão</span>}
                      {status === "partial-blocked" && <span className="text-[9px] font-[var(--font-display)]">Parcial</span>}
                      {status === "after-window" && <span className="text-[9px] font-[var(--font-display)] text-shogun-text-muted">Fora</span>}
                      {status === "available" && bookedCount > 0 && <span className="text-[9px] font-[var(--font-display)]">{bookedCount} agend.</span>}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Painel lateral */}
        <div className="rounded-xl p-4 space-y-4" style={{ background: "#1A3A31", border: "1px solid #2A5040", minHeight: "200px" }}>
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
                    {DAYS_PT[selDayOfWeek]}, {selectedDay.split("-").reverse().slice(0, 2).join("/")}
                  </p>
                  <p className="text-xs text-shogun-text-muted font-[var(--font-display)] mt-0.5">
                    {selFullBlocked ? "Dia inteiro bloqueado" : `${selTimeBlocked.size + selGestorTimeBlocked.size} bloqueado(s) · ${selTimeBooked.size} agendado(s)`}
                  </p>
                  {(selDayOfWeek === 1 || selDayOfWeek === 2) && (
                    <p className="text-[10px] text-yellow-500/80 font-[var(--font-display)] mt-0.5 flex items-center gap-1">
                      <Lock size={10} />
                      {selDayOfWeek === 1 ? "Segunda: todos horários bloqueados por padrão" : "Terça: manhã bloqueada por padrão"}
                    </p>
                  )}
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
                {selFullBlocked ? "Desbloquear dia inteiro" : "Bloquear dia inteiro"}
              </button>

              {/* Horários individuais */}
              {!selFullBlocked && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold font-[var(--font-display)] text-shogun-text-secondary">Horários</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {getDaySlots(selDayOfWeek).map((slot) => {
                      const isBlocked = selTimeBlocked.has(slot) || selGestorTimeBlocked.has(slot)
                      const bookedBy = selTimeBooked.get(slot)
                      const isBooked = !!bookedBy
                      const isDefault = isDefaultBlocked(selDayOfWeek, slot)
                      const isOverridden = overrideSet.has(`${selectedDay}:${slot}`)
                      const isDefaultAndBlocked = isDefault && !isOverridden

                      const style = isBooked
                        ? { background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.55)", color: "#a5b4fc" }
                        : isBlocked
                          ? { background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.5)", color: "#ff6060" }
                          : isDefaultAndBlocked
                            ? { background: "rgba(255,160,40,0.12)", border: "1px solid rgba(255,160,40,0.4)", color: "#ffa028" }
                            : { background: "rgba(149,214,0,0.05)", border: "1px solid #2A5040", color: "#6a9a70" }

                      return (
                        <button
                          key={slot}
                          onClick={() => toggleSlot(selectedDay, slot)}
                          disabled={saving}
                          title={isBooked ? bookedBy.clientName : isDefaultAndBlocked ? "Bloqueio padrão — clique para desbloquear" : undefined}
                          className="py-2 rounded text-[11px] font-[var(--font-data)] transition-all disabled:opacity-100 flex flex-col items-center leading-tight"
                          style={style}
                        >
                          <span>{slot}</span>
                          {isBooked && (
                            <span className="text-[8px] font-[var(--font-display)] opacity-80 max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-1">
                              {bookedBy.clientName.length > 9 ? bookedBy.clientName.slice(0, 9) + "…" : bookedBy.clientName}
                            </span>
                          )}
                          {isDefaultAndBlocked && !isBooked && (
                            <span className="text-[8px] font-[var(--font-display)] opacity-70">Padrão</span>
                          )}
                          {isDefault && isOverridden && !isBooked && !isBlocked && (
                            <span className="text-[8px] font-[var(--font-display)] opacity-70">Liberado</span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Bloqueios de horários antigos/legados que não estão nos WORKING_SLOTS */}
                  {(() => {
                    const legacyBlocks = Array.from(selTimeBlocked.entries()).filter(([time]) => !WORKING_SLOTS.includes(time))
                    if (legacyBlocks.length === 0) return null
                    return (
                      <div className="mt-2 pt-2 border-t border-shogun-border/30">
                        <p className="text-[10px] font-[var(--font-display)] text-shogun-text-muted mb-1">Bloqueios legados (horários antigos)</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {legacyBlocks.map(([time, slot]) => (
                            <button
                              key={time}
                              onClick={async () => {
                                setSaving(true)
                                try {
                                  await fetch(`/api/admin/booking-config/${slot.id}`, { method: "DELETE" })
                                  await loadConfig()
                                } finally { setSaving(false) }
                              }}
                              disabled={saving}
                              className="py-2 rounded text-[11px] font-[var(--font-data)] transition-all disabled:opacity-50 flex flex-col items-center"
                              style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.5)", color: "#ff6060" }}
                            >
                              <span>{time}</span>
                              <span className="text-[8px] font-[var(--font-display)] opacity-70">Remover</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
