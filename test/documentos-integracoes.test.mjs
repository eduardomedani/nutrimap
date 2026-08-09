// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — Etapa 4 (notificação, push, Timeline, Saúde 360°)
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é uma coisa só, dita de várias formas: o que
// dispara integração é a TRANSIÇÃO privado → disponível. Não o upload, não o
// UPDATE, não o estado "está disponível".
//
// A idempotência real mora no banco (`eq('visivel_paciente', false)` no
// UPDATE), então boa parte do que se garante aqui é que ninguém a contornou
// pelo JavaScript — porque botão desabilitado protege um dedo, não duas abas.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { limpar, tabela, chamadas } from './duble-supabase.mjs';
import {
  disponibilizarDocumentoAoPaciente, removerDocumentoDoApp,
  textoDoAviso, chaveDaDisponibilizacao, estadoParaTimeline, indicadorDocumentos,
  dataHoraBR, ROTA_DOCUMENTOS,
} from '../js/paciente-documentos-eventos.js';
import { TIPOS as TIPOS_TL, MODULOS, configDoTipo } from '../js/timeline-config.js';

const sqlDoc  = readFileSync(new URL('../db/paciente_documentos.sql', import.meta.url), 'utf8');
const sqlNot  = readFileSync(new URL('../db/paciente_notificacoes.sql', import.meta.url), 'utf8');
const desfaz  = readFileSync(new URL('../db/paciente_notificacoes_desfazer.sql', import.meta.url), 'utf8');
const dados   = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
const orq     = readFileSync(new URL('../js/paciente-documentos-eventos.js', import.meta.url), 'utf8');
const painel  = readFileSync(new URL('../js/paciente-painel.js', import.meta.url), 'utf8');
const abaUi   = readFileSync(new URL('../js/paciente-documentos-ui.js', import.meta.url), 'utf8');
const casca   = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');
const edge    = readFileSync(new URL('../supabase/functions/enviar-push/index.ts', import.meta.url), 'utf8');
const codigoNot = sqlNot.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const doc = (extra = {}) => ({
  id: 'doc-1', nutri_id: 'n1', paciente_id: 'p1', titulo: 'Exames laboratoriais',
  tipo: 'exame', visivel_paciente: false, disponibilizado_em: null,
  visualizado_pelo_paciente: false, visualizado_em: null, arquivado_em: null,
  ...extra,
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · o gatilho é a transição, não o upload', () => {

  teste('a disponibilização só casa com documento PRIVADO', () => {
    // É esta cláusula que faz o banco decidir quem venceu. Sem ela, dois
    // cliques viram duas notificações, dois pushes e dois eventos.
    const f = dados.slice(dados.indexOf('export async function disponibilizar'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, "eq('visivel_paciente', false)");
    contem(corpo, "is('arquivado_em', null)");
    contem(corpo, 'maybeSingle()', 'não casar não pode ser erro — é "nada mudou"');
  });

  teste('nada mudou = nenhuma integração', async () => {
    limpar();
    // O dublê devolve o payload do update; simulamos "não casou" com tabela
    // vazia e select — aqui basta conferir o caminho de saída no código.
    const bloco = orq.slice(orq.indexOf('export async function disponibilizarDocumentoAoPaciente'));
    contem(bloco, 'if (!doc) return { disponibilizado: false');
    ok(bloco.indexOf('if (!doc) return') < bloco.indexOf('criarAviso('),
       'o aviso não pode ser criado antes de saber se houve transição');
  });

  teste('upload privado não dispara nada', () => {
    // criarDocumento nasce com visivel_paciente: false e não chama ninguém.
    const f = dados.slice(dados.indexOf('export async function criarDocumento'));
    const corpo = f.slice(0, f.indexOf('\n}\n'));
    contem(corpo, 'visivel_paciente: false');
    for (const p of ['registrarEvento', 'paciente_notificacoes', 'push']) {
      ok(!corpo.includes(p), `criar documento não pode tocar em ${p}`);
    }
  });

  teste('editar título não passa pelo orquestrador', () => {
    const f = dados.slice(dados.indexOf('export async function editarInformacoes'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    for (const p of ['visivel_paciente', 'disponibilizado_em', 'registrarEvento']) {
      ok(!corpo.includes(p), `editar informação não é novidade — não pode mexer em ${p}`);
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · idempotência e concorrência', () => {

  teste('a chave carrega o instante da disponibilização', () => {
    const k = chaveDaDisponibilizacao(doc({ disponibilizado_em: '2026-08-08T14:32:00Z' }));
    igual(k, 'documento_disponibilizado:doc-1:2026-08-08T14:32:00Z');
    // Redisponibilizar depois de remover gera chave nova — é novidade real.
    const k2 = chaveDaDisponibilizacao(doc({ disponibilizado_em: '2026-08-20T09:00:00Z' }));
    ok(k !== k2);
  });

  teste('aviso e timeline usam a MESMA chave', () => {
    contem(orq, 'const chave = chaveDaDisponibilizacao(doc)');
    contem(orq, 'criarAviso(doc, chave)');
    contem(orq, 'registrarNaTimeline(doc, chave)');
    contem(orq, 'chaveDedup: chave');
    contem(orq, 'chave_dedup: chave');
  });

  teste('o aviso é upsert com ignoreDuplicates, não insert', () => {
    contem(orq, "onConflict: 'chave_dedup', ignoreDuplicates: true");
    contem(codigoNot, 'create unique index if not exists uniq_pn_dedup');
  });

  teste('a fonte da verdade é o banco, não o botão', () => {
    // O único lugar que decide se houve transição é a cláusula do UPDATE.
    ok(!/disabled|_disponibilizando|jaDisponibilizado/.test(orq),
       'trava em memória não sobrevive a duas abas');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · a ordem, e o que não pode desfazer o quê', () => {

  teste('a transição vem primeiro, tudo o mais depois', () => {
    const b = orq.slice(orq.indexOf('export async function disponibilizarDocumentoAoPaciente'));
    ok(b.indexOf('await disponibilizar(documentoId)') < b.indexOf('criarAviso('));
    ok(b.indexOf('criarAviso(') < b.indexOf("auditar(doc, 'notificacao_criada'"));
  });

  teste('aviso e timeline vão juntos, e nenhum derruba o outro', () => {
    contem(orq, 'await Promise.all([\n    criarAviso(doc, chave),\n    registrarNaTimeline(doc, chave),\n  ])');
    // Os dois engolem o próprio erro e devolvem boolean.
    contem(orq, "console.error('[documentos] aviso interno'");
    contem(orq, 'return false;');
  });

  teste('falha de integração não reverte o compartilhamento', () => {
    // Só o CORPO da função de disponibilizar. Fatiar até o fim do arquivo
    // pegaria removerDocumentoDoApp(), que é outra transição e tem todo o
    // direito de chamar removerDoApp().
    const i = orq.indexOf('export async function disponibilizarDocumentoAoPaciente');
    const corpo = orq.slice(i, orq.indexOf('\n}', i));
    for (const p of ['removerDoApp(', 'rollback', 'desfazer', 'visivel_paciente: false']) {
      ok(!corpo.includes(p),
         `o orquestrador não pode ${p} por causa de aviso que não gravou`);
    }
  });

  teste('a tela não trata "já estava disponível" como erro', () => {
    contem(abaUi, 'if (r.disponibilizado && !r.avisou)');
    contem(abaUi, 'console.warn');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · notificação interna', () => {

  teste('o texto nomeia o documento — aqui há sessão', () => {
    const t = textoDoAviso(doc());
    igual(t.titulo, 'Novo documento disponível');
    igual(t.corpo, 'Seu profissional compartilhou “Exames laboratoriais”.');
  });

  teste('a ação é uma ROTA, nunca uma URL', () => {
    igual(ROTA_DOCUMENTOS, 'documentos');
    contem(orq, 'acao: ROTA_DOCUMENTOS');
    // E o banco impede que alguém grave URL ali no futuro.
    contem(codigoNot, "check (acao is null or acao !~* '^https?://')");
  });

  teste('o paciente lê as próprias e não escreve nenhuma', () => {
    contem(codigoNot, 'create policy pn_paciente_select');
    contem(codigoNot, 'using (paciente_id = public.paciente_do_auth())');
    for (const cmd of ['update', 'delete']) {
      ok(!new RegExp(`create policy pn_\\w+_${cmd}`).test(codigoNot),
         `aviso não se ${cmd} pela API`);
    }
  });

  teste('ler o aviso e ler o documento são a MESMA ação', () => {
    // A trava contra as duas contagens divergirem: quem marca o documento
    // como visto fecha o aviso na mesma função.
    const f = codigoNot.slice(codigoNot.indexOf('function public.marcar_documento_paciente_visualizado'));
    const corpo = f.slice(0, f.indexOf('$fn$;'));
    contem(corpo, 'update public.paciente_notificacoes');
    contem(corpo, "and referencia_id = p_documento");
    contem(corpo, 'and lida_em is null');
  });

  teste('não há caminho para dispensar o aviso sem abrir o documento', () => {
    const f = codigoNot.slice(codigoNot.indexOf('function public.marcar_notificacao_lida'));
    contem(f.slice(0, f.indexOf('$fn$;')), "and tipo <> 'documento'");
  });

  teste('PUBLIC não executa as funções novas', () => {
    for (const f of ['public.marcar_notificacao_lida(uuid)',
                     'public.marcar_documento_paciente_visualizado(uuid)']) {
      contem(codigoNot, `revoke all on function ${f} from public;`);
    }
  });

  teste('o desfazer devolve a função de visualização ANTES de dropar a tabela', () => {
    // Ordem inversa deixaria a visualização de documento apontando para tabela
    // que não existe — e ela não tem nada a ver com aviso.
    ok(desfaz.indexOf('create or replace function public.marcar_documento_paciente_visualizado')
       < desfaz.indexOf('drop table if exists public.paciente_notificacoes'));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · push', () => {

  teste('é a MESMA função de push, não um segundo sistema', () => {
    contem(edge, "payload?.table === 'paciente_documentos'");
    contem(edge, 'webpush.sendNotification');
    igual((edge.match(/webpush\.setVapidDetails/g) || []).length, 1, 'uma chave VAPID só');
  });

  teste('o frontend NÃO dispara push', () => {
    // No Evollo push sai de Database Webhook. Um invoke aqui faria o
    // profissional esperar por uma notificação que não é problema dele.
    //
    // A conferência ignora COMENTÁRIOS: o orquestrador cita
    // supabase/functions/enviar-push justamente para explicar que o envio não
    // mora nele, e uma guarda que proíbe explicar é uma guarda que apaga a
    // explicação.
    const semComentario = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    for (const [nome, f] of [['orquestrador', orq], ['aba', abaUi], ['dados', dados]]) {
      ok(!/functions\.invoke|enviar-push/.test(semComentario(f)),
         `${nome} não pode chamar a Edge Function de push`);
    }
  });

  teste('só a transição notifica', () => {
    contem(edge, 'const virouDisponivel = record?.visivel_paciente === true');
    contem(edge, "anterior?.visivel_paciente !== true");
    contem(edge, "if (!virouDisponivel) return new Response('sem transicao'");
    contem(edge, "if (record?.arquivado_em) return new Response('arquivado'");
  });

  teste('NADA do documento entra no corpo — nem o título', () => {
    const f = edge.slice(edge.indexOf('async function pushDeDocumento'));
    const payload = f.slice(f.indexOf('const body = JSON.stringify'), f.indexOf('});', f.indexOf('const body')));
    contem(payload, 'Seu profissional compartilhou um novo documento com você.');
    // Push aparece na tela bloqueada. O título é escrito pelo profissional e
    // pode ser "Resultado HIV".
    for (const campo of ['record.titulo', 'record?.titulo', 'record.descricao', 'record.tipo']) {
      ok(!payload.includes(campo), `${campo} não pode ir para a tela bloqueada`);
    }
  });

  teste('o deep link é rota, não arquivo', () => {
    contem(edge, "url: '/app.html#documentos'");
    ok(!/createSignedUrl|signedUrl/.test(edge), 'assinatura em push seria acesso por link');
  });

  teste('o hash abre Documentos de verdade', () => {
    contem(casca, "if (secaoDoHash() === 'documentos') renderDocumentos()");
    // Lista fechada: o hash vem de fora e não decide nada além da tela.
    contem(casca, "const ROTAS_DO_HASH = ['documentos']");
    contem(casca, 'ROTAS_DO_HASH.includes(h) ? h : null');
  });

  teste('idempotência sem tabela nova', () => {
    contem(edge, "eq('acao', 'push_enviado')");
    contem(edge, 'new Date(ultimoEnvio) >= new Date(record.disponibilizado_em)');
    contem(edge, "return new Response('ja enviado'");
  });

  teste('paciente sem inscrição não é falha', () => {
    const f = edge.slice(edge.indexOf('async function pushDeDocumento'));
    contem(f, "motivo: 'sem_inscricao'");
    contem(f, "return new Response('sem inscricoes', { status: 200 })");
    // 200 sempre: o webhook não pode reenviar em loop por causa disso.
    ok(!/status:\s*(4|5)\d\d/.test(f));
  });

  teste('falha do push não desfaz nada, só deixa rastro', () => {
    const f = edge.slice(edge.indexOf('async function pushDeDocumento'));
    contem(f, "'push_enviado' : 'push_falhou'");
    // A função só ESCREVE em duas tabelas: o log e a limpeza de inscrição
    // expirada. Em `paciente_documentos` ela nunca escreve — push é efeito
    // secundário, e efeito secundário não desfaz o fato que o provocou.
    const escritas = [...f.matchAll(/\.from\('(\w+)'\)\s*\.(insert|update|delete|upsert)/g)]
      .map(m => `${m[1]}.${m[2]}`);
    igual(escritas.sort(), ['paciente_documento_auditoria.insert', 'push_subscriptions.delete']);
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · Timeline', () => {

  teste('o tipo existe, no módulo que já era do catálogo', () => {
    const t = TIPOS_TL.DOCUMENT_SHARED;
    ok(t, 'DOCUMENT_SHARED tem que estar no catálogo');
    igual(t.modulo, 'documentos');
    igual(MODULOS.documentos, 'Exames e documentos');
    igual(t.acao.aba, 'documentos', 'o item leva para a aba do painel');
    igual(t.importancia, 'alta');
  });

  teste('não existe um segundo tipo para "visualizado"', () => {
    // Dois cards por arquivo transformariam a timeline num log de sistema.
    ok(!TIPOS_TL.DOCUMENT_VIEWED, 'visualização é informação secundária do mesmo card');
    ok(!TIPOS_TL.DOCUMENT_VIEWED_BY_PATIENT);
  });

  teste('o evento registra a disponibilização, com a data dela', () => {
    contem(orq, "tipo: 'DOCUMENT_SHARED'");
    contem(orq, "entidadeTipo: 'documento'");
    contem(orq, 'dataEvento: doc.disponibilizado_em');
  });

  teste('a entidade documento entra no mapa da timeline', () => {
    const tl = readFileSync(new URL('../js/timeline.js', import.meta.url), 'utf8');
    contem(tl, "documento: 'paciente_documentos'");
  });

  teste('o estado atual é lido do documento, não gravado no evento', () => {
    // Evento gerado pelo sistema é imutável por RLS — só dá para ler ao vivo.
    const tlSql = readFileSync(new URL('../db/timeline_schema.sql', import.meta.url), 'utf8');
    contem(tlSql, 'gerado_pelo_sistema = false');
    contem(orq, 'export async function estadoDosDocumentos');
    contem(orq, "select('id, titulo, visivel_paciente, visualizado_em, arquivado_em')");
  });

  teste('cada estado tem a sua frase, e a ordem certa de precedência', () => {
    igual(estadoParaTimeline({ arquivado: true, visivel: false }).rotulo, 'Documento arquivado');
    igual(estadoParaTimeline({ arquivado: false, visivel: false }).rotulo, 'Disponibilidade removida');
    igual(estadoParaTimeline({ visivel: true, visualizadoEm: null }).rotulo, 'Ainda não visualizado');
    contem(estadoParaTimeline({ visivel: true, visualizadoEm: '2026-08-08T15:04:00' }).rotulo,
           'Visualizado em 08/08/2026 às 15:04');
    igual(estadoParaTimeline(null), null);
  });

  teste('arquivado e removido não oferecem acesso do paciente', () => {
    igual(estadoParaTimeline({ arquivado: true }).abrePwa, false);
    igual(estadoParaTimeline({ visivel: false }).abrePwa, false);
    igual(estadoParaTimeline({ visivel: true }).abrePwa, true);
  });

  teste('remover do app NÃO apaga o evento', () => {
    const f = orq.slice(orq.indexOf('export async function removerDocumentoDoApp'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    for (const p of ['delete', 'paciente_eventos', 'excluirRegistro']) {
      ok(!corpo.includes(p), 'o passado não se reescreve para caber no presente');
    }
    contem(corpo, "auditar(doc, 'removido_do_pwa'");
  });

  teste('estado sem certeza não afirma nada', () => {
    contem(orq, "console.error('[documentos] estado para a timeline'");
    contem(orq, 'return mapa;');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · Saúde 360°', () => {

  const lista = [
    doc({ id: 'a', visivel_paciente: true, visualizado_pelo_paciente: true,  disponibilizado_em: '2026-07-15T10:00:00Z' }),
    doc({ id: 'b', visivel_paciente: true, visualizado_pelo_paciente: false, disponibilizado_em: '2026-08-08T14:32:00Z', titulo: 'Exames laboratoriais' }),
    doc({ id: 'c', visivel_paciente: true, visualizado_pelo_paciente: false, disponibilizado_em: '2026-08-01T10:00:00Z' }),
    doc({ id: 'd', visivel_paciente: false }),
    doc({ id: 'e', visivel_paciente: false, arquivado_em: '2026-08-02T00:00:00Z' }),
  ];

  teste('total, compartilhados e privados', () => {
    const i = indicadorDocumentos(lista);
    igual(i.total, 4, 'arquivado não entra em nada');
    igual(i.disponiveis, 3);
    igual(i.privados, 1);
  });

  teste('pendente é DISPONÍVEL e não aberto — privado não conta', () => {
    // Ninguém está esperando abrir um documento que não foi compartilhado.
    igual(indicadorDocumentos(lista).pendentes, 2);
  });

  teste('o último é o mais recentemente compartilhado', () => {
    igual(indicadorDocumentos(lista).ultimo, { titulo: 'Exames laboratoriais', data: '2026-08-08' });
  });

  teste('sem documento nenhum o card some', () => {
    igual(indicadorDocumentos([]).total, 0);
    contem(painel, 'if (!d.total) return \'\';');
    // Consistente com plano/treino/metas: módulo sem dado não vira card vazio.
    contem(painel, "if (!moduloAtivo('documentos')) return '';");
  });

  teste('o que não carregou não vira "0 arquivos"', () => {
    contem(painel, 'if (!d) return \'\';');
    contem(painel, '_documentos = docs');
  });

  teste('o botão navega para a aba, não para o PWA', () => {
    contem(painel, 'data-pv-aba="documentos"');
    contem(painel, 'Ver documentos');
    const bloco = painel.slice(painel.indexOf('function documentosHtml()'), painel.indexOf('function planoHtml'));
    ok(!/app\.html|urlAssinada|window\.open/.test(bloco), 'é navegação administrativa');
  });

  teste('o número em destaque é o pendente, não só o total', () => {
    // A frase é montada com singular/plural no meio ("1 pendente de" /
    // "2 pendentes de"), então o que se procura é o sufixo — e não uma string
    // contígua que o código nunca chega a formar.
    const bloco = painel.slice(painel.indexOf('function documentosHtml()'), painel.indexOf('function planoHtml'));
    contem(bloco, 'de visualização');
    contem(bloco, "d.pendentes === 1 ? 'pendente' : 'pendentes'");
    contem(bloco, 'pv-doc-pend');
    // O total continua aparecendo, mas é o pendente que ganha realce próprio.
    contem(bloco, "d.total === 1 ? 'arquivo' : 'arquivos'");
  });

  teste('o painel não vira gerenciador de arquivos', () => {
    const bloco = painel.slice(painel.indexOf('function documentosHtml()'), painel.indexOf('function planoHtml'));
    for (const p of ['data-abrir', 'Baixar', 'Substituir', 'Excluir', 'urlAssinada']) {
      ok(!bloco.includes(p), `${p} é da aba Documentos, não do Saúde 360°`);
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('integrações · auditoria', () => {

  teste('as ações de integração entram no log que já existe', () => {
    contem(orq, "'notificacao_criada'");
    contem(orq, "'removido_do_pwa'");
    contem(edge, "'push_enviado'");
    contem(edge, "'push_falhou'");
    // Sem tabela nova: é o log do módulo, que aceita qualquer `acao`.
    contem(orq, "const AUDITORIA = 'paciente_documento_auditoria'");
    ok(!/check \(acao in/.test(sqlDoc), 'o log tem que aceitar ação nova sem migration');
  });

  teste('as ações da TABELA continuam vindo do gatilho', () => {
    // Disponibilizado, visualizado e arquivado já são escritos pelo trigger —
    // duplicá-los aqui daria dois registros do mesmo fato.
    contem(sqlDoc, "'documento_disponibilizado'");
    contem(sqlDoc, "'documento_visualizado_pelo_paciente'");
    const f = orq.slice(orq.indexOf('export async function disponibilizarDocumentoAoPaciente'));
    ok(!f.includes("auditar(doc, 'documento_disponibilizado'"), 'isso é do gatilho');
  });

  teste('auditoria nunca derruba a operação que ela observa', () => {
    contem(orq, "console.error('[documentos] auditoria'");
    contem(orq, 'return false;');
    contem(edge, '/* auditoria não derruba o envio que ela só observa */');
  });
});
