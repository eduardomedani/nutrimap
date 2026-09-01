// ═══════════════════════════════════════════════════════════
// FINANCEIRO DA EMPRESA — camada de dados e cálculo
// ═══════════════════════════════════════════════════════════
// O caixa: o que sai e o que entra. NÃO é a folha de pagamento — o custo de
// colaborador é apurado em js/folha.js a partir do ponto, e aqui ele é LIDO,
// nunca copiado. As duas coisas somadas dão o custo do mês; guardadas nos dois
// lugares, dariam dois números diferentes no primeiro mês em que alguém
// corrigisse um lado só.
//
// A importação da planilha de custos deixou duas classes de pendência, de
// propósito: 22 lançamentos sem categoria e 1 sem valor. Nada foi adivinhado —
// classificar por semelhança de texto seria escrever no balanço uma opinião do
// programa, e quem lê o caixa não tem como saber que o número foi inferido.
// Por isso `pendencias()` existe e a tela mostra o que falta em vez de exibir
// um total com cara de completo.

// O DONO SAI DO BANCO — Etapa 4B, Fase 1. Nenhuma escrita deste arquivo manda
// `nutri_id`: quem determina o tenant é o default da coluna. Antes, as quatro
// funções de criação recebiam o dono como PARÂMETRO, encanado desde
// `initFinanceiroUI` — o que dava a uma tela o poder de escolher o dono de uma
// linha, por engano ou por request adulterado.
//
// As LEITURAS continuam sem filtro de `nutri_id`, e isso é o desenho certo:
// aqui é o RLS que isola, e a Fase 2 troca a policy sem tocar nesta camada.
// Diferente do Comercial, que filtra explicitamente porque a conta do
// proprietário é nutri E paciente ao mesmo tempo.
import { sb } from './supabase.js';
import { formatarBRL, valorDeTexto } from './utils.js';
import { nomeCompetencia, competenciaDe, competenciaAtual } from './folha.js';

export { formatarBRL, valorDeTexto, nomeCompetencia, competenciaDe, competenciaAtual };

export const TIPOS = { receita: 'Receita', despesa: 'Despesa' };

/** Rótulo da categoria ausente. É texto de tela, não valor gravado: no banco a
 *  ausência de categoria é `categoria_id is null`, e não uma categoria chamada
 *  "Sem categoria" — que apareceria nos relatórios como se fosse um centro de
 *  custo de verdade. */
export const SEM_CATEGORIA = 'Sem categoria';

// ───────────────────────────────────────────────────────────
// CÁLCULO — puro, sem banco
// ───────────────────────────────────────────────────────────

/**
 * TODA SOMA DESTE MÓDULO PASSA POR CENTAVOS INTEIROS.
 *
 * `0.1 + 0.2` não é `0.3` em ponto flutuante, e o erro acumula: somar as 2.177
 * vendas como float dá R$ 593.781,26 onde o Postgres, que soma `numeric`
 * exato, dá R$ 593.781,27. Um centavo é irrelevante como dinheiro e fatal como
 * sinal — a tela mostrando um número diferente do banco ensina quem confere a
 * ignorar divergência, e a próxima vai ser de mil reais.
 */
const emCentavos = v => Math.round((Number(v) || 0) * 100);

/**
 * O lançamento entra nos totais?
 *
 * Cancelado NÃO é dinheiro: somar transformaria uma despesa desfeita em custo.
 * Arquivado também sai. Os dois continuam na tabela e podem ser listados — o
 * que se recusa é a soma, não a existência.
 *
 * Lançamento sem `status` conta: são as 2.487 linhas importadas antes da coluna
 * existir, e tratá-las como canceladas zeraria o histórico inteiro.
 */
export function contaNoTotal(l) {
  return l?.status !== 'cancelado' && !l?.arquivado_em;
}

const somaveis = lista => (lista || []).filter(contaNoTotal);

/** Soma que ignora nulo. Lançamento sem valor não vale zero: vale desconhecido,
 *  e é `pendencias()` que denuncia isso. Somar como zero aqui faria o total
 *  parecer fechado. */
export function somar(lancamentos) {
  return somaveis(lancamentos).reduce((s, l) => s + emCentavos(l.valor), 0) / 100;
}

/** Total por categoria, do maior para o menor. Sem categoria entra como uma
 *  linha própria — some-la no "outros" esconderia justamente o que falta. */
export function porCategoria(lancamentos, categorias = []) {
  const nomes = new Map((categorias || []).map(c => [c.id, c.nome]));
  const acc = new Map();
  for (const l of somaveis(lancamentos)) {
    const chave = l.categoria_id || null;
    const atual = acc.get(chave) || { id: chave, nome: nomes.get(chave) || SEM_CATEGORIA, n: 0, total: 0 };
    atual.n++;
    atual.total += emCentavos(l.valor);
    acc.set(chave, atual);
  }
  return [...acc.values()]
    .map(c => ({ ...c, total: c.total / 100 }))
    .sort((a, b) => b.total - a.total);
}

/** Total por competência, do mês mais antigo para o mais novo (é a ordem que o
 *  gráfico lê). */
export function porCompetencia(lancamentos) {
  const acc = new Map();
  for (const l of somaveis(lancamentos)) {
    const c = String(l.competencia || '').slice(0, 10);
    if (!c) continue;
    const atual = acc.get(c) || { competencia: c, n: 0, total: 0 };
    atual.n++;
    atual.total += emCentavos(l.valor);
    acc.set(c, atual);
  }
  return [...acc.values()]
    .map(x => ({ ...x, total: x.total / 100 }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/** Total por ano. */
export function porAno(lancamentos) {
  const acc = new Map();
  for (const l of somaveis(lancamentos)) {
    const ano = anoDa(l.competencia);
    if (!ano) continue;
    acc.set(ano, (acc.get(ano) || 0) + emCentavos(l.valor));
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ano, centavos]) => ({ ano, total: centavos / 100 }));
}

/** O que impede o total de ser lido como completo. Cancelado e arquivado saem:
 *  cobrar categoria de um lançamento desfeito é pedir trabalho por nada. */
export function pendencias(lancamentos) {
  const lista = somaveis(lancamentos);
  return {
    semValor: lista.filter(l => l.valor === null || l.valor === undefined),
    semCategoria: lista.filter(l => !l.categoria_id),
    naoPagos: lista.filter(l => (l.status || (l.pago ? 'pago' : 'pendente')) === 'pendente'),
  };
}

/**
 * Contas a pagar: despesa pendente COM vencimento.
 *
 * Pendente sem vencimento não é conta a pagar — é lançamento incompleto, e
 * mostrá-lo numa lista ordenada por data o poria em algum lugar arbitrário do
 * calendário, dando a entender uma data que ninguém informou.
 *
 * `vencidas`, `hoje` e `proximas` são derivadas da data corrente, nunca
 * gravadas: gravar exigiria um job reescrevendo linhas toda meia-noite, e a
 * linha que o job não alcançasse mentiria.
 */
export function contasAPagar(lancamentos, hoje, { horizonte = 7 } = {}) {
  const dia = String(hoje);
  const limite = somarDias(dia, horizonte);

  const abertas = somaveis(lancamentos)
    .filter(l => l.tipo === 'despesa')
    .filter(l => (l.status || (l.pago ? 'pago' : 'pendente')) === 'pendente')
    .filter(l => !!l.vencimento)
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));

  return {
    todas: abertas,
    vencidas: abertas.filter(l => String(l.vencimento) < dia),
    hoje:     abertas.filter(l => String(l.vencimento) === dia),
    proximas: abertas.filter(l => String(l.vencimento) > dia && String(l.vencimento) <= limite),
    futuras:  abertas.filter(l => String(l.vencimento) > limite),
    semVencimento: somaveis(lancamentos)
      .filter(l => l.tipo === 'despesa')
      .filter(l => (l.status || (l.pago ? 'pago' : 'pendente')) === 'pendente')
      .filter(l => !l.vencimento),
  };
}

/** 'YYYY-MM-DD' + n dias, sem passar por fuso. */
export function somarDias(iso, dias) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(dias)));
  const p = x => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Último dia do mês da data — atalho "fim do mês" do campo de vencimento. */
export function fimDoMes(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  const p = x => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Custo do mês: as despesas lançadas MAIS a folha apurada pelo módulo Equipe.
 *
 * As duas parcelas vêm separadas de propósito e a tela as mostra separadas: o
 * número da folha é responsabilidade de outro módulo, e um total que junta as
 * duas sem dizer de onde vêm é impossível de conferir quando diverge.
 */
export function custoDoMes(despesasDoMes, folhaDoMes) {
  const despesas = emCentavos(somar(despesasDoMes));
  const folha = emCentavos(folhaDoMes?.total);
  return { despesas: despesas / 100, folha: folha / 100, total: (despesas + folha) / 100 };
}

/** '2026-08-01' → '2026'. Existe para a tela não repetir slice(0,4) em oito
 *  lugares e errar num deles. */
export function anoDa(competencia) {
  return String(competencia || '').slice(0, 4);
}

/** Anos com movimento, do mais recente para o mais antigo. A folha entra na
 *  conta: um ano só de folha, sem lançamento nenhum, ainda é um ano com custo. */
export function anosDisponiveis(lancamentos, folha = []) {
  const anos = new Set();
  for (const l of lancamentos || []) { const a = anoDa(l.competencia); if (a) anos.add(a); }
  for (const f of folha || [])       { const a = anoDa(f.competencia); if (a) anos.add(a); }
  return [...anos].sort().reverse();
}

/**
 * Os doze meses de um ano, com receita, despesa e folha.
 *
 * SEMPRE DOZE, mesmo os vazios. Desenhar só os meses com movimento comprime o
 * eixo e faz uma operação de três meses parecer um ano cheio — e a lacuna é
 * informação: mês sem receita é um fato sobre o negócio, não ausência de dado.
 *
 * `despesa` e `folha` vêm separadas porque são apuradas por módulos diferentes.
 * A soma das duas é o custo do mês; guardá-las juntas apagaria de onde cada
 * pedaço veio no dia em que os dois números divergirem.
 */
export function serieAnual(lancamentos, folha, ano) {
  const alvo = String(ano);
  const meses = [];

  for (let m = 1; m <= 12; m++) {
    const competencia = competenciaDe(alvo, m);
    let receita = 0, despesa = 0;

    for (const l of somaveis(lancamentos)) {
      if (String(l.competencia || '').slice(0, 7) !== competencia.slice(0, 7)) continue;
      if (l.tipo === 'receita') receita += emCentavos(l.valor);
      else despesa += emCentavos(l.valor);
    }

    let folhaMes = 0;
    for (const f of folha || []) {
      if (String(f.competencia || '').slice(0, 7) === competencia.slice(0, 7)) folhaMes += emCentavos(f.total);
    }

    meses.push({
      competencia,
      receita: receita / 100,
      despesa: despesa / 100,
      folha: folhaMes / 100,
      custo: (despesa + folhaMes) / 100,
      resultado: (receita - despesa - folhaMes) / 100,
    });
  }
  return meses;
}

/**
 * FLUXO DE CAIXA — os doze meses de um ano, realizado e projetado.
 *
 * AQUI AS TRÊS DATAS FINALMENTE SE SEPARAM, e é por isso que elas existem:
 *
 *   realizado  -> pelo `pago_em`. É quando o dinheiro ANDOU. Um boleto de
 *                 julho pago em agosto sai do caixa em agosto, e é isso que o
 *                 extrato bancário vai mostrar.
 *   projetado  -> pelo `vencimento` do que ainda está pendente. É compromisso,
 *                 não fato, e a tela nunca soma os dois no mesmo número.
 *   competência-> NÃO é usada aqui. Ela responde "de que mês é esta despesa",
 *                 que é pergunta de relatório gerencial, não de caixa.
 *
 * Usar uma data só para os três contextos é o defeito clássico do módulo
 * financeiro: o relatório do mês fecha certo e o caixa fica errado, ou o
 * contrário, e não há como saber qual dos dois está mentindo.
 *
 * A FOLHA entra como saída realizada pela competência, que na convenção deste
 * projeto é o mês do pagamento (ver db/folha_schema.sql).
 */
export function fluxoDeCaixa(lancamentos, folha, ano) {
  const alvo = String(ano);
  const meses = [];
  let acumulado = 0;

  for (let m = 1; m <= 12; m++) {
    const competencia = competenciaDe(alvo, m);
    const chave = competencia.slice(0, 7);

    let entrou = 0, saiu = 0, aReceber = 0, aPagar = 0;

    for (const l of somaveis(lancamentos)) {
      const pago = (l.status || (l.pago ? 'pago' : 'pendente')) === 'pago';
      const cents = emCentavos(l.valor);

      if (pago) {
        // Sem `pago_em` não há como saber QUANDO o dinheiro andou. A linha fica
        // fora do fluxo em vez de entrar num mês adivinhado — e aparece na
        // conferência como pendência, que é o que ela é.
        if (String(l.pago_em || '').slice(0, 7) !== chave) continue;
        if (l.tipo === 'receita') entrou += cents; else saiu += cents;
      } else {
        if (String(l.vencimento || '').slice(0, 7) !== chave) continue;
        if (l.tipo === 'receita') aReceber += cents; else aPagar += cents;
      }
    }

    let folhaMes = 0;
    for (const f of folha || []) {
      if (String(f.competencia || '').slice(0, 7) === chave) folhaMes += emCentavos(f.total);
    }

    const saldo = entrou - saiu - folhaMes;
    acumulado += saldo;

    meses.push({
      competencia,
      entrou: entrou / 100,
      saiu: (saiu + folhaMes) / 100,
      saiuLancado: saiu / 100,
      folha: folhaMes / 100,
      aReceber: aReceber / 100,
      aPagar: aPagar / 100,
      saldo: saldo / 100,
      acumulado: acumulado / 100,
      projetado: (aReceber - aPagar) / 100,
    });
  }
  return meses;
}

/** O que o fluxo não consegue posicionar no tempo. Existe para a tela poder
 *  dizer "faltam N linhas aqui" em vez de exibir um saldo com cara de completo. */
export function forasDoFluxo(lancamentos) {
  const lista = somaveis(lancamentos);
  return {
    pagoSemData: lista.filter(l =>
      (l.status || (l.pago ? 'pago' : 'pendente')) === 'pago' && !l.pago_em),
    pendenteSemVencimento: lista.filter(l =>
      (l.status || (l.pago ? 'pago' : 'pendente')) === 'pendente' && !l.vencimento),
  };
}

/** Os totais do ano, somados a partir da própria série do gráfico — para o
 *  número escrito e a altura da barra nunca discordarem. */
export function totaisDoAno(meses) {
  const c = (meses || []).reduce((acc, m) => ({
    receita: acc.receita + emCentavos(m.receita),
    despesa: acc.despesa + emCentavos(m.despesa),
    folha:   acc.folha   + emCentavos(m.folha),
  }), { receita: 0, despesa: 0, folha: 0 });

  return {
    receita: c.receita / 100,
    despesa: c.despesa / 100,
    folha: c.folha / 100,
    custo: (c.despesa + c.folha) / 100,
    resultado: (c.receita - c.despesa - c.folha) / 100,
  };
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA', sem passar por Date (que muda o dia por fuso). */
export function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

/**
 * Hoje em 'YYYY-MM-DD' pelo relógio LOCAL.
 *
 * `toISOString()` devolve UTC: entre 21h e meia-noite no horário de Brasília
 * ele já responde o dia seguinte. Num lançamento feito na virada do mês, isso
 * põe a despesa na competência errada — e competência errada não avisa que
 * está errada, só faz o mês fechar com outro número.
 */
export function hojeISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ───────────────────────────────────────────────────────────
// LEITURA
// ───────────────────────────────────────────────────────────

/** As categorias do plano de contas, na ordem definida no cadastro. */
export async function listarCategorias(tipo = null) {
  let q = sb.from('financeiro_categorias')
    .select('id, nome, tipo, ativo, ordem')
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Lançamentos do período. `de` e `ate` são competências ('2026-01-01').
 *
 * O limite alto é intencional: são 310 linhas de três anos e a tela agrupa
 * todas. Paginar aqui obrigaria a somar por páginas, e soma parcial exibida
 * como total é o defeito que este módulo existe para não ter.
 */
const CAMPOS = 'id, tipo, data, competencia, descricao, valor, pago, status, vencimento, ' +
  'pago_em, categoria_id, centro_custo_id, fornecedor, forma_pagamento, documento, ' +
  'observacoes, origem, origem_linha, metadata, arquivado_em';

export async function listarLancamentos({ de = null, ate = null, tipo = null, limite = 3000 } = {}) {
  let q = sb.from('financeiro_lancamentos')
    .select(CAMPOS)
    .order('data', { ascending: false })
    .limit(limite);
  if (de)   q = q.gte('competencia', de);
  if (ate)  q = q.lte('competencia', ate);
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** O resumo agregado no banco — para quando a tela quiser só os totais. */
export async function resumoMensal({ de = null, ate = null } = {}) {
  let q = sb.from('financeiro_resumo_mensal')
    .select('competencia, tipo, lancamentos, pendentes, total, total_pago, total_aberto')
    .order('competencia', { ascending: true });
  if (de)  q = q.gte('competencia', de);
  if (ate) q = q.lte('competencia', ate);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Custo da equipe por competência, do módulo dono do assunto. Silencioso
 *  quando a view não existe: o Financeiro funciona sem ela, só sem esse número. */
export async function folhaPorCompetencia() {
  try {
    const { data, error } = await sb
      .from('folha_resumo_mensal')
      .select('competencia, status, total')
      .order('competencia', { ascending: true });
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}

// ───────────────────────────────────────────────────────────
// ESCRITA
// ───────────────────────────────────────────────────────────

/** Os centros de custo: ONDE o dinheiro foi alocado. Não confundir com
 *  categoria, que é a NATUREZA do gasto — ver db/financeiro_centros_custo_migrar.sql. */
export async function listarCentrosCusto() {
  const { data, error } = await sb.from('financeiro_centros_custo')
    .select('id, nome, ativo, ordem')
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Sem `nutri_id`: quem determina o tenant é o default da coluna. Ver o bloco
 *  "O DONO SAI DO BANCO" no topo deste arquivo. */
export async function criarCentroCusto(nome) {
  const { data, error } = await sb.from('financeiro_centros_custo')
    .insert({ nome: String(nome || '').trim() })
    .select('id, nome, ativo, ordem')
    .single();
  if (error) throw error;
  return data;
}

/** A trilha de auditoria de um lançamento, da mais recente para a mais antiga.
 *  Só leitura: quem escreve é o trigger do banco. */
export async function auditoriaDoLancamento(id, { limite = 30 } = {}) {
  const { data, error } = await sb.from('financeiro_auditoria')
    .select('id, acao, usuario_id, antes, depois, criado_em')
    .eq('lancamento_id', id)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) return [];       // auditoria ausente não pode impedir a edição
  return data || [];
}

export async function criarCategoria({ nome, tipo = 'despesa', ordem = 0 }) {
  const { data, error } = await sb.from('financeiro_categorias')
    .insert({ nome: String(nome || '').trim(), tipo, ordem })
    .select('id, nome, tipo, ativo, ordem')
    .single();
  if (error) throw error;
  return data;
}

export async function renomearCategoria(id, nome) {
  const { error } = await sb.from('financeiro_categorias')
    .update({ nome: String(nome || '').trim(), atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Move todos os lançamentos de uma categoria para outra e apaga a de origem.
 *
 * É a operação que resolve "MANUTENÇÃO" e "MANUTENÇÃO CORRETIVA" serem o mesmo
 * assunto escrito duas vezes. Move ANTES de apagar: a coluna é
 * `on delete set null`, então apagar primeiro deixaria os lançamentos órfãos e
 * o trabalho teria de ser refeito à mão.
 */
export async function fundirCategorias(idOrigem, idDestino) {
  if (!idOrigem || !idDestino || idOrigem === idDestino) return 0;

  const { data, error } = await sb.from('financeiro_lancamentos')
    .update({ categoria_id: idDestino, atualizado_em: new Date().toISOString() })
    .eq('categoria_id', idOrigem)
    .select('id');
  if (error) throw error;

  const { error: erroDel } = await sb.from('financeiro_categorias').delete().eq('id', idOrigem);
  if (erroDel) throw erroDel;

  return (data || []).length;
}

export async function salvarLancamento(id, dados) {
  const patch = { ...dados, atualizado_em: new Date().toISOString() };
  // `data` e `competencia` andam juntas: o banco tem um CHECK exigindo que a
  // competência seja o mês da data. Deixar a tela lembrar disso seria deixar a
  // tela quebrar num lugar onde o erro só aparece no salvamento.
  if (patch.data) patch.competencia = String(patch.data).slice(0, 8) + '01';
  const { error } = await sb.from('financeiro_lancamentos').update(patch).eq('id', id);
  if (error) throw error;
}

export async function criarLancamento(dados) {
  const data = String(dados.data || '').slice(0, 10);
  const { data: criado, error } = await sb.from('financeiro_lancamentos')
    .insert({
      tipo: dados.tipo || 'despesa',
      data,
      competencia: data.slice(0, 8) + '01',
      descricao: String(dados.descricao || '').trim(),
      valor: dados.valor ?? null,
      pago: dados.pago !== false,
      categoria_id: dados.categoria_id || null,
      observacoes: dados.observacoes || null,
      origem: 'manual',
    })
    .select('id')
    .single();
  if (error) throw error;
  return criado;
}

/**
 * Cria uma despesa a partir do formulário já convertido por `despesaParaBanco`.
 *
 * Não reaproveita `criarLancamento`: aquele nasceu para o formulário curto de
 * receita e deriva a competência da data. Aqui a competência é ESCOLHIDA pelo
 * usuário e é o campo que manda — derivar da data de pagamento poria a despesa
 * no mês errado toda vez que se paga em atraso.
 */
export async function criarDespesa(campos) {
  const { data, error } = await sb.from('financeiro_lancamentos')
    .insert({ ...campos, origem: 'manual' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function salvarDespesa(id, campos) {
  const { error } = await sb.from('financeiro_lancamentos')
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Cancelar em vez de apagar: o lançamento sai dos totais e continua no
 *  registro. Apagar levaria junto a informação de que aquilo existiu — e é
 *  justamente isso que alguém vai querer saber daqui a seis meses. */
export async function cancelarDespesa(id) {
  const { error } = await sb.from('financeiro_lancamentos')
    .update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function arquivarDespesa(id) {
  const { error } = await sb.from('financeiro_lancamentos')
    .update({ arquivado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Marca como paga sem abrir o formulário — a ação mais frequente da lista. */
export async function marcarComoPaga(id, { pago_em, forma_pagamento = null } = {}) {
  const { error } = await sb.from('financeiro_lancamentos')
    .update({
      status: 'pago',
      pago_em: pago_em || null,
      forma_pagamento,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function excluirLancamento(id) {
  const { error } = await sb.from('financeiro_lancamentos').delete().eq('id', id);
  if (error) throw error;
}
