# Configurar Google OAuth2 para Produção

## Problema
O agendamento funciona localmente (localhost) mas não no servidor (https://dash.shogun.app.br/).

## Causa
O refresh token atual está vinculado apenas ao `localhost:3000` e não funciona no domínio de produção.

## Solução

### Passo 1: Adicionar URL de produção no Google Cloud Console

1. Acesse: https://console.cloud.google.com/apis/credentials?project=730215081550
2. Clique no OAuth 2.0 Client ID que você está usando
3. Em "Authorized redirect URIs", adicione:
   - `https://dash.shogun.app.br/**`
   - `https://dash.shogun.app.br/auth/callback` (se tiver rota de callback)
4. Clique em "Save"

### Passo 2: Gerar novo refresh token para produção

1. Acesse: https://developers.google.com/oauthplayground/
2. Clique no ícone de engrenagem (Configure) no canto superior direito
3. Em "OAuth Client ID", selecione "Use your own OAuth credentials"
4. Configure:
   - **OAuth Client ID**: `730215081550-uidp171jui6pthp18fn799k4jkb5rob1.apps.googleusercontent.com`
   - **OAuth Client Secret**: (o seu secret atual)
5. Clique em "Close"

6. Em "Step 1", no campo "Select & authorize APIs", digite:
   ```
   https://www.googleapis.com/auth/calendar.events
   ```
7. Clique em "Authorize APIs"
8. **IMPORTANTE**: Marque a opção "Force approval (prompt=consent)"
9. Faça login com sua conta Google
10. Autorize o acesso ao calendário

11. Em "Step 2", clique em "Exchange authorization code for tokens"
12. Você verá o "Refresh token" na resposta
13. Copie esse valor (deve começar com `1//04` ou similar)

### Passo 3: Configurar variáveis de ambiente no servidor

#### Se for Vercel:

1. Acesse o projeto no Vercel
2. Vá em Settings > Environment Variables
3. Adicione/Atualize as seguintes variáveis:
   - `GOOGLE_OAUTH_CLIENT_ID`: `730215081550-uidp171jui6pthp18fn799k4jkb5rob1.apps.googleusercontent.com`
   - `GOOGLE_OAUTH_CLIENT_SECRET`: (o seu secret atual)
   - `GOOGLE_OAUTH_REFRESH_TOKEN`: (o novo refresh token gerado no passo 2)
   - `GOOGLE_CALENDAR_ID`: (o ID do calendário atual)
4. Clique em "Save"
5. Faça um novo deploy (ou aguarde o próximo deploy automático)

#### Se for outro host:

Adicione as mesmas variáveis de ambiente no painel de configuração do seu host.

### Passo 4: Testar

1. Após o deploy, tente agendar uma reunião no servidor
2. Verifique se o evento aparece no Google Calendar
3. Se ainda não funcionar, verifique os logs do servidor para erros

## Dicas Importantes

- **Sempre marque "Force approval (prompt=consent)"** - sem isso, o Google pode não gerar um refresh token
- **O refresh token deve começar com `1//`** - se começar com outra coisa, pode estar incorreto
- **O redirect URI no OAuth Playground deve estar configurado** - geralmente é `https://developers.google.com/oauthplayground/`
- **As variáveis de ambiente no servidor devem ser exatamente iguais às locais** (exceto o refresh token que é novo)

## Troubleshooting

Se ainda não funcionar após seguir esses passos:

1. Verifique se o OAuth Client ID está correto no Google Cloud Console
2. Verifique se o calendário ID está correto
3. Verifique os logs do servidor para erros específicos
4. Pode ser necessário criar um novo OAuth Client ID específico para produção
