import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ 
        role: null,
        full_name: null,
        email: null
      })
    }

    // Usa admin client para ignorar RLS
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single()

    // Verifica se é gestor
    const { data: gestor } = await admin
      .from("gestores")
      .select("id, name")
      .eq("user_id", user.id)
      .eq("active", true)
      .single()

    return NextResponse.json({ 
      role: profile?.role ?? null,
      full_name: profile?.full_name || gestor?.name || null,
      email: user.email || null,
      is_gestor: !!gestor,
      gestor_id: gestor?.id || null,
    })
  } catch {
    return NextResponse.json({ 
      role: null,
      full_name: null,
      email: null
    })
  }
}
