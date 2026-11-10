// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — horários fixos do aluno, no Comercial
// ═══════════════════════════════════════════════════════════
// Na Next Fit, a recepção lança o pagamento e já põe o aluno fixo no horário.
// Aqui é a seção "Horários na agenda" do drawer do cliente: escolhe os dias
// e horas da grade, até a frequência semanal do plano.
//
// O fixo é preso à ASSINATURA, não ao aluno: renovar avança a mesma
// assinatura e os fixos continuam; vencida, o fixo para de ocupar vaga sem
// ninguém apagar nada. Quem confere frequência, vaga e organização é o
// gatilho agenda__fixo_confere (db/agenda_treino.sql) — a tela só ajuda a não
// pedir o que vai ser recusado.
//
// Sem grade montada (academia que não usa agenda, plano Profissional), a seção
// nem aparece.

import { sb } from './supabase.js';
import { pode } from './permissoes.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "Ter 18:00" (e a modalidade, se não for a padrão). */
export function rotuloFixo(g) {
  const base = `${CURTO[g.dia_semana]} ${String(g.hora_inicio).slice(0, 5)}`;
  return g.modalidade && g.modalidade !== 'Musculação' ? `${base} · ${g.modalidade}` : base;
}

/** O que gravar para sair de `atuais` (ids de grade) e chegar em `escolhidos`. */
export function diferencaFixos(atuais = [], escolhidos = []) {
  const a = new Set(atuais), e = new Set(escolhidos);
  return { inserir: [...e].filter(id => !a.has(id)), apagar: [...a].filter(id => !e.has(id)) };
}

/** Grade em ordem de segunda a domingo e por hora, agrupada por dia. */
export function gradePorDia(grade = []) {
  return ORDEM_DIAS
    .map(d => ({ dia: d, lista: grade.filter(g => g.dia_semana === d).sort((x, y) => String(x.hora_inicio).localeCompare(String(y.hora_inicio))) }))
    .filter(x => x.lista.length);
}

// ── dados ──────────────────────────────────────────────────
async function lerTudo(assinaturaId) {
  const [g, f] = await Promise.all([
    sb.from('agenda_grade').select('id, dia_semana, hora_inicio, capacidade, modalidade, ativo').eq('ativo', true),
    sb.from('agenda_fixos').select('id, grade_id').eq('assinatura_id', assinaturaId),
  ]);
  if (g.error) throw g.error;
  if (f.error) throw f.error;
  return { grade: g.data || [], fixos: f.data || [] };
}

async function gravar(assinatura, fixos, escolhidos) {
  const { inserir, apagar } = diferencaFixos(fixos.map(f => f.grade_id), escolhidos);
  // Apaga antes de inserir: trocar Ter 18h por Qua 18h num plano de 2 dias
  // passaria por 3 fixos no meio do caminho, e o gatilho recusaria.
  if (apagar.length) {
    const ids = fixos.filter(f => apagar.includes(f.grade_id)).map(f => f.id);
    const { error } = await sb.from('agenda_fixos').delete().in('id', ids);
    if (error) throw error;
  }
  for (const gradeId of inserir) {
    const { error } = await sb.from('agenda_fixos')
      .insert({ paciente_id: assinatura.paciente_id, assinatura_id: assinatura.id, grade_id: gradeId });
    if (error) throw error;
  }
}

const frase = e => (e?.code === 'P0001' && e.message) ? e.message
  : e?.code === '42501' ? 'Você não tem permissão para mudar os horários deste aluno.'
  : 'Não foi possível salvar os horários. Tente de novo.';

// ── tela ───────────────────────────────────────────────────
/** Preenche o <div data-agenda-fixos> do drawer, ou o remove se não há grade. */
export async function montarFixosNoDrawer(raiz, assinatura) {
  const lugar = raiz.querySelector('[data-agenda-fixos]');
  if (!lugar || !assinatura?.id) return;
  let estado;
  try { estado = await lerTudo(assinatura.id); }
  catch (e) { console.error('[agenda] fixos:', e); lugar.remove(); return; }
  if (!estado.grade.length) { lugar.remove(); return; }

  const freq = assinatura.plano?.frequencia_semanal ?? null;
  const editar = pode('comercial.editar') || pode('agenda.editar');
  let escolhendo = false;
  let marcados = new Set(estado.fixos.map(f => f.grade_id));

  const porId = new Map(estado.grade.map(g => [g.id, g]));
  const atuais = () => estado.fixos.map(f => porId.get(f.grade_id)).filter(Boolean)
    .sort((a, b) => ((a.dia_semana + 6) % 7) - ((b.dia_semana + 6) % 7) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)));

  const desenhar = () => {
    const lista = atuais();
    const topo = editar && !escolhendo && freq
      ? `<button class="cm-btn cm-btn-mini" type="button" data-fx-escolher><i data-lucide="calendar-check"></i> ${lista.length ? 'Trocar' : 'Escolher'}</button>`
      : '';
    let corpo;
    if (!freq) {
      corpo = `<p class="cm-dw-nota">O plano <b>${esc(assinatura.plano?.nome || '')}</b> não tem frequência semanal. Defina quantas vezes por semana no cadastro do plano para escolher os horários fixos.</p>`;
    } else if (!escolhendo) {
      corpo = lista.length
        ? `<div class="agf-chips">${lista.map(g => `<span class="agf-chip">${esc(rotuloFixo(g))}</span>`).join('')}</div>
           <p class="agf-sub">${lista.length} de ${freq} por semana${lista.length < freq ? ' · os outros ele marca pelo app' : ''}</p>`
        : `<p class="agf-sub">Nenhum horário fixo. Plano de ${freq}x por semana.</p>`;
    } else {
      corpo = `
        <p class="agf-sub" data-fx-conta>${marcados.size} de ${freq} escolhidos</p>
        ${gradePorDia(estado.grade).map(d => `
          <div class="agf-dia"><b>${CURTO[d.dia]}</b><div class="agf-horas">
            ${d.lista.map(g => `<label class="agf-op"><input type="checkbox" value="${esc(g.id)}" ${marcados.has(g.id) ? 'checked' : ''}><span>${esc(String(g.hora_inicio).slice(0, 5))}</span></label>`).join('')}
          </div></div>`).join('')}
        <div class="agf-acoes">
          <button class="cm-btn cm-btn-mini" type="button" data-fx-cancelar>Cancelar</button>
          <button class="cm-btn cm-btn-mini cm-btn-forte" type="button" data-fx-salvar>Salvar horários</button>
        </div>`;
    }
    lugar.innerHTML = `
      <section class="cm-dw-secao">
        <div class="cm-dw-secao-topo"><h3 class="cm-dw-t">Horários na agenda</h3>${topo}</div>
        ${corpo}
      </section>`;
    window.renderIcons?.();
    ligar();
  };

  const travarExcesso = () => {
    const cheio = marcados.size >= freq;
    lugar.querySelectorAll('.agf-op input').forEach(i => { i.disabled = !i.checked && cheio; });
    const conta = lugar.querySelector('[data-fx-conta]');
    if (conta) conta.textContent = `${marcados.size} de ${freq} escolhidos`;
  };

  function ligar() {
    lugar.querySelector('[data-fx-escolher]')?.addEventListener('click', () => {
      escolhendo = true; marcados = new Set(estado.fixos.map(f => f.grade_id)); desenhar(); travarExcesso();
    });
    lugar.querySelector('[data-fx-cancelar]')?.addEventListener('click', () => { escolhendo = false; desenhar(); });
    lugar.querySelectorAll('.agf-op input').forEach(i => i.addEventListener('change', () => {
      if (i.checked) marcados.add(i.value); else marcados.delete(i.value);
      travarExcesso();
    }));
    lugar.querySelector('[data-fx-salvar]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await gravar(assinatura, estado.fixos, [...marcados]);
        mostrarToast('Horários salvos.');
      } catch (e) {
        if (e?.code !== 'P0001') console.error('[agenda] salvar fixos:', e);
        mostrarErro(frase(e));
      }
      // Relê sempre: se parte gravou e parte não, a tela mostra o que ficou.
      try { estado = await lerTudo(assinatura.id); } catch (e) { console.error(e); }
      escolhendo = false; desenhar();
    });
  }

  desenhar();
}
