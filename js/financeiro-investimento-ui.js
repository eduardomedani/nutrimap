// ═══════════════════════════════════════════════════════════
// FINANCEIRO · CALCULADORA DE INVESTIMENTO — a tela
// ═══════════════════════════════════════════════════════════
// "Posso comprar isto?" respondido com o caixa que a operação teve nos últimos
// doze meses. A conta inteira mora em js/investimento.js, testada sem DOM; aqui
// há só o formulário, o desenho e a leitura dos dados.
//
// A TELA MOSTRA A RÉGUA ANTES DA RESPOSTA, e isso é de propósito. Um veredicto
// "cabe" sem dizer contra o quê é palpite com cara de conta — a pessoa precisa
// ver que a sobra média foi de R$ 4.000, que um mês fechou no vermelho e que
// metade da sobra é o teto combinado, para saber o quanto confiar no verde.
//
// E ELA CALA SOBRE O QUE NÃO SABE. Equipamento não tem retorno estimável: nesse
// caso não há payback na tela, e o alerta diz por quê. Ver o cabeçalho de
// js/investimento.js.

import {
  REGUA, TIPOS, historicoMensal, ticketMedio, analisar, ROTULO_VEREDICTO,
} from './investimento.js';
import { formatarBRL, nomeCompetencia, hojeISO } from './financeiro.js';
import { mascaraDeCentavos, mascararCampoDeDinheiro, valorDeTexto } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** O formulário sobrevive à troca de aba: refazer sete campos para mudar o
 *  prazo do fornecedor faria a calculadora ser usada uma vez só. */
let _form = {
  tipo: 'equipamento',
  valor: '', entrada: '', caixaHoje: '',
  semJurosAte: '12', taxaMes: '', descontoAVista: '',
  custoMensal: '', anosDeVida: '',
  margem: '', giro: '', alunos: '', ticket: '',
};
let _regua = { ...REGUA };
let _fonte = null;      // { lancamentos, folha } — para refazer o histórico
let _dados = null;      // { historico, ticketSugerido }
// O <details> da régua fica aberto entre redesenhos: quem abriu para mexer no
// percentual quer ver o efeito, e fechá-lo a cada mudança esconderia justamente
// o campo que a pessoa está usando.
let _reguaAberta = false;

export async function initInvestimentoUI(containerId, { lancamentos = [], folha = [], carregarAssinaturas = null } = {}) {
  const alvo = document.getElementById(containerId);
  if (!alvo) return;

  _fonte = { lancamentos, folha };

  // O ticket médio é SUGESTÃO e vem da carteira real (o que se paga, não o
  // preço de tabela). Falha em silêncio: sem o Comercial acessível, a
  // calculadora continua servindo — o campo fica manual.
  let ticketSugerido = null;
  if (carregarAssinaturas) {
    try { ticketSugerido = ticketMedio(await carregarAssinaturas()); } catch (e) { ticketSugerido = null; }
  }

  _dados = { historico: [], ticketSugerido };
  if (!_form.ticket && ticketSugerido) _form.ticket = mascaraDeCentavos(String(Math.round(ticketSugerido * 100)));

  desenhar(alvo);
}

// ───────────────────────────────────────────────────────────
// LEITURA DO FORMULÁRIO
// ───────────────────────────────────────────────────────────

/** Os campos de dinheiro chegam mascarados ("R$ 1.250,00") e viram número aqui,
 *  num lugar só — cada tela que fizesse a própria conversão erraria numa. */
function paraAnalise() {
  const n = v => valorDeTexto(v) ?? 0;
  return {
    tipo: _form.tipo,
    valor: n(_form.valor),
    entrada: n(_form.entrada),
    caixaHoje: n(_form.caixaHoje),
    semJurosAte: Number(_form.semJurosAte) || 0,
    // A taxa é digitada em PORCENTAGEM ao mês, que é como o vendedor fala.
    taxaMes: (Number(String(_form.taxaMes).replace(',', '.')) || 0) / 100,
    descontoAVista: n(_form.descontoAVista),
    custoMensal: n(_form.custoMensal),
    anosDeVida: Number(_form.anosDeVida) || 0,
    margem: n(_form.margem),
    giro: Number(_form.giro) || 0,
    alunos: Number(_form.alunos) || 0,
    ticket: n(_form.ticket),
  };
}

const temValor = () => (valorDeTexto(_form.valor) || 0) > 0;

// ───────────────────────────────────────────────────────────
// DESENHO
// ───────────────────────────────────────────────────────────
function desenhar(alvo) {
  // O HISTÓRICO SE REFAZ A CADA DESENHO, e não uma vez no init: mudar "meses de
  // histórico" na régua tem que mudar a base da conta, senão o campo existiria
  // sem efeito nenhum sobre a resposta.
  _dados.historico = historicoMensal(_fonte.lancamentos, _fonte.folha,
                                     { hoje: hojeISO(), meses: _regua.meses });

  const dados = paraAnalise();
  const analise = analisar(dados, { historico: _dados.historico, regua: _regua });

  alvo.innerHTML = `
    ${reguaHtml(analise)}
    ${formularioHtml()}
    ${temValor() ? resultadoHtml(analise, dados) : convite()}
  `;

  ligar(alvo);
  window.renderIcons?.();
}

/** O que o caixa mostrou — antes da pergunta, não depois dela. */
function reguaHtml(a) {
  const c = a.capacidade;
  const meses = _dados.historico;
  const maior = Math.max(...meses.map(m => Math.abs(m.sobra)), 1);

  return `
    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="ruler"></i> O que o caixa tem mostrado</div>

      <div class="rs-tiles fx-tiles-ano">
        <div class="rs-tile">
          <div class="rs-tile-rot">Sobra média</div>
          <div class="rs-tile-val">${esc(formatarBRL(c.media))}</div>
          <div class="rs-tile-sub">últimos ${c.meses} meses, já com tudo pago</div>
        </div>
        <div class="rs-tile">
          <div class="rs-tile-rot">Pior mês</div>
          <div class="rs-tile-val ${c.pior < 0 ? 'fx-negativo' : ''}">${esc(formatarBRL(c.pior))}</div>
          <div class="rs-tile-sub">${c.negativos
            ? `${c.negativos} ${c.negativos === 1 ? 'mês fechou' : 'meses fecharam'} no vermelho`
            : 'nenhum mês no vermelho'}</div>
        </div>
        <div class="rs-tile">
          <div class="rs-tile-rot">Cabe de parcela</div>
          <div class="rs-tile-val fx-positivo">${esc(formatarBRL(c.capacidade))}</div>
          <div class="rs-tile-sub">${Math.round(_regua.fatiaDaSobra * 100)}% da sobra média</div>
        </div>
        <div class="rs-tile">
          <div class="rs-tile-rot">Entrada possível</div>
          <div class="rs-tile-val">${esc(formatarBRL(a.entradaMaxima))}</div>
          <div class="rs-tile-sub">o caixa acima da reserva de ${esc(formatarBRL(_regua.reserva))}</div>
        </div>
      </div>

      <div class="inv-barras" aria-hidden="true">
        ${meses.map(m => `
          <div class="inv-barra" title="${esc(nomeCompetencia(m.competencia))}: ${esc(formatarBRL(m.sobra))}">
            <div class="inv-barra-fill${m.sobra < 0 ? ' neg' : ''}"
                 style="height:${Math.max(2, Math.abs(m.sobra) / maior * 100).toFixed(1)}%"></div>
          </div>`).join('')}
      </div>
      <div class="inv-barras-rot">
        <span>${esc(nomeCompetencia(meses[0]?.competencia))}</span>
        <span>${esc(nomeCompetencia(meses[meses.length - 1]?.competencia))}</span>
      </div>

      <details class="inv-regua"${_reguaAberta ? ' open' : ''}>
        <summary>A régua: reserva de ${esc(formatarBRL(_regua.reserva))}, ${Math.round(_regua.fatiaDaSobra * 100)}% da sobra, ${_regua.meses} meses, até ${_regua.parcelasMax}×</summary>
        <div class="inv-grade">
          ${campo('Reserva que não se fura', 'invReserva', formatarBRL(_regua.reserva))}
          ${campo('Quanto da sobra pode virar parcela (%)', 'invFatia', Math.round(_regua.fatiaDaSobra * 100), 'number')}
          ${campo('Meses de histórico', 'invMeses', _regua.meses, 'number')}
          ${campo('Máximo de parcelas', 'invParcelas', _regua.parcelasMax, 'number')}
        </div>
        <p class="fe-nota">
          Os quatro vieram do combinado de 05/09/2026 e valem como padrão. Mexer
          aqui muda a resposta desta simulação, não o histórico.
        </p>
      </details>
    </div>`;
}

function campo(rotulo, id, valor, tipo = 'text', dica = '') {
  return `
    <div class="dsp-campo">
      <label for="${id}">${rotulo}</label>
      <input type="${tipo}" id="${id}" class="np-input" value="${esc(valor)}">
      ${dica ? `<p class="dsp-dica">${dica}</p>` : ''}
    </div>`;
}

function formularioHtml() {
  const t = _form.tipo;
  return `
    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="calculator"></i> O que você quer comprar</div>

      <div class="inv-tipos" role="radiogroup" aria-label="Tipo de investimento">
        ${Object.entries(TIPOS).map(([id, x]) => `
          <button type="button" class="inv-tipo${id === t ? ' on' : ''}" data-inv-tipo="${id}"
                  role="radio" aria-checked="${id === t}">
            <strong>${esc(x.rotulo)}</strong>
            <span>${esc(x.exemplo)}</span>
          </button>`).join('')}
      </div>
      <p class="dsp-dica inv-ajuda">${esc(TIPOS[t]?.ajuda || '')}</p>

      <div class="inv-grade">
        ${campo('Valor total', 'invValor', _form.valor)}
        ${campo('Entrada', 'invEntrada', _form.entrada)}
        ${campo('Caixa disponível hoje', 'invCaixa', _form.caixaHoje, 'text',
                'O sistema não sabe seu saldo bancário — é daqui que sai a entrada possível.')}
        ${campo('Sem juros até (parcelas)', 'invSemJuros', _form.semJurosAte, 'number')}
        ${campo('Juros ao mês acima disso (%)', 'invTaxa', _form.taxaMes, 'text')}
        ${campo('Desconto à vista', 'invDesconto', _form.descontoAVista)}
        ${campo('Custo mensal que ele cria', 'invCustoMensal', _form.custoMensal, 'text',
                'Manutenção, energia, insumo. Uma esteira gasta ~R$ 50; uma polia, ~R$ 10.')}
        ${campo('Vida útil (anos)', 'invVida', _form.anosDeVida, 'number')}
      </div>

      ${t === 'revenda' ? `
        <div class="inv-grade inv-retorno">
          ${campo('Margem por unidade', 'invMargem', _form.margem)}
          ${campo('Unidades por mês', 'invGiro', _form.giro, 'number')}
        </div>` : ''}

      ${t === 'ampliacao' ? `
        <div class="inv-grade inv-retorno">
          ${campo('Alunos a mais', 'invAlunos', _form.alunos, 'number')}
          ${campo('Mensalidade média', 'invTicket', _form.ticket, 'text',
                  _dados.ticketSugerido
                    ? `Sua carteira paga em média ${formatarBRL(_dados.ticketSugerido)} — o valor real, com os descontos.`
                    : 'Não consegui ler a carteira; informe a mensalidade média.')}
        </div>` : ''}
    </div>`;
}

function convite() {
  return `
    <div class="fe-vazio">
      <div class="fe-vazio-icone"><i data-lucide="calculator"></i></div>
      <div class="fe-vazio-tit">Informe o valor para simular</div>
      <div class="fe-vazio-sub">
        A resposta sai do seu próprio caixa: os últimos ${_regua.meses} meses de
        entradas e saídas, já com a folha dentro.
      </div>
    </div>`;
}

function resultadoHtml(a, dados) {
  const m = a.melhor;
  const cls = { cabe: 'ok', aperta: 'aviso', estoura: 'nao' };

  return `
    <div class="fx-bloco">
      <div class="fx-bloco-tit"><i data-lucide="scale"></i> A resposta</div>

      ${m ? `
        <div class="inv-veredicto inv-${cls[m.veredicto]}">
          <div class="inv-veredicto-tit">
            <i data-lucide="${m.veredicto === 'cabe' ? 'circle-check' : m.veredicto === 'aperta' ? 'triangle-alert' : 'circle-x'}"></i>
            ${m.veredicto === 'cabe' ? 'Cabe no seu caixa' : 'Cabe, mas aperta'}
          </div>
          <div class="inv-veredicto-num">
            ${m.parcelas}× de <strong>${esc(formatarBRL(m.parcela))}</strong>
            ${m.entrada > 0 ? ` · entrada de ${esc(formatarBRL(m.entrada))}` : ''}
          </div>
          <div class="inv-veredicto-sub">
            ${(m.fatiaDaSobra * 100).toFixed(0)}% da sobra média${
              dados.custoMensal > 0
                ? ` · com a manutenção, ${esc(formatarBRL(a.custoDePosse))} por mês`
                : ''}
          </div>
        </div>` : `
        <div class="inv-veredicto inv-nao">
          <div class="inv-veredicto-tit"><i data-lucide="circle-x"></i> Não cabe em nenhum prazo</div>
          <div class="inv-veredicto-sub">
            Nem em ${_regua.parcelasMax}× a parcela entra na sobra média. Entrada maior,
            preço menor ou mais prazo mudam isso.
          </div>
        </div>`}

      ${a.alertas.length ? `
        <ul class="inv-alertas">
          ${a.alertas.map(t => `<li><i data-lucide="info"></i> ${esc(t)}</li>`).join('')}
        </ul>` : ''}

      ${retornoHtml(a, dados)}

      <div class="fp-tabela-wrap">
        <table class="fp-tabela fx-tabela inv-tabela">
          <thead>
            <tr>
              <th class="fx-c">Prazo</th><th class="fx-c">Parcela</th>
              <th class="fx-c">% da sobra</th><th class="fx-c">Juros</th>
              <th class="fx-c">Custo total</th><th class="fx-c">Situação</th>
            </tr>
          </thead>
          <tbody>
            ${a.cenarios.map(c => `
              <tr class="${m && c.parcelas === m.parcelas ? 'inv-escolhido' : ''}">
                <td class="fx-c" data-rot="Prazo">${c.parcelas}×</td>
                <td class="fx-c" data-rot="Parcela">${esc(formatarBRL(c.parcela))}</td>
                <td class="fx-c" data-rot="% da sobra">${c.fatiaDaSobra === null ? '—'
                  : `${(c.fatiaDaSobra * 100).toFixed(0)}%`}</td>
                <td class="fx-c" data-rot="Juros">${c.juros > 0 ? esc(formatarBRL(c.juros)) : '—'}</td>
                <td class="fx-c" data-rot="Custo total">${esc(formatarBRL(c.custoTotal))}</td>
                <td class="fx-c" data-rot="Situação">
                  <span class="dsp-selo inv-selo-${cls[c.veredicto]}">${ROTULO_VEREDICTO[c.veredicto]}</span>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <p class="fe-nota">
        A tabela compara prazos pelo que cada um custa e pelo espaço que ocupa na
        sobra. O prazo sugerido é o MENOR que cabe: alongar sem precisar paga mais
        juros e amarra o caixa por mais tempo.
      </p>
    </div>`;
}

/**
 * O retorno — e o silêncio quando ele não existe.
 *
 * Para equipamento a tela não mostra payback nenhum, e diz por quê. Um número
 * inventado aqui seria o único da tela que não vem de lugar nenhum, e seria
 * justamente o que decide a compra.
 */
function retornoHtml(a, dados) {
  if (a.ganhoMensal === null) {
    return `
      <div class="inv-retorno-caixa inv-mudo">
        <i data-lucide="help-circle"></i>
        <div>
          <strong>Sobre retorno, esta tela não responde.</strong>
          <div>${esc(TIPOS[dados.tipo]?.ajuda || '')}
            ${a.custoPorMesDeVida !== null
              ? ` Ao longo de ${dados.anosDeVida} anos, ele custa ${formatarBRL(a.custoPorMesDeVida)} por mês.`
              : ''}
          </div>
        </div>
      </div>`;
  }

  const meses = a.paybackMeses;
  const nunca = meses === Infinity;

  return `
    <div class="inv-retorno-caixa">
      <i data-lucide="trending-up"></i>
      <div>
        <strong>${nunca
          ? 'Não se paga: o ganho não cobre o custo que ele cria.'
          : `Se paga em ${Math.ceil(meses)} ${Math.ceil(meses) === 1 ? 'mês' : 'meses'}.`}</strong>
        <div>
          Ganho estimado de ${esc(formatarBRL(a.ganhoMensal))} por mês, já descontado o
          custo mensal${a.custoPorMesDeVida !== null
            ? ` · ao longo de ${dados.anosDeVida} anos custa ${esc(formatarBRL(a.custoPorMesDeVida))} por mês`
            : ''}.
        </div>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// EVENTOS
// ───────────────────────────────────────────────────────────
function ligar(alvo) {
  const redesenhar = () => desenhar(alvo);

  const det = alvo.querySelector('.inv-regua');
  if (det) det.addEventListener('toggle', () => { _reguaAberta = det.open; });

  alvo.querySelectorAll('[data-inv-tipo]').forEach(b =>
    b.addEventListener('click', () => { _form.tipo = b.dataset.invTipo; redesenhar(); }));

  // Campos de dinheiro: máscara enquanto digita, como na folha e no lançamento.
  const dinheiro = {
    invValor: 'valor', invEntrada: 'entrada', invCaixa: 'caixaHoje',
    invDesconto: 'descontoAVista', invCustoMensal: 'custoMensal',
    invMargem: 'margem', invTicket: 'ticket',
  };
  const simples = {
    invSemJuros: 'semJurosAte', invTaxa: 'taxaMes', invVida: 'anosDeVida',
    invGiro: 'giro', invAlunos: 'alunos',
  };

  for (const [id, campo] of Object.entries(dinheiro)) {
    const el = alvo.querySelector('#' + id);
    if (!el) continue;
    el.addEventListener('input', () => { mascararCampoDeDinheiro(el); _form[campo] = el.value; });
    // O RESULTADO SÓ SE REFAZ AO SAIR DO CAMPO. Redesenhar a cada tecla tiraria
    // o foco no meio da digitação — e "1" viraria R$ 0,01 com a tabela inteira
    // piscando embaixo.
    el.addEventListener('change', redesenhar);
  }

  for (const [id, campo] of Object.entries(simples)) {
    const el = alvo.querySelector('#' + id);
    if (!el) continue;
    el.addEventListener('input', () => { _form[campo] = el.value; });
    el.addEventListener('change', redesenhar);
  }

  const regua = {
    invReserva: v => { _regua.reserva = valorDeTexto(v) ?? REGUA.reserva; },
    invFatia: v => { _regua.fatiaDaSobra = Math.max(0, Math.min(100, Number(v) || 0)) / 100; },
    invMeses: v => { _regua.meses = Math.max(1, Number(v) || REGUA.meses); },
    invParcelas: v => { _regua.parcelasMax = Math.max(1, Number(v) || REGUA.parcelasMax); },
  };
  for (const [id, aplicar] of Object.entries(regua)) {
    const el = alvo.querySelector('#' + id);
    if (!el) continue;
    if (id === 'invReserva') el.addEventListener('input', () => mascararCampoDeDinheiro(el));
    el.addEventListener('change', () => { aplicar(el.value); redesenhar(); });
  }
}

export { paraAnalise };
