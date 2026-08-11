// ═══════════════════════════════════════════════════════════
// USUÁRIOS E ACESSOS — a tela
// ═══════════════════════════════════════════════════════════
// Três blocos, e a ordem importa: indicadores, quem tem acesso, e — separado —
// as contas que NÃO pertencem à organização.
//
// A separação do terceiro bloco não é estética. Misturar essas contas na lista
// principal faria parecer que são membros com algum problema, quando são
// pessoas fora da organização com dados próprios. São dois assuntos.

import * as dados from './usuarios-data.js';
import { pode } from './permissoes.js';
import { mostrarToast, mostrarErro } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const alvo = () => document.getElementById('page-usuarios');

// ── formatação ─────────────────────────────────────────────
const dataBR = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

/** "Hoje, 08:42" / "Ontem" / "12/07" / "nunca entrou". */
export function ultimoAcesso(iso) {
  if (!iso) return 'nunca entrou';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hoje = new Date();
  const dia = x => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  const hora = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (dia(d) === dia(hoje))  return `Hoje, ${hora}`;
  if (dia(d) === dia(ontem)) return `Ontem, ${hora}`;
  return dataBR(iso);
}

// ── marcação ───────────────────────────────────────────────
export function indicadoresHtml({ usuarios = [], fora = [] }) {
  const ativos = usuarios.filter(u => u.status === 'ativo').length;
  const bloq   = usuarios.filter(u => u.status === 'bloqueado').length;
  // Faixa, não quatro cartões: são quatro números pequenos, e cartão grande
  // para número pequeno empurra a lista — que é o assunto — para fora da tela.
  return `
    <div class="us-faixa">
      <div class="us-ind"><b>${usuarios.length}</b><span>Usuários</span></div>
      <div class="us-ind"><b>${ativos}</b><span>Ativos</span></div>
      <div class="us-ind${bloq ? ' us-ind-alerta' : ''}"><b>${bloq}</b><span>Bloqueados</span></div>
      <div class="us-ind${fora.length ? ' us-ind-alerta' : ''}"><b>${fora.length}</b><span>Fora da organização</span></div>
    </div>`;
}

export function linhaUsuarioHtml(u) {
  const podeGerir = pode('usuarios.gerenciar');
  // O último proprietário ativo não recebe ações destrutivas na interface. A
  // trava de verdade é o trigger no banco; isto evita oferecer o que vai falhar.
  const acoes = podeGerir && !u.sou_eu
    ? `<button class="us-btn-acao" type="button" data-editar="${esc(u.id)}">Editar</button>`
    : podeGerir
      ? `<button class="us-btn-acao" type="button" data-editar="${esc(u.id)}">Editar</button>`
      : '';

  return `
    <tr>
      <td>
        <div class="us-nome">${esc(u.nome)}${u.sou_eu ? ' <span class="us-eu">você</span>' : ''}</div>
        <div class="us-email">${esc(u.email)}</div>
      </td>
      <td>
        ${esc(u.perfil_nome)}
        ${u.e_proprietario ? '<span class="us-badge us-badge-prop">PROPRIETÁRIO</span>' : ''}
        ${u.excecoes ? `<span class="us-badge us-badge-exc">${u.excecoes} exceç${u.excecoes === 1 ? 'ão' : 'ões'}</span>` : ''}
      </td>
      <td>${u.funcionario_nome ? esc(u.funcionario_nome) : '<span class="us-vazio">—</span>'}</td>
      <td><span class="us-status us-status-${esc(u.status)}">${u.status === 'ativo' ? 'Ativo' : 'Bloqueado'}</span></td>
      <td class="us-num">${esc(ultimoAcesso(u.ultimo_acesso_em))}</td>
      <td class="us-acoes">${acoes}</td>
    </tr>`;
}

export function linhaConviteHtml(c) {
  return `
    <tr class="us-pendente">
      <td>
        <div class="us-nome">${esc(c.nome)}</div>
        <div class="us-email">${esc(c.email)}</div>
      </td>
      <td>${esc(c.perfil_nome)}</td>
      <td colspan="2">
        <code class="us-codigo">${esc(c.codigo)}</code>
        <span class="us-status us-status-pendente">${c.expirado ? 'Expirado' : 'Aguardando'}</span>
      </td>
      <td class="us-num">expira ${esc(dataBR(c.expira_em))}</td>
      <td class="us-acoes">
        <button class="us-btn-acao" type="button" data-copiar="${esc(c.codigo)}">Copiar</button>
        <button class="us-btn-acao us-btn-sutil" type="button" data-revogar="${esc(c.id)}">Cancelar</button>
      </td>
    </tr>`;
}

export function contasForaHtml(contas) {
  if (!contas.length) return '';
  return `
    <section class="us-secao us-secao-fora">
      <h3>Contas fora da organização</h3>
      <p class="us-ajuda">
        Contas que existem no Evollo e <b>não pertencem</b> a esta organização.
        Não são membros da equipe. Nada aqui foi alterado — a tela é de análise.
      </p>
      <table class="us-tabela">
        <tbody>
          ${contas.map(c => `
            <tr>
              <td>
                <div class="us-nome">${esc(c.email)}</div>
                <div class="us-email">criada em ${esc(dataBR(c.criada_em))}</div>
              </td>
              <td class="us-num">último acesso ${esc(ultimoAcesso(c.ultimo_login))}</td>
              <td>${c.pacientes
                    ? `<b>${c.pacientes}</b> paciente${c.pacientes === 1 ? '' : 's'}`
                    : '<span class="us-vazio">sem dados</span>'}</td>
              <td class="us-acoes">
                <button class="us-btn-acao" type="button" data-analisar="${esc(c.user_id)}">Analisar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

export function telaHtml({ usuarios, convites, fora }) {
  return `
    <div class="us-topo">
      <div>
        <h2>Usuários e acessos</h2>
        <p class="us-sub">Controle quem pode acessar o Evollo e o que cada pessoa pode fazer.</p>
      </div>
      ${pode('usuarios.gerenciar')
        ? '<button class="us-btn-forte" type="button" data-novo><i data-lucide="plus"></i> Novo usuário</button>'
        : ''}
    </div>

    ${indicadoresHtml({ usuarios, fora })}

    <section class="us-secao">
      <table class="us-tabela">
        <thead>
          <tr><th>Usuário</th><th>Perfil</th><th>Vínculo</th><th>Status</th><th>Último acesso</th><th></th></tr>
        </thead>
        <tbody>
          ${usuarios.map(linhaUsuarioHtml).join('')}
          ${convites.map(linhaConviteHtml).join('')}
        </tbody>
      </table>
    </section>

    ${contasForaHtml(fora)}`;
}

/** A tela de bloqueio. Nenhum dado é buscado antes dela. */
export function semAcessoHtml() {
  return `
    <div class="us-bloqueado">
      <i data-lucide="lock"></i>
      <h2>Você não tem acesso a esta área.</h2>
      <p>Fale com o proprietário da conta se precisar gerenciar usuários.</p>
    </div>`;
}

// ── permissões, agrupadas por módulo ───────────────────────
const ROTULO_MODULO = {
  clientes: 'Clientes', clinico: 'Clínico', alimentacao: 'Alimentação',
  alimentos: 'Banco de alimentos', treinos: 'Treinos', exercicios: 'Exercícios',
  checkins: 'Check-ins', documentos: 'Documentos', comercial: 'Comercial',
  financeiro: 'Financeiro', equipe: 'Equipe', usuarios: 'Usuários',
};

export function permissoesHtml(linhas) {
  const grupos = new Map();
  for (const p of linhas) {
    if (!grupos.has(p.modulo)) grupos.set(p.modulo, []);
    grupos.get(p.modulo).push(p);
  }

  return [...grupos].map(([modulo, itens]) => `
    <div class="us-grupo">
      <h4>${esc(ROTULO_MODULO[modulo] || modulo)}</h4>
      ${itens.map(p => `
        <div class="us-perm${p.sensivel ? ' us-perm-sensivel' : ''}">
          <div class="us-perm-id">
            <span class="us-perm-nome">${esc(p.descricao)}</span>
            <span class="us-perm-origem us-origem-${p.modo === 'perfil' ? 'herdado' : 'custom'}">
              ${p.modo === 'perfil' ? 'Herdado do perfil' : 'Personalizado'}
            </span>
          </div>
          <div class="us-perm-modo" role="group" aria-label="${esc(p.descricao)}">
            ${['perfil', 'permitir', 'bloquear'].map(m => `
              <button type="button"
                      class="us-modo${p.modo === m ? ' ativo' : ''}"
                      data-perm="${esc(p.chave)}" data-modo="${m}">
                ${m === 'perfil' ? (p.do_perfil ? 'Padrão · permite' : 'Padrão · nega')
                  : m === 'permitir' ? 'Permitir' : 'Bloquear'}
              </button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

/**
 * Exceções que deixaram de fazer diferença depois da troca de perfil.
 *
 * O §16: não apagar personalização em silêncio. Mas também não deixar o
 * administrador com uma exceção que não muda nada e que ele acha que muda —
 * "Permitir" sobre algo que o novo perfil já permite é ruído que parece regra.
 */
export function excecoesRedundantes(linhas) {
  return linhas
    .filter(p => p.modo !== 'perfil')
    .filter(p => (p.modo === 'permitir' && p.do_perfil) || (p.modo === 'bloquear' && !p.do_perfil))
    .map(p => p.descricao);
}

// ── comportamento ──────────────────────────────────────────
let _estado = { usuarios: [], convites: [], fora: [] };

export async function abrirUsuarios() {
  const caixa = alvo();
  if (!caixa) return;

  // A verificação vem ANTES de qualquer ida à rede: não se busca dado para
  // depois escondê-lo.
  if (!pode('usuarios.visualizar')) {
    caixa.innerHTML = semAcessoHtml();
    window.renderIcons?.();
    return;
  }

  caixa.innerHTML = '<div class="us-carregando">Carregando…</div>';
  try {
    const [usuarios, convites, fora] = await Promise.all([
      dados.listarUsuarios(),
      pode('usuarios.gerenciar') ? dados.listarConvites()   : [],
      pode('usuarios.gerenciar') ? dados.listarContasFora() : [],
    ]);
    _estado = { usuarios: usuarios || [], convites: convites || [], fora: fora || [] };
    caixa.innerHTML = telaHtml(_estado);
    window.renderIcons?.();
    ligar(caixa);
  } catch (e) {
    console.error('Usuários:', e);
    caixa.innerHTML = `<div class="us-bloqueado"><p>${esc(dados.traduzirErro(e))}</p></div>`;
  }
}

function ligar(caixa) {
  caixa.querySelector('[data-novo]')?.addEventListener('click', () => abrirNovoUsuario());

  caixa.querySelectorAll('[data-copiar]').forEach(b =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        mostrarToast('Código copiado.');
      } catch { mostrarErro('Não consegui copiar. Selecione o código à mão.'); }
    }));

  caixa.querySelectorAll('[data-revogar]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('Cancelar este convite? O código deixa de funcionar.')) return;
      try {
        await dados.revogarConvite(b.dataset.revogar);
        mostrarToast('Convite cancelado.');
        abrirUsuarios();
      } catch (e) { mostrarErro(dados.traduzirErro(e)); }
    }));

  caixa.querySelectorAll('[data-editar]').forEach(b =>
    b.addEventListener('click', () => abrirEdicao(b.dataset.editar)));

  caixa.querySelectorAll('[data-analisar]').forEach(b =>
    b.addEventListener('click', () => abrirContaExterna(b.dataset.analisar)));
}

// Os drawers moram em módulo próprio, carregado só quando alguém abre um.
async function abrirNovoUsuario() {
  const { drawerNovoUsuario } = await import('./usuarios-drawer.js');
  drawerNovoUsuario({ aoSalvar: abrirUsuarios });
}

async function abrirEdicao(id) {
  const u = _estado.usuarios.find(x => x.id === id);
  if (!u) return;
  const { drawerEditarUsuario } = await import('./usuarios-drawer.js');
  drawerEditarUsuario({ usuario: u, aoSalvar: abrirUsuarios });
}

async function abrirContaExterna(userId) {
  const c = _estado.fora.find(x => x.user_id === userId);
  const { drawerContaExterna } = await import('./usuarios-drawer.js');
  drawerContaExterna({ conta: c });
}
