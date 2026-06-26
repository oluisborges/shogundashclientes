import { NextResponse } from "next/server"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  if (error) {
    return NextResponse.redirect(
      new URL(`/configuracoes?error=${encodeURIComponent(error)}`, request.url)
    )
  }

  if (!code) {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID
    const redirectUri = process.env.GOOGLE_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: "Credenciais OAuth não configuradas" },
        { status: 500 }
      )
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    authUrl.searchParams.set("client_id", clientId)
    authUrl.searchParams.set("redirect_uri", redirectUri)
    authUrl.searchParams.set("response_type", "code")
    authUrl.searchParams.set("scope", [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ].join(" "))
    authUrl.searchParams.set("access_type", "offline")
    authUrl.searchParams.set("prompt", "consent")

    return NextResponse.redirect(authUrl)
  }

  try {
    const clientId = (process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID)!
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET)!
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
    const { tokens } = await oauth2Client.getToken(code)

    console.log("Tokens recebidos:", {
      access_token: tokens.access_token?.substring(0, 20) + "...",
      refresh_token: tokens.refresh_token ? "RECEIVED" : "NOT RECEIVED",
      expiry_date: tokens.expiry_date
    })

    if (tokens.refresh_token) {
      const adminClient = createAdminClient()
      const { error: upsertError } = await adminClient
        .from("system_settings")
        .upsert({
          key: "google_calendar_refresh_token",
          value: tokens.refresh_token,
          updated_at: new Date().toISOString()
        }, { onConflict: "key" })

      if (upsertError) {
        console.error("Erro ao salvar refresh token:", upsertError)
      } else {
        console.log("Refresh token salvo com sucesso no banco")
      }
    }

    return NextResponse.redirect(
      new URL("/configuracoes?success=google_calendar_connected", request.url)
    )
  } catch (err) {
    console.error("Erro ao trocar código por tokens:", err)
    return NextResponse.redirect(
      new URL("/configuracoes?error=token_exchange_failed", request.url)
    )
  }
}
