// ═══════════════════════════════════════════════════════════
// EQUIPE · PONTO — o que foi importado, por competência
// ═══════════════════════════════════════════════════════════
// Tela de consulta, não de edição. Mostra, para o mês escolhido: quem já teve
// a folha de ponto importada, quantas horas o PDF dizia, quantas horas estão
// valendo na folha, e quem ainda não tem arquivo nenhum.
//
// A IMPORTAÇÃO EM SI CONTINUA NA FOLHA, e de propósito: ler o PDF é o que
// preenche as horas da linha. Separar o leitor da linha que ele preenche
// obrigaria a pessoa a importar numa tela e conferir em outra. Aqui fica o
// arquivo do mês; lá fica o ato de lançar.
//
// Nada nesta tela grava: abre documento, mostra divergência e leva para o
// lugar certo.

import {
  listarFolhas, carregarFolha, nomeCompetencia, textoDeMinutos, competenciaAtual,
} from './folha.js';
import { listarFuncionarios } from './funcionarios.js';
import { competenciaAtiva, definirCompetencia } from './competencia.js';
import { formatarData, mostrarErro } from './utils.js';

let _container = null;
let _irParaFolha = null;

let _folhas = [];        // competências existentes
let _competencia = null;
let _itens = [];         // linhas da folha da competência
let _docs = new Map();   // colaborador_id -> { folha_ponto, contracheque }
let _pendentes = 0;
let _equipe = [];

// ───────────────────────────────────────────────────────────
export async function initPontoUI(containerId, opcoes = {}) {
  _container = containerId;
  _irParaFolha = opcoes.irParaFolha || null;

  const cont = document.getElementById(containerId);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Procurando as folhas de ponto...</div>`;

  try {
    [_folhas, _equipe] = await Promise.all([
      listarFolhas(),
      listarFuncionarios({ incluirInativos: false, limite: 200 }),
    ]);
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  // A competência da sessão manda, se ela existir como folha. Quem estava
  // conferindo agosto na folha continua em agosto aqui.
  const daSessao = competenciaAtiva();
  _competencia = (daSessao && _folhas.some(f => f.competencia === daSessao) ? daSessao : null)
    || _folhas[0]?.competencia
    || competenciaAtual();
  await carregar();
}

/** Lê o mês escolhido: linhas da folha (para as horas) e documentos guardados. */
async function carregar() {
  const cont = document.getElementById(_container);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando ${esc(nomeCompetencia(_competencia))}...</div>`;

  definirCompetencia(_competencia);

  const folha = _folhas.find(f => f.competencia === _competencia) || null;

  try {
    _itens = folha ? await carregarFolha(folha.id) : [];
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  // Documentos e fila de pendentes falham em silêncio: sem o repositório
  // instalado a tela ainda serve para conferir as horas.
  try {
    const { mapaDaCompetencia, contarPendentes } = await import('./documentos.js');
    [_docs, _pendentes] = await Promise.all([
      mapaDaCompetencia(_competencia),
      contarPendentes(),
    ]);
  } catch (e) {
    _docs = new Map();
    _pendentes = 0;
  }

  render();
}

// ───────────────────────────────────────────────────────────
function render() {
  const cont = document.getElementById(_container);
  if (!cont) return;

  const linhas = montarLinhas();
  const comArquivo = linhas.filter(l => l.doc).length;
  const divergentes = linhas.filter(l => l.divergencia).length;

  cont.innerHTML = `
    <div class="fp-barra">
      <div class="fp-competencia">
        <label for="ptComp">Competência</label>
        <select class="fp-select" id="ptComp">
          ${competenciasHtml()}
        </select>
      </div>
      <div class="pt-acoes">
        <button class="btn" id="ptImportar">
          <i data-lucide="upload"></i> Importar na folha de pagamento
        </button>
        ${_pendentes > 0 ? `
          <button class="btn pt-pendentes" id="ptPendentes">
            <i data-lucide="inbox"></i> ${_pendentes} ${_pendentes === 1 ? 'arquivo aguardando vínculo' : 'arquivos aguardando vínculo'}
          </button>` : ''}
      </div>
    </div>

    <div class="rs-tiles pt-tiles">
      ${tile('Colaboradores no mês', String(linhas.length),
             `${comArquivo} com folha de ponto guardada`)}
      ${tile('Sem arquivo', String(linhas.length - comArquivo),
             linhas.length - comArquivo === 0 ? 'todo mundo entregou' : 'ainda não importados')}
      ${tile('Horas lançadas', totalHoras(linhas),
             'soma das horas que valem na folha')}
      ${tile('Divergências', String(divergentes),
             divergentes === 0 ? 'PDF e folha batem' : 'o PDF diz outra coisa')}
    </div>

    ${vazioHtml(linhas, comArquivo)}

    ${linhas.length ? tabelaHtml(linhas) : ''}
  `;

  ligar();
}

/**
 * O aviso de "não tem nada aqui" e a saída dele.
 *
 * A IMPORTAÇÃO NÃO MORA NESTA ABA, e a tela diz isso com todas as letras. Ler
 * o PDF é o que preenche as horas da linha da folha; separar o leitor da linha
 * obrigaria a importar numa tela e conferir na outra. O que esta aba faz é
 * levar até lá — no mesmo mês, com a zona de arquivos em evidência.
 */
function vazioHtml(linhas, comArquivo) {
  if (linhas.length && comArquivo) return '';

  const semFolha = !linhas.length;
  return `
    <div class="pt-vazio">
      <div class="pt-vazio-icone"><i data-lucide="file-clock"></i></div>
      <div class="pt-vazio-txt">
        <strong>${semFolha
          ? `A folha de ${esc(nomeCompetencia(_competencia))} ainda não foi aberta.`
          : 'Nenhuma folha de ponto foi importada para esta competência.'}</strong>
        <span>${semFolha
          ? 'Abrir a folha do mês traz a equipe toda para dentro dela; a importação do ponto acontece lá.'
          : 'A leitura do PDF preenche as horas de cada linha, e por isso ela acontece dentro da folha.'}</span>
      </div>
      <button class="btn primary" id="ptImportarVazio">
        <i data-lucide="upload"></i> Importar na folha de pagamento
      </button>
    </div>`;
}

function competenciasHtml() {
  const lista = _folhas.map(f => f.competencia);
  if (!lista.includes(_competencia)) lista.unshift(_competencia);
  return lista.map(c => `
    <option value="${esc(c)}"${c === _competencia ? ' selected' : ''}>${esc(nomeCompetencia(c))}</option>`).join('');
}

/**
 * Uma linha por pessoa da folha do mês. Quem é mensalista não tem ponto a
 * conferir — a coluna diz isso em vez de mostrar zero.
 */
function montarLinhas() {
  return _itens.map(item => {
    const f = item.funcionario || {};
    const doc = _docs.get(item.funcionario_id)?.folha_ponto || null;
    const fixo = item.modo === 'fixo';
    const lidoPdf = item.ponto_minutos ?? null;
    const naFolha = item.minutos ?? null;
    return {
      id: item.id,
      nome: f.nome || '(sem nome)',
      cargo: f.cargo || '—',
      fixo,
      doc,
      lidoPdf,
      naFolha,
      divergencia: !fixo && lidoPdf !== null && naFolha !== null && lidoPdf !== naFolha,
    };
  });
}

function totalHoras(linhas) {
  const min = linhas.reduce((s, l) => s + (Number(l.naFolha) || 0), 0);
  return `${Math.floor(min / 60)}h`;
}

function tabelaHtml(linhas) {
  return `
    <div class="fp-tabela-wrap">
      <table class="fp-tabela pt-tabela">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Folha de ponto</th>
            <th class="fp-num">Horas no PDF</th>
            <th class="fp-num">Horas na folha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map(l => `
            <tr>
              <td class="fp-nome" data-rot="Colaborador">
                <div>${esc(l.nome)}</div>
                <div class="fp-nome-sub">${esc(l.cargo)}</div>
              </td>

              <td data-rot="Folha de ponto">
                ${l.fixo
                  ? '<span class="fp-vazio">mensalista</span>'
                  : l.doc
                    ? `<button class="pt-arquivo" data-pt-caminho="${esc(l.doc.caminho_storage)}">
                         <i data-lucide="paperclip"></i>
                         <span>${esc(l.doc.nome_arquivo || 'folha de ponto')}</span>
                       </button>
                       ${l.doc.disponibilizado_em
                          ? `<div class="pt-arquivo-sub">guardado em ${esc(formatarData(l.doc.disponibilizado_em))}</div>`
                          : ''}`
                    : '<span class="pt-falta"><i data-lucide="circle-alert"></i> sem arquivo</span>'}
              </td>

              <td class="fp-num" data-rot="Horas no PDF">
                ${l.fixo ? '<span class="fp-vazio">—</span>'
                         : (l.lidoPdf === null ? '<span class="fp-vazio">—</span>' : esc(textoDeMinutos(l.lidoPdf)))}
              </td>

              <td class="fp-num" data-rot="Horas na folha">
                ${l.fixo ? '<span class="fp-vazio">—</span>'
                         : (l.naFolha === null ? '<span class="fp-vazio">—</span>' : `<strong>${esc(textoDeMinutos(l.naFolha))}</strong>`)}
              </td>

              <td class="fp-acoes">
                ${l.divergencia
                  ? `<button class="btn-sm pt-revisar" data-pt-revisar="${esc(l.id)}"
                             title="O PDF dizia ${esc(textoDeMinutos(l.lidoPdf))} e a folha está com ${esc(textoDeMinutos(l.naFolha))}">
                       <i data-lucide="triangle-alert"></i> Revisar na folha
                     </button>`
                  : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ───────────────────────────────────────────────────────────
function ligar() {
  const sel = document.getElementById('ptComp');
  if (sel) sel.addEventListener('change', async () => {
    _competencia = sel.value;
    await carregar();
  });

  // Os dois caminhos para a importação levam ao MESMO lugar, no mesmo mês, com
  // a zona de arquivos destacada. Link genérico para "a folha" deixaria a
  // pessoa procurando o mês de novo.
  for (const id of ['ptImportar', 'ptImportarVazio']) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => irParaFolha({ destacarImportacao: true }));
  }

  const cont0 = document.getElementById(_container);
  if (cont0) cont0.querySelectorAll('[data-pt-revisar]').forEach(b =>
    b.addEventListener('click', () => irParaFolha({})));

  const pend = document.getElementById('ptPendentes');
  if (pend) pend.addEventListener('click', async () => {
    const { abrirPendentes } = await import('./documentos-ui.js');
    await abrirPendentes({
      container: _container,
      equipe: _equipe,
      competencia: _competencia,
      aoVoltar: () => carregar(),
    });
  });

  const cont = document.getElementById(_container);
  if (cont) cont.querySelectorAll('[data-pt-caminho]').forEach(b =>
    b.addEventListener('click', () => abrirDocumento(b.dataset.ptCaminho)));
}

/** Abre a Folha na competência que está na tela, não na "mais recente". */
function irParaFolha(extra = {}) {
  const pedido = { competencia: _competencia, ...extra };
  if (_irParaFolha) _irParaFolha(pedido);
  else location.hash = `#equipe/folha?competencia=${_competencia.slice(0, 7)}`;
}

async function abrirDocumento(caminho) {
  if (!caminho) return;
  try {
    const { urlAssinada, traduzirErroDocumento } = await import('./documentos.js');
    const url = await urlAssinada(caminho);
    if (url) window.open(url, '_blank', 'noopener');
    else mostrarErro(traduzirErroDocumento('arquivo não encontrado'));
  } catch (e) {
    mostrarErro(e.message || 'Não consegui abrir o arquivo.');
  }
}

function tile(rotulo, valor, sub) {
  return `
    <div class="rs-tile">
      <div class="rs-tile-rot">${esc(rotulo)}</div>
      <div class="rs-tile-val">${esc(valor)}</div>
      <div class="rs-tile-sub">${esc(sub || '')}</div>
    </div>`;
}

function erroHtml(e) {
  return `<div class="empty-state">
    <div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
    ${esc(e?.message || 'Não consegui carregar o ponto.')}</div>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
