// ═══════════════════════════════════════════════════════════
// AVALIAÇÕES FÍSICAS — CRUD + cálculos (8 protocolos de %G)
// ═══════════════════════════════════════════════════════════
// Constantes de Pollock 7D/3D: Jackson-Pollock clássico (ambos sexos).
// Densidade → %G via Siri. Faulkner retorna %G direto.

import { sb } from './supabase.js';
import { buscarRespostasModulo } from './respostas.js';

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const log10 = (x) => Math.log10(x);
const siri  = (D) => (4.95 / D) - 4.5;          // %G em fração (0–1)
const num   = (v) => (v === '' || v == null || isNaN(v)) ? 0 : Number(v);

/**
 * Lê sexo e data de nascimento da anamnese (módulo m1: q1_4, q1_5)
 * @returns {Promise<{sexo:'M'|'F'|null, idade:number|null}>}
 */
export async function dadosBasicosDaAnamnese(pacienteId) {
  const m1 = await buscarRespostasModulo(pacienteId, 'm1');
  if (!m1) return { sexo: null, idade: null };

  let sexo = null;
  if (m1.q1_5 === 'Masculino') sexo = 'M';
  else if (m1.q1_5 === 'Feminino') sexo = 'F';

  let idade = null;
  if (m1.q1_4) {
    const nasc = new Date(m1.q1_4);
    if (!isNaN(nasc)) {
      const hoje = new Date();
      idade = hoje.getFullYear() - nasc.getFullYear();
      const m = hoje.getMonth() - nasc.getMonth();
      if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    }
  }
  return { sexo, idade };
}

// ───────────────────────────────────────────────────────────
// PROTOCOLOS DE %G  → cada um retorna fração (0–1)
// `d` = objeto de dobras {peitoral, axilar_media, subescapular,
//        tricipital, biciptal, crista_iliaca, supra_iliaca,
//        abdominal, coxa, panturrilha}, valores em mm
// ───────────────────────────────────────────────────────────

// Pollock 7D — peitoral, axilar, subesc, tricip, supra, abdominal, coxa
function pollock7d(d, sexo, idade) {
  const s = num(d.peitoral) + num(d.axilar_media) + num(d.subescapular)
          + num(d.tricipital) + num(d.supra_iliaca) + num(d.abdominal) + num(d.coxa);
  let D;
  if (sexo === 'M')
    D = 1.112 - 0.00043499*s + 0.00000055*s*s - 0.00028826*idade;
  else
    D = 1.097 - 0.00046971*s + 0.00000056*s*s - 0.00012828*idade;
  return siri(D);
}

// Pollock 3D — Homem: peitoral+abdominal+coxa | Mulher: tricip+supra+coxa
function pollock3d(d, sexo, idade) {
  let s, D;
  if (sexo === 'M') {
    s = num(d.peitoral) + num(d.abdominal) + num(d.coxa);
    D = 1.10938 - 0.0008267*s + 0.0000016*s*s - 0.0002574*idade;
  } else {
    s = num(d.tricipital) + num(d.supra_iliaca) + num(d.coxa);
    D = 1.0994921 - 0.0009929*s + 0.0000023*s*s - 0.0001392*idade;
  }
  return siri(D);
}

// Guedes — Homem: tricip+supra+abdominal | Mulher: coxa+supra+subesc (log10)
function guedes(d, sexo) {
  let s, D;
  if (sexo === 'M') {
    s = num(d.tricipital) + num(d.supra_iliaca) + num(d.abdominal);
    D = 1.1714 - 0.0671*log10(s);
  } else {
    s = num(d.coxa) + num(d.supra_iliaca) + num(d.subescapular);
    D = 1.1665 - 0.0706*log10(s);
  }
  return siri(D);
}

// Petroski — Homem: subesc+tricip+biciptal+pantur | Mulher: axilar+supra+coxa+pantur (log10)
function petroski(d, sexo, idade) {
  let D;
  if (sexo === 'M') {
    const s = num(d.subescapular) + num(d.tricipital) + num(d.biciptal) + num(d.panturrilha);
    D = 1.10726863 - 0.00081201*s + 0.00000212*s*s - 0.00041761*idade;
  } else {
    const s = num(d.axilar_media) + num(d.supra_iliaca) + num(d.coxa) + num(d.panturrilha);
    D = 1.1954713 - 0.07513507*log10(s) - 0.00041072*idade;
  }
  return siri(D);
}

// Thorland 7D — 7 dobras sem peitoral nem biciptal
function thorland7d(d, sexo) {
  const s = num(d.axilar_media) + num(d.subescapular) + num(d.tricipital)
          + num(d.supra_iliaca) + num(d.abdominal) + num(d.coxa) + num(d.panturrilha);
  let D;
  if (sexo === 'M') D = 1.1091 - 0.00052*s + 0.00000032*s*s;
  else              D = 1.1046 - 0.00059*s + 0.0000006*s*s;
  return siri(D);
}

// Thorland 3D — Homem: tricip+subesc+axilar | Mulher: tricip+subesc+supra
function thorland3d(d, sexo) {
  let s, D;
  if (sexo === 'M') {
    s = num(d.tricipital) + num(d.subescapular) + num(d.axilar_media);
    D = 1.1136 - 0.00154*s + 0.00000516*s*s;
  } else {
    s = num(d.tricipital) + num(d.subescapular) + num(d.supra_iliaca);
    D = 1.0987 - 0.00122*s + 0.00000263*s*s;
  }
  return siri(D);
}

// Durnin & Womersley — tricip+biciptal+subesc+supra, por faixa etária (log10)
function durnin(d, sexo, idade) {
  const s = num(d.tricipital) + num(d.biciptal) + num(d.subescapular) + num(d.supra_iliaca);
  const L = log10(s);
  let a, b;
  if (sexo === 'M') {
    if      (idade <= 19) { a = 1.1620; b = 0.0630; }
    else if (idade <= 29) { a = 1.1631; b = 0.0632; }
    else if (idade <= 39) { a = 1.1422; b = 0.0544; }
    else if (idade <= 49) { a = 1.1620; b = 0.0700; }
    else                  { a = 1.1715; b = 0.0779; }
  } else {
    if      (idade <= 19) { a = 1.1549; b = 0.0678; }
    else if (idade <= 29) { a = 1.1599; b = 0.0717; }
    else if (idade <= 39) { a = 1.1423; b = 0.0632; }
    else if (idade <= 49) { a = 1.1333; b = 0.0612; }
    else                  { a = 1.1339; b = 0.0645; }
  }
  return siri(a - b*L);
}

// Faulkner (só Homem) — peitoral+axilar+abdominal+coxa → %G direto
function faulkner(d) {
  const s = num(d.peitoral) + num(d.axilar_media) + num(d.abdominal) + num(d.coxa);
  return (5.783 + 0.153*s) / 100;
}

// Mapa de protocolos
const PROTOCOLOS = {
  pollock_7d: { nome: 'Pollock 7 dobras', fn: pollock7d, idade: true,  sexos: ['M','F'] },
  pollock_3d: { nome: 'Pollock 3 dobras', fn: pollock3d, idade: true,  sexos: ['M','F'] },
  guedes:     { nome: 'Guedes',           fn: guedes,    idade: false, sexos: ['M','F'] },
  petroski:   { nome: 'Petroski',         fn: petroski,  idade: true,  sexos: ['M','F'] },
  thorland_7d:{ nome: 'Thorland 7 dobras',fn: thorland7d,idade: false, sexos: ['M','F'] },
  thorland_3d:{ nome: 'Thorland 3 dobras',fn: thorland3d,idade: false, sexos: ['M','F'] },
  durnin:     { nome: 'Durnin & Womersley',fn: durnin,   idade: true,  sexos: ['M','F'] },
  faulkner:   { nome: 'Faulkner',         fn: faulkner,  idade: false, sexos: ['M'] },
};

/**
 * Protocolos aplicáveis a um sexo (Faulkner só homem).
 * @returns {Array<{id, nome}>}
 */
export function gerarOpcoesProtocolo(sexo) {
  return Object.entries(PROTOCOLOS)
    .filter(([, p]) => p.sexos.includes(sexo))
    .map(([id, p]) => ({ id, nome: p.nome }));
}

/**
 * Calcula %G por um protocolo. Retorna fração (0–1).
 */
export function calcularPctGordura(protocolo, dobras, sexo, idade) {
  const p = PROTOCOLOS[protocolo];
  if (!p) throw new Error('Protocolo inválido: ' + protocolo);
  if (!p.sexos.includes(sexo)) throw new Error(`${p.nome} não se aplica ao sexo ${sexo}`);
  return p.fn(dobras, sexo, idade);
}

// ───────────────────────────────────────────────────────────
// COMPOSIÇÃO CORPORAL E ENERGIA
// ───────────────────────────────────────────────────────────
export function calcularIMC(peso, alturaM) {
  if (!alturaM) return 0;
  return peso / (alturaM * alturaM);
}

export function calcularPCCQ(cintura, quadril) {
  if (!quadril) return 0;
  return cintura / quadril;
}

// Mifflin-St Jeor — altura em cm
export function calcularTMB(peso, alturaCm, idade, sexo) {
  const base = 10*peso + 6.25*alturaCm - 5*idade;
  return sexo === 'M' ? base + 5 : base - 161;
}

export function calcularGET(tmb, fatorAtividade) {
  return tmb * fatorAtividade;
}

/**
 * Roda todos os cálculos de uma avaliação.
 * @param {object} av - { peso, altura(m), idade, sexo, protocolo,
 *                         pct_gordura_ideal, fator_atividade,
 *                         dobras:{...}, per_cintura, per_quadril }
 * @returns {object} resultados prontos pra gravar no cache
 */
export function calcularResultados(av) {
  const pesoKg   = num(av.peso);
  const alturaM  = num(av.altura);
  const alturaCm = alturaM * 100;
  const idade    = num(av.idade);
  const sexo     = av.sexo;
  const pgIdeal  = num(av.pct_gordura_ideal) || 0.12;

  const pctG = av.protocolo
    ? calcularPctGordura(av.protocolo, av.dobras || {}, sexo, idade)
    : 0;

  const pesoGordura = pctG * pesoKg;
  const pesoMagro   = pesoKg - pesoGordura;
  const pesoIdeal   = pesoMagro / (1 - pgIdeal);
  const pesoExcesso = pesoKg - pesoIdeal;

  const tmb = calcularTMB(pesoKg, alturaCm, idade, sexo);
  const get = calcularGET(tmb, num(av.fator_atividade) || 1.2);

  const r = (n, c=2) => Number(n.toFixed(c));
  return {
    imc:          r(calcularIMC(pesoKg, alturaM)),
    pct_gordura:  r(pctG, 4),
    peso_gordura: r(pesoGordura),
    peso_magro:   r(pesoMagro),
    peso_ideal:   r(pesoIdeal),
    peso_excesso: r(pesoExcesso),
    pccq:         r(calcularPCCQ(num(av.per_cintura), num(av.per_quadril)), 4),
    tmb:          r(tmb, 1),
    get_kcal:     r(get, 1),
  };
}

// ───────────────────────────────────────────────────────────
// CRUD SUPABASE
// ───────────────────────────────────────────────────────────

/** Próximo número de avaliação (AV 1, AV 2...) para o paciente. */
export async function proximoNumero(pacienteId) {
  const { data, error } = await sb
    .from('avaliacoes')
    .select('numero')
    .eq('paciente_id', pacienteId)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data.numero + 1 : 1;
}

/** Lista avaliações de um paciente (mais recente primeiro). */
export async function listarAvaliacoes(pacienteId) {
  const { data, error } = await sb
    .from('avaliacoes')
    .select('*')
    .eq('paciente_id', pacienteId)
    .order('numero', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function buscarAvaliacao(id) {
  const { data, error } = await sb
    .from('avaliacoes').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/**
 * Cria avaliação. Recebe o registro "cru" (campos da tabela) +
 * grava o cache de resultados calculados automaticamente.
 */
export async function criarAvaliacao(nutriId, pacienteId, registro) {
  const numero = registro.numero || await proximoNumero(pacienteId);
  const resultados = calcularResultados({
    ...registro,
    dobras: extrairDobras(registro),
  });
  const { data, error } = await sb
    .from('avaliacoes')
    .insert({ ...registro, ...resultados, nutri_id: nutriId, paciente_id: pacienteId, numero })
    .select().single();
  if (error) throw error;
  return data;
}

export async function atualizarAvaliacao(id, registro) {
  const resultados = calcularResultados({
    ...registro,
    dobras: extrairDobras(registro),
  });
  const { data, error } = await sb
    .from('avaliacoes')
    .update({ ...registro, ...resultados })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function excluirAvaliacao(id) {
  const { error } = await sb.from('avaliacoes').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/** Converte campos dc_* do registro plano em objeto {peitoral, ...}. */
export function extrairDobras(registro) {
  return {
    peitoral:      registro.dc_peitoral,
    axilar_media:  registro.dc_axilar_media,
    subescapular:  registro.dc_subescapular,
    tricipital:    registro.dc_tricipital,
    biciptal:      registro.dc_biciptal,
    crista_iliaca: registro.dc_crista_iliaca,
    supra_iliaca:  registro.dc_supra_iliaca,
    abdominal:     registro.dc_abdominal,
    coxa:          registro.dc_coxa,
    panturrilha:   registro.dc_panturrilha,
  };
}
