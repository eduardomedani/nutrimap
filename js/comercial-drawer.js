// ═══════════════════════════════════════════════════════════
// COMERCIAL — o drawer do cliente e o registro de pagamento
// ═══════════════════════════════════════════════════════════
// É aqui que o pagamento entra, e é o ponto mais delicado do módulo: um
// pagamento registrado renova o período, e um período renovado errado só é
// descoberto trinta dias depois.
//
// O QUE ESTA TELA NÃO FAZ: criar um segundo sistema de pagamento. A cobrança
// já É um lançamento de receita; registrar o pagamento é marcar esse mesmo
// lançamento como pago. Não há "pagamento do cliente" separado das Receitas, e
// por isso não há como lançar duas vezes.

import {
  situacaoDoCliente, situacaoDaCobranca, SITUACAO_ROTULO, COBRANCA_ROTULO,
  textoDoVencimento, telefoneBonito, telefoneDigitos, saldoDaCobranca,
  renovar, diasEntre,
} from './comercial.js';
import { moeda, dataBR } from './comercial-ui.js';
import { valorDeTexto } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const FORMAS = [
  ['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['debito', 'Débito'], ['credito', 'Crédito'],
  ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['debito_automatico', 'Débito automático'],
  ['outro', 'Outro'],
];

// ───────────────────────────────────────────────────────────
// MARCAÇÃO DO DRAWER
// ───────────────────────────────────────────────────────────

function secao(titulo, conteudo) {
  return `
    <section class="cm-dw-secao">
      <h3 class="cm-dw-t">${esc(titulo)}</h3>
      ${conteudo}
    </section>`;
}

function linha(rot, valor) {
  return `
    <div class="cm-dw-linha">
      <span class="cm-dw-rot">${esc(rot)}</span>
      <span class="cm-dw-val">${valor}</span>
    </div>`;
}

/** "Cliente desde 03/08/2024 · 2 anos" — o tempo de casa, que a planilha
 *  perdia a cada renovação por sobrescrever a linha. */
export function tempoDeCasa(desdeISO, hoje) {
  const dias = diasEntre(desdeISO, hoje);
  if (dias === null || dias < 0) return '';
  if (dias < 30) return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return resto ? `${anos}a ${resto}m` : `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

export function cabecalhoHtml(a, hoje) {
  const s = situacaoDoCliente(a, hoje);
  const tel = a.paciente?.telefone;
  return `
    <header class="cm-dw-topo">
      <div class="cm-dw-id">
        <h2 id="cmDwTit">${esc(a.paciente?.nome || 'Sem nome')}</h2>
        <div class="cm-dw-sub">
          <span class="cm-badge cm-b-${esc(s)}">${esc(SITUACAO_ROTULO[s] || s)}</span>
          <span>${esc(a.plano?.nome || 'Sem plano')}</span>
          ${a.horario ? `<span>${esc(a.horario)}</span>` : ''}
        </div>
        ${tel ? `<a class="cm-dw-tel" href="https://wa.me/${esc(telefoneDigitos(tel))}" target="_blank" rel="noopener">
                   <i data-lucide="message-circle"></i> ${esc(telefoneBonito(tel))}</a>` : ''}
      </div>
      <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
    </header>`;
}

export function assinaturaHtml(a, hoje) {
  const casa = tempoDeCasa(a.data_inicio_original, hoje);
  return secao('Assinatura', `
    ${linha('Cliente desde', `${esc(dataBR(a.data_inicio_original))}${casa ? ` <small>· ${esc(casa)}</small>` : ''}`)}
    ${linha('Período atual', `${esc(dataBR(a.inicio_periodo))} → ${esc(dataBR(a.fim_periodo))}`)}
    ${linha('Próximo vencimento', `${esc(dataBR(a.fim_periodo))} <small>· ${esc(textoDoVencimento(a.fim_periodo, hoje))}</small>`)}
    ${linha('Plano', esc(a.plano?.nome || '—'))}
    ${linha('Valor contratado', esc(moeda(a.valor_contratado)))}
    ${a.renovacao_automatica ? '' : '<p class="cm-dw-nota">Renovação automática desligada: a próxima cobrança não nasce sozinha.</p>'}
  `);
}

/**
 * A próxima cobrança em aberto, com o botão de registrar pagamento.
 *
 * Se ela já estiver paga, o botão SOME e o lugar dele conta quando foi pago.
 * É o §13: uma cobrança paga não pode aceitar um segundo pagamento sem que
 * fique evidente que ela já tem um.
 */
export function cobrancaAbertaHtml(cobranca, hoje) {
  if (!cobranca) {
    return secao('Próxima cobrança', `
      <p class="cm-dw-nota">Nenhuma cobrança em aberto.</p>
      <button class="cm-btn" type="button" data-criar-cobranca>
        <i data-lucide="plus"></i> Criar cobrança do período
      </button>`);
  }

  const st = situacaoDaCobranca(cobranca, hoje);
  const { valor, pago, saldo, parcial } = saldoDaCobranca(cobranca);

  if (st === 'pago') {
    return secao('Próxima cobrança', `
      <div class="cm-dw-aviso">
        <i data-lucide="circle-check-big"></i>
        <div>
          <b>Esta cobrança já possui um pagamento registrado.</b>
          <div>Pago em ${esc(dataBR(cobranca.pago_em))} · ${esc(moeda(pago))}</div>
        </div>
      </div>
      <button class="cm-btn" type="button" data-ver-receita="${esc(cobranca.id)}">
        <i data-lucide="external-link"></i> Ver receita
      </button>`);
  }

  return secao('Próxima cobrança', `
    ${linha('Vencimento', `${esc(dataBR(cobranca.vencimento))} <small>· ${esc(textoDoVencimento(cobranca.vencimento, hoje))}</small>`)}
    ${linha('Valor', esc(moeda(valor)))}
    ${parcial ? linha('Já pago', `${esc(moeda(pago))} <small>· falta ${esc(moeda(saldo))}</small>`) : ''}
    ${linha('Situação', `<span class="cm-badge cm-c-${esc(st)}">${esc(COBRANCA_ROTULO[st] || st)}</span>`)}
    <button class="cm-btn cm-btn-forte" type="button" data-registrar="${esc(cobranca.id)}">
      <i data-lucide="circle-dollar-sign"></i> Registrar pagamento
    </button>`);
}

export function historicoHtml(cobrancas = [], hoje) {
  const pagas = cobrancas.filter(c => c.status !== 'cancelado');
  if (!pagas.length) {
    return secao('Histórico', '<p class="cm-dw-nota">Ainda não há cobranças registradas.</p>');
  }

  const item = c => {
    const st = situacaoDaCobranca(c, hoje);
    const { pago } = saldoDaCobranca(c);
    return `
      <li class="cm-dw-hist">
        <span class="cm-dw-hist-data">${esc(dataBR(c.vencimento))}</span>
        <span class="cm-dw-hist-valor">${esc(moeda(c.valor))}</span>
        <span class="cm-badge cm-c-${esc(st)}">${esc(COBRANCA_ROTULO[st] || st)}</span>
        <span class="cm-dw-hist-pago">${c.pago_em ? `pago em ${esc(dataBR(c.pago_em))}` : ''}</span>
      </li>`;
  };

  // O histórico é o que permite calcular recorrência, inadimplência e ticket
  // médio. Nada aqui é sobrescrito na renovação — foi por sobrescrever que a
  // planilha ficou sem passado.
  return secao('Histórico', `<ul class="cm-dw-hists">${pagas.map(item).join('')}</ul>`);
}

export function observacoesHtml(a) {
  if (!a.observacoes) return '';
  return secao('Observações comerciais', `<p class="cm-dw-obs">${esc(a.observacoes)}</p>`);
}

export function drawerHtml({ assinatura, cobrancas = [], hoje }) {
  const aberta = cobrancas.find(c => c.status === 'pendente') ||
                 cobrancas.find(c => c.status === 'pago' && c.vencimento === assinatura.fim_periodo) || null;
  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-labelledby="cmDwTit">
      ${cabecalhoHtml(assinatura, hoje)}
      <div class="cm-drawer-corpo">
        ${assinaturaHtml(assinatura, hoje)}
        ${cobrancaAbertaHtml(aberta, hoje)}
        ${observacoesHtml(assinatura)}
        ${historicoHtml(cobrancas, hoje)}
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// REGISTRO DE PAGAMENTO
// ───────────────────────────────────────────────────────────

export function pagamentoVazio(cobranca) {
  return {
    pago_em: hojeISO(),
    valor_pago: cobranca?.valor == null ? '' : Number(cobranca.valor).toFixed(2).replace('.', ','),
    forma_pagamento: 'pix',
  };
}

export function validarPagamento(form = {}, cobranca = null) {
  const erros = {};
  if (!form.pago_em) erros.pago_em = 'Informe a data do pagamento.';

  const v = String(form.valor_pago || '').trim() ? valorDeTexto(form.valor_pago) : null;
  if (v == null || !(v > 0)) erros.valor_pago = 'Informe quanto foi recebido.';

  // Receber MENOS que o cobrado não é quitação. Pagamento parcial está
  // modelado (valor_pago) mas não implementado, então aqui a gente barra em
  // vez de tratar R$ 200 como se quitasse R$ 350.
  if (v != null && cobranca?.valor != null && v < Number(cobranca.valor)) {
    erros.valor_pago = `Valor menor que a cobrança (${moeda(cobranca.valor)}). Pagamento parcial ainda não está disponível.`;
  }

  if (!FORMAS.some(([id]) => id === form.forma_pagamento)) erros.forma_pagamento = 'Escolha a forma de pagamento.';

  return erros;
}

/** O que a renovação vai fazer, mostrado ANTES de salvar. */
export function previaDaRenovacao(assinatura, pagoEm) {
  if (!assinatura || !pagoEm) return null;
  const plano = assinatura.plano || {};
  const novo = renovar({ fimVigente: assinatura.fim_periodo, dataPagamento: pagoEm, plano });
  if (!novo) return null;
  const atraso = diasEntre(assinatura.fim_periodo, pagoEm);
  const tol = plano.tolerancia_dias ?? 5;
  return {
    ...novo,
    atraso,
    forada: atraso > tol,
    tolerancia: tol,
  };
}

export function formPagamentoHtml({ cobranca, assinatura, form = {}, erros = {}, hoje }) {
  const previa = previaDaRenovacao(assinatura, form.pago_em);
  const cls = c => (erros[c] ? ' cm-erro-campo' : '');
  const msg = c => (erros[c] ? `<div class="cm-erro-msg">${esc(erros[c])}</div>` : '');

  return `
    <div class="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cmPgTit">
      <header class="cm-drawer-topo">
        <h2 id="cmPgTit">Registrar pagamento</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <div class="cm-dw-resumo">
          <div><b>${esc(assinatura.paciente?.nome || '')}</b></div>
          <div>${esc(assinatura.plano?.nome || '')} · vence ${esc(dataBR(cobranca.vencimento))} · ${esc(moeda(cobranca.valor))}</div>
        </div>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls('pago_em')}">
            <label for="cmgData">Data do pagamento</label>
            <input id="cmgData" type="date" value="${esc(form.pago_em)}">
            ${msg('pago_em')}
          </div>
          <div class="cm-campo${cls('valor_pago')}">
            <label for="cmgValor">Valor recebido</label>
            <input id="cmgValor" type="text" inputmode="decimal" value="${esc(form.valor_pago)}">
            ${msg('valor_pago')}
          </div>
        </div>

        <div class="cm-campo${cls('forma_pagamento')}">
          <label for="cmgForma">Forma de pagamento</label>
          <select id="cmgForma">
            ${FORMAS.map(([id, rot]) => `<option value="${id}"${id === form.forma_pagamento ? ' selected' : ''}>${esc(rot)}</option>`).join('')}
          </select>
          ${msg('forma_pagamento')}
        </div>

        ${previa ? `
        <div class="cm-dw-previa" data-previa>
          <div class="cm-dw-previa-t">O que vai acontecer</div>
          <ul>
            <li>A cobrança fica <b>paga</b> em ${esc(dataBR(form.pago_em))}.</li>
            <li>O período passa a ser <b>${esc(dataBR(previa.inicio_periodo))} → ${esc(dataBR(previa.fim_periodo))}</b>.</li>
            ${previa.forada
              ? `<li class="cm-dw-alerta">Pagamento ${previa.atraso} dias após o vencimento — passou da tolerância de ${previa.tolerancia}. O período conta da data do pagamento.</li>`
              : (previa.atraso > 0
                  ? `<li>Atraso de ${previa.atraso} ${previa.atraso === 1 ? 'dia' : 'dias'}, dentro da tolerância de ${previa.tolerancia}: o período continua do término anterior.</li>`
                  : '<li>Pagamento antecipado: o período continua do término anterior, sem encurtar.</li>')}
            ${assinatura.renovacao_automatica ? '<li>A próxima cobrança é criada automaticamente.</li>' : ''}
          </ul>
        </div>` : ''}

        <p class="cm-ajuda-campo">
          Isto grava <b>um</b> lançamento de receita no Financeiro — o mesmo que já
          é esta cobrança. Não há um segundo lugar para registrar.
        </p>
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Cancelar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-confirmar>
          <i data-lucide="check"></i> Confirmar pagamento
        </button>
      </footer>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// MONTAGEM
// ───────────────────────────────────────────────────────────

let _aberto = false;

function raiz(desenhar) {
  if (_aberto) return null;
  _aberto = true;
  const fundo = document.createElement('div');
  fundo.className = 'cm-drawer-raiz';
  document.body.appendChild(fundo);
  document.body.classList.add('cm-travado');

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('cm-travado');
    fundo.remove();
    _aberto = false;
  };
  function aoTeclado(e) { if (e.key === 'Escape') { e.preventDefault(); fechar(); } }
  document.addEventListener('keydown', aoTeclado);
  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });

  try { desenhar(fundo, fechar); }
  catch (e) { fechar(); console.error('Comercial · drawer:', e); alert('Não consegui abrir: ' + (e?.message || e)); }
  return { fundo, fechar };
}

/** Abre o drawer do cliente. `aoMudar()` avisa a tela para recarregar. */
export async function abrirDrawerCliente({ assinatura, aoMudar }) {
  const dados = await import('./comercial-data.js');
  const hoje = hojeISO();
  let cobrancas = [];
  try { cobrancas = await dados.cobrancasDaAssinatura(assinatura.id); }
  catch (e) { console.error('Comercial · histórico:', e); }

  return raiz((fundo, fechar) => {
    const desenhar = () => {
      fundo.innerHTML = drawerHtml({ assinatura, cobrancas, hoje });
      window.renderIcons?.();
      ligar();
    };

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      fundo.querySelector('[data-registrar]')?.addEventListener('click', () => {
        const cob = cobrancas.find(c => c.id === fundo.querySelector('[data-registrar]').dataset.registrar);
        if (!cob) return;
        fechar();
        abrirRegistroPagamento({ assinatura, cobranca: cob, aoMudar });
      });

      fundo.querySelector('[data-criar-cobranca]')?.addEventListener('click', async () => {
        try {
          await dados.criarCobranca({
            assinatura,
            vencimento: assinatura.fim_periodo,
            valor: assinatura.valor_contratado,
          });
          fechar();
          aoMudar?.();
        } catch (e) {
          console.error('Comercial · criar cobrança:', e);
          alert('Não consegui criar a cobrança: ' + (e?.message || e));
        }
      });

      fundo.querySelector('[data-ver-receita]')?.addEventListener('click', () => {
        // O lançamento vive no Financeiro; a navegação é do painel.
        fundo.dispatchEvent(new CustomEvent('comercial:ver-receita', {
          bubbles: true, detail: { lancamentoId: fundo.querySelector('[data-ver-receita]').dataset.verReceita },
        }));
      });
    }

    desenhar();
  });
}

/** O formulário de pagamento. É ele que dispara a renovação. */
export function abrirRegistroPagamento({ assinatura, cobranca, aoMudar }) {
  let form = pagamentoVazio(cobranca);
  let salvando = false;
  const hoje = hojeISO();

  return raiz((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formPagamentoHtml({ cobranca, assinatura, form, erros, hoje });
      window.renderIcons?.();
      ligar();
      fundo.querySelector('.cm-erro-campo input, .cm-erro-campo select')?.focus();
    };

    const coletar = () => ({
      pago_em: fundo.querySelector('#cmgData')?.value || '',
      valor_pago: fundo.querySelector('#cmgValor')?.value || '',
      forma_pagamento: fundo.querySelector('#cmgForma')?.value || '',
    });

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // Mudar a data redesenha a prévia: ver que o período vai contar do
      // pagamento — e não do término — ANTES de confirmar é o que evita
      // descobrir isso trinta dias depois.
      fundo.querySelector('#cmgData')?.addEventListener('change', () => { form = coletar(); desenhar(); });

      fundo.querySelector('[data-confirmar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const erros = validarPagamento(form, cobranca);
        if (Object.keys(erros).length) { desenhar(erros); return; }
        salvando = true;
        try {
          const dados = await import('./comercial-data.js');
          await dados.registrarPagamento({
            lancamentoId: cobranca.id,
            assinatura,
            pagoEm: form.pago_em,
            valorPago: valorDeTexto(form.valor_pago),
            formaPagamento: form.forma_pagamento,
          });
          fechar();
          aoMudar?.();
        } catch (e) {
          salvando = false;
          console.error('Comercial · registrar pagamento:', e);
          desenhar({ pago_em: 'Não consegui registrar: ' + (e?.message || e) });
        }
      });
    }

    desenhar();
  });
}
