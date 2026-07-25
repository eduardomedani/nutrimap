# Notificações push — passo a passo de deploy (Fase 2)

O código já está pronto no repositório. Falta configurar a infraestrutura. Faça na ordem.

## 1. Gerar as chaves VAPID
No terminal (precisa de Node):
```
npx web-push generate-vapid-keys
```
Guarde as duas chaves: **Public Key** e **Private Key**.

## 2. Colar a chave PÚBLICA no cliente
Em `js/push.js`, substitua o placeholder:
```js
export const VAPID_PUBLIC_KEY = 'COLE_AQUI_A_CHAVE_PUBLICA_VAPID';
```
pela **Public Key** gerada. (Pode commitar — ela é pública.)

## 3. Rodar o SQL
No **SQL Editor** do Supabase, rode o conteúdo de `db/push_subscriptions.sql`
(cria `push_subscriptions`, `treino_notificacoes` e as RPCs).

## 4. Publicar a Edge Function
**Opção A — Supabase CLI:**
```
supabase login
supabase link --project-ref jdtpludqkpvhnzkekrgm
supabase secrets set VAPID_PUBLIC_KEY="<public>" VAPID_PRIVATE_KEY="<private>" VAPID_SUBJECT="mailto:seu-email@exemplo.com"
supabase functions deploy enviar-push --no-verify-jwt
```
(`--no-verify-jwt` porque quem chama é o webhook, não um usuário logado.)

**Opção B — pelo Dashboard:** Edge Functions → *Deploy a new function* → nome `enviar-push`
→ cole o conteúdo de `supabase/functions/enviar-push/index.ts`. Depois adicione os
3 secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) em
*Project Settings → Edge Functions → Secrets*.

## 5. Criar o Database Webhook
Dashboard → **Database → Webhooks → Create a new hook**:
- **Table:** `treinos`
- **Events:** `Insert` e `Update`
- **Type:** *Supabase Edge Functions* → função `enviar-push`
- Método `POST`. Salve.

Assim, toda vez que um treino (ou seus exercícios, via o gatilho `atualizado_em`)
mudar, o webhook chama a função, que envia o push.

## 6. Testar
1. Publique o app (o Service Worker novo, `v3`, precisa estar ativo — no celular,
   feche e reabra o app; se necessário, reinstale na tela inicial).
2. **iPhone:** é obrigatório **instalar o app na tela inicial** (Compartilhar →
   Adicionar à Tela de Início) e abrir por lá. Push em PWA não funciona no Safari comum.
3. No app do aluno, toque no **sino** na barra superior → **Permitir** notificações.
4. Pelo painel, altere o treino desse aluno.
5. A notificação deve chegar em ~alguns segundos (há um cooldown de 5 min por treino
   para não spammar durante edições seguidas).

## Observações
- Cada aparelho que ativar o sino cria uma inscrição; o aluno pode ativar em vários.
- Inscrições expiradas são limpas automaticamente pela função (erro 404/410).
- Sem a chave pública em `js/push.js`, o sino avisa que "notificações ainda não
  foram configuradas" — por isso o passo 2 é obrigatório.
