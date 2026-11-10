// ═══════════════════════════════════════════════════════════
// FICHA DO CLIENTE — "Serviços contratados" (cabeçalho do Hub)
// ═══════════════════════════════════════════════════════════
// Três botões liga/desliga — Alimentação, Treino, Academia — no cabeçalho da
// ficha, no lugar de "Registrar consulta" e "Registrar avaliação" (que foram
// para o menu ⋯). Decidem o que o app do aluno mostra (js/servicos.js).
// Marcação SÓ MANUAL (decisão do Eduardo), salva no toque.
//
// Grava direto em `pacientes.servicos`: a política `pacientes_update` que já
// existe exige a mesma organização e `clientes.editar`. Sem a permissão, os
// botões aparecem só para leitura.

import { sb } from './supabase.js';
import { pode } from './permissoes.js';
import { mostrarToast, mostrarErro } from './utils.js';
import { SERVICOS, normalizarServicos } from './servicos.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Os botões (puro, testado). `servicos` null = ainda não definido: nenhum
 * aceso e o aviso de que o app mostra tudo.
 */
export function servicosHtml(servicos, { editar = true, salvando = false } = {}) {
  const definido = Array.isArray(servicos);
  return `
    <span class="hub-sv-rot">Serviços</span>
    ${SERVICOS.map(s => {
      const on = definido && servicos.includes(s.id);
      return `<button type="button" class="hub-sv${on ? ' on' : ''}" data-sv="${esc(s.id)}" aria-pressed="${on}"
        title="${esc(s.ajuda)}" ${editar && !salvando ? '' : 'disabled'}>
        <i data-lucide="${on ? 'check' : esc(s.icone)}"></i> ${esc(s.rotulo)}</button>`;
    }).join('')}
    ${definido ? '' : '<span class="hub-sv-pend" title="Enquanto nada for marcado, o app do cliente mostra tudo.">não definido</span>'}`;
}

/** Liga os botões no elemento `cont`, para o `paciente` da ficha. */
export function montarServicos(cont, paciente) {
  if (!cont || !paciente?.id) return;
  const editar = pode('clientes.editar');
  let servicos = Array.isArray(paciente.servicos) ? paciente.servicos : null;

  const desenhar = (salvando = false) => {
    cont.innerHTML = servicosHtml(servicos, { editar, salvando });
    window.renderIcons?.();
    cont.querySelectorAll('[data-sv]').forEach(b => b.addEventListener('click', () => alternar(b.dataset.sv)));
  };

  async function alternar(id) {
    const atual = new Set(servicos || []);
    if (atual.has(id)) atual.delete(id); else atual.add(id);
    const marcados = normalizarServicos([...atual]);
    const antes = servicos;
    servicos = marcados;
    desenhar(true);
    const { data, error } = await sb.from('pacientes').update({ servicos: marcados }).eq('id', paciente.id).select('servicos').maybeSingle();
    if (error || !data) {
      servicos = antes;
      desenhar();
      if (error?.code === '42703') mostrarErro('Falta rodar a migração db/paciente_servicos.sql no banco.');
      else if (error?.code === '42501' || !data) mostrarErro('Você não tem permissão para alterar os serviços deste cliente.');
      else { console.error('[servicos]', error); mostrarErro('Não foi possível salvar. Tente de novo.'); }
      return;
    }
    servicos = data.servicos;
    paciente.servicos = data.servicos;   // a ficha em memória fica igual ao banco
    desenhar();
    mostrarToast('Serviços atualizados.');
  }

  desenhar();
}
