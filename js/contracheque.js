// ═══════════════════════════════════════════════════════════
// CONTRACHEQUE — o recibo de pagamento de uma linha da folha
// ═══════════════════════════════════════════════════════════
// Uma via só, com o essencial: quem pagou, quem recebeu, o que foi apurado,
// o que entrou de adicional, quanto deu e como foi pago.
//
// O documento se monta a partir da MESMA linha que a folha já tem em mãos —
// nada é recalculado aqui. Se o contracheque fizesse a própria conta, um dia
// ele e a tela discordariam, e não haveria como saber qual dos dois pagou.
//
// Tudo aqui é função pura devolvendo string: nada de DOM, nada de rede. Quem
// coloca na tela e manda imprimir é folha-ui.js.

import { formatarBRL } from './utils.js';
import { textoDeMinutos, totalItem } from './folha.js';

// ───────────────────────────────────────────────────────────
// DADOS DO EMPREGADOR
// ---------------------------------------------------------------------------
// Copiados do cabeçalho do espelho de ponto. É O ÚNICO LUGAR onde eles moram:
// mudou de razão social ou de CNPJ, muda aqui e todo documento acompanha.
// ───────────────────────────────────────────────────────────
export const EMPRESA = {
  nome: 'NUTRICIONISTA EDUARDO MEDANI LTDA',
  cnpj: '50.868.949/0001-86',
};

// ───────────────────────────────────────────────────────────
// AS LINHAS DO DEMONSTRATIVO
// ───────────────────────────────────────────────────────────

/**
 * O que aparece discriminado no contracheque, na ordem.
 * A primeira linha é o cálculo por hora (ou o valor fixo do mensalista); as
 * demais são os adicionais, com a descrição que foi escrita na folha — é ela
 * que explica o valor para quem recebe.
 */
export function linhasDoContracheque(item) {
  if (!item) return [];
  const linhas = [];

  if (item.modo === 'fixo') {
    linhas.push({
      descricao: 'Valor mensal',
      referencia: '',
      valor: Number(item.valor_base) || 0,
    });
  } else {
    // Referência = só a quantidade de horas. O valor da hora fica fora do
    // recibo de propósito: o que a pessoa precisa conferir é quanto tempo foi
    // apurado e quanto isso deu.
    linhas.push({
      descricao: 'Horas trabalhadas',
      referencia: textoDeMinutos(item.minutos) || '',
      valor: Number(item.valor_base) || 0,
    });
  }

  for (const a of item.adicionais || []) {
    linhas.push({
      descricao: a.descricao || (Number(a.valor) < 0 ? 'Desconto' : 'Adicional'),
      referencia: '',
      valor: Number(a.valor) || 0,
    });
  }

  return linhas;
}

// ───────────────────────────────────────────────────────────
// VALOR POR EXTENSO
// ---------------------------------------------------------------------------
// Um recibo sem o valor por extenso é um número que qualquer caneta altera.
// ───────────────────────────────────────────────────────────
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0..999 por extenso. */
function ateNovecentos(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';

  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) partes.push(CENTENAS[c]);

  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10), u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/**
 * 2312.67 → "dois mil trezentos e doze reais e sessenta e sete centavos".
 *
 * A regra do "e" entre milhar e resto: entra quando o resto é menor que cem
 * ("mil e oitenta e três") ou é centena redonda ("mil e oitocentos"); fica de
 * fora no resto comum ("dois mil trezentos e doze").
 */
export function valorPorExtenso(valor) {
  // Ausência de valor não é zero: "zero real" num recibo afirma que nada era
  // devido, quando o que houve foi campo em branco.
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';

  const negativo = n < 0;
  const total = Math.round(Math.abs(n) * 100);
  const reais = Math.floor(total / 100);
  const centavos = total % 100;

  if (reais >= 1000000) return '';        // folha de pagamento não chega lá

  const partes = [];

  if (reais > 0) {
    const milhar = Math.floor(reais / 1000);
    const resto = reais % 1000;
    let texto = '';

    if (milhar) texto = milhar === 1 ? 'mil' : `${ateNovecentos(milhar)} mil`;
    if (resto) {
      const ligacao = !milhar ? '' : (resto < 100 || resto % 100 === 0) ? ' e ' : ' ';
      texto += ligacao + ateNovecentos(resto);
    }
    partes.push(`${texto} ${reais === 1 ? 'real' : 'reais'}`);
  }

  if (centavos > 0) {
    partes.push(`${ateNovecentos(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  }

  if (!partes.length) return 'zero real';
  return (negativo ? 'menos ' : '') + partes.join(' e ');
}

// ───────────────────────────────────────────────────────────
// O DOCUMENTO
// ───────────────────────────────────────────────────────────

/**
 * @param {object} item     linha da folha, com funcionario e adicionais
 * @param {object} folha    competência (mês, data de pagamento)
 * @param {object} opcoes   { empresa, nomeCompetencia, formatarData }
 * @returns {string} HTML de UMA via
 */
export function htmlContracheque(item, folha, opcoes = {}) {
  const {
    empresa = EMPRESA,
    nomeCompetencia = (c) => c,
    formatarData = (d) => d,
  } = opcoes;

  const f = item.funcionario || {};
  const linhas = linhasDoContracheque(item);
  const { vencimentos, descontos, liquido } = resumoDoContracheque(item);

  const periodo = item.ponto_inicio && item.ponto_fim
    ? `${formatarData(item.ponto_inicio)} a ${formatarData(item.ponto_fim)}`
    : null;

  return `
    <article class="cc">
      <header class="cc-cab">
        <div class="cc-emp">
          <div class="cc-emp-nome">${esc(empresa.nome)}</div>
          <div class="cc-emp-doc">CNPJ ${esc(empresa.cnpj)}</div>
        </div>
        <div class="cc-ident">
          <div class="cc-ident-tit">Recibo de pagamento</div>
          <div class="cc-ident-comp">${esc(nomeCompetencia(folha?.competencia))}</div>
        </div>
      </header>

      <section class="cc-grade cc-colab">
        ${campo('Colaborador', f.nome)}
        ${campo('CPF', formatarCPFCurto(f.cpf))}
        ${campo('Função', [f.cargo, f.unidade].filter(Boolean).join(' · '))}
        ${periodo ? campo('Período apurado', periodo) : ''}
      </section>

      <div class="cc-lanc-wrap">
        <table class="cc-lanc">
          <thead>
            <tr>
              <th class="cc-c-cod">Cód.</th>
              <th class="cc-c-desc">Descrição</th>
              <th class="cc-c-ref">Referência</th>
              <th class="cc-c-val">Vencimentos</th>
              <th class="cc-c-val">Descontos</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map((l, i) => {
              const negativo = Number(l.valor) < 0;
              return `
              <tr>
                <td class="cc-c-cod">${codigoDaLinha(i)}</td>
                <td class="cc-c-desc">${esc(l.descricao)}</td>
                <td class="cc-c-ref">${esc(l.referencia) || VAZIO}</td>
                <td class="cc-c-val">${negativo ? VAZIO : esc(formatarBRL(l.valor))}</td>
                <td class="cc-c-val">${negativo ? esc(formatarBRL(Math.abs(l.valor))) : VAZIO}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <section class="cc-resumo">
        <div class="cc-resumo-item">
          <span>Total de vencimentos</span><strong>${esc(formatarBRL(vencimentos))}</strong>
        </div>
        <div class="cc-resumo-item">
          <span>Total de descontos</span><strong>${esc(formatarBRL(descontos))}</strong>
        </div>
        <div class="cc-resumo-item cc-liquido">
          <span>Valor líquido</span><strong>${esc(formatarBRL(liquido))}</strong>
        </div>
      </section>

      <section class="cc-pag">
        <div class="cc-secao-tit">Dados do pagamento</div>
        <div class="cc-grade">
          ${campo('Data', folha?.data_pagamento ? formatarData(folha.data_pagamento) : VAZIO)}
          ${campo('Forma', f.chave_pix ? 'Pix' : VAZIO)}
          ${campo('Chave / conta', f.chave_pix || VAZIO)}
        </div>
      </section>

      <p class="cc-decl">
        Declaro ter recebido de ${esc(empresa.nome)} a importância líquida de
        <strong>${esc(formatarBRL(liquido))}</strong> (${esc(valorPorExtenso(liquido))}),
        referente ao período informado acima, dando plena quitação.
      </p>

      <div class="cc-assin">
        <div class="cc-assin-linha"></div>
        <div class="cc-assin-nome">${esc(f.nome || '')}</div>
        ${f.cpf ? `<div class="cc-assin-doc">CPF ${esc(formatarCPFCurto(f.cpf))}</div>` : ''}
      </div>
    </article>`;
}

/**
 * Vencimentos, descontos e líquido — SEPARAÇÃO, não cálculo novo.
 * As mesmas linhas de linhasDoContracheque(), agrupadas por sinal: valor
 * negativo é desconto e aparece positivo na coluna de descontos. O líquido
 * continua vindo de totalItem(), o mesmo número que a folha mostra.
 */
export function resumoDoContracheque(item) {
  const linhas = linhasDoContracheque(item);
  let vencimentos = 0;
  let descontos = 0;
  for (const l of linhas) {
    const v = Number(l.valor) || 0;
    if (v < 0) descontos += -v;
    else vencimentos += v;
  }
  return {
    vencimentos: arredondar(vencimentos),
    descontos: arredondar(descontos),
    liquido: totalItem(item),
  };
}

/** 0 → "01". Numeração de lançamento, como em contracheque de papel. */
export function codigoDaLinha(indice) {
  return String(Number(indice) + 1).padStart(2, '0');
}

function arredondar(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

/** Folha inteira: um contracheque por pessoa, um por página na impressão. */
export function htmlContracheques(itens, folha, opcoes = {}) {
  return (itens || []).map(i => htmlContracheque(i, folha, opcoes)).join('');
}

// ───────────────────────────────────────────────────────────
/** Travessão de campo sem valor. Coluna vazia confunde; "—" afirma que é zero. */
const VAZIO = '—';

function campo(rotulo, valor) {
  if (!valor) return '';
  return `<div class="cc-campo"><span>${esc(rotulo)}</span><strong>${esc(valor)}</strong></div>`;
}

function formatarCPFCurto(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return cpf || '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
