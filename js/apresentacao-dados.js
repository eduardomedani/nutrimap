// ═══════════════════════════════════════════════════════════
// MODO APRESENTAÇÃO — os dados do deck
// ═══════════════════════════════════════════════════════════
// Uma única leitura, feita ao iniciar o modo, e daí em diante só contas em
// memória. `carregarResumo` já é memoizado por paciente (paciente-resumo.js),
// então reabrir a apresentação na mesma consulta não volta ao banco.
//
// Nada aqui inventa dado. Todo indicador nasce de duas avaliações reais; onde
// falta medida, o valor é `null` e quem renderiza esconde o bloco.

import { carregarResumo } from './paciente-resumo.js';
import { listarMetas, situacaoDaMeta, estimativa, TIPOS_META } from './paciente-metas.js';
import {
  COMPARAR, num, interpretar, tomDaVariacao, diasEntre, dataDaAvaliacao,
} from './evolucao-core.js';

// Os números grandes do slide de resumo, na ordem em que se conta a história.
const DESTAQUES = [
  { campo: 'peso',        label: 'Peso',                unidade: 'kg', escala: 1,   icone: 'weight' },
  { campo: 'pct_gordura', label: 'Percentual de gordura', unidade: '%', escala: 100, icone: 'percent' },
  { campo: 'per_cintura', label: 'Circunferência abdominal', unidade: 'cm', escala: 1, icone: 'ruler' },
  { campo: 'peso_gordura', label: 'Peso de gordura',    unidade: 'kg', escala: 1,   icone: 'flame' },
];

// As barras do slide de composição corporal.
// `referencia` marca o que NÃO é resultado: o peso ideal é calculado a partir
// da massa magra, então ele cai quando o paciente perde músculo. Pintar isso
// de verde contaria uma história errada — ele entra como valor de contexto,
// sem cor e sem selo de variação.
const COMPOSICAO = [
  { campo: 'peso',         label: 'Peso',        unidade: 'kg' },
  { campo: 'peso_gordura', label: 'Peso de gordura', unidade: 'kg' },
  { campo: 'peso_magro',   label: 'Massa magra',  unidade: 'kg' },
  { campo: 'peso_ideal',   label: 'Peso ideal',   unidade: 'kg', referencia: true },
  { campo: 'peso_excesso', label: 'Peso em excesso', unidade: 'kg' },
];

/**
 * Carrega e monta tudo que os slides consomem.
 * @returns {Promise<object>} o "deck de dados"
 */
export async function carregarDados(paciente) {
  const resumo = await carregarResumo(paciente);
  const metas = await listarMetas(paciente.id).catch(() => []);
  return montarDados(paciente, resumo, metas);
}

/**
 * Parte pura — é isto que os testes exercitam.
 * `idAtual` permite trocar qual avaliação é a "atual" (slide da linha do tempo)
 * sem refazer nenhuma consulta.
 */
export function montarDados(paciente, resumo, metas = [], idAtual = null) {
  const avaliacoes = resumo?.avaliacoes || [];
  const primeira = avaliacoes[0] || null;
  const atual = (idAtual && avaliacoes.find(a => a.id === idAtual))
    || avaliacoes[avaliacoes.length - 1]
    || null;
  const objetivo = resumo?.metricas?.objetivo || null;

  // "126 dias juntos": da primeira avaliação até a que está sendo apresentada.
  const dias = (primeira && atual && primeira !== atual)
    ? diasEntre(primeira.data_avaliacao, atual.data_avaliacao)
    : null;

  const d = {
    paciente,
    resumo,
    metas: metas || [],
    avaliacoes,
    primeira,
    atual,
    objetivo,
    dias,
    idAtual: atual?.id || null,
    // Uma comparação só existe com duas avaliações distintas.
    temComparacao: !!(primeira && atual && primeira.id !== atual.id),
  };

  d.destaques   = calcularDestaques(d);
  d.composicao  = calcularComposicao(d);
  d.variacoes   = calcularVariacoes(d);
  d.conquistas  = calcularConquistas(d);
  d.metasVivas  = calcularMetas(d);
  d.metaMedia   = mediaDeProgresso(d.metasVivas);
  return d;
}

// ── Variação de um campo entre a primeira e a atual ─────────
function variacao(d, campo, escala = 1) {
  if (!d.temComparacao) return null;
  const a = num(d.primeira[campo]);
  const b = num(d.atual[campo]);
  if (a == null || b == null) return null;        // sem as duas pontas, não há variação
  const de = a * escala, para = b * escala;
  const dif = para - de;
  const pct = de ? (dif / de) * 100 : null;
  return {
    campo, de, para, dif, pct,
    tom: tomDaVariacao(campo, dif, d.objetivo),
    leitura: interpretar(campo, dif, d.objetivo).tom,
  };
}

function calcularDestaques(d) {
  return DESTAQUES
    .map(cfg => {
      const v = variacao(d, cfg.campo, cfg.escala);
      return v ? { ...cfg, ...v } : null;
    })
    .filter(Boolean);
}

function calcularComposicao(d) {
  if (!d.atual) return [];
  return COMPOSICAO
    .map(cfg => {
      const antes = d.temComparacao ? num(d.primeira[cfg.campo]) : null;
      const agora = num(d.atual[cfg.campo]);
      if (agora == null && antes == null) return null;
      const dif = (antes != null && agora != null) ? agora - antes : null;
      if (cfg.referencia) return { ...cfg, antes, agora, dif: null, tom: 'igual' };
      return {
        ...cfg, antes, agora, dif,
        tom: dif != null ? tomDaVariacao(cfg.campo, dif, d.objetivo) : 'igual',
      };
    })
    .filter(Boolean);
}

/** Todos os indicadores comparáveis que têm medida nas duas pontas. */
function calcularVariacoes(d) {
  if (!d.temComparacao) return [];
  return COMPARAR
    .map(c => {
      const v = variacao(d, c.campo, c.escala);
      return v ? { ...c, ...v } : null;
    })
    .filter(Boolean);
}

// ── Conquistas e pontos de atenção (por regra, nunca por IA) ──
// Frase fixa por campo. Sem objetivo declarado no plano, o texto descreve a
// direção em vez de julgá-la — "reduziu" no lugar de "melhorou".
const FRASE = {
  peso:                    { desce: 'Peso corporal reduziu',      sobe: 'Peso corporal aumentou' },
  imc:                     { desce: 'IMC reduziu',                sobe: 'IMC aumentou' },
  pct_gordura:             { desce: 'Percentual de gordura reduziu', sobe: 'Percentual de gordura aumentou' },
  peso_gordura:            { desce: 'Massa gorda reduziu',        sobe: 'Massa gorda aumentou' },
  peso_magro:              { desce: 'Massa magra reduziu',        sobe: 'Massa magra aumentou' },
  per_cintura:             { desce: 'Cintura diminuiu',           sobe: 'Cintura aumentou' },
  per_abdomen:             { desce: 'Abdômen diminuiu',           sobe: 'Abdômen aumentou' },
  per_quadril:             { desce: 'Quadril reduziu',            sobe: 'Quadril aumentou' },
  per_braco_direito:       { desce: 'Braço reduziu',              sobe: 'Braço aumentou' },
  per_coxa_direita:        { desce: 'Coxa reduziu',               sobe: 'Coxa aumentou' },
  per_panturrilha_direita: { desce: 'Panturrilha reduziu',        sobe: 'Panturrilha aumentou' },
};

// As 10 dobras cutâneas. Entram no resumo como UMA linha (a soma), não dez:
// "dobra tricipital −3 mm" não diz nada ao paciente; "as dobras reduziram" diz.
const DOBRAS = [
  'dc_peitoral', 'dc_axilar_media', 'dc_subescapular', 'dc_tricipital', 'dc_biciptal',
  'dc_crista_iliaca', 'dc_supra_iliaca', 'dc_abdominal', 'dc_coxa', 'dc_panturrilha',
];

function calcularConquistas(d) {
  const boas = [], atencao = [], neutras = [];
  for (const v of d.variacoes) {
    if (Math.abs(v.dif) < 0.05) continue;             // ruído de medida não vira frase
    const f = FRASE[v.campo];
    if (!f) continue;
    const texto = v.dif < 0 ? f.desce : f.sobe;
    const item = { campo: v.campo, texto, dif: v.dif, pct: v.pct, unidade: v.unidade, tom: v.tom };
    if (v.leitura === 'bom') boas.push(item);
    else if (v.leitura === 'atencao') atencao.push(item);
    else neutras.push(item);
  }

  const dobras = somaDasDobras(d);
  if (dobras) {
    (dobras.leitura === 'atencao' ? atencao : dobras.leitura === 'bom' ? boas : neutras).push(dobras);
  }

  // Ordena pela mudança RELATIVA: −8 cm de cintura conta mais que −1 cm de
  // braço, e é assim que a lista se conta em voz alta.
  const porRelevancia = (a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0);
  boas.sort(porRelevancia);
  atencao.sort(porRelevancia);
  neutras.sort(porRelevancia);

  return { boas, atencao, neutras, temObjetivo: !!d.objetivo };
}

/** Soma das dobras medidas nas DUAS avaliações. Menos de duas, não vale a frase. */
function somaDasDobras(d) {
  if (!d.temComparacao) return null;
  let de = 0, para = 0, n = 0;
  for (const campo of DOBRAS) {
    const a = num(d.primeira[campo]), b = num(d.atual[campo]);
    if (a == null || b == null) continue;
    de += a; para += b; n++;
  }
  if (n < 2) return null;
  const dif = para - de;
  if (Math.abs(dif) < 0.5) return null;               // meio milímetro é ruído de pinça
  return {
    campo: 'dobras', unidade: 'mm', dif, de, para, n,
    pct: de ? (dif / de) * 100 : null,
    texto: dif < 0 ? `Dobras cutâneas reduziram (${n} pontos)` : `Dobras cutâneas aumentaram (${n} pontos)`,
    tom: tomDaVariacao('dc_soma', dif, d.objetivo),
    leitura: interpretar('dc_soma', dif, d.objetivo).tom,
  };
}

// ── Metas ───────────────────────────────────────────────────
function calcularMetas(d) {
  const metricas = d.resumo?.metricas || {};
  return (d.metas || [])
    .filter(m => m.status !== 'cancelada')
    .map(m => ({
      meta: m,
      cfg: TIPOS_META[m.tipo] || {},
      situacao: situacaoDaMeta(m, metricas),
      previsao: estimativa(m, d.avaliacoes, metricas),
    }));
}

/** "Meta alcançada: 78%" — média do progresso das metas que dá para medir. */
function mediaDeProgresso(metasVivas) {
  const nums = (metasVivas || [])
    .map(x => x.situacao?.progresso)
    .filter(p => p != null);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// Reexportado para os slides não precisarem importar de dois lugares.
export { dataDaAvaliacao };
