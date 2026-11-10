// ═══════════════════════════════════════════════════════════
// FICHA DO CLIENTE — "Serviços contratados" (Visão geral do Hub)
// ═══════════════════════════════════════════════════════════
// Três marcadores — Alimentação, Treino, Academia — que decidem o que o app
// do aluno mostra (js/servicos.js). Marcação SÓ MANUAL (decisão do Eduardo).
//
// Grava direto em `pacientes.servicos`: a política `pacientes_update` que já
// existe exige a mesma organização e `clientes.editar`. Sem a permissão, a
// seção aparece só para leitura.

import { sb } from './supabase.js';
import { pode } from './permissoes.js';
import { mostrarToast, mostrarErro } from './utils.js';
import { SERVICOS, normalizarServicos, rotuloServicos } from './servicos.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A marcação (pura, testada). `servicos` null = ainda não definido. */
export function servicosHtml(servicos, { editar = true, salvando = false } = {}) {
  const definido = Array.isArray(servicos);
  return `
    <div class="pv-sec-head">
      <h3 class="pv-sec-tit">Serviços contratados</h3>
      <span class="sv-resumo${definido ? '' : ' sv-resumo-pend'}">${esc(rotuloServicos(servicos))}</span>
    </div>
    <div class="sv-lista" role="group" aria-label="Serviços contratados">
      ${SERVICOS.map(s => {
        const on = definido && servicos.includes(s.id);
        return `
        <label class="sv-op${on ? ' on' : ''}">
          <input type="checkbox" value="${esc(s.id)}" ${on ? 'checked' : ''} ${editar && !salvando ? '' : 'disabled'}>
          <span class="sv-ic"><i data-lucide="${esc(s.icone)}"></i></span>
          <span class="sv-txt"><b>${esc(s.rotulo)}</b><small>${esc(s.ajuda)}</small></span>
        </label>`;
      }).join('')}
    </div>
    <p class="sv-nota">${definido
      ? 'O app do cliente mostra só o que está marcado. Alimentação não marcada aparece como oferta de acompanhamento nutricional.'
      : 'Ainda não definido: o app do cliente mostra tudo. Marque o que ele contratou.'}</p>`;
}

/** Monta a seção no elemento `cont`, para o `paciente` da ficha. */
export function montarServicos(cont, paciente) {
  if (!cont || !paciente?.id) return;
  const editar = pode('clientes.editar');
  let servicos = Array.isArray(paciente.servicos) ? paciente.servicos : null;

  const desenhar = (salvando = false) => {
    cont.innerHTML = servicosHtml(servicos, { editar, salvando });
    window.renderIcons?.();
    cont.querySelectorAll('.sv-op input').forEach(i => i.addEventListener('change', salvar));
  };

  async function salvar() {
    const marcados = normalizarServicos([...cont.querySelectorAll('.sv-op input:checked')].map(i => i.value));
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
