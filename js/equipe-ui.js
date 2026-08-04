// ═══════════════════════════════════════════════════════════
// EQUIPE — UI do app do colaborador (entrar → vincular → pagamentos)
// ═══════════════════════════════════════════════════════════
// Três telas e nada mais: entrar, ligar a conta ao cadastro pelo código, e ver
// os pagamentos. O colaborador não lança nada — o que ele precisa é conferir
// quanto recebeu, por quê, e abrir os dois documentos do mês: o espelho de
// ponto que originou as horas e o contracheque que quitou o pagamento.
//
// O CONTRACHEQUE MOSTRADO É O ARQUIVO PUBLICADO, não uma remontagem: o recibo
// tem que ser o mesmo que foi fechado, mesmo que a folha seja reaberta depois.
// Sem arquivo (meses anteriores a esta função), a tela mostra o resumo da
// linha e diz que o documento não foi emitido — em vez de fabricar um.

import {
  entrar, cadastrar, sair, sessaoAtual,
  meuCadastro, vincularPorCodigo, vincularPorEmail, meusPagamentos, meusDocumentos,
  traduzirErro,
} from './equipe-data.js';
import {
  nomeCompetencia, totalItem, textoDeMinutos, formatarBRL,
} from './folha.js';
import { formatarData, iniciaisDoNome } from './utils.js';

let _eu = null;          // cadastro do colaborador
let _pagamentos = [];
let _documentos = [];
let _novos = 0;          // documentos ainda não vistos, para o selo do atalho

/** Rótulo e ícone por tipo. Cópia enxuta de documentos.js para o app não
 *  carregar a camada administrativa inteira só para desenhar um cartão. */
const TIPOS_DOC = {
  contracheque:          { rotulo: 'Contracheque',            icone: 'receipt-text' },
  folha_ponto:           { rotulo: 'Folha de ponto',          icone: 'clock' },
  comprovante_ferias:    { rotulo: 'Comprovante de férias',   icone: 'palmtree' },
  aviso_ferias:          { rotulo: 'Aviso de férias',         icone: 'calendar-check' },
  recibo_ferias:         { rotulo: 'Recibo de férias',        icone: 'receipt' },
  comprovante_pagamento: { rotulo: 'Comprovante de pagamento', icone: 'banknote' },
  informe_rendimentos:   { rotulo: 'Informe de rendimentos',  icone: 'file-text' },
  comunicado:            { rotulo: 'Comunicado',              icone: 'megaphone' },
  advertencia:           { rotulo: 'Advertência',             icone: 'triangle-alert' },
  documento_admissional: { rotulo: 'Documento admissional',   icone: 'file-badge' },
  personalizado:         { rotulo: 'Documento',               icone: 'file' },
};

const app = () => document.getElementById('app');

// ───────────────────────────────────────────────────────────
// ENTRADA
// ───────────────────────────────────────────────────────────
export async function iniciarApp() {
  renderCarregando('Abrindo...');
  try {
    const sessao = await sessaoAtual();
    if (!sessao) { renderAuth(); return; }

    _eu = await meuCadastro();

    // Código embutido no link do convite (equipe.html?codigo=ABC123). Vem
    // primeiro: é intenção explícita de quem mandou o link.
    if (!_eu) {
      const cod = codigoDaUrl();
      if (cod) {
        try {
          await vincularPorCodigo(cod);
          _eu = await meuCadastro();
          limparCodigoDaUrl();
        } catch (e) {
          renderVincular(cod, traduzirErro(e.message));
          return;
        }
      }
    }

    // Sem código: tenta pelo e-mail da conta. Quem criou a conta com o mesmo
    // e-mail da ficha entra direto, sem nunca ver um código.
    if (!_eu) {
      try {
        if (await vincularPorEmail()) _eu = await meuCadastro();
      } catch (e) {
        // Conta já vinculada a outro cadastro, acesso bloqueado: casos que
        // merecem a mensagem, não uma tela de código que nunca vai funcionar.
        renderVincular('', traduzirErro(e.message));
        return;
      }
    }

    if (!_eu) { renderVincular(codigoDaUrl()); return; }

    // Bloqueado: as políticas já negam os dados, mas sem esta tela ele cairia
    // numa lista vazia sem explicação — e um app que some com o holerite da
    // pessoa sem dizer por quê vira ligação para o gestor.
    if (_eu.acesso_bloqueado) { renderBloqueado(); return; }

    await abrirPagamentos();
  } catch (e) {
    renderErro(traduzirErro(e.message));
  }
}

const codigoDaUrl = () =>
  (new URLSearchParams(location.search).get('codigo') || '').trim().toUpperCase();

function limparCodigoDaUrl() {
  try { history.replaceState({}, '', location.pathname); } catch (e) {}
}

// ───────────────────────────────────────────────────────────
// TELA 1 — Entrar / criar conta
// ───────────────────────────────────────────────────────────
function renderAuth(modo = 'entrar', erro = '') {
  const entrando = modo === 'entrar';
  app().innerHTML = `
    <div class="eq-auth">
      <div class="eq-marca">
        <div class="eq-marca-selo" aria-hidden="true">E</div>
        <div class="eq-marca-nome">Evollo</div>
        <div class="eq-marca-sub">Área do colaborador</div>
      </div>

      <div class="eq-cartao">
        <div class="eq-abas" role="tablist">
          <button class="eq-aba${entrando ? ' on' : ''}" data-eq-modo="entrar">Entrar</button>
          <button class="eq-aba${entrando ? '' : ' on'}" data-eq-modo="criar">Criar conta</button>
        </div>

        <label class="eq-campo">
          <span>E-mail</span>
          <input type="email" id="eqEmail" autocomplete="email" inputmode="email" placeholder="voce@email.com">
        </label>
        <label class="eq-campo">
          <span>Senha</span>
          <input type="password" id="eqSenha" autocomplete="${entrando ? 'current-password' : 'new-password'}" placeholder="${entrando ? 'Sua senha' : 'Mínimo 6 caracteres'}">
        </label>

        <div class="eq-erro" id="eqErro">${esc(erro)}</div>

        <button class="eq-btn" id="eqOk">${entrando ? 'Entrar' : 'Criar conta'}</button>

        <p class="eq-nota">
          ${entrando
            ? 'Primeira vez? Crie a conta usando o mesmo e-mail que está no seu cadastro.'
            : 'Use o mesmo e-mail que a academia tem no seu cadastro — assim você entra direto, sem código.'}
        </p>
      </div>
    </div>`;

  app().querySelectorAll('[data-eq-modo]').forEach(b =>
    b.addEventListener('click', () => renderAuth(b.dataset.eqModo)));

  const email = document.getElementById('eqEmail');
  const senha = document.getElementById('eqSenha');
  const botao = document.getElementById('eqOk');

  const enviar = async () => {
    const e = email.value.trim();
    const s = senha.value;
    if (!e || !s) { mostrarErro('Preencha e-mail e senha.'); return; }

    ocupado(botao, true, entrando ? 'Entrando...' : 'Criando...');
    try {
      if (entrando) await entrar(e, s);
      else {
        const r = await cadastrar(e, s);
        if (!r?.session) {
          // Projeto com confirmação de e-mail ligada: não há sessão ainda.
          renderAuth('entrar', 'Conta criada. Confirme o e-mail e entre.');
          return;
        }
      }
      await iniciarApp();
    } catch (err) {
      ocupado(botao, false, entrando ? 'Entrar' : 'Criar conta');
      mostrarErro(traduzirErro(err.message));
    }
  };

  botao.addEventListener('click', enviar);
  for (const el of [email, senha]) {
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') enviar(); });
  }
  email.focus();
}

// ───────────────────────────────────────────────────────────
// TELA 2 — Ligar a conta ao cadastro
// ───────────────────────────────────────────────────────────
function renderVincular(codigo = '', erro = '') {
  app().innerHTML = `
    <div class="eq-auth">
      <div class="eq-marca">
        <div class="eq-marca-selo" aria-hidden="true">E</div>
        <div class="eq-marca-nome">Quase lá</div>
        <div class="eq-marca-sub">Informe o código do seu cadastro</div>
      </div>

      <div class="eq-cartao">
        <label class="eq-campo">
          <span>Código</span>
          <input type="text" id="eqCodigo" class="eq-codigo" maxlength="6"
                 autocomplete="off" autocapitalize="characters" spellcheck="false"
                 placeholder="ABC123" value="${esc(codigo)}">
        </label>

        <div class="eq-erro" id="eqErro">${esc(erro)}</div>

        <button class="eq-btn" id="eqOk">Ligar minha conta</button>

        <p class="eq-nota">
          São 6 caracteres, sem os que se confundem: não existe zero, letra O,
          número 1, letra I nem L. Peça o seu a quem cuida da folha.
        </p>

        <button class="eq-link" id="eqSair">Sair desta conta</button>
      </div>
    </div>`;

  const campo = document.getElementById('eqCodigo');
  const botao = document.getElementById('eqOk');

  const enviar = async () => {
    const cod = campo.value.trim().toUpperCase();
    if (cod.length < 4) { mostrarErro('Digite o código completo.'); return; }

    ocupado(botao, true, 'Ligando...');
    try {
      await vincularPorCodigo(cod);
      limparCodigoDaUrl();
      await iniciarApp();
    } catch (e) {
      ocupado(botao, false, 'Ligar minha conta');
      mostrarErro(traduzirErro(e.message));
    }
  };

  botao.addEventListener('click', enviar);
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  campo.addEventListener('input', () => { campo.value = campo.value.toUpperCase(); });
  document.getElementById('eqSair').addEventListener('click', async () => {
    await sair();
    renderAuth();
  });
  campo.focus();
}

/** Acesso bloqueado pelo gestor: diz isso, em vez de mostrar tela vazia. */
function renderBloqueado() {
  app().innerHTML = `
    <div class="eq-auth">
      <div class="eq-cartao">
        <div class="eq-vazio">
          <i data-lucide="lock"></i>
          <div class="eq-vazio-t">Acesso bloqueado</div>
          <div class="eq-vazio-s">
            Seu acesso a esta área está suspenso no momento.
            Fale com quem cuida da folha na ${esc(_eu?.unidade || 'academia')}.
          </div>
        </div>
        <button class="eq-link" id="eqSair">Sair desta conta</button>
      </div>
    </div>`;
  document.getElementById('eqSair').addEventListener('click', async () => {
    await sair();
    _eu = null;
    renderAuth();
  });
}

// ───────────────────────────────────────────────────────────
// TELA 3 — Meus pagamentos
// ───────────────────────────────────────────────────────────
async function abrirPagamentos() {
  renderCarregando('Buscando seus pagamentos...');
  try {
    _pagamentos = await meusPagamentos(_eu.id);
  } catch (e) {
    renderErro(traduzirErro(e.message));
    return;
  }

  // Documentos não travam a tela: sem o repositório instalado, os pagamentos
  // continuam aparecendo e o atalho fica sem contador.
  try {
    _documentos = await meusDocumentos(_eu.id);
    _novos = _documentos.filter(d => !d.visualizado_pelo_colaborador).length;
  } catch (e) {
    _documentos = [];
    _novos = 0;
  }

  renderPagamentos();
}

function renderPagamentos() {
  const ultimo = _pagamentos[0];

  app().innerHTML = `
    <header class="eq-topo">
      <div class="eq-avatar">${esc(iniciaisDoNome(_eu.nome))}</div>
      <div class="eq-topo-txt">
        <div class="eq-topo-nome">${esc(_eu.nome)}</div>
        <div class="eq-topo-sub">${esc([_eu.cargo, _eu.unidade].filter(Boolean).join(' · ') || 'Colaborador')}</div>
      </div>
      <button class="eq-sair" id="eqSair" aria-label="Sair"><i data-lucide="log-out"></i></button>
    </header>

    <main class="eq-corpo">
      ${avisoNovosHtml()}

      ${ultimo ? `
        <section class="eq-destaque">
          <div class="eq-destaque-rot">Último pagamento</div>
          <div class="eq-destaque-valor">${esc(formatarBRL(totalItem(ultimo)))}</div>
          <div class="eq-destaque-sub">
            ${esc(nomeCompetencia(ultimo.folha?.competencia))}
            ${ultimo.folha?.data_pagamento ? ` · pago em ${esc(formatarData(ultimo.folha.data_pagamento))}` : ''}
          </div>
        </section>` : ''}

      <button class="eq-atalho" id="eqDocs">
        <i data-lucide="folder"></i>
        <div><strong>Meus documentos</strong><span>Contracheques e folhas de ponto</span></div>
        ${_novos ? `<span class="eq-badge">${_novos}</span>` : ''}
        <i data-lucide="chevron-right"></i>
      </button>

      <div class="eq-secao">Histórico</div>
      ${_pagamentos.length
        ? `<div class="eq-lista">${_pagamentos.map(cartaoHtml).join('')}</div>`
        : `<div class="eq-vazio">
             <i data-lucide="receipt"></i>
             <div class="eq-vazio-t">Nenhum pagamento por aqui ainda</div>
             <div class="eq-vazio-s">Assim que a folha do mês for fechada, ela aparece nesta tela.</div>
           </div>`}
    </main>`;

  document.getElementById('eqSair').addEventListener('click', async () => {
    await sair();
    _eu = null;
    _pagamentos = [];
    renderAuth();
  });

  app().querySelectorAll('[data-eq-mes]').forEach(el =>
    el.addEventListener('click', () => abrirMes(el.dataset.eqMes)));
  document.getElementById('eqDocs')?.addEventListener('click', abrirDocumentos);
  document.getElementById('eqAviso')?.addEventListener('click', abrirDocumentos);
}

// ───────────────────────────────────────────────────────────
// TELA 5 — Meus documentos
// ───────────────────────────────────────────────────────────
// Agrupados por ano e competência: é assim que a pessoa procura ("preciso do
// contracheque de março"), e não por tipo de arquivo.

async function abrirDocumentos() {
  renderCarregando('Buscando seus documentos...');
  try {
    _documentos = await meusDocumentos(_eu.id);
  } catch (e) {
    renderErro(traduzirErro(e.message));
    return;
  }
  renderDocumentos();
}

function renderDocumentos() {
  const porAno = new Map();
  for (const d of _documentos) {
    const ano = String(d.competencia).slice(0, 4);
    if (!porAno.has(ano)) porAno.set(ano, new Map());
    const meses = porAno.get(ano);
    if (!meses.has(d.competencia)) meses.set(d.competencia, []);
    meses.get(d.competencia).push(d);
  }

  app().innerHTML = `
    <header class="eq-topo">
      <button class="eq-voltar" id="eqVoltar" aria-label="Voltar"><i data-lucide="arrow-left"></i></button>
      <div class="eq-topo-txt">
        <div class="eq-topo-nome">Meus documentos</div>
        <div class="eq-topo-sub">${_documentos.length} ${_documentos.length === 1 ? 'documento' : 'documentos'}</div>
      </div>
    </header>

    <main class="eq-corpo">
      ${_documentos.length
        ? [...porAno.entries()].map(([ano, meses]) => `
            <div class="eq-secao">${ano}</div>
            ${[...meses.entries()].map(([comp, lista]) => `
              <div class="eq-mes-grupo">
                <div class="eq-mes-rot">${esc(nomeCompetencia(comp))}</div>
                <div class="eq-docs">${lista.map(docHtml).join('')}</div>
              </div>`).join('')}`).join('')
        : `<div class="eq-vazio">
             <i data-lucide="folder"></i>
             <div class="eq-vazio-t">Você ainda não possui documentos disponíveis.</div>
             <div class="eq-vazio-s">Seus contracheques e folhas de ponto aparecerão aqui quando forem disponibilizados.</div>
           </div>`}
    </main>`;

  document.getElementById('eqVoltar').addEventListener('click', renderPagamentos);
  app().querySelectorAll('[data-eq-doc-id]').forEach(b =>
    b.addEventListener('click', () => abrirDocumento(b.dataset.eqDocId, b, renderDocumentos)));
}

function docHtml(d) {
  const tipo = TIPOS_DOC[d.tipo_documento] || { rotulo: 'Documento', icone: 'file' };
  const html = String(d.mime_type || '').includes('html');

  return `
    <button class="eq-doc" data-eq-doc-id="${d.id}">
      <i data-lucide="${tipo.icone}"></i>
      <div>
        <strong>${esc(d.titulo || tipo.rotulo)}${d.versao > 1 ? ` · v${d.versao}` : ''}</strong>
        <span>
          ${d.disponibilizado_em ? `Disponível desde ${esc(formatarData(d.disponibilizado_em))}` : 'Disponível'}
          ${html ? ' · imprimir ou salvar em PDF' : ''}
        </span>
      </div>
      ${d.visualizado_pelo_colaborador ? '' : '<span class="eq-novo">Novo</span>'}
      <i data-lucide="external-link"></i>
    </button>`;
}

/**
 * Abre o documento e marca como visto.
 *
 * A marcação vem DEPOIS de a URL sair: marcar antes registraria leitura de um
 * documento que talvez nem tenha aberto.
 */
async function abrirDocumento(id, botao, aoAtualizar = null) {
  const doc = _documentos.find(d => d.id === id);
  if (!doc) return;

  const original = botao.innerHTML;
  botao.disabled = true;
  try {
    const { urlAssinada, marcarVisualizado } = await import('./documentos.js');
    const url = await urlAssinada(doc.caminho_storage);
    if (!url) { mostrarErro('Documento indisponível no momento.'); return; }

    window.open(url, '_blank', 'noopener');

    if (!doc.visualizado_pelo_colaborador) {
      try {
        await marcarVisualizado(id);
        doc.visualizado_pelo_colaborador = true;
        _novos = Math.max(0, _novos - 1);
        // Só redesenha quem pediu. Chamado da tela do mês, redesenhar a lista
        // de documentos tiraria a pessoa de onde ela estava.
        aoAtualizar?.();
      } catch (e) { /* abrir importa mais que marcar */ }
    }
  } catch (e) {
    mostrarErro(traduzirErro(e.message));
  } finally {
    botao.disabled = false;
    botao.innerHTML = original;
  }
}

/**
 * Aviso do que chegou e ainda não foi aberto.
 *
 * Nomeia o documento e o mês — "você tem 2 documentos novos" obriga a pessoa a
 * ir procurar o que mudou. O aviso é o próprio botão: clicar leva ao documento,
 * não a uma lista onde ela procura de novo.
 */
function avisoNovosHtml() {
  const novos = _documentos.filter(d => !d.visualizado_pelo_colaborador);
  if (!novos.length) return '';

  const primeiro = novos[0];
  const tipo = TIPOS_DOC[primeiro.tipo_documento] || TIPOS_DOC.personalizado;
  const texto = novos.length === 1
    ? `Seu ${tipo.rotulo.toLowerCase()} de ${nomeCompetencia(primeiro.competencia).toLowerCase()} está disponível.`
    : `Você tem ${novos.length} documentos novos, a partir de ${nomeCompetencia(primeiro.competencia).toLowerCase()}.`;

  return `
    <button class="eq-aviso" id="eqAviso">
      <i data-lucide="bell"></i>
      <span>${esc(texto)}</span>
      <i data-lucide="chevron-right"></i>
    </button>`;
}

function cartaoHtml(p) {
  const horas = p.modo === 'horas' && p.minutos ? `${textoDeMinutos(p.minutos)} h` : 'Mensalista';
  const extras = (p.adicionais || []).length;

  return `
    <button class="eq-cartao-mes" data-eq-mes="${p.id}">
      <div class="eq-mes-txt">
        <div class="eq-mes-nome">${esc(nomeCompetencia(p.folha?.competencia))}</div>
        <div class="eq-mes-sub">
          ${esc(horas)}${extras ? ` · ${extras} ${extras === 1 ? 'adicional' : 'adicionais'}` : ''}
        </div>
      </div>
      <div class="eq-mes-valor">${esc(formatarBRL(totalItem(p)))}</div>
      <i data-lucide="chevron-right"></i>
    </button>`;
}

// ───────────────────────────────────────────────────────────
// TELA 4 — O mês por dentro
// ───────────────────────────────────────────────────────────
function abrirMes(itemId) {
  const p = _pagamentos.find(x => x.id === itemId);
  if (!p) return;

  const linhas = [];
  if (p.modo === 'fixo') {
    linhas.push({ desc: 'Valor mensal', ref: '', valor: Number(p.valor_base) || 0 });
  } else {
    linhas.push({
      desc: 'Horas trabalhadas',
      ref: p.minutos ? `${textoDeMinutos(p.minutos)} h` : '',
      valor: Number(p.valor_base) || 0,
    });
  }
  for (const a of p.adicionais || []) {
    linhas.push({ desc: a.descricao || 'Adicional', ref: '', valor: Number(a.valor) || 0 });
  }

  const periodo = p.ponto_inicio && p.ponto_fim
    ? `${formatarData(p.ponto_inicio)} a ${formatarData(p.ponto_fim)}`
    : null;

  app().innerHTML = `
    <header class="eq-topo">
      <button class="eq-voltar" id="eqVoltar" aria-label="Voltar"><i data-lucide="arrow-left"></i></button>
      <div class="eq-topo-txt">
        <div class="eq-topo-nome">${esc(nomeCompetencia(p.folha?.competencia))}</div>
        <div class="eq-topo-sub">
          ${p.folha?.data_pagamento ? `Pago em ${esc(formatarData(p.folha.data_pagamento))}` : 'Pagamento registrado'}
        </div>
      </div>
    </header>

    <main class="eq-corpo">
      <section class="eq-destaque">
        <div class="eq-destaque-rot">Valor líquido</div>
        <div class="eq-destaque-valor">${esc(formatarBRL(totalItem(p)))}</div>
        ${periodo ? `<div class="eq-destaque-sub">Ponto apurado de ${esc(periodo)}</div>` : ''}
      </section>

      <div class="eq-secao">Composição</div>
      <div class="eq-linhas">
        ${linhas.map(l => `
          <div class="eq-linha${l.valor < 0 ? ' eq-linha-neg' : ''}">
            <div class="eq-linha-txt">
              <div class="eq-linha-desc">${esc(l.desc)}</div>
              ${l.ref ? `<div class="eq-linha-ref">${esc(l.ref)}</div>` : ''}
            </div>
            <div class="eq-linha-valor">${esc(formatarBRL(l.valor))}</div>
          </div>`).join('')}
      </div>

      <div class="eq-secao">Documentos</div>
      <div class="eq-docs">
        ${docDoMes(p, 'contracheque', 'Não emitido para este mês')}
        ${docDoMes(p, 'folha_ponto', 'Não anexada para este mês', periodo)}
      </div>

      ${p.ponto_noturnas
        ? `<p class="eq-obs">Este mês teve ${esc(textoDeMinutos(p.ponto_noturnas))} de horas noturnas registradas no ponto.</p>`
        : ''}
      ${p.observacoes ? `<p class="eq-obs">${esc(p.observacoes)}</p>` : ''}
    </main>`;

  document.getElementById('eqVoltar').addEventListener('click', renderPagamentos);
  app().querySelectorAll('[data-eq-doc-id]').forEach(b =>
    b.addEventListener('click', () => abrirDocumento(b.dataset.eqDocId, b)));
}

/**
 * O cartão do documento daquele mês. Vem do repositório, não da linha da
 * folha: o ponteiro do arquivo deixou de morar em folha_itens.
 *
 * Documento que não existe aparece APAGADO, não some — sumir faz o
 * colaborador achar que o app escondeu algo dele.
 */
function docDoMes(pagamento, tipo, textoAusente, detalhe = '') {
  const t = TIPOS_DOC[tipo];
  const doc = _documentos.find(d =>
    d.tipo_documento === tipo && d.competencia === pagamento.folha?.competencia);

  if (!doc) {
    return `<div class="eq-doc eq-doc-off">
              <i data-lucide="${t.icone}"></i>
              <div><strong>${t.rotulo}</strong><span>${esc(textoAusente)}</span></div>
            </div>`;
  }

  const html = String(doc.mime_type || '').includes('html');
  const sub = detalhe || (html ? 'Imprimir ou salvar em PDF' : 'Abrir documento');
  return `<button class="eq-doc" data-eq-doc-id="${doc.id}">
            <i data-lucide="${t.icone}"></i>
            <div><strong>${t.rotulo}</strong><span>${esc(sub)}</span></div>
            ${doc.visualizado_pelo_colaborador ? '' : '<span class="eq-novo">Novo</span>'}
            <i data-lucide="external-link"></i>
          </button>`;
}

// ───────────────────────────────────────────────────────────
// COMUNS
// ───────────────────────────────────────────────────────────
function renderCarregando(texto) {
  app().innerHTML = `<div class="eq-boot"><span class="eq-spin"></span><div>${esc(texto)}</div></div>`;
}

function renderErro(texto) {
  app().innerHTML = `
    <div class="eq-auth">
      <div class="eq-cartao">
        <div class="eq-vazio">
          <i data-lucide="triangle-alert"></i>
          <div class="eq-vazio-t">Não consegui abrir</div>
          <div class="eq-vazio-s">${esc(texto)}</div>
        </div>
        <button class="eq-btn" onclick="location.reload()">Tentar de novo</button>
      </div>
    </div>`;
}

/** Erro no lugar onde o olho já está, não num canto da tela. */
function mostrarErro(texto) {
  const alvo = document.getElementById('eqErro');
  if (alvo) { alvo.textContent = texto; return; }

  const toast = document.createElement('div');
  toast.className = 'eq-toast';
  toast.textContent = texto;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function ocupado(botao, sim, texto) {
  botao.disabled = sim;
  botao.textContent = texto;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
