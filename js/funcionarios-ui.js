// ═══════════════════════════════════════════════════════════
// EQUIPE · FUNCIONÁRIOS — UI (CRUD da tabela funcionarios)
// ═══════════════════════════════════════════════════════════
// Autocontido: monta a lista e o formulário dentro do container que recebe.
// O cabeçalho e as abas de Equipe são de equipe-admin-ui.js — esta seção não
// sabe que está dentro de uma aba.
//
// O cadastro carrega também o que a FOLHA precisa: valor/hora, salário fixo e
// chave Pix. São o padrão de cada pessoa; a folha do mês grava o valor que usou
// de fato, então reajuste aqui não reescreve pagamento antigo.

import {
  CARGOS, CONSELHOS, SEXOS, UFS,
  listarFuncionarios, criarFuncionario, atualizarFuncionario,
  definirAtivo, excluirFuncionario,
  formatarCPF, formatarTelefone, formatarCEP, soDigitos,
  validarFuncionario, traduzirErroFuncionario,
} from './funcionarios.js';
import {
  mostrarToast, mostrarErro, confirmar, gerarLinkWhatsapp, iniciaisDoNome,
  formatarBRL, valorDeTexto, copiarParaClipboard,
} from './utils.js';
import { QUESTIONARIO_URL } from './supabase.js';

let _lista = [];
let _termo = '';
let _incluirInativos = false;
let _editandoId = null;      // id em edição, ou null = novo
let _carregando = false;
let _container = 'page-equipe';

const UNIDADE_PADRAO = 'Go Up';

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ───────────────────────────────────────────────────────────
// ENTRADA
// ───────────────────────────────────────────────────────────
export async function initFuncionariosUI(containerId = 'page-equipe') {
  _termo = '';
  _incluirInativos = false;
  _editandoId = null;
  _lista = [];
  _container = containerId;

  const page = document.getElementById(containerId);
  if (!page) return;

  page.innerHTML = `
    <div class="list-header">
      <div class="list-title">Sua <em>equipe</em> <span class="fn-contagem" id="fnContagem"></span></div>
      <div class="fn-ferramentas">
        <div class="fn-filtros" role="group" aria-label="Filtrar por situação">
          <button class="fn-chip on" data-fn-filtro="ativos">Ativos</button>
          <button class="fn-chip" data-fn-filtro="todos">Todos</button>
        </div>
        <div class="search-box"><i data-lucide="search"></i> <input type="text" id="fnBusca" placeholder="Buscar por nome, cargo ou CPF..." /></div>
        <button class="btn primary" id="fnNovo"><i data-lucide="user-plus"></i> Novo funcionário</button>
      </div>
    </div>

    <div id="fnFormWrap"></div>
    <div id="fnLista"><div class="loading"><div class="spinner"></div>Carregando funcionários...</div></div>

    <datalist id="fnDlCargos">${CARGOS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="fnDlConselhos">${CONSELHOS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="fnDlUfs">${UFS.map(u => `<option value="${u}">`).join('')}</datalist>
  `;

  document.getElementById('fnNovo').addEventListener('click', () => abrirForm(null));

  const buscar = debounce(() => {
    _termo = document.getElementById('fnBusca').value.trim();
    carregar();
  }, 300);
  document.getElementById('fnBusca').addEventListener('input', buscar);

  page.querySelectorAll('[data-fn-filtro]').forEach(b => b.addEventListener('click', () => {
    _incluirInativos = b.dataset.fnFiltro === 'todos';
    page.querySelectorAll('[data-fn-filtro]').forEach(o => o.classList.toggle('on', o === b));
    carregar();
  }));

  await carregar();
}

// ───────────────────────────────────────────────────────────
// LISTA
// ───────────────────────────────────────────────────────────
async function carregar() {
  if (_carregando) return;
  _carregando = true;
  const cont = document.getElementById('fnLista');
  try {
    _lista = await listarFuncionarios({ termo: _termo, incluirInativos: _incluirInativos });
    renderLista();
  } catch (e) {
    if (cont) {
      cont.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="triangle-alert"></i></div>
        ${esc(traduzirErroFuncionario(e.message))}</div>`;
    }
  } finally {
    _carregando = false;
  }
}

function renderLista() {
  const cont = document.getElementById('fnLista');
  if (!cont) return;

  const contagem = document.getElementById('fnContagem');
  if (contagem) contagem.textContent = _lista.length ? `(${_lista.length})` : '';

  if (!_lista.length) {
    cont.innerHTML = _termo
      ? `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="search-x"></i></div>
          Nenhum funcionário encontrado para "<strong>${esc(_termo)}</strong>".</div>`
      : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="user-plus"></i></div>
          Nenhum funcionário cadastrado ainda. Clique em <strong>Novo funcionário</strong> para começar.</div>`;
    return;
  }

  cont.innerHTML = `<div class="patients-grid">${_lista.map(linhaFuncionarioHtml).join('')}</div>`;

  cont.querySelectorAll('[data-fn-edit]').forEach(b =>
    b.addEventListener('click', () => abrirForm(_lista.find(f => f.id === b.dataset.fnEdit))));
  cont.querySelectorAll('[data-fn-toggle]').forEach(b =>
    b.addEventListener('click', () => alternarAtivo(b.dataset.fnToggle)));
  cont.querySelectorAll('[data-fn-del]').forEach(b =>
    b.addEventListener('click', () => remover(b.dataset.fnDel)));
  cont.querySelectorAll('[data-fn-convidar]').forEach(b =>
    b.addEventListener('click', () => copiarConvite(b.dataset.fnConvidar)));
  cont.querySelectorAll('[data-fn-docs]').forEach(b =>
    b.addEventListener('click', () => abrirDocumentos(b.dataset.fnDocs)));
}

/**
 * A linha de um funcionário na lista.
 *
 * Exportada para o teste conseguir EXECUTAR — não só ler o arquivo. Uma
 * variável usada antes da declaração passa por qualquer inspeção de texto e só
 * aparece quando a tela tenta desenhar, em branco, com o erro no console.
 */
export function linhaFuncionarioHtml(f) {
  const cargo = [f.cargo, f.unidade].filter(Boolean).join(' · ') || 'Sem cargo definido';
  const doc = f.cpf ? `CPF ${formatarCPF(f.cpf)}` : '';
  const conselho = [f.conselho_tipo, f.conselho_numero].filter(Boolean).join(' ');
  const pagamento = [
    f.salario_fixo ? `${formatarBRL(f.salario_fixo)}/mês` : '',
    f.valor_hora ? `${formatarBRL(f.valor_hora)}/h` : '',
    f.chave_pix ? `Pix ${f.chave_pix}` : '',
  ].filter(Boolean).join(' · ');
  const contato = [
    f.telefone ? formatarTelefone(f.telefone) : '',
    f.email || '',
    pagamento,
  ].filter(Boolean).join(' · ');

  const appLigado = f.auth_user_id
    ? '<span class="fn-selo fn-selo-app"><i data-lucide="smartphone"></i> No app</span>'
    : '';

  // App do colaborador: quem já ligou a conta ganha selo; quem não ligou ganha
  // o botão de convite. O código some depois de usado — deixá-lo à vista faria
  // reenviar um link morto.
  const convite = f.codigo_acesso && !f.auth_user_id && f.ativo
    ? `<button class="patient-action" data-fn-convidar="${f.id}" title="Copiar convite do app">
         <i data-lucide="link"></i> ${esc(f.codigo_acesso)}</button>`
    : '';

  const selos = [
    f.ativo ? '' : '<span class="fn-selo fn-selo-off">Desligado</span>',
    f.acesso_bloqueado ? '<span class="fn-selo fn-selo-bloq">Acesso bloqueado</span>' : '',
    appLigado,
  ].join('');

  const zap = f.telefone
    ? `<a class="patient-action" href="${esc(gerarLinkWhatsapp('', f.telefone))}" target="_blank" rel="noopener" title="WhatsApp"><i data-lucide="message-circle"></i></a>`
    : '';

  return `
    <div class="patient-row fn-row${f.ativo ? '' : ' fn-row-off'}">
      <div class="patient-avatar">${esc(iniciaisDoNome(f.nome))}</div>
      <div class="patient-info">
        <div class="patient-name">${esc(f.nome)}${selos}</div>
        <div class="patient-meta">${esc([cargo, doc, conselho].filter(Boolean).join(' · '))}</div>
        ${contato ? `<div class="patient-meta fn-contato">${esc(contato)}</div>` : ''}
      </div>
      <button class="patient-action" data-fn-docs="${f.id}" title="Documentos deste colaborador">
        <i data-lucide="folder"></i></button>
      ${convite}
      ${zap}
      <button class="patient-action primary" data-fn-edit="${f.id}"><i data-lucide="pencil"></i> Editar</button>
      <button class="patient-action" data-fn-toggle="${f.id}" title="${f.ativo ? 'Desligar' : 'Reativar'}">
        <i data-lucide="${f.ativo ? 'user-minus' : 'user-check'}"></i></button>
      <button class="patient-action patient-action-danger" data-fn-del="${f.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
    </div>`;
}

/** Histórico de documentos da pessoa, no lugar da lista. */
async function abrirDocumentos(id) {
  const f = _lista.find(x => x.id === id);
  if (!f) return;
  const { abrirDocumentosDoColaborador } = await import('./documentos-ui.js');
  await abrirDocumentosDoColaborador({
    container: _container,
    colaborador: f,
    aoVoltar: () => initFuncionariosUI(_container),
  });
}

/**
 * Convite para o app do colaborador: link com o código embutido, para ele
 * abrir, criar a conta e já cair vinculado.
 *
 * Copia a mensagem inteira, não só o código. Um código solto obriga a pessoa
 * a descobrir sozinha onde digitá-lo — e é aí que o convite morre.
 */
function copiarConvite(id) {
  const f = _lista.find(x => x.id === id);
  if (!f?.codigo_acesso) return;

  const link = `${QUESTIONARIO_URL}equipe.html?codigo=${encodeURIComponent(f.codigo_acesso)}`;
  const primeiro = (f.nome || '').split(' ')[0];

  // O e-mail vai no texto quando existe: criar a conta com ele dispensa o
  // código, e o convite fica sendo uma instrução só.
  const comEmail = f.email
    ? `Crie sua conta com este e-mail: ${f.email}\n\n`
    : '';

  const mensagem = `Oi ${primeiro}! Seus contracheques e folhas de ponto agora ficam aqui:\n\n${link}\n\n`
    + comEmail
    + `Se em algum momento pedirem um código, o seu é ${f.codigo_acesso}.`;

  copiarParaClipboard(mensagem, '✓ Convite copiado');
}

// ───────────────────────────────────────────────────────────
// FORMULÁRIO (novo / editar) — inline, no topo da lista
// ───────────────────────────────────────────────────────────
function abrirForm(f) {
  _editandoId = f ? f.id : null;
  const wrap = document.getElementById('fnFormWrap');

  wrap.innerHTML = `
    <div class="av-form-card fn-form">
      <div class="av-form-title">${f ? 'Editar' : 'Novo'} funcionário</div>

      <div class="av-section">Dados principais</div>
      <div class="av-grid">
        ${campo({ id: 'fnNome', rotulo: 'Nome *', valor: f?.nome, largo: true, dica: 'Nome completo, como no documento' })}
        ${campo({ id: 'fnCpf', rotulo: 'CPF', valor: f?.cpf ? formatarCPF(f.cpf) : '', placeholder: '000.000.000-00', modo: 'numeric' })}
        ${campo({ id: 'fnDocumento', rotulo: 'Documento', valor: f?.documento, placeholder: 'RG ou matrícula' })}
        ${campo({ id: 'fnNascimento', rotulo: 'Data de nascimento', valor: f?.data_nascimento, tipo: 'date' })}
        <div class="av-field">
          <label for="fnSexo">Sexo</label>
          <select id="fnSexo" class="np-input">
            <option value="">—</option>
            ${Object.entries(SEXOS).map(([v, r]) =>
              `<option value="${v}"${f?.sexo === v ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        ${campo({ id: 'fnEmail', rotulo: 'E-mail', valor: f?.email, tipo: 'email', placeholder: 'nome@email.com' })}
        ${campo({ id: 'fnTelefone', rotulo: 'Telefone', valor: f?.telefone ? formatarTelefone(f.telefone) : '', placeholder: '(27) 99999-9999', modo: 'numeric' })}
        ${campo({ id: 'fnConselhoTipo', rotulo: 'Tipo de conselho', valor: f?.conselho_tipo, lista: 'fnDlConselhos', placeholder: 'CREF' })}
        ${campo({ id: 'fnConselhoNumero', rotulo: 'Registro no conselho', valor: f?.conselho_numero, placeholder: '012406-G/ES' })}
      </div>

      <div class="av-section">Vínculo</div>
      <div class="av-grid">
        ${campo({ id: 'fnCargo', rotulo: 'Cargo', valor: f?.cargo, lista: 'fnDlCargos', placeholder: 'Instrutor' })}
        ${campo({ id: 'fnUnidade', rotulo: 'Unidade', valor: f?.unidade ?? UNIDADE_PADRAO, placeholder: UNIDADE_PADRAO })}
      </div>
      <div class="fn-toggles">
        <label class="fn-check"><input type="checkbox" id="fnAtivo" ${f?.ativo === false ? '' : 'checked'}>
          <span>Funcionário ativo</span></label>
        <label class="fn-check"><input type="checkbox" id="fnBloqueado" ${f?.acesso_bloqueado ? 'checked' : ''}>
          <span>Bloquear acesso no sistema</span></label>
      </div>

      <div class="av-section">Remuneração</div>
      <div class="av-grid">
        ${campo({ id: 'fnValorHora', rotulo: 'Valor da hora', valor: numeroBR(f?.valor_hora), placeholder: '17,00', modo: 'decimal',
                  dica: 'Padrão desta pessoa. A folha do mês guarda o valor que usou.' })}
        ${campo({ id: 'fnSalarioFixo', rotulo: 'Salário fixo (mensalista)', valor: numeroBR(f?.salario_fixo), placeholder: '2.000,00', modo: 'decimal',
                  dica: 'Preencha só quem não é pago por hora.' })}
        ${campo({ id: 'fnPix', rotulo: 'Chave Pix', valor: f?.chave_pix, largo: true, placeholder: 'CPF, telefone, e-mail ou chave aleatória' })}
      </div>

      <div class="av-section">Endereço</div>
      <div class="av-grid">
        ${campo({ id: 'fnCep', rotulo: 'CEP', valor: f?.cep ? formatarCEP(f.cep) : '', placeholder: '00000-000', modo: 'numeric' })}
        ${campo({ id: 'fnLogradouro', rotulo: 'Logradouro', valor: f?.logradouro, largo: true })}
        ${campo({ id: 'fnNumero', rotulo: 'Número', valor: f?.numero })}
        ${campo({ id: 'fnComplemento', rotulo: 'Complemento', valor: f?.complemento })}
        ${campo({ id: 'fnBairro', rotulo: 'Bairro', valor: f?.bairro })}
        ${campo({ id: 'fnCidade', rotulo: 'Cidade', valor: f?.cidade })}
        ${campo({ id: 'fnUf', rotulo: 'UF', valor: f?.uf, lista: 'fnDlUfs', placeholder: 'ES' })}
      </div>

      <div class="av-field" style="margin-top:16px;">
        <label for="fnObs">Observações</label>
        <textarea id="fnObs" class="np-input" rows="3" style="resize:vertical"
          placeholder="Horário, particularidades do contrato, anotações internas...">${esc(f?.observacoes || '')}</textarea>
      </div>

      <div class="av-actions">
        <button class="btn" id="fnCancelar">Cancelar</button>
        <button class="btn primary" id="fnSalvar"><i data-lucide="save"></i> ${f ? 'Atualizar' : 'Cadastrar funcionário'}</button>
      </div>
    </div>
  `;

  document.getElementById('fnCancelar').addEventListener('click', fecharForm);
  document.getElementById('fnSalvar').addEventListener('click', salvar);

  mascarar('fnCpf', formatarCPF, 11);
  mascarar('fnTelefone', formatarTelefone, 11);
  mascarar('fnCep', formatarCEP, 8);
  document.getElementById('fnCep').addEventListener('blur', preencherPeloCep);

  document.getElementById('fnNome').focus();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fecharForm() {
  _editandoId = null;
  const wrap = document.getElementById('fnFormWrap');
  if (wrap) wrap.innerHTML = '';
}

/** Um campo de texto do formulário. `largo` ocupa a linha inteira do grid. */
function campo({ id, rotulo, valor, tipo = 'text', placeholder = '', lista = '', dica = '', largo = false, modo = '' }) {
  return `
    <div class="av-field${largo ? ' fn-largo' : ''}">
      <label for="${id}">${esc(rotulo)}</label>
      <input type="${tipo}" id="${id}" class="np-input" value="${esc(valor ?? '')}"
        ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}
        ${lista ? `list="${lista}"` : ''}
        ${modo ? `inputmode="${modo}"` : ''}>
      ${dica ? `<div class="fn-dica">${esc(dica)}</div>` : ''}
    </div>`;
}

/**
 * Máscara ao digitar. Só formata quando o campo já tem os dígitos todos —
 * formatar no meio da digitação empurra o cursor e atrapalha mais do que ajuda.
 */
function mascarar(id, formatador, digitos) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const d = soDigitos(el.value).slice(0, digitos);
    if (d.length === digitos) el.value = formatador(d);
  });
  // No blur formata o que houver: telefone fixo tem 10 dígitos e nunca
  // chegaria ao limite acima.
  el.addEventListener('blur', () => {
    const d = soDigitos(el.value).slice(0, digitos);
    if (d) el.value = formatador(d);
  });
}

/** Completa o endereço pelo CEP (ViaCEP). Falha em silêncio: é conveniência. */
async function preencherPeloCep() {
  const cep = soDigitos(document.getElementById('fnCep')?.value);
  if (cep.length !== 8) return;

  const vazio = (id) => {
    const el = document.getElementById(id);
    return el && !el.value.trim() ? el : null;
  };
  if (!vazio('fnLogradouro') && !vazio('fnBairro') && !vazio('fnCidade')) return;

  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = await r.json();
    if (d.erro) return;
    const por = (id, v) => { const el = vazio(id); if (el && v) el.value = v; };
    por('fnLogradouro', d.logradouro);
    por('fnBairro', d.bairro);
    por('fnCidade', d.localidade);
    por('fnUf', d.uf);
  } catch (e) {
    /* sem internet ou serviço fora: o usuário digita à mão */
  }
}

function lerForm() {
  const t = (id) => (document.getElementById(id)?.value || '').trim();
  const c = (id) => !!document.getElementById(id)?.checked;
  return {
    nome:             t('fnNome'),
    cpf:              t('fnCpf'),
    documento:        t('fnDocumento'),
    data_nascimento:  t('fnNascimento'),
    sexo:             t('fnSexo'),
    email:            t('fnEmail'),
    telefone:         t('fnTelefone'),
    conselho_tipo:    t('fnConselhoTipo'),
    conselho_numero:  t('fnConselhoNumero'),
    cargo:            t('fnCargo'),
    unidade:          t('fnUnidade'),
    cep:              t('fnCep'),
    logradouro:       t('fnLogradouro'),
    numero:           t('fnNumero'),
    complemento:      t('fnComplemento'),
    bairro:           t('fnBairro'),
    cidade:           t('fnCidade'),
    uf:               t('fnUf'),
    observacoes:      t('fnObs'),
    ativo:            c('fnAtivo'),
    acesso_bloqueado: c('fnBloqueado'),
    valor_hora:       valorDeTexto(t('fnValorHora')),
    salario_fixo:     valorDeTexto(t('fnSalarioFixo')),
    chave_pix:        t('fnPix'),
  };
}

/** 17 → "17,00" para caber no campo, sem o "R$" atrapalhando a digitação. */
function numeroBR(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

async function salvar() {
  const dados = lerForm();

  // Dinheiro ilegível NÃO pode virar campo vazio: apagaria o valor que já
  // estava lá sem dizer nada, e o erro só apareceria na próxima folha. Como a
  // conversão já perdeu o texto original, a conferência é feita aqui, onde ele
  // ainda existe.
  for (const [id, rotulo] of [['fnValorHora', 'valor da hora'], ['fnSalarioFixo', 'salário fixo']]) {
    const txt = (document.getElementById(id)?.value || '').trim();
    if (txt && valorDeTexto(txt) === null) {
      mostrarErro(`"${txt}" não é um ${rotulo} válido. Use vírgula, como 17,00.`);
      return;
    }
  }

  const erros = validarFuncionario(dados);
  if (erros.length) { mostrarErro(erros[0]); return; }

  const btn = document.getElementById('fnSalvar');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (_editandoId) await atualizarFuncionario(_editandoId, dados);
    else await criarFuncionario(dados);
    mostrarToast(_editandoId ? '✓ Funcionário atualizado' : '✓ Funcionário cadastrado');
    fecharForm();
    await carregar();
  } catch (e) {
    mostrarErro(traduzirErroFuncionario(e.message));
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function alternarAtivo(id) {
  const f = _lista.find(x => x.id === id);
  if (!f) return;

  if (f.ativo && !(await confirmar({
    titulo: 'Desligar funcionário',
    mensagem: `Marcar "${f.nome}" como desligado?\n\nO cadastro continua guardado — some só da lista de ativos.`,
    textoOk: 'Desligar',
  }))) return;

  try {
    await definirAtivo(id, !f.ativo);
    mostrarToast(f.ativo ? '✓ Funcionário desligado' : '✓ Funcionário reativado');
    await carregar();
  } catch (e) {
    mostrarErro(traduzirErroFuncionario(e.message));
  }
}

async function remover(id) {
  const f = _lista.find(x => x.id === id);
  if (!f) return;

  if (!(await confirmar({
    titulo: 'Excluir funcionário',
    mensagem: `Apagar o cadastro de "${f.nome}" de vez?\n\nSe a pessoa apenas saiu da equipe, prefira desligar — assim o histórico fica.`,
    textoOk: 'Excluir', perigo: true,
  }))) return;

  try {
    await excluirFuncionario(id);
    mostrarToast('✓ Funcionário excluído');
    await carregar();
  } catch (e) {
    const emUso = /foreign key|violates|restrict/i.test(e.message || '');
    mostrarErro(emUso
      ? 'Não dá para excluir: este funcionário já tem lançamentos no financeiro. Desligue em vez de excluir.'
      : traduzirErroFuncionario(e.message));
  }
}

// ───────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
