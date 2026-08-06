// ═══════════════════════════════════════════════════════════
// COMERCIAL — camada de dados
// ═══════════════════════════════════════════════════════════
// Tudo com a anon-key + RLS (`nutri_id = auth.uid()`). As regras não moram
// aqui: este arquivo busca e grava, js/comercial.js decide.
//
// FILTRO EXPLÍCITO, sempre. A conta do Eduardo é nutri E paciente ao mesmo
// tempo, e as policies do projeto são OR'd — uma consulta que dependesse só do
// RLS para isolar devolveria dado de mais. O RLS é a segunda camada, não a
// primeira.

import { sb } from './supabase.js';
import { renovar, competenciaDaCobranca, PLANO_PADRAO } from './comercial.js';

async function nutriId() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('sem_sessao');
  return user.id;
}

// ── PLANOS ────────────────────────────────────────────────────

export async function listarPlanos({ incluirInativos = false } = {}) {
  const id = await nutriId();
  let q = sb.from('comercial_planos').select('*').eq('nutri_id', id);
  if (!incluirInativos) q = q.eq('ativo', true);
  const { data, error } = await q.order('ordem').order('nome');
  if (error) throw error;
  return data || [];
}

export async function criarPlano(dados) {
  const id = await nutriId();
  const { data, error } = await sb
    .from('comercial_planos')
    .insert({ ...dados, nutri_id: id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function salvarPlano(planoId, dados) {
  const id = await nutriId();
  // `nutri_id` fora do update de propósito: mudar o dono de um plano não é uma
  // edição, é um erro.
  const { nutri_id, id: _ignorado, ...limpo } = dados;
  const { data, error } = await sb
    .from('comercial_planos')
    .update(limpo)
    .eq('id', planoId)
    .eq('nutri_id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── ASSINATURAS ───────────────────────────────────────────────

/** As assinaturas com o nome do cliente e o plano juntos — uma consulta só.
 *  Uma por linha da tela; buscar o paciente separado seria N+1. */
export async function listarAssinaturas({ incluirCanceladas = true } = {}) {
  const id = await nutriId();
  let q = sb
    .from('comercial_assinaturas')
    .select('*, paciente:pacientes(id, nome, telefone, status), plano:comercial_planos(*)')
    .eq('nutri_id', id);
  if (!incluirCanceladas) q = q.neq('status', 'cancelada');
  const { data, error } = await q.order('fim_periodo');
  if (error) throw error;
  return data || [];
}

export async function assinaturaDoPaciente(pacienteId) {
  const id = await nutriId();
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos(*)')
    .eq('nutri_id', id)
    .eq('paciente_id', pacienteId)
    .in('status', ['ativa', 'aguardando_inicio', 'pausada'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function criarAssinatura(dados) {
  const id = await nutriId();
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .insert({ ...dados, nutri_id: id })
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function salvarAssinatura(assinaturaId, dados) {
  const id = await nutriId();
  const { nutri_id, id: _i, paciente, plano, ...limpo } = dados;
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .update(limpo)
    .eq('id', assinaturaId)
    .eq('nutri_id', id)
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos(*)')
    .single();
  if (error) throw error;
  return data;
}

// ── COBRANÇAS (que são lançamentos) ───────────────────────────

/** O histórico de uma assinatura: toda cobrança, paga ou não, mais nova
 *  primeiro. É daqui que saem recorrência, inadimplência e ticket médio. */
export async function cobrancasDaAssinatura(assinaturaId) {
  const id = await nutriId();
  const { data, error } = await sb
    .from('financeiro_lancamentos')
    .select('*')
    .eq('nutri_id', id)
    .eq('assinatura_id', assinaturaId)
    .order('vencimento', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** As receitas de clientes do período — alimenta os indicadores da visão geral. */
export async function receitasDeClientes({ de, ate } = {}) {
  const id = await nutriId();
  let q = sb
    .from('financeiro_lancamentos')
    .select('id, tipo, valor, valor_pago, status, vencimento, pago_em, competencia, paciente_id, assinatura_id')
    .eq('nutri_id', id)
    .eq('tipo', 'receita')
    .not('assinatura_id', 'is', null);
  if (de) q = q.gte('vencimento', de);
  if (ate) q = q.lte('vencimento', ate);
  const { data, error } = await q.order('vencimento', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Cria a cobrança de um período — um lançamento de receita PENDENTE.
 *
 * Não existe "criar cobrança" separado de "criar lançamento": é a mesma coisa.
 * O índice único (assinatura_id, vencimento) impede duas cobranças para o
 * mesmo período, então chamar isto duas vezes por engano falha no banco em vez
 * de dobrar o que o cliente deve.
 */
export async function criarCobranca({ assinatura, vencimento, valor, descricao, categoriaId = null }) {
  const id = await nutriId();
  const { data, error } = await sb
    .from('financeiro_lancamentos')
    .insert({
      nutri_id: id,
      tipo: 'receita',
      status: 'pendente',
      data: vencimento,
      vencimento,
      competencia: competenciaDaCobranca(vencimento),
      descricao: descricao || `${assinatura?.plano?.nome || 'Mensalidade'} — ${assinatura?.paciente?.nome || ''}`.trim(),
      valor,
      categoria_id: categoriaId,
      paciente_id: assinatura.paciente_id,
      assinatura_id: assinatura.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * O CORAÇÃO DO MÓDULO: registra o pagamento e renova o período.
 *
 * Um pagamento só, num lugar só. O lançamento vira `pago`, a assinatura anda
 * para o próximo período e a cobrança seguinte nasce pendente — tudo a partir
 * da mesma informação, sem ninguém digitar duas vezes.
 *
 * NÃO É TRANSAÇÃO. O PostgREST não expõe transação de várias tabelas pelo
 * cliente, então os três passos são sequenciais. A ordem é escolhida para que
 * uma falha no meio deixe o estado CONSERVADOR e não o contrário:
 *
 *   1º o pagamento     — se falhar aqui, nada mudou
 *   2º a renovação     — se falhar aqui, o dinheiro está registrado e o período
 *                        está velho: o cliente aparece como vencido, alguém vê
 *                        e corrige. O contrário (período renovado sem o
 *                        pagamento) esconderia um calote.
 *   3º a próxima cobrança — se falhar, é só uma cobrança a criar depois.
 *
 * Quando isto virar RPC no banco, os três viram um só. Está anotado.
 */
export async function registrarPagamento({ lancamentoId, assinatura, pagoEm, valorPago, formaPagamento, criarProxima = true }) {
  const id = await nutriId();

  const { data: pago, error: e1 } = await sb
    .from('financeiro_lancamentos')
    .update({
      status: 'pago',
      pago_em: pagoEm,
      valor_pago: valorPago ?? null,
      forma_pagamento: formaPagamento || null,
    })
    .eq('id', lancamentoId)
    .eq('nutri_id', id)
    .select()
    .single();
  if (e1) throw e1;

  const plano = assinatura?.plano || PLANO_PADRAO;
  const periodo = renovar({ fimVigente: assinatura.fim_periodo, dataPagamento: pagoEm, plano });
  if (!periodo) return { lancamento: pago, assinatura, proxima: null };

  const { data: renovada, error: e2 } = await sb
    .from('comercial_assinaturas')
    .update({ inicio_periodo: periodo.inicio_periodo, fim_periodo: periodo.fim_periodo, status: 'ativa' })
    .eq('id', assinatura.id)
    .eq('nutri_id', id)
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos(*)')
    .single();
  if (e2) throw e2;

  let proxima = null;
  if (criarProxima && renovada.renovacao_automatica) {
    try {
      proxima = await criarCobranca({
        assinatura: renovada,
        vencimento: renovada.fim_periodo,
        valor: renovada.valor_contratado,
        categoriaId: pago.categoria_id || null,
      });
    } catch (e) {
      // Cobrança repetida (o índice único) não é erro de verdade: significa
      // que ela já existia. Qualquer outra coisa sobe.
      if (!String(e.message || '').includes('uq_comercial_cobranca_periodo')) throw e;
    }
  }

  return { lancamento: pago, assinatura: renovada, proxima };
}

// ── CLIENTES SEM ASSINATURA ───────────────────────────────────

/** Pacientes que ainda não têm vínculo comercial — os candidatos a virar
 *  cliente. Sem isto, cadastrar uma assinatura exigiria decorar quem falta. */
export async function pacientesSemAssinatura() {
  const id = await nutriId();
  const [{ data: pacientes, error: e1 }, { data: assinaturas, error: e2 }] = await Promise.all([
    sb.from('pacientes').select('id, nome, telefone').eq('nutri_id', id).order('nome'),
    sb.from('comercial_assinaturas').select('paciente_id').eq('nutri_id', id)
      .in('status', ['ativa', 'aguardando_inicio', 'pausada']),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const comContrato = new Set((assinaturas || []).map(a => a.paciente_id));
  return (pacientes || []).filter(p => !comContrato.has(p.id));
}

/** Categorias de receita — o "Pacote" da planilha já virou categoria no
 *  import de vendas, então elas provavelmente já existem. */
export async function categoriasDeReceita() {
  const id = await nutriId();
  const { data, error } = await sb
    .from('financeiro_categorias')
    .select('id, nome, ativo')
    .eq('nutri_id', id)
    .eq('tipo', 'receita')
    .eq('ativo', true)
    .order('ordem').order('nome');
  if (error) throw error;
  return data || [];
}
