// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — telas administrativas
// ═══════════════════════════════════════════════════════════
// Duas entradas, o mesmo repositório visto de dois ângulos:
//
//   . por COMPETÊNCIA — quem já tem o quê no mês (a partir da folha);
//   . por COLABORADOR — o histórico de uma pessoa (a partir do cadastro).
//
// Nenhuma delas grava documento: quem guarda é o fluxo que produziu o arquivo
// (importação do ponto, fechamento da folha). Aqui se consulta, abre, arquiva
// e se enxerga o que está faltando.

import {
  TIPOS, STATUS, ACOES, listarDocumentos, versoesDoDocumento, mapaDaCompetencia,
  urlAssinada, arquivarDocumento, reativarDocumento, formatoDoDocumento,
  listarPendentes, vincularPendente, ignorarPendente, historicoDoDocumento,
  traduzirErroDocumento,
} from './documentos.js';
import { nomeCompetencia } from './folha.js';
import { formatarData, mostrarToast, mostrarErro, confirmar } from './utils.js';

// ───────────────────────────────────────────────────────────
// POR COMPETÊNCIA — a partir da folha de pagamento
// ───────────────────────────────────────────────────────────
export async function abrirDocumentosDaCompetencia({ container, competencia, itens, aoVoltar }) {
  const cont = document.getElementById(container);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando documentos...</div>`;

  let docs;
  try {
    docs = await mapaDaCompetencia(competencia);
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  const linhas = itens.map(i => {
    const d = docs.get(i.funcionario_id) || {};
    return { item: i, contracheque: d.contracheque || null, ponto: d.folha_ponto || null };
  });

  cont.innerHTML = `
    <div class="dc-barra">
      <button class="btn" id="dcVoltar"><i data-lucide="arrow-left"></i> Voltar para a folha</button>
      <div class="dc-barra-tit">Documentos de ${esc(nomeCompetencia(competencia))}</div>
    </div>

    <div class="fp-tabela-wrap">
      <table class="fp-tabela dc-tabela">
        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Folha de ponto</th>
            <th>Contracheque</th>
            <th class="fp-num">Visualizado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${linhas.map(l => `
            <tr>
              <td class="fp-nome">
                <div>${esc(l.item.funcionario?.nome || '—')}</div>
                <div class="fp-nome-sub">${esc(l.item.funcionario?.cargo || '')}</div>
              </td>
              <td>${selo(l.ponto)}</td>
              <td>${selo(l.contracheque)}</td>
              <td class="fp-num">${l.contracheque?.visualizado_pelo_colaborador
                  ? `<span class="dc-visto"><i data-lucide="eye"></i> ${esc(formatarData(l.contracheque.visualizado_em))}</span>`
                  : '<span class="fp-vazio">—</span>'}</td>
              <td class="fp-acoes">
                ${l.ponto ? botaoAbrir(l.ponto, 'Ponto') : ''}
                ${l.contracheque ? botaoAbrir(l.contracheque, 'Contracheque') : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${linhas.every(l => !l.ponto && !l.contracheque)
      ? `<div class="empty-state">
           <div class="empty-state-icon"><i data-lucide="folder-open"></i></div>
           Nenhum documento foi gerado para esta competência.<br>
           Importe as folhas de ponto e feche a folha para publicar os contracheques.
         </div>`
      : ''}
  `;

  document.getElementById('dcVoltar').addEventListener('click', aoVoltar);
  ligarAcoes(cont);
}

// ───────────────────────────────────────────────────────────
// PENDENTES DE VÍNCULO
// ───────────────────────────────────────────────────────────
// Arquivo que chegou e não achou dono. Ele não fica invisível no Storage: fica
// aqui, com o que o sistema leu dele e por que não conseguiu casar.

export async function abrirPendentes({ container, equipe, competencia = null, aoVoltar }) {
  const cont = document.getElementById(container);
  if (!cont) return;
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando pendências...</div>`;

  let fila;
  try {
    fila = await listarPendentes({ competencia });
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  const opcoes = equipe.map(f =>
    `<option value="${f.id}">${esc(f.nome)}</option>`).join('');

  cont.innerHTML = `
    <div class="dc-barra">
      <button class="btn" id="dcVoltar"><i data-lucide="arrow-left"></i> Voltar</button>
      <div class="dc-barra-tit">Pendentes de vínculo</div>
    </div>

    ${fila.length ? `<div class="dc-lista">${fila.map(p => `
      <div class="dc-cartao dc-pendente" data-dp-linha="${p.id}">
        <div class="dc-icone"><i data-lucide="file-question"></i></div>
        <div class="dc-txt">
          <div class="dc-nome">${esc(p.nome_lido || p.nome_arquivo)}</div>
          <div class="dc-meta">
            ${esc(nomeCompetencia(p.competencia))}
            ${p.cpf_lido ? ` · CPF lido ${esc(p.cpf_lido)}` : ' · sem CPF no arquivo'}
            · ${esc(tamanho(p.tamanho_bytes))}
          </div>
          <div class="dc-meta dc-motivo">${esc(p.motivo || 'Não foi possível identificar o colaborador')}</div>
        </div>
        <div class="dc-acoes dc-acoes-pend">
          <select class="np-input dc-quem" data-dp-quem="${p.id}">
            <option value="">Escolher colaborador...</option>
            ${opcoes}
          </select>
          <button class="btn-sm" data-dp-vincular="${p.id}">Vincular</button>
          <button class="btn-sm btn-sm-secondary" data-dc-caminho="${esc(p.caminho_storage)}">Abrir</button>
          <button class="btn-sm btn-sm-secondary" data-dp-ignorar="${p.id}">Ignorar</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty-state">
           <div class="empty-state-icon"><i data-lucide="check-circle-2"></i></div>
           Nenhum arquivo aguardando vínculo.
         </div>`}
  `;

  document.getElementById('dcVoltar').addEventListener('click', aoVoltar);
  ligarAcoes(cont);

  // Sugestão já selecionada, quando o nome bateu inteiro.
  for (const p of fila) {
    if (!p.sugestao_id) continue;
    const sel = cont.querySelector(`[data-dp-quem="${p.id}"]`);
    if (sel) sel.value = p.sugestao_id;
  }

  const recarregar = () => abrirPendentes({ container, equipe, competencia, aoVoltar });

  cont.querySelectorAll('[data-dp-vincular]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.dpVincular;
    const quem = cont.querySelector(`[data-dp-quem="${id}"]`)?.value;
    if (!quem) { mostrarErro('Escolha o colaborador antes de vincular.'); return; }

    const p = fila.find(x => x.id === id);
    const nome = equipe.find(f => f.id === quem)?.nome || '';
    if (!(await confirmar({
      titulo: 'Vincular documento',
      mensagem: `"${p.nome_lido || p.nome_arquivo}" passa a ser de ${nome}.`
        + '\n\nEle vai aparecer no app do colaborador imediatamente.',
      textoOk: 'Vincular',
    }))) return;

    b.disabled = true;
    await comErro(async () => {
      await vincularPendente(p, quem);
      mostrarToast('✓ Documento vinculado');
      recarregar();
    });
    b.disabled = false;
  }));

  cont.querySelectorAll('[data-dp-ignorar]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmar({
      titulo: 'Ignorar arquivo',
      mensagem: 'Ele sai da fila e não vira documento de ninguém.\n\nO arquivo continua guardado.',
      textoOk: 'Ignorar',
    }))) return;
    await comErro(async () => {
      await ignorarPendente(b.dataset.dpIgnorar);
      recarregar();
    });
  }));
}

// ───────────────────────────────────────────────────────────
// POR COLABORADOR — a partir do cadastro
// ───────────────────────────────────────────────────────────
let _aba = 'todos';

export async function abrirDocumentosDoColaborador({ container, colaborador, aoVoltar }) {
  const cont = document.getElementById(container);
  if (!cont) return;
  _aba = 'todos';
  await desenharColaborador(cont, colaborador, aoVoltar);
}

async function desenharColaborador(cont, colaborador, aoVoltar) {
  cont.innerHTML = `<div class="loading"><div class="spinner"></div>Carregando documentos...</div>`;

  let docs;
  try {
    docs = await listarDocumentos({ colaboradorId: colaborador.id, incluirArquivados: true });
  } catch (e) {
    cont.innerHTML = erroHtml(e);
    return;
  }

  const visiveis = docs.filter(d =>
    _aba === 'todos' ? true : d.tipo_documento === _aba);

  // Agrupa por ano: o histórico só fica legível quando o ano ancora a leitura.
  const porAno = new Map();
  for (const d of visiveis) {
    const ano = String(d.competencia).slice(0, 4);
    if (!porAno.has(ano)) porAno.set(ano, []);
    porAno.get(ano).push(d);
  }

  cont.innerHTML = `
    <div class="dc-barra">
      <button class="btn" id="dcVoltar"><i data-lucide="arrow-left"></i> Voltar</button>
      <div class="dc-barra-tit">Documentos de ${esc(colaborador.nome)}</div>
    </div>

    <nav class="dc-abas">
      ${[['todos', 'Todos'], ['contracheque', 'Contracheques'], ['folha_ponto', 'Folhas de ponto']]
        .map(([id, rot]) => `
          <button class="dc-aba${_aba === id ? ' on' : ''}" data-dc-aba="${id}">${rot}</button>`).join('')}
    </nav>

    ${visiveis.length
      ? [...porAno.entries()].map(([ano, lista]) => `
          <div class="dc-ano">${ano}</div>
          <div class="dc-lista">${lista.map(cartaoHtml).join('')}</div>`).join('')
      : `<div class="empty-state">
           <div class="empty-state-icon"><i data-lucide="folder"></i></div>
           Nenhum documento para ${esc(colaborador.nome.split(' ')[0])} ainda.
         </div>`}
  `;

  document.getElementById('dcVoltar').addEventListener('click', aoVoltar);
  cont.querySelectorAll('[data-dc-aba]').forEach(b => b.addEventListener('click', () => {
    _aba = b.dataset.dcAba;
    desenharColaborador(cont, colaborador, aoVoltar);
  }));
  ligarAcoes(cont, () => desenharColaborador(cont, colaborador, aoVoltar));
}

function cartaoHtml(d) {
  const tipo = TIPOS[d.tipo_documento] || TIPOS.personalizado;
  const f = formatoDoDocumento(d);
  const arquivado = !!d.arquivado_em;

  return `
    <div class="dc-cartao${arquivado ? ' dc-arquivado' : ''}">
      <div class="dc-icone"><i data-lucide="${tipo.icone}"></i></div>
      <div class="dc-txt">
        <div class="dc-nome">
          ${esc(d.titulo || tipo.rotulo)}
          ${d.versao > 1 ? `<span class="dc-versao">v${d.versao}</span>` : ''}
          ${arquivado ? '<span class="dc-selo">Arquivado</span>' : ''}
        </div>
        <div class="dc-meta">
          ${esc(nomeCompetencia(d.competencia))}
          · ${esc(tamanho(d.tamanho_bytes))}
          ${d.disponibilizado_em ? ` · disponibilizado em ${esc(formatarData(d.disponibilizado_em))}` : ''}
        </div>
        ${d.visualizado_pelo_colaborador
          ? `<div class="dc-meta dc-visto"><i data-lucide="eye"></i>
               Visualizado em ${esc(formatarData(d.visualizado_em))}</div>`
          : '<div class="dc-meta dc-nao-visto">Ainda não visualizado</div>'}
      </div>
      <div class="dc-acoes">
        <button class="btn-sm" data-dc-abrir="${d.id}" data-dc-caminho="${esc(d.caminho_storage)}">
          ${esc(f.rotuloAbrir)}
        </button>
        ${arquivado
          ? `<button class="btn-sm btn-sm-secondary" data-dc-reativar="${d.id}">Reativar</button>`
          : `<button class="btn-sm btn-sm-secondary" data-dc-arquivar="${d.id}">Arquivar</button>`}
        <button class="btn-sm btn-sm-secondary" data-dc-versoes="${d.id}"
                data-dc-col="${d.colaborador_id}" data-dc-comp="${d.competencia}" data-dc-tipo="${d.tipo_documento}">
          Versões
        </button>
        <button class="btn-sm btn-sm-secondary" data-dc-historico="${d.id}">Histórico</button>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// AÇÕES
// ───────────────────────────────────────────────────────────
function ligarAcoes(cont, redesenhar) {
  cont.querySelectorAll('[data-dc-caminho]').forEach(b =>
    b.addEventListener('click', () => abrir(b.dataset.dcCaminho)));

  cont.querySelectorAll('[data-dc-arquivar]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!(await confirmar({
        titulo: 'Arquivar documento',
        mensagem: 'O colaborador deixa de ver este documento no app.\n\nO arquivo continua guardado e pode ser reativado.',
        textoOk: 'Arquivar',
      }))) return;
      await comErro(async () => {
        await arquivarDocumento(b.dataset.dcArquivar);
        mostrarToast('Documento arquivado');
        redesenhar?.();
      });
    }));

  cont.querySelectorAll('[data-dc-reativar]').forEach(b =>
    b.addEventListener('click', () => comErro(async () => {
      await reativarDocumento(b.dataset.dcReativar);
      mostrarToast('Documento reativado');
      redesenhar?.();
    })));

  cont.querySelectorAll('[data-dc-versoes]').forEach(b =>
    b.addEventListener('click', () => verVersoes(b.dataset)));

  cont.querySelectorAll('[data-dc-historico]').forEach(b =>
    b.addEventListener('click', () => verHistorico(b.dataset.dcHistorico)));
}

/** O que aconteceu com este documento, na ordem. Escrito pelo banco. */
async function verHistorico(id) {
  await comErro(async () => {
    const eventos = await historicoDoDocumento(id);
    if (!eventos.length) { mostrarToast('Sem registros para este documento'); return; }
    await confirmar({
      titulo: 'Histórico do documento',
      mensagem: eventos
        .map(e => `${formatarData(e.criado_em)} — ${ACOES[e.acao] || e.acao}`)
        .join('\n'),
      textoOk: 'Fechar', textoCancelar: 'Fechar',
    });
  });
}

async function abrir(caminho) {
  await comErro(async () => {
    const url = await urlAssinada(caminho);
    if (url) window.open(url, '_blank', 'noopener');
    else mostrarErro('Documento indisponível no momento.');
  });
}

async function verVersoes({ dcCol, dcComp, dcTipo }) {
  await comErro(async () => {
    const versoes = await versoesDoDocumento({
      colaboradorId: dcCol, competencia: dcComp, tipo: dcTipo,
    });
    if (versoes.length <= 1) {
      mostrarToast('Este documento tem uma versão só');
      return;
    }
    const linhas = versoes.map(v =>
      `v${v.versao}${v.atual ? ' (atual)' : ''} — ${formatarData(v.criado_em)} · ${STATUS[v.status] || v.status}`);
    await confirmar({
      titulo: `${versoes.length} versões`,
      mensagem: linhas.join('\n') + '\n\nA versão atual é a que o colaborador vê.',
      textoOk: 'Fechar', textoCancelar: 'Fechar',
    });
  });
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
function selo(doc) {
  if (!doc) return '<span class="dc-pend"><i data-lucide="minus"></i> não gerado</span>';
  if (doc.arquivado_em) return '<span class="dc-pend">arquivado</span>';
  return `<span class="dc-ok"><i data-lucide="check"></i> ${esc(STATUS[doc.status] || doc.status)}</span>`;
}

function botaoAbrir(doc, rotulo) {
  return `<button class="fp-acao" data-dc-caminho="${esc(doc.caminho_storage)}" title="Abrir ${rotulo}">
            <i data-lucide="external-link"></i></button>`;
}

/** Bytes em unidade legível. "1.4 MB" diz mais que "1468006". */
export function tamanho(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function comErro(fn) {
  try { await fn(); }
  catch (e) { mostrarErro(traduzirErroDocumento(e.message)); }
}

function erroHtml(e) {
  return `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
    ${esc(traduzirErroDocumento(e.message))}</div>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
