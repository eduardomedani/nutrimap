// ═══════════════════════════════════════════════════════════
// PWA · DIETA — carregamento e formatação
// ═══════════════════════════════════════════════════════════
// UMA função de carregamento, um formato de saída. A tela não consulta tabela:
// ela recebe `{ plano, refeicoes }` pronto. Espalhar consultas pela interface
// faria cada estado de erro ter que ser tratado em oito lugares — e o oitavo é
// sempre o que fica sem tratamento.
//
// O QUE ESTA CAMADA NÃO FAZ: cálculo nutricional. As metas do plano vêm como
// estão gravadas; nada é recalculado aqui. A conta é do profissional, e uma
// segunda implementação dela no PWA divergiria da do painel no primeiro
// arredondamento.
//
// SEGURANÇA: o filtro por paciente é da RLS (db/dieta_paciente_leitura.sql), e
// esta camada AINDA filtra por plano explicitamente. Não é desconfiança da
// policy: é que policies são OR'd, e uma conta que seja nutri e paciente ao
// mesmo tempo lê pelos dois caminhos. Ver a memória conta-nutri-e-paciente.

import { sb } from './supabase.js';
// A CONTA NÃO É REFEITA AQUI. `refeicao_itens.quantidade` não é a porção: é um
// multiplicador de 100 g (BASE_G), e `medidaDoItem` é quem reconstrói
// {n, medida, gramas} a partir dele e das medidas caseiras do alimento.
// Reimplementar isso no PWA criaria uma segunda verdade que divergiria da do
// painel no primeiro arredondamento — e foi exatamente o que aconteceu na
// primeira versão desta tela, que imprimiu o multiplicador cru: "0,45" onde o
// paciente deveria ler "45 g".
import { medidaDoItem, fmtQtd, fmtG, MEDIDA_GRAMAS } from './dieta-calc.js';

// ───────────────────────────────────────────────────────────
// FORMATAÇÃO pt-BR
// ───────────────────────────────────────────────────────────

/** Plurais das medidas que a prescrição usa. Fora daqui a tela escreveria
 *  "2 Colher(es)", que é como um sistema avisa que não foi pensado. */
const PLURAIS = [
  [/^colher(es)? de sopa$/i,      'colher de sopa',      'colheres de sopa'],
  [/^colher(es)? de ch[áa]$/i,    'colher de chá',       'colheres de chá'],
  [/^colher(es)? de sobremesa$/i, 'colher de sobremesa', 'colheres de sobremesa'],
  [/^x[íi]cara(s)?$/i,            'xícara',              'xícaras'],
  [/^fatia(s)?$/i,                'fatia',               'fatias'],
  [/^unidade(s)?$/i,              'unidade',             'unidades'],
  [/^por[çc][ãa]o(\(?[õo]es\)?)?$/i, 'porção',           'porções'],
  [/^concha(s)?$/i,               'concha',              'conchas'],
  [/^copo(s)?$/i,                 'copo',                'copos'],
  [/^p[ãa]o(zinho)?(s)?$/i,       'pão',                 'pães'],
  [/^filé(s)?$/i,                 'filé',                'filés'],
  [/^dente(s)?$/i,                'dente',               'dentes'],
  [/^pacote(s)?$/i,               'pacote',              'pacotes'],
];

/** Unidades de medida real: não pluralizam nem ganham espaço extra. */
const UNIDADES = /^(g|kg|ml|l|mg|mcg|kcal)$/i;

/** 1 → "1", 1.5 → "1,5", 2.0 → "2". Sem casa decimal inútil: "2,0 fatias"
 *  faz o leitor procurar a precisão que não existe. */
export function numeroBR(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return (Math.round(v * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/**
 * "1 fatia", "2 colheres de sopa", "30 g", "200 ml".
 *
 * Pluraliza pela QUANTIDADE, não pelo texto gravado: o profissional escreve a
 * medida no singular ao montar o plano, e é a porção que decide.
 */
export function porcao(quantidade, medida) {
  const q = Number(quantidade);
  const m = String(medida || '').trim();
  const num = Number.isFinite(q) ? numeroBR(q) : '';

  if (!m) return num;
  if (UNIDADES.test(m)) return `${num} ${m.toLowerCase()}`;

  for (const [re, singular, plural] of PLURAIS) {
    if (re.test(m)) return `${num} ${Math.abs(q) === 1 ? singular : plural}`;
  }
  // Medida que não está no mapa vai como o profissional escreveu. Inventar um
  // plural com "s" no fim erraria em "pão", "colher de chá" e "pastel".
  return `${num} ${m}`;
}

/** '07:00:00' → '07:00'. Sem horário devolve ''. */
export function hora(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

/** '2026-08-27' → '27/08/2026', sem passar por Date (que muda o dia por fuso). */
export function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Peso da porção. Só aparece se ACRESCENTA algo: repetir "45 g" ao lado de
 *  "45 g" é ruído.
 *
 *  SEMPRE EM GRAMAS. `food_measures` guarda só `gramas` — não há coluna de
 *  unidade —, então escrever "200 ml" seria inventar uma informação que o dado
 *  não sustenta. Um número com a unidade errada é pior que um número a menos. */
export function pesoDaPorcao(item) {
  const g = Number(item?.gramas);
  if (!Number.isFinite(g) || g <= 0) return '';
  return `${fmtG(g)} g`;
}

/**
 * A porção como o paciente lê: "1 fatia", "2 colheres de sopa", "45 g".
 *
 * @param {object} item     a linha de refeicao_itens
 * @param {Array}  medidas  as food_measures daquele alimento
 * @returns {{porcao: string, peso: string, gramas: number, medidaConhecida: boolean}}
 */
export function formatarPorcaoPaciente(item, medidas = []) {
  const sel = medidaDoItem(medidas, item);
  const emGramas = sel.medida === MEDIDA_GRAMAS;

  return {
    // `null` quando não há medida caseira: a tela decide se omite a linha, em
    // vez de receber string vazia e ter que testar por conteúdo.
    medida: emGramas ? null : porcao(sel.n, sel.medida),
    peso: sel.gramas > 0 ? `${fmtG(sel.gramas)} g` : '',
    gramas: sel.gramas,
  };
}

/** Rótulo de PESO já pronto: "45g", "200 ml", "1,5kg". O gerador de dieta
 *  escreve as substituições assim (`medida: \`${g}g\``), sem espaço. */
const RE_PESO = /^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i;

/**
 * A porção de um SUBSTITUTO, que é gravado com outro contrato.
 *
 * `refeicao_itens.substituicoes` é jsonb livre no formato do gerador:
 * `{ nome, quantidade: g/100, medida: "45g" }`. Ou seja — `medida` NÃO é
 * medida caseira, é rótulo de peso; e `quantidade` é o mesmo multiplicador de
 * 100 g dos itens. Tratar o rótulo como medida caseira produzia exatamente
 * "0,45 45g" na tela do paciente.
 *
 * Quando o rótulo NÃO é peso (um profissional escreveu "2 colheres de sopa"),
 * ele vale como medida caseira e o peso sai do multiplicador. Não dá para
 * derivar a contagem nesse caso, então o rótulo vai como foi escrito.
 */
export function formatarSubstitutoPaciente(s) {
  const rotulo = String(s?.medida ?? '').trim();
  const qtd = Number(s?.quantidade);
  const pesoDoFator = Number.isFinite(qtd) && qtd > 0 ? `${fmtG(qtd * 100)} g` : '';

  const m = RE_PESO.exec(rotulo);
  if (m) {
    // "45g" → "45 g". Nunca acrescenta "g" a ml: a unidade vem do próprio
    // rótulo, e trocá-la seria mentir sobre o que medir.
    return { medida: null, peso: `${numeroBR(Number(m[1].replace(',', '.')))} ${m[2].toLowerCase()}` };
  }
  if (rotulo) return { medida: rotulo, peso: pesoDoFator };
  return { medida: null, peso: pesoDoFator };
}

/** "1 fatia • 45 g", ou só um dos dois. A medida caseira vem primeiro: é o que
 *  o paciente executa; o peso é conferência. */
export function textoDaPorcao({ medida, peso } = {}) {
  return [medida, peso].filter(Boolean).join(' • ');
}

// ───────────────────────────────────────────────────────────
// ORDENAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * Refeições por horário; sem horário vão para o fim, na ordem do profissional.
 *
 * Ordenar tudo por `ordem` deixaria uma refeição das 07:00 depois de uma das
 * 19:00 se o profissional as tivesse cadastrado nessa sequência — e o paciente
 * lê a lista de cima para baixo como se fosse o dia.
 */
export function ordenarRefeicoes(refeicoes) {
  return [...(refeicoes || [])].sort((a, b) => {
    const ha = hora(a.horario), hb = hora(b.horario);
    if (ha && hb && ha !== hb) return ha.localeCompare(hb);
    if (ha && !hb) return -1;
    if (!ha && hb) return 1;
    return (a.ordem ?? 0) - (b.ordem ?? 0);
  });
}

/** A refeição mais próxima do horário atual — a que a tela destaca. Devolve o
 *  id, ou null quando nenhuma tem horário. */
export function refeicaoAtual(refeicoes, agora) {
  const hhmm = hora(agora) || '';
  const comHora = (refeicoes || []).filter(r => hora(r.horario));
  if (!comHora.length || !hhmm) return null;

  // A "atual" é a última que já começou. Antes da primeira, destaca a primeira:
  // às 6h da manhã o que interessa é o café das 7h, não o jantar de ontem.
  let alvo = comHora[0];
  for (const r of comHora) if (hora(r.horario) <= hhmm) alvo = r;
  return alvo.id;
}

/** A primeira refeição que ainda não começou. É a que ganha o selo "próxima". */
export function proximaRefeicao(refeicoes, agora) {
  const hhmm = hora(agora) || '';
  if (!hhmm) return null;
  const futura = (refeicoes || [])
    .filter(r => hora(r.horario) && hora(r.horario) > hhmm)
    .sort((a, b) => hora(a.horario).localeCompare(hora(b.horario)))[0];
  return futura ? futura.id : null;
}

/**
 * 'atual' | 'proxima' | 'passada' | 'futura' | 'sem-horario'
 *
 * "Atual" e "próxima" são coisas diferentes e podem coexistir: às 13h o almoço
 * das 12:30 é o atual e o lanche das 16h é o próximo. Marcar só um dos dois
 * deixaria metade da informação de fora.
 */
export function estadoDaRefeicao(refeicao, idAtual, agora, idProxima = null) {
  if (!hora(refeicao?.horario)) return 'sem-horario';
  if (refeicao.id === idAtual) return 'atual';
  if (refeicao.id === idProxima) return 'proxima';
  return hora(refeicao.horario) < (hora(agora) || '') ? 'passada' : 'futura';
}

// ───────────────────────────────────────────────────────────
// NORMALIZAÇÃO
// ───────────────────────────────────────────────────────────

/** As substituições prescritas moram num jsonb `[{nome, quantidade, medida}]`.
 *  Vem de planilha e de tela: pode chegar null, objeto solto ou lista com
 *  buraco. Normalizar aqui evita que a tela trate isso em três lugares. */
export function normalizarSubstituicoes(bruto) {
  const lista = Array.isArray(bruto) ? bruto : (bruto ? [bruto] : []);
  return lista
    .filter(s => s && (s.nome || s.descricao))
    .map((s, i) => {
      const p = formatarSubstitutoPaciente(s);
      return {
        id: s.id || `sub-${i}`,
        nome: String(s.nome || s.descricao).trim(),
        medida: p.medida,
        peso: p.peso,
        observacao: s.observacao || s.obs || null,
      };
    });
}

/** Monta o formato que a tela consome. Puro: entram as linhas do banco, sai a
 *  árvore. É o que permite testar a ordenação e o agrupamento sem rede. */
export function montarPlano({ plano, refeicoes = [], itens = [], nomes = new Map(), medidas = new Map() }) {
  if (!plano) return null;

  // Alternativas são refeições que apontam para outra. Não entram na lista
  // principal — elas pertencem à refeição que substituem.
  const principais = ordenarRefeicoes(refeicoes.filter(r => !r.substitui_refeicao_id));
  const porPrincipal = new Map();
  for (const r of refeicoes.filter(r => r.substitui_refeicao_id)) {
    const lista = porPrincipal.get(r.substitui_refeicao_id) || [];
    lista.push(r);
    porPrincipal.set(r.substitui_refeicao_id, lista);
  }

  const itensDe = id => itens
    .filter(i => i.refeicao_id === id)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map(i => {
      const subs = normalizarSubstituicoes(i.substituicoes);
      const p = formatarPorcaoPaciente(i, medidas.get(i.food_id) || []);
      return {
        id: i.id,
        nome: nomes.get(i.food_id) || nomes.get(i.alimento_id) || i.nome || 'Alimento',
        medida: p.medida,
        peso: p.peso,
        gramas: p.gramas,
        observacao: i.observacao || null,
        substituicoes: subs,
        temSubstituicoes: subs.length > 0,
      };
    });

  const montada = r => ({
    id: r.id,
    nome: r.nome,
    horario: hora(r.horario),
    observacao: r.observacao || null,
    alimentos: itensDe(r.id),
    alternativas: (porPrincipal.get(r.id) || []).map(a => ({
      id: a.id,
      nome: a.nome,
      instrucao: a.instrucao || null,
      alimentos: itensDe(a.id),
    })),
  });

  return {
    plano: {
      id: plano.id,
      nome: plano.nome,
      objetivo: plano.objetivo || null,
      inicio: plano.data_inicio || null,
      fim: plano.data_fim || null,
      atualizadoEm: plano.criado_em || null,
      // `planos_alimentares.observacoes` NÃO vai para o paciente. O gerador de
      // dieta grava ali "Gerado automaticamente · Estrutura A — arroz e feijão"
      // (js/dieta.js:695): é nota interna do sistema, não orientação. Enquanto
      // o schema não separar as duas coisas, o PWA não mostra nenhuma — expor
      // texto interno é pior que não ter a seção.
    },
    // REFEIÇÃO VAZIA NÃO APARECE. Um plano publicado com "nenhum alimento
    // cadastrado" faz o paciente duvidar do plano inteiro. A exceção é a que
    // tem orientação: ali o profissional escreveu algo de propósito, e é isso
    // que ele quer que seja lido.
    refeicoes: principais
      .map(montada)
      .filter(r => r.alimentos.length > 0 || r.observacao || r.alternativas.length > 0),
  };
}

/** Números do dia para o resumo compacto. */
export function resumoDoDia(refeicoes) {
  const comHora = (refeicoes || []).filter(r => r.horario);
  return {
    refeicoes: (refeicoes || []).length,
    primeira: comHora.length ? comHora[0].horario : null,
    ultima: comHora.length ? comHora[comHora.length - 1].horario : null,
  };
}

// ───────────────────────────────────────────────────────────
// CARREGAMENTO
// ───────────────────────────────────────────────────────────

/**
 * O plano ativo do paciente logado, montado.
 *
 * Devolve `null` quando não há plano — que NÃO é erro: é o estado normal de
 * quem ainda não recebeu a dieta, e a tela mostra o vazio. Erro de verdade
 * sobe como exceção, para a tela poder oferecer "tentar novamente".
 *
 * `pacienteId` é opcional: quem já tem o id em mãos passa e evita uma consulta;
 * quem não tem deixa a função descobrir.
 */

/** O paciente ligado à conta logada. Filtra por `auth_user_id`, que é único —
 *  ao contrário do RLS, que numa conta nutri+paciente casa pelos dois lados. */
async function idDoPacienteLogado() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from('pacientes')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return data?.id || null;
}
export async function carregarDieta(pacienteId = null) {
  // O FILTRO POR PACIENTE É OBRIGATÓRIO, e não redundante com o RLS.
  //
  // As policies do projeto são OR'd: `planos_paciente_read` (o plano é meu) OU
  // `planos_owner` (sou o nutri dono). Numa conta que é as duas coisas — e a
  // do Eduardo é —, as duas valem, e esta consulta passava a devolver o plano
  // ativo mais recente de QUALQUER um dos 93 pacientes dele. Com `.limit(1)`,
  // o app do aluno abria a dieta de outra pessoa.
  //
  // O RLS é a segunda camada, nunca a primeira. Ver a memória
  // [[conta-nutri-e-paciente]] e o mesmo cuidado em `meusTreinos`.
  const meu = pacienteId || await idDoPacienteLogado();
  if (!meu) return null;

  const { data: planos, error: e1 } = await sb
    .from('planos_alimentares')
    .select('id, nome, objetivo, data_inicio, data_fim, observacoes, criado_em, ativo, paciente_id')
    .eq('paciente_id', meu)
    .eq('ativo', true)
    .order('criado_em', { ascending: false })
    .limit(1);
  if (e1) throw e1;

  const plano = planos?.[0];
  if (!plano) return null;

  const { data: refeicoes, error: e2 } = await sb
    .from('plano_refeicoes')
    .select('id, nome, horario, ordem, observacao, substitui_refeicao_id, instrucao, plano_id')
    .eq('plano_id', plano.id)
    .order('ordem', { ascending: true });
  if (e2) throw e2;

  const ids = (refeicoes || []).map(r => r.id);
  let itens = [];
  if (ids.length) {
    const { data, error: e3 } = await sb
      .from('refeicao_itens')
      .select('id, refeicao_id, food_id, alimento_id, quantidade, medida, ordem, observacao, substituicoes')
      .in('refeicao_id', ids)
      .order('ordem', { ascending: true });
    if (e3) throw e3;
    itens = data || [];
  }

  // As duas consultas de apoio vão JUNTAS, não uma por alimento: um plano de
  // 5 refeições com 7 itens são 35 alimentos, e 35 idas ao servidor num
  // celular em rede ruim é a diferença entre abrir e desistir.
  const [nomes, medidas] = await Promise.all([
    nomesDosAlimentos(itens),
    medidasDosAlimentos(itens),
  ]);
  return montarPlano({ plano, refeicoes: refeicoes || [], itens, nomes, medidas });
}

/** food_measures de todos os alimentos do plano, em uma consulta.
 *  Sem elas, `medidaDoItem` cai para gramas e a medida caseira some — que é
 *  justamente o que torna a porção executável para quem não tem balança. */
async function medidasDosAlimentos(itens) {
  const porFood = new Map();
  const ids = [...new Set(itens.map(i => i.food_id).filter(Boolean))];
  if (!ids.length) return porFood;

  const { data } = await sb
    .from('food_measures')
    .select('food_id, descricao, gramas, ordem')
    .in('food_id', ids)
    .order('ordem', { ascending: true });

  for (const m of data || []) {
    const lista = porFood.get(m.food_id) || [];
    lista.push(m);
    porFood.set(m.food_id, lista);
  }
  return porFood;
}

/**
 * Nome de cada alimento, de `foods` e da tabela legada `alimentos`.
 *
 * As duas convivem: db/foods_ligacao.sql repontou os itens para `food_id`, mas
 * itens antigos ainda só têm `alimento_id`. Ler as duas é o que faz o plano
 * antigo continuar legível — descartar a legada mostraria "Alimento" no lugar
 * do nome, sem nada indicando por quê.
 */
async function nomesDosAlimentos(itens) {
  const nomes = new Map();
  const foodIds = [...new Set(itens.map(i => i.food_id).filter(Boolean))];
  const alimIds = [...new Set(itens.map(i => i.alimento_id).filter(Boolean))];

  if (foodIds.length) {
    const { data } = await sb.from('foods').select('id, nome').in('id', foodIds);
    for (const f of data || []) nomes.set(f.id, f.nome);
  }
  if (alimIds.length) {
    const { data } = await sb.from('alimentos').select('id, nome').in('id', alimIds);
    for (const a of data || []) if (!nomes.has(a.id)) nomes.set(a.id, a.nome);
  }
  return nomes;
}
