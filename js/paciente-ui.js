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

// ── Estado ──
let _paciente = null;
let _treinos  = [];
let _treinoSel = null;   // id do treino selecionado
let _itens    = [];
let _dias     = [];
let _diaSel   = 'A';
let _progAbertas = new Set();
let _progCache = new Map();   // id do item -> regs (progressão) já carregada
let _secao    = 'treino';     // seção ativa: 'treino' | 'dieta'
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

const app = () => document.getElementById('app');

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
export async function iniciarApp() {
  renderCarregando('Abrindo...');
  try {
    const sessao = await sessaoAtual();
    if (!sessao) { renderAuth(); return; }

    _paciente = await meuPaciente();

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

    await abrirTreino();
  } catch (e) {
    renderErro(traduzirErro(e.message));
  }
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
      <div class="pa-brand">
        <div class="pa-brand-mark">N</div>
        <div class="pa-brand-name">Nutri<em>Map</em></div>
        <div class="pa-brand-sub">Área do aluno</div>
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
        ? 'Você foi convidado pelo seu nutri 🌿 Crie sua conta (email + senha) e seu treino aparece automaticamente.'
        : 'Use o email e a senha que você definir. Depois é só digitar o código que seu nutri te passou.'}</div>
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
      <div class="pa-brand">
        <div class="pa-brand-mark">N</div>
        <div class="pa-brand-name">Quase lá</div>
        <div class="pa-brand-sub">Vincule sua conta</div>
      </div>

      <div class="pa-card">
        <p class="pa-hint">Digite o <strong>código</strong> que seu nutricionista te enviou. Ele liga sua conta ao seu acompanhamento.</p>

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
async function abrirTreino() {
  renderCarregando('Carregando seu treino...');
  try {
    _treinos = await meusTreinos();
    _treinosCarregados = true;
    if (!_treinos.length) { renderSemTreino(); return; }

    if (!_treinoSel || !_treinos.some(t => t.id === _treinoSel)) {
      _treinoSel = _treinos[0].id;
    }
    _itens = await itensDoTreino(_treinoSel);
    _dias = diasComExercicios(_itens);
    if (!_dias.includes(_diaSel)) _diaSel = _dias[0] || 'A';
    _progAbertas.clear();
    _view = 'lista';                 // sempre abre na seleção de dias
    await preCarregarProgressao();   // 1 consulta: deixa o "Registrar séries" instantâneo
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
function renderListaDias() {
  const nome = (_paciente?.nome || 'Aluno').trim().split(' ')[0];
  const proximo = proximoDiaSugerido();
  const treinadoHoje = diaTreinadoHoje();

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

      ${statsTopo()}
      ${seletor}
      <div class="pa-diacards">${cards}</div>
    </main>
    ${bottomNav()}`;

  app().querySelectorAll('[data-abrir]').forEach(b =>
    b.addEventListener('click', () => { _diaSel = b.dataset.abrir; _view = 'treino'; renderTreino(); }));
  const sel = document.getElementById('paTreinoSel');
  if (sel) sel.addEventListener('change', () => { _treinoSel = sel.value; _diaSel = 'A'; _view = 'lista'; abrirTreino(); });
  ligarShell();
}

// Card de um dia na lista de seleção.
function cardDia(dia, proximo, treinadoHoje) {
  const n = contarDia(dia);
  const grupos = gruposDoDia(dia).slice(0, 3).join(' · ');
  const feito = dia === treinadoHoje;
  const isProx = dia === proximo && !feito;

  // Card em destaque: o treino do dia (PRÓXIMO) — principal ponto de ação.
  if (isProx) {
    const min = resumoDia(dia).minutos;
    const conta = `${n} ${n === 1 ? 'exercício' : 'exercícios'}${min ? ` · aproximadamente ${min} min` : ''}`;
    return `
      <div class="pa-diacard prox featured">
        <div class="pa-dc-head">
          <span class="pa-dc-letra">${dia}</span>
          <div class="pa-dc-headtext">
            <span class="pa-dc-nome">Treino ${dia}</span>
            <span class="pa-dc-badge prox">Próximo</span>
          </div>
        </div>
        <div class="pa-dc-info">
          <div class="pa-dc-grupos">${esc(grupos || 'Exercícios variados')}</div>
          <div class="pa-dc-conta">${conta}</div>
        </div>
        <button class="pa-dc-cta" data-abrir="${dia}">Começar treino <i data-lucide="arrow-right"></i></button>
      </div>`;
  }

  // Demais cards: layout compacto com seta (inalterado).
  const badge = feito ? `<span class="pa-dc-badge feito">✓ Feito hoje</span>` : '';
  return `
    <button class="pa-diacard" data-abrir="${dia}">
      <span class="pa-dc-letra">${dia}</span>
      <span class="pa-dc-body">
        <span class="pa-dc-top"><span class="pa-dc-nome">Treino ${dia}</span>${badge}</span>
        <span class="pa-dc-sub">${esc(grupos || 'Exercícios variados')} · ${n} ${n === 1 ? 'exercício' : 'exercícios'}</span>
      </span>
      <span class="pa-dc-arrow"><i data-lucide="chevron-right"></i></span>
    </button>`;
}

// ── TELA B: página de um treino (voltar + seletor de dia + finalizar) ──
function renderTreinoDia() {
  const tabs = _dias.map(d =>
    `<button class="pa-dia ${d === _diaSel ? 'active' : ''}" data-dia="${d}">${d}</button>`).join('');
  const r = resumoDia(_diaSel);

  app().innerHTML = `
    ${topo()}
    <main class="pa-main">
      <button class="pa-back" data-voltar><i data-lucide="chevron-left"></i> Treinos</button>

      <section class="pa-hero">
        <div class="pa-hero-hi">Treino do dia</div>
        <div class="pa-hero-title">Treino ${esc(_diaSel)}</div>
        <div class="pa-hero-bar" data-hero-bar><span style="width:${r.pct}%"></span></div>
        <div class="pa-hero-meta">
          <span class="pa-hero-count" data-hero-count><b>${r.feitos}</b>/${r.total} exercícios</span>
          ${r.minutos ? `<span class="pa-hero-time"><i data-lucide="clock"></i> ≈${r.minutos} min</span>` : ''}
        </div>
      </section>

      <div class="pa-dias">${tabs}</div>
      <div id="paDiaConteudo"></div>
      <button class="pa-btn pa-finalizar" data-finalizar><i data-lucide="flag"></i> Finalizar treino</button>
    </main>
    ${bottomNav()}`;

  document.querySelector('[data-voltar]').addEventListener('click', () => { _view = 'lista'; renderTreino(); });
  document.querySelector('[data-finalizar]').addEventListener('click', finalizarTreino);
  app().querySelectorAll('.pa-dia').forEach(b =>
    b.addEventListener('click', () => { _diaSel = b.dataset.dia; renderTreinoDia(); }));
  ligarShell();

  renderDia();
}

function finalizarTreino() {
  mostrarToast('✓ Treino concluído! 💪');
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
    ${item('treino', 'dumbbell', 'Treino')}
    ${item('dieta', 'salad', 'Dieta')}
  </nav>`;
}

// Liga o logout do topo + a troca de seção da barra inferior.
function ligarShell() {
  document.getElementById('paLogout')?.addEventListener('click', logout);
  app().querySelectorAll('.pa-nav-item').forEach(b =>
    b.addEventListener('click', () => {
      const sec = b.dataset.sec;
      if (sec === _secao) return;
      if (sec === 'dieta') renderDieta();
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

// Seção Dieta — placeholder por enquanto (só treino no ar).
function renderDieta() {
  _secao = 'dieta';
  app().innerHTML = `
    ${topo()}
    <main class="pa-main">
      <div class="pa-empty pa-empty-lg">
        <i data-lucide="salad"></i>
        <div class="pa-empty-t">Sua dieta está a caminho</div>
        <div class="pa-empty-s">Em breve seu nutricionista vai liberar seu plano alimentar por aqui.</div>
      </div>
    </main>
    ${bottomNav()}`;
  ligarShell();
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

// Resumo do dia p/ o hero: total, feitos hoje, % e tempo estimado (min).
function resumoDia(dia) {
  const doDia = _itens.filter(it => it.dia === dia);
  const total = doDia.length;
  const hojeStr = hoje();
  let feitos = 0, seg = 0;
  for (const it of doDia) {
    const regs = _progCache.get(it.id) || [];
    if (regs.some(r => r.data === hojeStr)) feitos++;
    const series = Math.max(Number(it.series) || 3, 1);
    const descanso = parseInt(String(it.descanso ?? '').replace(/\D/g, ''), 10) || 60;
    seg += 30 + series * (35 + descanso);   // ~30s setup + séries (execução + descanso)
  }
  const pct = total ? Math.round(feitos / total * 100) : 0;
  const minutos = total ? Math.max(5, Math.round(seg / 60 / 5) * 5) : 0;
  return { total, feitos, pct, minutos };
}

// Atualiza barra + contador do hero sem re-renderizar a tela toda.
function atualizarHero() {
  const bar = document.querySelector('[data-hero-bar] > span');
  const count = document.querySelector('[data-hero-count]');
  if (!bar && !count) return;
  const r = resumoDia(_diaSel);
  if (bar) bar.style.width = r.pct + '%';
  if (count) count.innerHTML = `<b>${r.feitos}</b>/${r.total} exercícios`;
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

  cont.innerHTML = doDia.map((it, i) => cardExercicio(it, i)).join('');

  cont.querySelectorAll('[data-carga]').forEach(b =>
    b.addEventListener('click', () => toggleProg(b.dataset.carga)));

  // Reabre painéis que estavam abertos
  _progAbertas.forEach(id => {
    const box = cont.querySelector(`[data-prog-box="${id}"]`);
    if (box) { box.hidden = false; carregarProg(id); }
  });
}

function cardExercicio(it, i) {
  const ex = it.exercicio || {};
  const grupo = ex.grupo_muscular ? esc(ex.grupo_muscular) : '';
  const mi = metodoInfo(it.metodo);

  // 2 · Linha compacta de prescrição — só mostra o que existe.
  const specParts = [];
  if (it.series != null && it.series !== '')
    specParts.push(`<span><b>${esc(it.series)}</b> ${Number(it.series) === 1 ? 'série' : 'séries'}</span>`);
  if (it.repeticoes) specParts.push(`<span><b>${esc(fmtReps(it.repeticoes))}</b> reps</span>`);
  if (it.descanso)   specParts.push(`<span>${esc(fmtDescanso(it.descanso))} descanso</span>`);
  const tec = it.metodo ? `<span class="pa-ex-tec"><i data-lucide="zap"></i> ${esc(it.metodo)}</span>` : '';
  const specLine = (specParts.length || tec)
    ? `<div class="pa-ex-spec">${specParts.join('<span class="sep">·</span>')}${tec}</div>` : '';

  // 3-4 · Último treino + evolução (do cache já pré-carregado).
  const regs = _progCache.get(it.id) || [];

  const video = ex.video_url
    ? `<a class="pa-video" href="${esc(ex.video_url)}" target="_blank" rel="noopener"><i data-lucide="play"></i> Ver vídeo</a>`
    : '';

  return `
    <div class="pa-ex">
      <div class="pa-ex-top">
        <span class="pa-ex-num">${i + 1}</span>
        <div class="pa-ex-id">
          <div class="pa-ex-nome">${esc(ex.nome || '(exercício)')}</div>
          ${grupo ? `<div class="pa-ex-grupo">${grupo}</div>` : ''}
        </div>
      </div>

      ${specLine}
      ${mi ? `<div class="pa-metodo"><i data-lucide="lightbulb"></i> ${esc(mi.desc)}</div>` : ''}
      ${it.observacao ? `<div class="pa-obs"><i data-lucide="sticky-note"></i> ${esc(it.observacao)}</div>` : ''}
      ${ex.observacoes ? `<div class="pa-obs pa-obs-tec"><i data-lucide="info"></i> ${esc(ex.observacoes)}</div>` : ''}

      <div class="pa-ex-last">${lastBlockInner(regs)}</div>

      <div class="pa-ex-foot">
        ${video}
        <button class="pa-carga-btn" data-carga="${it.id}"><i data-lucide="chart-line"></i> Registrar séries</button>
      </div>

      <div class="pa-prog" data-prog-box="${it.id}" hidden></div>
    </div>`;
}

// Conteúdo interno do bloco "Último treino" (reaproveitado ao salvar/excluir).
function lastBlockInner(regs) {
  const ult = ultimoResumo(regs);
  const evo = evolucaoBadge(regs);
  return `<div class="pa-last-top"><span class="pa-last-lab">Último treino</span>${evo}</div>` +
    (ult
      ? `<div class="pa-last-val"><b>${esc(ult.pesoTxt)}</b>${ult.repsTxt ? ` · ${esc(ult.repsTxt)}` : ''}${ult.dataTxt ? ` <span class="pa-last-date">· ${esc(ult.dataTxt)}</span>` : ''}</div>`
      : `<div class="pa-last-vazio">Sem registros anteriores</div>`);
}

// Reaproveita o cache para reescrever só o bloco "Último treino" de um card.
function atualizarUltimo(id) {
  const last = document.querySelector(`[data-prog-box="${id}"]`)?.closest('.pa-ex')?.querySelector('.pa-ex-last');
  if (last) last.innerHTML = lastBlockInner(_progCache.get(id) || []);
}

// Resumo da última sessão: peso representativo + reps por série + data curta.
function ultimoResumo(regs) {
  const u = regs && regs[0];
  if (!u) return null;
  const arr = u.series_realizadas || [];
  let pesoTxt = '', repsTxt = '';
  if (arr.length) {
    const pesos = arr.map(s => s.peso).filter(v => v != null).map(Number);
    if (pesos.length) {
      const uniq = [...new Set(pesos)];
      pesoTxt = uniq.length === 1 ? `${uniq[0]} kg` : `${Math.min(...pesos)}–${Math.max(...pesos)} kg`;
    }
    repsTxt = arr.map(s => (s.reps != null ? s.reps : '–')).join(' / ');
  } else {
    if (u.carga_realizada != null) pesoTxt = `${u.carga_realizada} kg`;
    if (u.reps_realizadas != null) repsTxt = String(u.reps_realizadas);
  }
  if (!pesoTxt && !repsTxt) return null;
  return { pesoTxt: pesoTxt || '—', repsTxt, dataTxt: fmtDataCurta(u.data) };
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
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;
  if (box.hidden) {
    box.hidden = false;
    _progAbertas.add(id);
    carregarProg(id);
  } else {
    box.hidden = true;
    box.innerHTML = '';
    _progAbertas.delete(id);
  }
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
  const ultima = regs[0] || null;               // sessão mais recente (regs vem data desc)
  const ultimaSeries = (ultima && ultima.series_realizadas) || [];

  // Nº de séries: o prescrito; senão o que veio salvo; senão 1. Teto de 12.
  const nSeries = Math.min(
    Math.max(Number(it.series) || ultimaSeries.length || 1, 1), 12);

  const linhasSeries = Array.from({ length: nSeries }, (_, i) => {
    const s = ultimaSeries[i] || {};
    return `
      <div class="pa-serie" data-serie="${i}">
        <span class="pa-serie-num">${i + 1}ª</span>
        <input type="number" step="0.5" inputmode="decimal" class="pa-input pa-mini"
          data-s-peso="${i}" placeholder="kg" value="${s.peso ?? ''}">
        <input type="number" inputmode="numeric" class="pa-input pa-mini"
          data-s-reps="${i}" placeholder="${esc(alvoReps || 'reps')}" value="${s.reps ?? ''}">
        <button type="button" class="pa-serie-check" data-sdone="${i}"
          title="Concluir série" aria-label="Concluir série ${i + 1}"><i data-lucide="check"></i></button>
      </div>`;
  }).join('');

  const quando = ultima ? `Última vez: ${fmtData(ultima.data)}` : 'Primeiro registro';

  // Histórico das sessões anteriores (a mais recente já está no formulário)
  const anteriores = regs.slice(1);
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
    <button class="pa-btn pa-btn-mini" data-ssave><i data-lucide="circle-check-big"></i> Concluir exercício</button>
    ${hist}`;

  box.querySelector('[data-ssave]').addEventListener('click', () => salvarSeriesUI(id, nSeries));
  box.querySelectorAll('[data-sdone]').forEach(b =>
    b.addEventListener('click', () => toggleSerie(box, Number(b.dataset.sdone), nSeries)));
  // Enter no campo de reps conclui a série e pula para a próxima.
  box.querySelectorAll('[data-s-reps]').forEach(inp =>
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); toggleSerie(box, Number(inp.dataset.sReps), nSeries); }
    }));
  box.querySelectorAll('[data-pdel]').forEach(b =>
    b.addEventListener('click', () => removerCarga(b.dataset.pdel, id)));
}

// Marca/desmarca uma série como concluída e avança o foco para a próxima.
function toggleSerie(box, i, nSeries) {
  const row = box.querySelector(`.pa-serie[data-serie="${i}"]`);
  if (!row) return;
  if (row.classList.contains('done')) {   // toque de novo = desfazer
    row.classList.remove('done');
    atualizarSeriesProg(box, nSeries);
    return;
  }
  const peso = (box.querySelector(`[data-s-peso="${i}"]`)?.value || '').trim();
  const reps = (box.querySelector(`[data-s-reps="${i}"]`)?.value || '').trim();
  if (!peso && !reps) { mostrarToast('Preencha o peso ou as reps desta série.'); return; }

  row.classList.add('done');
  atualizarSeriesProg(box, nSeries);

  const rows = [...box.querySelectorAll('.pa-serie[data-serie]')];
  const prox = rows.find((r, idx) => idx > i && !r.classList.contains('done'));
  if (prox) {
    prox.querySelector('[data-s-peso]')?.focus();
    prox.scrollIntoView({ block: 'nearest' });
  } else {
    box.querySelector('[data-ssave]')?.focus();   // todas prontas → foco em "Concluir exercício"
  }
}

function atualizarSeriesProg(box, nSeries) {
  const done = box.querySelectorAll('.pa-serie.done').length;
  const el = box.querySelector('[data-sprog]');
  if (el) el.innerHTML = `<b>${done}</b>/${nSeries} séries concluídas`;
  box.querySelector('[data-ssave]')?.classList.toggle('pa-btn-ready', done > 0 && done === nSeries);
}

// Resumo compacto de uma sessão para o histórico: "20/22/22 kg · 8/7/6 reps".
function resumoSeries(r) {
  const arr = r.series_realizadas || [];
  if (arr.length) {
    const pesos = arr.map(s => s.peso ?? '–').join('/');
    const reps  = arr.map(s => s.reps ?? '–').join('/');
    return `${pesos} kg · ${reps} reps`;
  }
  // registros antigos (carga única, antes do por-série)
  const c = r.carga_realizada != null ? `${r.carga_realizada} kg` : '—';
  const rp = r.reps_realizadas != null ? ` · ${r.reps_realizadas} reps` : '';
  return c + rp;
}

async function salvarSeriesUI(id, nSeries) {
  const box = document.querySelector(`[data-prog-box="${id}"]`);
  if (!box) return;
  const series = [];
  for (let i = 0; i < nSeries; i++) {
    const peso = (box.querySelector(`[data-s-peso="${i}"]`)?.value || '').trim();
    const reps = (box.querySelector(`[data-s-reps="${i}"]`)?.value || '').trim();
    series.push({
      peso: peso === '' ? null : Number(peso),
      reps: reps === '' ? null : parseInt(reps, 10),
    });
  }
  if (series.every(s => s.peso == null && s.reps == null)) {
    mostrarToast('Preencha ao menos uma série.');
    return;
  }
  try {
    await salvarSeries({ treinoExercicioId: id, series });
    mostrarToast('✓ Exercício concluído');
    await carregarProg(id, true);   // atualiza o cache com o que acabou de salvar
    atualizarUltimo(id);            // reflete no resumo "Último treino" do card
    atualizarHero();                // atualiza progresso (feitos/total) do dia
    atualizarStats();               // sequência + recordes podem ter mudado
  } catch (e) { mostrarToast('Erro: ' + traduzirErro(e.message)); }
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
      <div class="pa-topbrand"><span class="pa-topmark">N</span> Nutri<em>Map</em></div>
      <div class="pa-topuser">
        <span class="pa-avatar">${esc(inicial)}</span>
        <span class="pa-username">${esc(nome.split(' ')[0])}</span>
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
        <div class="pa-empty-s">Assim que seu nutricionista montar seu treino, ele aparece aqui.</div>
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
// Data curta pt-BR: "10 jul.".
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function fmtDataCurta(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getDate()} ${MESES[dt.getMonth()]}.`;
}
const hoje = () => new Date().toISOString().slice(0, 10);
