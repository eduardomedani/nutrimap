// ═══════════════════════════════════════════════════════════
// CHECK-INS — a aba Modelos
// ═══════════════════════════════════════════════════════════
// Lista dos modelos do profissional e o drawer que os constrói.
//
// Pergunta NÃO se exclui: a resposta aponta para ela por FK RESTRICT, e a
// identidade longitudinal depende de ela continuar existindo. A tela só
// oferece "Desativar", e o texto explica o que acontece com o histórico.

import {
  listarModelos, listarPerguntas, criarModelo, editarModelo, arquivarModelo,
  reativarModelo, duplicarModelo, criarPergunta, editarPergunta, desativarPergunta,
  reativarPergunta, duplicarPergunta, reordenarPerguntas, historicoDaPergunta, usoDosModelos,
} from './checkin-data.js';
import {
  drawerModeloHtml, modeloVazio, perguntaVazia, validarModelo,
  configuracaoHtml, TIPO_ROTULO, FREQ_ROTULO,
} from './checkin-modelo-drawer.js';
import { traduzirErroCheckin } from './checkin.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────────────────────────────────────
// LISTA
// ───────────────────────────────────────────────────────────

export function modeloHtml(m, { perguntas = 0, pacientes = 0 } = {}) {
  const arquivado = m.status === 'arquivado';
  return `
    <div class="ck-modelo ${arquivado ? 'arquivado' : ''}" data-modelo="${esc(m.id)}">
      <div class="ck-modelo-txt">
        <div class="ck-modelo-nome">${esc(m.nome)}</div>
        ${m.descricao ? `<div class="ck-modelo-desc">${esc(m.descricao)}</div>` : ''}
        <div class="ck-modelo-meta">
          <span>${perguntas} ${perguntas === 1 ? 'pergunta' : 'perguntas'}</span>
          <span class="sep">·</span>
          <span>${esc(FREQ_ROTULO[m.frequencia_padrao] || m.frequencia_padrao)}</span>
          <span class="sep">·</span>
          <span>${pacientes} ${pacientes === 1 ? 'paciente' : 'pacientes'}</span>
          <span class="ck-badge ${arquivado ? 'ck-s-cancelado' : 'ck-s-disponivel'}">
            ${arquivado ? 'Arquivado' : 'Ativo'}
          </span>
        </div>
      </div>
      <div class="ck-modelo-acoes">
        <button class="btn-sm btn-sm-secondary" data-editar="${esc(m.id)}">Editar</button>
        <button class="ck-link" data-duplicar-modelo="${esc(m.id)}">Duplicar</button>
        ${arquivado
          ? `<button class="ck-link" data-reativar-modelo="${esc(m.id)}">Reativar</button>`
          : `<button class="ck-link ck-link-sutil" data-arquivar-modelo="${esc(m.id)}">Arquivar</button>`}
      </div>
    </div>`;
}

export function vazioModelosHtml() {
  return `
    <div class="ck-vazio">
      <i data-lucide="clipboard-list"></i>
      <div class="ck-vazio-t">Nenhum modelo criado.</div>
      <div class="ck-vazio-s">Um modelo é o questionário que o paciente responde. Você o atribui depois, na ficha de cada um.</div>
      <button class="btn-sm" data-novo-modelo>Criar primeiro modelo</button>
    </div>`;
}

export const skeletonHtml = (n = 3) =>
  `<div class="ck-lista">${'<div class="ck-sk"></div>'.repeat(n)}</div>`;

// ───────────────────────────────────────────────────────────
// DRAWER
// ───────────────────────────────────────────────────────────

/**
 * Abre o construtor. `modeloId = null` cria; com id, edita.
 *
 * O drawer trabalha em MEMÓRIA e grava tudo no Salvar: reordenar, trocar tipo
 * e desativar mexem no rascunho, não no banco. Assim o profissional pode
 * desistir sem ter deixado meia edição gravada.
 */
export async function abrirModeloDrawer({ modeloId = null, aoSalvar } = {}) {
  let form = modeloVazio();
  let perguntas = [];
  const historico = {};
  let salvando = false;

  if (modeloId) {
    const [lista, ps] = await Promise.all([
      listarModelos({ incluirArquivados: true }),
      listarPerguntas(modeloId, { incluirInativas: true }),
    ]);
    const m = lista.find(x => x.id === modeloId);
    if (m) form = { ...m };
    perguntas = ps.map(p => ({ ...p }));
    // Quantas respostas cada pergunta já tem — é o que dispara o aviso de
    // identidade longitudinal no card.
    await Promise.all(perguntas.map(async p => {
      try { historico[p.id] = await historicoDaPergunta(p.id); } catch { historico[p.id] = 0; }
    }));
  } else {
    perguntas = [perguntaVazia(1)];
  }

  const el = document.createElement('div');
  document.body.appendChild(el);

  const fechar = () => { document.removeEventListener('keydown', onKey); el.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);

  function desenhar(erros = {}) {
    el.innerHTML = drawerModeloHtml({ form, perguntas, erros, historico, editando: !!modeloId });
    window.lucide?.createIcons?.();
    ligar();
  }

  function coletar() {
    form.nome = el.querySelector('[data-nome]')?.value ?? '';
    form.descricao = el.querySelector('[data-descricao]')?.value ?? '';
    form.frequencia_padrao = el.querySelector('[data-frequencia]')?.value ?? 'semanal';
    form.status = el.querySelector('[data-status]')?.value ?? 'ativo';
    el.querySelectorAll('[data-texto]').forEach(inp => {
      perguntas[Number(inp.dataset.i)].texto = inp.value;
    });
    el.querySelectorAll('[data-obrig]').forEach(inp => {
      perguntas[Number(inp.dataset.i)].obrigatoria = inp.checked;
    });
    el.querySelectorAll('[data-cfg]').forEach(inp => {
      const p = perguntas[Number(inp.dataset.i)];
      p.configuracao = p.configuracao || {};
      const chave = inp.dataset.cfg;
      const v = inp.value;
      if (['min', 'max'].includes(chave)) {
        p.configuracao[chave] = v === '' ? undefined : Number(v);
        if (p.configuracao[chave] === undefined) delete p.configuracao[chave];
      } else {
        if (v.trim()) p.configuracao[chave] = v.trim(); else delete p.configuracao[chave];
      }
    });
    el.querySelectorAll('[data-opcao]').forEach(inp => {
      const p = perguntas[Number(inp.dataset.i)];
      p.configuracao = p.configuracao || {};
      p.configuracao.opcoes = p.configuracao.opcoes || [];
      p.configuracao.opcoes[Number(inp.dataset.j)] = inp.value;
    });
  }

  const idx = (b) => Number(b.dataset.i);

  function ligar() {
    el.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
    el.firstElementChild?.addEventListener('click', (e) => {
      if (e.target === el.firstElementChild) fechar();
    });

    // Trocar o tipo redesenha SÓ o bloco de configuração — o resto do que foi
    // digitado continua onde estava.
    el.querySelectorAll('[data-tipo]').forEach(sel =>
      sel.addEventListener('change', () => {
        coletar();
        const p = perguntas[idx(sel)];
        p.tipo = sel.value;
        p.configuracao = p.tipo === 'escala' ? { min: 0, max: 10 }
                       : p.tipo === 'multipla_escolha' ? { opcoes: [''] }
                       : {};
        const area = el.querySelector(`[data-area-cfg][data-i="${idx(sel)}"]`);
        if (area) { area.innerHTML = configuracaoHtml(p.tipo, p.configuracao, idx(sel)); ligar(); }
      }));

    el.querySelector('[data-add-pergunta]')?.addEventListener('click', () => {
      coletar();
      perguntas.push(perguntaVazia(perguntas.length + 1));
      desenhar();
    });

    // Subir/descer em vez de arrastar: uma biblioteca de drag and drop seria
    // dependência nova para reordenar oito itens.
    el.querySelectorAll('[data-sobe]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const i = idx(b);
      if (i > 0) [perguntas[i - 1], perguntas[i]] = [perguntas[i], perguntas[i - 1]];
      desenhar();
    }));
    el.querySelectorAll('[data-desce]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const i = idx(b);
      if (i < perguntas.length - 1) [perguntas[i + 1], perguntas[i]] = [perguntas[i], perguntas[i + 1]];
      desenhar();
    }));

    el.querySelectorAll('[data-duplicar]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const p = perguntas[idx(b)];
      // Sem `id`: a cópia nasce como pergunta NOVA. É assim que se muda o
      // significado sem quebrar a série da original.
      perguntas.splice(idx(b) + 1, 0, {
        ...JSON.parse(JSON.stringify(p)), id: undefined,
        texto: `${p.texto} (cópia)`, ativo: true,
      });
      desenhar();
    }));

    el.querySelectorAll('[data-desativar]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const p = perguntas[idx(b)];
      if (!confirm('Desativar esta pergunta?\n\nEla não aparecerá em novos check-ins, mas o histórico será preservado.')) return;
      p.ativo = false;
      desenhar();
    }));
    el.querySelectorAll('[data-reativar]').forEach(b => b.addEventListener('click', () => {
      coletar(); perguntas[idx(b)].ativo = true; desenhar();
    }));

    // Opções da múltipla escolha
    el.querySelectorAll('[data-opcao-add]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const p = perguntas[idx(b)];
      p.configuracao.opcoes = [...(p.configuracao.opcoes || []), ''];
      desenhar();
    }));
    el.querySelectorAll('[data-opcao-tira]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const p = perguntas[idx(b)];
      p.configuracao.opcoes.splice(Number(b.dataset.j), 1);
      desenhar();
    }));
    el.querySelectorAll('[data-opcao-sobe]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const o = perguntas[idx(b)].configuracao.opcoes, j = Number(b.dataset.j);
      if (j > 0) [o[j - 1], o[j]] = [o[j], o[j - 1]];
      desenhar();
    }));
    el.querySelectorAll('[data-opcao-desce]').forEach(b => b.addEventListener('click', () => {
      coletar();
      const o = perguntas[idx(b)].configuracao.opcoes, j = Number(b.dataset.j);
      if (j < o.length - 1) [o[j + 1], o[j]] = [o[j], o[j + 1]];
      desenhar();
    }));

    el.querySelector('[data-salvar]')?.addEventListener('click', salvar);
  }

  async function salvar() {
    if (salvando) return;
    coletar();
    const { ok, erros } = validarModelo(form, perguntas);
    if (!ok) { desenhar(erros); return; }

    salvando = true;
    try {
      const m = modeloId
        ? await editarModelo(modeloId, {
            nome: form.nome.trim(), descricao: form.descricao || null,
            frequencia_padrao: form.frequencia_padrao, status: form.status })
        : await criarModelo({
            nome: form.nome, descricao: form.descricao || null,
            frequenciaPadrao: form.frequencia_padrao });

      const alvo = m?.id || modeloId;
      const novos = [];
      for (const [i, p] of perguntas.entries()) {
        const base = {
          texto: p.texto.trim(), tipo: p.tipo, obrigatoria: !!p.obrigatoria,
          ordem: i + 1, unidade: p.configuracao?.unidade || null,
          configuracao: p.configuracao || {},
        };
        if (p.id) {
          await editarPergunta(p.id, { ...base, ativo: p.ativo !== false });
          novos.push(p.id);
        } else {
          const criada = await criarPergunta({ modeloId: alvo, ...base });
          novos.push(criada.id);
          if (p.ativo === false) await desativarPergunta(criada.id);
        }
      }
      await reordenarPerguntas(novos);

      mostrarToast(modeloId ? 'Modelo atualizado.' : 'Modelo criado.');
      fechar();
      aoSalvar?.();
    } catch (e) {
      console.error('[check-in] salvar modelo', e);
      mostrarErro(traduzirErroCheckin(e?.message));
      salvando = false;
    }
  }

  desenhar();
  return { fechar, el };
}

// ───────────────────────────────────────────────────────────
// A ABA
// ───────────────────────────────────────────────────────────

export async function renderModelos(cont, { aoMudar } = {}) {
  cont.innerHTML = skeletonHtml();
  try {
    const [modelos, uso] = await Promise.all([
      listarModelos({ incluirArquivados: true }),
      usoDosModelos().catch(() => new Map()),
    ]);
    const contagens = await Promise.all(
      modelos.map(m => listarPerguntas(m.id).then(p => p.length).catch(() => 0)));

    cont.innerHTML = modelos.length
      ? `<div class="ck-lista">${modelos.map((m, i) =>
          modeloHtml(m, { perguntas: contagens[i], pacientes: (uso.get(m.id) || new Set()).size })).join('')}</div>`
      : vazioModelosHtml();
    window.lucide?.createIcons?.();

    const recarregar = () => { renderModelos(cont, { aoMudar }); aoMudar?.(); };

    cont.querySelectorAll('[data-novo-modelo]').forEach(b =>
      b.addEventListener('click', () => abrirModeloDrawer({ aoSalvar: recarregar })));
    cont.querySelectorAll('[data-editar]').forEach(b =>
      b.addEventListener('click', () => abrirModeloDrawer({ modeloId: b.dataset.editar, aoSalvar: recarregar })));

    cont.querySelectorAll('[data-duplicar-modelo]').forEach(b =>
      b.addEventListener('click', async () => {
        try { await duplicarModelo(b.dataset.duplicarModelo); mostrarToast('Modelo duplicado.'); recarregar(); }
        catch (e) { mostrarErro(traduzirErroCheckin(e?.message)); }
      }));

    cont.querySelectorAll('[data-arquivar-modelo]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Arquivar este modelo?\n\nO histórico é preservado: respostas e check-ins antigos continuam. O que muda é que ele não gera novos check-ins e não aceita novas atribuições.')) return;
        try { await arquivarModelo(b.dataset.arquivarModelo); mostrarToast('Modelo arquivado.'); recarregar(); }
        catch (e) { mostrarErro(traduzirErroCheckin(e?.message)); }
      }));

    cont.querySelectorAll('[data-reativar-modelo]').forEach(b =>
      b.addEventListener('click', async () => {
        try { await reativarModelo(b.dataset.reativarModelo); recarregar(); }
        catch (e) { mostrarErro(traduzirErroCheckin(e?.message)); }
      }));
  } catch (e) {
    console.error('[check-in] modelos', e);
    cont.innerHTML = `<div class="ck-vazio"><div class="ck-vazio-t">Não foi possível carregar os modelos.</div>
      <button class="btn-sm" data-retry>Tentar novamente</button></div>`;
    cont.querySelector('[data-retry]')?.addEventListener('click', () => renderModelos(cont, { aoMudar }));
  }
}

export { TIPO_ROTULO };
