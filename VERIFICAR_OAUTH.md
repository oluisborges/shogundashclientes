# Passo a Passo para Verificar OAuth2 do Google

## Problema
Erro `unauthorized_client` ao tentar agendar no Google Calendar.

## Passo 1: Verificar se o servidor foi reiniciado

1. Pare o servidor atual (Ctrl+C no terminal)
2. Rode novamente: `npm run dev`
3. Tente agendar novamente

Se ainda der erro, continue para o passo 2.

## Passo 2: Verificar as credenciais no OAuth Playground

1. Acesse: https://developers.google.com/oauthplayground/
2. Clique no ícone de engrenagem (Configure) no canto superior direito
3. Em "OAuth Client ID", selecione "Use your own OAuth credentials"
4. Verifique se os campos estão EXATAMENTE assim:
   - **OAuth Client ID**: `730215081550-uidp171jui6pthp18fn799k4jkb5rob1.apps.googleusercontent.com`
   - **OAuth Client Secret**: (o seu secret atual)
5. Clique em "Close"

## Passo 3: Autorizar novamente

1. Em "Step 1", no campo "Select & authorize APIs", digite:
   ```
   https://www.googleapis.com/auth/calendar.events
   ```
2. Clique em "Authorize APIs"
3. **IMPORTANTE**: Marque a opção "Force approval (prompt=consent)"
4. Faça login com sua conta Google
5. Autorize o acesso ao calendário

## Passo 4: Obter o novo refresh token

1. Em "Step 2", clique em "Exchange authorization code for tokens"
2. Você verá o "Refresh token" na resposta
3. Copie esse valor (deve começar com `1//04` ou similar)

## Passo 5: Atualizar o arquivo .env

1. Abra o arquivo `.env` na raiz do projeto
2. Encontre a linha:
   ```
   GOOGLE_OAUTH_REFRESH_TOKEN="valor_antigo"
   ```
3. Substitua pelo novo token:
   ```
   GOOGLE_OAUTH_REFRESH_TOKEN="seu_novo_refresh_token_aqui"
   ```
4. Salve o arquivo

## Passo 6: Reiniciar o servidor

1. Pare o servidor (Ctrl+C)
2. Rode novamente: `npm run dev`

## Passo 7: Testar

1. Tente agendar uma reunião
2. O evento deve ser criado no Google Calendar

## Dicas Importantes

- **Sempre marque "Force approval (prompt=consent)"** - sem isso, o Google pode não gerar um refresh token
- **O Client ID no Playground deve ser EXATAMENTE o mesmo do .env**
- **O refresh token deve começar com `1//`** - se começar com outra coisa, pode estar incorreto
- **Sempre reinicie o servidor após alterar o .env** - o Next.js não recarrega variáveis de ambiente automaticamente

## Se ainda não funcionar

Pode ser que:
- O Client ID ou Secret estão incorretos
- O OAuth Client ID foi revogado no Google Cloud Console
- Você precisa criar um novo OAuth Client ID no Google Cloud Console

Nesse caso, entre em contato com o administrador do projeto Google Cloud.
