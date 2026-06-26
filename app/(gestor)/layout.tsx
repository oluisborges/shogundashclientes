import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Área do Gestor - Shogun",
  description: "Dashboard e configurações para gestores",
}

export default function GestorLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="min-h-screen bg-shogun-bg-base">
      {children}
    </div>
  )
}
