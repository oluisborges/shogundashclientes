"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Users, Calendar, LogOut, Building2, Mail, User } from "lucide-react"

interface Client {
  id: string
  business_name: string
  meta_account_id: string | null
  cnpj: string | null
  niche: string | null
  active: boolean
  email: string | null
  full_name: string | null
}

export default function GestorDashboardPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [gestorName, setGestorName] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // Busca dados do gestor logado
      const meRes = await fetch("/api/auth/me")
      const meData = await meRes.json()
      
      if (!meData.is_gestor) {
        router.push("/dashboard")
        return
      }
      
      setGestorName(meData.full_name || "Gestor")

      // Busca clientes do gestor
      const clientsRes = await fetch("/api/gestor/clients")
      if (!clientsRes.ok) {
        throw new Error("Erro ao carregar clientes")
      }
      
      const clientsData = await clientsRes.json()
      setClients(clientsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  const getNicheLabel = (niche: string | null) => {
    switch (niche) {
      case "marmitarias": return "Marmitarias"
      case "delivery": return "Delivery"
      case "generica": return "Genérica"
      default: return "—"
    }
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
                Área do Gestor
              </h1>
              <p className="text-sm text-shogun-text-secondary">{gestorName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/gestor/agenda")}
              className="flex items-center gap-2 px-4 py-2 bg-shogun-accent text-shogun-bg-base rounded-lg text-sm font-[var(--font-display)] font-semibold hover:bg-shogun-accent/90 transition-colors"
            >
              <Calendar size={16} />
              Configurar Agenda
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
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm font-[var(--font-display)]">
            {error}
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-xl font-bold font-[var(--font-display)] text-shogun-text-primary flex items-center gap-2">
            <Users className="w-5 h-5 text-shogun-accent" />
            Meus Clientes
          </h2>
          <p className="text-sm text-shogun-text-secondary mt-1">
            Visualize e gerencie os clientes vinculados a você
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-shogun-accent" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-12 bg-shogun-bg-elevated rounded-xl border border-shogun-border">
            <Building2 className="w-12 h-12 text-shogun-text-muted mx-auto mb-4" />
            <p className="text-shogun-text-secondary font-[var(--font-display)]">
              Nenhum cliente vinculado a você ainda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => (
              <div
                key={client.id}
                className="bg-shogun-bg-elevated rounded-xl border border-shogun-border p-5 hover:border-shogun-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-shogun-accent/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-shogun-accent" />
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-[var(--font-display)] ${
                      client.active
                        ? "bg-green-500/10 text-green-500"
                        : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    {client.active ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <h3 className="font-bold font-[var(--font-display)] text-shogun-text-primary mb-1">
                  {client.business_name}
                </h3>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-shogun-text-secondary">
                    <User size={14} />
                    <span>{client.full_name || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-shogun-text-secondary">
                    <Mail size={14} />
                    <span>{client.email || "—"}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-shogun-border/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-shogun-text-muted">Nicho:</span>
                    <span className="text-shogun-text-secondary font-medium">
                      {getNicheLabel(client.niche)}
                    </span>
                  </div>
                  {client.meta_account_id && (
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span className="text-shogun-text-muted">Meta ID:</span>
                      <span className="text-shogun-text-secondary font-mono">
                        {client.meta_account_id}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
