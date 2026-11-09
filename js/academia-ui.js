// ═══════════════════════════════════════════════════════════
// MINHA ACADEMIA — inventário de estações e puxadores (UI)
// ═══════════════════════════════════════════════════════════
// Edita a linha do nutri em `academia_inventario` (db/treino_academia_inventario.sql).
// O gerador de treinos por IA lê este inventário e só prescreve o que estiver
// DISPONÍVEL. "A confirmar" e "Indisponível" são tratados como inexistentes —
// é assim que um item pendente (ex.: rack) fica fora até alguém confirmar.
//
// Grava o inventário inteiro num clique de "Salvar" (não item a item): são
// poucas dezenas de itens e um upsert só evita estado meio salvo.
//
// Aberto por exercicios-ui.js, dentro do #exFormWrap.

import { obterInventarioAcademia, salvarInventarioAcademia, SITUACOES_INVENTARIO } from './treinos.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';
import { RECURSOS, recursosDoItem } from './academia-compat.js';

const ROTULO_SITUACAO = { disponivel: 'Disponível', pendente: 'A confirmar', indisponivel: 'Indisponível' };
const PREFIXO = { equipamento: 'EQ', puxador: 'PG' };

let _wrap = null;
let _nutriId = null;
let _ativo = true;
let _itens = [];
let _sujo = false;
let _editId = null;
let _existe = false;
let _aoSalvar = null;

/** `opts.aoSalvar` — chamado depois de salvar (a lista "Minha academia" refiltra). */
export async function abrirMinhaAcademia(wrap, nutriId, opts = {}) {
  _wrap = wrap;
  _nutriId = nutriId;
  _aoSalvar = typeof opts.aoSalvar === 'function' ? opts.aoSalvar : null;
  _editId = null;
  _sujo = false;
  _wrap.innerHTML = `<div class="av-form-card"><div class="loading"><div class="spinner"></div>Carregando inventário...</div></div>`;
  try {
    const inv = await obterInventarioAcademia();
    _existe = !!inv;
    _ativo = inv ? !!inv.ativo : true;
    _itens = inv ? inv.itens.map(i => ({ ...i })) : [];
  } catch (e) {
    _wrap.innerHTML = `<div class="ia-erro"><i data-lucide="triangle-alert"></i> Erro ao carregar o inventário: ${esc(e.message)}</div>`;
    return;
  }
  render();
  _wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ───────────────────────────────────────────────────────────
// RENDER
// ───────────────────────────────────────────────────────────
function render() {
  const conta = (tipo, sit) => _itens.filter(i => tipoDe(i) === tipo && (!sit || i.situacao === sit)).length;
  const secao = (tipo, titulo) => {
    const lista = _itens.filter(i => tipoDe(i) === tipo);
    return `
      <div class="acad-secao">
        <div class="acad-secao-head">
          <span class="ia-label" style="margin:0">${titulo} · ${conta(tipo, 'disponivel')}/${lista.length} disponíveis</span>
          <button type="button" class="btn" data-acad-novo="${tipo}"><i data-lucide="plus"></i> Adicionar</button>
        </div>
        ${lista.length ? lista.map(i => i.id === _editId ? formItem(i) : linhaItem(i)).join('')
                       : `<div class="acad-vazio">Nenhum item cadastrado.</div>`}
      </div>`;
  };

  _wrap.innerHTML = `
    <div class="av-form-card acad" style="margin-bottom:18px;">
      <div class="av-form-title"><i data-lucide="warehouse"></i> Minha <em>academia</em></div>
      <p class="ia-hint">O gerador de treinos por IA só prescreve exercícios executáveis com o que está
        <b>Disponível</b> aqui, e indica em qual aparelho/puxador cada um é feito.
        <b>A confirmar</b> e <b>Indisponível</b> ficam de fora até você mudar.</p>
      ${_existe ? '' : `<div class="form-warn">Você ainda não tem inventário. Cadastre as estações e puxadores e salve — até lá o gerador usa qualquer equipamento.</div>`}

      <label class="ia-inv ia-inv-on" style="margin-bottom:14px;">
        <input type="checkbox" id="acadAtivo" ${_ativo ? 'checked' : ''}>
        <span><b>Usar este inventário no gerador de treinos</b></span>
      </label>

      ${secao('equipamento', 'Estações e equipamentos')}
      ${secao('puxador', 'Puxadores e pegadas')}

      <div class="av-actions">
        <button class="btn" id="acadFechar">Fechar</button>
        <button class="btn primary" id="acadSalvar" ${_sujo ? '' : 'disabled'}><i data-lucide="save"></i> Salvar inventário</button>
      </div>
    </div>`;

  ligar();   // ícones: o observer global do index.html converte sozinho
}

function linhaItem(i) {
  const meta = [i.categoria, i.grupos].filter(Boolean).join(' · ');
  const opcoes = SITUACOES_INVENTARIO
    .map(s => `<option value="${s}" ${i.situacao === s ? 'selected' : ''}>${ROTULO_SITUACAO[s]}</option>`).join('');
  return `
    <div class="acad-item acad-${esc(i.situacao)}">
      <span class="acad-id">${esc(i.id)}</span>
      <div class="acad-info">
        <div class="acad-nome">${esc(i.nome)}</div>
        ${meta ? `<div class="acad-meta">${esc(meta)}</div>` : ''}
        ${i.exercicios ? `<div class="acad-meta">${esc(i.exercicios)}</div>` : ''}
        ${i.obs ? `<div class="acad-obs">${esc(i.obs)}</div>` : ''}
        ${fornece(i)}
      </div>
      <select class="np-input acad-sit" data-acad-sit="${esc(i.id)}">${opcoes}</select>
      <button type="button" class="patient-action" data-acad-edit="${esc(i.id)}" title="Editar"><i data-lucide="pencil"></i></button>
      <button type="button" class="patient-action patient-action-danger" data-acad-del="${esc(i.id)}" title="Remover"><i data-lucide="trash-2"></i></button>
    </div>`;
}

function formItem(i) {
  const puxador = tipoDe(i) === 'puxador';
  const campo = (id, rot, val, ph, largo = false) => `
    <div class="av-field"${largo ? ' style="grid-column:1/-1"' : ''}><label>${rot}</label>
      <input type="text" id="${id}" class="np-input" value="${esc(val || '')}" placeholder="${esc(ph)}"></div>`;
  return `
    <div class="acad-item acad-editando">
      <span class="acad-id">${esc(i.id)}</span>
      <div class="acad-info">
        <div class="av-grid">
          ${campo('acadNome', 'Nome *', i.nome, puxador ? 'Ex.: Triângulo metálico fechado' : 'Ex.: Leg press 45°')}
          ${campo('acadCat', 'Categoria', i.categoria, puxador ? 'Puxador' : 'Ex.: Máquina, Peso livre, Cabo / polia')}
          ${campo('acadGrupos', puxador ? 'Pegada' : 'Grupos musculares', i.grupos, puxador ? 'Ex.: Neutra, fechada' : 'Ex.: Quadríceps, glúteos')}
          ${campo('acadEx', 'Exercícios possíveis', i.exercicios, puxador ? 'Ex.: Remada baixa; puxada fechada' : 'Ex.: Leg press; variação de pés')}
          ${campo('acadObs', 'Observações / restrições', i.obs, 'Ex.: confirmar regulagem; não é barra de carga', true)}
        </div>
        <label class="ia-label" style="margin-top:10px">O que este item permite fazer (filtro "Minha academia")</label>
        <div class="acad-recursos">${Object.entries(RECURSOS).map(([k, rot]) => `
          <label class="acad-rec"><input type="checkbox" data-acad-rec="${k}" ${recursosDoItem(i).includes(k) ? 'checked' : ''}> ${esc(rot)}</label>`).join('')}
        </div>
        <div class="av-actions" style="margin-top:8px">
          <button type="button" class="btn" id="acadItemCancelar">Cancelar</button>
          <button type="button" class="btn primary" id="acadItemOk"><i data-lucide="check"></i> Aplicar</button>
        </div>
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// EVENTOS
// ───────────────────────────────────────────────────────────
function ligar() {
  const $ = id => document.getElementById(id);

  $('acadAtivo').addEventListener('change', e => { _ativo = e.target.checked; marcarSujo(); });
  $('acadSalvar').addEventListener('click', salvar);
  $('acadFechar').addEventListener('click', fechar);

  _wrap.querySelectorAll('[data-acad-sit]').forEach(sel => sel.addEventListener('change', () => {
    const it = _itens.find(i => i.id === sel.dataset.acadSit);
    if (!it) return;
    it.situacao = sel.value;
    marcarSujo();
    render();
  }));
  _wrap.querySelectorAll('[data-acad-edit]').forEach(b => b.addEventListener('click', () => {
    _editId = b.dataset.acadEdit;
    render();
    document.getElementById('acadNome')?.focus();
  }));
  _wrap.querySelectorAll('[data-acad-del]').forEach(b => b.addEventListener('click', async () => {
    const it = _itens.find(i => i.id === b.dataset.acadDel);
    if (!it) return;
    if (!(await confirmar({
      titulo: 'Remover do inventário',
      mensagem: `Remover "${it.nome}"? Se ele só está quebrado ou a confirmar, prefira mudar a situação.`,
      textoOk: 'Remover', perigo: true,
    }))) return;
    _itens = _itens.filter(i => i !== it);
    marcarSujo();
    render();
  }));
  _wrap.querySelectorAll('[data-acad-novo]').forEach(b => b.addEventListener('click', () => {
    const tipo = b.dataset.acadNovo;
    const novo = { id: proximoId(tipo), tipo, nome: '', categoria: tipo === 'puxador' ? 'Puxador' : '',
                   grupos: '', exercicios: '', obs: '', situacao: 'disponivel', _novo: true };
    _itens.push(novo);
    _editId = novo.id;
    render();
    document.getElementById('acadNome')?.focus();
  }));

  $('acadItemCancelar')?.addEventListener('click', () => {
    // Item recém-criado e nunca aplicado: cancelar = descartar.
    _itens = _itens.filter(i => !(i.id === _editId && i._novo));
    _editId = null;
    render();
  });
  $('acadItemOk')?.addEventListener('click', () => {
    const it = _itens.find(i => i.id === _editId);
    const v = id => (document.getElementById(id)?.value || '').trim();
    if (!v('acadNome')) { mostrarToast('Informe o nome do item.'); return; }
    Object.assign(it, { nome: v('acadNome'), categoria: v('acadCat'), grupos: v('acadGrupos'),
                        exercicios: v('acadEx'), obs: v('acadObs') });
    // Marcado à mão vale mais que o inferido do nome; nada marcado = volta a inferir.
    const recs = [..._wrap.querySelectorAll('[data-acad-rec]:checked')].map(c => c.dataset.acadRec);
    if (recs.length) it.recursos = recs; else delete it.recursos;
    delete it._novo;
    _editId = null;
    marcarSujo();
    render();
  });
}

function marcarSujo() {
  _sujo = true;
  const b = document.getElementById('acadSalvar');
  if (b) b.disabled = false;
}

async function salvar() {
  if (_editId) { mostrarToast('Aplique ou cancele o item em edição antes de salvar.'); return; }
  const btn = document.getElementById('acadSalvar');
  btn.disabled = true;
  try {
    const itens = _itens.map(({ _novo, ...i }) => ({
      ...i, tipo: tipoDe(i), situacao: SITUACOES_INVENTARIO.includes(i.situacao) ? i.situacao : 'disponivel',
    }));
    await salvarInventarioAcademia(_nutriId, { ativo: _ativo, itens });
    _existe = true;
    _sujo = false;
    mostrarToast('✓ Inventário salvo — o gerador de treinos já usa esta versão');
    render();
    _aoSalvar?.();
  } catch (e) {
    mostrarErro('Erro ao salvar o inventário: ' + e.message);
    btn.disabled = false;
  }
}

async function fechar() {
  if (_sujo && !(await confirmar({
    titulo: 'Alterações não salvas',
    mensagem: 'Fechar sem salvar o inventário? As alterações serão perdidas.',
    textoOk: 'Fechar sem salvar', perigo: true,
  }))) return;
  _wrap.innerHTML = '';
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
function tipoDe(i) { return i.tipo === 'puxador' ? 'puxador' : 'equipamento'; }

function fornece(i) {
  const recs = recursosDoItem(i);
  if (!recs.length) return `<div class="acad-fornece acad-fornece-vazio">Não libera exercício no filtro — edite e marque o que ele permite fazer.</div>`;
  return `<div class="acad-fornece">Libera: ${recs.map(r => esc(RECURSOS[r] || r)).join(', ')}</div>`;
}

/** Próximo id livre do tipo: EQ36, PG13... (nunca reaproveita um id em uso). */
export function proximoId(tipo, itens = _itens) {
  const pre = PREFIXO[tipo] || 'EQ';
  const usados = itens.map(i => String(i.id || '')).filter(id => id.startsWith(pre))
    .map(id => parseInt(id.slice(pre.length), 10)).filter(n => Number.isFinite(n));
  const n = (usados.length ? Math.max(...usados) : 0) + 1;
  return pre + String(n).padStart(2, '0');
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
