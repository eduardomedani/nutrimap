// ═══════════════════════════════════════════════════════════
// BUSCA GLOBAL — Ctrl+K / Cmd+K
// ═══════════════════════════════════════════════════════════
// Uma caixa só para chegar a qualquer lugar: pacientes, planos, treinos e as
// ações do sistema. Sem digitar nada, mostra os atalhos e os pacientes mais
// recentes — o estado vazio já é útil.
//
// Só busca o que existe: cada fonte é registrada aqui e as que dependem de
// módulos futuros (exames, documentos, consultas) entram quando forem
// construídas, sem tocar no componente.

import { sb } from './supabase.js';
import { listarPacientes } from './pacientes.js';
import { moduloAtivo } from './paciente-modulos.js';

let _abrirPaciente = null;
let _navegar = null;
let _pacientes = null;      // cache da sessão
let _overlay = null;
let _idx = 0;               // item destacado
let _itens = [];
let _seq = 0;               // descarta respostas fora de ordem

// Ações do sistema. Só entram as que têm destino de verdade hoje.
const ACOES = [
  { id: 'novo-paciente', label: 'Cadastrar cliente',      icone: 'user-plus', pagina: 'pacientes' },
  { id: 'clientes',      label: 'Ver todos os clientes',  icone: 'users',     pagina: 'pacientes' },
  { id: 'alimentos',     label: 'Banco de alimentos',     icone: 'apple',     pagina: 'alimentos' },
  { id: 'dietas',        label: 'Biblioteca de dietas',   icone: 'salad',     pagina: 'plano-alimentar' },
  { id: 'exercicios',    label: 'Biblioteca de exercícios', icone: 'dumbbell', pagina: 'exercicios' },
  { id: 'treinos',       label: 'Modelos de treino',      icone: 'clipboard-list', pagina: 'treinos' },
  { id: 'gestao',        label: 'Vencimento dos treinos', icone: 'calendar-clock', pagina: 'gestao-treinos' },
];

/** Liga o atalho global. Chamado uma vez, no boot do painel. */
export function ligarBuscaGlobal({ abrirPaciente, navegar }) {
  _abrirPaciente = abrirPaciente;
  _navegar = navegar;

  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); abrir(); }
  });
}

export function abrirBuscaGlobal() { abrir(); }

function abrir() {
  if (_overlay) return;
  _overlay = document.createElement('div');
  _overlay.className = 'bg-fundo';
  _overlay.innerHTML = `
    <div class="bg-caixa" role="dialog" aria-modal="true" aria-label="Busca global">
      <div class="bg-campo">
        <i data-lucide="search"></i>
        <input type="text" id="bgInput" placeholder="Buscar clientes, planos, treinos ou ações..."
               autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true"
               aria-controls="bgLista" aria-autocomplete="list">
        <kbd>Esc</kbd>
      </div>
      <div class="bg-lista" id="bgLista" role="listbox"></div>
      <div class="bg-rodape">
        <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
        <span><kbd>Enter</kbd> abrir</span>
      </div>
    </div>`;
  document.body.appendChild(_overlay);
  document.body.style.overflow = 'hidden';

  const input = _overlay.querySelector('#bgInput');
  input.addEventListener('input', () => buscar(input.value));
  input.addEventListener('keydown', onTecla);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) fechar(); });
  setTimeout(() => input.focus(), 20);

  buscar('');
}

function fechar() {
  _overlay?.remove();
  _overlay = null;
  _itens = [];
  document.body.style.overflow = '';
}

function onTecla(e) {
  if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); return; }
  if (e.key === 'Enter') { e.preventDefault(); executar(_itens[_idx]); }
}

function mover(passo) {
  if (!_itens.length) return;
  _idx = (_idx + passo + _itens.length) % _itens.length;
  pintarSelecao();
}

function pintarSelecao() {
  const els = [..._overlay.querySelectorAll('[data-bg-i]')];
  els.forEach(el => {
    const on = Number(el.dataset.bgI) === _idx;
    el.classList.toggle('ativo', on);
    el.setAttribute('aria-selected', String(on));
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

// ── Busca ──────────────────────────────────────────────────
async function buscar(termo) {
  const seq = ++_seq;
  const t = (termo || '').trim();
  const lista = _overlay?.querySelector('#bgLista');
  if (!lista) return;

  if (!_pacientes) {
    try { _pacientes = await listarPacientes(); } catch { _pacientes = []; }
    if (seq !== _seq) return;
  }

  const grupos = [];
  const pacs = filtrarPacientes(_pacientes, t).slice(0, t ? 8 : 5);
  if (pacs.length) {
    grupos.push({
      titulo: t ? 'Clientes' : 'Clientes recentes',
      itens: pacs.map(p => ({
        tipo: 'paciente', id: p.id, icone: 'user',
        titulo: p.nome || '(sem nome)',
        sub: `${p.codigo}${p.status === 'completo' ? ' · anamnese completa' : ' · aguardando anamnese'}`,
      })),
    });
  }

  const acoes = ACOES.filter(a => !t || normalizar(a.label).includes(normalizar(t)));
  if (acoes.length) {
    grupos.push({
      titulo: 'Ações',
      itens: acoes.slice(0, t ? 5 : 7).map(a => ({ tipo: 'acao', id: a.id, icone: a.icone, titulo: a.label, sub: 'Ir para' })),
    });
  }

  // Planos e treinos só são consultados quando há termo — evita bater no
  // banco a cada abertura da caixa.
  if (t.length >= 2) {
    // Falha numa fonte não pode travar a busca inteira: cai para lista vazia.
    const [planos, treinos] = await Promise.all([
      buscarPlanos(t).catch(() => []),
      buscarTreinos(t).catch(() => []),
    ]);
    if (seq !== _seq) return;
    if (planos.length) grupos.push({ titulo: 'Planos alimentares', itens: planos });
    if (treinos.length) grupos.push({ titulo: 'Treinos', itens: treinos });
  }

  _itens = grupos.flatMap(g => g.itens);
  _idx = 0;

  if (!_itens.length) {
    lista.innerHTML = `<div class="bg-vazio">Nada encontrado para “${esc(t)}”.</div>`;
    return;
  }

  let i = 0;
  lista.innerHTML = grupos.map(g => `
    <div class="bg-grupo">
      <div class="bg-grupo-tit">${esc(g.titulo)}</div>
      ${g.itens.map(it => `
        <button class="bg-item" data-bg-i="${i++}" role="option" aria-selected="false">
          <span class="bg-item-ic"><i data-lucide="${it.icone}"></i></span>
          <span class="bg-item-txt">
            <span class="bg-item-tit">${destacar(it.titulo, t)}</span>
            ${it.sub ? `<span class="bg-item-sub">${esc(it.sub)}</span>` : ''}
          </span>
        </button>`).join('')}
    </div>`).join('');

  lista.querySelectorAll('[data-bg-i]').forEach(el => {
    el.addEventListener('click', () => executar(_itens[Number(el.dataset.bgI)]));
    el.addEventListener('mouseenter', () => { _idx = Number(el.dataset.bgI); pintarSelecao(); });
  });
  pintarSelecao();
}

function filtrarPacientes(lista, t) {
  if (!t) return lista.slice(0, 5);
  const n = normalizar(t);
  return lista.filter(p => normalizar(`${p.nome || ''} ${p.codigo || ''} ${p.email || ''}`).includes(n));
}

async function buscarPlanos(t) {
  const { data, error } = await sb
    .from('planos_alimentares')
    .select('id, nome, ativo, paciente_id, paciente:pacientes(nome)')
    .ilike('nome', `%${t}%`)
    .not('paciente_id', 'is', null)
    .limit(5);
  if (error) return [];
  return (data || []).map(p => ({
    tipo: 'paciente', id: p.paciente_id, aba: 'planejamento', icone: 'utensils',
    titulo: p.nome || 'Plano sem nome',
    sub: `${p.paciente?.nome || 'Paciente'}${p.ativo ? ' · ativo' : ''}`,
  }));
}

async function buscarTreinos(t) {
  const { data, error } = await sb
    .from('treinos')
    .select('id, nome, ativo, paciente_id, paciente:pacientes(nome)')
    .ilike('nome', `%${t}%`)
    .not('paciente_id', 'is', null)
    .limit(5);
  if (error) return [];
  return (data || []).map(x => ({
    tipo: 'paciente', id: x.paciente_id, aba: 'treinos', icone: 'dumbbell',
    titulo: x.nome || 'Treino sem nome',
    sub: `${x.paciente?.nome || 'Paciente'}${x.ativo ? ' · ativo' : ''}`,
  }));
}

function executar(item) {
  if (!item) return;
  fechar();
  if (item.tipo === 'paciente') { _abrirPaciente?.(item.id, item.aba); return; }
  if (item.tipo === 'acao') {
    const acao = ACOES.find(a => a.id === item.id);
    if (acao?.pagina) _navegar?.(acao.pagina);
  }
}

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Sem acento e minúsculo: "jose" acha "José". */
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Realça o trecho buscado sem quebrar o escape do HTML. */
function destacar(texto, termo) {
  const t = (termo || '').trim();
  if (!t) return esc(texto);
  const i = normalizar(texto).indexOf(normalizar(t));
  if (i < 0) return esc(texto);
  return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + t.length)) + '</mark>' + esc(texto.slice(i + t.length));
}

/** Deixa a lista de pacientes obsoleta (após cadastrar/excluir). */
export function invalidarBusca() { _pacientes = null; }

export { moduloAtivo };
