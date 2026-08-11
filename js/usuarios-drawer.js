// ═══════════════════════════════════════════════════════════
// USUÁRIOS E ACESSOS — os drawers
// ═══════════════════════════════════════════════════════════
// Segue o padrão de js/comercial-formularios.js: raiz no body, Escape fecha, e
// a trava de scroll cai mesmo se o desenho falhar — senão o botão fica morto
// para sempre e nada na tela diz por quê.

import * as dados from './usuarios-data.js';
import { permissoesHtml, excecoesRedundantes } from './usuarios-ui.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _aberto = false;

function abrirDrawer(desenhar) {
  if (_aberto) return null;
  _aberto = true;

  const fundo = document.createElement('div');
  fundo.className = 'us-drawer-raiz';
  document.body.appendChild(fundo);
  document.body.classList.add('us-travado');

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('us-travado');
    fundo.remove();
    _aberto = false;
  };
  function aoTeclado(e) { if (e.key === 'Escape') { e.preventDefault(); fechar(); } }
  document.addEventListener('keydown', aoTeclado);
  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });

  try { desenhar(fundo, fechar); }
  catch (e) {
    fechar();
    console.error('Usuários · drawer:', e);
    mostrarErro('Não consegui abrir o formulário.');
    return null;
  }
  return { fundo, fechar };
}

const cascaHtml = (titulo, corpo, pe) => `
  <div class="us-drawer" role="dialog" aria-modal="true" aria-labelledby="usDwTit">
    <header class="us-dw-topo">
      <h2 id="usDwTit">${esc(titulo)}</h2>
      <button class="us-dw-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
    </header>
    <div class="us-dw-corpo">${corpo}</div>
    <footer class="us-dw-pe">${pe}</footer>
  </div>`;


// ═══════════════════════════════════════════════════════════
// NOVO USUÁRIO
// ═══════════════════════════════════════════════════════════
export function drawerNovoUsuario({ aoSalvar } = {}) {
  return abrirDrawer(async (fundo, fechar) => {
    fundo.innerHTML = cascaHtml('Novo usuário', '<p class="us-carregando">Carregando…</p>', '');

    let perfis = [], funcionarios = [];
    try {
      [perfis, funcionarios] = await Promise.all([dados.listarPerfis(), dados.listarFuncionarios()]);
    } catch (e) { mostrarErro(dados.traduzirErro(e)); fechar(); return; }

    const form = `
      <div class="us-campo">
        <label for="usNome">Nome</label>
        <input id="usNome" type="text" autocomplete="off" placeholder="Maria Souza">
      </div>
      <div class="us-campo">
        <label for="usEmail">E-mail</label>
        <input id="usEmail" type="email" autocomplete="off" placeholder="maria@empresa.com">
      </div>
      <p class="us-ajuda">
        O código só funciona para <b>este e-mail</b>. Se a pessoa criar a conta com
        outro, o vínculo falha e é preciso emitir um convite novo.
      </p>
      <div class="us-campo">
        <label for="usPerfil">Perfil</label>
        <select id="usPerfil">
          ${perfis.map(p => `<option value="${esc(p.chave)}">${esc(p.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="us-campo">
        <label for="usFunc">Colaborador vinculado <span class="us-opcional">opcional</span></label>
        <select id="usFunc">
          <option value="">Nenhum</option>
          ${funcionarios.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('')}
        </select>
      </div>
      <p class="us-ajuda">
        Usuário não precisa ser colaborador, e colaborador não precisa ter login.
        O vínculo serve só para as duas fichas se encontrarem.
      </p>`;

    const pe = `
      <button class="us-btn" type="button" data-fechar>Cancelar</button>
      <button class="us-btn-forte" type="button" data-criar>Criar acesso</button>`;

    fundo.innerHTML = cascaHtml('Novo usuário', form, pe);
    window.renderIcons?.();
    ligarFechar(fundo, fechar);
    fundo.querySelector('#usNome')?.focus();

    fundo.querySelector('[data-criar]')?.addEventListener('click', async (ev) => {
      const nome  = fundo.querySelector('#usNome').value.trim();
      const email = fundo.querySelector('#usEmail').value.trim();
      const perfil = fundo.querySelector('#usPerfil').value;
      const func  = fundo.querySelector('#usFunc').value || null;
      if (!nome || !email) { mostrarErro('Informe o nome e o e-mail.'); return; }

      ev.target.disabled = true;
      try {
        const codigo = await dados.convidar(nome, email, perfil, func);
        fundo.innerHTML = cascaHtml('Acesso criado', `
          <div class="us-codigo-box">
            <span class="us-codigo-rot">Código de acesso</span>
            <strong class="us-codigo-grande">${esc(codigo)}</strong>
            <button class="us-btn" type="button" data-copiar>Copiar código</button>
          </div>
          <p class="us-ajuda">
            Envie este código para <b>${esc(email)}</b> criar a conta no Evollo.
            Ele vale por 14 dias, serve uma vez só e pode ser cancelado a qualquer momento.
          </p>`, '<button class="us-btn-forte" type="button" data-fechar>Concluir</button>');
        ligarFechar(fundo, () => { fechar(); aoSalvar?.(); });
        fundo.querySelector('[data-copiar]')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(codigo); mostrarToast('Código copiado.'); }
          catch { mostrarErro('Não consegui copiar. Selecione o código à mão.'); }
        });
      } catch (e) {
        ev.target.disabled = false;
        mostrarErro(dados.traduzirErro(e));
      }
    });
  });
}


// ═══════════════════════════════════════════════════════════
// EDITAR USUÁRIO
// ═══════════════════════════════════════════════════════════
export function drawerEditarUsuario({ usuario, aoSalvar } = {}) {
  return abrirDrawer(async (fundo, fechar) => {
    fundo.innerHTML = cascaHtml('Editar usuário', '<p class="us-carregando">Carregando…</p>', '');

    let perfis = [], permissoes = [];
    try {
      [perfis, permissoes] = await Promise.all([
        dados.listarPerfis(),
        dados.permissoesDoUsuario(usuario.id),
      ]);
    } catch (e) { mostrarErro(dados.traduzirErro(e)); fechar(); return; }

    const desenhar = () => {
      const redundantes = excecoesRedundantes(permissoes);
      const corpo = `
        <div class="us-dw-id">
          <div class="us-nome">${esc(usuario.nome)}</div>
          <div class="us-email">${esc(usuario.email)}</div>
          ${usuario.e_proprietario ? '<span class="us-badge us-badge-prop">PROPRIETÁRIO</span>' : ''}
        </div>

        <div class="us-campo">
          <label for="usPerfilEd">Perfil</label>
          <div class="us-perfil-linha">
            <select id="usPerfilEd"${usuario.e_proprietario ? ' disabled' : ''}>
              ${usuario.e_proprietario
                ? `<option>${esc(usuario.perfil_nome)}</option>`
                : perfis.map(p => `<option value="${esc(p.id)}"${p.chave === usuario.perfil_chave ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}
            </select>
            ${usuario.e_proprietario ? '' :
              '<button class="us-btn-forte" type="button" data-salvar-perfil disabled>Salvar</button>'}
          </div>
        </div>
        ${usuario.e_proprietario
          ? '<p class="us-ajuda">O perfil do proprietário não é alterado por aqui.</p>'
          : '<p class="us-ajuda">Escolha o perfil e clique em <b>Salvar</b>. A troca só vale depois que o banco confirmar.</p>'}

        ${redundantes.length ? `
          <div class="us-aviso">
            <i data-lucide="info"></i>
            <div>
              <b>${redundantes.length} personalizaç${redundantes.length === 1 ? 'ão deixou' : 'ões deixaram'} de fazer diferença</b>
              <div>Com o perfil atual, ${esc(redundantes.slice(0, 3).join('; '))}${redundantes.length > 3 ? '…' : ''} já ${redundantes.length === 1 ? 'segue' : 'seguem'} o padrão. Nada foi apagado.</div>
            </div>
          </div>` : ''}

        <h3 class="us-dw-t">Permissões</h3>
        <p class="us-ajuda">
          <b>Padrão</b> segue o perfil. <b>Permitir</b> e <b>Bloquear</b> valem só para esta pessoa
          e vencem o perfil.
        </p>
        ${permissoesHtml(permissoes)}`;

      const pe = `
        <button class="us-btn${usuario.status === 'ativo' ? ' us-btn-perigo' : ''}" type="button" data-status>
          ${usuario.status === 'ativo' ? 'Bloquear acesso' : 'Reativar acesso'}
        </button>
        <button class="us-btn-forte" type="button" data-fechar>Concluir</button>`;

      fundo.innerHTML = cascaHtml('Editar usuário', corpo, pe);
      window.renderIcons?.();
      ligarFechar(fundo, () => { fechar(); aoSalvar?.(); });
      ligarEdicao();
    };

    function ligarEdicao() {
      // O SELECT NÃO SALVA. Ele só habilita o botão.
      //
      // Antes a RPC disparava no `change`, e isso escondeu uma falha por uma
      // rodada inteira: `<select>` só emite `change` quando o valor MUDA, então
      // abrir a lista e clicar na opção já marcada não dispara nada — e não
      // havia como distinguir "não cliquei" de "cliquei e falhou". Sem botão,
      // sem estado de ocupado e sem confirmação, o silêncio era ambíguo.
      const sel  = fundo.querySelector('#usPerfilEd');
      const btnP = fundo.querySelector('[data-salvar-perfil]');
      const perfilAtualId = perfis.find(p => p.chave === usuario.perfil_chave)?.id;

      sel?.addEventListener('change', () => {
        if (btnP) btnP.disabled = (sel.value === perfilAtualId);
      });

      btnP?.addEventListener('click', async () => {
        btnP.disabled = true;
        const rotulo = btnP.textContent;
        btnP.textContent = 'Salvando…';
        try {
          const r = await dados.trocarPerfil({
            usuarioId: usuario.id,
            perfilAtualId,
            perfilNovoId: sel.value,
          });
          if (!r.mudou) { btnP.textContent = rotulo; return; }

          // O que a tela passa a mostrar é o que o BANCO devolveu, não o que
          // foi enviado. Se ele tivesse recusado, o erro cairia no catch e a
          // tela continuaria mostrando o perfil antigo — que é a verdade.
          Object.assign(usuario, r.usuario);
          permissoes = await dados.permissoesDoUsuario(usuario.id);
          mostrarToast('Perfil atualizado.');
          aoSalvar?.();     // a lista atrás reflete na hora, sem F5
          desenhar();
        } catch (err) {
          console.error('Usuários · trocar perfil:', err);
          mostrarErro(dados.traduzirErro(err));
          btnP.textContent = rotulo;
          btnP.disabled = false;   // dá para tentar de novo; o drawer não fecha
        }
      });

      fundo.querySelectorAll('[data-perm]').forEach(b =>
        b.addEventListener('click', async () => {
          try {
            await dados.definirPermissao(usuario.id, b.dataset.perm, b.dataset.modo);
            permissoes = await dados.permissoesDoUsuario(usuario.id);
            desenhar();
          } catch (err) { mostrarErro(dados.traduzirErro(err)); }
        }));

      fundo.querySelector('[data-status]')?.addEventListener('click', async () => {
        const bloquear = usuario.status === 'ativo';
        if (bloquear && !confirm(
          `Bloquear acesso de ${usuario.nome}?\n\n` +
          'Essa pessoa não conseguirá acessar os dados da organização até ser reativada.')) return;
        try {
          await dados.definirStatus(usuario.id, bloquear ? 'bloqueado' : 'ativo');
          usuario.status = bloquear ? 'bloqueado' : 'ativo';
          mostrarToast(bloquear ? 'Acesso bloqueado.' : 'Acesso reativado.');
          desenhar();
        } catch (err) { mostrarErro(dados.traduzirErro(err)); }
      });
    }

    desenhar();
  });
}


// ═══════════════════════════════════════════════════════════
// CONTA FORA DA ORGANIZAÇÃO — só diagnóstico
// ═══════════════════════════════════════════════════════════
export function drawerContaExterna({ conta } = {}) {
  return abrirDrawer(async (fundo, fechar) => {
    fundo.innerHTML = cascaHtml('Conta fora da organização', '<p class="us-carregando">Carregando…</p>', '');

    let linhas = [];
    try { linhas = await dados.detalheContaExterna(conta.user_id); }
    catch (e) { mostrarErro(dados.traduzirErro(e)); fechar(); return; }

    const grupos = new Map();
    for (const l of linhas) {
      if (!grupos.has(l.grupo)) grupos.set(l.grupo, []);
      grupos.get(l.grupo).push(l);
    }

    const corpo = `
      ${[...grupos].map(([grupo, itens]) => `
        <h3 class="us-dw-t">${esc(grupo)}</h3>
        ${itens.map(i => `
          <div class="us-linha">
            <span>${esc(i.item)}</span>
            <b class="${i.grupo === 'DADOS' && i.valor !== '0' ? 'us-tem-dado' : ''}">${esc(i.valor)}</b>
          </div>`).join('')}`).join('')}

      <div class="us-aviso">
        <i data-lucide="info"></i>
        <div>
          <b>Nada aqui foi alterado</b>
          <div>Esta conta não pertence a nenhuma organização. Decidir o que fazer com ela
          — criar organização própria, migrar os dados ou encerrar — é uma decisão
          administrativa, e não acontece por esta tela.</div>
        </div>
      </div>`;

    fundo.innerHTML = cascaHtml('Conta fora da organização', corpo,
      '<button class="us-btn-forte" type="button" data-fechar>Fechar</button>');
    window.renderIcons?.();
    ligarFechar(fundo, fechar);
  });
}

function ligarFechar(fundo, fechar) {
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));
}
