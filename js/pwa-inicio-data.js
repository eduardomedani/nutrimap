// ═══════════════════════════════════════════════════════════
// PWA · INÍCIO — as contas da tela
// ═══════════════════════════════════════════════════════════
// Só funções puras: recebem dado, devolvem dado. Nada de rede, nada de DOM —
// é o que deixa a tela testável sem navegador e sem Supabase.
//
// O QUE NÃO MORA AQUI, e por quê: água, check-in, peso e aderência à dieta não
// existem no banco (nenhuma tabela, em nenhum schema). Um painel que mostra
// "Água: 0 de 2,5 L" fixo, ou uma aderência calculada por chute, ensina o
// paciente a não confiar no número — e um número em que ele não confia é pior
// do que a ausência dele. Quando essas tabelas existirem, as contas entram
// aqui, do lado das outras.

import { hora, ordenarRefeicoes } from './pwa-dieta-data.js';

const DIA_MS = 86400000;

/** YYYY-MM-DD no fuso LOCAL. `toISOString()` não serve: ele converte para UTC
 *  e, a leste de Greenwich, a meia-noite local vira o dia anterior. */
function iso10(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function comoData(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/** A segunda-feira da semana de `iso`. A semana do paciente começa na segunda
 *  porque é assim que ele conta ("treinei 3 vezes essa semana"), não no
 *  domingo do `getDay()`. */
export function inicioDaSemana(iso) {
  const d = comoData(iso);
  if (!d) return null;
  const dow = (d.getDay() + 6) % 7;          // 0 = segunda … 6 = domingo
  d.setDate(d.getDate() - dow);
  return iso10(d);
}

export function somarDias(iso, n) {
  const d = comoData(iso);
  if (!d) return null;
  return iso10(new Date(d.getTime() + n * DIA_MS));
}

/**
 * Quantos DIAS distintos da semana corrente têm treino registrado.
 *
 * Conta dias, não séries: quem registrou 12 exercícios na segunda treinou uma
 * vez, não doze. `datas` vem de `datasTreinadas()` — YYYY-MM-DD, já sem
 * repetição, mas o Set aqui protege quem chamar de outro jeito.
 */
export function treinosNaSemana(datas, hojeISO) {
  const ini = inicioDaSemana(hojeISO);
  if (!ini) return 0;
  const fim = somarDias(ini, 6);
  const unicas = new Set();
  for (const d of datas || []) {
    const dia = typeof d === 'string' ? d.slice(0, 10) : '';
    if (dia >= ini && dia <= fim) unicas.add(dia);   // comparar texto YYYY-MM-DD é seguro
  }
  return unicas.size;
}

/**
 * A refeição que o topo da tela anuncia.
 *
 * É a primeira que ainda não começou. Depois da última do dia não devolvemos
 * `null` — devolvemos a primeira de amanhã, marcada como tal: às 23h o que
 * interessa ao paciente é o café das 7h, e uma linha vazia ali só faria a tela
 * parecer quebrada.
 */
export function proximaRefeicaoDoDia(refeicoes, agora) {
  const lista = ordenarRefeicoes((refeicoes || []).filter(r => hora(r.horario)));
  if (!lista.length) return null;

  const hhmm = hora(agora) || '';
  const futura = hhmm ? lista.find(r => hora(r.horario) > hhmm) : null;
  const alvo = futura || lista[0];
  return {
    nome: alvo.nome || 'Refeição',
    horario: hora(alvo.horario),
    amanha: !futura,
  };
}

/**
 * O treino que a tela anuncia, a partir do que a seção de Treino já calculou.
 *
 * Não recalcula rotação nem lê o banco: recebe pronto o que `proximoDiaSugerido`
 * e `diaTreinadoHoje` já sabem. Duas contas do mesmo número em dois lugares
 * viram duas respostas diferentes no dia em que uma delas mudar.
 */
export function treinoDoDia({ dias = [], proximo = null, treinadoHoje = null } = {}) {
  if (!dias.length) return null;
  if (treinadoHoje) return { dia: treinadoHoje, feito: true, proximo: proximo || null };
  return { dia: proximo || dias[0], feito: false, proximo: null };
}
