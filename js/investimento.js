// ═══════════════════════════════════════════════════════════
// CALCULADORA DE INVESTIMENTO — cálculo puro, sem DOM e sem rede
// ═══════════════════════════════════════════════════════════
// Responde "posso comprar isto?" com o caixa que a operação REALMENTE teve nos
// últimos doze meses, e não com regra de bolso.
//
// ═══════════════════════════════════════════════════════════
// A RÉGUA, COMBINADA EM 05/09/2026
// ───────────────────────────────────────────────────────────
//   . reserva de R$ 20.000 que não se fura — é o dinheiro de pagar a equipe se
//     acontecer alguma coisa. A entrada sai do que houver ACIMA disso;
//   . metade da sobra mensal pode virar parcela. A outra metade é a margem de
//     erro do próprio número;
//   . doze meses de histórico;
//   . um a doze parcelas, que é o que o cartão comporta.
//
// Os quatro são PADRÃO, não lei: a tela deixa mexer em cada um, porque a régua
// de quem decide é a régua de quem decide. O que não muda é a conta.
//
// ═══════════════════════════════════════════════════════════
// A MÉDIA NÃO BASTA, E É POR ISSO QUE O PIOR MÊS APARECE
// ───────────────────────────────────────────────────────────
// Quem quebra é o mês ruim, não a média. Uma parcela que cabe na sobra média e
// não cabe na do pior mês é uma parcela que vai ser paga com aperto pelo menos
// uma vez ao ano — e é melhor saber disso antes de assinar.
//
// ═══════════════════════════════════════════════════════════
// O QUE ESTA CALCULADORA SE RECUSA A RESPONDER
// ───────────────────────────────────────────────────────────
// "Vale a pena" exige saber quanto o investimento traz, e isso depende do tipo:
//
//   REVENDA      dá para calcular: margem × giro é aritmética.
//   AMPLIAÇÃO    dá para estimar: mais alunos × o ticket médio REAL da carteira.
//   EQUIPAMENTO  NÃO dá. Uma esteira nova não traz um número conhecido de
//                alunos — ela evita a perda de quem sairia por falta de
//                novidade, e isso ninguém mede.
//
// No terceiro caso a calculadora responde o que sabe (cabe no caixa, quanto
// custa por mês de vida útil, quanto sai em juros) e CALA sobre retorno. Um ROI
// inventado para o equipamento seria a única parte da tela em que o número não
// vem de lugar nenhum — e seria justamente a que decide a compra.

import { competenciaDe } from './folha.js';
import { ehDespesaDeFolha, folhaDoPeriodo, contaNoTotal, hojeISO } from './financeiro.js';

/** Centavos inteiros, como no resto do Financeiro: `0.1 + 0.2` não é `0.3`. */
const emCentavos = v => Math.round((Number(v) || 0) * 100);
const doCentavo = c => Math.round(c) / 100;

/** A régua padrão. A tela pode sobrescrever campo a campo. */
export const REGUA = {
  reserva: 20000,        // o caixa que não se fura, para pagar a equipe
  fatiaDaSobra: 0.5,     // quanto da sobra mensal pode virar parcela
  meses: 12,             // quanto histórico olhar
  parcelasMax: 12,       // o que o cartão comporta
};

export const TIPOS = {
  revenda: {
    rotulo: 'Revenda',
    exemplo: 'suplementos, bebidas, camisas',
    retorno: 'margem',
    ajuda: 'O retorno é aritmética: margem por unidade × quantas você vende por mês.',
  },
  ampliacao: {
    rotulo: 'Ampliação ou reforma',
    exemplo: 'obra que abre vagas por horário',
    retorno: 'alunos',
    ajuda: 'O retorno vem de quantos alunos a mais cabem, pelo ticket médio real da sua carteira.',
  },
  equipamento: {
    rotulo: 'Equipamento',
    exemplo: 'esteira, polia, aparelho novo',
    retorno: null,
    ajuda: 'Não dá para dizer quantos alunos um aparelho traz. A calculadora responde se cabe '
         + 'no caixa e quanto ele custa por mês — o resto é decisão sua.',
  },
};

// ───────────────────────────────────────────────────────────
// O QUE O CAIXA TEM MOSTRADO
// ───────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → a competência do mês anterior, n vezes. */
function mesesAntes(iso, n) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return [];
  let ano = Number(m[1]), mes = Number(m[2]);
  const fora = [];
  for (let i = 0; i < n; i++) {
    fora.unshift(competenciaDe(ano, mes));
    mes--;
    if (mes < 1) { mes = 12; ano--; }
  }
  return fora;
}

/**
 * Entrou, saiu e sobrou em cada um dos últimos N meses.
 *
 * PELO `pago_em`, e não pela competência: o que interessa aqui é quando o
 * dinheiro ANDOU, que é o que o extrato bancário mostra. Uma despesa de julho
 * paga em agosto aperta o caixa de agosto.
 *
 * A FOLHA ENTRA UMA VEZ SÓ. Onde há lançamento (FOPAG da planilha ou espelho de
 * folha fechada) ela anda com as outras saídas, pelo pagamento; onde não há,
 * entra pela competência, que na convenção da casa é o mês do pagamento. É a
 * mesma regra de `fluxoDeCaixa()` — ver `folhaDoPeriodo` em js/financeiro.js.
 *
 * O MÊS CORRENTE FICA DE FORA: ele está pela metade, e um mês incompleto
 * derruba a média por um motivo que não é sobre o negócio.
 */
export function historicoMensal(lancamentos, folha, { hoje = hojeISO(), meses = REGUA.meses } = {}) {
  const chaves = mesesAntes(hoje, meses + 1).slice(0, meses);   // sem o mês corrente
  const somaveis = (lancamentos || []).filter(contaNoTotal);
  const apurada = folhaDoPeriodo(lancamentos, folha).filter(f => !f.lancado);

  return chaves.map(competencia => {
    const chave = competencia.slice(0, 7);
    let entrou = 0, saiu = 0, folhaMes = 0;

    for (const l of somaveis) {
      const pago = (l.status || (l.pago ? 'pago' : 'pendente')) === 'pago';
      if (!pago) continue;
      if (String(l.pago_em || '').slice(0, 7) !== chave) continue;
      const cents = emCentavos(l.valor);
      if (l.tipo === 'receita') entrou += cents;
      else if (ehDespesaDeFolha(l)) folhaMes += cents;
      else saiu += cents;
    }

    for (const f of apurada) {
      if (String(f.competencia || '').slice(0, 7) === chave) folhaMes += emCentavos(f.total);
    }

    return {
      competencia,
      entrou: doCentavo(entrou),
      saiu: doCentavo(saiu + folhaMes),
      folha: doCentavo(folhaMes),
      sobra: doCentavo(entrou - saiu - folhaMes),
    };
  });
}

/**
 * A capacidade mensal, em três números que a tela mostra juntos.
 *
 * `capacidade` é a fatia da sobra MÉDIA. `noPiorMes` é a mesma fatia do pior mês
 * — e é ele que diz se a parcela vai ser paga com aperto em algum momento do
 * ano. Mostrar só a média esconderia exatamente o mês que preocupa.
 *
 * MESES NEGATIVOS CONTAM. Um mês que fechou no vermelho faz parte do histórico,
 * e tirá-lo da média produziria uma capacidade que a operação nunca teve.
 */
export function capacidade(historico, { fatiaDaSobra = REGUA.fatiaDaSobra } = {}) {
  const sobras = (historico || []).map(m => emCentavos(m.sobra));
  if (!sobras.length) {
    return { meses: 0, media: 0, pior: 0, melhor: 0, negativos: 0, capacidade: 0, noPiorMes: 0 };
  }

  const soma = sobras.reduce((s, c) => s + c, 0);
  const media = soma / sobras.length;
  const pior = Math.min(...sobras);

  return {
    meses: sobras.length,
    media: doCentavo(media),
    pior: doCentavo(pior),
    melhor: doCentavo(Math.max(...sobras)),
    negativos: sobras.filter(c => c < 0).length,
    capacidade: doCentavo(media * fatiaDaSobra),
    noPiorMes: doCentavo(pior * fatiaDaSobra),
  };
}

/** O que dá para dar de entrada sem furar a reserva. Nunca negativo: caixa
 *  abaixo da reserva significa entrada zero, não entrada devedora. */
export function entradaMaxima(caixaHoje, { reserva = REGUA.reserva } = {}) {
  return doCentavo(Math.max(0, emCentavos(caixaHoje) - emCentavos(reserva)));
}

// ───────────────────────────────────────────────────────────
// O PARCELAMENTO
// ───────────────────────────────────────────────────────────

/**
 * A parcela de um financiamento Price — a fórmula que loja e cartão usam.
 *
 * Com juros zero é divisão simples. O `if` existe porque a fórmula tem `i` no
 * numerador e no denominador: com i = 0 ela vira 0/0.
 */
export function parcelaDe(valor, n, taxaMes = 0) {
  const pv = emCentavos(valor), i = Number(taxaMes) || 0;
  if (!(n > 0)) return 0;
  if (i <= 0) return doCentavo(pv / n);
  return doCentavo((pv * i) / (1 - Math.pow(1 + i, -n)));
}

/**
 * O veredicto de uma parcela contra a capacidade.
 *
 *   cabe    dentro da fatia combinada da sobra média
 *   aperta  passa da fatia, mas cabe na sobra média inteira
 *   estoura passa da sobra média: o mês não fecha
 *
 * "Aperta" existe porque a fatia é margem de segurança, não parede. Sem esse
 * meio-termo, um investimento que consome 55% da sobra apareceria com o mesmo
 * vermelho de outro que consome 300% — e são decisões diferentes.
 */
export function veredicto(parcela, cap) {
  const p = emCentavos(parcela);
  if (p <= emCentavos(cap.capacidade)) return 'cabe';
  if (p <= emCentavos(cap.media)) return 'aperta';
  return 'estoura';
}

export const ROTULO_VEREDICTO = {
  cabe: 'Cabe',
  aperta: 'Aperta',
  estoura: 'Não cabe',
};

/**
 * Um cenário por número de parcelas, de 1 até o teto.
 *
 * `financiado` é o que sobra depois da entrada — é sobre ele que os juros
 * correm. O desconto à vista entra só no cenário de 1 parcela, que é o único
 * em que ele existe de verdade.
 */
export function cenarios({
  valor, entrada = 0, parcelasMax = REGUA.parcelasMax,
  semJurosAte = 0, taxaMes = 0, descontoAVista = 0,
} = {}, cap) {
  const total = emCentavos(valor);
  const dado = Math.min(emCentavos(entrada), total);
  const financiado = doCentavo(total - dado);

  const fora = [];
  for (let n = 1; n <= parcelasMax; n++) {
    const comJuros = n > Math.max(1, semJurosAte);
    const taxa = comJuros ? taxaMes : 0;
    const parcela = parcelaDe(financiado, n, taxa);
    const pago = doCentavo(emCentavos(parcela) * n + dado);
    // O desconto à vista só vale para quem paga à vista. Aplicá-lo a todos os
    // cenários faria o parcelado parecer mais barato do que é.
    const desconto = n === 1 ? emCentavos(descontoAVista) : 0;
    const custoTotal = doCentavo(emCentavos(pago) - desconto);

    fora.push({
      parcelas: n,
      parcela,
      entrada: doCentavo(dado),
      financiado,
      juros: doCentavo(emCentavos(pago) - total),
      custoTotal,
      acimaDoAVista: doCentavo(emCentavos(custoTotal) - (total - emCentavos(descontoAVista))),
      comJuros,
      veredicto: cap ? veredicto(parcela, cap) : null,
      fatiaDaSobra: cap && cap.media > 0 ? emCentavos(parcela) / emCentavos(cap.media) : null,
    });
  }
  return fora;
}

/** O melhor cenário: o MENOR prazo que ainda cabe. Prazo curto solta o caixa
 *  antes e paga menos juros; alongar sem precisar é comprar aperto futuro. */
export function melhorCenario(lista) {
  return (lista || []).find(c => c.veredicto === 'cabe')
      || (lista || []).find(c => c.veredicto === 'aperta')
      || null;
}

// ───────────────────────────────────────────────────────────
// O RETORNO — só onde ele existe
// ───────────────────────────────────────────────────────────

/**
 * Quanto o investimento traz por mês, LÍQUIDO do custo que ele cria.
 *
 * Devolve `null` — e não zero — quando o tipo não permite estimar. Zero diria
 * "não traz nada", que é uma afirmação; null diz "não sei", que é a verdade
 * sobre um equipamento.
 *
 * @param dados.tipo          'revenda' | 'ampliacao' | 'equipamento'
 * @param dados.margem        revenda: margem por unidade
 * @param dados.giro          revenda: unidades por mês
 * @param dados.alunos        ampliação: alunos a mais
 * @param dados.ticket        ampliação: mensalidade média real da carteira
 * @param dados.custoMensal   o que o investimento passa a custar por mês
 */
export function ganhoMensal(dados = {}) {
  const custo = emCentavos(dados.custoMensal);

  if (dados.tipo === 'revenda') {
    const bruto = emCentavos(dados.margem) * (Number(dados.giro) || 0);
    return doCentavo(bruto - custo);
  }
  if (dados.tipo === 'ampliacao') {
    const bruto = emCentavos(dados.ticket) * (Number(dados.alunos) || 0);
    return doCentavo(bruto - custo);
  }
  return null;
}

/**
 * Em quantos meses o investimento se paga.
 *
 * `null` quando não há ganho estimável, e `Infinity` quando o ganho líquido é
 * zero ou negativo — que é uma resposta de verdade: nesse caso ele não se paga,
 * e arredondar para um número grande esconderia isso.
 */
export function payback(custoTotal, ganho) {
  if (ganho === null || ganho === undefined) return null;
  if (emCentavos(ganho) <= 0) return Infinity;
  return emCentavos(custoTotal) / emCentavos(ganho);
}

/**
 * O custo mensal de POSSE durante o parcelamento: a parcela mais o que o
 * equipamento consome. É o número que aperta o caixa de verdade, e é sempre
 * maior que a parcela — a manutenção não some porque a compra foi aprovada.
 */
export function custoDePosse(parcela, custoMensal = 0) {
  return doCentavo(emCentavos(parcela) + emCentavos(custoMensal));
}

/**
 * O custo por mês ao longo da vida útil: tudo o que se pagou, mais a
 * manutenção do período, dividido pelos meses de vida.
 *
 * É o que torna comparável um aparelho de R$ 4.000 que dura 10 anos com um de
 * R$ 2.000 que dura 3 — a comparação que o preço de etiqueta esconde.
 */
export function custoPorMesDeVida(custoTotal, custoMensal, anosDeVida) {
  const meses = (Number(anosDeVida) || 0) * 12;
  if (meses <= 0) return null;
  return doCentavo((emCentavos(custoTotal) + emCentavos(custoMensal) * meses) / meses);
}

/** O ticket médio REAL da carteira: o que os clientes ativos pagam, não o preço
 *  de tabela. Desconto negociado faz parte do que entra no caixa. */
export function ticketMedio(assinaturas) {
  const valores = (assinaturas || [])
    .filter(a => a.status === 'ativa')
    .map(a => emCentavos(a.valor_contratado ?? a.plano?.preco_padrao))
    .filter(c => c > 0);
  if (!valores.length) return null;
  return doCentavo(valores.reduce((s, c) => s + c, 0) / valores.length);
}

/**
 * A análise inteira, pronta para a tela desenhar.
 *
 * Junta o que o caixa mostrou, os cenários e — quando o tipo permite — o
 * retorno. `alertas` é a lista do que a pessoa precisa ler ANTES de decidir:
 * ela existe para a tela não ter que redescobrir as mesmas ressalvas.
 */
export function analisar(form = {}, { historico = [], regua = {} } = {}) {
  const r = { ...REGUA, ...regua };
  const cap = capacidade(historico, r);
  const maxEntrada = entradaMaxima(form.caixaHoje, r);

  const lista = cenarios({
    valor: form.valor,
    entrada: form.entrada,
    parcelasMax: r.parcelasMax,
    semJurosAte: form.semJurosAte,
    taxaMes: form.taxaMes,
    descontoAVista: form.descontoAVista,
  }, cap);

  const melhor = melhorCenario(lista);
  const ganho = ganhoMensal(form);
  const alertas = [];

  if (emCentavos(form.entrada) > emCentavos(maxEntrada)) {
    alertas.push(`Esta entrada fura a reserva de ${r.reserva}: o máximo é ${maxEntrada}.`);
  }
  if (cap.negativos > 0) {
    alertas.push(`${cap.negativos} dos últimos ${cap.meses} meses fecharam no vermelho — `
      + 'a média esconde isso, e a parcela vai existir nesses meses também.');
  }
  if (melhor && emCentavos(melhor.parcela) > emCentavos(cap.noPiorMes)) {
    alertas.push('A parcela cabe na sobra média, mas não na do pior mês do período.');
  }
  if (!melhor) {
    alertas.push('Nenhum prazo até o limite do cartão cabe na sobra. Só com entrada maior, '
      + 'preço menor ou mais prazo.');
  }
  if (ganho === null && form.tipo === 'equipamento') {
    alertas.push('Equipamento não tem retorno estimável: a resposta aqui é sobre caixa, '
      + 'não sobre lucro.');
  }
  if (ganho !== null && emCentavos(ganho) <= 0) {
    alertas.push('O ganho estimado não cobre nem o custo mensal que o investimento cria.');
  }

  const custoTotal = melhor ? melhor.custoTotal : (Number(form.valor) || 0);

  return {
    capacidade: cap,
    entradaMaxima: maxEntrada,
    cenarios: lista,
    melhor,
    ganhoMensal: ganho,
    paybackMeses: payback(custoTotal, ganho),
    custoDePosse: melhor ? custoDePosse(melhor.parcela, form.custoMensal) : null,
    custoPorMesDeVida: custoPorMesDeVida(custoTotal, form.custoMensal, form.anosDeVida),
    alertas,
  };
}
