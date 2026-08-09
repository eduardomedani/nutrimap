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
import { valorDeTexto, mostrarToast, mostrarErro } from './utils.js';

/**
 * As frases das ações de cobrança, num lugar só.
 *
 * Fora daqui elas viravam variações do mesmo aviso escritas em três handlers
 * diferentes — e "recarregue para ver o estado atual" num lugar e "atualize os
 * dados" noutro fazem o usuário achar que são dois problemas.
 */
export const MSG = {
  criada:      'Cobrança criada.',
  atualizada:  'Cobrança atualizada.',
  removida:    'Cobrança removida.',
  naoPendente: 'Esta cobrança não está mais pendente. Atualize os dados e tente novamente.',
  duplicada:   'Já existe uma cobrança ativa para este vencimento.',
  falhou:      'Não foi possível concluir. Tente novamente.',
};

/** Erro do Postgres não é frase de gente. */
export function traduzirErroCobranca(e) {
  const m = String(e?.message || e || '').toLowerCase();
  if (m.includes('uq_comercial_cobranca_periodo') || m.includes('duplicate key')) return MSG.duplicada;
  if (m.includes('row-level security') || m.includes('violates row-level')) return 'Sem permissão para esta cobrança.';
  if (m.includes('failed to fetch') || m.includes('networkerror')) return 'Sem conexão. Tente novamente.';
  return MSG.falhou;
}

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
    </button>
    <button class="cm-btn cm-btn-sutil" type="button" data-cancelar-cobranca="${esc(cobranca.id)}">
      <i data-lucide="x"></i> Remover cobrança
    </button>`);
}

const MES_EXT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** "Agosto/2026" — o PERÍODO da cobrança, que é o que o cliente reconhece. */
export function competenciaExtenso(iso) {
  const s = String(iso || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) return '';
  const [ano, mes] = s.split('-');
  return `${MES_EXT[Number(mes) - 1]}/${ano}`;
}

/** "Vencida há 37 dias" / "Vence em 5 dias" — só para quem ainda não pagou. */
export function atrasoEmDias(cobranca, hoje) {
  if (!cobranca || cobranca.status !== 'pendente') return null;
  const d = diasEntre(hoje, cobranca.vencimento);
  if (d === null) return null;
  if (d < 0) return { dias: -d, vencida: true };
  return { dias: d, vencida: false };
}

/**
 * Uma linha do histórico, com as ações que o STATUS permite.
 *
 * O que decide as ações é o status REAL, não o rótulo: "Vencida" é situação
 * derivada da data sobre uma linha `pendente`, então ela aceita exatamente as
 * mesmas ações que uma pendente do mês que vem. Amarrar ação a rótulo faria a
 * mesma cobrança mudar de comportamento à meia-noite do vencimento.
 */
/** O rótulo da forma de pagamento, a partir do mesmo catálogo do formulário. */
export const formaRotulo = (f) => (FORMAS.find(([id]) => id === f) || [])[1] || null;

export function historicoItemHtml(c, hoje) {
  const st = situacaoDaCobranca(c, hoje);
  const { pago } = saldoDaCobranca(c);
  const atraso = atrasoEmDias(c, hoje);
  const editavel = c.status === 'pendente';   // pendente e vencida são a mesma linha

  // Pesos diferentes de propósito: a ação que a tela quer induzir é receber.
  // Três botões iguais fariam "Remover" ter o mesmo convite que "Registrar
  // pagamento", e o clique errado aqui tira dinheiro do "a receber".
  const acoes = editavel ? `
      <button class="cm-btn cm-btn-mini cm-btn-forte" type="button" data-registrar="${esc(c.id)}">
        Registrar pagamento
      </button>
      <button class="cm-btn cm-btn-mini" type="button" data-editar-cobranca="${esc(c.id)}">
        Editar
      </button>
      <button class="cm-btn cm-btn-mini cm-btn-sutil" type="button" data-cancelar-cobranca="${esc(c.id)}">
        Remover
      </button>`
    : c.status === 'pago' ? `
      <button class="cm-btn cm-btn-mini" type="button" data-ver-receita="${esc(c.id)}">
        Ver receita
      </button>`
    : '';   // cancelada não tem ação financeira nenhuma

  // A hierarquia da linha: competência → valor → vencimento → situação.
  // O período vem primeiro porque é como o cliente chama a cobrança
  // ("a de agosto"); a data solta só faz sentido depois de saber de qual mês.
  const forma = c.pago_em ? formaRotulo(c.forma_pagamento) : null;
  const detalhePago = c.pago_em
    ? `Paga em ${dataBR(c.pago_em)}${forma ? ` · ${forma}` : ''} · ${moeda(pago)}`
    : null;

  return `
    <li class="cm-dw-hist ${c.status === 'cancelado' ? 'cm-dw-hist-cancelada' : ''}">
      <div class="cm-dw-hist-id">
        <span class="cm-dw-hist-comp">${esc(competenciaExtenso(c.competencia || c.vencimento))}</span>
        <span class="cm-dw-hist-valor">${esc(moeda(c.valor))}</span>
      </div>
      <div class="cm-dw-hist-venc">Vencimento ${esc(dataBR(c.vencimento))}</div>
      <div class="cm-dw-hist-meta">
        <span class="cm-badge cm-c-${esc(st)}">${esc(COBRANCA_ROTULO[st] || st)}</span>
        ${atraso?.vencida ? `<span class="cm-dw-hist-atraso">há ${atraso.dias} ${atraso.dias === 1 ? 'dia' : 'dias'}</span>` : ''}
        ${detalhePago ? `<span>${esc(detalhePago)}</span>` : ''}
      </div>
      ${acoes ? `<div class="cm-dw-hist-acoes">${acoes}</div>` : ''}
    </li>`;
}

/**
 * O histórico é o que permite calcular recorrência, inadimplência e ticket
 * médio. Nada aqui é sobrescrito na renovação — foi por sobrescrever que a
 * planilha ficou sem passado.
 *
 * Cancelada não some do banco, some da LISTA OPERACIONAL: ela não é trabalho
 * a fazer. Continua a um clique de distância, porque "não operacional" e
 * "não existiu" são coisas diferentes, e auditoria vive da segunda.
 */
export function historicoHtml(cobrancas = [], hoje, { mostrarCanceladas = false } = {}) {
  // Ordena aqui em vez de confiar em quem chamou: `cobrancasDaAssinatura` já
  // devolve por vencimento desc, mas o histórico não pode depender disso —
  // uma consulta futura sem `order` deixaria a lista embaralhada em silêncio.
  const ordenadas = [...cobrancas].sort((a, b) =>
    String(b.vencimento || '').localeCompare(String(a.vencimento || '')));
  const canceladas = ordenadas.filter(c => c.status === 'cancelado');
  const operacionais = ordenadas.filter(c => c.status !== 'cancelado');

  const alternar = canceladas.length ? `
    <button class="cm-link-sutil" type="button" data-ver-canceladas aria-pressed="${mostrarCanceladas}">
      ${mostrarCanceladas ? 'Ocultar canceladas' : `Ver canceladas (${canceladas.length})`}
    </button>` : '';

  if (!operacionais.length && !(mostrarCanceladas && canceladas.length)) {
    return secao('Histórico', `
      <p class="cm-dw-nota">${canceladas.length
        ? 'Nenhuma cobrança ativa. Há registros cancelados no histórico.'
        : 'Ainda não há cobranças registradas.'}</p>
      ${alternar}`);
  }

  const lista = mostrarCanceladas ? ordenadas : operacionais;
  return secao('Histórico', `
    <ul class="cm-dw-hists">${lista.map(c => historicoItemHtml(c, hoje)).join('')}</ul>
    ${alternar}`);
}

export function observacoesHtml(a) {
  if (!a.observacoes) return '';
  return secao('Observações comerciais', `<p class="cm-dw-obs">${esc(a.observacoes)}</p>`);
}

export function drawerHtml({ assinatura, cobrancas = [], hoje, mostrarCanceladas = false }) {
  const aberta = cobrancas.find(c => c.status === 'pendente') ||
                 cobrancas.find(c => c.status === 'pago' && c.vencimento === assinatura.fim_periodo) || null;
  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-labelledby="cmDwTit">
      ${cabecalhoHtml(assinatura, hoje)}
      <div class="cm-drawer-corpo">
        ${assinaturaHtml(assinatura, hoje)}
        ${cobrancaAbertaHtml(aberta, hoje)}
        ${observacoesHtml(assinatura)}
        ${historicoHtml(cobrancas, hoje, { mostrarCanceladas })}
      </div>
    </div>`;
}

/**
 * O texto da confirmação de remoção. Fora do handler para o teste poder
 * conferir a frase sem levantar DOM — e porque ela é a última coisa que o
 * profissional lê antes de tirar dinheiro do "a receber".
 */
export function textoRemocao(cobranca, hoje) {
  const atraso = atrasoEmDias(cobranca, hoje);
  const linhas = [
    `Remover a cobrança de ${competenciaExtenso(cobranca.competencia || cobranca.vencimento)}?`,
    '',
    moeda(cobranca.valor),
    `Vencimento em ${dataBR(cobranca.vencimento)}`,
  ];
  if (atraso?.vencida) linhas.push(`Vencida há ${atraso.dias} ${atraso.dias === 1 ? 'dia' : 'dias'}`);
  linhas.push('', 'A cobrança será cancelada e deixará de fazer parte do valor a receber. O histórico será preservado.');
  return linhas.join('\n');
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
  catch (e) { fechar(); console.error('Comercial · drawer:', e); mostrarErro('Não foi possível abrir. Tente novamente.'); }
  return { fundo, fechar };
}

/** Abre o drawer do cliente. `aoMudar()` avisa a tela para recarregar. */
export async function abrirDrawerCliente({ assinatura, aoMudar }) {
  const dados = await import('./comercial-data.js');
  const hoje = hojeISO();
  let cobrancas = [];
  try { cobrancas = await dados.cobrancasDaAssinatura(assinatura.id); }
  catch (e) { console.error('Comercial · histórico:', e); }

  // Só de exibição: alternar não vai ao banco, porque `cobrancasDaAssinatura`
  // já traz as canceladas junto. Filtrar no cliente é o certo aqui — são
  // poucas linhas por assinatura, e uma segunda consulta para esconder/mostrar
  // o que já está em memória seria ida à rede para nada.
  let mostrarCanceladas = false;

  return raiz((fundo, fechar) => {
    const desenhar = () => {
      fundo.innerHTML = drawerHtml({ assinatura, cobrancas, hoje, mostrarCanceladas });
      window.renderIcons?.();
      ligar();
    };

    /** Recarrega o histórico sem fechar o drawer. */
    async function recarregar() {
      try { cobrancas = await dados.cobrancasDaAssinatura(assinatura.id); }
      catch (e) { console.error('Comercial · histórico:', e); }
      desenhar();
      aoMudar?.();
    }

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // querySelectorAll, não querySelector: agora cada linha do histórico tem
      // as próprias ações, e não só a cobrança do topo.
      fundo.querySelectorAll('[data-registrar]').forEach(b =>
        b.addEventListener('click', () => {
          const cob = cobrancas.find(c => c.id === b.dataset.registrar);
          if (!cob) return;
          fechar();
          abrirRegistroPagamento({ assinatura, cobranca: cob, aoMudar });
        }));

      fundo.querySelector('[data-criar-cobranca]')?.addEventListener('click', async () => {
        try {
          await dados.criarCobranca({
            assinatura,
            vencimento: assinatura.fim_periodo,
            valor: assinatura.valor_contratado,
          });
          mostrarToast(MSG.criada);
          fechar();
          aoMudar?.();
        } catch (e) {
          console.error('Comercial · criar cobrança:', e);
          // Mesma tradução das outras duas ações. O caso comum aqui é o índice
          // único: já existe cobrança viva para aquele vencimento.
          mostrarErro(traduzirErroCobranca(e));
        }
      });

      // Remover = cancelar. O período volta a ficar livre (o índice único
      // ignora canceladas), então a tela volta a oferecer criar a cobrança
      // certa no lugar. Vale para a cobrança do topo e para qualquer pendente
      // antiga do histórico: quem decide é o status, não a idade da linha.
      fundo.querySelectorAll('[data-cancelar-cobranca]').forEach(btn =>
        btn.addEventListener('click', async () => {
          const cob = cobrancas.find(c => c.id === btn.dataset.cancelarCobranca);
          if (!cob) return;
          if (!confirm(textoRemocao(cob, hoje))) return;

          btn.disabled = true;
          try {
            const r = await dados.cancelarCobranca(cob.id);
            // null = o banco não achou a linha PENDENTE. Quase sempre porque
            // ela foi paga ou removida em outra aba — não é erro, mas a tela
            // está velha e insistir seria mentir sobre o que aconteceu.
            if (!r) mostrarErro(MSG.naoPendente);
            else mostrarToast(MSG.removida);
            // O drawer CONTINUA aberto: histórico, cobrança do topo e total a
            // receber saem do dado recarregado. Fechar obrigaria a reabrir o
            // cliente para ver o efeito do próprio clique.
            await recarregar();
          } catch (e) {
            console.error('Comercial · cancelar cobrança:', e);
            mostrarErro(traduzirErroCobranca(e));
            btn.disabled = false;
          }
        }));

      // A edição é outro drawer, e `raiz()` só permite um por vez — por isso
      // este fecha antes. `aoVoltar` é o que devolve o usuário para cá, já
      // recarregado: sair da edição não pode significar sair do cliente.
      fundo.querySelectorAll('[data-editar-cobranca]').forEach(btn =>
        btn.addEventListener('click', () => {
          const cob = cobrancas.find(c => c.id === btn.dataset.editarCobranca);
          if (!cob) return;
          fechar();
          abrirEdicaoCobranca({
            assinatura, cobranca: cob, aoMudar,
            aoVoltar: () => abrirDrawerCliente({ assinatura, aoMudar }),
          });
        }));

      fundo.querySelector('[data-ver-canceladas]')?.addEventListener('click', () => {
        mostrarCanceladas = !mostrarCanceladas;
        desenhar();
      });

      fundo.querySelectorAll('[data-ver-receita]').forEach(b =>
        b.addEventListener('click', () => {
          // O lançamento vive no Financeiro; a navegação é do painel.
          fundo.dispatchEvent(new CustomEvent('comercial:ver-receita', {
            bubbles: true, detail: { lancamentoId: b.dataset.verReceita },
          }));
        }));
    }

    desenhar();
  });
}

// ───────────────────────────────────────────────────────────
// EDITAR COBRANÇA
// ───────────────────────────────────────────────────────────

export function edicaoVazia(cobranca) {
  return {
    valor: cobranca?.valor == null ? '' : Number(cobranca.valor).toFixed(2).replace('.', ','),
    vencimento: String(cobranca?.vencimento || '').slice(0, 10),
    observacoes: cobranca?.observacoes || '',
  };
}

/** As regras do formulário, sem DOM — é o que o teste exercita. */
export function validarEdicao(form = {}) {
  const erros = {};
  const valor = valorDeTexto(form.valor);
  if (!(valor > 0)) erros.valor = 'Informe um valor maior que zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.vencimento || ''))) {
    erros.vencimento = 'Informe o vencimento.';
  }
  return { ok: !Object.keys(erros).length, erros, valor };
}

export function formEdicaoHtml({ cobranca, assinatura, form, erros = {}, hoje }) {
  const comp = competenciaExtenso(cobranca.competencia || cobranca.vencimento);
  const vencida = atrasoEmDias(cobranca, hoje)?.vencida;

  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-label="Editar cobrança">
      <div class="cm-drawer-topo">
        <h2>Editar cobrança</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="cm-drawer-corpo">
        <!-- O contexto vem como LEITURA, não como campo desabilitado: campo
             cinza convida a tentar clicar. Mudar o dono ou o período de uma
             cobrança não é correção, é outra cobrança — então eles nem se
             apresentam como coisa editável. -->
        <div class="cm-dw-leitura">
          ${linha('Cliente', esc(assinatura?.paciente?.nome || '—'))}
          ${linha('Plano', esc(assinatura?.plano?.nome || '—'))}
          ${linha('Competência', esc(comp))}
        </div>

        ${vencida ? `
        <p class="cm-dw-aviso-sutil">
          Esta cobrança está vencida. Ao alterar o vencimento, a situação será
          recalculada automaticamente.
        </p>` : ''}

        <div class="cm-campo${erros.valor ? ' cm-erro-campo' : ''}">
          <label for="cmEdValor">Valor</label>
          <input id="cmEdValor" type="text" inputmode="decimal" value="${esc(form.valor)}">
          ${erros.valor ? `<span class="cm-erro">${esc(erros.valor)}</span>` : ''}
        </div>
        <div class="cm-campo${erros.vencimento ? ' cm-erro-campo' : ''}">
          <label for="cmEdVenc">Vencimento</label>
          <input id="cmEdVenc" type="date" value="${esc(form.vencimento)}">
          ${erros.vencimento ? `<span class="cm-erro">${esc(erros.vencimento)}</span>` : ''}
        </div>
        <div class="cm-campo">
          <label for="cmEdObs">Observação</label>
          <textarea id="cmEdObs" rows="3">${esc(form.observacoes)}</textarea>
        </div>
      </div>
      <div class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Voltar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>Salvar</button>
      </div>
    </div>`;
}

/**
 * Edita valor, vencimento e observação — só de cobrança em aberto.
 *
 * Atualiza o MESMO lançamento. Cancelar-e-recriar para corrigir um vencimento
 * deixaria duas linhas onde há uma cobrança só, e a auditoria do Financeiro
 * (que já existe, trg_auditoria_financeiro) contaria "cancelada" + "criada"
 * no lugar de "editada".
 */
export function abrirEdicaoCobranca({ assinatura, cobranca, aoMudar, aoVoltar }) {
  let form = edicaoVazia(cobranca);
  let salvando = false;
  const hoje = hojeISO();

  return raiz((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formEdicaoHtml({ cobranca, assinatura, form, erros, hoje });
      window.renderIcons?.();
      ligar();
    };

    function coletar() {
      return {
        valor: fundo.querySelector('#cmEdValor')?.value ?? '',
        vencimento: fundo.querySelector('#cmEdVenc')?.value ?? '',
        observacoes: fundo.querySelector('#cmEdObs')?.value ?? '',
      };
    }

    // Fechar por Voltar, Esc ou clique no fundo devolve ao cliente — sair da
    // edição não pode significar sair do cliente que se estava olhando.
    function voltar(fechar) { fechar(); aoVoltar?.(); }

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b =>
        b.addEventListener('click', () => voltar(fechar)));

      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const { ok, erros, valor } = validarEdicao(form);
        if (!ok) { desenhar(erros); return; }

        salvando = true;
        try {
          const dados = await import('./comercial-data.js');
          const r = await dados.editarCobranca(cobranca.id, {
            valor,
            vencimento: form.vencimento,
            observacoes: form.observacoes.trim() || null,
          });
          if (!r) {
            mostrarErro(MSG.naoPendente);
          } else {
            mostrarToast(MSG.atualizada);
          }
          // Volta ao cliente com os dados recarregados. A situação, os dias de
          // atraso e o total a receber saem todos do dado novo — nenhum deles
          // é guardado, então "recalcular" é só redesenhar.
          fechar();
          aoMudar?.();
          aoVoltar?.();
        } catch (e) {
          console.error('Comercial · editar cobrança:', e);
          mostrarErro(traduzirErroCobranca(e));
          salvando = false;
        }
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
          // A mesma tradução das outras ações de cobrança. O erro cru do
          // Postgres ia parar debaixo do campo de data, onde não ajudava
          // ninguém a entender o que fazer.
          desenhar({ pago_em: traduzirErroCobranca(e) });
        }
      });
    }

    desenhar();
  });
}
