// ═══════════════════════════════════════════════════════════
// Evollo · Edge Function: enviar-push
// ═══════════════════════════════════════════════════════════
// Disparada por um Database Webhook quando `treinos` sofre INSERT/UPDATE.
// Envia uma notificação push para os aparelhos do paciente daquele treino.
// Cooldown (5 min por treino) evita spam durante edições em sequência.
//
// Secrets necessários (Project Settings → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:voce@email.com)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm injetados.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@nutrimap.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const COOLDOWN_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Webhook do Supabase envia { type, table, record, old_record }.
    const record = payload?.record ?? payload;
    const treinoId = record?.id;
    const pacienteId = record?.paciente_id;

    // Sem paciente = modelo da biblioteca; não notifica.
    if (!treinoId || !pacienteId) {
      return new Response('sem treino/paciente', { status: 200 });
    }

    // Cooldown: evita várias notificações durante uma edição.
    const { data: notif } = await supabase
      .from('treino_notificacoes')
      .select('notificado_em')
      .eq('treino_id', treinoId)
      .maybeSingle();
    if (notif?.notificado_em &&
        Date.now() - new Date(notif.notificado_em).getTime() < COOLDOWN_MS) {
      return new Response('cooldown', { status: 200 });
    }

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('paciente_id', pacienteId);
    if (!subs?.length) return new Response('sem inscricoes', { status: 200 });

    const nome = record?.nome ? `“${record.nome}”` : 'seu treino';
    const body = JSON.stringify({
      title: 'Treino atualizado',
      body: `Seu profissional atualizou ${nome}. Toque para ver.`,
      url: '/app.html',
      tag: `treino-${treinoId}`,
    });

    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err) {
        // 404/410 = inscrição expirada → remove
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }));

    await supabase
      .from('treino_notificacoes')
      .upsert({ treino_id: treinoId, notificado_em: new Date().toISOString() });

    return new Response('ok', { status: 200 });
  } catch (e) {
    // Sempre 200 para o webhook não reenviar em loop.
    return new Response('erro: ' + ((e as Error)?.message ?? e), { status: 200 });
  }
});
