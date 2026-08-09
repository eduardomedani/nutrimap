// ═══════════════════════════════════════════════════════════
// CHECK-INS — o drawer do modelo e o construtor de perguntas
// ═══════════════════════════════════════════════════════════
// Modelo e perguntas no MESMO painel: uma página por pergunta faria montar um
// questionário de oito perguntas custar oito navegações, e o profissional
// perderia a visão do conjunto — que é justamente o que ele está desenhando.
//
// NADA DE JSON NA TELA. `configuracao` é jsonb no banco, mas aqui vira campo
// com nome: mínimo, máximo, opções. Mostrar `{"min":0,"max":10}` seria expor
// estrutura interna a quem só quer uma escala de 0 a 10.

import { TIPOS, FREQUENCIAS, validarConfiguracao } from './checkin.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Rótulo amigável — nunca o enum técnico. */
export const TIPO_ROTULO = {
  escala:           'Escala 0–10',
  multipla_escolha: 'Múltipla escolha',
  sim_nao:          'Sim ou não',
  numero:           'Número',
  texto_curto:      'Texto curto',
  texto_longo:      'Texto longo',
};

export const FREQ_ROTULO = {
  semanal:   'Semanal',
  quinzenal: 'Quinzenal (a cada 14 dias)',
  mensal:    'Mensal',
  manual:    'Manual',
};

/** O aviso do 29/30/31, escrito onde a escolha acontece. */
export const AJUDA_DIA_MES = 'Em meses menores, será usado o último dia disponível.';

// ───────────────────────────────────────────────────────────
// PERGUNTA
// ───────────────────────────────────────────────────────────

export function opcoesDeTipo(selecionado) {
  return Object.keys(TIPOS)
    .map(id => `<option value="${id}"${id === selecionado ? ' selected' : ''}>${esc(TIPO_ROTULO[id])}</option>`)
    .join('');
}

/**
 * Os campos que só existem para um tipo.
 *
 * Trocar o tipo troca este bloco inteiro — e é por isso que ele é uma função
 * separada: a tela redesenha só ele, sem perder o que já foi digitado no resto.
 */
export function configuracaoHtml(tipo, cfg = {}, i) {
  const campo = (rot, id, valor, extra = '') => `
    <label class="ck-cfg-campo">
      <span>${esc(rot)}</span>
      <input data-cfg="${id}" data-i="${i}" value="${esc(valor ?? '')}" ${extra}>
    </label>`;

  if (tipo === 'escala') {
    return `
      <div class="ck-cfg">
        ${campo('Mínimo', 'min', cfg.min ?? 0, 'type="number"')}
        ${campo('Máximo', 'max', cfg.max ?? 10, 'type="number"')}
        ${campo('Descrição do mínimo', 'label_min', cfg.label_min, 'placeholder="Muito ruim"')}
        ${campo('Descrição do máximo', 'label_max', cfg.label_max, 'placeholder="Excelente"')}
      </div>`;
  }

  if (tipo === 'multipla_escolha') {
    const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes : [];
    return `
      <div class="ck-cfg">
        <div class="ck-opcoes" data-opcoes data-i="${i}">
          ${opcoes.map((o, j) => `
            <div class="ck-opcao">
              <input data-opcao data-i="${i}" data-j="${j}" value="${esc(o)}">
              <button type="button" class="ck-mini" data-opcao-sobe data-i="${i}" data-j="${j}"
                      aria-label="Subir opção">↑</button>
              <button type="button" class="ck-mini" data-opcao-desce data-i="${i}" data-j="${j}"
                      aria-label="Descer opção">↓</button>
              <button type="button" class="ck-mini ck-mini-x" data-opcao-tira data-i="${i}" data-j="${j}"
                      aria-label="Remover opção">×</button>
            </div>`).join('')}
        </div>
        <button type="button" class="ck-add-opcao" data-opcao-add data-i="${i}">+ Adicionar opção</button>
      </div>`;
  }

  if (tipo === 'numero') {
    return `
      <div class="ck-cfg">
        ${campo('Unidade', 'unidade', cfg.unidade, 'placeholder="kg"')}
        ${campo('Mínimo (opcional)', 'min', cfg.min, 'type="number"')}
        ${campo('Máximo (opcional)', 'max', cfg.max, 'type="number"')}
      </div>`;
  }

  return '';   // sim_nao e textos não configuram nada
}

/**
 * O card de uma pergunta.
 *
 * `temHistorico` vem de quantas respostas já existem: é o que dispara o aviso
 * de identidade longitudinal e o que troca "Desativar" por um texto que
 * explica o que acontece com o passado.
 */
export function perguntaHtml(p, i, { total = 1, temHistorico = false } = {}) {
  return `
    <div class="ck-pergunta ${p.ativo === false ? 'inativa' : ''}" data-pergunta data-i="${i}">
      <div class="ck-pergunta-topo">
        <span class="ck-pergunta-n">${i + 1}</span>
        <input class="ck-pergunta-texto" data-texto data-i="${i}"
               value="${esc(p.texto || '')}" placeholder="Escreva a pergunta">
        <div class="ck-pergunta-mover">
          <button type="button" class="ck-mini" data-sobe data-i="${i}" ${i === 0 ? 'disabled' : ''}
                  aria-label="Mover para cima">↑</button>
          <button type="button" class="ck-mini" data-desce data-i="${i}" ${i === total - 1 ? 'disabled' : ''}
                  aria-label="Mover para baixo">↓</button>
        </div>
      </div>

      <div class="ck-pergunta-linha">
        <label class="ck-cfg-campo">
          <span>Tipo</span>
          <select data-tipo data-i="${i}">${opcoesDeTipo(p.tipo)}</select>
        </label>
        <label class="ck-check">
          <input type="checkbox" data-obrig data-i="${i}" ${p.obrigatoria ? 'checked' : ''}>
          <span>Obrigatória</span>
        </label>
      </div>

      <div data-area-cfg data-i="${i}">${configuracaoHtml(p.tipo, p.configuracao || {}, i)}</div>

      ${temHistorico ? `
        <p class="ck-aviso-hist">
          <i data-lucide="history"></i>
          Esta pergunta já possui histórico. Alterações que mudem o significado podem
          comprometer comparações futuras — nesse caso, prefira <b>Duplicar</b>.
        </p>` : ''}

      <div class="ck-pergunta-acoes">
        <button type="button" class="ck-link" data-duplicar data-i="${i}">Duplicar</button>
        ${p.ativo === false
          ? `<button type="button" class="ck-link" data-reativar data-i="${i}">Reativar</button>`
          : `<button type="button" class="ck-link ck-link-sutil" data-desativar data-i="${i}">Desativar</button>`}
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// DRAWER
// ───────────────────────────────────────────────────────────

export function modeloVazio() {
  return { nome: '', descricao: '', frequencia_padrao: 'semanal', status: 'ativo' };
}

export function perguntaVazia(ordem = 1) {
  return {
    texto: '', tipo: 'escala', obrigatoria: false, ordem, ativo: true,
    configuracao: { min: 0, max: 10 },
  };
}

/** As regras do formulário, sem DOM — é o que o teste exercita. */
export function validarModelo(form = {}, perguntas = []) {
  const erros = {};
  if (!String(form.nome || '').trim()) erros.nome = 'Dê um nome ao modelo.';
  if (!FREQUENCIAS[form.frequencia_padrao]) erros.frequencia = 'Escolha a frequência.';

  const ativas = perguntas.filter(p => p.ativo !== false);
  if (!ativas.length) erros.perguntas = 'Adicione ao menos uma pergunta.';

  perguntas.forEach((p, i) => {
    if (p.ativo === false) return;
    if (!String(p.texto || '').trim()) erros[`p${i}`] = 'Escreva a pergunta.';
    else {
      const v = validarConfiguracao(p.tipo, p.configuracao || {});
      if (!v.ok) erros[`p${i}`] = v.erros[0];
    }
  });

  return { ok: !Object.keys(erros).length, erros };
}

export function drawerModeloHtml({ form, perguntas = [], erros = {}, historico = {}, editando = false }) {
  return `
    <div class="ck-drawer-raiz" data-raiz>
      <div class="ck-drawer" role="dialog" aria-modal="true"
           aria-label="${editando ? 'Editar modelo' : 'Novo modelo'}">
        <div class="ck-drawer-topo">
          <h2>${editando ? 'Editar modelo' : 'Novo modelo'}</h2>
          <button type="button" class="ck-drawer-x" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>

        <div class="ck-drawer-corpo">
          <div class="ck-campo${erros.nome ? ' invalido' : ''}">
            <label for="ckNome">Nome <span class="req">*</span></label>
            <input id="ckNome" data-nome value="${esc(form.nome)}" placeholder="Check-in semanal">
            ${erros.nome ? `<div class="ck-erro">${esc(erros.nome)}</div>` : ''}
          </div>

          <div class="ck-campo">
            <label for="ckDesc">Descrição</label>
            <textarea id="ckDesc" data-descricao rows="2"
                      placeholder="Como foi sua semana?">${esc(form.descricao || '')}</textarea>
          </div>

          <div class="ck-campo-2">
            <div class="ck-campo">
              <label for="ckFreq">Frequência padrão</label>
              <select id="ckFreq" data-frequencia>
                ${Object.keys(FREQUENCIAS).map(f =>
                  `<option value="${f}"${f === form.frequencia_padrao ? ' selected' : ''}>${esc(FREQ_ROTULO[f])}</option>`).join('')}
              </select>
            </div>
            <div class="ck-campo">
              <label for="ckStatus">Status</label>
              <select id="ckStatus" data-status>
                <option value="ativo"${form.status === 'ativo' ? ' selected' : ''}>Ativo</option>
                <option value="arquivado"${form.status === 'arquivado' ? ' selected' : ''}>Arquivado</option>
              </select>
            </div>
          </div>

          <h3 class="ck-secao">Perguntas</h3>
          ${erros.perguntas ? `<div class="ck-erro">${esc(erros.perguntas)}</div>` : ''}
          <div data-perguntas>
            ${perguntas.map((p, i) => `
              ${perguntaHtml(p, i, { total: perguntas.length, temHistorico: (historico[p.id] || 0) > 0 })}
              ${erros[`p${i}`] ? `<div class="ck-erro ck-erro-p">${esc(erros[`p${i}`])}</div>` : ''}
            `).join('')}
          </div>
          <button type="button" class="ck-add" data-add-pergunta>
            <i data-lucide="plus"></i> Adicionar pergunta
          </button>
        </div>

        <div class="ck-drawer-pe">
          <button type="button" class="btn-sm btn-sm-secondary" data-fechar>Cancelar</button>
          <button type="button" class="btn-sm" data-salvar>Salvar modelo</button>
        </div>
      </div>
    </div>`;
}
