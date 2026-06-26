# Como Gerar Novo Refresh Token do Google OAuth2

## Problema
O refresh token atual está inválido (erro `invalid_grant`). Você precisa gerar um novo.

## Passo a Passo

### 1. Acesse o Google OAuth 2.0 Playground
https://developers.google.com/oauthplayground/

### 2. Configure as credenciais
- Clique no ícone de engrenagem (Configure) no canto superior direito
- Em "OAuth Client ID", selecione "Use your own OAuth credentials"
- Preencha com suas credenciais atuais:
  - **OAuth Client ID**: `SEU_CLIENT_ID_AQUI` (do arquivo .env)
  - **OAuth Client Secret**: `SEU_CLIENT_SECRET_AQUI` (do arquivo .env)
- Clique em "Close"

### 3. Autorize o acesso
- Em "Step 1", no campo "Select & authorize APIs", digite:
  ```
  https://www.googleapis.com/auth/calendar.events
  ```
- Clique em "Authorize APIs"
- **IMPORTANTE**: Marque a opção "Force approval (prompt=consent)" para garantir que o refresh token seja gerado
- Faça login com sua conta Google
- Autorize o acesso ao calendário

### 4. Obtenha o refresh token
- Em "Step 2", clique em "Exchange authorization code for tokens"
- Você verá o "Refresh token" na resposta
- Copie esse valor (começa com `1//`)

### 5. Atualize o arquivo .env
Abra o arquivo `.env` e substitua a linha:
```
GOOGLE_OAUTH_REFRESH_TOKEN="valor_antigo"
```
Por:
```
GOOGLE_OAUTH_REFRESH_TOKEN="seu_novo_refresh_token_aqui"
```

### 6. Reinicie o servidor
```bash
# Pare o servidor (Ctrl+C)
npm run dev
```

### 7. Teste o agendamento
- Acesse a aplicação
- Tente agendar uma reunião
- O evento deve ser criado no Google Calendar

## Verificação
Se quiser testar se o novo token funciona, execute:
```bash
node test-google-oauth.js
```

Você deve ver a mensagem: "🎉 Todos os testes passaram! OAuth2 está funcionando corretamente."
