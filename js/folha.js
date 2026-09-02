// ═══════════════════════════════════════════════════════════
// FOLHA DE PAGAMENTO — camada de dados e cálculo
// ═══════════════════════════════════════════════════════════
// Substitui a planilha "Ponto - PONTO". O fluxo é o mesmo de antes: o total de
// HORAS DIURNAS sai da folha de ponto, entra aqui em h:mm, e o valor sai de
// minutos ÷ 60 × valor/hora. O que a planilha somava na coluna "TOTAL + BÔNUS"
// virou uma lista de adicionais com descrição — porque a descrição ("58 alunos
// ativos", "10% de bônus", "PAGAMENTO DE FÉRIAS") é o único registro de por que
// aquele valor foi aquele.
//
// O arredondamento acontece UMA vez, no valor final de cada linha, como na
// planilha. Somar valores já arredondados e arredondar de novo produziria
// centavos de diferença em relação ao histórico importado.

// O DONO SAI DO BANCO — Etapa 4C, Fase 1. Nenhuma escrita deste arquivo manda
// `nutri_id`: quem determina o tenant é o default da coluna. Antes, as quatro
// funções de criação recebiam o dono como PARÂMETRO, encanado desde
// `initEquipeUI(sessao.user.id)` no index.html — e era isso que fazia a folha
// de um membro nascer no nome dele em vez de no da organização.
//
// As LEITURAS continuam sem filtro de `nutri_id`: aqui é o RLS que isola, e a
// Fase 2 troca a policy sem tocar nesta camada.
import { sb } from './supabase.js';
import { formatarBRL, valorDeTexto } from './utils.js';

// Reexportados para quem lida com folha não precisar importar de dois lugares.
export { formatarBRL, valorDeTexto };

export const STATUS_FOLHA = { rascunho: 'Rascunho', fechada: 'Fechada' };

/**
 * Sugestões para a descrição do adicional. São SUGESTÃO, não lista fechada:
 * o histórico tem "10% de bônus", "FERIADO", "Hora extra", "PAGAMENTO DE
 * FÉRIAS" — travar em quatro opções obrigaria a mentir na descrição no mês em
 * que aparecesse a quinta, e a descrição é o que explica o valor depois.
 */
export const ADICIONAIS_SUGERIDOS = [
  'Bônus por número de alunos',
  'Bônus por presença do aluno',
  'Auxílio faculdade',
  'Premiação',
];

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// ───────────────────────────────────────────────────────────
// CÁLCULO — puro, sem DOM e sem rede
// ───────────────────────────────────────────────────────────

/**
 * Texto do ponto → minutos. Aceita o que a pessoa realmente digita:
 *   "48:41"  "48h41"  "48 41"  → 2921
 *   "48"                       → 2880 (horas cheias)
 *   ""  ou lixo                → null
 */
export function minutosDeTexto(txt) {
  const t = String(txt ?? '').trim();
  if (!t) return null;

  const comMinutos = /^(\d{1,4})\s*[:hH\s]\s*(\d{1,2})$/.exec(t);
  if (comMinutos) {
    const h = Number(comMinutos[1]), m = Number(comMinutos[2]);
    if (m > 59) return null;
    return h * 60 + m;
  }

  const soHoras = /^(\d{1,4})\s*[hH]?$/.exec(t);
  if (soHoras) return Number(soHoras[1]) * 60;

  return null;
}

/** 2921 → "48:41". Null vira string vazia — campo em branco, não "0:00". */
export function textoDeMinutos(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return '';
  const n = Math.max(0, Math.round(Number(min)));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export function arredondar(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** minutos ÷ 60 × valor/hora — a conta que a planilha fazia. */
export function valorBase(minutos, valorHora) {
  const min = Number(minutos), vh = Number(valorHora);
  if (!Number.isFinite(min) || !Number.isFinite(vh)) return 0;
  return arredondar((min / 60) * vh);
}

/** Total de uma linha: o que foi calculado mais os adicionais (e descontos). */
export function totalItem(item) {
  const base = Number(item?.valor_base) || 0;
  const extras = (item?.adicionais || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
  return arredondar(base + extras);
}

export function totalFolha(itens) {
  return arredondar((itens || []).reduce((s, i) => s + totalItem(i), 0));
}

export function totalMinutos(itens) {
  return (itens || []).reduce((s, i) => s + (Number(i.minutos) || 0), 0);
}

/** '2026-08-01' → 'Agosto de 2026'. */
export function nomeCompetencia(competencia) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia || ''));
  if (!m) return '—';
  return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** Date → '2026-08-01' (primeiro dia do mês, sem passar por fuso). */
export function competenciaDe(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/** A competência do mês corrente. */
export function competenciaAtual(hoje = new Date()) {
  return competenciaDe(hoje.getFullYear(), hoje.getMonth() + 1);
}

/** Mês seguinte ao da competência — para o botão "próxima folha". */
export function proximaCompetencia(competencia) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia || ''));
  if (!m) return competenciaAtual();
  let ano = Number(m[1]), mes = Number(m[2]) + 1;
  if (mes > 12) { mes = 1; ano++; }
  return competenciaDe(ano, mes);
}

// ───────────────────────────────────────────────────────────
// LEITURA
// ───────────────────────────────────────────────────────────

/** Competências existentes, da mais recente para a mais antiga. */
export async function listarFolhas({ limite = 36 } = {}) {
  const { data, error } = await sb
    .from('folhas')
    .select('*')
    .order('competencia', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

export async function buscarFolhaPorCompetencia(competencia) {
  const { data, error } = await sb
    .from('folhas').select('*').eq('competencia', competencia).maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * A folha com tudo o que a tela precisa: itens, adicionais e o funcionário de
 * cada linha, já aninhados. Uma consulta só — o PostgREST monta o encaixe.
 */
export async function carregarFolha(folhaId) {
  const { data, error } = await sb
    .from('folha_itens')
    .select(`
      *,
      funcionario:funcionarios ( id, nome, cpf, cargo, unidade, chave_pix, ativo, valor_hora ),
      adicionais:folha_adicionais ( id, descricao, valor, ordem )
    `)
    .eq('folha_id', folhaId);
  if (error) throw error;

  const itens = (data || []).map(i => ({
    ...i,
    adicionais: (i.adicionais || []).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
  }));
  itens.sort((a, b) => (a.funcionario?.nome || '').localeCompare(b.funcionario?.nome || '', 'pt-BR'));
  return itens;
}

/** Todo o histórico de um funcionário, da folha mais recente para trás. */
export async function historicoDoFuncionario(funcionarioId, { limite = 24 } = {}) {
  const { data, error } = await sb
    .from('folha_itens')
    .select('*, folha:folhas ( competencia, data_pagamento, status ), adicionais:folha_adicionais ( valor )')
    .eq('funcionario_id', funcionarioId)
    .limit(limite);
  if (error) throw error;
  return (data || [])
    .sort((a, b) => String(b.folha?.competencia).localeCompare(String(a.folha?.competencia)));
}

// ───────────────────────────────────────────────────────────
// ESCRITA
// ───────────────────────────────────────────────────────────

/** O INSERT NÃO MANDA `nutri_id`: quem determina o tenant é o default da
 *  coluna. Ver o bloco "O DONO SAI DO BANCO" no topo deste arquivo. */
export async function criarFolha(competencia) {
  const { data, error } = await sb
    .from('folhas')
    .insert({ competencia })
    .select().single();
  if (error) throw error;
  return data;
}

/**
 * Abre a folha da competência, criando se ainda não existe, e já lança uma
 * linha para cada funcionário ativo — com o valor/hora do cadastro.
 * Quem entrou depois aparece na próxima vez que a folha for aberta.
 *
 * `criar` EXISTE POR CAUSA DE UM INCIDENTE, em 02/09/2026. Esta função lia
 * "zero linhas" como "a folha do mês ainda não existe" e criava. Só que zero
 * linhas também é o que o RLS devolve quando a folha existe e você não pode
 * vê-la — e foi isso que aconteceu quando um membro sem tenancy migrada abriu
 * a tela: ele não viu a folha do mês e o sistema criou uma segunda, vazia, no
 * nome dele. Invisível para os dois lados.
 *
 * Ausência e invisibilidade são coisas diferentes, e o código não tinha como
 * distingui-las. Agora quem chama declara a intenção: a tela de folha abre com
 * `criar: false` para LER, e só o botão de abrir o mês passa `true`. Sem folha
 * e sem permissão de criar, estoura `folha_nao_encontrada` em vez de duplicar.
 */
export async function abrirFolha(competencia, funcionariosAtivos = [], { criar = false } = {}) {
  let folha = await buscarFolhaPorCompetencia(competencia);
  if (!folha) {
    if (!criar) throw new Error('folha_nao_encontrada');
    folha = await criarFolha(competencia);
  }

  const itens = await carregarFolha(folha.id);
  const jaTem = new Set(itens.map(i => i.funcionario_id));
  const faltando = funcionariosAtivos.filter(f => !jaTem.has(f.id));

  if (faltando.length && folha.status !== 'fechada') {
    const novos = faltando.map(f => ({
      folha_id: folha.id,
      funcionario_id: f.id,
      modo: f.salario_fixo ? 'fixo' : 'horas',
      minutos: null,
      valor_hora: f.valor_hora ?? null,
      valor_base: f.salario_fixo ? Number(f.salario_fixo) : 0,
    }));
    const { error } = await sb.from('folha_itens').insert(novos);

    // Duas abas abrindo o mesmo mês tentam criar as mesmas linhas. A segunda
    // esbarra no índice único — e isso não é erro: quer dizer que a linha já
    // existe, que era exatamente o objetivo. Recarregar resolve; abortar
    // deixaria a folha inacessível até fechar a outra aba.
    if (error && !ehLinhaDuplicada(error)) throw error;
    return { folha, itens: await carregarFolha(folha.id) };
  }

  return { folha, itens };
}

/** Violação do índice único de (folha, funcionário) — 23505 no Postgres. */
export function ehLinhaDuplicada(erro) {
  return erro?.code === '23505'
    || /duplicate key|uniq_folha_itens_funcionario/i.test(erro?.message || '');
}

export async function salvarItem(id, dados) {
  const { data, error } = await sb
    .from('folha_itens')
    .update({ ...dados, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirItem(id) {
  const { error } = await sb.from('folha_itens').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function adicionarItem(folhaId, funcionario) {
  const { data, error } = await sb
    .from('folha_itens')
    .insert({
      folha_id: folhaId,
      funcionario_id: funcionario.id,
      modo: funcionario.salario_fixo ? 'fixo' : 'horas',
      valor_hora: funcionario.valor_hora ?? null,
      valor_base: funcionario.salario_fixo ? Number(funcionario.salario_fixo) : 0,
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function adicionarAdicional(itemId, { descricao, valor, ordem = 0 }) {
  const { data, error } = await sb
    .from('folha_adicionais')
    .insert({ item_id: itemId, descricao, valor, ordem })
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirAdicional(id) {
  const { error } = await sb.from('folha_adicionais').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function atualizarFolha(id, dados) {
  const { data, error } = await sb
    .from('folhas')
    .update({ ...dados, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/**
 * Fecha a folha e registra o dia do pagamento. Fechada, a tela não deixa mais
 * editar — mas dá para reabrir: erro em folha de pagamento se corrige, não se
 * esconde. O que fica registrado é a data em que o dinheiro saiu.
 */
export async function fecharFolha(id, dataPagamento) {
  return atualizarFolha(id, { status: 'fechada', data_pagamento: dataPagamento || null });
}

export async function reabrirFolha(id) {
  return atualizarFolha(id, { status: 'rascunho' });
}

export async function excluirFolha(id) {
  const { error } = await sb.from('folhas').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export function traduzirErroFolha(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('uniq_folhas_competencia')) return 'Já existe uma folha para este mês.';
  if (m.includes('uniq_folha_itens_funcionario')) return 'Este funcionário já está nesta folha.';
  if (m.includes('violates row-level security')) return 'Folha fechada não pode ser alterada. Reabra antes de editar.';
  if (m.includes('relation') && (m.includes('folha') || m.includes('folhas'))) {
    return 'As tabelas da folha ainda não existem no banco — rode db/folha_schema.sql.';
  }
  return msg || 'Algo deu errado.';
}
