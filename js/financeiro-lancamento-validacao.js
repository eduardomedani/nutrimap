// ═══════════════════════════════════════════════════════════
// LANÇAMENTO — validação, em funções puras
// ═══════════════════════════════════════════════════════════
// Serve despesa E receita: as regras são as mesmas — descrição obrigatória,
// valor maior que zero, competência no primeiro dia do mês, pago exige data.
// Só as PALAVRAS mudam ("Descreva a despesa" / "Descreva a receita"), e duas
// cópias da mesma regra para trocar um substantivo é como uma delas deixa de
// ser corrigida.
//
// Separado do formulário de propósito: "pago exige data de pagamento" tem que
// valer venha o dado do drawer, de uma importação ou de um script. Se morasse
// no listener do botão, existiria só para quem clica.
//
// O retorno é um mapa CAMPO -> mensagem, e não uma lista de frases. É o que
// permite à tela pôr o erro embaixo do campo errado, em vez de empilhar um
// alerta genérico no topo que obriga a caçar qual dos doze campos falhou.

import { valorDeTexto } from './utils.js';

export const STATUS = {
  pendente:  'Pendente',
  pago:      'Pago',
  cancelado: 'Cancelado',
};

/** O mesmo estado tem nome diferente dos dois lados do caixa: dinheiro que sai
 *  é "pago", dinheiro que entra é "recebido". Usar uma palavra só obrigaria a
 *  ler "pago" numa venda, que é o contrário do que aconteceu. */
export const STATUS_RECEITA = {
  pendente:  'A receber',
  pago:      'Recebido',
  cancelado: 'Cancelado',
};

export const rotulosStatus = tipo => (tipo === 'receita' ? STATUS_RECEITA : STATUS);

/** "Vencido" NÃO é status gravado: é pendente + vencimento no passado. Gravar
 *  exigiria um job reescrevendo linhas toda meia-noite, e a linha que o job não
 *  alcançasse mentiria. Aqui ele é derivado, sempre certo. */
export function statusVisual(lancamento, hoje) {
  const s = lancamento?.status || (lancamento?.pago ? 'pago' : 'pendente');
  if (s !== 'pendente') return s;
  const v = String(lancamento?.vencimento || '');
  if (!v) return 'pendente';
  return v < String(hoje) ? 'vencido' : 'pendente';
}

export const ROTULO_STATUS = { ...STATUS, vencido: 'Vencido' };

export const FORMAS_PAGAMENTO = [
  { id: 'pix',               rotulo: 'Pix' },
  { id: 'dinheiro',          rotulo: 'Dinheiro' },
  { id: 'boleto',            rotulo: 'Boleto' },
  { id: 'debito',            rotulo: 'Débito' },
  { id: 'credito',           rotulo: 'Crédito' },
  { id: 'transferencia',     rotulo: 'Transferência' },
  { id: 'debito_automatico', rotulo: 'Débito automático' },
  { id: 'outro',             rotulo: 'Outro' },
];

/** As palavras que mudam entre os dois lados do caixa. Ficam num mapa só para
 *  não haver um "despesa" esquecido no meio de uma tela de receita. */
export const TERMOS = {
  despesa: {
    titulo: 'despesa', artigo: 'Nova', subNovo: 'Registre uma saída financeira da empresa.',
    subEdicao: 'Atualize as informações deste lançamento.',
    descreva: 'Descreva a despesa', quem: 'Fornecedor ou favorecido',
    quemDica: 'Texto livre: fornecedor ainda não é cadastro próprio.',
    quemSecao: 'Fornecedor e documento', dataPagamento: 'Data do pagamento',
    jaFoi: 'Já pago', afeta: 'Este lançamento já afeta o fluxo de caixa realizado.',
  },
  receita: {
    titulo: 'receita', artigo: 'Nova', subNovo: 'Registre uma entrada financeira da empresa.',
    subEdicao: 'Atualize as informações deste lançamento.',
    descreva: 'Quem pagou, ou o que foi vendido', quem: 'Cliente ou pagador',
    quemDica: 'Texto livre: cliente ainda não é cadastro próprio aqui.',
    quemSecao: 'Cliente e documento', dataPagamento: 'Data do recebimento',
    jaFoi: 'Já recebido', afeta: 'Este lançamento já entra no caixa realizado.',
  },
};

/** 'YYYY-MM-DD' ou 'YYYY-MM' → '2026-08-01'. A competência é sempre o primeiro
 *  dia do mês, e o banco tem um CHECK exigindo isso. */
export function competenciaDeData(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * Valida o lançamento inteiro.
 *
 * @param {object} d       o formulário como o usuário o preencheu
 * @param {object} opcoes  { rascunho, tipo }
 * @returns {object} mapa campo -> mensagem. Vazio significa válido.
 */
export function validarLancamento(d = {}, opcoes = {}) {
  const erros = {};
  const rascunho = opcoes.rascunho === true;
  const t = TERMOS[opcoes.tipo === 'receita' ? 'receita' : 'despesa'];

  if (!String(d.descricao || '').trim()) {
    erros.descricao = `${t.descreva} — é isso que explica o lançamento depois.`;
  }

  if (!competenciaDeData(d.competencia)) {
    erros.competencia = `Escolha o mês a que a ${t.titulo} pertence.`;
  }

  // "A definir" é um estado legítimo: a planilha importada tem linhas reais sem
  // valor. O que não vale é dizer que sabe e mandar algo ilegível.
  if (d.valorIndefinido) {
    if (String(d.valor || '').trim()) {
      erros.valor = 'Marque "a definir" ou informe o valor — não os dois.';
    }
  } else {
    const bruto = String(d.valor ?? '').trim();
    if (!bruto) {
      erros.valor = 'Informe o valor, ou marque "valor a definir".';
    } else {
      const n = valorDeTexto(bruto);
      if (!Number.isFinite(n)) erros.valor = 'Valor inválido. Use o formato 1.234,56.';
      else if (n <= 0) erros.valor = 'O valor tem que ser maior que zero.';
    }
  }

  if (!rascunho && !d.categoria_id) {
    erros.categoria_id = 'Escolha a categoria, ou salve como rascunho para classificar depois.';
  }

  if (!STATUS[d.status]) {
    erros.status = 'Escolha a situação do lançamento.';
  }

  if (d.status === 'pago' && !d.pago_em) {
    // Sem a data, o fluxo de caixa realizado fica sem eixo — e o banco tem um
    // CHECK que recusaria a linha de qualquer forma.
    erros.pago_em = opcoes.tipo === 'receita'
      ? 'Informe quando o dinheiro entrou.'
      : 'Informe quando o pagamento saiu.';
  }

  if (d.vencimento && d.competencia) {
    const c = competenciaDeData(d.competencia);
    const vc = competenciaDeData(d.vencimento);
    // Aviso, não erro: vencimento fora do mês da competência é comum e legítimo
    // (energia de agosto que vence em setembro). Só não pode passar
    // despercebido quando for engano de digitação.
    if (vc && c && Math.abs(mesesEntre(c, vc)) > 2) {
      erros.vencimento = 'Vencimento a mais de dois meses da competência — confira se está certo.';
    }
  }

  return erros;
}

/** Diferença em meses entre duas competências. */
export function mesesEntre(a, b) {
  const ma = /^(\d{4})-(\d{2})/.exec(String(a || ''));
  const mb = /^(\d{4})-(\d{2})/.exec(String(b || ''));
  if (!ma || !mb) return 0;
  return (Number(mb[1]) - Number(ma[1])) * 12 + (Number(mb[2]) - Number(ma[2]));
}

/** Converte o formulário no que vai para o banco. Separado da validação porque
 *  são duas perguntas: "está certo?" e "como isso vira linha?". */
export function lancamentoParaBanco(d = {}, tipo = 'despesa') {
  const competencia = competenciaDeData(d.competencia);
  const valor = d.valorIndefinido ? null : valorDeTexto(String(d.valor ?? '').trim());

  return {
    tipo: tipo === 'receita' ? 'receita' : 'despesa',
    descricao: String(d.descricao || '').trim(),
    valor: Number.isFinite(valor) ? valor : null,
    competencia,
    // `data` é o dia do movimento e continua sendo a âncora da competência:
    // sem pagamento nem vencimento, o dia 1º do mês é o que se sabe.
    data: d.pago_em || d.vencimento || competencia,
    vencimento: d.vencimento || null,
    status: d.status || 'pendente',
    pago_em: d.status === 'pago' ? (d.pago_em || null) : null,
    categoria_id: d.categoria_id || null,
    centro_custo_id: d.centro_custo_id || null,
    fornecedor: String(d.fornecedor || '').trim() || null,
    forma_pagamento: d.status === 'pago' ? (d.forma_pagamento || null) : null,
    documento: String(d.documento || '').trim() || null,
    observacoes: String(d.observacoes || '').trim() || null,
  };
}

/** Os campos que a duplicação copia — e os que ela NÃO copia. Sai daqui para a
 *  regra existir num lugar só: id, pagamento, anexo e auditoria são do
 *  lançamento original, e carregá-los criaria uma linha que nasce dizendo que
 *  o dinheiro já andou. */
export function duplicarLancamento(l = {}) {
  return {
    descricao: l.descricao || '',
    valor: l.valor == null ? '' : String(l.valor).replace('.', ','),
    valorIndefinido: l.valor == null,
    competencia: l.competencia || null,
    vencimento: null,
    status: 'pendente',
    pago_em: null,
    forma_pagamento: null,
    categoria_id: l.categoria_id || null,
    centro_custo_id: l.centro_custo_id || null,
    fornecedor: l.fornecedor || '',
    documento: '',
    observacoes: l.observacoes || '',
  };
}

/** Um lançamento importado não pode perder o que a planilha dizia. O texto
 *  original vai para metadata ANTES da primeira edição — depois dela, já não há
 *  de onde recuperá-lo. */
export function preservarOriginal(l = {}) {
  if (!l || l.origem === 'manual') return null;
  if (l.metadata && l.metadata.original) return null;   // já preservado
  return {
    original: {
      descricao: l.descricao ?? null,
      valor: l.valor ?? null,
      data: l.data ?? null,
      competencia: l.competencia ?? null,
      origem: l.origem ?? null,
      origem_linha: l.origem_linha ?? null,
      preservado_em: null,     // a tela carimba; aqui não há relógio confiável
    },
  };
}
