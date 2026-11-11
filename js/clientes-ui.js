// ═══════════════════════════════════════════════════════════
// CLIENTES — a lista, a busca e o cadastro (painel)
// ═══════════════════════════════════════════════════════════
// 11/11/2026: o formulário de cadastro aberto no topo da página saiu (era
// confundido com a busca) e virou um painel lateral, aberto por "Novo
// cliente". A busca virou o elemento central, com filtro de anamnese,
// ordenação e contagem.
//
// O DEFEITO QUE A BUSCA TINHA: ao entrar em Clientes (ou depois de cadastrar),
// `carregarPacientes` redesenhava a lista INTEIRA, ignorando o texto que
// continuava no campo — "eduard" digitado e todo mundo na tela. Agora toda
// pintura passa por `pintar()`, que SEMPRE aplica busca + filtro + ordem do
// estado atual.
//
// Os dados: `listarPacientes` traz TODOS os clientes que o RLS deixa ver (sem
// paginação), então a busca roda no conjunto autorizado completo, na memória,
// sem requisição — não há resposta antiga para sobrescrever a nova.
//
// "Aguardando"/"Completo" (pacientes.status) é o PREENCHIMENTO DA ANAMNESE:
// nasce 'aguardando' e vira 'completo' quando o cliente envia o questionário
// (rpc_marcar_completo). Não é situação financeira nem de acompanhamento.

import { escaparHtml as esc } from './html-seguro.js';
import { mostrarToast } from './utils.js';

// ── Regras puras (testadas em test/clientes-ui.test.mjs) ────
export const ANAMNESE = {
  aguardando: { rotulo: 'Aguardando resposta', tom: 'espera' },
  completo:   { rotulo: 'Respondida',          tom: 'ok' },
};
export const ORDENS = {
  recentes: 'Mais recentes',
  nome: 'Nome (A–Z)',
};

/** Minúsculas e sem acento: "Eduárdo" e "eduardo" se encontram. */
export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
export const soDigitos = s => String(s ?? '').replace(/\D/g, '');

/**
 * O cliente bate com a busca? Nome e e-mail sem acento/caixa; WhatsApp só
 * pelos dígitos ("(31) 99999-1234" acha "31999991234" e vice-versa); o código
 * de acesso continua valendo, como antes.
 */
export function bateComBusca(p, termo) {
  const t = normalizar(termo);
  if (!t) return true;
  if (normalizar(p.nome).includes(t)) return true;
  if (normalizar(p.email).includes(t)) return true;
  if (normalizar(p.codigo).includes(t)) return true;
  const d = soDigitos(termo);
  // Telefone só a partir de 3 dígitos: "2" acharia meia agenda.
  return d.length >= 3 && soDigitos(p.telefone).includes(d);
}

export const statusDaAnamnese = p => (p?.status === 'completo' ? 'completo' : 'aguardando');

/** Busca + filtro + ordem, juntos. Não muda a lista recebida. */
export function filtrarClientes(lista = [], { busca = '', anamnese = '', ordem = 'recentes' } = {}) {
  const saida = lista.filter(p => bateComBusca(p, busca) && (!anamnese || statusDaAnamnese(p) === anamnese));
  if (ordem === 'nome') {
    saida.sort((a, b) => normalizar(a.nome || '\uffff').localeCompare(normalizar(b.nome || '\uffff'), 'pt-BR'));
  } else {
    saida.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  }
  return saida;
}

/** "12 clientes" sem busca/filtro; "3 resultados" com. */
export function textoContagem(n, filtrando) {
  if (filtrando) return n === 1 ? '1 resultado' : `${n} resultados`;
  return n === 1 ? '1 cliente' : `${n} clientes`;
}

/**
 * Cadastro: o nome é obrigatório; e-mail e WhatsApp são opcionais, mas se
 * vierem precisam fazer sentido. Devolve { campo: mensagem }.
 */
export function validarNovoCliente({ nome = '', email = '', telefone = '' } = {}) {
  const erros = {};
  if (!String(nome).trim()) erros.nome = 'Informe o nome do cliente.';
  const e = String(email).trim();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) erros.email = 'Confira o e-mail — falta o @ ou o domínio.';
  const d = soDigitos(telefone);
  if (String(telefone).trim() && (d.length < 10 || d.length > 13)) erros.telefone = 'Use DDD + número, ex.: (31) 99999-1234.';
  return erros;
}

const iniciais = nome => {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
const dataCurta = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Uma linha da tabela. Todo dado do banco passa por esc(). */
export function linhaHtml(p) {
  const st = statusDaAnamnese(p);
  const a = ANAMNESE[st];
  const nome = p.nome || '(sem nome)';
  const desde = dataCurta(p.criado_em);
  return `<tr class="cli-linha">
      <td class="cli-c-cliente"><div class="cli-cel">
        <span class="cli-avatar" aria-hidden="true">${esc(iniciais(p.nome))}</span>
        <span class="cli-id">
          <button type="button" class="cli-nome" data-cli="ficha" data-id="${esc(p.id)}">${esc(nome)}</button>
          ${desde ? `<span class="cli-desde">Cadastrado em ${esc(desde)}</span>` : ''}
        </span>
      </div></td>
      <td class="cli-c-anamnese"><span class="cli-tag cli-tag-${a.tom}"><span class="cli-tag-rot">Anamnese:</span>${esc(a.rotulo)}</span></td>
      <td class="cli-c-codigo">
        <span class="cli-codigo">${esc(p.codigo)}</span>
        <button type="button" class="cli-icone" data-cli="link" data-codigo="${esc(p.codigo)}"
          aria-label="Copiar link da anamnese de ${esc(nome)}" title="Copiar link da anamnese"><i data-lucide="copy"></i></button>
      </td>
      <td class="cli-c-acoes">
        <button type="button" class="btn cli-abrir" data-cli="ficha" data-id="${esc(p.id)}">Abrir ficha</button>
        <span class="cli-menu-raiz">
          <button type="button" class="cli-icone cli-mais" data-cli="menu" aria-haspopup="menu" aria-expanded="false"
            aria-label="Mais opções para ${esc(nome)}"><i data-lucide="ellipsis"></i></button>
          <span class="cli-menu" role="menu" hidden>
            <button type="button" role="menuitem" tabindex="-1" data-cli="app" data-codigo="${esc(p.codigo)}"><i data-lucide="smartphone"></i> Copiar link do app</button>
            <button type="button" role="menuitem" tabindex="-1" data-cli="link" data-codigo="${esc(p.codigo)}"><i data-lucide="link"></i> Copiar link da anamnese</button>
            <span class="cli-menu-sep" role="separator"></span>
            <button type="button" role="menuitem" tabindex="-1" class="cli-menu-perigo" data-cli="excluir" data-id="${esc(p.id)}" data-nome="${esc(p.nome || p.codigo)}"><i data-lucide="trash-2"></i> Excluir cliente</button>
          </span>
        </span>
      </td>
    </tr>`;
}

export function tabelaHtml(lista) {
  return `<div class="cli-sup">
    <table class="cli-tabela">
      <caption class="sr-only">Clientes</caption>
      <thead><tr>
        <th scope="col">Cliente</th>
        <th scope="col">Anamnese</th>
        <th scope="col">Código de acesso</th>
        <th scope="col"><span class="sr-only">Ações</span></th>
      </tr></thead>
      <tbody>${lista.map(linhaHtml).join('')}</tbody>
    </table>
  </div>`;
}

export function vazioHtml({ filtrando }) {
  return filtrando
    ? `<div class="cli-vazio" role="status">
        <i data-lucide="search-x"></i>
        <p class="cli-vazio-t">Nenhum cliente encontrado</p>
        <p class="cli-vazio-s">Confira a grafia ou tente outro filtro.</p>
        <button type="button" class="btn" data-cli="limpar">Limpar busca e filtros</button>
      </div>`
    : `<div class="cli-vazio" role="status">
        <i data-lucide="users"></i>
        <p class="cli-vazio-t">Você ainda não tem clientes</p>
        <p class="cli-vazio-s">Cadastre o primeiro para gerar o código de acesso à anamnese e ao app.</p>
        <button type="button" class="btn primary" data-cli="novo"><i data-lucide="plus"></i> Novo cliente</button>
      </div>`;
}

// ── A tela (navegador) ──────────────────────────────────────
let _lista = null;          // null = carregando
let _acoes = {};
let _ligada = false;
const _estado = { busca: '', anamnese: '', ordem: 'recentes' };

const $ = id => document.getElementById(id);
const filtrando = () => !!(_estado.busca.trim() || _estado.anamnese);

/**
 * Liga a barra de ferramentas e o botão "Novo cliente" UMA vez.
 * acoes: { abrirFicha(id), copiarLinkAnamnese(codigo), copiarLinkApp(codigo),
 *          excluir(id, nome), criar({nome,email,telefone}) → paciente,
 *          aoCriar(), linkAnamnese(codigo), abrirWhatsapp(nome, link) }
 */
export function ligarTelaClientes(acoes = {}) {
  _acoes = acoes;
  if (_ligada) return;
  _ligada = true;

  const busca = $('cliBusca');
  const limpar = $('cliBuscaLimpar');
  // O navegador DEVOLVE o texto do campo ao recarregar a página. Lê o que já
  // está lá, para a primeira pintura respeitar.
  _estado.busca = busca?.value || '';
  busca?.addEventListener('input', () => { _estado.busca = busca.value; pintar(); });
  busca?.addEventListener('keydown', e => { if (e.key === 'Escape' && busca.value) { e.preventDefault(); limparBusca(); } });
  limpar?.addEventListener('click', () => { limparBusca(); busca?.focus(); });

  $('cliAnamnese')?.addEventListener('change', e => { _estado.anamnese = e.target.value; pintar(); });
  $('cliOrdem')?.addEventListener('change', e => { _estado.ordem = e.target.value; pintar(); });
  $('cliNovo')?.addEventListener('click', () => abrirNovoCliente());

  // Fecha menus abertos ao clicar fora.
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.cli-menu-raiz')) fecharMenus();
  });
}

function limparBusca() {
  const busca = $('cliBusca');
  if (busca) busca.value = '';
  _estado.busca = '';
  pintar();
}

/** Lista nova vinda do banco (ou null = carregando). */
export function definirClientes(lista) {
  _lista = Array.isArray(lista) ? lista : null;
  pintar();
}

export function pintar() {
  const cx = $('patientsContainer');
  const cont = $('cliContagem');
  const limpar = $('cliBuscaLimpar');
  if (limpar) limpar.hidden = !_estado.busca;
  if (!cx) return;
  if (_lista === null) {
    if (cont) cont.textContent = 'Carregando…';
    return;   // o spinner é desenhado por quem carrega
  }
  const lista = filtrarClientes(_lista, _estado);
  if (cont) cont.textContent = textoContagem(lista.length, filtrando());
  cx.innerHTML = lista.length ? tabelaHtml(lista) : vazioHtml({ filtrando: filtrando() || _lista.length > 0 });
  window.renderIcons?.();
  ligarLinhas(cx);
}

function ligarLinhas(cx) {
  cx.querySelectorAll('[data-cli]').forEach(b => b.addEventListener('click', e => {
    const a = b.dataset.cli;
    if (a === 'menu') { e.stopPropagation(); alternarMenu(b); return; }
    if (a !== 'menu') fecharMenus();
    if (a === 'ficha') _acoes.abrirFicha?.(b.dataset.id);
    else if (a === 'link') _acoes.copiarLinkAnamnese?.(b.dataset.codigo);
    else if (a === 'app') _acoes.copiarLinkApp?.(b.dataset.codigo);
    else if (a === 'excluir') _acoes.excluir?.(b.dataset.id, b.dataset.nome);
    else if (a === 'limpar') limparTudo();
    else if (a === 'novo') abrirNovoCliente();
  }));
  cx.querySelectorAll('.cli-menu').forEach(m => m.addEventListener('keydown', e => teclasDoMenu(e, m)));
}

function limparTudo() {
  const busca = $('cliBusca'); if (busca) busca.value = '';
  const an = $('cliAnamnese'); if (an) an.value = '';
  _estado.busca = ''; _estado.anamnese = '';
  pintar();
  $('cliBusca')?.focus();
}

// ── Menu "…" acessível ───────────────────────────────────────
function fecharMenus(exceto = null) {
  document.querySelectorAll('.cli-menu:not([hidden])').forEach(m => {
    if (m === exceto) return;
    m.hidden = true;
    m.closest('.cli-menu-raiz')?.querySelector('.cli-mais')?.setAttribute('aria-expanded', 'false');
  });
}
function alternarMenu(botao) {
  const menu = botao.parentElement.querySelector('.cli-menu');
  const abrir = menu.hidden;
  fecharMenus(menu);
  menu.hidden = !abrir;
  botao.setAttribute('aria-expanded', String(abrir));
  if (abrir) menu.querySelector('[role="menuitem"]')?.focus();
}
function teclasDoMenu(e, menu) {
  const itens = [...menu.querySelectorAll('[role="menuitem"]')];
  const i = itens.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); itens[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); itens[itens.length - 1].focus(); }
  else if (e.key === 'Escape' || e.key === 'Tab') {
    if (e.key === 'Escape') e.preventDefault();
    const botao = menu.closest('.cli-menu-raiz').querySelector('.cli-mais');
    fecharMenus();
    if (e.key === 'Escape') botao.focus();
  }
}

// ── Painel "Novo cliente" (mesmo drawer do financeiro: .dsp-*) ──
let _painelAberto = false;

export function painelHtml({ form = {}, erros = {}, salvando = false, erroGeral = '' } = {}) {
  const campo = (id, rotulo, tipo, valor, extra = '', opcional = false) => `
    <div class="dsp-campo${erros[id] ? ' dsp-erro-campo' : ''}">
      <label for="cliNovo-${id}">${rotulo}${opcional ? ' <span class="cli-opc">(opcional)</span>' : ' <span class="dsp-req" aria-hidden="true">*</span>'}</label>
      <input class="np-input" id="cliNovo-${id}" name="${id}" type="${tipo}" value="${esc(valor || '')}" ${extra}
        ${erros[id] ? `aria-invalid="true" aria-describedby="cliNovo-${id}-erro"` : ''}>
      ${erros[id] ? `<span class="dsp-erro" id="cliNovo-${id}-erro">${esc(erros[id])}</span>` : ''}
    </div>`;
  return `
    <aside class="dsp-drawer cli-drawer" role="dialog" aria-modal="true" aria-labelledby="cliNovoTit">
      <header class="dsp-topo">
        <div class="dsp-topo-txt">
          <div class="dsp-eyebrow"><i data-lucide="user-plus"></i> Clientes</div>
          <h2 class="dsp-titulo" id="cliNovoTit">Novo cliente</h2>
          <p class="dsp-sub">Ao cadastrar, o sistema gera o código de acesso à anamnese e ao app.</p>
        </div>
        <button type="button" class="dsp-x" data-cli-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>
      <form class="dsp-body cli-form" id="cliNovoForm" novalidate>
        ${erroGeral ? `<div class="cli-erro-geral" role="alert"><i data-lucide="circle-alert"></i><span>${esc(erroGeral)}</span></div>` : ''}
        <div class="dsp-secao">
          ${campo('nome', 'Nome do cliente', 'text', form.nome, 'autocomplete="off" required')}
          ${campo('email', 'E-mail', 'email', form.email, 'autocomplete="off" inputmode="email"', true)}
          ${campo('telefone', 'WhatsApp', 'tel', form.telefone, 'autocomplete="off" inputmode="tel" placeholder="(31) 99999-1234"', true)}
        </div>
      </form>
      <footer class="dsp-ft">
        <span></span>
        <div class="dsp-ft-dir">
          <button type="button" class="btn" data-cli-fechar>Cancelar</button>
          <button type="submit" form="cliNovoForm" class="btn primary" id="cliNovoSalvar" ${salvando ? 'disabled aria-busy="true"' : ''}>
            ${salvando ? '<span class="cli-spin" aria-hidden="true"></span> Cadastrando…' : '<i data-lucide="check"></i> Cadastrar cliente'}
          </button>
        </div>
      </footer>
    </aside>`;
}

export function sucessoHtml({ nome, codigo, link }) {
  return `
    <aside class="dsp-drawer cli-drawer" role="dialog" aria-modal="true" aria-labelledby="cliNovoTit">
      <header class="dsp-topo">
        <div class="dsp-topo-txt">
          <div class="dsp-eyebrow"><i data-lucide="user-plus"></i> Clientes</div>
          <h2 class="dsp-titulo" id="cliNovoTit">Cliente cadastrado</h2>
          <p class="dsp-sub">${esc(nome || 'O cliente')} já está na sua lista.</p>
        </div>
        <button type="button" class="dsp-x" data-cli-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>
      <div class="dsp-body">
        <div class="cli-ok" role="status">
          <span class="cli-ok-rot"><i data-lucide="circle-check"></i> Código de acesso</span>
          <span class="cli-ok-cod">${esc(codigo)}</span>
          <span class="cli-ok-link">${esc(link)}</span>
          <div class="cli-ok-acoes">
            <button type="button" class="btn" data-cli-ok="copiar"><i data-lucide="copy"></i> Copiar link da anamnese</button>
            <button type="button" class="btn" data-cli-ok="whatsapp"><i data-lucide="message-circle"></i> Enviar por WhatsApp</button>
            <button type="button" class="btn" data-cli-ok="ver"><i data-lucide="eye"></i> Pré-visualizar</button>
          </div>
        </div>
      </div>
      <footer class="dsp-ft">
        <button type="button" class="btn" data-cli-ok="outro"><i data-lucide="plus"></i> Cadastrar outro</button>
        <div class="dsp-ft-dir"><button type="button" class="btn primary" data-cli-fechar>Concluir</button></div>
      </footer>
    </aside>`;
}

export function abrirNovoCliente() {
  if (_painelAberto) return;
  _painelAberto = true;
  const origem = document.activeElement;
  let form = { nome: '', email: '', telefone: '' };
  let erros = {}, erroGeral = '', salvando = false, concluido = null;

  const fundo = document.createElement('div');
  fundo.className = 'dsp-drawer-raiz';
  document.body.appendChild(fundo);
  document.body.classList.add('dsp-travado');

  const sujo = () => !concluido && Object.values(form).some(v => String(v).trim());
  const fechar = (forcado = false) => {
    if (salvando) return;
    if (!forcado && sujo() && !confirm('Você preencheu dados do cliente. Descartar o cadastro?')) return;
    document.removeEventListener('keydown', teclas);
    document.body.classList.remove('dsp-travado');
    fundo.remove();
    _painelAberto = false;
    (origem && document.contains(origem) ? origem : $('cliNovo'))?.focus?.();
  };
  function teclas(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
    if (e.key === 'Tab') prenderFoco(e);
  }
  document.addEventListener('keydown', teclas);
  // Clique no fundo escuro fecha (com a mesma proteção de dados).
  fundo.addEventListener('mousedown', e => { if (e.target === fundo) fechar(); });

  function prenderFoco(e) {
    const f = [...fundo.querySelectorAll('button:not([disabled]), input, [href]')].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const pri = f[0], ult = f[f.length - 1];
    if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
    else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
  }

  const coletar = () => {
    const g = n => fundo.querySelector(`#cliNovo-${n}`)?.value ?? '';
    form = { nome: g('nome'), email: g('email'), telefone: g('telefone') };
  };

  function desenhar(focar = 'nome') {
    fundo.innerHTML = concluido ? sucessoHtml(concluido) : painelHtml({ form, erros, salvando, erroGeral });
    window.renderIcons?.();
    fundo.querySelectorAll('[data-cli-fechar]').forEach(b => b.addEventListener('click', () => fechar()));
    if (concluido) {
      fundo.querySelectorAll('[data-cli-ok]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.cliOk;
        if (a === 'copiar') _acoes.copiarLinkAnamnese?.(concluido.codigo);
        else if (a === 'whatsapp') _acoes.abrirWhatsapp?.(concluido.nome, concluido.link);
        else if (a === 'ver') window.open(concluido.link, '_blank', 'noopener');
        else if (a === 'outro') { concluido = null; form = { nome: '', email: '', telefone: '' }; erros = {}; erroGeral = ''; desenhar(); }
      }));
      fundo.querySelector('[data-cli-ok="copiar"]')?.focus();
      return;
    }
    fundo.querySelector('#cliNovoForm').addEventListener('input', coletar);
    fundo.querySelector('#cliNovoForm').addEventListener('submit', e => { e.preventDefault(); salvar(); });
    const alvo = Object.keys(erros).length ? fundo.querySelector(`#cliNovo-${Object.keys(erros)[0]}`) : fundo.querySelector(`#cliNovo-${focar}`);
    if (!salvando) alvo?.focus();
  }

  async function salvar() {
    if (salvando) return;   // duplo clique / Enter repetido
    coletar();
    erros = validarNovoCliente(form);
    erroGeral = '';
    if (Object.keys(erros).length) { desenhar(); return; }
    salvando = true; desenhar();
    try {
      const dados = { nome: form.nome.trim(), email: form.email.trim(), telefone: form.telefone.trim() };
      const p = await _acoes.criar(dados);
      concluido = { nome: dados.nome, codigo: p.codigo, link: _acoes.linkAnamnese?.(p.codigo) || '' };
      salvando = false;
      desenhar();
      mostrarToast('✓ Cliente cadastrado');
      _acoes.aoCriar?.();
    } catch (e) {
      console.error(e);
      salvando = false;
      erroGeral = 'Não foi possível cadastrar o cliente. ' + (e?.message ? `Detalhe: ${e.message}` : 'Tente de novo.');
      desenhar();
      fundo.querySelector('#cliNovoSalvar')?.focus();
    }
  }

  desenhar();
}
