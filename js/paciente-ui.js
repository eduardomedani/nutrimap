// ═══════════════════════════════════════════════════════════
// PACIENTE — UI do app do aluno (login → vincular → treino + carga)
// ═══════════════════════════════════════════════════════════
// Monta tudo dentro de #app. Fluxo:
//   sem sessão            → tela de entrar / criar conta
//   sessão sem vínculo    → tela "digite seu código"
//   sessão + vínculo      → app (ver treino do dia + registrar carga)

import {
  entrar, cadastrar, sair, sessaoAtual,
  meuPaciente, vincularPorCodigo,
  meusTreinos, itensDoTreino,
  progressaoDoItem, progressaoDosItens, salvarSeries, excluirCarga,
  traduzirErro,
} from './paciente-data.js';
import { mostrarToast, mostrarErro, confirmar } from './utils.js';
import { pushSuportado, pushAtivo, ativarNotificacoes, desativarNotificacoes, traduzirPush } from './push.js';
import * as Exec from './paciente-execucao.js';
import { descansoDoItem, parseCadencia, fmtSegLongo } from './execucao-core.js';

// ── Estado ──
let _paciente = null;
let _treinos  = [];
let _treinoSel = null;   // id do treino selecionado
let _itens    = [];
let _dias     = [];
let _diaSel   = 'A';
let _progAbertas = new Set();
let _progCache = new Map();   // id do item -> regs (progressão) já carregada
let _secao    = 'inicio';     // seção ativa: 'inicio' | 'treino' | 'dieta'
let _view     = 'lista';      // dentro de treino: 'lista' (escolher dia) | 'treino' (página do dia)
let _treinosCarregados = false;

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// Descrição curta dos métodos (mesma referência do lado do nutri).
const MET_DESC = {
  'Bi-set':     'Dois exercícios em sequência, sem descanso entre eles.',
  'Tri-set':    'Três exercícios em sequência, sem descanso entre eles.',
  'Drop-set':   'Ao falhar, reduza a carga (~20%) e continue sem descanso — repita a queda 2–3x.',
  'Super-set':  'Dois exercícios de músculos antagonistas alternados, sem descanso.',
  'Rest-pause': 'Chegue à falha, descanse 10–15s e faça mais algumas repetições; repita.',
  'Piramidal':  'A cada série, aumente a carga e reduza as reps (crescente) — ou o inverso.',
  'Isometria':  'Sustente a contração parado, sem movimento, pelo tempo determinado.',
  'FST-7':      '7 séries do mesmo exercício com ~30–45s de descanso, buscando congestão máxima.',
  'Cluster':    'Fracione a série em mini-blocos de poucas reps com pausas curtas.',
};
function metodoInfo(metodo) {
  const key = String(metodo || '').trim().toLowerCase();
  if (!key) return null;
  const nome = Object.keys(MET_DESC).find(k => k.toLowerCase() === key);
  return nome ? { nome, desc: MET_DESC[nome] } : null;
}

// ── Técnicas avançadas (drop set) ──────────────────────────────
// Fonte da técnica hoje: o `metodo` prescrito pelo nutri (dropdown fixo).
// A arquitetura é intencionalmente extensível — cada série carrega no JSON
// um sub-objeto por técnica; por ora só `drop`. Para novas técnicas
// (rest-pause, bi-set, cluster, myo-reps...) basta uma nova config aqui.
const DROP_REDUCAO_PCT = 20;   // sugestão padrão de redução do drop set (%)

// O exercício usa drop set? (base para decidir quais séries têm a etapa extra)
function exercicioTemDrop(it) {
  return String(it?.metodo || '').trim().toLowerCase() === 'drop-set';
}
// A série `i` (0-based) tem drop? O nutri define em quantas das ÚLTIMAS séries
// o drop se aplica (it.drop_ultimas): 0 = todas; N = apenas as N últimas.
function serieTemDrop(it, i, nSeries) {
  if (!exercicioTemDrop(it)) return false;
  const n = Number(it?.drop_ultimas) || 0;
  return n <= 0 ? true : i >= nSeries - n;
}
// Arredonda o peso para o passo dos inputs (0,5 kg).
function arredMeio(v) { return Math.round(v * 2) / 2; }
function prefereMenosMovimento() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

const app = () => document.getElementById('app');

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
export async function iniciarApp() {
  ligarBotaoNotificacoes();
  ligarExecucao();
  renderCarregando('Abrindo...');
  try {
    const sessao = await sessaoAtual();
    if (!sessao) { renderAuth(); return; }

    // O usuário vem da sessão que acabou de ser lida: sem ele, `meuPaciente`
    // chamaria `getUser()`, que é mais uma ida à rede antes da primeira tela.
    _paciente = await meuPaciente(sessao.user);

    // Vínculo automático pelo código do link (app.html?codigo=XYZ).
    if (!_paciente) {
      const cod = codigoDaUrl();
      if (cod) {
        try {
          await vincularPorCodigo(cod);
          _paciente = await meuPaciente();
          limparCodigoDaUrl();
        } catch (e) {
          renderVincular(cod, traduzirErro(e.message));
          return;
        }
      }
    }

    if (!_paciente) { renderVincular(codigoDaUrl()); return; }

    // O app abre no Início, não no Treino: quem entra quer saber o que vem
    // agora, e só então decidir para onde ir.
    //
    // A exceção é o deep link da notificação: quem tocou em "novo documento"
    // já disse para onde quer ir, e cair no Início obrigaria a procurar de
    // novo o que o aviso acabou de anunciar. O hash é só um NOME DE ROTA — a
    // notificação nunca carrega URL assinada, e abrir o arquivo continua
    // exigindo o toque em Visualizar, com o RLS validando na hora.
    if (secaoDoHash() === 'documentos') renderDocumentos();
    else renderInicio();
  } catch (e) {
    renderErro(traduzirErro(e.message));
  }
}

// ── Ligações do motor de execução (uma vez por sessão do app) ──
// O módulo de execução conta o descanso; aqui a gente reage: mostra o tempo
// no cabeçalho, contabiliza o descanso do exercício e leva o aluno adiante.
let _execLigada = false;
function ligarExecucao() {
  if (_execLigada) return;
  _execLigada = true;
  Exec.configurarDescanso({
    aoTick: (est, resta) => {
      const mini = est ? document.querySelector('[data-rest-mini]') : null;
      if (mini) mini.textContent = Exec.fmtRelogio(resta);
      else atualizarHero();          // primeira vez (ou fim): redesenha a linha
    },
    aoTerminar: (est) => {
      if (!est) return;
      const gasto = est.pulado
        ? Math.max(0, est.dur * 1000 - Math.max(0, est.fim - Date.now()))
        : est.dur * 1000;
      exSomarDescanso(est.itemId, gasto);
      atualizarHero();
      if (est.pulado) { seguirDepoisDoDescanso(est); return; }
      anunciar(est.ultima ? 'Descanso concluído.' : 'Hora da próxima série.');
    },
    aoContinuar: (est) => seguirDepoisDoDescanso(est),
  });
}

// Depois do descanso (terminado ou pulado): devolve o foco para onde o
// aluno precisa agir — a próxima série, ou o resumo do exercício.
function seguirDepoisDoDescanso(est) {
  atualizarHero();
  if (!est) return;
  const box = document.querySelector(`[data-prog-box="${est.itemId}"]`);
  if (!box) return;
  marcarProximaSerie(box);
  if (est.ultima) {
    box.querySelector('[data-resumo-prox]')?.scrollIntoView({
      block: 'center', behavior: prefereMenosMovimento() ? 'auto' : 'smooth',
    });
    return;
  }
  focarProxima(box, est.serie);
}

/**
 * Rota pedida no hash (app.html#documentos), usada pelo deep link do push.
 *
 * Lista fechada de propósito: o hash vem de fora e não decide nada além de
 * qual tela abre. Um valor desconhecido cai no Início, sem erro.
 */
const ROTAS_DO_HASH = ['documentos'];
function secaoDoHash() {
  const h = String(location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0].toLowerCase();
  return ROTAS_DO_HASH.includes(h) ? h : null;
}

// Código embutido no link de convite (?codigo=XYZ), se houver.
function codigoDaUrl() {
  return (new URLSearchParams(location.search).get('codigo') || '').trim().toUpperCase();
}
// Limpa o ?codigo da URL depois de vincular, sem recarregar a página.
function limparCodigoDaUrl() {
  try { history.replaceState({}, '', location.pathname); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// TELA 1 — Entrar / criar conta
// ═══════════════════════════════════════════════════════════
function renderAuth(modo = 'entrar') {
  const entrarAtivo = modo === 'entrar';
  app().innerHTML = `
    <div class="pa-auth">
      <div class="pa-brand evo-logo evo-logo--stacked evo-logo--lg">
        <div class="evo-logo-mark" aria-hidden="true">E</div>
        <div>
          <div class="evo-logo-name">Evollo</div>
          <div class="pa-brand-sub">Área do aluno</div>
        </div>
      </div>

      <div class="pa-card">
        <div class="pa-tabs">
          <button class="pa-tab ${entrarAtivo ? 'active' : ''}" data-modo="entrar">Entrar</button>
          <button class="pa-tab ${!entrarAtivo ? 'active' : ''}" data-modo="cadastrar">Criar conta</button>
        </div>

        <label class="pa-label">Email</label>
        <input type="email" id="paEmail" class="pa-input" placeholder="voce@email.com" autocomplete="email">

        <label class="pa-label">Senha</label>
        <input type="password" id="paSenha" class="pa-input" placeholder="Mínimo 6 caracteres"
          autocomplete="${entrarAtivo ? 'current-password' : 'new-password'}">

        <button class="pa-btn" id="paSubmit">${entrarAtivo ? 'Entrar' : 'Criar conta'}</button>
        <div class="pa-msg" id="paMsg"></div>
      </div>

      <div class="pa-foot">${codigoDaUrl()
        ? 'Você foi convidado pelo seu profissional 🌿 Crie sua conta (email + senha) e seu treino aparece automaticamente.'
        : 'Use o email e a senha que você definir. Depois é só digitar o código que seu profissional te passou.'}</div>
    </div>`;

  app().querySelectorAll('.pa-tab').forEach(b =>
    b.addEventListener('click', () => renderAuth(b.dataset.modo)));

  const submit = document.getElementById('paSubmit');
  const doIt = () => entrarAtivo ? fazerEntrar() : fazerCadastro();
  submit.addEventListener('click', doIt);
  document.getElementById('paSenha').addEventListener('keydown', e => { if (e.key === 'Enter') doIt(); });
}

function lerCredenciais() {
  return {
    email: (document.getElementById('paEmail').value || '').trim(),
    senha: (document.getElementById('paSenha').value || '').trim(),
  };
}

async function fazerEntrar() {
  const { email, senha } = lerCredenciais();
  if (!email || !senha) return msg('Preencha email e senha.');
  travarSubmit(true, 'Entrando...');
  try {
    await entrar(email, senha);
    await iniciarApp();
  } catch (e) {
    travarSubmit(false, 'Entrar');
    msg(traduzirErro(e.message));
  }
}

async function fazerCadastro() {
  const { email, senha } = lerCredenciais();
  if (!email || !senha) return msg('Preencha email e senha.');
  if (senha.length < 6) return msg('Senha muito curta (mínimo 6 caracteres).');
  travarSubmit(true, 'Criando...');
  try {
    const { session } = await cadastrar(email, senha);
    if (!session) {
      // Projeto exige confirmação de email
      travarSubmit(false, 'Criar conta');
      msg('Conta criada! Confirme pelo link no seu email e depois toque em "Entrar".', true);
      return;
    }
    await iniciarApp();   // já logado → segue pro vínculo
  } catch (e) {
    travarSubmit(false, 'Criar conta');
    msg(traduzirErro(e.message));
  }
}

// ═══════════════════════════════════════════════════════════
// TELA 2 — Vincular pelo código
// ═══════════════════════════════════════════════════════════
function renderVincular(prefill = '', erro = '') {
  app().innerHTML = `
    <div class="pa-auth">
      <div class="pa-brand evo-logo evo-logo--stacked evo-logo--lg">
        <div class="evo-logo-mark" aria-hidden="true">E</div>
        <div>
          <div class="evo-logo-name">Quase lá</div>
          <div class="pa-brand-sub">Vincule sua conta</div>
        </div>
      </div>

      <div class="pa-card">
        <p class="pa-hint">Digite o <strong>código</strong> que seu profissional te enviou. Ele liga sua conta ao seu acompanhamento.</p>

        <label class="pa-label">Seu código</label>
        <input type="text" id="paCodigo" class="pa-input pa-codigo" placeholder="Ex.: ABC123" autocomplete="off" value="${esc(prefill || '')}">

        <button class="pa-btn" id="paVincular">Vincular</button>
        <div class="pa-msg" id="paMsg"></div>

        <button class="pa-link" id="paSair">Sair</button>
      </div>
    </div>`;

  const codigo = document.getElementById('paCodigo');
  codigo.addEventListener('input', () => { codigo.value = codigo.value.toUpperCase(); });
  const doIt = () => fazerVinculo();
  document.getElementById('paVincular').addEventListener('click', doIt);
  codigo.addEventListener('keydown', e => { if (e.key === 'Enter') doIt(); });
  document.getElementById('paSair').addEventListener('click', logout);
  if (erro) msg(erro);
  codigo.focus();
}

async function fazerVinculo() {
  const codigo = (document.getElementById('paCodigo').value || '').trim();
  if (!codigo) return msg('Digite seu código.');
  const btn = document.getElementById('paVincular');
  btn.disabled = true; btn.textContent = 'Vinculando...';
  try {
    await vincularPorCodigo(codigo);
    await iniciarApp();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Vincular';
    msg(traduzirErro(e.message));
  }
}

// ═══════════════════════════════════════════════════════════
// TELA 3 — Treino do aluno
// ═══════════════════════════════════════════════════════════
// Carrega treinos, itens, dias e progressão — sem desenhar nada. Quem chama
// decide a tela. Início e Treino comem da MESMA fonte: se cada um buscasse a
// sua, o "Treino do dia" do Início poderia discordar da lista de dias.
async function carregarTreino() {
  _treinos = await meusTreinos(_paciente?.id);
  _treinosCarregados = true;
  if (!_treinos.length) return false;
  _cron = cronCarregar();          // retoma a contagem de um treino em andamento
  if (!_cron) Exec.encerrarDescanso();   // sem sessão, descanso guardado é lixo

  if (!_treinoSel || !_treinos.some(t => t.id === _treinoSel)) {
    _treinoSel = _treinos[0].id;
  }
  _itens = await itensDoTreino(_treinoSel);
  _dias = diasComExercicios(_itens);
  if (!_dias.includes(_diaSel)) _diaSel = _dias[0] || 'A';
  _progAbertas.clear();
  await preCarregarProgressao();   // 1 consulta: deixa o "Registrar séries" instantâneo
  return true;
}

async function abrirTreino() {
  _secao = 'treino';
  renderCarregando('Carregando seu treino...');
  try {
    if (!await carregarTreino()) { renderSemTreino(); return; }
    _view = 'lista';                 // sempre abre na seleção de dias
    renderTreino();
  } catch (e) {
    renderErro(traduzirErro(e.message));
  }
}

// Dispatcher: tela de seleção de dias (lista) ou a página de um treino.
function renderTreino() {
  if (_view === 'treino' && _dias.includes(_diaSel)) renderTreinoDia();
  else { _view = 'lista'; renderListaDias(); }
}

// ── TELA A: seleção do dia (A/B/C/D…) + evolução + próximo sugerido ──
// ── "Treino atualizado" — lembrete in-app (compara com a última abertura) ──
// Formata um timestamp completo (timestamptz) em "dd/mm/aaaa às hh:mm".
function fmtQuando(ts) {
  if (!ts) return '';
  const dt = new Date(ts);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const _vistoKey = (id) => 'nm_treino_visto_' + id;
function treinoTemNovidade(t) {
  if (!t) return false;
  let visto = null;
  try { visto = localStorage.getItem(_vistoKey(t.id)); } catch {}
  if (!visto) return true;                                        // nunca aberto = novo
  return !!t.atualizado_em && new Date(t.atualizado_em) > new Date(visto);
}
function marcarTreinoVisto(t) {
  if (!t || !t.id) return;
  try { localStorage.setItem(_vistoKey(t.id), t.atualizado_em || new Date().toISOString()); } catch {}
}

function renderListaDias() {
  const nome = (_paciente?.nome || 'Aluno').trim().split(' ')[0];
  const proximo = proximoDiaSugerido();
  const treinadoHoje = diaTreinadoHoje();
  const treinoAtual = _treinos.find(t => t.id === _treinoSel);
  const quando = fmtQuando(treinoAtual?.atualizado_em);
  const lembrete = treinoTemNovidade(treinoAtual)
    ? `<div class="pa-lembrete" role="status">
         <i data-lucide="bell-ring"></i>
         <div class="pa-lembrete-txt"><b>Seu treino foi atualizado</b><span>${quando ? 'em ' + esc(quando) + ' ' : ''}pelo seu profissional.</span></div>
         <button class="pa-lembrete-x" data-visto aria-label="Dispensar aviso"><i data-lucide="x"></i></button>
       </div>`
    : '';

  const seletor = _treinos.length > 1
    ? `<div class="pa-lista-sel"><select id="paTreinoSel" class="pa-select">
        ${_treinos.map(x => `<option value="${x.id}" ${x.id === _treinoSel ? 'selected' : ''}>${esc(x.nome || 'Treino')}</option>`).join('')}
       </select></div>`
    : '';

  const titulo = treinadoHoje ? 'Mandou bem! 💪' : 'Vamos treinar?';
  const sub = treinadoHoje
    ? `Treino ${esc(treinadoHoje)} concluído hoje ✓${proximo ? ` · próximo: <b>Treino ${esc(proximo)}</b>` : ''}`
    : (proximo ? `Seu próximo treino: <b>Treino ${esc(proximo)}</b>` : 'Escolha um treino para começar');

  const cards = _dias.map(d => cardDia(d, proximo, treinadoHoje)).join('');

  app().innerHTML = `
    ${topo()}
    <main class="pa-main">
      <section class="pa-hero">
        <div class="pa-hero-hi">${saudacao()}, ${esc(nome)} 👋</div>
        <div class="pa-hero-title">${titulo}</div>
        <div class="pa-hero-sub">${sub}</div>
      </section>

      ${lembrete}
      ${statsTopo()}
      ${seletor}
      <div class="pa-diacards">${cards}</div>
    </main>
    ${bottomNav()}`;

  app().querySelectorAll('[data-abrir]').forEach(b =>
    b.addEventListener('click', () => {
      marcarTreinoVisto(treinoAtual);
      _diaSel = b.dataset.abrir;
      _view = 'treino';      // abrir é só ver; a contagem começa no "Iniciar treino"
      renderTreino();
    }));
  const btnVisto = app().querySelector('[data-visto]');
  if (btnVisto) btnVisto.addEventListener('click', () => { marcarTreinoVisto(treinoAtual); renderListaDias(); });
  const sel = document.getElementById('paTreinoSel');
  if (sel) sel.addEventListener('change', () => { _treinoSel = sel.value; _diaSel = 'A'; _view = 'lista'; abrirTreino(); });
  ligarShell();
  ligarTique();
}

// Card de um dia na lista de seleção.
function cardDia(dia, proximo, treinadoHoje) {
  const n = contarDia(dia);
  const grupos = gruposDoDia(dia).slice(0, 3).join(' · ');
  const feito = dia === treinadoHoje;
  const emAndamento = cronAtivo(dia);
  // Com treino em andamento, o destaque é dele; senão, do próximo sugerido.
  const isProx = emAndamento || (cronAtivo() ? false : dia === proximo && !feito);
  const min = resumoDia(dia).minutos;
  const exercicios = `${n} ${n === 1 ? 'exercício' : 'exercícios'}`;

  // Card em destaque: o treino do dia (PRÓXIMO) — principal ponto de ação.
  if (isProx) {
    const conta = `${exercicios}${min ? ` · aproximadamente ${min} min` : ''}`;
    const badge = emAndamento
      ? `<span class="pa-dc-badge andamento"><span class="pa-cron-dot" aria-hidden="true"></span> <span data-cron-tempo>${fmtCron(cronDecorridoMs())}</span></span>`
      : `<span class="pa-dc-badge prox">Próximo</span>`;
    return `
      <div class="pa-diacard prox featured">
        <div class="pa-dc-head">
          <span class="pa-dc-letra">${dia}</span>
          <div class="pa-dc-headtext">
            <span class="pa-dc-nome">Treino ${dia}</span>
            ${badge}
          </div>
        </div>
        <div class="pa-dc-info">
          <div class="pa-dc-grupos">${esc(grupos || 'Exercícios variados')}</div>
          <div class="pa-dc-conta">${conta}</div>
        </div>
        <button class="pa-dc-cta" data-abrir="${dia}">${emAndamento ? 'Continuar treino' : 'Ver treino'} <i data-lucide="arrow-right"></i></button>
      </div>`;
  }

  // Demais cards: layout compacto com seta.
  const badge = feito ? `<span class="pa-dc-badge feito">✓ Feito hoje</span>` : '';
  return `
    <button class="pa-diacard" data-abrir="${dia}">
      <span class="pa-dc-letra">${dia}</span>
      <span class="pa-dc-body">
        <span class="pa-dc-top"><span class="pa-dc-nome">Treino ${dia}</span>${badge}</span>
        <span class="pa-dc-sub">${esc(grupos || 'Exercícios variados')}</span>
        <span class="pa-dc-meta"><i data-lucide="clock"></i> ${min ? `≈${min} min · ` : ''}${exercicios}</span>
      </span>
      <span class="pa-dc-arrow"><i data-lucide="chevron-right"></i></span>
    </button>`;
}

// ── Cronômetro do treino ────────────────────────────────────
// Conta o tempo real da sessão: começa ao abrir um treino e para no
// "Finalizar treino". Fica no localStorage para sobreviver a recarregar
// a página / trocar de aba — uma sessão esquecida é descartada em 6h.
const CRON_KEY = 'nm_treino_cron';
const CRON_MAX_MS = 6 * 60 * 60 * 1000;
let _cron = null;        // { treinoId, dia, inicio, exAberto } — sessão em andamento
let _cronTimer = null;   // setInterval do tique visual

function cronCarregar() {
  try {
    const c = JSON.parse(localStorage.getItem(CRON_KEY) || 'null');
    if (!c || !c.inicio || Date.now() - c.inicio > CRON_MAX_MS) { localStorage.removeItem(CRON_KEY); return null; }
    return c;
  } catch { return null; }
}
function cronGravar() {
  try { localStorage.setItem(CRON_KEY, JSON.stringify(_cron)); } catch {}
}
function cronIniciar(treinoId, dia) {
  _cron = { treinoId, dia, inicio: Date.now(), exAberto: null, ex: {} };
  cronGravar();
}

// ── Contabilidade por exercício (tempo gasto e descanso acumulado) ──
// Vive dentro do cronômetro da sessão: some junto com ela ao finalizar.
function exSessao(id) {
  if (!_cron) return null;
  if (!_cron.ex) _cron.ex = {};
  if (!_cron.ex[id]) { _cron.ex[id] = { ini: Date.now(), desc: 0 }; cronGravar(); }
  return _cron.ex[id];
}
function exSomarDescanso(id, ms) {
  const e = exSessao(id);
  if (!e || !ms) return;
  e.desc += Math.max(0, Math.round(ms));
  cronGravar();
}
function exTempoMs(id) {
  const e = _cron?.ex?.[id];
  return e ? Math.max(0, Date.now() - e.ini) : 0;
}
function exDescansoMs(id) { return _cron?.ex?.[id]?.desc || 0; }
// Guarda qual exercício ficou aberto, para reabrir só ele ao voltar/recarregar.
function cronSetAberto(id) {
  if (!_cron) return;
  _cron.exAberto = id;
  cronGravar();
}
// Para a contagem e devolve o tempo total decorrido (ms).
function cronParar() {
  const ms = cronDecorridoMs();
  _cron = null;
  pararTique();
  Exec.encerrarDescanso();
  Exec.pararMetronomo();
  try { localStorage.removeItem(CRON_KEY); } catch {}
  return ms;
}
function cronAtivo(dia) {
  return !!_cron && _cron.treinoId === _treinoSel && (dia === undefined || _cron.dia === dia);
}
function cronDecorridoMs() { return _cron ? Math.max(0, Date.now() - _cron.inicio) : 0; }

// Mostrador do cronômetro: sempre HH:MM:SS (largura estável, sem "pulo").
function fmtCron(ms) {
  const t = Math.floor(ms / 1000);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
// Duração por extenso, para o resumo final ("47 min", "1 h 12 min").
function fmtDuracao(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function pararTique() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}
// Liga o tique de 1s nos mostradores da tela atual; se some da tela, para sozinho.
function ligarTique() {
  pararTique();
  if (!_cron) return;
  const pintar = () => {
    const els = document.querySelectorAll('[data-cron-tempo]');
    if (!els.length) { pararTique(); return; }
    const txt = fmtCron(cronDecorridoMs());
    els.forEach(el => { el.textContent = txt; });
  };
  pintar();
  _cronTimer = setInterval(pintar, 1000);
}

// Mostrador do tempo no cabeçalho: cronômetro rodando ou estimativa do dia.
// Depois que o treino começa, a estimativa some — o que vale é a duração real.
function cronBloco(r) {
  if (cronAtivo()) {
    return `<div class="pa-cron" role="timer" aria-label="Tempo de treino">
        <span class="pa-cron-lab"><span class="pa-cron-dot" aria-hidden="true"></span> Tempo de treino</span>
        <span class="pa-cron-tempo" data-cron-tempo>${fmtCron(cronDecorridoMs())}</span>
      </div>`;
  }
  if (!r.minutos) return '';
  return `<div class="pa-cron pa-cron-off">
      <span class="pa-cron-lab">Tempo estimado</span>
      <span class="pa-cron-tempo">≈${r.minutos} min</span>
    </div>`;
}

// Linha de contexto do cabeçalho: tempo restante (ou o descanso em curso)
// e o volume já levantado. Duas informações, uma linha — sem poluir.
function metaRunbar(r) {
  const vol = r.volume
    ? `<span class="pa-runbar-vol"><i data-lucide="dumbbell"></i> ${fmtVolume(r.volume)}</span>` : '';
  if (Exec.descansando()) {
    return `<span class="pa-runbar-rest"><span class="pa-cron-dot" aria-hidden="true"></span>
        Descansando · <b data-rest-mini>${Exec.fmtRelogio(Exec.restanteSeg())}</b></span>${vol}`;
  }
  if (!cronAtivo() || !r.minRestante) return vol ? `<span></span>${vol}` : '';
  return `<span>Restam aproximadamente <b>${r.minRestante} min</b></span>${vol}`;
}

// Volume em kg, com "t" a partir de 1000 kg (2.480 kg → 2,5 t).
function fmtVolume(kg) {
  if (!kg) return '0 kg';
  return kg >= 1000 ? `${(kg / 1000).toFixed(1).replace('.', ',')} t` : `${kg} kg`;
}

// Texto do botão de finalizar: "Concluir" quando não falta nenhum exercício.
function textoFinalizar(r) {
  return (r.total && r.feitos >= r.total) ? 'Concluir treino' : 'Finalizar treino';
}

// Ação principal da barra inferior: iniciar antes de começar, finalizar depois.
// Abrir o treino é só consulta — o cronômetro só roda por decisão do aluno.
function barraAcaoInner(r) {
  return cronAtivo()
    ? `<button class="pa-btn pa-finalizar" data-finalizar><i data-lucide="flag"></i> <span data-finalizar-txt>${textoFinalizar(r)}</span></button>`
    : `<button class="pa-btn pa-iniciar" data-iniciar><i data-lucide="play"></i> Iniciar treino</button>`;
}

function ligarBarraAcao() {
  document.querySelector('[data-finalizar]')?.addEventListener('click', finalizarTreino);
  document.querySelector('[data-iniciar]')?.addEventListener('click', iniciarSessao);
}

function atualizarBarraAcao() {
  const bar = document.querySelector('[data-acaobar]');
  if (!bar) return;
  bar.innerHTML = barraAcaoInner(resumoDia(_diaSel));
  ligarBarraAcao();
}

// Começa a contar. Troca só o cronômetro e a barra — o que já estiver aberto
// ou digitado na tela permanece como está.
function iniciarSessao() {
  if (cronAtivo()) return;
  cronIniciar(_treinoSel, _diaSel);
  const abertoAgora = [..._progAbertas][0];
  if (abertoAgora) cronSetAberto(abertoAgora);
  const slot = document.querySelector('[data-cron-slot]');
  if (slot) slot.innerHTML = cronBloco(resumoDia(_diaSel));
  atualizarBarraAcao();
  atualizarHero();     // a estimativa dá lugar ao "restam ~X min" da sessão
  ligarTique();
  mostrarToast('⏱ Treino iniciado — bom treino!');
  anunciar('Treino iniciado. O cronômetro está contando.');
}

// ── TELA B: treino em andamento (cabeçalho fixo + lista de exercícios) ──
function renderTreinoDia() {
  const tabs = _dias.length > 1
    ? `<div class="pa-dias" role="tablist" aria-label="Dias do treino">${_dias.map(d =>
        `<button class="pa-dia ${d === _diaSel ? 'active' : ''}" data-dia="${d}" role="tab"
           aria-selected="${d === _diaSel}" aria-label="Treino ${d}">${d}</button>`).join('')}</div>`
    : '';
  const r = resumoDia(_diaSel);
  const nomeTreino = (_treinos.find(t => t.id === _treinoSel)?.nome || '').trim();

  app().innerHTML = `
    ${topo()}
    <main class="pa-main pa-main-run">
      <header class="pa-runbar">
        <div class="pa-runbar-row">
          <button class="pa-runbar-back" data-voltar aria-label="Voltar para a lista de treinos"><i data-lucide="chevron-left"></i></button>
          <div class="pa-runbar-id">
            <h1 class="pa-runbar-title">Treino ${esc(_diaSel)}</h1>
            ${nomeTreino ? `<div class="pa-runbar-sub">${esc(nomeTreino)}</div>` : ''}
          </div>
          <div data-cron-slot>${cronBloco(r)}</div>
        </div>
        <div class="pa-runbar-prog">
          <span data-hero-count><b>${r.feitos}</b> de ${r.total} ${r.total === 1 ? 'exercício concluído' : 'exercícios concluídos'}</span>
          <span class="pa-runbar-pct" data-hero-pct>${r.pct}%</span>
        </div>
        <div class="pa-hero-bar" data-hero-bar
             role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.pct}"
             aria-label="Progresso do treino"><span style="width:${r.pct}%"></span></div>
        <div class="pa-runbar-meta" data-runbar-meta>${metaRunbar(r)}</div>
      </header>

      ${tabs}
      <div id="paDiaConteudo"></div>
      <p class="sr-only" role="status" aria-live="polite" data-live></p>
    </main>

    <div class="pa-finishbar">
      <div class="pa-finishbar-in" data-acaobar>${barraAcaoInner(r)}</div>
    </div>
    ${bottomNav()}`;

  document.querySelector('[data-voltar]').addEventListener('click', () => { _view = 'lista'; renderTreino(); });
  ligarBarraAcao();
  app().querySelectorAll('.pa-dia').forEach(b =>
    b.addEventListener('click', () => { _diaSel = b.dataset.dia; renderTreinoDia(); }));
  ligarShell();
  ligarTique();

  renderDia();
}

// Avisa o leitor de tela (série registrada, exercício concluído).
function anunciar(msg) {
  const el = document.querySelector('[data-live]');
  if (el) el.textContent = msg;
}

async function finalizarTreino() {
  const r = resumoDia(_diaSel);
  const pend = Math.max(0, r.total - r.feitos);
  if (pend > 0 && !(await confirmar({
    titulo: 'Finalizar treino',
    mensagem: `Há ${pend} ${pend === 1 ? 'exercício pendente' : 'exercícios pendentes'}. Deseja finalizar mesmo assim?`,
    textoOk: 'Finalizar',
  }))) return;

  const ms = cronAtivo() ? cronParar() : 0;
  Exec.encerrarDescanso();
  Exec.pararMetronomo();
  const vol = r.volume ? ` · ${fmtVolume(r.volume)} de volume` : '';
  mostrarToast(ms ? `✓ Treino concluído em ${fmtDuracao(ms)}${vol} 💪` : '✓ Treino concluído! 💪');
  _view = 'lista';
  renderTreino();
}

// ── Regras de "próximo treino" e status por dia ─────────────
function contarDia(dia) { return _itens.filter(it => it.dia === dia).length; }

function gruposDoDia(dia) {
  const out = [];
  for (const it of _itens.filter(x => x.dia === dia).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))) {
    const g = it.exercicio?.grupo_muscular;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

// Dia do registro mais recente (última sessão treinada), ou null.
function ultimoDiaTreinado() {
  let maxData = null, dia = null;
  for (const it of _itens) {
    for (const rg of (_progCache.get(it.id) || [])) {
      if (rg.data && (maxData == null || rg.data > maxData)) { maxData = rg.data; dia = it.dia; }
    }
  }
  return dia;
}

// Dia treinado hoje (se houver), ou null.
function diaTreinadoHoje() {
  const h = hoje();
  for (const it of _itens) {
    if ((_progCache.get(it.id) || []).some(rg => rg.data === h)) return it.dia;
  }
  return null;
}

// Próximo sugerido = dia seguinte ao último treinado (rotação A→B→C→A).
function proximoDiaSugerido() {
  if (!_dias.length) return null;
  const ult = ultimoDiaTreinado();
  if (!ult) return _dias[0];
  const idx = _dias.indexOf(ult);
  if (idx === -1) return _dias[0];
  return _dias[(idx + 1) % _dias.length];
}

// ═══════════════════════════════════════════════════════════
// NAVEGAÇÃO INFERIOR (Treino | Dieta) + shell
// ═══════════════════════════════════════════════════════════
function bottomNav() {
  const item = (sec, icone, label) =>
    `<button class="pa-nav-item ${_secao === sec ? 'active' : ''}" data-sec="${sec}">
       <i data-lucide="${icone}"></i><span>${label}</span>
     </button>`;
  return `<nav class="pa-bottomnav">
    ${item('inicio', 'house', 'Início')}
    ${item('treino', 'dumbbell', 'Treino')}
    ${item('dieta', 'salad', 'Dieta')}
  </nav>`;
}

// Liga o logout do topo + a troca de seção da barra inferior.
// Liga o botão de sino (notificações push) uma única vez, via delegação —
// o botão é recriado a cada render, mas o listener no document persiste.
let _pushLigado = false;
function ligarBotaoNotificacoes() {
  if (_pushLigado) return;
  _pushLigado = true;
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-push-toggle]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (pushAtivo()) {
        await desativarNotificacoes();
        mostrarToast('Notificações desativadas');
      } else {
        await ativarNotificacoes();
        mostrarToast('🔔 Notificações ativadas');
      }
    } catch (err) {
      mostrarToast(traduzirPush(err?.message));
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="${pushAtivo() ? 'bell-ring' : 'bell'}"></i>`;   // atualiza o ícone
    }
  });
}

function ligarShell() {
  document.getElementById('paLogout')?.addEventListener('click', logout);
  app().querySelectorAll('.pa-nav-item').forEach(b =>
    b.addEventListener('click', () => {
      const sec = b.dataset.sec;
      if (sec === _secao) return;
      if (sec === 'dieta') renderDieta();
      else if (sec === 'inicio') renderInicio();
      else irParaTreino();
    }));
}

function irParaTreino() {
  _secao = 'treino';
  _view = 'lista';   // volta para a seleção de dias
  if (_treinosCarregados) {
    if (_treinos.length) renderTreino(); else renderSemTreino();
  } else {
    abrirTreino();
  }
}

// ── Seção Início ────────────────────────────────────────────
// A tela de abertura. Vive de dado que JÁ existe: o treino (em memória, vindo
// de `carregarTreino`) e a próxima refeição (que o módulo busca sozinho).
//
// Água, check-in, peso e aderência ficaram de fora porque não há tabela para
// nenhum dos quatro. Ver js/pwa-inicio-data.js.
// A tela pinta ANTES de o treino chegar. Bloquear a primeira pintura na carga
// do treino custava tres idas a rede encadeadas (treinos -> itens ->
// progressao) com o app parado em "Abrindo...". O nome do paciente ja basta
// para desenhar; o resto entra quando chegar.
function renderInicio() {
  _secao = 'inicio';
  const treino = _treinosCarregados
    ? Promise.resolve(brutoDoTreino())
    : carregarTreino().then(brutoDoTreino);
  pintarInicio(treino);
}

// O que a tela sabe sobre o treino, a partir do que já está em memória.
function brutoDoTreino() {
  const proximo = proximoDiaSugerido();
  const treinadoHoje = diaTreinadoHoje();
  const dia = treinadoHoje || proximo || '';
  return {
    dias: _dias,
    proximo,
    treinadoHoje,
    exercicios: dia ? contarDia(dia) : 0,
    grupos: dia ? gruposDoDia(dia).slice(0, 2).join(' · ') : '',
    sequencia: calcSequencia(),
    recordes: calcRecordes(),
    datasTreinadas: datasTreinadas(),
  };
}

function pintarInicio(treino) {
  app().innerHTML = `
    ${topo()}
    <main class="pa-main"><div id="paInicio"></div></main>
    ${bottomNav()}`;
  ligarShell();

  const base = {
    saudacao: saudacao(),
    nome: (_paciente?.nome || '').trim().split(' ')[0],
    hoje: hoje(),
    pacienteId: _paciente?.id || null,
  };

  import('./pwa-inicio-ui.js')
    .then(m => m.renderInicioPaciente('paInicio', base, { treino, ir: irParaSecao }))
    .catch(e => {
      console.error('Início:', e);
      const cx = document.getElementById('paInicio');
      if (cx) cx.innerHTML = `
        <div class="pa-empty pa-empty-lg">
          <i data-lucide="cloud-off"></i>
          <div class="pa-empty-t">Não foi possível abrir seu início</div>
          <div class="pa-empty-s">Verifique sua conexão e tente novamente.</div>
        </div>`;
    });
}

// Destino dos atalhos do Início. A tela nova não conhece a casca — ela devolve
// o nome da seção e quem sabe navegar é quem está aqui.
function irParaSecao(sec) {
  if (sec === 'dieta') renderDieta();
  else if (sec === 'treino') irParaTreino();
  else if (sec === 'documentos') renderDocumentos();
}

// Seção Documentos — subtela do Início, não uma quarta aba.
//
// `_secao` continua 'inicio': é ele que a barra inferior lê para acender o
// item ativo, e Documentos se chega PELO Início. Mesmo padrão do treino em
// andamento, que mantém _secao = 'treino' enquanto troca de view. Uma regra
// isolada aqui faria a barra apagar todos os itens em uma tela só.
//
// A barra inferior segue sendo a mesma — Início | Treino | Dieta. Enquanto não
// existir "Mais", uma quarta aba só para Documentos desequilibraria a barra em
// troca de um módulo que o paciente abre uma vez por mês.
function renderDocumentos() {
  _secao = 'inicio';
  app().innerHTML = `
    ${topo()}
    <main class="pa-main"><div id="paDocs"></div></main>
    ${bottomNav()}`;
  ligarShell();

  import('./pwa-documentos-ui.js')
    .then(m => m.renderDocumentosPaciente('paDocs', { aoVoltar: renderInicio }))
    .catch(e => {
      console.error('Documentos:', e);
      const cx = document.getElementById('paDocs');
      if (cx) cx.innerHTML = `
        <div class="pa-empty pa-empty-lg">
          <i data-lucide="cloud-off"></i>
          <div class="pa-empty-t">Não foi possível carregar seus documentos.</div>
          <div class="pa-empty-s">Verifique sua conexão e tente novamente.</div>
        </div>`;
    });
}

// Seção Dieta — a casca; a tela mora em js/pwa-dieta-ui.js.
//
// A casca desenha shell e navegação IMEDIATAMENTE e entrega o miolo para o
// módulo, que mostra o esqueleto e busca os dados. Esperar o carregamento aqui
// deixaria a barra inferior sumida enquanto a rede responde — e o paciente
// tocaria numa tela sem saída.
//
// Import dinâmico: quem só usa o Treino não baixa a Dieta.
function renderDieta() {
  _secao = 'dieta';
  app().innerHTML = `
    ${topo()}
    <main class="pa-main"><div id="paDieta"></div></main>
    ${bottomNav()}`;
  ligarShell();

  import('./pwa-dieta-ui.js')
    .then(m => m.renderDietaPaciente('paDieta', { pacienteId: _paciente?.id }))
    .catch(e => {
      console.error('Dieta:', e);
      const cx = document.getElementById('paDieta');
      if (cx) cx.innerHTML = `
        <div class="pa-empty pa-empty-lg">
          <i data-lucide="cloud-off"></i>
          <div class="pa-empty-t">Não foi possível carregar sua dieta</div>
          <div class="pa-empty-s">Verifique sua conexão e tente novamente.</div>
        </div>`;
    });
}

// ── Indicadores de evolução (topo) ──────────────────────────
// Datas (YYYY-MM-DD) com algum registro no treino atual, em ordem asc.
function datasTreinadas() {
  const set = new Set();
  for (const regs of _progCache.values())
    for (const r of regs) if (r.data) set.add(r.data);
  return [...set].sort();
}

// Sequência: dias de treino encadeados, tolerando até 2 dias de folga entre eles.
// Zera se o último treino foi há mais de 2 dias (sequência "quebrada").
function calcSequencia() {
  const dias = datasTreinadas();
  if (!dias.length) return 0;
  const TOL = 2, DIA = 86400000;
  const ms = s => new Date(s + 'T00:00:00').getTime();
  if ((ms(hoje()) - ms(dias[dias.length - 1])) / DIA > TOL) return 0;
  let seq = 1;
  for (let i = dias.length - 1; i > 0; i--) {
    if ((ms(dias[i]) - ms(dias[i - 1])) / DIA <= TOL) seq++;
    else break;
  }
  return seq;
}

// Recordes: nº de vezes que o aluno superou a própria carga máxima num exercício.
function calcRecordes() {
  let total = 0;
  for (const regs of _progCache.values()) {
    const ord = [...regs].filter(r => r.data)
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    let best = null;
    for (const r of ord) {
      const c = cargaSessao(r);
      if (c == null) continue;
      if (best == null) { best = c; continue; }   // 1ª sessão não conta como recorde
      if (c > best) { total++; best = c; }
    }
  }
  return total;
}

// Tiles de evolução: 🔥 Sequência + 🏆 Recordes.
function statsTopo() {
  const seq = calcSequencia();
  const rec = calcRecordes();
  return `
    <div class="pa-stats">
      <div class="pa-stat">
        <div class="pa-stat-top"><span class="pa-stat-ic">🔥</span> Sequência</div>
        <div class="pa-stat-val" data-stat-seq>${seq} <small>${seq === 1 ? 'dia' : 'dias'}</small></div>
      </div>
      <div class="pa-stat">
        <div class="pa-stat-top"><span class="pa-stat-ic">🏆</span> Recordes</div>
        <div class="pa-stat-val" data-stat-rec>${rec}</div>
      </div>
    </div>`;
}

// Atualiza os números das tiles após salvar/excluir (sem re-render da tela).
function atualizarStats() {
  const seqEl = document.querySelector('[data-stat-seq]');
  const recEl = document.querySelector('[data-stat-rec]');
  if (seqEl) { const s = calcSequencia(); seqEl.innerHTML = `${s} <small>${s === 1 ? 'dia' : 'dias'}</small>`; }
  if (recEl) recEl.textContent = calcRecordes();
}

// Saudação conforme a hora do dia.
function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Segundos que um exercício ainda consome: as séries que faltam, com o
// descanso de cada uma (a última usa o descanso pós-exercício).
// EXEC_SEG é o tempo médio de execução de uma série — o que não dá para medir.
const EXEC_SEG = 35;
const SETUP_SEG = 20;
function restanteDoItem(it) {
  const n = nSeriesDoItem(it);
  const feitas = Math.min(seriesFeitasHoje(it.id), n);
  const faltam = n - feitas;
  if (faltam <= 0) return 0;
  let seg = feitas ? 0 : SETUP_SEG;               // setup só se ainda nem começou
  for (let i = feitas; i < n; i++) {
    seg += EXEC_SEG + (descansoDaSerie(it, i === n - 1) || 45);
  }
  return seg;
}

// Volume realizado hoje (kg levantados) — soma peso × reps de todas as séries.
function volumeDia(dia) {
  let total = 0;
  for (const it of _itens.filter(x => x.dia === dia)) {
    const r = regHoje(it.id);
    if (!r) continue;
    for (const s of (r.series_realizadas || [])) {
      total += (Number(s?.peso) || 0) * (Number(s?.reps) || 0);
      if (s?.drop) total += (Number(s.drop.peso) || 0) * (Number(s.drop.reps) || 0);
    }
  }
  return Math.round(total);
}

// Resumo do dia: total, feitos, %, tempo estimado, tempo restante e volume.
// O restante desconta o que já foi feito e soma o descanso em andamento —
// por isso ele cai a cada série concluída, e não só com o relógio.
function resumoDia(dia) {
  const doDia = _itens.filter(it => it.dia === dia);
  const total = doDia.length;
  let feitos = 0, seg = 0, restante = 0;
  for (const it of doDia) {
    if (itemFeitoHoje(it.id)) feitos++;
    const series = nSeriesDoItem(it);
    const descanso = descansoDaSerie(it, false) || 60;
    seg += SETUP_SEG + series * (EXEC_SEG + descanso);
    restante += restanteDoItem(it);
  }
  if (Exec.descansando()) restante += Exec.restanteSeg();
  const pct = total ? Math.round(feitos / total * 100) : 0;
  const minutos = total ? Math.max(5, Math.round(seg / 60 / 5) * 5) : 0;
  const minRestante = restante ? Math.max(1, Math.round(restante / 60)) : 0;
  return { total, feitos, pct, minutos, minRestante, volume: volumeDia(dia) };
}

// Atualiza barra + contador do cabeçalho sem re-renderizar a tela toda.
function atualizarHero() {
  const barra = document.querySelector('[data-hero-bar]');
  const count = document.querySelector('[data-hero-count]');
  if (!barra && !count) return;
  const r = resumoDia(_diaSel);
  const bar = barra?.querySelector('span');
  if (bar) bar.style.width = r.pct + '%';
  if (barra) barra.setAttribute('aria-valuenow', String(r.pct));
  if (count) count.innerHTML = `<b>${r.feitos}</b> de ${r.total} ${r.total === 1 ? 'exercício concluído' : 'exercícios concluídos'}`;
  const pct = document.querySelector('[data-hero-pct]');
  if (pct) pct.textContent = r.pct + '%';
  const meta = document.querySelector('[data-runbar-meta]');
  if (meta) meta.innerHTML = metaRunbar(r);
  const fin = document.querySelector('[data-finalizar-txt]');
  if (fin) fin.textContent = textoFinalizar(r);
}

function renderDia() {
  const cont = document.getElementById('paDiaConteudo');
  if (!cont) return;

  const doDia = _itens
    .filter(it => it.dia === _diaSel)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  if (!doDia.length) {
    cont.innerHTML = `<div class="pa-empty"><i data-lucide="inbox"></i> Nenhum exercício no Dia ${_diaSel}.</div>`;
    return;
  }

  // Agrupa Bi-sets (A + B) num único bloco; o B não vira card separado.
  const unidades = unidadesDia(doDia);
  cont.innerHTML = unidades.map((u, i) =>
    u.tipo === 'grupo' ? cardBisetAluno(u, i) : cardExercicio(u.a, i)).join('');

  cont.querySelectorAll('[data-carga]').forEach(b =>
    b.addEventListener('click', () => toggleProg(b.dataset.carga)));

  // Todos começam fechados. Reabre só o exercício que estava em andamento —
  // o desta sessão (ao voltar da lista) ou o salvo no cronômetro (ao recarregar).
  const alvo = [..._progAbertas][0] || (cronAtivo() ? _cron.exAberto : null);
  _progAbertas.clear();
  if (alvo && cont.querySelector(`.pa-ex[data-ex="${alvo}"]`)) abrirEx(alvo, { rolar: false });
  else { destacarProximoPendente(); reancorarDescanso(); }
}

// Marca o próximo exercício pendente (destaque discreto, sem abrir).
// Com `depoisDe`, procura primeiro à frente do exercício recém-concluído.
function destacarProximoPendente(depoisDe) {
  const cont = document.getElementById('paDiaConteudo');
  if (!cont) return null;
  cont.querySelectorAll('.pa-ex.next').forEach(c => c.classList.remove('next'));
  const prox = acharProximoPendente(depoisDe);
  if (prox) prox.classList.add('next');
  return prox || null;
}

// Próximo card ainda pendente (a partir de `depoisDe`, se informado).
// Só lê a tela — quem destaca é destacarProximoPendente.
function acharProximoPendente(depoisDe) {
  const cont = document.getElementById('paDiaConteudo');
  if (!cont) return null;
  const cards = [...cont.querySelectorAll('.pa-ex')];
  const pendente = c => !c.classList.contains('done') && c.dataset.ex !== depoisDe;
  const iAtual = depoisDe ? cards.findIndex(c => c.dataset.ex === depoisDe) : -1;
  return (iAtual >= 0 ? cards.slice(iAtual + 1).find(pendente) : null)
      || cards.find(pendente) || null;
}

// Card recolhível de um exercício.
//   fechado → número/estado, nome, grupo e o resumo da prescrição (~72px);
//   aberto  → prescrição completa, técnica, observações, último treino,
//             registro das séries e "Concluir exercício".
function cardExercicio(it, i, opts = {}) {
  const ex = it.exercicio || {};
  const grupo = ex.grupo_muscular ? esc(ex.grupo_muscular) : '';
  const mi = opts.ocultarMetodo ? null : metodoInfo(it.metodo);
  const marcador = opts.marcador != null ? opts.marcador : (i + 1);
  const feito = itemFeitoHoje(it.id);

  // 2 · Linha compacta de prescrição — só mostra o que existe.
  const specParts = [];
  if (it.series != null && it.series !== '')
    specParts.push(`<span><b>${esc(it.series)}</b> ${Number(it.series) === 1 ? 'série' : 'séries'}</span>`);
  if (it.repeticoes) specParts.push(`<span><b>${esc(fmtReps(it.repeticoes))}</b> reps</span>`);
  // Descanso: agora é o que o cronômetro vai contar, então vale mostrar por extenso.
  if (!opts.ocultarDescanso) {
    const entre = descansoDaSerie(it, false);
    const fim = descansoDaSerie(it, true);
    if (entre) specParts.push(`<span><b>${esc(fmtSegLongo(entre))}</b> de descanso</span>`);
    if (fim && fim !== entre) specParts.push(`<span>${esc(fmtSegLongo(fim))} após a última</span>`);
  }
  const tec = (!opts.ocultarMetodo && it.metodo) ? `<span class="pa-ex-tec"><i data-lucide="zap"></i> ${esc(it.metodo)}</span>` : '';
  const specLine = (specParts.length || tec)
    ? `<div class="pa-ex-spec">${specParts.join('<span class="sep">·</span>')}${tec}</div>` : '';

  // Cadência: só existe na tela quando o profissional prescreveu.
  const cad = parseCadencia(it.cadencia);

  // Resumo do estado fechado: "3 séries · 12 reps" (sem histórico).
  const resumo = [
    (it.series != null && it.series !== '') ? `${esc(it.series)} ${Number(it.series) === 1 ? 'série' : 'séries'}` : '',
    it.repeticoes ? `${esc(fmtReps(it.repeticoes))} reps` : '',
  ].filter(Boolean).join(' · ');

  // 3-4 · Último treino + evolução (do cache já pré-carregado).
  const regs = _progCache.get(it.id) || [];

  const video = ex.video_url
    ? `<a class="pa-video" href="${esc(ex.video_url)}" target="_blank" rel="noopener"><i data-lucide="play"></i> Ver vídeo</a>`
    : '';

  return `
    <div class="pa-ex${feito ? ' done' : ''}" data-ex="${it.id}">
      <button type="button" class="pa-exh" data-carga="${it.id}"
              aria-expanded="false" aria-controls="pa-exb-${it.id}">
        <span class="pa-ex-status" data-ex-status data-num="${esc(String(marcador))}" aria-hidden="true">${statusInner(feito, marcador)}</span>
        <span class="pa-exh-txt">
          <span class="pa-exh-nome">${esc(ex.nome || '(exercício)')}</span>
          ${grupo ? `<span class="pa-exh-grupo">${grupo}</span>` : ''}
          ${resumo ? `<span class="pa-exh-resumo">${resumo}</span>` : ''}
        </span>
        <span class="pa-exh-estado">
          <span class="pa-ex-tag pa-tag-run">Em andamento</span>
          <span class="pa-ex-tag pa-tag-done"><i data-lucide="check"></i> Concluído</span>
          <span class="sr-only" data-ex-sr>${feito ? 'Concluído' : 'Pendente'}</span>
        </span>
        <span class="pa-exh-chev" aria-hidden="true"><i data-lucide="chevron-down"></i></span>
      </button>

      <div class="pa-ex-body" id="pa-exb-${it.id}" hidden>
        ${specLine}
        ${Exec.cadenciaHtml(cad)}
        ${mi ? `<div class="pa-metodo"><i data-lucide="lightbulb"></i> ${esc(mi.desc)}</div>` : ''}
        ${it.observacao ? `<div class="pa-obs"><i data-lucide="sticky-note"></i> ${esc(it.observacao)}</div>` : ''}
        ${ex.observacoes ? `<div class="pa-obs pa-obs-tec"><i data-lucide="info"></i> ${esc(ex.observacoes)}</div>` : ''}
        ${video ? `<div class="pa-ex-foot">${video}</div>` : ''}

        <div class="pa-ex-last">${lastBlockInner(regs, it.id)}</div>

        <div class="pa-prog" data-prog-box="${it.id}"></div>
      </div>
    </div>`;
}

// Conteúdo do círculo de estado: número quando pendente, check quando feito.
function statusInner(feito, marcador) {
  return feito ? `<i data-lucide="check"></i>` : esc(String(marcador));
}

// Agrupa os itens de um dia em unidades (single | grupo Bi-set).
// O Exercício B (grupo_pos 'B') nunca vira card próprio — vai dentro do bloco.
function unidadesDia(doDia) {
  return doDia
    .filter(it => it.grupo_pos !== 'B')
    .map(a => {
      if (String(a.metodo || '').trim().toLowerCase() === 'bi-set') {
        const b = doDia.find(x => x.grupo_id === a.id && x.grupo_pos === 'B') || null;
        return { tipo: 'grupo', a, b };
      }
      return { tipo: 'single', a };
    });
}

// Card de Bi-set no app do aluno (Fase 1 — visualização agrupada, sem o ciclo
// guiado de execução). Cada exercício mantém sua própria área de registro.
function cardBisetAluno(u, i) {
  const { a, b } = u;
  // O descanso do conjunto tem lugar próprio no rodapé do bloco — não repete
  // dentro dos cards A e B.
  const seg = descansoDaSerie(a, false);
  const descanso = seg ? fmtSegLongo(seg) : (a.descanso ? fmtDescanso(a.descanso) : null);
  const corpoB = b
    ? cardExercicio(b, i, { marcador: 'B', ocultarMetodo: true, ocultarDescanso: true })
    : `<div class="pa-biset-incompleto"><i data-lucide="alert-triangle"></i> Segundo exercício ainda não definido pelo seu treinador.</div>`;
  return `
    <div class="pa-biset">
      <div class="pa-biset-head">
        <span class="pa-biset-selo"><i data-lucide="repeat-2"></i> Bi-set</span>
        <span class="pa-biset-n">${i + 1}</span>
      </div>
      ${cardExercicio(a, i, { marcador: 'A', ocultarMetodo: true, ocultarDescanso: true })}
      <div class="pa-biset-conector"><i data-lucide="arrow-down"></i> Sem descanso entre A e B</div>
      ${corpoB}
      ${descanso ? `<div class="pa-biset-descanso"><i data-lucide="timer"></i> Descanso após o conjunto: <b>${esc(descanso)}</b></div>` : ''}
    </div>`;
}

// Conteúdo interno do bloco "Última execução": agora série a série, com a
// data e o indicador de evolução — e não mais só "4 / 6 / 8 / 10".
function lastBlockInner(regs, id) {
  const ant = id ? regAnterior(id) : (regs || [])[0];
  const evo = evolucaoBadge(regs);
  const data = ant?.data ? `<span class="pa-last-date">${esc(fmtData(ant.data))}</span>` : '';
  return `<div class="pa-last-top"><span class="pa-last-lab">Última execução</span>${data}${evo}</div>` +
    Exec.ultimaExecucaoHtml(ant);
}

// Reaproveita o cache para reescrever só o bloco "Última execução" de um card.
function atualizarUltimo(id) {
  const last = document.querySelector(`[data-prog-box="${id}"]`)?.closest('.pa-ex')?.querySelector('.pa-ex-last');
  if (last) last.innerHTML = lastBlockInner(_progCache.get(id) || [], id);
}

// ── Estado de execução de um exercício ──────────────────────
// Quantas séries o exercício tem (prescritas, com teto de 12).
function nSeriesDoItem(it) {
  const ultima = (_progCache.get(it?.id) || [])[0];
  const salvas = ultima?.series_realizadas?.length || 0;
  return Math.min(Math.max(Number(it?.series) || salvas || 1, 1), 12);
}

// Registro de hoje (o que está sendo construído série a série).
function regHoje(id) {
  const h = hoje();
  return (_progCache.get(id) || []).find(r => r.data === h) || null;
}

// Última execução ANTERIOR a hoje — é ela que serve de comparação.
function regAnterior(id) {
  const h = hoje();
  return (_progCache.get(id) || []).find(r => r.data !== h) || null;
}

const serieVazia = s => !s || (s.peso == null && s.reps == null);

// Séries já concluídas hoje.
function seriesFeitasHoje(id) {
  const r = regHoje(id);
  if (!r) return 0;
  const arr = r.series_realizadas || [];
  if (!arr.length) return 1;                     // registro antigo (carga única)
  return arr.filter(s => !serieVazia(s)).length;
}

// O exercício foi concluído hoje? Antes bastava existir registro; agora que
// cada série é salva na hora, "concluído" é ter TODAS as séries preenchidas.
function itemFeitoHoje(id) {
  const r = regHoje(id);
  if (!r) return false;
  const arr = r.series_realizadas || [];
  if (!arr.length) return true;                  // registro antigo: mantém o comportamento
  const it = _itens.find(x => x.id === id);
  return arr.filter(s => !serieVazia(s)).length >= (it ? nSeriesDoItem(it) : arr.length);
}

// ── Descanso prescrito ──────────────────────────────────────
// No Bi-set quem manda é o exercício âncora (A): o descanso do conjunto.
function ancoraDoItem(it) {
  if (!it) return null;
  if (it.grupo_pos === 'B' && it.grupo_id) return _itens.find(x => x.id === it.grupo_id) || it;
  return it;
}
function ehBisetA(it) {
  return String(it?.metodo || '').trim().toLowerCase() === 'bi-set' && it.grupo_pos !== 'B';
}
function parceiroB(it) {
  return _itens.find(x => x.grupo_id === it?.id && x.grupo_pos === 'B') || null;
}
function descansoDaSerie(it, ehUltima) {
  const treino = _treinos.find(t => t.id === _treinoSel) || null;
  const { entre, final } = descansoDoItem(ancoraDoItem(it), treino);
  return ehUltima ? final : entre;
}

// Reflete o estado (pendente/concluído) no cabeçalho do card, sem re-render.
function atualizarBotaoFeito(id) {
  const card = document.querySelector(`.pa-ex[data-ex="${id}"]`);
  if (!card) return;
  const feito = itemFeitoHoje(id);
  card.classList.toggle('done', feito);
  const status = card.querySelector('[data-ex-status]');
  if (status) status.innerHTML = statusInner(feito, status.dataset.num || '');
  const sr = card.querySelector('[data-ex-sr]');
  if (sr) sr.textContent = feito ? 'Concluído' : 'Pendente';
}

// Carga representativa de uma sessão (maior peso da sessão), p/ comparar evolução.
function cargaSessao(r) {
  const pesos = (r.series_realizadas || []).map(s => s.peso).filter(v => v != null).map(Number);
  if (pesos.length) return Math.max(...pesos);
  return r.carga_realizada != null ? Number(r.carga_realizada) : null;
}

// Indicador de evolução vs. sessão anterior. Queda = cinza neutro (nunca vermelho).
function evolucaoBadge(regs) {
  if (!regs || regs.length < 2) return '';
  const atual = cargaSessao(regs[0]);
  const ant = cargaSessao(regs[1]);
  if (atual == null || ant == null || ant === 0) return '';
  const pct = Math.round((atual - ant) / ant * 100);
  if (pct > 0) return `<span class="pa-evo up" title="desde o último treino"><i data-lucide="trending-up"></i> ${pct}%</span>`;
  if (pct < 0) return `<span class="pa-evo down" title="desde o último treino"><i data-lucide="trending-down"></i> ${Math.abs(pct)}%</span>`;
  return `<span class="pa-evo flat" title="sem mudança desde o último treino">—</span>`;
}

// ═══════════════════════════════════════════════════════════
// PROGRESSÃO DE CARGA
// ═══════════════════════════════════════════════════════════
function toggleProg(id) {
  const card = document.querySelector(`.pa-ex[data-ex="${id}"]`);
  if (!card) return;
  if (card.classList.contains('open')) recolherProg(id);
  else abrirEx(id);
}

// Abre um exercício. Só um por vez: abrir outro recolhe o anterior (sem
// descartar nada — o conteúdo fica no DOM, com os valores já digitados).
function abrirEx(id, { rolar = true } = {}) {
  const card = document.querySelector(`.pa-ex[data-ex="${id}"]`);
  if (!card) return;
  [..._progAbertas].forEach(outro => { if (outro !== id) recolherProg(outro); });

  const body = card.querySelector('.pa-ex-body');
  const head = card.querySelector('.pa-exh');
  if (!body) return;
  card.classList.add('open');
  card.classList.remove('next');
  body.hidden = false;
  head?.setAttribute('aria-expanded', 'true');
  _progAbertas.add(id);
  cronSetAberto(id);

  // Abrir um exercício marca o começo dele na sessão (para o tempo do resumo).
  if (cronAtivo()) exSessao(id);

  // Monta as séries na primeira abertura; depois é só reexibir o que já existe.
  const box = card.querySelector(`[data-prog-box="${id}"]`);
  if (box && !box.dataset.pronto) carregarProg(id);

  // Cadência (quando prescrita) e o descanso que já estava correndo neste card.
  const it = _itens.find(x => x.id === id);
  Exec.ligarCadencia(card, parseCadencia(it?.cadencia));
  reancorarDescanso();

  if (rolar) requestAnimationFrame(() => rolarAteCard(card));
}

// Recoloca o cronômetro de descanso dentro do card certo depois de qualquer
// re-render. Sem o card na tela ele continua contando no cabeçalho.
function reancorarDescanso() {
  // Sem `if (estado)`: numa recarga de página o estado ainda está só no
  // localStorage, e é aqui que ele volta a viver.
  Exec.retomarDescanso(e => document.querySelector(
    `[data-prog-box="${e.itemId}"] .pa-serie-block[data-block="${e.serie}"]`));
}

// Recolhe (fecha) um exercício, preservando o que já foi preenchido.
function recolherProg(id) {
  const card = document.querySelector(`.pa-ex[data-ex="${id}"]`);
  _progAbertas.delete(id);
  if (_cron && _cron.exAberto === id) cronSetAberto(null);
  Exec.pararMetronomo();
  if (!card) return;
  card.classList.remove('open');
  const body = card.querySelector('.pa-ex-body');
  if (body) body.hidden = true;
  card.querySelector('.pa-exh')?.setAttribute('aria-expanded', 'false');
}

// Altura do que está fixo no topo (topbar + cabeçalho do treino).
function alturaFixaTopo() {
  const t = document.querySelector('.pa-topbar')?.offsetHeight || 0;
  const r = document.querySelector('.pa-runbar')?.offsetHeight || 0;
  return t + r;
}

// Posiciona o card logo abaixo do cabeçalho fixo, sem movimento exagerado.
function rolarAteCard(card) {
  if (!card) return;
  const y = card.getBoundingClientRect().top + window.scrollY - alturaFixaTopo() - 10;
  window.scrollTo({ top: Math.max(0, y), behavior: prefereMenosMovimento() ? 'auto' : 'smooth' });
}

// Pré-carrega a progressão de TODOS os itens do treino numa consulta só.
async function preCarregarProgressao() {
  _progCache = new Map();
  const ids = _itens.map(it => it.id);
  ids.forEach(id => _progCache.set(id, []));
  try {
    const regs = await progressaoDosItens(ids);
    for (const r of regs) {
      const arr = _progCache.get(r.treino_exercicio_id);
      if (arr) arr.push(r);   // regs já vêm em data desc
    }
  } catch (e) {
    _progCache = new Map();   // sem cache: cai no fetch por item (com spinner)
  }
}

// Renderiza a progressão. Usa o cache (instantâneo); só vai à rede se
// não tiver em cache ou se `force` (após salvar/excluir).
async function carregarProg(id, force = false) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;

  if (!force && _progCache.has(id)) {
    renderProg(box, id, _progCache.get(id));
    return;
  }

  box.innerHTML = `<div class="pa-loading"><span class="pa-spin"></span> Carregando...</div>`;
  try {
    const regs = await progressaoDoItem(id);
    _progCache.set(id, regs);
    renderProg(box, id, regs);
  } catch (e) {
    box.innerHTML = `<div class="pa-msg">Erro: ${esc(traduzirErro(e.message))}</div>`;
  }
}

function renderProg(box, id, regs) {
  const it = _itens.find(x => x.id === id) || {};
  const alvoReps = it.repeticoes || '';
  const doHoje = regs.find(r => r.data === hoje()) || null;      // o que já foi feito hoje
  const anterior = regs.find(r => r.data !== hoje()) || null;    // a sessão de comparação
  const feitasHoje = (doHoje && doHoje.series_realizadas) || [];
  const antSeries = (anterior && anterior.series_realizadas) || [];

  const nSeries = nSeriesDoItem(it);

  // Os campos já vêm preenchidos: com o de hoje se a série foi feita, senão
  // com o da última vez (sugestão de carga). Só conta como CONCLUÍDA a série
  // registrada hoje — é o ✓ do aluno que dispara o descanso.
  const linhasSeries = Array.from({ length: nSeries }, (_, i) => {
    const feita = !serieVazia(feitasHoje[i]);
    return blocoSerieHTML(i, feita ? feitasHoje[i] : (antSeries[i] || {}), {
      alvoReps, feita, anterior: antSeries[i] || null,
      temDrop: serieTemDrop(it, i, nSeries),
    });
  }).join('');

  const quando = anterior ? `Última vez: ${fmtData(anterior.data)}` : 'Primeiro registro';

  // Histórico: o que não está nem no formulário (hoje) nem em "Última execução".
  const anteriores = regs.filter(r => r !== doHoje && r !== anterior);
  const hist = anteriores.length
    ? `<div class="pa-hist-head">Histórico</div>` + anteriores.map(r => `
        <div class="pa-hist-row">
          <span class="pa-hist-data">${fmtData(r.data)}</span>
          <span class="pa-hist-sets">${esc(resumoSeries(r))}</span>
          <button class="pa-prog-del" data-pdel="${r.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
        </div>`).join('')
    : '';

  box.innerHTML = `
    <div class="pa-prog-head"><i data-lucide="chart-line"></i> Suas séries <span class="pa-prog-when">${quando}</span></div>
    ${sparkline(regs)}
    <div class="pa-series">
      <div class="pa-serie pa-serie-lab"><span></span><span>Peso (kg)</span><span>Reps${alvoReps ? ` · alvo ${esc(alvoReps)}` : ''}</span><span></span></div>
      ${linhasSeries}
    </div>
    <div class="pa-series-prog" data-sprog><b>0</b>/${nSeries} séries concluídas</div>
    <button class="pa-btn pa-btn-mini" data-ssave><i data-lucide="check"></i> <span data-ssave-txt>Concluir exercício</span></button>
    <div data-resumo-slot></div>
    ${hist}`;

  box.dataset.pronto = '1';   // já montado: fechar e reabrir não remonta (nem perde o digitado)
  box.querySelector('[data-ssave]').addEventListener('click', () => salvarSeriesUI(id, nSeries));
  box.querySelectorAll('[data-sdone]').forEach(b =>
    b.addEventListener('click', () => toggleSerie(box, Number(b.dataset.sdone), nSeries)));
  box.querySelectorAll('[data-ddone]').forEach(b =>
    b.addEventListener('click', () => toggleDrop(box, Number(b.dataset.ddone), nSeries)));
  box.querySelectorAll('[data-sedit]').forEach(b =>
    b.addEventListener('click', () => editarSerie(box, Number(b.dataset.sedit), nSeries)));
  // Enter no campo de reps conclui a série/drop e pula para a próxima etapa.
  box.querySelectorAll('[data-s-reps]').forEach(inp =>
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); toggleSerie(box, Number(inp.dataset.sReps), nSeries); }
    }));
  box.querySelectorAll('[data-d-reps]').forEach(inp =>
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); toggleDrop(box, Number(inp.dataset.dReps), nSeries); }
    }));
  box.querySelectorAll('[data-pdel]').forEach(b =>
    b.addEventListener('click', () => removerCarga(b.dataset.pdel, id)));

  // Estado inicial: séries já registradas aparecem concluídas (resumo compacto),
  // com a comparação contra a última vez já pintada.
  box.querySelectorAll('.pa-serie-block').forEach(bl => {
    const i = Number(bl.dataset.block);
    preencherResumo(box, i);
    pintarComparacao(box, i);
  });
  atualizarSeriesProg(box, nSeries);

  // Reabrir um exercício já terminado devolve o resumo; um descanso em curso
  // volta para dentro do card.
  if ([...box.querySelectorAll('.pa-serie-block')].every(blocoConcluido)) {
    mostrarResumoExercicio(box, id);
  }
  reancorarDescanso();
}

// ── "Componentes" de série (HTML) ──────────────────────────────
// Uma série = linha principal + (se houver técnica) selo, painel do drop e
// resumo compacto. Reaproveita os estilos .pa-serie / .pa-mini / .pa-serie-check.
function blocoSerieHTML(i, s, { alvoReps, temDrop, feita = false, anterior = null }) {
  const d = (s && s.drop) || {};
  // `feita` = registrada HOJE. Valores vindos da última sessão são só
  // sugestão de carga: ficam nos campos, mas a série continua pendente.
  const principalOk = feita && s && (s.peso != null || s.reps != null);
  const dropOk = feita && temDrop && d.peso != null && d.reps != null;
  const cls = [
    'pa-serie-block',
    temDrop ? 'has-drop' : '',
    principalOk ? 'done' : '',
    dropOk ? 'drop-done' : '',
  ].filter(Boolean).join(' ');

  const selo = temDrop
    ? `<div class="pa-drop-badge"><i data-lucide="chevrons-down"></i> Drop set</div>` : '';

  const painel = temDrop ? `
      <div class="pa-drop-wrap"><div class="pa-drop-inner">
        <div class="pa-drop">
          <div class="pa-drop-head"><i data-lucide="corner-down-right"></i> Drop set</div>
          <div class="pa-drop-grid">
            <label class="pa-drop-field">
              <span class="pa-drop-lab">Peso reduzido</span>
              <input type="number" step="0.5" inputmode="decimal" class="pa-input pa-mini"
                data-d-peso="${i}" placeholder="kg" value="${d.peso ?? ''}"
                aria-label="Peso do drop da série ${i + 1}">
              <span class="pa-drop-hint">Sugestão: -${DROP_REDUCAO_PCT}% do peso da série</span>
            </label>
            <label class="pa-drop-field">
              <span class="pa-drop-lab">Repetições <span class="pa-drop-alvo">alvo: até a falha</span></span>
              <input type="number" inputmode="numeric" class="pa-input pa-mini"
                data-d-reps="${i}" placeholder="reps" value="${d.reps ?? ''}"
                aria-label="Repetições do drop da série ${i + 1}">
            </label>
          </div>
          <button type="button" class="pa-btn-drop" data-ddone="${i}"
            aria-label="Concluir drop da série ${i + 1}"><i data-lucide="check"></i> Concluir drop</button>
        </div>
      </div></div>` : '';

  const resumo = temDrop ? `
      <button type="button" class="pa-serie-resumo" data-sedit="${i}"
        aria-label="Editar série ${i + 1} (concluída)">
        <span class="pa-res-check"><i data-lucide="check"></i></span>
        <span class="pa-res-main"><b>${i + 1}ª</b> <span data-res-p="${i}"></span></span>
        <span class="pa-res-drop"><i data-lucide="corner-down-right"></i> <span data-res-d="${i}"></span></span>
      </button>` : '';

  return `
    <div class="${cls}" data-block="${i}">
      <div class="pa-serie" data-serie="${i}">
        <span class="pa-serie-num">${i + 1}ª</span>
        <input type="number" step="0.5" inputmode="decimal" class="pa-input pa-mini"
          data-s-peso="${i}" placeholder="kg" value="${s.peso ?? ''}"
          aria-label="Peso da série ${i + 1}">
        <input type="number" inputmode="numeric" class="pa-input pa-mini"
          data-s-reps="${i}" placeholder="${esc(alvoReps || 'reps')}" value="${s.reps ?? ''}"
          aria-label="Repetições da série ${i + 1}">
        <button type="button" class="pa-serie-check" data-sdone="${i}"
          title="Concluir série" aria-label="Concluir série ${i + 1}"><i data-lucide="check"></i></button>
      </div>
      ${selo}
      ${painel}
      ${resumo}
      <div class="pa-serie-comp" data-comp="${i}"
        data-ant="${anterior ? esc(JSON.stringify({ peso: anterior.peso ?? null, reps: anterior.reps ?? null })) : ''}"
        >${hintAnteriorHtml(anterior)}</div>
      <div class="pa-field-err" data-err="${i}" role="alert" aria-live="polite"></div>
    </div>`;
}

// Pista discreta do que foi feito nesta série da última vez.
function hintAnteriorHtml(ant) {
  if (!ant || (ant.peso == null && ant.reps == null)) return '';
  const p = ant.peso != null ? `${String(ant.peso).replace('.', ',')} kg` : '—';
  const r = ant.reps != null ? ` × ${ant.reps}` : '';
  return `<span class="pa-serie-comp-ant">Última vez: ${esc(p + r)}</span>`;
}

// Depois do ✓, a pista vira comparação: "Última vez 60 kg · ▲ +2 kg".
function pintarComparacao(box, i) {
  const alvo = box.querySelector(`[data-comp="${i}"]`);
  if (!alvo) return;
  let ant = null;
  try { ant = alvo.dataset.ant ? JSON.parse(alvo.dataset.ant) : null; } catch {}
  if (!ant) return;
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl?.classList.contains('done')) { alvo.innerHTML = hintAnteriorHtml(ant); return; }
  const nOuNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  alvo.innerHTML = Exec.comparacaoSerieHtml({
    peso: nOuNull(val(box, `[data-s-peso="${i}"]`)),
    reps: nOuNull(val(box, `[data-s-reps="${i}"]`)),
  }, ant);
}

// ── Helpers do fluxo de séries / drop ──────────────────────────
const val = (box, sel) => (box.querySelector(sel)?.value || '').trim();

function marcarErro(box, i, sel, msg) {
  const err = box.querySelector(`.pa-serie-block[data-block="${i}"] [data-err="${i}"]`);
  if (err) err.textContent = msg || '';
  const inp = sel ? box.querySelector(sel) : null;
  if (inp) {
    inp.classList.add('pa-input-err');
    inp.focus();
    inp.addEventListener('input', () => {
      inp.classList.remove('pa-input-err');
      if (err) err.textContent = '';
    }, { once: true });
  }
}
function limparErro(box, i) {
  const err = box.querySelector(`.pa-serie-block[data-block="${i}"] [data-err="${i}"]`);
  if (err) err.textContent = '';
}

// Um bloco só conta como concluído quando a principal está pronta e,
// havendo drop set, o drop também.
function blocoConcluido(bl) {
  if (!bl || !bl.classList.contains('done')) return false;
  return bl.classList.contains('has-drop') ? bl.classList.contains('drop-done') : true;
}

// Marca/desmarca a série principal. Havendo drop, expande a etapa extra.
// Concluir aqui é o centro da execução: salva a série e o descanso começa.
function toggleSerie(box, i, nSeries) {
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl) return;
  const id = box.dataset.progBox;

  if (bl.classList.contains('done')) {          // toque de novo = desfazer a série inteira
    bl.classList.remove('done', 'drop-open', 'drop-done');
    limparErro(box, i);
    const est = Exec.estadoDescanso();
    if (est && est.itemId === id && est.serie === i) Exec.encerrarDescanso();
    esconderResumo(box);
    pintarComparacao(box, i);
    atualizarSeriesProg(box, nSeries);
    salvarAuto(id, coletarSeries(box, id, nSeries));
    return;
  }

  const peso = val(box, `[data-s-peso="${i}"]`);
  const reps = val(box, `[data-s-reps="${i}"]`);
  if (!peso && !reps) { marcarErro(box, i, `[data-s-peso="${i}"]`, 'Informe o peso ou as repetições'); return; }
  limparErro(box, i);
  bl.classList.add('done');
  animarCheck(bl);
  Exec.vibrar(Exec.VIB_SERIE);
  pintarComparacao(box, i);

  if (bl.classList.contains('has-drop') && !bl.classList.contains('drop-done')) {
    abrirDrop(box, i);                          // expande o drop e foca o peso reduzido
    atualizarSeriesProg(box, nSeries);
    return;                                     // o descanso só começa depois do drop
  }
  atualizarSeriesProg(box, nSeries);
  anunciar(`Série ${i + 1} registrada.`);
  concluirSerie(box, id, i, nSeries);
}

// Pulso do ✓: 200 ms, some sozinho. Respeita "reduzir movimento".
function animarCheck(bl) {
  const btn = bl.querySelector('.pa-serie-check');
  if (!btn || prefereMenosMovimento()) return;
  btn.classList.remove('pulsa');
  void btn.offsetWidth;                          // reinicia a animação
  btn.classList.add('pulsa');
}

// Expande o painel de drop, sugere o peso reduzido e leva o foco pra ele.
function abrirDrop(box, i) {
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl) return;
  bl.classList.add('drop-open');
  bl.classList.remove('drop-done');
  const dPeso = box.querySelector(`[data-d-peso="${i}"]`);
  if (dPeso && !dPeso.value) {                  // pré-preenche a sugestão (-X%) se ainda vazio
    const base = parseFloat(val(box, `[data-s-peso="${i}"]`));
    if (base > 0) dPeso.value = arredMeio(base * (1 - DROP_REDUCAO_PCT / 100));
  }
  requestAnimationFrame(() => {
    dPeso?.focus();
    bl.scrollIntoView({ block: 'center', behavior: prefereMenosMovimento() ? 'auto' : 'smooth' });
  });
}

// Conclui o drop: recolhe o painel e mostra o resumo compacto.
function toggleDrop(box, i, nSeries) {
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl) return;
  const peso = val(box, `[data-d-peso="${i}"]`);
  const reps = val(box, `[data-d-reps="${i}"]`);
  if (!peso) { marcarErro(box, i, `[data-d-peso="${i}"]`, 'Informe o peso do drop'); return; }
  if (!reps) { marcarErro(box, i, `[data-d-reps="${i}"]`, 'Informe as repetições do drop'); return; }
  limparErro(box, i);
  bl.classList.remove('drop-open');
  bl.classList.add('drop-done');
  preencherResumo(box, i);
  atualizarSeriesProg(box, nSeries);
  Exec.vibrar(Exec.VIB_SERIE);
  anunciar(`Série ${i + 1} com drop registrada.`);
  concluirSerie(box, box.dataset.progBox, i, nSeries);
}

// Reabre uma série concluída para edição (principal + drop).
function editarSerie(box, i, nSeries) {
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl) return;
  bl.classList.remove('done', 'drop-done');
  bl.classList.add('drop-open');
  atualizarSeriesProg(box, nSeries);
  requestAnimationFrame(() => box.querySelector(`[data-s-peso="${i}"]`)?.focus());
}

// Escreve o texto do resumo compacto a partir dos inputs atuais.
function preencherResumo(box, i) {
  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  if (!bl || !bl.classList.contains('has-drop')) return;
  const fmt = (p, r) => `${p || '–'} kg × ${r || '–'}`;
  const p = box.querySelector(`[data-res-p="${i}"]`);
  const d = box.querySelector(`[data-res-d="${i}"]`);
  if (p) p.textContent = fmt(val(box, `[data-s-peso="${i}"]`), val(box, `[data-s-reps="${i}"]`));
  if (d) d.textContent = fmt(val(box, `[data-d-peso="${i}"]`), val(box, `[data-d-reps="${i}"]`));
}

// Leva o foco para a próxima série pendente, ou para "Concluir exercício".
function focarProxima(box, i) {
  const blocks = [...box.querySelectorAll('.pa-serie-block')];
  const prox = blocks.find((b, idx) => idx > i && !blocoConcluido(b));
  if (prox) {
    prox.querySelector('[data-s-peso]')?.focus();
    prox.scrollIntoView({ block: 'nearest' });
  } else {
    box.querySelector('[data-ssave]')?.focus();
  }
}

function atualizarSeriesProg(box, nSeries) {
  const blocos = [...box.querySelectorAll('.pa-serie-block')];
  const done = blocos.filter(blocoConcluido).length;
  const el = box.querySelector('[data-sprog]');
  if (el) el.innerHTML = `<b>${done}</b>/${nSeries} séries concluídas`;
  box.querySelector('[data-ssave]')?.classList.toggle('pa-btn-ready', done > 0 && done === nSeries);
  marcarProximaSerie(box);
}

// Estado "é a sua vez": destaca a primeira série ainda pendente.
function marcarProximaSerie(box) {
  const blocos = [...box.querySelectorAll('.pa-serie-block')];
  blocos.forEach(b => b.classList.remove('is-next'));
  if (Exec.descansando()) return;               // durante o descanso quem manda é o cronômetro
  blocos.find(b => !blocoConcluido(b))?.classList.add('is-next');
}

// ═══════════════════════════════════════════════════════════
// FLUXO GUIADO — o que acontece depois do ✓
// ═══════════════════════════════════════════════════════════
// 1. a série vira JSON e é salva (sem bloquear a tela);
// 2. na última série, o esforço é perguntado ali mesmo, se prescrito;
// 3. o cronômetro de descanso começa dentro do próprio card;
// 4. terminando as séries, aparece o resumo do exercício.

// Lê as séries da tela. Só entra no banco o que foi concluído HOJE —
// número em campo de série pendente é sugestão da última vez, não execução.
function coletarSeries(box, id, nSeries, { tudoQuePreenchido = false } = {}) {
  const jaHoje = (regHoje(id)?.series_realizadas) || [];
  const agora = new Date().toISOString();
  const out = [];
  for (let i = 0; i < nSeries; i++) {
    const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
    const peso = val(box, `[data-s-peso="${i}"]`);
    const reps = val(box, `[data-s-reps="${i}"]`);
    const concluida = !!bl?.classList.contains('done');
    if (!concluida && !(tudoQuePreenchido && (peso || reps))) { out.push({ peso: null, reps: null }); continue; }

    const prev = jaHoje[i] || {};
    const s = {
      peso: peso === '' ? null : Number(peso),
      reps: reps === '' ? null : parseInt(reps, 10),
      t: prev.t || agora,
    };
    if (prev.rir != null) s.rir = prev.rir;
    if (bl?.classList.contains('has-drop')) {
      const dp = val(box, `[data-d-peso="${i}"]`);
      const dr = val(box, `[data-d-reps="${i}"]`);
      s.drop = (dp === '' && dr === '')
        ? null
        : { peso: dp === '' ? null : Number(dp), reps: dr === '' ? null : parseInt(dr, 10) };
    }
    out.push(s);
  }
  return out;
}

// Espelha o que acabou de ser salvo no cache local, para que progresso,
// volume e tempo restante reajam na hora — sem esperar a rede.
function aplicarSeriesNoCache(id, series) {
  const arr = (_progCache.get(id) || []).slice();
  const h = hoje();
  const pesos = series.map(s => s?.peso).filter(v => v != null).map(Number);
  const idx = arr.findIndex(r => r.data === h);
  const base = idx >= 0 ? arr[idx] : { id: `local-${id}`, treino_exercicio_id: id, data: h };
  const reg = {
    ...base,
    series_realizadas: series,
    carga_realizada: pesos.length ? Math.max(...pesos) : null,
  };
  if (idx >= 0) arr[idx] = reg; else arr.unshift(reg);
  _progCache.set(id, arr);
}

// Uma fila de gravação por exercício: dois ✓ seguidos não brigam pelo mesmo
// registro do dia (a RPC faz upsert por (item, data)).
const _filaSalvar = new Map();

function salvarAuto(id, series) {
  aplicarSeriesNoCache(id, series);
  atualizarBotaoFeito(id);
  atualizarUltimo(id);
  atualizarHero();
  atualizarStats();

  const anterior = _filaSalvar.get(id) || Promise.resolve();
  const p = anterior
    .catch(() => {})
    .then(() => salvarSeries({ treinoExercicioId: id, series }))
    .then(() => true)
    .catch(e => { mostrarToast('Não deu para salvar: ' + traduzirErro(e.message)); return false; });
  _filaSalvar.set(id, p);
  return p;
}

// Passo seguinte ao ✓ de uma série (já com o drop resolvido, quando houver).
function concluirSerie(box, id, i, nSeries) {
  const it = _itens.find(x => x.id === id) || {};
  const ehUltima = i >= nSeries - 1;
  const modo = String(it.rir_modo || '').trim();

  const gravar = (esforco) => {
    const series = coletarSeries(box, id, nSeries);
    if (esforco != null && series[i]) series[i].rir = esforco;
    salvarAuto(id, series);
  };

  // Última série com esforço prescrito: pergunta antes de mandar descansar.
  if (ehUltima && modo) {
    const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
    Exec.perguntarEsforco({
      ancora: bl, modo,
      onEscolha: (v) => { gravar(v); seguirAposSerie(box, id, i, nSeries); },
    });
    return;
  }
  gravar(null);
  seguirAposSerie(box, id, i, nSeries);
}

function seguirAposSerie(box, id, i, nSeries) {
  const it = _itens.find(x => x.id === id) || {};
  const ehUltima = i >= nSeries - 1;
  const todas = [...box.querySelectorAll('.pa-serie-block')].every(blocoConcluido);
  if (todas) mostrarResumoExercicio(box, id);

  // Bi-set: entre A e B não existe descanso — o conjunto é que descansa.
  if (ehBisetA(it) && parceiroB(it)) {
    anunciar('Sem descanso: vá direto para o exercício B.');
    mostrarToast('Sem descanso — siga direto para o B');
    if (!todas) focarProxima(box, i);
    atualizarHero();
    return;
  }

  const seg = descansoDaSerie(it, ehUltima);
  if (!seg) {                                   // sem descanso prescrito: segue o fluxo antigo
    if (!todas) focarProxima(box, i);
    atualizarHero();
    return;
  }

  const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
  // O título fica dentro do anel (96 px): "Descanso" e ponto. Que este é o
  // descanso pós-exercício, quem conta é o texto ao lado ("Próximo exercício").
  Exec.iniciarDescanso({
    itemId: id, serie: i, seg, ancora: bl,
    ultima: ehUltima,
    proxima: ehUltima ? null : { n: i + 2, reps: it.repeticoes ? fmtReps(it.repeticoes) : '' },
  });
  marcarProximaSerie(box);
  atualizarHero();
}

// Resumo de fechamento do exercício (volume, melhor série, comparação…).
function mostrarResumoExercicio(box, id) {
  const slot = box.querySelector('[data-resumo-slot]');
  if (!slot) return;
  const it = _itens.find(x => x.id === id) || {};
  const reg = regHoje(id);
  const series = (reg?.series_realizadas || []).filter(s => !serieVazia(s));
  if (!series.length) return;
  const ant = regAnterior(id);
  const esforco = series.map(s => s?.rir).filter(v => v != null).pop() ?? null;

  slot.innerHTML = Exec.resumoExercicioHtml({
    series,
    anteriores: ant?.series_realizadas || [],
    tempoMs: exTempoMs(id),
    descansoMs: exDescansoMs(id),
    esforco, modoEsforco: it.rir_modo,
    temProximo: !!acharProximoPendente(id),
  });
  box.querySelector('[data-ssave]')?.setAttribute('hidden', '');
  slot.querySelector('[data-resumo-prox]')
    ?.addEventListener('click', () => irParaProximoExercicio(id));
  anunciar('Exercício concluído.');
}

function esconderResumo(box) {
  const slot = box.querySelector('[data-resumo-slot]');
  if (slot) slot.innerHTML = '';
  box.querySelector('[data-ssave]')?.removeAttribute('hidden');
}

// Fecha o exercício atual e abre o próximo pendente — a "condução" do treino.
function irParaProximoExercicio(id) {
  Exec.encerrarDescanso();
  Exec.pararMetronomo();
  recolherProg(id);
  atualizarBotaoFeito(id);
  const prox = destacarProximoPendente(id);
  if (prox) {
    abrirEx(prox.dataset.ex);
  } else {
    mostrarToast('✓ Todos os exercícios concluídos!');
    document.querySelector('[data-finalizar]')?.focus();
  }
  atualizarHero();
}

// Resumo compacto de uma sessão para o histórico.
// Sem drop: "20/22/22 kg · 8/7/6 reps". Com drop: "18×12 ↳12×8 · ...".
function resumoSeries(r) {
  const arr = r.series_realizadas || [];
  if (arr.length) {
    if (arr.some(s => s && s.drop)) {
      return arr.map(s => {
        const base = `${s.peso ?? '–'}×${s.reps ?? '–'}`;
        return s.drop ? `${base} ↳${s.drop.peso ?? '–'}×${s.drop.reps ?? '–'}` : base;
      }).join(' · ');
    }
    const pesos = arr.map(s => s.peso ?? '–').join('/');
    const reps  = arr.map(s => s.reps ?? '–').join('/');
    return `${pesos} kg · ${reps} reps`;
  }
  // registros antigos (carga única, antes do por-série)
  const c = r.carga_realizada != null ? `${r.carga_realizada} kg` : '—';
  const rp = r.reps_realizadas != null ? ` · ${r.reps_realizadas} reps` : '';
  return c + rp;
}

// "Concluir exercício" — a saída manual, para quem preencheu tudo de uma vez
// sem usar o ✓ de cada série. Fecha o que estiver preenchido e cai no mesmo
// fluxo do guiado (salva, resume e leva ao próximo).
async function salvarSeriesUI(id, nSeries) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;

  // Série com drop iniciada mas com o drop incompleto → bloqueia a finalização.
  for (let i = 0; i < nSeries; i++) {
    const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
    if (!bl?.classList.contains('has-drop')) continue;
    const temPrincipal = val(box, `[data-s-peso="${i}"]`) || val(box, `[data-s-reps="${i}"]`);
    const dp = val(box, `[data-d-peso="${i}"]`);
    const dr = val(box, `[data-d-reps="${i}"]`);
    if (temPrincipal && (!dp || !dr)) {
      abrirDrop(box, i);
      marcarErro(box, i, `[data-d-peso="${i}"]`, 'Conclua o Drop Set antes de finalizar a série');
      return;
    }
  }

  const series = coletarSeries(box, id, nSeries, { tudoQuePreenchido: true });
  if (series.every(s => s.peso == null && s.reps == null)) {
    mostrarToast('Preencha ao menos uma série.');
    return;
  }

  // O que estava preenchido passa a contar como concluído também na tela.
  series.forEach((s, i) => {
    if (s.peso == null && s.reps == null) return;
    const bl = box.querySelector(`.pa-serie-block[data-block="${i}"]`);
    bl?.classList.add('done');
    if (bl?.classList.contains('has-drop')) { bl.classList.remove('drop-open'); bl.classList.add('drop-done'); preencherResumo(box, i); }
    pintarComparacao(box, i);
  });
  atualizarSeriesProg(box, nSeries);

  const btn = box.querySelector('[data-ssave]');
  if (btn?.disabled) return;                       // trava o duplo clique
  const txt = btn?.querySelector('[data-ssave-txt]');
  if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
  if (txt) txt.textContent = 'Salvando...';
  try {
    const ok = await salvarAuto(id, series);
    if (!ok) return;
    mostrarToast('✓ Exercício concluído');
    _progCache.set(id, await progressaoDoItem(id));  // reconcilia com o que o banco gravou
    atualizarUltimo(id);
    mostrarResumoExercicio(box, id);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    if (txt) txt.textContent = 'Concluir exercício';
  }
}

async function removerCarga(regId, itemId) {
  if (!(await confirmar({
    titulo: 'Excluir registro',
    mensagem: 'Excluir este registro?',
    textoOk: 'Excluir', perigo: true,
  }))) return;
  try {
    await excluirCarga(regId);
    await carregarProg(itemId, true);
    atualizarUltimo(itemId);
    atualizarHero();
    atualizarStats();
  } catch (e) { mostrarToast('Erro: ' + traduzirErro(e.message)); }
}

// Mini-gráfico de evolução da carga (SVG inline). Só desenha com >= 2 pontos.
function sparkline(regs) {
  const pts = [...regs]
    .filter(r => r.carga_realizada != null)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  if (pts.length < 2) return '';
  const w = 300, h = 60, pad = 8;
  const vals = pts.map(r => Number(r.carga_realizada));
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = i => pad + i * (w - 2 * pad) / (pts.length - 1);
  const y = v => (max === min) ? h / 2 : (h - pad) - (v - min) / (max - min) * (h - 2 * pad);
  const poly = pts.map((_, i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  const dots = pts.map((_, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="2.8"/>`).join('');
  const delta = vals[vals.length - 1] - vals[0];
  const sinal = delta > 0 ? `+${delta}` : `${delta}`;
  return `
    <div class="pa-chart">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="pa-spark">
        <polyline points="${poly}" />${dots}
      </svg>
      <div class="pa-trend">${min} → ${max} kg · Δ ${sinal} kg em ${pts.length} treinos</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// ESTADOS AUXILIARES / HELPERS
// ═══════════════════════════════════════════════════════════
function topo() {
  const nome = _paciente?.nome || 'Aluno';
  const inicial = (nome.trim()[0] || 'A').toUpperCase();
  return `
    <header class="pa-topbar">
      <div class="pa-topbrand evo-logo evo-logo--sm"><span class="evo-logo-mark" aria-hidden="true">E</span><span class="evo-logo-name">Evollo</span></div>
      <div class="pa-topuser">
        <span class="pa-avatar">${esc(inicial)}</span>
        <span class="pa-username">${esc(nome.split(' ')[0])}</span>
        ${pushSuportado() ? `<button class="pa-logout" data-push-toggle title="Notificações" aria-label="Ativar ou desativar notificações"><i data-lucide="${pushAtivo() ? 'bell-ring' : 'bell'}"></i></button>` : ''}
        <button class="pa-logout" id="paLogout" title="Sair"><i data-lucide="log-out"></i></button>
      </div>
    </header>`;
}

function renderSemTreino() {
  _secao = 'treino';
  app().innerHTML = `
    ${topo()}
    <main class="pa-main">
      <div class="pa-empty pa-empty-lg">
        <i data-lucide="dumbbell"></i>
        <div class="pa-empty-t">Nenhum treino liberado ainda</div>
        <div class="pa-empty-s">Assim que seu profissional montar seu treino, ele aparece aqui.</div>
      </div>
    </main>
    ${bottomNav()}`;
  ligarShell();
}

function renderCarregando(txt) {
  app().innerHTML = `<div class="pa-boot"><span class="pa-spin pa-spin-lg"></span><div>${esc(txt || 'Carregando...')}</div></div>`;
}

function renderErro(txt) {
  app().innerHTML = `
    <div class="pa-boot">
      <i data-lucide="triangle-alert"></i>
      <div>${esc(txt)}</div>
      <button class="pa-btn" style="max-width:200px" onclick="location.reload()">Tentar de novo</button>
    </div>`;
}

async function logout() {
  await sair();
  _paciente = null; _treinos = []; _treinoSel = null; _itens = []; _dias = []; _diaSel = 'A';
  _progAbertas.clear();
  _progCache = new Map();
  _secao = 'treino'; _view = 'lista'; _treinosCarregados = false;
  renderAuth();
}

// UI helpers do formulário de auth
function msg(texto, ok = false) {
  const el = document.getElementById('paMsg');
  if (el) { el.textContent = texto; el.classList.toggle('ok', ok); }
}
function travarSubmit(travar, texto) {
  const b = document.getElementById('paSubmit');
  if (b) { b.disabled = travar; b.textContent = texto; }
}

// Dias que realmente têm exercício no treino (na ordem A..G).
function diasComExercicios(itens) {
  const set = new Set(itens.map(it => it.dia));
  return LETRAS.filter(d => set.has(d));
}

// Descanso "em segundos": se vier só número, acrescenta "s" (ex.: 60 → 60s).
function fmtDescanso(v) {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? s + 's' : s;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtData = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
// "6-8" → "6–8" (traço tipográfico, só entre dígitos).
const fmtReps = r => String(r ?? '').replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
const hoje = () => new Date().toISOString().slice(0, 10);
