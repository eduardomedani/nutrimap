// ═══════════════════════════════════════════════════════════
// COMERCIAL — as regras do contrato
// ═══════════════════════════════════════════════════════════
// Funções puras: recebem dado, devolvem dado. Sem rede, sem DOM, sem `hoje`
// implícito — a data de referência é sempre argumento. É isso que permite
// testar "o que acontece quando ele paga 6 dias atrasado" sem esperar 6 dias.
//
// O QUE ESTE ARQUIVO SUBSTITUI DA PLANILHA:
//
//   Data de término   -> fimDoPeriodo()      início + duração do plano
//   Dias Vencidos     -> diasAteVencer()     calculado, nunca gravado
//   Status            -> situacaoDoCliente()  derivado, exceto pausa/cancelamento
//   Mês / Ano         -> não existem. Derivam da data quando a tela precisa.
//   CONTATO Z-API     -> telefoneZApi()      formatação, não segundo dado
//
// A GoUp roda em DIAS CORRIDOS: 30 no mensal, 90 no trimestral. Conferido
// contra as 131 linhas da planilha que tinham as duas datas — bateu em 131.
// `duracao_unidade: 'mes'` existe para planos futuros, não para os atuais.

const DIA = 86400000;

// ───────────────────────────────────────────────────────────
// DATAS
// ───────────────────────────────────────────────────────────

/** YYYY-MM-DD no fuso LOCAL. `toISOString()` converte para UTC e, a leste de
 *  Greenwich, joga a meia-noite local para o dia anterior. */
function iso10(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Aceita '2026-08-03' e '03/08/2026' — a planilha usa o segundo, e ainda
 *  mistura '3/8/2026' sem zero à esquerda em 14 das 144 linhas. */
export function comoData(valor) {
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  const s = String(valor || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

export function somarDias(iso, n) {
  const d = comoData(iso);
  if (!d) return null;
  return iso10(new Date(d.getTime() + n * DIA));
}

/** Meses calendário, preservando o fim do mês: 31/01 + 1 mês = 28/02, não
 *  03/03. O `setMonth` sozinho transborda. */
export function somarMeses(iso, n) {
  const d = comoData(iso);
  if (!d) return null;
  const dia = d.getDate();
  const alvo = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(dia, ultimoDia));
  return iso10(alvo);
}

/** Dias inteiros de `deISO` até `ateISO`. Positivo = `ate` está no futuro. */
export function diasEntre(deISO, ateISO) {
  const a = comoData(deISO), b = comoData(ateISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DIA);
}

// ───────────────────────────────────────────────────────────
// PERÍODO
// ───────────────────────────────────────────────────────────

export const PLANO_PADRAO = { duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 };

/** O fim do período a partir do início e da duração do plano. */
export function fimDoPeriodo(inicioISO, plano = PLANO_PADRAO) {
  const valor = Number(plano?.duracao_valor ?? PLANO_PADRAO.duracao_valor);
  const unidade = plano?.duracao_unidade === 'mes' ? 'mes' : 'dia';
  if (!comoData(inicioISO) || !(valor > 0)) return null;
  return unidade === 'mes' ? somarMeses(inicioISO, valor) : somarDias(inicioISO, valor);
}

/**
 * Onde começa o PRÓXIMO período quando esta cobrança é paga.
 *
 * Esta é a regra que a planilha nunca teve, e é a que decide se o cliente
 * ganha ou perde dias:
 *
 *   pagou ANTES do fim   -> continua do fim vigente. Pagar adiantado não pode
 *                           encurtar o que já foi comprado. Não é caso raro:
 *                           25 dos 95 intervalos entre pagamentos da planilha
 *                           são menores que 25 dias.
 *   pagou DENTRO da tolerância (5 dias na GoUp) -> continua do fim vigente. O
 *                           atraso curto não vira desconto nem vira prejuízo.
 *   pagou DEPOIS da tolerância -> começa na data do pagamento. Quem sumiu por
 *                           um mês não recebe um mês retroativo que não usou.
 */
export function inicioDaRenovacao({ fimVigente, dataPagamento, toleranciaDias = 5 }) {
  const fim = comoData(fimVigente), pag = comoData(dataPagamento);
  if (!fim) return null;
  if (!pag) return iso10(fim);

  const atraso = diasEntre(fimVigente, dataPagamento);   // >0 = pagou depois do fim
  return atraso <= Number(toleranciaDias) ? iso10(fim) : iso10(pag);
}

/** O período inteiro que a renovação produz. */
export function renovar({ fimVigente, dataPagamento, plano = PLANO_PADRAO }) {
  const inicio = inicioDaRenovacao({
    fimVigente,
    dataPagamento,
    toleranciaDias: plano?.tolerancia_dias ?? PLANO_PADRAO.tolerancia_dias,
  });
  if (!inicio) return null;
  return { inicio_periodo: inicio, fim_periodo: fimDoPeriodo(inicio, plano) };
}

// ───────────────────────────────────────────────────────────
// SITUAÇÃO
// ───────────────────────────────────────────────────────────

/** Dias até vencer. Negativo = já venceu. Zero = vence hoje. */
export function diasAteVencer(fimISO, hojeISO) {
  return diasEntre(hojeISO, fimISO);
}

/**
 * A situação do cliente, derivada.
 *
 * `pausada`, `cancelada` e `aguardando_inicio` vêm gravadas porque são decisão
 * humana e não dá para calculá-las. O resto sai da conta entre `fim_periodo` e
 * hoje — por isso nunca envelhece.
 */
export function situacaoDoCliente(assinatura, hojeISO, avisoDias = 7) {
  if (!assinatura) return null;
  const status = assinatura.status || 'ativa';
  if (status === 'cancelada') return 'cancelado';
  if (status === 'pausada') return 'pausado';
  if (status === 'aguardando_inicio') return 'aguardando';

  const dias = diasAteVencer(assinatura.fim_periodo, hojeISO);
  if (dias === null) return null;
  if (dias < 0) return 'vencido';
  if (dias <= avisoDias) return 'vence_em_breve';
  return 'ativo';
}

export const SITUACAO_ROTULO = {
  ativo: 'Ativo',
  vence_em_breve: 'Vence em breve',
  vencido: 'Vencido',
  pausado: 'Pausado',
  cancelado: 'Cancelado',
  aguardando: 'Aguardando início',
};

/** "Vence em 12 dias", "Vence hoje", "Vencido há 3 dias". */
export function textoDoVencimento(fimISO, hojeISO) {
  const d = diasAteVencer(fimISO, hojeISO);
  if (d === null) return '';
  if (d === 0) return 'Vence hoje';
  if (d === 1) return 'Vence amanhã';
  if (d > 1) return `Vence em ${d} dias`;
  if (d === -1) return 'Vencido há 1 dia';
  return `Vencido há ${-d} dias`;
}

/** Ordem de urgência: vencido primeiro, e entre vencidos o mais antigo antes. */
export function pesoDaUrgencia(assinatura, hojeISO) {
  const s = situacaoDoCliente(assinatura, hojeISO);
  const base = { vencido: 0, vence_em_breve: 1, ativo: 2, aguardando: 3, pausado: 4, cancelado: 5 };
  const d = diasAteVencer(assinatura?.fim_periodo, hojeISO);
  return [base[s] ?? 9, d ?? 9999];
}

// ───────────────────────────────────────────────────────────
// COBRANÇA
// ───────────────────────────────────────────────────────────

/**
 * A situação da cobrança, que é OUTRA coisa que a do cliente.
 *
 * Um cliente ativo pode ter cobrança pendente do próximo período; um cliente
 * vencido pode ter todas as cobranças pagas. Misturar as duas foi o que fez a
 * planilha ter `Status` e `Status Pagamento` querendo dizer a mesma coisa —
 * com 141 de 144 linhas marcadas "Concluído", a segunda não informa nada.
 */
export function situacaoDaCobranca(lancamento, hojeISO) {
  if (!lancamento) return null;
  const st = lancamento.status || 'pendente';
  if (st === 'cancelado') return 'cancelado';
  if (st === 'pago') return 'pago';
  const dias = diasEntre(hojeISO, lancamento.vencimento);
  return dias !== null && dias < 0 ? 'vencida' : 'pendente';
}

export const COBRANCA_ROTULO = {
  pendente: 'Pendente',
  pago: 'Pago',
  vencida: 'Vencida',
  cancelado: 'Cancelada',
};

/** O que ainda falta receber de uma cobrança. Sem `valor_pago`, o pendente é
 *  o valor inteiro — pagamento parcial está modelado, não implementado. */
export function saldoDaCobranca(lancamento) {
  const valor = Number(lancamento?.valor ?? 0);
  const pago = lancamento?.valor_pago == null ? null : Number(lancamento.valor_pago);
  if (!(valor > 0)) return { valor: 0, pago: pago ?? 0, saldo: 0, parcial: false };
  if (pago == null) {
    const quitado = lancamento?.status === 'pago';
    return { valor, pago: quitado ? valor : 0, saldo: quitado ? 0 : valor, parcial: false };
  }
  const saldo = Math.max(0, valor - pago);
  return { valor, pago, saldo, parcial: pago > 0 && saldo > 0 };
}

/** A competência de uma cobrança: o mês em que o período COMEÇA. O CHECK da
 *  tabela exige o dia 1º. */
export function competenciaDaCobranca(vencimentoISO) {
  const d = comoData(vencimentoISO);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ───────────────────────────────────────────────────────────
// TELEFONE — um dado, três formatos
// ───────────────────────────────────────────────────────────
// A planilha guarda CONTATO e CONTATO Z-API separados, e eles discordam entre
// si em várias linhas. Aqui há um número só, guardado como veio, e formatado
// na hora de usar.

/** Só os dígitos, com o 55 do Brasil na frente quando faltar. */
export function telefoneDigitos(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}

/** "(27) 99226-4711" — para ler na tela. */
export function telefoneBonito(bruto) {
  const d = telefoneDigitos(bruto);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(bruto || '');
}

/** "5527992264711" — o que a API de mensagem espera. */
export function telefoneZApi(bruto) {
  return telefoneDigitos(bruto);
}

// ───────────────────────────────────────────────────────────
// INDICADORES
// ───────────────────────────────────────────────────────────

/**
 * Os números da visão geral, de uma passada só sobre os dados.
 *
 * `receitaRecorrente` é a soma do que está contratado hoje, normalizada para
 * 30 dias — sem isso, um trimestral de R$ 961 apareceria como se entrasse todo
 * mês, e o MRR ficaria três vezes maior do que é.
 */
export function indicadores({ assinaturas = [], lancamentos = [], hoje, avisoDias = 7 } = {}) {
  const vivas = assinaturas.filter(a => a && a.status !== 'cancelada');
  const porSituacao = { ativo: 0, vence_em_breve: 0, vencido: 0, pausado: 0, cancelado: 0, aguardando: 0 };

  let recorrente = 0;
  for (const a of assinaturas) {
    const s = situacaoDoCliente(a, hoje, avisoDias);
    if (s) porSituacao[s] = (porSituacao[s] || 0) + 1;
    if (s === 'ativo' || s === 'vence_em_breve') {
      const dias = diasEntre(a.inicio_periodo, a.fim_periodo) || 30;
      const valor = Number(a.valor_contratado || 0);
      if (dias > 0 && valor > 0) recorrente += valor * (30 / dias);
    }
  }

  const mes = comoData(hoje) ? competenciaDaCobranca(hoje) : null;
  let recebidoNoMes = 0, aReceber = 0;
  for (const l of lancamentos) {
    if (!l || l.tipo !== 'receita' || l.status === 'cancelado') continue;
    const { pago, saldo } = saldoDaCobranca(l);
    if (l.status === 'pago' && mes && competenciaDaCobranca(l.pago_em) === mes) recebidoNoMes += pago;
    if (l.status === 'pendente') aReceber += saldo;
  }

  return {
    ativos: porSituacao.ativo + porSituacao.vence_em_breve,
    venceEmBreve: porSituacao.vence_em_breve,
    vencidos: porSituacao.vencido,
    pausados: porSituacao.pausado,
    cancelados: porSituacao.cancelado,
    total: vivas.length,
    recebidoNoMes,
    aReceber,
    receitaRecorrente: Math.round(recorrente * 100) / 100,
  };
}
