// ═══════════════════════════════════════════════════════════
// EQUIPE · FOLHA DE PAGAMENTO — UI
// ═══════════════════════════════════════════════════════════
// A planilha, dentro do sistema. Você escolhe o mês, digita o total de HORAS
// DIURNAS que leu na folha de ponto de cada um, e a linha se calcula sozinha.
// Bônus e descontos entram como adicionais com descrição.
//
// SALVA SOZINHA: cada campo grava ao sair dele. Folha de pagamento se preenche
// consultando seis PDFs — um botão "Salvar" no fim seria uma chance a mais de
// perder meia hora de digitação.
//
// Folha FECHADA fica só de leitura. Dá para reabrir: erro de pagamento se
// corrige, não se esconde — mas tem que ser um ato consciente.

import {
  STATUS_FOLHA, ADICIONAIS_SUGERIDOS,
  minutosDeTexto, textoDeMinutos, valorBase, totalItem, totalFolha, totalMinutos,
  nomeCompetencia, competenciaAtual, proximaCompetencia,
  listarFolhas, abrirFolha, carregarFolha, salvarItem, excluirItem, adicionarItem,
  adicionarAdicional, excluirAdicional, fecharFolha, reabrirFolha, excluirFolha,
  traduzirErroFolha,
} from './folha.js';
import { listarFuncionarios } from './funcionarios.js';
// `normalizar` já é o nome da limpeza de acento deste arquivo (linha ~1096);
// o apelido evita a colisão sem renomear a função que casa nome de PDF.
import {
  competenciaAtiva, definirCompetencia, normalizar as normalizarCompetencia,
} from './competencia.js';
import {
  mostrarToast, mostrarErro, confirmar, formatarBRL, valorDeTexto, formatarData,
  copiarParaClipboard,
} from './utils.js';

let _nutriId = null;
let _container = null;
let _folha = null;      // a competência aberta
let _itens = [];        // linhas da folha, com adicionais aninhados
let _folhas = [];       // competências existentes, para o seletor
let _equipe = [];       // funcionários ativos
let _docs = new Map();  // colaborador_id -> { contracheque, folha_ponto }

/** Documentos já guardados nesta competência. Falha em silêncio: sem o
 *  repositório instalado, a folha continua funcionando sem os indicadores. */
async function carregarDocumentos() {
  if (!_folha?.competencia) { _docs = new Map(); return; }
  try {
    const { mapaDaCompetencia } = await import('./documentos.js');
    _docs = await mapaDaCompetencia(_folha.competencia);
  } catch (e) {
    _docs = new Map();
  }
}

const docsDe = (id) => _docs.get(id) || {};

let _pendentes = 0;      // arquivos aguardando vínculo

/** Quantos arquivos estão na sala de espera. Zero quando a etapa 2 não rodou. */
async function contarPendentesDaFila() {
  try {
    const { contarPendentes } = await import('./documentos.js');
    _pendentes = await contarPendentes();
  } catch (e) {
    _pendentes = 0;
  }
  return _pendentes;
}

const trava = () => _folha?.status === 'fechada';

// ───────────────────────────────────────────────────────────
// ENTRADA
// ───────────────────────────────────────────────────────────
export async function initFolhaUI(nutriId, containerId, opcoes = {}) {
  _nutriId = nutriId;
  _container = containerId;
  const cont = document.getElementById(containerId);
  if (!cont) return;

  try {
    [_folhas, _equipe] = await Promise.all([
      listarFolhas(),
      listarFuncionarios({ incluirInativos: false, limite: 200 }),
    ]);
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  await abrirCompetencia(...escolherCompetencia(opcoes));

  // Chegou por "Importar na folha de pagamento", vindo da aba Ponto: a zona de
  // arrastar arquivos é o motivo da visita, e ela fica abaixo da tabela de
  // documentos. Sem isto, a pessoa cai numa tela que parece a mesma de sempre.
  if (opcoes.destacarImportacao) destacarImportacao();
}

/**
 * Qual mês abrir, em ordem de prioridade:
 *
 *   1. o que a outra aba pediu explicitamente (link, botão "Importar na folha");
 *   2. o mês da sessão, se ele já existe como folha;
 *   3. o mês mais recente com folha;
 *   4. o mês corrente — e aí a folha é criada, com a equipe toda dentro.
 *
 * Devolve os argumentos de abrirCompetencia() para a chamada ficar em um lugar
 * só; criar é decidido por "esta competência ainda não existe", e não pelo
 * histórico estar vazio: quem pede agosto para importar quer agosto aberto.
 */
function escolherCompetencia(opcoes) {
  const pedida = opcoes.competencia ? normalizarCompetencia(opcoes.competencia) : null;
  const daSessao = competenciaAtiva();
  const alvo = pedida
    || (daSessao && _folhas.some(f => f.competencia === daSessao) ? daSessao : null)
    || _folhas[0]?.competencia
    || competenciaAtual();
  return [alvo, { criar: !_folhas.some(f => f.competencia === alvo) }];
}

/** Rola até a zona de importação e pisca a moldura uma vez. */
function destacarImportacao() {
  const zona = document.getElementById('fpZona');
  if (!zona) return;
  try { zona.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  zona.classList.add('fp-chamando');
  setTimeout(() => zona.classList.remove('fp-chamando'), 2400);
}

/** Carrega (ou cria) a folha de uma competência e redesenha a tela. */
async function abrirCompetencia(competencia, { criar = true } = {}) {
  const cont = document.getElementById(_container);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Abrindo a folha...</div>`;

  // O mês escolhido vale para a sessão inteira: Ponto e Documentos abrem no
  // mesmo mês, sem a pessoa ter que reencontrá-lo em cada aba.
  definirCompetencia(competencia);

  try {
    if (criar) {
      const r = await abrirFolha(_nutriId, competencia, _equipe);
      _folha = r.folha;
      _itens = r.itens;
      _folhas = await listarFolhas();
    } else {
      _folha = _folhas.find(f => f.competencia === competencia) || null;
      _itens = _folha ? await carregarFolha(_folha.id) : [];
    }
    await carregarDocumentos();
    await contarPendentesDaFila();
    render();
  } catch (e) {
    cont.innerHTML = erroHtml(e);
  }
}

function erroHtml(e) {
  return `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
    ${esc(traduzirErroFolha(e.message))}</div>`;
}

// ───────────────────────────────────────────────────────────
// DESENHO
// ───────────────────────────────────────────────────────────
function render() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  const fechada = trava();
  const total = totalFolha(_itens);

  cont.innerHTML = `
    <div class="fp-barra">
      <div class="fp-competencia">
        <label for="fpSeletor">Competência</label>
        <div class="fp-competencia-linha">
          <select id="fpSeletor" class="np-input">
            ${_folhas.map(f => `<option value="${f.competencia}"${f.competencia === _folha?.competencia ? ' selected' : ''}>
              ${esc(nomeCompetencia(f.competencia))}${f.status === 'fechada' ? ' · fechada' : ''}</option>`).join('')}
          </select>
          <input type="month" id="fpMes" class="np-input fp-mes" value="${(_folha?.competencia || competenciaAtual()).slice(0, 7)}">
          <button class="btn" id="fpAbrir"><i data-lucide="folder-open"></i> Abrir mês</button>
        </div>
      </div>

      <div class="fp-resumo">
        <div class="fp-chip fp-chip-${fechada ? 'fechada' : 'rascunho'}">
          <i data-lucide="${fechada ? 'lock' : 'pencil-line'}"></i> ${STATUS_FOLHA[_folha?.status] || '—'}
        </div>
        <div class="fp-total-caixa">
          <div class="fp-total-rotulo">Total do mês</div>
          <div class="fp-total-valor" id="fpTotalGeral">${formatarBRL(total)}</div>
          <div class="fp-total-sub" id="fpTotalHoras">${_itens.length} pessoas · ${textoDeMinutos(totalMinutos(_itens)) || '0:00'} h</div>
        </div>
      </div>
    </div>

    ${fechada && _folha?.data_pagamento
      ? `<div class="fp-aviso"><i data-lucide="check-circle-2"></i>
           Paga em ${formatarData(_folha.data_pagamento)}.
         </div>`
      : ''}

    ${painelDocumentosHtml()}

    ${fechada ? `
      <div class="fp-importar fp-importar-travada">
        <i data-lucide="lock"></i>
        <div class="fp-importar-txt">
          <strong>Folha fechada — não aceita importação</strong>
          <span>Reabra para lançar o ponto, corrigir horas ou incluir adicionais.</span>
        </div>
        <button class="btn primary" data-fp-reabrir><i data-lucide="lock-open"></i> Reabrir folha</button>
      </div>` : `
      <div class="fp-importar" id="fpZona">
        <i data-lucide="file-up"></i>
        <div class="fp-importar-txt">
          <strong>Arraste as folhas de ponto (PDF) aqui</strong>
          <span>O total de horas diurnas de cada uma entra na linha da pessoa, pelo CPF.</span>
        </div>
        <button class="btn" id="fpEscolher">Escolher arquivos</button>
        <input type="file" id="fpArquivos" accept="application/pdf,.pdf" multiple hidden>
      </div>`}

    <div class="fp-tabela-wrap">
      <table class="fp-tabela">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th class="fp-num">Horas do ponto</th>
            <th class="fp-num">Valor/hora</th>
            <th class="fp-num">Valor base</th>
            <th class="fp-adicionais">Adicionais e descontos</th>
            <th class="fp-num">Total</th>
            <th class="fp-pix">Chave Pix</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="fpCorpo">${_itens.map(linhaHtml).join('')}</tbody>
      </table>
    </div>

    <div class="fp-rodape">
      <div class="fp-rodape-esq">
        ${fechada ? '' : `
          <select id="fpAddFunc" class="np-input fp-add-func">
            <option value="">Adicionar alguém à folha...</option>
            ${_equipe.filter(f => !_itens.some(i => i.funcionario_id === f.id))
              .map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}
          </select>`}
      </div>
      <div class="fp-rodape-dir">
        <button class="btn" id="fpContracheques"><i data-lucide="printer"></i> Contracheques</button>
        ${fechada
          ? `<button class="btn" data-fp-reabrir><i data-lucide="lock-open"></i> Reabrir folha</button>`
          : `<input type="date" id="fpDataPag" class="np-input fp-data" value="${_folha?.data_pagamento || hoje()}" title="Data do pagamento">
             <button class="btn primary" id="fpFechar"><i data-lucide="check"></i> Fechar folha</button>`}
        ${fechada ? '' : `
          <button class="btn" id="fpExcluir" title="Excluir esta competência"><i data-lucide="trash-2"></i></button>`}
      </div>
    </div>
  `;

  ligar();
}

/**
 * Quantos documentos a competência já tem, e quem está faltando.
 *
 * Fica à vista o tempo todo, não só no fechamento: descobrir que faltou a
 * folha de ponto de alguém depois de fechar custa reabrir, importar e fechar
 * de novo — e o colaborador já viu a competência sem o documento.
 */
export function resumoDocumentos(itens, docs) {
  const pessoas = itens.length;
  let contracheques = 0, pontos = 0, vistos = 0;
  const semPonto = [];

  for (const i of itens) {
    const d = docs.get(i.funcionario_id) || {};
    if (d.contracheque) contracheques++;
    if (d.contracheque?.visualizado_pelo_colaborador) vistos++;
    if (d.folha_ponto) pontos++;
    else if (i.modo === 'horas') semPonto.push(i.funcionario?.nome || '—');
  }
  return { pessoas, contracheques, pontos, vistos, semPonto };
}

function painelDocumentosHtml() {
  const r = resumoDocumentos(_itens, _docs);
  if (!r.pessoas) return '';

  const item = (n, total, rotulo, icone) => `
    <div class="fp-doc-ind${n === total ? ' ok' : n ? ' parcial' : ''}">
      <i data-lucide="${icone}"></i>
      <span><strong>${n}</strong>/${total} ${rotulo}</span>
    </div>`;

  return `
    <div class="fp-docs-barra">
      ${item(r.contracheques, r.pessoas, 'contracheques', 'receipt-text')}
      ${item(r.pontos, r.pessoas, 'folhas de ponto', 'clock')}
      ${r.vistos ? `<div class="fp-doc-ind ok"><i data-lucide="eye"></i>
        <span><strong>${r.vistos}</strong> ${r.vistos === 1 ? 'visualizado' : 'visualizados'}</span></div>` : ''}
      ${r.semPonto.length
        ? `<div class="fp-doc-ind pendente" title="${esc(r.semPonto.join(', '))}">
             <i data-lucide="triangle-alert"></i>
             <span><strong>${r.semPonto.length}</strong> sem folha de ponto</span>
           </div>`
        : ''}
      ${_pendentes
        ? `<button class="btn-sm fp-doc-alerta" id="fpPendentes">
             <i data-lucide="file-question"></i> ${_pendentes} aguardando vínculo
           </button>`
        : ''}
      <button class="btn-sm btn-sm-secondary" id="fpVerDocs">
        <i data-lucide="folder-open"></i> Ver documentos da competência
      </button>
    </div>`;
}

function linhaHtml(item) {
  const f = item.funcionario || {};
  const fixo = item.modo === 'fixo';
  const fechada = trava();
  const ro = fechada ? 'disabled' : '';

  const adicionais = (item.adicionais || []).map(a => `
    <span class="fp-add-chip${Number(a.valor) < 0 ? ' fp-add-neg' : ''}">
      ${esc(a.descricao)} <strong>${formatarBRL(a.valor)}</strong>
      ${fechada ? '' : `<button data-fp-del-add="${a.id}" title="Remover">✕</button>`}
    </span>`).join('');

  return `
    <tr data-fp-item="${item.id}">
      <td class="fp-nome">
        <div>${esc(f.nome || '(sem nome)')}</div>
        <div class="fp-nome-sub">${esc(f.cargo || '—')}</div>
      </td>

      <td class="fp-num">
        ${fixo
          ? `<span class="fp-vazio">mensalista</span>`
          : `<div class="fp-horas-cel">
               <input type="text" class="fp-in fp-horas" value="${textoDeMinutos(item.minutos)}" placeholder="48:41" inputmode="numeric" ${ro}>
               ${docsDe(item.funcionario_id).folha_ponto
                 ? `<button class="fp-clipe" data-fp-ponto="${item.id}" title="Abrir a folha de ponto${
                      item.ponto_minutos && item.ponto_minutos !== item.minutos
                        ? ` (o PDF dizia ${textoDeMinutos(item.ponto_minutos)})` : ''}">
                      <i data-lucide="paperclip"></i></button>`
                 : ''}
             </div>`}
      </td>

      <td class="fp-num">
        ${fixo
          ? `<span class="fp-vazio">—</span>`
          : `<input type="text" class="fp-in fp-vh" value="${numeroBR(item.valor_hora)}" placeholder="17,00" inputmode="decimal" ${ro}>`}
      </td>

      <td class="fp-num">
        ${fixo
          ? `<input type="text" class="fp-in fp-base-in" value="${numeroBR(item.valor_base)}" placeholder="2.000,00" inputmode="decimal" ${ro}>`
          : `<span class="fp-base">${formatarBRL(item.valor_base)}</span>`}
      </td>

      <td class="fp-adicionais">
        ${adicionais || '<span class="fp-vazio">—</span>'}
        ${fechada ? '' : `<button class="fp-add-btn" data-fp-add="${item.id}"><i data-lucide="plus"></i> adicional</button>`}
      </td>

      <td class="fp-num"><strong class="fp-total">${formatarBRL(totalItem(item))}</strong></td>

      <td class="fp-pix">
        ${f.chave_pix
          ? `<button class="fp-pix-btn" data-fp-pix="${esc(f.chave_pix)}" title="Copiar a chave">
               ${esc(f.chave_pix)} <i data-lucide="copy"></i></button>`
          : '<span class="fp-vazio">—</span>'}
      </td>

      <td class="fp-acoes">
        ${(() => {
          const cc = docsDe(item.funcionario_id).contracheque;
          if (!cc) return '';
          const visto = cc.visualizado_pelo_colaborador ? ' · visualizado pelo colaborador' : '';
          return `<button class="fp-acao fp-acao-ok" data-fp-publicado="${item.id}"
                    title="Contracheque disponível${visto} — abrir">
                    <i data-lucide="file-check-2"></i></button>`;
        })()}
        <button class="fp-acao" data-fp-recibo="${item.id}" title="Contracheque desta pessoa">
          <i data-lucide="printer"></i></button>
        ${fechada ? '' : `
          <button class="fp-acao" data-fp-modo="${item.id}" title="${fixo ? 'Passar para pagamento por hora' : 'Passar para valor fixo'}">
            <i data-lucide="${fixo ? 'clock' : 'banknote'}"></i></button>
          <button class="fp-acao fp-acao-danger" data-fp-remover="${item.id}" title="Tirar da folha">
            <i data-lucide="x"></i></button>`}
      </td>
    </tr>`;
}

// ───────────────────────────────────────────────────────────
// EVENTOS
// ───────────────────────────────────────────────────────────
function ligar() {
  const cont = document.getElementById(_container);
  const ao = (id, evento, fn) => document.getElementById(id)?.addEventListener(evento, fn);

  ao('fpSeletor', 'change', (e) => abrirCompetencia(e.target.value, { criar: false }));
  ao('fpAbrir', 'click', () => {
    const mes = document.getElementById('fpMes')?.value;
    if (mes) abrirCompetencia(`${mes}-01`);
  });
  ao('fpFechar', 'click', concluir);
  // Reabrir está em dois lugares — na faixa de importação e no rodapé —
  // porque são os dois pontos em que a pessoa esbarra na folha fechada.
  cont.querySelectorAll('[data-fp-reabrir]').forEach(b => b.addEventListener('click', async () => {
    await comErro(async () => {
      _folha = await reabrirFolha(_folha.id);
      _folhas = await listarFolhas();
      mostrarToast('Folha reaberta');
      render();
    });
  }));
  ao('fpExcluir', 'click', apagarCompetencia);
  ao('fpAddFunc', 'change', async (e) => {
    const id = e.target.value;
    if (!id) return;
    const func = _equipe.find(f => f.id === id);
    await comErro(async () => {
      await adicionarItem(_nutriId, _folha.id, func);
      _itens = await carregarFolha(_folha.id);
      render();
    });
  });

  // Importação das folhas de ponto: clique ou arrastar-e-soltar.
  const zona = document.getElementById('fpZona');
  if (zona) {
    const input = document.getElementById('fpArquivos');
    document.getElementById('fpEscolher')?.addEventListener('click', () => input.click());
    input?.addEventListener('change', () => {
      importarPontos([...input.files]);
      input.value = '';        // permite reenviar o mesmo arquivo depois
    });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('on'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('on'));
    zona.addEventListener('drop', (e) => {
      e.preventDefault();
      zona.classList.remove('on');
      importarPontos([...(e.dataTransfer?.files || [])]);
    });
  }

  // Recalcula ao digitar; grava ao sair do campo.
  cont.querySelectorAll('.fp-horas, .fp-vh, .fp-base-in').forEach(el => {
    el.addEventListener('input', () => recalcularLinha(el.closest('tr')));
    el.addEventListener('change', () => gravarLinha(el.closest('tr')));
  });

  cont.querySelectorAll('[data-fp-add]').forEach(b =>
    b.addEventListener('click', () => abrirFormAdicional(b.dataset.fpAdd)));
  cont.querySelectorAll('[data-fp-del-add]').forEach(b =>
    b.addEventListener('click', () => removerAdicional(b.dataset.fpDelAdd)));
  cont.querySelectorAll('[data-fp-modo]').forEach(b =>
    b.addEventListener('click', () => trocarModo(b.dataset.fpModo)));
  cont.querySelectorAll('[data-fp-remover]').forEach(b =>
    b.addEventListener('click', () => removerLinha(b.dataset.fpRemover)));
  cont.querySelectorAll('[data-fp-ponto]').forEach(b =>
    b.addEventListener('click', () => abrirPontoGuardado(b.dataset.fpPonto)));
  cont.querySelectorAll('[data-fp-publicado]').forEach(b =>
    b.addEventListener('click', () => abrirContrachequePublicado(b.dataset.fpPublicado)));
  cont.querySelectorAll('[data-fp-pix]').forEach(b =>
    b.addEventListener('click', () => copiarParaClipboard(b.dataset.fpPix, '✓ Chave Pix copiada')));
  cont.querySelectorAll('[data-fp-recibo]').forEach(b =>
    b.addEventListener('click', () => abrirContracheques(b.dataset.fpRecibo)));
  ao('fpContracheques', 'click', () => abrirContracheques(null));
  ao('fpPendentes', 'click', async () => {
    const { abrirPendentes } = await import('./documentos-ui.js');
    await abrirPendentes({
      container: _container,
      equipe: _equipe,
      aoVoltar: async () => { await contarPendentesDaFila(); await carregarDocumentos(); render(); },
    });
  });
  ao('fpVerDocs', 'click', async () => {
    const { abrirDocumentosDaCompetencia } = await import('./documentos-ui.js');
    await abrirDocumentosDaCompetencia({
      container: _container,
      competencia: _folha.competencia,
      itens: _itens,
      aoVoltar: render,
    });
  });
}

/** Só a tela: o total da linha e o do mês acompanham a digitação. */
function recalcularLinha(tr) {
  const item = _itens.find(i => i.id === tr?.dataset.fpItem);
  if (!item) return;

  if (item.modo === 'fixo') {
    item.valor_base = valorDeTexto(tr.querySelector('.fp-base-in')?.value) ?? 0;
  } else {
    const min = minutosDeTexto(tr.querySelector('.fp-horas')?.value);
    const vh = valorDeTexto(tr.querySelector('.fp-vh')?.value);
    item.minutos = min;
    item.valor_hora = vh;
    item.valor_base = min !== null && vh !== null ? valorBase(min, vh) : 0;
    const baseEl = tr.querySelector('.fp-base');
    if (baseEl) baseEl.textContent = formatarBRL(item.valor_base);
  }

  const totalEl = tr.querySelector('.fp-total');
  if (totalEl) totalEl.textContent = formatarBRL(totalItem(item));
  atualizarTotais();
}

function atualizarTotais() {
  const geral = document.getElementById('fpTotalGeral');
  if (geral) geral.textContent = formatarBRL(totalFolha(_itens));
  const horas = document.getElementById('fpTotalHoras');
  if (horas) horas.textContent = `${_itens.length} pessoas · ${textoDeMinutos(totalMinutos(_itens)) || '0:00'} h`;
}

async function gravarLinha(tr) {
  const item = _itens.find(i => i.id === tr?.dataset.fpItem);
  if (!item || trava()) return;

  // Digitação inválida não vira zero em silêncio. Vale para os TRÊS campos:
  // um valor/hora ilegível zerava o pagamento da pessoa sem dizer nada, e o
  // erro só apareceria no dia do Pix.
  const invalido = (seletor, texto, ler) => {
    const txt = tr.querySelector(seletor)?.value?.trim();
    if (txt && ler(txt) === null) { mostrarErro(texto.replace('%s', txt)); return true; }
    return false;
  };

  if (item.modo === 'horas') {
    if (invalido('.fp-horas', '"%s" não é um total de horas. Use h:mm, como 48:41.', minutosDeTexto)) return;
    if (invalido('.fp-vh', '"%s" não é um valor por hora. Use vírgula, como 13,00.', valorDeTexto)) return;
  } else if (invalido('.fp-base-in', '"%s" não é um valor. Use vírgula, como 1.800,00.', valorDeTexto)) {
    return;
  }

  await comErro(async () => {
    await salvarItem(item.id, {
      modo: item.modo,
      minutos: item.modo === 'horas' ? item.minutos : null,
      valor_hora: item.modo === 'horas' ? item.valor_hora : null,
      valor_base: item.valor_base ?? 0,
    });
    tr.classList.add('fp-salvo');
    setTimeout(() => tr.classList.remove('fp-salvo'), 900);
  });
}

/**
 * Caixa de cadastro do lançamento, sobre a própria tela.
 *
 * Antes o formulário nascia dentro da célula da tabela: a coluna é estreita,
 * os campos se empilhavam e a linha inteira se deformava enquanto se digitava.
 * Numa caixa centrada os campos cabem lado a lado, a folha continua visível
 * atrás e o foco fica onde deveria.
 */
function abrirFormAdicional(itemId) {
  if (document.querySelector('.fp-modal')) return;      // uma caixa por vez
  const item = _itens.find(i => i.id === itemId);
  if (!item) return;

  const fundo = document.createElement('div');
  fundo.className = 'fp-modal';
  fundo.innerHTML = `
    <div class="fp-modal-caixa" role="dialog" aria-modal="true" aria-labelledby="fpModalTit">
      <div class="fp-modal-topo">
        <div>
          <div class="fp-modal-tit" id="fpModalTit">Novo lançamento</div>
          <div class="fp-modal-sub">${esc(item.funcionario?.nome || '')} · ${esc(nomeCompetencia(_folha?.competencia))}</div>
        </div>
        <button class="fp-modal-x" data-fp-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>

      <div class="fp-modal-corpo">
        <div class="fp-modal-linha">
          <div class="fp-campo fp-campo-largo">
            <label for="fpAddDesc">Descrição</label>
            <div class="fp-combo">
              <input type="text" id="fpAddDesc" class="np-input fp-add-desc"
                     role="combobox" aria-expanded="false" aria-controls="fpAddLista"
                     aria-autocomplete="list" autocomplete="off"
                     placeholder="Escolha na lista ou escreva">
              <button type="button" class="fp-combo-seta" tabindex="-1" aria-label="Ver opções">
                <i data-lucide="chevron-down"></i>
              </button>
              <ul class="fp-combo-lista" id="fpAddLista" role="listbox" hidden></ul>
            </div>
          </div>
          <div class="fp-campo">
            <label for="fpAddVal">Valor</label>
            <input type="text" id="fpAddVal" class="np-input fp-add-val" placeholder="580,00" inputmode="decimal">
          </div>
        </div>

        <div class="fp-add-dica">Valor negativo é desconto — ex.: <strong>-150,00</strong></div>
      </div>

      <div class="fp-modal-acoes">
        <button class="btn" data-fp-fechar>Cancelar</button>
        <button class="btn primary" id="fpAddOk"><i data-lucide="plus"></i> Adicionar</button>
      </div>
    </div>
  `;
  document.body.appendChild(fundo);

  const desc = fundo.querySelector('.fp-add-desc');
  const val = fundo.querySelector('.fp-add-val');
  desc.focus();

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclado);
    fundo.remove();
  };
  function aoTeclado(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); }
  }
  document.addEventListener('keydown', aoTeclado);

  const salvar = async () => {
    const descricao = desc.value.trim();
    const valor = valorDeTexto(val.value);
    if (!descricao) { mostrarErro('Descreva o adicional — é ele que explica o valor.'); desc.focus(); return; }
    if (valor === null) { mostrarErro('Informe o valor do adicional (use vírgula: 580,00).'); val.focus(); return; }

    fechar();
    await comErro(async () => {
      await adicionarAdicional(_nutriId, itemId, {
        descricao, valor, ordem: (item.adicionais?.length || 0),
      });
      _itens = await carregarFolha(_folha.id);
      render();
    });
  };

  // Escolher na lista já joga o cursor no valor: de um mês para o outro o que
  // muda é o valor, não o nome do lançamento.
  const combo = montarCombo(fundo.querySelector('.fp-combo'), ADICIONAIS_SUGERIDOS, () => val.focus());

  fundo.querySelectorAll('[data-fp-fechar]').forEach(b => b.addEventListener('click', fechar));
  fundo.querySelector('#fpAddOk').addEventListener('click', salvar);
  // Só o clique no fundo fecha; dentro da caixa, não.
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });

  desc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !combo.aberta()) { e.preventDefault(); salvar(); }
  });
  val.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); salvar(); }
  });
}

/**
 * Combobox de verdade: abre ao focar, filtra enquanto digita, anda com as
 * setas e aceita texto que não está na lista.
 *
 * A nativa (`<datalist>`) não serve aqui: em vários navegadores ela só abre
 * pela setinha minúscula, não responde às setas do teclado e some assim que o
 * texto digitado deixa de casar — logo quando o usuário mais precisa ver que
 * pode escrever o que quiser.
 *
 * A lista é SUGESTÃO. Nada impede de digitar uma descrição nova: o histórico
 * tem "10% de bônus", "FERIADO", "PAGAMENTO DE FÉRIAS", e a descrição é o que
 * explica o valor um ano depois.
 *
 * @returns {{aberta: () => boolean}} para o Enter saber se está escolhendo na
 *          lista ou confirmando o formulário.
 */
function montarCombo(raiz, opcoes, aoEscolher) {
  const campo = raiz.querySelector('input');
  const lista = raiz.querySelector('.fp-combo-lista');
  const seta = raiz.querySelector('.fp-combo-seta');
  let ativo = -1;
  let visiveis = [];

  const aberta = () => !lista.hidden;

  function desenhar() {
    const termo = normalizar(campo.value);
    visiveis = termo ? opcoes.filter(o => normalizar(o).includes(termo)) : [...opcoes];
    if (ativo >= visiveis.length) ativo = visiveis.length - 1;

    lista.innerHTML = visiveis.length
      ? visiveis.map((o, i) => `
          <li role="option" id="fpOpt${i}" data-i="${i}"
              class="fp-combo-item${i === ativo ? ' on' : ''}"
              aria-selected="${i === ativo}">${esc(o)}</li>`).join('')
      : `<li class="fp-combo-vazio">Nenhuma sugestão — pode escrever a sua</li>`;

    campo.setAttribute('aria-activedescendant', ativo >= 0 ? `fpOpt${ativo}` : '');

    lista.querySelectorAll('[data-i]').forEach(li => {
      // mousedown, não click: o blur do campo chegaria antes do click e a
      // lista já teria fechado.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); escolher(Number(li.dataset.i)); });
      li.addEventListener('mouseenter', () => { ativo = Number(li.dataset.i); marcar(); });
    });
  }

  function marcar() {
    lista.querySelectorAll('[data-i]').forEach(li => {
      const eu = Number(li.dataset.i) === ativo;
      li.classList.toggle('on', eu);
      li.setAttribute('aria-selected', String(eu));
      if (eu) li.scrollIntoView({ block: 'nearest' });
    });
    campo.setAttribute('aria-activedescendant', ativo >= 0 ? `fpOpt${ativo}` : '');
  }

  function abrir() {
    if (aberta()) return;
    desenhar();
    lista.hidden = false;
    raiz.classList.add('aberta');
    campo.setAttribute('aria-expanded', 'true');
  }

  function fechar() {
    if (!aberta()) return;
    lista.hidden = true;
    raiz.classList.remove('aberta');
    campo.setAttribute('aria-expanded', 'false');
    ativo = -1;
  }

  function escolher(i) {
    const valor = visiveis[i];
    if (valor === undefined) return;
    campo.value = valor;
    fechar();
    aoEscolher?.(valor);
  }

  campo.addEventListener('focus', abrir);
  campo.addEventListener('click', abrir);
  campo.addEventListener('blur', fechar);
  campo.addEventListener('input', () => { ativo = -1; abrir(); desenhar(); });
  seta.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (aberta()) fechar(); else { campo.focus(); abrir(); }
  });

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!aberta()) { abrir(); return; }
      ativo = Math.min(ativo + 1, visiveis.length - 1);
      marcar();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberta()) return;
      ativo = Math.max(ativo - 1, 0);
      marcar();
    } else if (e.key === 'Enter') {
      if (aberta() && ativo >= 0) { e.preventDefault(); escolher(ativo); }
    } else if (e.key === 'Escape') {
      // Primeiro Esc fecha a lista; o segundo é que fecha a caixa.
      if (aberta()) { e.preventDefault(); e.stopPropagation(); fechar(); }
    } else if (e.key === 'Tab') {
      fechar();
    }
  });

  return { aberta };
}

async function removerAdicional(id) {
  await comErro(async () => {
    await excluirAdicional(id);
    _itens = await carregarFolha(_folha.id);
    render();
  });
}

async function trocarModo(itemId) {
  const item = _itens.find(i => i.id === itemId);
  if (!item) return;
  const novo = item.modo === 'fixo' ? 'horas' : 'fixo';

  await comErro(async () => {
    await salvarItem(item.id, {
      modo: novo,
      minutos: novo === 'horas' ? item.minutos : null,
      valor_hora: novo === 'horas' ? (item.valor_hora ?? item.funcionario?.valor_hora ?? null) : null,
      valor_base: novo === 'fixo' ? (item.valor_base || 0) : 0,
    });
    _itens = await carregarFolha(_folha.id);
    render();
  });
}

async function removerLinha(itemId) {
  const item = _itens.find(i => i.id === itemId);
  if (!item) return;
  if (!(await confirmar({
    titulo: 'Tirar da folha',
    mensagem: `Remover "${item.funcionario?.nome || 'esta linha'}" da folha de ${nomeCompetencia(_folha.competencia)}?`,
    textoOk: 'Remover', perigo: true,
  }))) return;

  await comErro(async () => {
    await excluirItem(itemId);
    _itens = await carregarFolha(_folha.id);
    render();
  });
}

// ───────────────────────────────────────────────────────────
// CONTRACHEQUES
// ───────────────────────────────────────────────────────────
// Vira uma tela de conferência antes de virar papel: quem imprime sem ver o
// que vai sair descobre o erro depois de seis vias impressas.
//
// Linha com total zerado fica de fora quando se imprime a folha inteira —
// recibo de R$ 0,00 não é documento, é confusão. Pedindo o recibo daquela
// pessoa (o ícone da linha), ele sai assim mesmo.

async function abrirContracheques(itemId) {
  const alvos = itemId
    ? _itens.filter(i => i.id === itemId)
    : _itens.filter(i => totalItem(i) !== 0);

  if (!alvos.length) {
    mostrarErro('Nenhuma linha com valor para gerar contracheque.');
    return;
  }

  const { htmlContracheques } = await import('./contracheque.js');
  const cont = document.getElementById(_container);

  cont.innerHTML = `
    <div class="cc-barra">
      <button class="btn" id="ccVoltar"><i data-lucide="arrow-left"></i> Voltar para a folha</button>
      <div class="cc-barra-info">
        ${alvos.length} ${alvos.length === 1 ? 'contracheque' : 'contracheques'} ·
        ${esc(nomeCompetencia(_folha?.competencia))}
      </div>
      <button class="btn primary" id="ccImprimir"><i data-lucide="printer"></i> Imprimir</button>
    </div>
    <div class="cc-folhas" id="ccFolhas">
      ${htmlContracheques(alvos, _folha, { nomeCompetencia, formatarData })}
    </div>
  `;

  document.getElementById('ccVoltar').addEventListener('click', render);
  document.getElementById('ccImprimir').addEventListener('click', () => window.print());
  garantirPaginaA4();
}

// ── Papel A4 só para o contracheque ────────────────────────
// `@page` é regra do DOCUMENTO: não existe seletor que a limite a uma tela.
// Escrita direto no CSS, ela mudaria também a impressão do relatório do
// cliente, que já existe e não pediu isso.
//
// A saída é ligá-la no momento da impressão e desligá-la depois. Os eventos
// beforeprint/afterprint cobrem tanto o botão quanto o Ctrl+P do navegador, e
// a regra só entra se o contracheque estiver mesmo na tela.
const ESTILO_A4 = 'ccPaginaA4';
let _a4Ligado = false;

function garantirPaginaA4() {
  if (_a4Ligado) return;
  _a4Ligado = true;
  window.addEventListener('beforeprint', () => {
    if (document.querySelector('.cc-folhas')) aplicarA4();
    else removerA4();
  });
  window.addEventListener('afterprint', removerA4);
}

function aplicarA4() {
  if (document.getElementById(ESTILO_A4)) return;
  const estilo = document.createElement('style');
  estilo.id = ESTILO_A4;
  estilo.textContent = '@page { size: A4 portrait; margin: 14mm 15mm; }';
  document.head.appendChild(estilo);
}

function removerA4() {
  document.getElementById(ESTILO_A4)?.remove();
}

// ───────────────────────────────────────────────────────────
// IMPORTAÇÃO DAS FOLHAS DE PONTO
// ───────────────────────────────────────────────────────────
// Lê os PDFs, mostra o que encontrou e SÓ ENTÃO preenche. Uma importação que
// escreve direto obriga a conferir seis linhas depois do fato; assim a
// conferência acontece antes, com o arquivo de origem ao lado do valor.

async function importarPontos(arquivos) {
  const pdfs = arquivos.filter(a => /\.pdf$/i.test(a.name || ''));
  if (!pdfs.length) return;
  if (trava()) { mostrarErro('Esta folha está fechada. Reabra antes de importar.'); return; }

  const zona = document.getElementById('fpZona');
  if (zona) zona.classList.add('lendo');

  const { lerPontoPdf, traduzirErroPonto } = await import('./ponto-pdf.js');
  const lidos = [];
  for (const arquivo of pdfs) {
    try {
      const ponto = await lerPontoPdf(arquivo);
      lidos.push({ arquivo: arquivo.name, ficheiro: arquivo, ponto, item: casarComItem(ponto) });
    } catch (e) {
      lidos.push({ arquivo: arquivo.name, erro: traduzirErroPonto(e.message) });
    }
  }
  if (zona) zona.classList.remove('lendo');

  const aplicaveis = lidos.filter(l => l.item && l.item.modo === 'horas');
  const orfaos = lidos.filter(l => l.ponto && !l.item);
  const mensagem = resumoDaImportacao(lidos);

  // O que não casou vai para a sala de espera ANTES de qualquer confirmação:
  // antes disso o arquivo era só reportado na tela e descartado, e quem
  // importasse o ponto de alguém fora do cadastro perdia o arquivo.
  const guardados = await guardarOrfaos(orfaos);

  if (!aplicaveis.length) {
    mostrarErro(mensagem || 'Nenhum ponto pôde ser aproveitado.');
    if (guardados) { await carregarDocumentos(); render(); }
    return;
  }
  if (!(await confirmar({
    titulo: `Preencher ${aplicaveis.length} ${aplicaveis.length === 1 ? 'linha' : 'linhas'}`,
    mensagem,
    textoOk: 'Preencher horas',
  }))) return;

  const { guardarPonto } = await import('./ponto-arquivo.js');
  let gravadas = 0;
  let arquivados = 0;

  for (const { ponto, item, ficheiro } of aplicaveis) {
    const vh = item.valor_hora ?? item.funcionario?.valor_hora ?? null;

    // O PDF é guardado ANTES, mas nunca impede o preenchimento: se o Storage
    // falhar, as horas entram do mesmo jeito e o documento fica faltando.
    // Perder o arquivo é ruim; perder a digitação do mês por causa dele, pior.
    try {
      await guardarPonto(ficheiro, {
        nutriId: _nutriId,
        funcionarioId: item.funcionario_id,
        competencia: _folha.competencia,
        periodo: ponto.periodo,
      });
      arquivados++;
    } catch (e) { /* segue sem arquivo */ }

    try {
      // Os campos de APURAÇÃO continuam na linha da folha: são o que o ponto
      // dizia, e é com eles que se explica um pagamento diferente do apurado.
      // O ponteiro do arquivo saiu daqui — agora mora em colaborador_documentos.
      await salvarItem(item.id, {
        minutos: ponto.minutosDiurnas,
        valor_hora: vh,
        valor_base: vh === null ? 0 : valorBase(ponto.minutosDiurnas, vh),
        ponto_minutos: ponto.minutosDiurnas,
        ponto_noturnas: ponto.minutosNoturnas,
        ponto_inicio: dataIso(ponto.periodo?.inicio),
        ponto_fim: dataIso(ponto.periodo?.fim),
      });
      gravadas++;
    } catch (e) {
      mostrarErro(`${item.funcionario?.nome}: ${traduzirErroFolha(e.message)}`);
    }
  }

  if (gravadas && arquivados < gravadas) {
    mostrarErro(`${gravadas - arquivados} PDF(s) não puderam ser guardados. As horas entraram.`);
  }

  _itens = await carregarFolha(_folha.id);
  await carregarDocumentos();
  render();
  mostrarToast(`✓ ${gravadas} ${gravadas === 1 ? 'linha preenchida' : 'linhas preenchidas'}`);
}

/**
 * As primeiras linhas do resumo: de que mês é o ponto e para qual folha ele
 * está indo.
 *
 * O ponto de JULHO é pago na folha de AGOSTO — é a convenção da planilha, onde
 * a competência é o mês em que o dinheiro sai. Como as duas datas nunca batem,
 * conferir mês contra mês só produziria alarme falso; o que vale avisar é
 * quando a folha aberta não é nem o mês do ponto nem o seguinte, porque aí é
 * provável que seja a folha errada.
 */
function cabecalhoDoPeriodo(lidos) {
  const periodos = new Set(lidos.filter(l => l.ponto?.periodo)
    .map(l => `${l.ponto.periodo.inicio} a ${l.ponto.periodo.fim}`));

  if (periodos.size > 1) return ['Atenção: os arquivos são de períodos diferentes.'];
  if (!periodos.size) return [];

  const linhas = [`Ponto de ${[...periodos][0]}`];

  const doPonto = lidos.find(l => l.ponto?.competencia)?.ponto.competencia;
  const aberta = _folha?.competencia;
  if (!doPonto || !aberta) return linhas;

  linhas.push(`Preenchendo a folha de ${nomeCompetencia(aberta)}.`);
  if (aberta !== doPonto && aberta !== proximaCompetencia(doPonto)) {
    linhas.push(
      `⚠ O ponto é de ${nomeCompetencia(doPonto)} — normalmente pago na folha`
      + ` de ${nomeCompetencia(proximaCompetencia(doPonto))}. Confira o mês aberto.`);
  }
  return linhas;
}

const abrirPontoGuardado = (itemId) => abrirDocumentoDaLinha(itemId, 'folha_ponto');
const abrirContrachequePublicado = (itemId) => abrirDocumentoDaLinha(itemId, 'contracheque');

/** Abre o documento guardado. O bucket é privado: a URL é assinada e expira. */
async function abrirDocumentoDaLinha(itemId, tipo) {
  const item = _itens.find(i => i.id === itemId);
  const doc = item && docsDe(item.funcionario_id)[tipo];
  if (!doc) return;

  const { urlAssinada, traduzirErroDocumento } = await import('./documentos.js');
  try {
    const url = await urlAssinada(doc.caminho_storage);
    if (url) window.open(url, '_blank', 'noopener');
    else mostrarErro('Documento indisponível no momento.');
  } catch (e) {
    mostrarErro(traduzirErroDocumento(e.message));
  }
}

/**
 * Guarda os PDFs que não casaram com ninguém, com a razão e a melhor sugestão.
 * Devolve quantos foram para a fila.
 */
async function guardarOrfaos(orfaos) {
  if (!orfaos.length) return 0;
  const { guardarPendente } = await import('./documentos.js');

  let guardados = 0;
  for (const o of orfaos) {
    try {
      const { duplicado } = await guardarPendente({
        nutriId: _nutriId,
        competencia: _folha.competencia,
        conteudo: o.ficheiro,
        nomeArquivo: o.arquivo,
        cpfLido: o.ponto.cpf,
        nomeLido: o.ponto.nome,
        motivo: o.ponto.cpf
          ? 'CPF do relatório não corresponde a nenhum colaborador desta folha'
          : 'O relatório não trouxe CPF e o nome não bateu com ninguém',
        sugestaoId: sugerirColaborador(o.ponto)?.id || null,
        metadata: { minutos_diurnas: o.ponto.minutosDiurnas, periodo: o.ponto.periodo },
      });
      if (!duplicado) guardados++;
    } catch (e) { /* a fila é conveniência: não trava a importação */ }
  }

  if (guardados) {
    mostrarToast(`${guardados} ${guardados === 1 ? 'arquivo foi' : 'arquivos foram'} para pendentes de vínculo`);
  }
  return guardados;
}

/**
 * O colaborador mais provável para um ponto órfão. Só sugere quando o nome bate
 * inteiro — sugestão fraca num holerite é pior que nenhuma: quem confirma no
 * automático acaba mandando o documento de uma pessoa para outra.
 */
function sugerirColaborador(ponto) {
  const alvo = normalizar(ponto.nome);
  if (!alvo) return null;
  return _equipe.find(f => normalizar(f.nome) === alvo) || null;
}

/** Casa o PDF com a linha da folha: CPF primeiro, nome como segunda tentativa. */
function casarComItem(ponto) {
  if (ponto.cpf) {
    const porCpf = _itens.find(i => i.funcionario?.cpf === ponto.cpf);
    if (porCpf) return porCpf;
  }
  const alvo = normalizar(ponto.nome);
  if (!alvo) return null;
  return _itens.find(i => normalizar(i.funcionario?.nome) === alvo) || null;
}

// Faixa dos acentos combinantes do Unicode. Montada por código de propósito:
// escrita literal na expressão, ela vira um caractere invisível no arquivo —
// que qualquer editor pode normalizar sem ninguém notar, quebrando o casamento
// de nomes sem deixar rastro no diff.
const ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Sem acento, sem caixa e sem espaço dobrado — nome vindo de PDF varia. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(ACENTOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function resumoDaImportacao(lidos) {
  const linhas = [];
  linhas.push(...cabecalhoDoPeriodo(lidos), '');

  for (const l of lidos) {
    if (l.erro) { linhas.push(`✕ ${l.arquivo}: ${l.erro}`); continue; }
    const nome = l.ponto.nome || l.arquivo;
    if (!l.item) {
      linhas.push(`✕ ${nome}: não está nesta folha — vai para pendentes de vínculo`);
      continue;
    }
    if (l.item.modo !== 'horas') { linhas.push(`✕ ${nome}: está como mensalista`); continue; }

    const noturnas = l.ponto.minutosNoturnas
      ? ` (+ ${textoDeMinutos(l.ponto.minutosNoturnas)} noturnas, que não entram)` : '';
    const antes = l.item.minutos ? ` — substitui ${textoDeMinutos(l.item.minutos)}` : '';
    linhas.push(`${nome}: ${textoDeMinutos(l.ponto.minutosDiurnas)}${noturnas}${antes}`);
  }
  return linhas.join('\n');
}

async function concluir() {
  const data = document.getElementById('fpDataPag')?.value || null;

  // Relê do banco antes de fechar. A tela pode estar velha — outra aba aberta,
  // um campo salvo e não redesenhado — e fechar publicaria contracheques com
  // números que já não valem. É o último momento em que dá para conferir.
  try {
    _itens = await carregarFolha(_folha.id);
  } catch (e) {
    mostrarErro(traduzirErroFolha(e.message));
    return;
  }

  await carregarDocumentos();

  const total = totalFolha(_itens);
  const publicaveis = _itens.filter(i => totalItem(i) !== 0);
  const semNada = _itens.length - publicaveis.length;
  const r = resumoDocumentos(_itens, _docs);
  const pendentes = await contarPendentesDaFila();

  // A revisão mostra o que está incompleto ANTES de fechar. Descobrir depois
  // que faltou a folha de ponto de alguém custa reabrir, importar e fechar de
  // novo — e o colaborador já viu a competência sem o documento.
  const revisao = [
    `${_itens.length} ${_itens.length === 1 ? 'colaborador' : 'colaboradores'} · ${formatarBRL(total)}`,
    `${publicaveis.length} ${publicaveis.length === 1 ? 'contracheque será publicado' : 'contracheques serão publicados'}`,
    `${r.pontos} de ${r.pessoas} com folha de ponto vinculada`,
  ];
  if (semNada) revisao.push(`${semNada} com total zerado — não recebe contracheque`);
  if (r.semPonto.length) revisao.push(`Sem folha de ponto: ${r.semPonto.join(', ')}`);
  if (pendentes) revisao.push(`${pendentes} ${pendentes === 1 ? 'arquivo aguarda' : 'arquivos aguardam'} vínculo`);

  const incompleta = r.semPonto.length > 0 || pendentes > 0;

  if (!(await confirmar({
    titulo: incompleta ? 'Fechar com pendências?' : 'Fechar a folha',
    mensagem: `${nomeCompetencia(_folha.competencia)}\n\n${revisao.join('\n')}`
      + '\n\nA folha fica só de leitura. Dá para reabrir depois.',
    textoOk: incompleta ? 'Fechar mesmo assim' : 'Fechar folha',
    perigo: incompleta,
  }))) return;

  // A publicação vem ANTES do fechamento: folha fechada não aceita mais
  // update em folha_itens — a trava está no banco, não só na tela.
  const publicados = await publicarContracheques(publicaveis, { ...(_folha || {}), data_pagamento: data });

  await comErro(async () => {
    _folha = await fecharFolha(_folha.id, data);
    _folhas = await listarFolhas();
    _itens = await carregarFolha(_folha.id);
    await carregarDocumentos();
    mostrarToast(`✓ Folha fechada · ${publicados} ${publicados === 1 ? 'contracheque publicado' : 'contracheques publicados'}`);
    render();
  });
}

/**
 * Publica o contracheque de cada linha e guarda o caminho.
 *
 * Falha em publicar NÃO impede o fechamento: a folha fechada é o registro do
 * pagamento, e travá-la porque o Storage caiu deixaria o mês em aberto por um
 * motivo que nada tem a ver com o dinheiro. O que não publicou fica sem
 * `contracheque_arquivo` e pode ser refeito reabrindo e fechando de novo.
 */
async function publicarContracheques(itens, folha) {
  if (!itens.length) return 0;

  const { publicarContracheque, estiloDoDocumento, traduzirErroContracheque } =
    await import('./contracheque-arquivo.js');

  let css = '';
  try {
    css = await estiloDoDocumento();
  } catch (e) {
    mostrarErro(traduzirErroContracheque(e.message));
    return 0;
  }

  let publicados = 0;
  const falhas = [];
  for (const item of itens) {
    try {
      await publicarContracheque(item, folha, {
        nutriId: _nutriId, css, nomeCompetencia, formatarData, folhaId: _folha?.id,
      });
      publicados++;
    } catch (e) {
      falhas.push(`${item.funcionario?.nome}: ${traduzirErroContracheque(e.message)}`);
    }
  }

  if (falhas.length) mostrarErro(`Não publiquei ${falhas.length}: ${falhas[0]}`);
  return publicados;
}

async function apagarCompetencia() {
  if (!_folha) return;
  if (!(await confirmar({
    titulo: 'Excluir a competência',
    mensagem: `Apagar a folha de ${nomeCompetencia(_folha.competencia)} inteira, com todas as linhas e adicionais?`,
    textoOk: 'Excluir', perigo: true,
  }))) return;

  await comErro(async () => {
    await excluirFolha(_folha.id);
    mostrarToast('Competência excluída');
    _folhas = await listarFolhas();
    const proxima = _folhas[0]?.competencia;
    if (proxima) await abrirCompetencia(proxima, { criar: false });
    else await abrirCompetencia(competenciaAtual());
  });
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
async function comErro(fn) {
  try { await fn(); }
  catch (e) { mostrarErro(traduzirErroFolha(e.message)); }
}

function numeroBR(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

/** '31/07/2026' → '2026-07-31'. O banco guarda date, o PDF fala em pt-BR. */
function dataIso(dataBr) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dataBr || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
