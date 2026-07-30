// ═══════════════════════════════════════════════════════════
// DIETA — Planejamento alimentar: biblioteca de alimentos, planos, refeições e itens
// ═══════════════════════════════════════════════════════════
// Single-tenant por nutri. O RLS filtra por nutri_id automaticamente; os inserts
// gravam nutri_id explicitamente (mesmo padrão de treinos/avaliacoes).
//   · planos_alimentares com paciente_id NULL      = MODELO (biblioteca reutilizável)
//   · planos_alimentares com paciente_id preenchido = PLANO de um aluno
//
// Tabelas: alimentos, planos_alimentares, plano_refeicoes, refeicao_itens.
// Espelha js/treinos.js.

import { sb } from './supabase.js';
import { GRUPOS } from './dieta-grupos.js';
import { gerarPlano } from './dieta-gerar.js';

/**
 * DELETE que falha alto quando nao apaga nada.
 *
 * Um delete barrado pelo RLS NAO devolve erro no PostgREST: ele afeta 0 linhas
 * e responde sucesso. Sem checar o retorno, a UI recarrega, o registro continua
 * na tela e parece que "o botao nao funciona" — sem nenhuma mensagem.
 * `.select()` faz o delete devolver as linhas removidas, entao da pra saber.
 */
async function excluirPorId(tabela, id, oQue) {
  const { data, error } = await sb.from(tabela).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || !data.length) {
    throw new Error(
      `Nada foi excluído (${oQue}). O registro já não existe ou o banco negou a permissão (RLS).`,
    );
  }
  return true;
}

// ───────────────────────────────────────────────────────────
// BIBLIOTECA DE ALIMENTOS  (alimentos)
// ───────────────────────────────────────────────────────────

/**
 * Lista alimentos do nutri (alfabético), com busca e paginação no banco.
 *   { termo, limite, offset }
 *     · termo  — busca por nome OU grupo (ilike, case-insensitive)
 *     · limite — quantos trazer (default 40)
 *     · offset — a partir de qual registro (paginação "carregar mais")
 */
export async function listarAlimentos({ termo = '', limite = 40, offset = 0 } = {}) {
  let q = sb
    .from('alimentos')
    .select('*')
    .order('nome', { ascending: true });

  const t = String(termo || '').trim();
  if (t) {
    const alvo = t.replace(/[,()*.]/g, ' ').trim();
    const like = `%${alvo}%`;
    q = q.or(`nome.ilike.${like},grupo.ilike.${like}`);
  }

  q = q.range(offset, offset + limite - 1);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ───────────────────────────────────────────────────────────
// CATALOGO PROFISSIONAL DE ALIMENTOS (foods) — busca e leitura
// ───────────────────────────────────────────────────────────

/**
 * Busca no catalogo `foods` (global + proprios) via RPC foods_buscar:
 * ignora acento/maiuscula, cobre nome, sinonimos, marca e codigo de barras.
 */
export async function buscarFoods(termo, limite = 20) {
  const t = String(termo || '').trim();
  if (!t) return [];
  const { data, error } = await sb.rpc('foods_buscar', { p_termo: t, p_limit: limite });
  if (error) throw error;
  return data || [];
}

/** Um alimento do catalogo por id. */
export async function buscarFood(id) {
  const { data, error } = await sb.from('foods').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * Lista os alimentos PROPRIOS do nutri (foods com nutri_id preenchido).
 * O RLS ja limita a global+proprio; filtrar nutri_id nao-nulo deixa so os proprios.
 */
export async function listarFoodsProprios({ termo = '', limite = 40, offset = 0 } = {}) {
  let q = sb.from('foods').select('*').not('nutri_id', 'is', null).order('nome', { ascending: true });
  const t = String(termo || '').trim();
  if (t) {
    const alvo = t.replace(/[,()*.]/g, ' ').trim();
    q = q.ilike('nome', `%${alvo}%`);
  }
  q = q.range(offset, offset + limite - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Cria alimento PROPRIO (foods). Recebe os campos ja no formato de foods. */
export async function criarFood(nutriId, dados) {
  const { data, error } = await sb
    .from('foods')
    .insert({ ...dados, nutri_id: nutriId, fonte_dados: 'Proprio' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarFood(id, dados) {
  const { data, error } = await sb
    .from('foods').update(dados).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function excluirFood(id) {
  return excluirPorId('foods', id, 'o alimento');
}

/**
 * Lista o catalogo INTEIRO (global + proprios) em ordem alfabetica, paginado.
 * Usado quando nao ha termo de busca — com termo, use buscarFoods (RPC), que
 * ordena por relevancia e cobre sinonimos/marca/codigo de barras.
 */
export async function listarFoodsCatalogo({ limite = 40, offset = 0 } = {}) {
  const { data, error } = await sb
    .from('foods').select('*')
    .order('nome', { ascending: true })
    .range(offset, offset + limite - 1);
  if (error) throw error;
  return data || [];
}

// ───────────────────────────────────────────────────────────
// MEDIDAS CASEIRAS  (food_measures)
// ───────────────────────────────────────────────────────────
// Valem para qualquer alimento do catalogo, inclusive os globais (TACO): a
// medida pertence ao NUTRI (nutri_id), o alimento continua compartilhado.
// Assim cada nutri define a sua "1 concha de feijao" sem afetar os outros.
// O RLS ja limita a global + proprio.

/** Medidas de um alimento, na ordem definida pelo nutri. */
export async function listarMedidas(foodId) {
  const { data, error } = await sb
    .from('food_measures').select('*')
    .eq('food_id', foodId)
    .order('ordem', { ascending: true })
    .order('descricao', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Medidas de VARIOS alimentos de uma vez -> { food_id: [medidas] }.
 * Uma query so: o editor precisa das medidas de todos os itens do plano ao
 * abrir, e uma requisicao por item deixaria a tela lenta.
 */
export async function listarMedidasDeVarios(foodIds) {
  const ids = [...new Set((foodIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await sb
    .from('food_measures').select('*')
    .in('food_id', ids)
    .order('ordem', { ascending: true });
  if (error) throw error;
  const mapa = {};
  for (const m of (data || [])) (mapa[m.food_id] ||= []).push(m);
  return mapa;
}

/** Cria medida. `ordem` default = ultima da lista (o chamador calcula). */
export async function criarMedida(nutriId, foodId, { descricao, gramas, ordem = 0 }) {
  const { data, error } = await sb
    .from('food_measures')
    .insert({ nutri_id: nutriId, food_id: foodId, descricao, gramas, ordem })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarMedida(id, dados) {
  const { data, error } = await sb
    .from('food_measures').update(dados).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function excluirMedida(id) {
  return excluirPorId('food_measures', id, 'a medida');
}

// ───────────────────────────────────────────────────────────
// FAVORITOS  (favorite_foods)  e  ULTIMOS UTILIZADOS  (recent_foods)
// ───────────────────────────────────────────────────────────
// Ambos sao por nutri e valem para qualquer alimento (global ou proprio).
// O RLS ja limita ao dono; os inserts gravam nutri_id explicitamente.

/** Alimentos favoritados, em ordem alfabetica. */
export async function listarFavoritos(limite = 50) {
  const { data, error } = await sb
    .from('favorite_foods')
    .select('food_id, foods(*)')
    .limit(limite);
  if (error) throw error;
  return (data || [])
    .map(r => r.foods)
    .filter(Boolean)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/** So os ids — barato, para marcar a estrela na lista sem puxar tudo de novo. */
export async function listarIdsFavoritos() {
  const { data, error } = await sb.from('favorite_foods').select('food_id');
  if (error) throw error;
  return new Set((data || []).map(r => r.food_id));
}

export async function favoritar(nutriId, foodId) {
  const { error } = await sb
    .from('favorite_foods')
    .upsert({ nutri_id: nutriId, food_id: foodId }, { onConflict: 'nutri_id,food_id' });
  if (error) throw error;
  return true;
}

export async function desfavoritar(nutriId, foodId) {
  const { error } = await sb
    .from('favorite_foods').delete().eq('nutri_id', nutriId).eq('food_id', foodId);
  if (error) throw error;
  return true;
}

/**
 * Alimentos que o nutri MAIS prescreveu, do mais usado para o menos.
 *
 * A contagem e derivada de refeicao_itens (o RLS ja limita aos itens do dono),
 * nao de um contador guardado: numero materializado envelhece quando um item e
 * apagado, e este nao tem como divergir do que esta prescrito. `amostra` limita
 * o payload — o ranking olha os itens mais recentes, que e o que interessa.
 */
export async function listarMaisUsados(limite = 25, amostra = 2000) {
  const { data, error } = await sb
    .from('refeicao_itens')
    .select('food_id')
    .not('food_id', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(amostra);
  if (error) throw error;

  const conta = new Map();
  for (const r of data || []) conta.set(r.food_id, (conta.get(r.food_id) || 0) + 1);
  const topo = [...conta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([id]) => id);
  if (!topo.length) return [];

  const { data: foods, error: erroFoods } = await sb.from('foods').select('*').in('id', topo);
  if (erroFoods) throw erroFoods;
  const porId = new Map((foods || []).map(f => [f.id, f]));
  return topo.map(id => porId.get(id)).filter(Boolean);   // preserva a ordem do ranking
}

/** Ultimos alimentos usados, do mais recente para o mais antigo. */
export async function listarRecentes(limite = 12) {
  const { data, error } = await sb
    .from('recent_foods')
    .select('food_id, last_used_at, foods(*)')
    .order('last_used_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data || []).map(r => r.foods).filter(Boolean);
}

/**
 * Marca um alimento como usado agora (upsert: um registro por nutri+alimento).
 * Chamado ao adicionar item num plano. Best-effort: nao deve derrubar o fluxo
 * principal se falhar — quem chama trata o erro silenciosamente.
 */
export async function registrarUso(nutriId, foodId, quantidade = null) {
  const { error } = await sb.from('recent_foods').upsert(
    {
      nutri_id: nutriId,
      food_id: foodId,
      last_used_at: new Date().toISOString(),
      quantity: quantidade,
    },
    { onConflict: 'nutri_id,food_id' },
  );
  if (error) throw error;
  return true;
}

/** Match exato (case-insensitive) por nome — usado ao adicionar item ao plano. */
export async function buscarAlimentoPorNome(nome) {
  const n = String(nome || '').trim();
  if (!n) return null;
  const { data, error } = await sb
    .from('alimentos')
    .select('*')
    .ilike('nome', n)
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function buscarAlimento(id) {
  const { data, error } = await sb
    .from('alimentos').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Cria alimento. Recebe { nome, grupo, medida_padrao, kcal, proteina, carboidrato, gordura, observacoes }. */
export async function criarAlimento(nutriId, dados) {
  const { data, error } = await sb
    .from('alimentos')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarAlimento(id, dados) {
  const { data, error } = await sb
    .from('alimentos')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Exclui alimento. Falha se estiver em uso (FK restrict em refeicao_itens). */
export async function excluirAlimento(id) {
  return excluirPorId('alimentos', id, 'o alimento');
}

// ───────────────────────────────────────────────────────────
// PLANOS  (planos_alimentares) — modelos e planos de aluno
// ───────────────────────────────────────────────────────────

/** Lista MODELOS da biblioteca (paciente_id null), mais recentes primeiro. */
export async function listarModelosDieta() {
  const { data, error } = await sb
    .from('planos_alimentares')
    .select('*')
    .is('paciente_id', null)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Lista planos de um paciente, mais recentes primeiro. */
export async function listarPlanosDoPaciente(pacienteId) {
  const { data, error } = await sb
    .from('planos_alimentares')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function buscarPlano(id) {
  const { data, error } = await sb
    .from('planos_alimentares').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * Cria plano. Recebe { nome, objetivo, kcal_meta, prot_meta, carb_meta,
 * gord_meta, data_inicio, data_fim, ativo, observacoes, paciente_id }.
 * paciente_id ausente/null => MODELO; preenchido => plano do aluno.
 */
export async function criarPlano(nutriId, dados) {
  const { data, error } = await sb
    .from('planos_alimentares')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;

  // Modelo da biblioteca não é acompanhamento de paciente: sem evento.
  // Prescrever um modelo passa por aqui, então a prescrição também é coberta.
  if (data.paciente_id) {
    const { registrarEvento } = await import('./timeline.js');
    await registrarEvento({
      pacienteId: data.paciente_id,
      tipo: 'MEAL_PLAN_CREATED',
      descricao: `Plano "${data.nome || 'sem nome'}" criado${data.kcal_meta ? ` com meta de ${Math.round(data.kcal_meta)} kcal` : ''}.`,
      entidadeTipo: 'plano',
      entidadeId: data.id,
      metadata: { plan_name: data.nome, target_calories: data.kcal_meta, objetivo: data.objetivo },
      chaveDedup: `MEAL_PLAN_CREATED:${data.id}`,
    });
  }
  return data;
}

export async function atualizarPlano(id, dados) {
  const { data, error } = await sb
    .from('planos_alimentares')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

/** Exclui plano. Cascade remove refeições e itens. */
export async function excluirPlano(id) {
  return excluirPorId('planos_alimentares', id, 'o plano');
}

// ───────────────────────────────────────────────────────────
// REFEIÇÕES  (plano_refeicoes) e ITENS  (refeicao_itens)
// ───────────────────────────────────────────────────────────

/**
 * Lista as refeições de um plano (ordenadas), já com os itens e os dados do
 * alimento (nome/grupo/macros) embutidos. Os itens vêm por ordem.
 */
export async function listarRefeicoesDoPlano(planoId) {
  const { data, error } = await sb
    .from('plano_refeicoes')
    // `id` do food é necessário para medidas caseiras e substituições;
    // `fibra` entra no resumo nutricional.
    .select('*, itens:refeicao_itens(*, food:foods(id, nome, marca, subcategoria, fonte_dados, calorias, proteina, carboidrato, gordura, fibra))')
    .eq('plano_id', planoId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  const refeicoes = data || [];
  // Ordena os itens de cada refeição por ordem (o nested select não garante ordem).
  for (const r of refeicoes) {
    (r.itens || []).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  }
  return refeicoes;
}

export async function criarRefeicao(nutriId, dados) {
  const { data, error } = await sb
    .from('plano_refeicoes')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarRefeicao(id, dados) {
  const { data, error } = await sb
    .from('plano_refeicoes')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirRefeicao(id) {
  return excluirPorId('plano_refeicoes', id, 'a refeição');
}

/**
 * Duplica uma refeição com todos os seus itens, dentro do mesmo plano.
 *
 * Composto das funções que já existem — nada novo no banco. NÃO é atômico: se
 * falhar no meio, a refeição nova fica com menos itens. Por isso, ao dar erro,
 * a refeição criada é removida para não deixar um duplicado pela metade.
 */
export async function duplicarRefeicao(
  nutriId, refeicao, { nome, horario, ordem, substitui_refeicao_id, instrucao } = {},
) {
  const nova = await criarRefeicao(nutriId, {
    plano_id: refeicao.plano_id,
    nome: nome ?? `${refeicao.nome} (cópia)`,
    horario: horario !== undefined ? horario : (refeicao.horario || null),
    ordem: ordem ?? ((Number(refeicao.ordem) || 0) + 1),
    observacao: refeicao.observacao || null,
    // Herda o vinculo da origem quando nao for informado: duplicar uma
    // alternativa produz outra alternativa da MESMA principal; duplicar uma
    // principal produz outra principal.
    substitui_refeicao_id: substitui_refeicao_id !== undefined
      ? substitui_refeicao_id
      : (refeicao.substitui_refeicao_id || null),
    instrucao: instrucao !== undefined ? instrucao : (refeicao.instrucao || null),
  });

  try {
    const itens = [...(refeicao.itens || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    for (const [i, it] of itens.entries()) {
      await adicionarItem(nutriId, {
        refeicao_id: nova.id,
        food_id: it.food_id,
        alimento_id: it.alimento_id ?? null,   // itens antigos ainda usam alimento_id
        quantidade: it.quantidade,
        medida: it.medida,
        observacao: it.observacao,
        substituicoes: it.substituicoes,
        ordem: i,
      });
    }
  } catch (e) {
    // Melhor não deixar meia refeição do que fingir que deu certo.
    try { await excluirRefeicao(nova.id); } catch (_) { /* já era */ }
    throw e;
  }
  return nova;
}

/** Duplica um item dentro da mesma refeição, logo depois do original. */
export async function duplicarItem(nutriId, item) {
  return adicionarItem(nutriId, {
    refeicao_id: item.refeicao_id,
    food_id: item.food_id,
    alimento_id: item.alimento_id ?? null,
    quantidade: item.quantidade,
    medida: item.medida,
    observacao: item.observacao,
    substituicoes: item.substituicoes,
    ordem: (Number(item.ordem) || 0) + 1,
  });
}

/** Reordena refeições/itens em lote: [{id, ordem}, ...]. */
export async function reordenarRefeicoes(pares) {
  for (const { id, ordem } of pares) await atualizarRefeicao(id, { ordem });
  return true;
}

export async function reordenarItens(pares) {
  for (const { id, ordem } of pares) await atualizarItem(id, { ordem });
  return true;
}

export async function adicionarItem(nutriId, dados) {
  const { data, error } = await sb
    .from('refeicao_itens')
    .insert({ ...dados, nutri_id: nutriId })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarItem(id, dados) {
  const { data, error } = await sb
    .from('refeicao_itens')
    .update(dados)
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirItem(id) {
  return excluirPorId('refeicao_itens', id, 'o item');
}

// ───────────────────────────────────────────────────────────
// CÓPIAS  (modelo → paciente  e  paciente → biblioteca)
// ───────────────────────────────────────────────────────────

/**
 * Copia um plano (origem) para um novo plano, incluindo refeições e itens.
 * destino.paciente_id define se o novo é modelo (null) ou plano de aluno.
 * NÃO copia adesão do aluno (histórico próprio dele). Retorna o plano criado.
 */
async function copiarPlano(origemId, destino = {}) {
  const origem    = await buscarPlano(origemId);
  const refeicoes = await listarRefeicoesDoPlano(origemId);

  const novo = await criarPlano(origem.nutri_id, {
    nome:        destino.nome ?? origem.nome,
    objetivo:    origem.objetivo,
    kcal_meta:   origem.kcal_meta,
    prot_meta:   origem.prot_meta,
    carb_meta:   origem.carb_meta,
    gord_meta:   origem.gord_meta,
    data_inicio: destino.data_inicio ?? null,
    data_fim:    destino.data_fim ?? null,
    ativo:       destino.ativo ?? true,
    observacoes: origem.observacoes,
    paciente_id: destino.paciente_id ?? null,
  });

  for (const r of refeicoes) {
    const novaRef = await criarRefeicao(origem.nutri_id, {
      plano_id:   novo.id,
      nome:       r.nome,
      horario:    r.horario,
      ordem:      r.ordem,
      observacao: r.observacao,
    });
    const itens = (r.itens || []).map((it) => ({
      nutri_id:      origem.nutri_id,
      refeicao_id:   novaRef.id,
      food_id:       it.food_id,
      quantidade:    it.quantidade,
      medida:        it.medida,
      ordem:         it.ordem,
      substituicoes: it.substituicoes,
      observacao:    it.observacao,
    }));
    if (itens.length) {
      const { error } = await sb.from('refeicao_itens').insert(itens);
      if (error) throw error;
    }
  }
  return novo;
}

/** Instancia um MODELO como plano de um aluno (copia refeições + itens). */
export async function prescreverModeloParaPaciente(modeloId, pacienteId, extras = {}) {
  return copiarPlano(modeloId, {
    paciente_id: pacienteId,
    data_inicio: extras.data_inicio ?? null,
    data_fim:    extras.data_fim ?? null,
    ativo:       extras.ativo ?? true,
  });
}

/** Sobe um plano de aluno para a BIBLIOTECA como modelo reutilizável. */
export async function salvarComoModelo(planoId, extras = {}) {
  return copiarPlano(planoId, { paciente_id: null, nome: extras.nome });
}

// ───────────────────────────────────────────────────────────
// GERAÇÃO AUTOMÁTICA  (motor em dieta-gerar.js)
// ───────────────────────────────────────────────────────────

/**
 * Catálogo no formato que o gerador espera: mapa nome -> macros por 100 g.
 * Busca só os alimentos citados nos grupos (1 consulta), não o catálogo todo.
 * Prefere o alimento próprio quando existe um global de mesmo nome.
 */
export async function catalogoParaGerador() {
  const nomes = [...new Set(Object.values(GRUPOS).flatMap(g => g.alimentos))];
  const { data, error } = await sb
    .from('foods')
    .select('id, nome, calorias, proteina, carboidrato, gordura, fibra, nutri_id')
    .in('nome', nomes);
  if (error) throw error;

  const cat = {};
  for (const f of data || []) {
    // próprio (nutri_id preenchido) ganha do global de mesmo nome
    if (!cat[f.nome] || (f.nutri_id && !cat[f.nome].nutri_id)) cat[f.nome] = f;
  }
  return cat;
}

/**
 * Quais alimentos dos grupos ainda NÃO estão no catálogo do nutri.
 * Serve para avisar antes de gerar, em vez de entregar um plano com buracos.
 */
export function faltandoNoCatalogo(catalogo) {
  const nomes = [...new Set(Object.values(GRUPOS).flatMap(g => g.alimentos))];
  return nomes.filter(n => !catalogo[n]);
}

/**
 * Gera e GRAVA um plano alimentar completo.
 *
 * @param {string} nutriId
 * @param {object} p  { pacienteId, metas: {kcal,prot,carb,gord}, nome,
 *                      templateId, excluir, preferir, data_inicio, data_fim }
 * @returns {object} { plano, resultado } — resultado traz macros/desvio/avisos
 */
export async function gerarPlanoParaPaciente(nutriId, p = {}) {
  const catalogo = await catalogoParaGerador();
  const resultado = gerarPlano(p.metas, catalogo, {
    templateId: p.templateId,
    excluir:    p.excluir,
    preferir:   p.preferir,
  });

  const plano = await criarPlano(nutriId, {
    nome:        p.nome || 'Plano gerado',
    objetivo:    p.objetivo ?? null,
    kcal_meta:   p.metas.kcal,
    prot_meta:   p.metas.prot,
    carb_meta:   p.metas.carb,
    gord_meta:   p.metas.gord,
    data_inicio: p.data_inicio ?? null,
    data_fim:    p.data_fim ?? null,
    ativo:       true,
    paciente_id: p.pacienteId ?? null,
    observacoes: `Gerado automaticamente · ${resultado.template.nome}`,
  });

  for (const r of resultado.refeicoes) {
    const ref = await criarRefeicao(nutriId, {
      plano_id: plano.id, nome: r.nome, horario: r.horario, ordem: r.ordem,
    });
    const itens = r.itens.map(it => ({
      nutri_id:      nutriId,
      refeicao_id:   ref.id,
      food_id:       it.food_id,
      quantidade:    it.quantidade,
      medida:        it.medida,
      ordem:         it.ordem,
      substituicoes: it.substituicoes?.length ? it.substituicoes : null,
    }));
    if (itens.length) {
      const { error } = await sb.from('refeicao_itens').insert(itens);
      if (error) throw error;
    }
  }
  return { plano, resultado };
}
