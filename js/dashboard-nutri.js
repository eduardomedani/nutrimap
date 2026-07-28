// ═══════════════════════════════════════════════════════════
// DASHBOARD DO PROFISSIONAL — a home do painel
// ═══════════════════════════════════════════════════════════
// Responde quatro perguntas: o que tenho hoje, o que está pendente, quem
// precisa de atenção e o que mudou recentemente.
//
// Desempenho: em vez de abrir a ficha de cada paciente (N×3 consultas), faz
// CINCO consultas agregadas e cruza tudo em memória, reaproveitando as mesmas
// regras de alerta do Hub (paciente-alertas.js) via montarResumo().
//
// Sem consultas, agenda, check-ins e financeiro: esses blocos entram quando as
// fases correspondentes existirem. Bloco sem fonte de dado não é desenhado.

import { sb } from './supabase.js';
import { listarPacientes } from './pacientes.js';
import { montarResumo } from './paciente-resumo.js';
import { alertasDoPaciente, PRIORIDADES } from './paciente-alertas.js';
import { moduloAtivo } from './paciente-modulos.js';
import { configDoTipo } from './timeline-config.js';
import { diasDePrazo } from './paciente-tarefas.js';

let _abrirPaciente = null;
let _dados = null;

/**
 * @param {string} mountId  id do container (page-inicio)
 * @param {function} abrirPaciente  (pacienteId, aba) => void
 */
export async function initDashboard(mountId, abrirPaciente) {
  const cont = document.getElementById(mountId);
  if (!cont) return;
  _abrirPaciente = abrirPaciente;

  cont.innerHTML = esqueleto();

  try {
    _dados = await carregarTudo();
    render(cont);
  } catch (e) {
    console.error('[dashboard]', e);
    cont.querySelector('[data-db-corpo]').innerHTML = `
      <div class="tl-estado">
        <div class="tl-estado-t">Não foi possível carregar o resumo do consultório.</div>
        <button class="btn-sm" data-db-retry>Tentar novamente</button>
      </div>`;
    cont.querySelector('[data-db-retry]')?.addEventListener('click', () => initDashboard(mountId, abrirPaciente));
  }
}

// ── Dados ──────────────────────────────────────────────────
async function carregarTudo() {
  const pacientes = await listarPacientes();
  const ids = pacientes.map(p => p.id);
  if (!ids.length) return { pacientes: [], fichas: [], tarefas: [], eventos: [] };

  const [planos, treinos, avaliacoes, tarefas, eventos] = await Promise.all([
    tabela('planos_alimentares', 'id, paciente_id, nome, objetivo, kcal_meta, ativo, data_inicio, data_fim, criado_em', ids),
    tabela('treinos', 'id, paciente_id, nome, divisao, ativo, data_inicio, data_fim, criado_em', ids),
    tabela('avaliacoes', 'id, paciente_id, numero, data_avaliacao, peso, pct_gordura, peso_magro, per_cintura, imc', ids),
    moduloAtivo('tarefas') ? tarefasAbertas() : Promise.resolve([]),
    eventosRecentes(),
  ]);

  const porPaciente = (lista) => {
    const m = new Map();
    for (const r of lista) {
      if (!m.has(r.paciente_id)) m.set(r.paciente_id, []);
      m.get(r.paciente_id).push(r);
    }
    return m;
  };
  const mp = porPaciente(planos), mt = porPaciente(treinos), ma = porPaciente(avaliacoes);

  // Mesmas regras da ficha, sem ida extra ao banco.
  const fichas = pacientes.map(p => {
    const resumo = montarResumo(p, {
      avaliacoes: ma.get(p.id) || [],
      planos: mp.get(p.id) || [],
      treinos: mt.get(p.id) || [],
    });
    return { paciente: p, resumo, alertas: alertasDoPaciente(resumo) };
  });

  return { pacientes, fichas, tarefas, eventos };
}

async function tabela(nome, colunas, ids) {
  const { data, error } = await sb.from(nome).select(colunas).in('paciente_id', ids);
  if (error) { console.warn('[dashboard]', nome, error.message); return []; }
  return data || [];
}

async function tarefasAbertas() {
  const { data, error } = await sb
    .from('paciente_tarefas')
    .select('*, paciente:pacientes(nome, codigo)')
    .in('status', ['pendente', 'em_andamento', 'adiada'])
    .order('prazo', { ascending: true, nullsFirst: false })
    .limit(50);
  if (error) { console.warn('[dashboard] tarefas', error.message); return []; }
  return data || [];
}

async function eventosRecentes() {
  const { data, error } = await sb
    .from('paciente_eventos')
    .select('*, paciente:pacientes(nome, codigo)')
    .eq('visivel', true)
    .order('data_evento', { ascending: false })
    .limit(12);
  if (error) { console.warn('[dashboard] eventos', error.message); return []; }
  return data || [];
}

// ── Render ─────────────────────────────────────────────────
function esqueleto() {
  return `
    <div class="page-header">
      <h1 class="page-title">Olá, <em><span id="userFirstName">Dr.</span></em> <i data-lucide="hand"></i></h1>
      <div class="page-sub">O que precisa da sua atenção hoje</div>
    </div>
    <div data-db-corpo>
      <div class="db-indic">${'<div class="db-ind"><span class="sk sk-l"></span><span class="sk sk-v"></span></div>'.repeat(5)}</div>
      <div class="db-colunas"><div class="sk sk-bloco"></div><div class="sk sk-bloco"></div></div>
    </div>`;
}

function render(cont) {
  const { fichas, tarefas, eventos } = _dados;
  const corpo = cont.querySelector('[data-db-corpo]');

  if (!fichas.length) {
    corpo.innerHTML = `
      <div class="tl-estado">
        <div class="tl-estado-ic"><i data-lucide="users"></i></div>
        <div class="tl-estado-t">Nenhum cliente cadastrado ainda.</div>
        <div class="tl-estado-s">Cadastre o primeiro cliente para começar a acompanhar.</div>
        <button class="btn primary" data-db-ir="pacientes"><i data-lucide="plus"></i> Cadastrar cliente</button>
      </div>`;
    ligar(corpo);
    return;
  }

  corpo.innerHTML = `
    ${indicadoresHtml()}
    <div class="db-colunas">
      <div class="db-col">
        ${hojeHtml(tarefas)}
        ${atencaoHtml(fichas)}
      </div>
      <div class="db-col">
        ${atividadeHtml(eventos)}
      </div>
    </div>`;
  ligar(corpo);
}

function indicadoresHtml() {
  const { fichas, tarefas } = _dados;
  const emAtencao = fichas.filter(f => f.alertas.some(a => a.prioridade === 'importante' || a.prioridade === 'urgente')).length;
  const comPlano = fichas.filter(f => f.resumo.planoAtivo).length;
  const comTreino = fichas.filter(f => f.resumo.treinoAtivo).length;
  const avaliados30 = fichas.filter(f => (f.resumo.dias.ultimaAv ?? 9999) <= 30).length;

  const inds = [
    { lab: 'Clientes', val: fichas.length },
    { lab: 'Com plano ativo', val: `${comPlano}`, sub: `de ${fichas.length}` },
    { lab: 'Com treino ativo', val: `${comTreino}`, sub: `de ${fichas.length}` },
    { lab: 'Avaliados em 30 dias', val: `${avaliados30}`, sub: `de ${fichas.length}` },
    { lab: 'Precisam de atenção', val: emAtencao, tom: emAtencao ? 'atencao' : 'bom' },
    ...(moduloAtivo('tarefas') ? [{ lab: 'Tarefas abertas', val: tarefas.length }] : []),
  ];
  return `<div class="db-indic">${inds.map(i => `
    <div class="db-ind">
      <span class="db-ind-l">${esc(i.lab)}</span>
      <span class="db-ind-v ${i.tom ? 'tom-' + i.tom : ''}">${esc(String(i.val))}</span>
      ${i.sub ? `<span class="db-ind-s">${esc(i.sub)}</span>` : ''}
    </div>`).join('')}</div>`;
}

// Hoje = o que tem prazo. Sem agenda ainda, isso são as tarefas.
function hojeHtml(tarefas) {
  if (!moduloAtivo('tarefas')) return '';
  const comPrazo = tarefas.filter(t => t.prazo);
  const atrasadas = comPrazo.filter(t => diasDePrazo(t) < 0);
  const hoje = comPrazo.filter(t => diasDePrazo(t) === 0);
  const proximas = comPrazo.filter(t => { const d = diasDePrazo(t); return d > 0 && d <= 7; });
  const semPrazo = tarefas.filter(t => !t.prazo);
  // Sem nada nos próximos 7 dias, mostra as próximas mesmo assim: contador
  // com "1" e lista vazia era contraditório.
  const urgentes = [...atrasadas, ...hoje, ...proximas];
  const lista = (urgentes.length ? urgentes : comPrazo).slice(0, 6);

  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="calendar-check"></i> Suas tarefas</h3>
        ${tarefas.length ? `<span class="pv-contador">${tarefas.length}</span>` : ''}
      </div>
      ${lista.length ? `
        <div class="db-lista">
          ${lista.map(t => {
            const d = diasDePrazo(t);
            const quando = d < 0 ? `Atrasada ${Math.abs(d)} ${Math.abs(d) === 1 ? 'dia' : 'dias'}`
                        : d === 0 ? 'Para hoje' : `Em ${d} ${d === 1 ? 'dia' : 'dias'}`;
            return `
              <button class="db-item" data-db-paciente="${t.paciente_id}">
                <span class="db-item-tit">${esc(t.titulo)}</span>
                <span class="db-item-sub">${esc(t.paciente?.nome || 'Paciente')}</span>
                <span class="db-item-tag ${d < 0 ? 'atrasado' : ''}">${esc(quando)}</span>
              </button>`;
          }).join('')}
        </div>
        ${semPrazo.length ? `<p class="db-nota">+ ${semPrazo.length} ${semPrazo.length === 1 ? 'tarefa sem prazo' : 'tarefas sem prazo'}</p>` : ''}
      ` : (semPrazo.length
            ? `<div class="db-lista">${semPrazo.slice(0, 6).map(t => `
                <button class="db-item" data-db-paciente="${t.paciente_id}">
                  <span class="db-item-tit">${esc(t.titulo)}</span>
                  <span class="db-item-sub">${esc(t.paciente?.nome || 'Paciente')}</span>
                  <span class="db-item-tag">Sem prazo</span>
                </button>`).join('')}</div>`
            : `<div class="pv-tudo-ok"><i data-lucide="check"></i> Nenhuma tarefa em aberto.</div>`)}
    </section>`;
}

function atencaoHtml(fichas) {
  const ordem = { urgente: 0, importante: 1, atencao: 2, informativo: 3 };
  const criticos = fichas
    .map(f => ({ ...f, pior: f.alertas[0] || null }))
    .filter(f => f.pior && (f.pior.prioridade === 'importante' || f.pior.prioridade === 'urgente'))
    .sort((a, b) => (ordem[a.pior.prioridade] - ordem[b.pior.prioridade]) || (b.alertas.length - a.alertas.length))
    .slice(0, 8);

  return `
    <section class="pv-card">
      <div class="pv-card-head">
        <h3><i data-lucide="triangle-alert"></i> Precisam de atenção</h3>
        ${criticos.length ? `<span class="pv-contador">${criticos.length}</span>` : ''}
      </div>
      ${criticos.length ? `
        <div class="db-lista">
          ${criticos.map(f => `
            <button class="db-item" data-db-paciente="${f.paciente.id}">
              <span class="db-item-tit">${esc(f.paciente.nome || f.paciente.codigo)}</span>
              <span class="db-item-sub">${esc(f.pior.titulo)}${f.alertas.length > 1 ? ` · +${f.alertas.length - 1}` : ''}</span>
              <span class="db-item-tag ${f.pior.prioridade === 'urgente' ? 'atrasado' : ''}">${esc(PRIORIDADES[f.pior.prioridade]?.label || '')}</span>
            </button>`).join('')}
        </div>`
      : `<div class="pv-tudo-ok"><i data-lucide="check"></i> Nenhum cliente com pendência importante.</div>`}
    </section>`;
}

function atividadeHtml(eventos) {
  return `
    <section class="pv-card">
      <div class="pv-card-head"><h3><i data-lucide="history"></i> Atividade recente</h3></div>
      ${eventos.length ? `
        <div class="db-atividade">
          ${eventos.map(e => {
            const cfg = configDoTipo(e.tipo);
            return `
              <button class="db-ev" data-db-paciente="${e.paciente_id}">
                <span class="db-ev-ic tom-${cfg.tom}"><i data-lucide="${cfg.icone}"></i></span>
                <span class="db-ev-txt">
                  <span class="db-ev-tit">${esc(e.titulo || cfg.label)}</span>
                  <span class="db-ev-sub">${esc(e.paciente?.nome || 'Paciente')} · ${esc(quando(e.data_evento))}</span>
                </span>
              </button>`;
          }).join('')}
        </div>`
      : `<div class="pv-vazio"><p>Nada registrado ainda.</p></div>`}
    </section>`;
}

function ligar(corpo) {
  corpo.querySelectorAll('[data-db-paciente]').forEach(b =>
    b.addEventListener('click', () => _abrirPaciente?.(b.dataset.dbPaciente)));
  corpo.querySelectorAll('[data-db-ir]').forEach(b =>
    b.addEventListener('click', () => document.querySelector(`.nav-item[data-page="${b.dataset.dbIr}"]`)?.click()));
}

// ── Helpers ────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function quando(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return `hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR');
}
