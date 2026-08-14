// ═══════════════════════════════════════════════════════════
// COMERCIAL — O PERÍODO DA COBRANÇA (Migration C)
// ═══════════════════════════════════════════════════════════
// Quando a cobrança manual passou a vencer em `criação + 30 dias`, duas regras
// que dependiam em silêncio da amarração antiga ficaram erradas:
//
//   A UNICIDADE. `uq_comercial_cobranca_periodo` era (assinatura_id,
//   vencimento). Ela se chamava "período" porque vencimento ERA o fim do
//   período. Passou a errar dos dois lados: deixava passar duas cobranças do
//   mesmo período com vencimentos diferentes, e REJEITAVA duas cobranças de
//   períodos diferentes criadas no mesmo dia — as duas nascem com `hoje + 30`.
//
//   A COMPETÊNCIA. Saía de `date_trunc('month', vencimento)`. O período
//   16/06→16/07 da CASO_MENSAL_ATRASADO, cobrado em 13/08, virava competência SETEMBRO: a
//   receita de julho no relatório de setembro.
//
// A identidade real de uma cobrança é o PERÍODO que ela cobre, e nenhuma coluna
// representava isso — `data`, `competencia` e `vencimento` eram as três datas,
// e `competencia` é mensal, então nem distinguiria dois atendimentos de um
// plano Diária no mesmo mês. Daí `periodo_inicio` e `periodo_fim`.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { competenciaDaCobranca, primeiroDiaDoMes, fimDoPeriodo } from '../js/comercial.js';
import { vencimentoDaPrimeiraCobranca, cobrancaDoPeriodoVazia, PRAZO_COBRANCA_DIAS }
  from '../js/comercial-formularios.js';

const ler = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Comentário não é código: o `--` explica a regra, e casar com ele deixaria o
// teste passar enquanto o SQL faz outra coisa. Já aconteceu.
const soCodigo = s => s.replace(/--[^\n]*/g, '');

const MIGRATION_C = ler('../db/comercial_periodo_da_cobranca.sql');
const DESFAZER_C  = ler('../db/comercial_periodo_da_cobranca_desfazer.sql');
const CODIGO_C    = soCodigo(MIGRATION_C);
const DADOS       = ler('../js/comercial-data.js');

// O caso real que motivou tudo.
const CASO_MENSAL_ATRASADO = {
  id: 'a-lu', status: 'ativa', plano_id: 'p-m3',
  plano: { nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 },
  inicio_periodo: '2026-06-16', fim_periodo: '2026-07-16',
  valor_contratado: 311,
};
const HOJE = '2026-08-13';


// ───────────────────────────────────────────────────────────
grupo('comercial · a competência sai do INÍCIO do período', () => {
  // A REGRA DO FIM DO PERÍODO foi proposta, aprovada e DERRUBADA pelos dados,
  // antes de virar migration. A conferência 103 mediu as três candidatas:
  //
  //   . numa mensalidade 09/08→08/09, 23 dos 30 dias são de agosto. Pelo fim,
  //     toda mensalidade da GoUp virava receita do mês seguinte;
  //   . em 28 das 31 cobranças pagas, o mês do início é o mês em que o dinheiro
  //     entrou. Pelo fim, 3 de 31;
  //   . o CASO_PAGAMENTO_ANTECIPADO pagou em 13/07 um período 11/09→10/12. Pelo fim, aquilo virava
  //     receita de DEZEMBRO.
  //
  // Os testes que afirmavam o fim saíram. Não se mantém teste contraditório.
  teste('CASO_MENSAL_ATRASADO: período 16/06→16/07 cobrado em 13/08 é competência JUNHO', () => {
    const venc = cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE).vencimento;
    igual(venc, '2026-09-12', 'o vencimento continua sendo criação + 30');
    igual(competenciaDaCobranca(CASO_MENSAL_ATRASADO.inicio_periodo), '2026-06-01');
    // As duas regras que caíram, nomeadas para não voltarem por descuido:
    igual(competenciaDaCobranca(venc), '2026-09-01', 'pelo vencimento daria setembro');
    igual(competenciaDaCobranca(CASO_MENSAL_ATRASADO.fim_periodo), '2026-07-01', 'pelo fim daria julho');
  });

  teste('continua sendo sempre o dia 1º, como o CHECK da tabela exige', () => {
    igual(competenciaDaCobranca('2026-06-16'), '2026-06-01');
    igual(competenciaDaCobranca('2026-12-31'), '2026-12-01');
    igual(competenciaDaCobranca(null), null);
  });

  teste('um período que atravessa o mês fica no mês em que COMEÇA', () => {
    // Trimestral de 16/06 a 14/09: a receita é de junho, quando o cliente
    // pagou para abrir o ciclo — e não de setembro, três meses depois.
    const trimestral = { duracao_valor: 90, duracao_unidade: 'dia' };
    const fim = fimDoPeriodo('2026-06-16', trimestral);
    igual(fim, '2026-09-14');
    igual(competenciaDaCobranca('2026-06-16'), '2026-06-01');
  });

  teste('a mensalidade fica no mês em que estão a maioria dos dias', () => {
    // O caso da mensalidade típica, virado fixture: 09/08→08/09, 30 dias, 23 deles em
    // agosto. É a conta que decidiu a regra.
    igual(competenciaDaCobranca('2026-08-09'), '2026-08-01');
    igual(competenciaDaCobranca('2026-09-08'), '2026-09-01', 'pelo fim, seria setembro');
  });

  teste('o helper genérico existe separado, e é ele que os indicadores usam', () => {
    // Sem a separação, `competenciaDaCobranca(hoje)` no painel violaria o
    // próprio contrato que o nome promete.
    igual(primeiroDiaDoMes('2026-08-13'), '2026-08-01');
    const js = ler('../js/comercial.js');
    const ind = js.slice(js.indexOf('export function indicadores'));
    ok(!/competenciaDaCobranca\(/.test(ind),
      'o mês corrente do painel não é a competência de cobrança nenhuma');
    contem(ind, 'primeiroDiaDoMes(hoje)');
  });

  teste('a camada de dados deriva do início', () => {
    contem(DADOS, 'competencia: competenciaDaCobranca(periodoInicio)');
    ok(!/competenciaDaCobranca\((vencimento|periodoFim)\)/.test(DADOS),
      'nem o vencimento nem o fim do período podem voltar a ser a origem');
  });

  teste('as duas RPCs também', () => {
    ok(!/date_trunc\('month', p_vencimento\)/.test(CODIGO_C),
      'a RPC manual não pode tirar competência do parâmetro de vencimento');
    ok(!/date_trunc\('month', v_ass\.fim_periodo\)/.test(CODIGO_C),
      'nenhuma das duas pode derivar do fim do período');
    igual((CODIGO_C.match(/date_trunc\('month', v_ass\.inicio_periodo\)/g) || []).length, 2,
      'as duas — a manual e a automática — derivam do início');
  });

  teste('o backfill da competência mexe só onde diverge, e só em assinatura', () => {
    contem(CODIGO_C, "set competencia = date_trunc('month', l.periodo_inicio)::date");
    contem(CODIGO_C, 'where l.assinatura_id  is not null');
    contem(CODIGO_C, 'and l.competencia is distinct from');
  });

  teste('a competência antiga é GUARDADA — ela não é recomputável', () => {
    // Para as cobranças da tela era o mês do vencimento; para as importadas,
    // o mês da venda. O CASO_PAGAMENTO_ANTECIPADO tem competência 2026-07 com vencimento
    // 2026-09-11. Sem o retrato, não há desfazer.
    contem(CODIGO_C, 'create table if not exists public.comercial_competencia_antes');
    contem(CODIGO_C, 'insert into public.comercial_competencia_antes (lancamento_id, competencia)');
    // E ela é guardada ANTES de o update tocar em qualquer coisa.
    ok(CODIGO_C.indexOf('insert into public.comercial_competencia_antes')
       < CODIGO_C.indexOf("set competencia = date_trunc('month', l.periodo_inicio)"),
      'guardar depois de sobrescrever não guarda nada');
  });

  teste('a tabela de retrato não vaza pelo PostgREST', () => {
    contem(CODIGO_C, 'alter table public.comercial_competencia_antes enable row level security');
    contem(CODIGO_C, 'revoke all on table public.comercial_competencia_antes from public, anon, authenticated');
    // Sem policy: RLS ligada e nenhuma policy significa que ninguém lê.
    ok(!/create policy[^;]*comercial_competencia_antes/.test(CODIGO_C),
      'uma policy aqui abriria o retrato para a aplicação, que não precisa dele');
  });
});


// ───────────────────────────────────────────────────────────
grupo('comercial · a identidade da cobrança é o período', () => {
  teste('o índice novo é por periodo_fim, e cancelado fica de fora', () => {
    contem(CODIGO_C, 'create unique index if not exists uq_comercial_cobranca_do_periodo');
    contem(CODIGO_C, 'on public.financeiro_lancamentos (assinatura_id, periodo_fim)');
    contem(CODIGO_C, "where assinatura_id is not null and periodo_fim is not null and status <> 'cancelado'");
  });

  teste('o índice antigo SAI — ele rejeitava cobrança legítima', () => {
    // Duas cobranças de períodos diferentes criadas no mesmo dia nascem com o
    // mesmo `hoje + 30`. Mantido, o índice antigo barraria a segunda.
    contem(CODIGO_C, 'drop index if exists public.uq_comercial_cobranca_periodo;');
    ok(!/create unique index[^;]*\(assinatura_id, vencimento\)/.test(CODIGO_C),
      'a unicidade por vencimento não pode sobreviver à Migration C');
  });

  teste('duas cobranças criadas no mesmo dia colidiriam pela regra ANTIGA', () => {
    // A prova em JS de por que o índice tinha de mudar: mesmo dia de criação,
    // períodos diferentes, vencimento idêntico.
    const junho = cobrancaDoPeriodoVazia({ ...CASO_MENSAL_ATRASADO, fim_periodo: '2026-07-16' }, HOJE);
    const julho = cobrancaDoPeriodoVazia({ ...CASO_MENSAL_ATRASADO, fim_periodo: '2026-08-16' }, HOJE);
    igual(junho.vencimento, julho.vencimento, 'os dois vencimentos são o mesmo');
    ok(true); // e os períodos, que agora são a chave, são distintos:
    ok('2026-07-16' !== '2026-08-16');
  });

  teste('o período nulo não participa — despesas e avulsos ficam fora', () => {
    contem(CODIGO_C, 'periodo_fim is not null');
  });

  teste('as duas colunas são nulas e sem default', () => {
    contem(CODIGO_C, 'add column if not exists periodo_inicio date');
    contem(CODIGO_C, 'add column if not exists periodo_fim    date');
    ok(!/periodo_(inicio|fim)\s+date\s+not null/.test(CODIGO_C),
      'uma despesa não tem período, e forçar um seria inventar dado');
  });

  teste('a cobrança tira o período da assinatura, nunca de parâmetro', () => {
    const f = DADOS.slice(DADOS.indexOf('export async function criarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'const periodoInicio = assinatura?.inicio_periodo');
    contem(corpo, 'const periodoFim = assinatura?.fim_periodo');
    contem(corpo, 'periodo_inicio: periodoInicio');
    contem(corpo, 'periodo_fim: periodoFim');
    // A assinatura da função não pode ganhar um período vindo de fora.
    // A fatia é a LINHA inteira: parar no primeiro `{` pegaria só até a
    // desestruturação e o teste passaria sem olhar parâmetro nenhum.
    const assin = corpo.slice(0, corpo.indexOf('\n'));
    contem(assin, 'assinatura, vencimento, valor');
    ok(!/periodo/i.test(assin), 'quem chama não escolhe o que a cobrança cobre');
  });

  teste('as duas RPCs gravam o período', () => {
    igual((CODIGO_C.match(/periodo_inicio, periodo_fim, descricao/g) || []).length, 2);
    igual((CODIGO_C.match(/v_ass\.inicio_periodo, v_ass\.fim_periodo,/g) || []).length, 2);
  });

  teste('prorrogar o vencimento não reescreve o período', () => {
    const f = DADOS.slice(DADOS.indexOf('export async function editarCobranca'));
    const corpo = soCodigo(f.slice(0, f.indexOf('\n}')))
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    ok(!/patch\.periodo/.test(corpo));
    ok(!/patch\.competencia/.test(corpo));
  });
});


// ───────────────────────────────────────────────────────────
grupo('comercial · o backfill', () => {
  // A PRIMEIRA VERSÃO COPIAVA O VENCIMENTO, apoiada em "até 12/08 todo caminho
  // gravava vencimento = fim do período". A conferência 101 barrou e a 102
  // mostrou por quê: 29 das 43 vieram da planilha com o vencimento na data do
  // PAGAMENTO, que é o INÍCIO do período. Os testes que protegiam aquela cópia
  // saíram junto com ela.
  teste('o padrão é o período VIGENTE da assinatura, não o vencimento', () => {
    contem(CODIGO_C, 'set periodo_inicio = a.inicio_periodo,');
    contem(CODIGO_C, 'periodo_fim    = a.fim_periodo');
    contem(CODIGO_C, 'from public.comercial_assinaturas a');
    contem(CODIGO_C, 'and l.periodo_fim is null');
    ok(!/set periodo_fim\s*=\s*l\.vencimento/.test(CODIGO_C),
      'copiar o vencimento erra o período por um ciclo inteiro nas importadas');
  });

  teste('a correção vem da auditoria, para quem cobre um ciclo anterior', () => {
    // Quando o pagamento renova, o período antigo some da assinatura. O único
    // lugar onde ele sobreviveu é o `antes` da auditoria.
    contem(CODIGO_C, "from public.comercial_assinatura_auditoria aud");
    contem(CODIGO_C, "where aud.acao = 'renovada'");
    contem(CODIGO_C, "(aud.antes ->> 'inicio_periodo')::date as inicio");
    contem(CODIGO_C, 'and l.vencimento      = ant.fim');
    // A ordem entre os dois updates é o que preserva as classes.
    contem(CODIGO_C, 'and l.vencimento     <> l.periodo_fim');
    ok(CODIGO_C.indexOf('set periodo_inicio = a.inicio_periodo,')
       < CODIGO_C.indexOf('set periodo_inicio = ant.inicio,'),
      'a correção tem de vir DEPOIS do padrão, senão o padrão a sobrescreve');
  });

  teste('a auditoria é lida sem duplicar linha', () => {
    // Duas renovações com o mesmo fim de período multiplicariam o update.
    contem(CODIGO_C, "select distinct on (aud.assinatura_id, (aud.antes ->> 'fim_periodo'))");
  });

  teste('não vaza para despesa nem para lançamento avulso', () => {
    const ini = CODIGO_C.indexOf('update public.financeiro_lancamentos l');
    const bloco = CODIGO_C.slice(ini, CODIGO_C.indexOf('drop index if exists'));
    // O join com comercial_assinaturas já restringe: sem assinatura_id, não há
    // linha para casar. E o update da competência filtra explicitamente.
    contem(bloco, 'where a.id = l.assinatura_id');
    contem(bloco, 'where l.assinatura_id  is not null');
  });

  teste('a validação roda DEPOIS, e o gate são a 102 e a 103', () => {
    const conf = soCodigo(ler('../db/conferencia/101_periodo_da_cobranca.sql'));
    contem(conf, 'MIGRATION C VALIDADA');
    contem(conf, 'comercial_competencia_antes');
    // O critério antigo — data de criação — não separava nada e saiu.
    ok(!/criado_em::date >= date '2026-08-13'/.test(conf),
      '35 das 43 nasceram em 13/08; a data de criação nunca foi discriminador');
    ok(ler('../db/conferencia/102_de_onde_vem_o_periodo.sql').includes('COLISAO'));
    ok(ler('../db/conferencia/103_qual_competencia.sql').includes('O CAIXA'));
  });
});


// ───────────────────────────────────────────────────────────
grupo('comercial · a primeira cobrança de uma assinatura nova', () => {
  const mensal    = { duracao_valor: 30, duracao_unidade: 'dia' };
  const trimestral = { duracao_valor: 90, duracao_unidade: 'dia' };

  teste('Mensal que começa hoje vence no fim do período', () => {
    const nova = { inicio_periodo: HOJE, fim_periodo: fimDoPeriodo(HOJE, mensal) };
    igual(nova.fim_periodo, '2026-09-12');
    igual(vencimentoDaPrimeiraCobranca(nova, HOJE), '2026-09-12');
  });

  teste('Trimestral tem 90 dias para pagar, e NÃO 30', () => {
    // O mesmo motivo pelo qual a cobrança automática não virou `criação + 30`:
    // o cliente usa o ciclo inteiro e paga no fim para renovar.
    const nova = { inicio_periodo: HOJE, fim_periodo: fimDoPeriodo(HOJE, trimestral) };
    igual(nova.fim_periodo, '2026-11-11');
    igual(vencimentoDaPrimeiraCobranca(nova, HOJE), '2026-11-11');
    ok(vencimentoDaPrimeiraCobranca(nova, HOJE) !== cobrancaDoPeriodoVazia(nova, HOJE).vencimento,
      'a regra da cobrança manual não vale aqui');
  });

  teste('assinatura RETROATIVA cai no piso — não nasce vencida', () => {
    // `inicio_periodo` é campo editável, e a validação só impede começar antes
    // de `data_inicio_original`. Sem o piso, esta nasceria vencida há 28 dias.
    const nova = { inicio_periodo: '2026-06-16', fim_periodo: '2026-07-16' };
    igual(vencimentoDaPrimeiraCobranca(nova, HOJE), '2026-09-12');
    igual(vencimentoDaPrimeiraCobranca(nova, HOJE), cobrancaDoPeriodoVazia(nova, HOJE).vencimento);
  });

  teste('o piso é exatamente PRAZO_COBRANCA_DIAS, sem número solto', () => {
    igual(PRAZO_COBRANCA_DIAS, 30);
    const form = ler('../js/comercial-formularios.js');
    const f = form.slice(form.indexOf('export function vencimentoDaPrimeiraCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'somarDias(hoje, PRAZO_COBRANCA_DIAS)');
    ok(!/\b30\b/.test(corpo), 'o prazo mora na constante');
  });

  teste('sem fim_periodo, cai no piso em vez de gravar vazio', () => {
    igual(vencimentoDaPrimeiraCobranca({}, HOJE), '2026-09-12');
  });

  teste('a tela usa a função, e não fim_periodo direto', () => {
    const ui = ler('../js/comercial-ui.js');
    const f = ui.slice(ui.indexOf('async function abrirAssinatura'));
    const corpo = soCodigo(f.slice(0, f.indexOf('\nexport ')))
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    contem(corpo, 'vencimento: vencimentoDaPrimeiraCobranca(nova)');
    ok(!/vencimento: nova\.fim_periodo/.test(corpo),
      'sem o piso, a assinatura retroativa nasce vencida');
  });
});


// ───────────────────────────────────────────────────────────
grupo('comercial · o que a Migration C NÃO pode ter mexido', () => {
  teste('a cobrança automática pós-pagamento continua vencendo no fim do período novo', () => {
    // Decisão de 14/08/2026: um Trimestral não vira cobrança de 30 dias.
    const insert = CODIGO_C.slice(CODIGO_C.lastIndexOf('insert into public.financeiro_lancamentos'));
    contem(insert, "'pendente', v_ass.fim_periodo, v_ass.fim_periodo,");
  });

  teste('não há regra única de vencimento — são três, por evento de negócio', () => {
    // Se algum dia alguém "unificar", este teste cai junto.
    const manual = cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE).vencimento;
    const primeira = vencimentoDaPrimeiraCobranca(
      { inicio_periodo: HOJE, fim_periodo: '2026-11-11' }, HOJE);
    ok(manual !== primeira, 'manual e primeira cobrança não coincidem num Trimestral');
    igual(manual, '2026-09-12');
    igual(primeira, '2026-11-11');
  });

  teste('o teto temporário da Etapa 4A sobreviveu à regeneração', () => {
    contem(CODIGO_C, 'TETO TEMPORARIO — REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS');
    // Ele mora dentro do `raise exception`, e não num comentário, justamente
    // porque o `_LIMPO` apaga comentários.
    const limpo = MIGRATION_C.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    contem(limpo, 'TETO TEMPORARIO');
  });

  teste('as validações de organização e permissão continuam nas duas RPCs', () => {
    igual((CODIGO_C.match(/public\.organizacao_do_auth\(\)/g) || []).length >= 2, true);
    contem(CODIGO_C, "tem_permissao('comercial.editar')");
  });

  teste('o pagamento continua transacional e com a regra do período em SQL', () => {
    contem(CODIGO_C, 'v_atraso := p_pago_em - v_ass.fim_periodo;');
    contem(CODIGO_C, 'if v_atraso <= v_tolerancia then');
    contem(CODIGO_C, 'exception when unique_violation then');
  });
});


// ───────────────────────────────────────────────────────────
grupo('comercial · o desfazer da Migration C', () => {
  teste('devolve o índice antigo e tira o novo', () => {
    const codigo = soCodigo(DESFAZER_C);
    contem(codigo, 'drop index if exists public.uq_comercial_cobranca_do_periodo;');
    contem(codigo, 'on public.financeiro_lancamentos (assinatura_id, vencimento)');
  });

  teste('as RPCs voltam ao texto de antes, sem as colunas novas', () => {
    const codigo = soCodigo(DESFAZER_C);
    ok(!/periodo_inicio, periodo_fim, descricao/.test(codigo),
      'o desfazer não pode gravar colunas que o índice antigo ignora');
    contem(codigo, "date_trunc('month', p_vencimento)::date");
  });

  teste('as colunas FICAM — o drop está comentado, de propósito', () => {
    // `drop column` joga fora o backfill, e `periodo_inicio` só se reconstrói
    // enquanto a assinatura não renovou.
    contem(DESFAZER_C, '-- alter table public.financeiro_lancamentos drop column if exists periodo_inicio;');
    const codigo = soCodigo(DESFAZER_C);
    ok(!/drop column/.test(codigo), 'nenhum drop de coluna executável');
  });

  teste('as funções do desfazer são byte a byte as das Migrations A e B', () => {
    // Um rollback que "quase" restaura é pior do que nenhum: ele passa, e o
    // banco fica num terceiro estado que ninguém escreveu de propósito. Este
    // teste é o que torna o desfazer confiável — não a boa-fé de quem o gerou.
    const corpo = (sql, nome) => {
      const ini = sql.indexOf(`create or replace function public.${nome}(`);
      ok(ini >= 0, `${nome} não está no arquivo`);
      const fim = sql.indexOf('\n$fn$;', ini);
      ok(fim > ini, `fim de ${nome} não encontrado`);
      return sql.slice(ini, fim + '\n$fn$;'.length);
    };

    const origem = {
      comercial_criar_cobranca_do_periodo: ler('../db/comercial_renovacao_programada.sql'),
      comercial_registrar_pagamento:       ler('../db/comercial_pagamento_transacional.sql'),
    };
    for (const [nome, sql] of Object.entries(origem)) {
      igual(corpo(DESFAZER_C, nome), corpo(sql, nome), `${nome} divergiu da origem`);
    }
  });

  teste('a Migration C difere da origem SÓ nos pontos documentados', () => {
    const linhas = s => s.split('\n');
    const diff = (a, b) => {
      const A = linhas(a), B = linhas(b);
      return B.filter(l => !A.includes(l)).map(l => l.trim()).filter(Boolean);
    };
    const novas = diff(ler('../db/comercial_pagamento_transacional.sql'), MIGRATION_C)
      .filter(l => l.startsWith('periodo_inicio') || l.startsWith('v_ass.inicio_periodo'));
    ok(novas.length > 0, 'a Migration C tem de acrescentar as colunas');
    // E nada além disso pode ter entrado no insert da automática.
    const insert = CODIGO_C.slice(CODIGO_C.lastIndexOf('insert into public.financeiro_lancamentos'));
    const ate = insert.slice(0, insert.indexOf('returning'));
    contem(ate, 'v_ass.valor_contratado, v_lanc.categoria_id, v_ass.paciente_id, v_ass.id');
  });

  teste('os grants são refeitos nos dois arquivos', () => {
    for (const sql of [MIGRATION_C, DESFAZER_C]) {
      contem(soCodigo(sql), 'revoke all on function public.comercial_criar_cobranca_do_periodo');
      contem(soCodigo(sql), 'grant execute on function public.comercial_registrar_pagamento');
    }
  });
});
