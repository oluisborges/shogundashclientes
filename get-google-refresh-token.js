// Instruções para obter refresh token usando Google OAuth 2.0 Playground
//
// 1. Acesse: https://developers.google.com/oauthplayground/
// 2. Clique em "Configure" (ícone de engrenagem)
// 3. Em "OAuth Client ID", selecione "Use your own OAuth credentials"
// 4. Preencha:
//    - OAuth Client ID: SEU_CLIENT_ID_AQUI (do arquivo .env)
//    - OAuth Client Secret: SEU_CLIENT_SECRET_AQUI (do arquivo .env)
// 5. Clique em "Close"
// 6. Em "Step 1", selecione:
//    - Scope: https://www.googleapis.com/auth/calendar.events
// 7. Clique em "Authorize APIs"
// 8. Faça login e autorize
// 9. Em "Step 2", clique em "Exchange authorization code for tokens"
// 10. Copie o "Refresh token" e adicione ao .env como GOOGLE_OAUTH_REFRESH_TOKEN
//
// IMPORTANTE: Em "Step 1", marque a opção "Force approval (prompt=consent)" para garantir que o refresh token seja gerado

console.log('Siga as instruções acima para obter o refresh token usando o Google OAuth 2.0 Playground');
