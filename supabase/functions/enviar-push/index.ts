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

// ───────────────────────────────────────────────────────────
// ERRO NEUTRO
// ───────────────────────────────────────────────────────────
// O corpo da resposta vai para os logs da Edge Function. Devolver
// `e.message` colocava lá o que o Postgres tivesse a dizer — e mensagem de
// violação de constraint carrega o valor que causou o conflito. Como esta
// função recebe a linha inteira de `paciente_documentos` pelo webhook, isso
// era um caminho para título de exame terminar em log.
//
// 200, e não 500, porque o Database Webhook do Supabase reenvia em caso de
// erro: uma falha permanente viraria loop de reenvio. Manter o status é o
// requisito atual — só o corpo muda.
function respostaErroSeguro() {
  return new Response(
    JSON.stringify({ ok: false, error: 'push_failed' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

Deno.serve(async (req) => {
  // Declarado FORA do try: `req.json()` pode falhar, e o catch precisa poder
  // dizer de qual tabela veio a requisição sem tocar no conteúdo dela.
  let payload: { type?: string; table?: string; record?: unknown; old_record?: unknown } | null = null;
  try {
    payload = await req.json();
    // Webhook do Supabase envia { type, table, record, old_record }.
    const record = (payload?.record ?? payload) as any;
    const anterior = (payload?.old_record ?? null) as any;

    // Duas origens, uma função. Um segundo sistema de push significaria duas
    // chaves VAPID, duas limpezas de inscrição expirada e dois lugares para
    // esquecer de tirar dado clínico do corpo da mensagem.
    if (payload?.table === 'paciente_documentos') {
      return await pushDeDocumento(record, anterior);
    }

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
  } catch (_e) {
    // O erro NÃO é lido. Nem message, nem stack, nem o objeto: qualquer um
    // deles pode carregar dado da linha que o webhook mandou.
    //
    // O que fica é o suficiente para achar a requisição no log e correlacionar
    // com o horário: de onde veio e quando. Nada de `record`, `old_record`,
    // documento, paciente, endpoint ou token.
    console.error('push_failed', {
      type: payload?.type ?? null,
      table: payload?.table ?? null,
      timestamp: new Date().toISOString(),
    });
    return respostaErroSeguro();
  }
});


// ═══════════════════════════════════════════════════════════
// DOCUMENTO DISPONIBILIZADO AO PACIENTE
// ═══════════════════════════════════════════════════════════
// Webhook em `paciente_documentos` (UPDATE). Só a TRANSIÇÃO privado →
// disponível notifica: upload de documento no prontuário não avisa ninguém, e
// editar o título de um documento já compartilhado não é novidade.
//
// PRIVACIDADE: a mensagem é neutra, e isso não é excesso de zelo. Push aparece
// na tela bloqueada, à vista de quem estiver por perto. O título é escrito pelo
// profissional e pode conter qualquer coisa — "Resultado HIV", "Laudo
// psiquiátrico". Nada do documento entra no corpo: nem título, nem descrição,
// nem tipo. Quem quiser saber o que é, abre o app e se autentica; lá dentro o
// aviso interno mostra o título, porque lá já há sessão.
async function pushDeDocumento(record: any, anterior: any) {
  const documentoId = record?.id;
  const pacienteId = record?.paciente_id;
  if (!documentoId || !pacienteId) return new Response('sem documento/paciente', { status: 200 });

  const virouDisponivel = record?.visivel_paciente === true
    && (anterior == null || anterior?.visivel_paciente !== true);
  if (!virouDisponivel) return new Response('sem transicao', { status: 200 });
  if (record?.arquivado_em) return new Response('arquivado', { status: 200 });

  // IDEMPOTÊNCIA sem tabela nova: já houve `push_enviado` DEPOIS desta
  // disponibilização? Se sim, é reentrega do webhook. Se o documento for
  // removido e disponibilizado de novo, `disponibilizado_em` é mais recente
  // que o último envio e o push sai — que é o correto, porque é novidade.
  const { data: enviados } = await supabase
    .from('paciente_documento_auditoria')
    .select('criado_em')
    .eq('documento_id', documentoId)
    .eq('acao', 'push_enviado')
    .order('criado_em', { ascending: false })
    .limit(1);
  const ultimoEnvio = enviados?.[0]?.criado_em;
  if (ultimoEnvio && record?.disponibilizado_em
      && new Date(ultimoEnvio) >= new Date(record.disponibilizado_em)) {
    return new Response('ja enviado', { status: 200 });
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('paciente_id', pacienteId);

  // Paciente sem aparelho inscrito NÃO é falha: o aviso interno já foi criado
  // e o documento já aparece no app. Push é reforço, não o canal.
  if (!subs?.length) {
    await registrar(supabase, record, 'push_falhou', { motivo: 'sem_inscricao' });
    return new Response('sem inscricoes', { status: 200 });
  }

  const body = JSON.stringify({
    title: 'Novo documento disponível',
    body: 'Seu profissional compartilhou um novo documento com você.',
    // Deep link para a rota, não para o arquivo. URL assinada em push seria
    // acesso a documento clínico por um link que sobrevive à notificação.
    url: '/app.html#documentos',
    tag: `documento-${documentoId}`,
  });

  let entregues = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      entregues++;
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
  }));

  // Falha de push NÃO desfaz nada: o documento continua disponível, o aviso
  // interno continua criado e a timeline continua registrada. O que fica é o
  // rastro, para dar para investigar depois.
  await registrar(supabase, record, entregues ? 'push_enviado' : 'push_falhou',
                  { aparelhos: subs.length, entregues });

  return new Response(entregues ? 'ok' : 'nenhum entregue', { status: 200 });
}

/** Auditoria da integração, no log que o módulo já tem. */
async function registrar(sb: any, record: any, acao: string, metadata: Record<string, unknown>) {
  try {
    await sb.from('paciente_documento_auditoria').insert({
      nutri_id: record.nutri_id,
      documento_id: record.id,
      paciente_id: record.paciente_id,
      acao,
      metadata,
    });
  } catch (_) { /* auditoria não derruba o envio que ela só observa */ }
}
