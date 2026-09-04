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
 * `fimVigente` É `assinatura.fim_periodo`, E NUNCA
 * `financeiro_lancamentos.vencimento`. As duas datas coincidiram até
 * 12/08/2026 e a distinção não existia; hoje são coisas separadas:
 *
 *   CALENDÁRIO DA ASSINATURA  -> `fim_periodo`. É contra ele que o atraso da
 *                                renovação se mede, e é o que mantém o período
 *                                encadeado ao calendário do cliente.
 *   PRAZO FINANCEIRO           -> `vencimento` da cobrança. Varia por evento de
 *                                negócio, e uma cobrança manual vence em
 *                                criação + 30 dias.
 *
 * Medir o atraso pelo vencimento financeiro empurraria a base do período para
 * frente a cada ciclo: a CASO_COBRANCA_MANUAL, período 03/08→02/09, com cobrança vencendo
 * 13/09, pagando em 05/09, ganharia 11 dias — e de novo no ciclo seguinte.
 * Regra confirmada em 14/08/2026.
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

/** O primeiro dia do mês de uma data. O CHECK da tabela exige o dia 1º em
 *  `competencia`, e os indicadores da tela agrupam pelo mesmo critério. */
export function primeiroDiaDoMes(iso) {
  const d = comoData(iso);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * A competência de uma cobrança de assinatura: o mês em que o PERÍODO COBRADO
 * COMEÇA.
 *
 * O PARÂMETRO NÃO É O VENCIMENTO, e já foi. Enquanto toda cobrança vencia no
 * fim do período, as duas contas davam no mesmo e ninguém precisava escolher.
 * Desde que a cobrança manual passou a vencer em `criação + 30 dias`, elas se
 * separaram — e o vencimento passou a ser uma decisão comercial sobre QUANDO
 * pagar, que varia por evento de negócio. Competência é outra pergunta: de que
 * mês é essa receita.
 *
 * NEM O FIM DO PERÍODO, que foi a primeira proposta e caiu com os dados na
 * mesa (conferência 103, decidido em 14/08/2026):
 *
 *   . numa mensalidade 09/08→08/09, 23 dos 30 dias caem em AGOSTO. Pelo fim,
 *     toda mensalidade da GoUp virava receita do mês seguinte, e um semestral
 *     ia seis meses para a frente;
 *   . em 28 das 31 cobranças pagas, o mês do início é o mês em que o dinheiro
 *     entrou. Pelo fim, 3 de 31.
 *
 * O que o início custa: uma cobrança PENDENTE de ciclo longo entra antes do
 * caixa — a da CASO_TROCA_DE_PLANO, R$ 990 cobrindo 13/08→11/11, conta em agosto e será
 * paga por volta de novembro. Foi aceito de olhos abertos: são 12 pendentes
 * contra 31 pagas, e quem acompanha caixa tem `pago_em` e `pago` no Financeiro.
 *
 * O Financeiro já tratava competência e vencimento como independentes: o CHECK
 * que as amarrava saiu em db/financeiro_lancamentos.sql, pelo caso da despesa
 * de agosto que vence em setembro. Quem tinha divergido era o Comercial.
 */
export function competenciaDaCobranca(periodoInicioISO) {
  return primeiroDiaDoMes(periodoInicioISO);
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

/** "(27) 90000-0000" — para ler na tela. */
export function telefoneBonito(bruto) {
  const d = telefoneDigitos(bruto);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(bruto || '');
}

/** "5527900000000" — o que a API de mensagem espera. */
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

  // `primeiroDiaDoMes`, e não `competenciaDaCobranca`: aqui é o mês corrente
  // do painel, não a competência de cobrança nenhuma.
  const mes = comoData(hoje) ? primeiroDiaDoMes(hoje) : null;
  let recebidoNoMes = 0, aReceber = 0;
  for (const l of lancamentos) {
    if (!l || l.tipo !== 'receita' || l.status === 'cancelado') continue;
    const { pago, saldo } = saldoDaCobranca(l);
    if (l.status === 'pago' && mes && primeiroDiaDoMes(l.pago_em) === mes) recebidoNoMes += pago;
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

// ───────────────────────────────────────────────────────────
// QUEM PRECISA DE ATENÇÃO
// ───────────────────────────────────────────────────────────
// A lista de clientes responde "como está cada um". Esta responde outra
// pergunta: "quem eu procuro hoje, e por quê". São coisas diferentes — a
// primeira é consulta, a segunda é trabalho a fazer, e por isso o motivo vem
// junto em vez de ficar implícito numa cor de badge.
//
// UM CLIENTE PODE TER VÁRIOS MOTIVOS ao mesmo tempo: vencido HÁ 20 dias, com
// cobrança em aberto, e sem turno. A função devolve todos, ordenados por
// gravidade — o relatório agrupa pelo primeiro e lista o resto ao lado, porque
// quem liga para o cliente precisa saber de tudo numa passada só.
//
// O QUE AINDA NÃO ESTÁ AQUI: os sinais de frequência (aluno que sumiu, aluno
// que caiu de uma quinzena para a outra). Eles dependem das presenças estarem
// no banco, o que ainda não aconteceu. `MOTIVOS` foi escrita para receber os
// novos sem mexer no resto — a chave entra na lista, o peso a posiciona.

/**
 * Cada motivo é um objeto com `chave`, `peso` (menor = mais grave), `rotulo`
 * curto para o agrupamento, e uma função que devolve o detalhe da linha — ou
 * `null` quando o motivo não se aplica àquele cliente.
 *
 * O DETALHE NÃO É DECORAÇÃO. "Vencido" manda ligar; "vencido há 27 dias" manda
 * ligar hoje. É a diferença entre uma lista que se lê e uma que se usa.
 */
// Data curta para o detalhe do motivo. `dataBR` mora em comercial-ui.js, e este
// arquivo é a camada de REGRA — importar da tela inverteria a dependência para
// ganhar oito caracteres.
const ddmm = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
};

export const MOTIVOS = [
  {
    chave: 'vencido',
    peso: 1,
    rotulo: 'Mensalidade vencida',
    detalhe: (a, hoje) => {
      const d = diasAteVencer(a.fim_periodo, hoje);
      return d !== null && d < 0 && situacaoDoCliente(a, hoje) === 'vencido'
        ? `há ${-d} ${-d === 1 ? 'dia' : 'dias'}` : null;
    },
  },
  {
    chave: 'cobranca_vencida',
    peso: 2,
    rotulo: 'Cobrança vencida',
    detalhe: (a, hoje) => {
      const c = a.cobrancaAberta;
      if (!c || situacaoDaCobranca(c, hoje) !== 'vencida') return null;
      const d = diasEntre(hoje, c.vencimento);
      return `venceu ${ddmm(c.vencimento)}, há ${-d} ${-d === 1 ? 'dia' : 'dias'}`;
    },
  },
  {
    chave: 'pausado',
    peso: 3,
    rotulo: 'Pausado',
    detalhe: a => (a.status === 'pausada' ? 'parou de treinar e não voltou' : null),
  },
  {
    chave: 'aguardando',
    peso: 4,
    rotulo: 'Aguardando início',
    detalhe: (a, hoje) => {
      if (a.status !== 'aguardando_inicio') return null;
      const d = diasEntre(a.data_inicio_original || a.inicio_periodo, hoje);
      return d !== null && d > 0 ? `cadastrado há ${d} dias e ainda não começou` : 'ainda não começou';
    },
  },
  {
    chave: 'vence_em_breve',
    peso: 5,
    rotulo: 'Vence esta semana',
    detalhe: (a, hoje) => {
      const d = diasAteVencer(a.fim_periodo, hoje);
      return situacaoDoCliente(a, hoje) === 'vence_em_breve'
        ? (d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${d} dias`) : null;
    },
  },
  {
    chave: 'cobranca_aberta',
    peso: 6,
    rotulo: 'Cobrança em aberto',
    detalhe: (a, hoje) => {
      const c = a.cobrancaAberta;
      if (!c || situacaoDaCobranca(c, hoje) !== 'pendente') return null;
      return `vence ${ddmm(c.vencimento)}`;
    },
  },
  {
    chave: 'sem_turno',
    peso: 7,
    rotulo: 'Sem turno definido',
    // Não é urgência de cobrança, é buraco de cadastro — e um buraco que custa
    // dinheiro: sem turno o aluno não entra na contagem de nenhum bônus.
    detalhe: a => (String(a.horario || '').trim() === '' ? 'não entra em nenhuma contagem por turno' : null),
  },
];

/**
 * Os motivos de um cliente, do mais grave para o menos. Vazio = está em ordem.
 *
 * Cancelado não aparece: quem cancelou não é trabalho pendente, é histórico.
 * Se um dia virar campanha de reativação, é outra lista com outro nome.
 */
export function motivosDeAtencao(assinatura, hojeISO) {
  if (!assinatura || assinatura.status === 'cancelada') return [];
  const saida = [];
  for (const m of MOTIVOS) {
    const detalhe = m.detalhe(assinatura, hojeISO);
    if (detalhe) saida.push({ chave: m.chave, rotulo: m.rotulo, peso: m.peso, detalhe });
  }
  return saida.sort((a, b) => a.peso - b.peso);
}

/**
 * A lista inteira, já agrupada pelo motivo MAIS GRAVE de cada cliente.
 *
 * Agrupar pelo mais grave, e não repetir o cliente em cada grupo, é o que faz
 * a folha impressa ser percorrível: um nome aparece uma vez só, no bloco que
 * diz o que fazer com ele. Os outros motivos vão na mesma linha, à direita.
 */
export function agruparPorAtencao(assinaturas = [], hojeISO) {
  const grupos = new Map(MOTIVOS.map(m => [m.chave, { ...m, clientes: [] }]));
  let semMotivo = 0;

  for (const a of assinaturas) {
    // Cancelado nao entra em nenhuma das duas contas. Ele nao tem motivo, mas
    // tambem nao esta "em ordem" — some da folha inteira, que e sobre quem
    // ainda esta no estudio. Contá-lo como em ordem inflaria o numero que
    // existe justamente para dar tamanho ao trabalho.
    if (a?.status === 'cancelada') continue;
    const motivos = motivosDeAtencao(a, hojeISO);
    if (!motivos.length) { semMotivo++; continue; }
    grupos.get(motivos[0].chave).clientes.push({ assinatura: a, motivos });
  }

  for (const g of grupos.values()) {
    // Dentro do grupo, o mais urgente primeiro; empate resolve por nome, para
    // a ordem não mudar sozinha entre duas impressões do mesmo dia.
    g.clientes.sort((x, y) => {
      const px = pesoDaUrgencia(x.assinatura, hojeISO), py = pesoDaUrgencia(y.assinatura, hojeISO);
      return px[0] - py[0] || px[1] - py[1]
        || String(x.assinatura.paciente?.nome || '').localeCompare(String(y.assinatura.paciente?.nome || ''), 'pt-BR');
    });
  }

  return {
    grupos: [...grupos.values()].filter(g => g.clientes.length).sort((a, b) => a.peso - b.peso),
    total: [...grupos.values()].reduce((s, g) => s + g.clientes.length, 0),
    semMotivo,
  };
}
