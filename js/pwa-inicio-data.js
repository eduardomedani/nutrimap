// ═══════════════════════════════════════════════════════════
// PWA · INÍCIO — as contas da tela
// ═══════════════════════════════════════════════════════════
// Só funções puras: recebem dado, devolvem dado. Nada de rede, nada de DOM —
// é o que deixa a tela testável sem navegador e sem Supabase.
//
// O QUE NÃO MORA AQUI, e por quê: água, check-in, peso e aderência à dieta não
// existem no banco. Um painel que mostra "Água: 0 de 2,5 L" fixo, ou uma
// aderência calculada por chute, ensina o paciente a não confiar no número — e
// um número em que ele não confia é pior do que a ausência dele.
//
// Cuidado com "água": existe como TIPO DE META (paciente_metas.tipo aceita
// 'agua'), e é por isso que ela pode aparecer na seção de metas. O que não
// existe é o registro diário — nenhuma tabela guarda quanto o paciente bebeu
// hoje. Meta de água e consumo de água são duas coisas, e só uma tem banco.

import { hora, ordenarRefeicoes, numeroBR, dataBR } from './pwa-dieta-data.js';

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

/** Dias inteiros entre `hojeISO` e `iso`. Negativo é passado. */
export function diasAte(iso, hojeISO) {
  const a = comoData(hojeISO);
  const b = comoData(iso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DIA_MS);
}

/**
 * A próxima consulta, pronta para a tela.
 *
 * Vem do RPC `rpc_paciente_proxima_consulta`, que já devolve só as colunas
 * seguras — nada de `relato`, `conduta`, `observacoes` ou `resumo`, que são
 * anotações do profissional sobre o atendimento e não recado para o paciente.
 */
export function formatarConsulta(c, hojeISO = '') {
  if (!c || !c.data_hora) return null;
  const d = new Date(c.data_hora);
  if (isNaN(d.getTime())) return null;

  const dias = hojeISO
    ? diasAte(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, hojeISO)
    : null;

  return {
    data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    online: c.modalidade === 'online',
    // "hoje" e "amanhã" dizem mais que "13/08" para quem está olhando o app de
    // manhã. Depois de uma semana a contagem regressiva perde a graça e a data
    // volta a ser a informação.
    quando: dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : (dias > 1 && dias <= 7) ? `em ${dias} dias` : '',
  };
}

const META_ROTULO = {
  peso: 'Peso',
  gordura: 'Gordura corporal',
  massa_magra: 'Massa magra',
  cintura: 'Cintura',
  frequencia_treino: 'Treinos por semana',
  agua: 'Água',
  habito: 'Hábito',
};

/**
 * Uma meta, pronta para a tela.
 *
 * A meta é do PROFISSIONAL para o paciente: ele lê, não edita. Não há policy
 * de escrita para o paciente em `paciente_metas`, e a tela não oferece nenhum
 * controle que sugira que há.
 */
export function formatarMeta(m) {
  if (!m) return null;
  const nome = (m.titulo || '').trim() || META_ROTULO[m.tipo] || 'Meta';
  const un = m.unidade ? ` ${m.unidade}` : '';
  const temAlvo = m.valor_alvo !== null && m.valor_alvo !== undefined;
  const temInicial = m.valor_inicial !== null && m.valor_inicial !== undefined;

  let alvo = '';
  if (temAlvo && temInicial) alvo = `${numeroBR(m.valor_inicial)} → ${numeroBR(m.valor_alvo)}${un}`;
  else if (temAlvo) alvo = `${numeroBR(m.valor_alvo)}${un}`;

  return { nome, alvo, prazo: m.prazo ? dataBR(m.prazo) : '' };
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
