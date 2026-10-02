// ═══════════════════════════════════════════════════════════
// FERIADO TRABALHADO — a hora extra de 100% na folha
// ═══════════════════════════════════════════════════════════
// A REGRA DA CASA, combinada em 02/10/2026: hora trabalhada em feriado vale
// DOBRADO. Quem ganha R$ 13 a hora recebe R$ 26 pela hora do feriado.
//
// SÓ A DIFERENÇA VIRA LANÇAMENTO. As horas do feriado já estão nas horas da
// folha (o total de diurnas do ponto não sabe o que é feriado) e já são pagas
// a R$ 13. O adicional é a outra metade: 5:53 × R$ 13,00 = R$ 76,48. Lançar
// 5:53 × R$ 26,00 por cima das horas normais pagaria TRÊS vezes a hora.
//
// DE ONDE SAEM AS HORAS DO DIA: do espelho de ponto em planilha
// (js/ponto-planilha.js), que tem as batidas de cada dia. O PDF só tem o total
// do mês. Batida ímpar no dia não é contada — a mesma regra do bônus por
// presença —, e volta à parte para alguém corrigir o ponto.
//
// Funções puras: entram as pessoas do espelho e as linhas da folha, sai o que
// lançar. A tela só desenha e grava.

import { valorBase, textoDeMinutos } from './folha.js';

const soDigitos = v => String(v ?? '').replace(/\D/g, '');

/** '2026-09-07' → '07/09'. */
export function diaCurto(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : '';
}

/** 13 → "R$ 13,00", sem depender de Intl com moeda (o espaço muda por navegador). */
const brl = v => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

/** O começo de toda descrição deste feriado. É por ele que se descobre o que
 *  já foi lançado — a descrição inteira muda com as horas e o valor/hora. */
export function prefixoDoFeriado(dia) {
  return `Horas extras feriado ${diaCurto(dia)}`;
}

/** "Horas extras feriado 07/09 — 5:53 × R$ 13,00 (100%)" — é o que sai no
 *  contracheque, então a conta inteira vai escrita nela. */
export function descricaoHoraExtraFeriado(dia, minutos, valorHora) {
  return `${prefixoDoFeriado(dia)} — ${textoDeMinutos(minutos)} × ${brl(valorHora)} (100%)`;
}

/**
 * Quem trabalhou no dia, e quanto.
 *
 * @param {Array} pessoas  saída de lerEspelhoDePonto
 * @param {string} dia     'AAAA-MM-DD'
 * @returns {{nome, cpf, funcao, minutos, impar: boolean}[]}  só quem bateu ponto
 */
export function horasNoDia(pessoas = [], dia) {
  return pessoas
    .map(p => ({
      nome: p.nome,
      cpf: soDigitos(p.cpf),
      funcao: p.funcao || '',
      minutos: (p.turnos || []).filter(t => t.dia === dia && t.ate != null)
        .reduce((s, t) => s + (t.ate - t.de), 0),
      impar: (p.impares || []).some(i => i.dia === dia),
    }))
    .filter(p => p.minutos > 0 || p.impar);
}

/**
 * O que lançar em cada linha da folha.
 *
 * Casa pelo CPF, como o resto da folha. A linha sem valor/hora (salário fixo)
 * não tem como calcular a hora: aparece, com valor nulo, para alguém decidir à
 * mão — sumir com ela esconderia que a pessoa trabalhou no feriado.
 *
 * @returns {{nome, cpf, minutos, impar, item, valorHora, valor, descricao, jaLancado}[]}
 */
export function linhasDoFeriado(pessoas, itens = [], dia) {
  const prefixo = prefixoDoFeriado(dia);
  return horasNoDia(pessoas, dia).map(p => {
    const item = itens.find(i => soDigitos(i.funcionario?.cpf) === p.cpf) || null;
    const valorHora = item && item.modo !== 'fixo' && Number(item.valor_hora) > 0
      ? Number(item.valor_hora) : null;
    const valor = valorHora && p.minutos > 0 ? valorBase(p.minutos, valorHora) : null;
    return {
      ...p,
      item,
      valorHora,
      valor,
      descricao: valor ? descricaoHoraExtraFeriado(dia, p.minutos, valorHora) : null,
      jaLancado: !!item && (item.adicionais || []).some(a => String(a.descricao || '').startsWith(prefixo)),
    };
  });
}
