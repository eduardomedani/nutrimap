// ═══════════════════════════════════════════════════════════
// COMERCIAL — formulários de plano e de assinatura
// ═══════════════════════════════════════════════════════════
// Segue o padrão de drawer que js/financeiro-lancamento-form.js já usa: um
// `<div>` de raiz no body, Escape fecha, e a trava do scroll cai mesmo se o
// desenho falhar — senão o botão fica morto para sempre sem nada na tela
// dizendo por quê.
//
// A validação é PURA e exportada: é ela que os testes exercitam. O drawer só
// desenha o que ela devolve.

// `valorDeTexto` vem do utils e não de uma cópia local: ela já resolve o caso
// de "2.000" ser milhar e não decimal — ler como 2,00 cobraria dois reais no
// lugar de dois mil.
import { fimDoPeriodo } from './comercial.js';
import { valorDeTexto as moedaParaNumero } from './utils.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 330 -> "330,00". `String(330).replace('.', ',')` devolve "330": o ponto que
 *  ele procura não existe em número inteiro, e o campo abre sem centavos. */
function paraCampoValor(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '';
}

// ───────────────────────────────────────────────────────────
// PLANO — validação e conversão
// ───────────────────────────────────────────────────────────

export function planoVazio() {
  return {
    nome: '', descricao: '', frequencia_semanal: '',
    duracao_valor: '30', duracao_unidade: 'dia',
    preco_padrao: '', tolerancia_dias: '5', ativo: true,
  };
}

export function planoDoBanco(p) {
  return {
    nome: p.nome || '',
    descricao: p.descricao || '',
    frequencia_semanal: p.frequencia_semanal ?? '',
    duracao_valor: String(p.duracao_valor ?? 30),
    duracao_unidade: p.duracao_unidade || 'dia',
    preco_padrao: paraCampoValor(p.preco_padrao),
    tolerancia_dias: String(p.tolerancia_dias ?? 5),
    ativo: p.ativo !== false,
  };
}

export function validarPlano(form = {}) {
  const erros = {};
  if (!String(form.nome || '').trim()) erros.nome = 'Dê um nome ao plano.';

  const dur = Number(form.duracao_valor);
  if (!Number.isInteger(dur) || dur <= 0) erros.duracao_valor = 'A duração precisa ser um número inteiro maior que zero.';

  if (!['dia', 'mes'].includes(form.duracao_unidade)) erros.duracao_unidade = 'Escolha dias ou meses.';

  const tol = Number(form.tolerancia_dias);
  if (!Number.isInteger(tol) || tol < 0) erros.tolerancia_dias = 'A tolerância precisa ser zero ou mais.';

  if (String(form.preco_padrao || '').trim()) {
    const preco = moedaParaNumero(form.preco_padrao);
    if (preco == null || preco < 0) erros.preco_padrao = 'Valor inválido.';
  }

  if (String(form.frequencia_semanal || '').trim()) {
    const f = Number(form.frequencia_semanal);
    if (!Number.isInteger(f) || f < 1 || f > 7) erros.frequencia_semanal = 'Entre 1 e 7 vezes por semana.';
  }

  return erros;
}

export function planoParaBanco(form = {}) {
  return {
    nome: String(form.nome || '').trim(),
    descricao: String(form.descricao || '').trim() || null,
    frequencia_semanal: String(form.frequencia_semanal || '').trim() ? Number(form.frequencia_semanal) : null,
    duracao_valor: Number(form.duracao_valor),
    duracao_unidade: form.duracao_unidade,
    preco_padrao: String(form.preco_padrao || '').trim() ? moedaParaNumero(form.preco_padrao) : null,
    tolerancia_dias: Number(form.tolerancia_dias),
    ativo: form.ativo !== false,
  };
}

// ───────────────────────────────────────────────────────────
// ASSINATURA — validação e conversão
// ───────────────────────────────────────────────────────────

export function assinaturaVazia() {
  return {
    paciente_id: '', plano_id: '',
    data_inicio_original: hojeISO(), inicio_periodo: hojeISO(),
    valor_contratado: '', horario: '', observacoes: '',
    renovacao_automatica: true, criar_cobranca: true,
  };
}

export function validarAssinatura(form = {}, plano = null) {
  const erros = {};
  if (!form.paciente_id) erros.paciente_id = 'Escolha o cliente.';
  if (!form.plano_id) erros.plano_id = 'Escolha o plano.';
  if (!form.inicio_periodo) erros.inicio_periodo = 'Informe quando o período começa.';

  if (form.plano_id && plano && form.inicio_periodo && !fimDoPeriodo(form.inicio_periodo, plano)) {
    erros.inicio_periodo = 'Não consegui calcular o fim do período com esse plano.';
  }

  if (String(form.valor_contratado || '').trim()) {
    const v = moedaParaNumero(form.valor_contratado);
    if (v == null || v < 0) erros.valor_contratado = 'Valor inválido.';
  }

  // O período vigente não pode começar antes de o cliente existir — é o mesmo
  // CHECK que a tabela tem, e errar aqui daria um erro cru do Postgres.
  if (form.data_inicio_original && form.inicio_periodo &&
      String(form.inicio_periodo) < String(form.data_inicio_original)) {
    erros.inicio_periodo = 'O período atual não pode começar antes da data de início do cliente.';
  }

  return erros;
}

export function assinaturaParaBanco(form = {}, plano = null) {
  const inicio = form.inicio_periodo;
  return {
    paciente_id: form.paciente_id,
    plano_id: form.plano_id,
    // O preço é COPIADO do plano quando o campo fica vazio, e nunca mais muda
    // sozinho: alterar a tabela de preços não pode mexer em contrato feito.
    valor_contratado: String(form.valor_contratado || '').trim()
      ? moedaParaNumero(form.valor_contratado)
      : (plano?.preco_padrao ?? null),
    data_inicio_original: form.data_inicio_original || inicio,
    inicio_periodo: inicio,
    fim_periodo: fimDoPeriodo(inicio, plano),
    horario: String(form.horario || '').trim() || null,
    observacoes: String(form.observacoes || '').trim() || null,
    renovacao_automatica: form.renovacao_automatica !== false,
    status: 'ativa',
  };
}

// ───────────────────────────────────────────────────────────
// MARCAÇÃO
// ───────────────────────────────────────────────────────────

const cls = (erros, campo) => (erros[campo] ? ' cm-erro-campo' : '');
const msg = (erros, campo) => (erros[campo] ? `<div class="cm-erro-msg">${esc(erros[campo])}</div>` : '');

export function formPlanoHtml({ form = {}, erros = {}, edicao = false } = {}) {
  return `
    <div class="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cmFormTit">
      <header class="cm-drawer-topo">
        <h2 id="cmFormTit">${edicao ? 'Editar plano' : 'Novo plano'}</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <div class="cm-campo${cls(erros, 'nome')}">
          <label for="cmpNome">Nome</label>
          <input id="cmpNome" type="text" value="${esc(form.nome)}" placeholder="Mensal - 3x" autocomplete="off">
          ${msg(erros, 'nome')}
        </div>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls(erros, 'duracao_valor')}">
            <label for="cmpDuracao">Duração</label>
            <input id="cmpDuracao" type="number" min="1" step="1" value="${esc(form.duracao_valor)}">
            ${msg(erros, 'duracao_valor')}
          </div>
          <div class="cm-campo${cls(erros, 'duracao_unidade')}">
            <label for="cmpUnidade">Unidade</label>
            <select id="cmpUnidade">
              <option value="dia"${form.duracao_unidade === 'dia' ? ' selected' : ''}>dias corridos</option>
              <option value="mes"${form.duracao_unidade === 'mes' ? ' selected' : ''}>meses calendário</option>
            </select>
            ${msg(erros, 'duracao_unidade')}
          </div>
        </div>
        <p class="cm-ajuda-campo">
          A GoUp trabalha em <b>dias corridos</b>: mensal são 30, trimestral são 90.
          Foi assim em 137 de 137 contratos da planilha.
        </p>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls(erros, 'preco_padrao')}">
            <label for="cmpPreco">Preço padrão</label>
            <input id="cmpPreco" type="text" inputmode="decimal" value="${esc(form.preco_padrao)}" placeholder="330,00">
            ${msg(erros, 'preco_padrao')}
          </div>
          <div class="cm-campo${cls(erros, 'frequencia_semanal')}">
            <label for="cmpFreq">Vezes por semana</label>
            <input id="cmpFreq" type="number" min="1" max="7" step="1" value="${esc(form.frequencia_semanal)}" placeholder="3">
            ${msg(erros, 'frequencia_semanal')}
          </div>
        </div>
        <p class="cm-ajuda-campo">
          Mudar o preço aqui <b>não altera</b> contratos já feitos — cada assinatura
          guarda o valor combinado com aquele cliente.
        </p>

        <div class="cm-campo${cls(erros, 'tolerancia_dias')}">
          <label for="cmpTolerancia">Tolerância de atraso (dias)</label>
          <input id="cmpTolerancia" type="number" min="0" step="1" value="${esc(form.tolerancia_dias)}">
          ${msg(erros, 'tolerancia_dias')}
        </div>
        <p class="cm-ajuda-campo">
          Pagando com até esse atraso, o novo período continua do término anterior.
          Passando disso, começa na data do pagamento.
        </p>

        <div class="cm-campo">
          <label for="cmpDescricao">Descrição</label>
          <textarea id="cmpDescricao" rows="2" placeholder="O que está incluso">${esc(form.descricao)}</textarea>
        </div>

        <label class="cm-check">
          <input id="cmpAtivo" type="checkbox"${form.ativo !== false ? ' checked' : ''}>
          <span>Plano ativo (aparece na hora de contratar)</span>
        </label>
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Cancelar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>
          <i data-lucide="check"></i> ${edicao ? 'Salvar' : 'Criar plano'}
        </button>
      </footer>
    </div>`;
}

export function formAssinaturaHtml({ form = {}, erros = {}, pacientes = [], planos = [], plano = null } = {}) {
  const fim = plano && form.inicio_periodo ? fimDoPeriodo(form.inicio_periodo, plano) : null;
  const fimBR = fim ? fim.split('-').reverse().join('/') : '—';

  return `
    <div class="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cmFormTit">
      <header class="cm-drawer-topo">
        <h2 id="cmFormTit">Nova assinatura</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <div class="cm-campo${cls(erros, 'paciente_id')}">
          <label for="cmaPaciente">Cliente</label>
          <select id="cmaPaciente">
            <option value="">Escolha…</option>
            ${pacientes.map(p => `<option value="${esc(p.id)}"${p.id === form.paciente_id ? ' selected' : ''}>${esc(p.nome || 'Sem nome')}</option>`).join('')}
          </select>
          ${msg(erros, 'paciente_id')}
          ${pacientes.length ? '' : '<div class="cm-erro-msg">Todos os clientes já têm assinatura ativa.</div>'}
        </div>

        <div class="cm-campo${cls(erros, 'plano_id')}">
          <label for="cmaPlano">Plano</label>
          <select id="cmaPlano">
            <option value="">Escolha…</option>
            ${planos.map(p => `<option value="${esc(p.id)}"${p.id === form.plano_id ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}
          </select>
          ${msg(erros, 'plano_id')}
        </div>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls(erros, 'inicio_periodo')}">
            <label for="cmaInicio">Começa em</label>
            <input id="cmaInicio" type="date" value="${esc(form.inicio_periodo)}">
            ${msg(erros, 'inicio_periodo')}
          </div>
          <div class="cm-campo">
            <label>Termina em</label>
            <div class="cm-calculado" data-fim>${esc(fimBR)}</div>
          </div>
        </div>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls(erros, 'valor_contratado')}">
            <label for="cmaValor">Valor contratado</label>
            <input id="cmaValor" type="text" inputmode="decimal" value="${esc(form.valor_contratado)}"
                   placeholder="${plano?.preco_padrao != null ? paraCampoValor(plano.preco_padrao) : '330,00'}">
            ${msg(erros, 'valor_contratado')}
          </div>
          <div class="cm-campo">
            <label for="cmaHorario">Horário</label>
            <input id="cmaHorario" type="text" list="cmaHorarios" value="${esc(form.horario)}" placeholder="Noturno" autocomplete="off">
            <datalist id="cmaHorarios"><option value="Diurno"><option value="Noturno"></datalist>
          </div>
        </div>
        <p class="cm-ajuda-campo">
          Em branco, o valor vem do preço padrão do plano. Preenchido, vale o que
          você digitar — e não muda mais quando o plano mudar de preço.
        </p>

        <div class="cm-campo">
          <label for="cmaDesde">Cliente desde</label>
          <input id="cmaDesde" type="date" value="${esc(form.data_inicio_original)}">
        </div>
        <p class="cm-ajuda-campo">
          Essa data <b>nunca muda</b> nas renovações. É ela que responde "cliente desde".
        </p>

        <div class="cm-campo">
          <label for="cmaObs">Observações comerciais</label>
          <textarea id="cmaObs" rows="2" placeholder="pediu vencimento dia 10; prefere Pix">${esc(form.observacoes)}</textarea>
        </div>
        <p class="cm-ajuda-campo">Separado do prontuário. Nada clínico aqui.</p>

        <label class="cm-check">
          <input id="cmaRenova" type="checkbox"${form.renovacao_automatica !== false ? ' checked' : ''}>
          <span>Gerar a próxima cobrança automaticamente a cada pagamento</span>
        </label>
        <label class="cm-check">
          <input id="cmaCobranca" type="checkbox"${form.criar_cobranca !== false ? ' checked' : ''}>
          <span>Já criar a cobrança deste período</span>
        </label>
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Cancelar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>
          <i data-lucide="check"></i> Criar assinatura
        </button>
      </footer>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// OS DRAWERS
// ───────────────────────────────────────────────────────────

let _aberto = false;

function abrirDrawer(desenhar, aoSalvar) {
  if (_aberto) return null;
  _aberto = true;

  const fundo = document.createElement('div');
  fundo.className = 'cm-drawer-raiz';
  document.body.appendChild(fundo);
  document.body.classList.add('cm-travado');

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('cm-travado');
    fundo.remove();
    _aberto = false;
  };
  function aoTeclado(e) { if (e.key === 'Escape') { e.preventDefault(); fechar(); } }
  document.addEventListener('keydown', aoTeclado);

  fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });

  // Se o desenho falhar, a trava TEM que cair — senão o botão fica morto para
  // sempre e nada na tela diz por quê.
  try {
    desenhar(fundo, fechar);
  } catch (e) {
    fechar();
    console.error('Comercial · formulário:', e);
    alert('Não consegui abrir o formulário: ' + (e?.message || e));
    return null;
  }
  return { fundo, fechar };
}

/** Formulário de plano. `aoSalvar(dadosParaBanco, planoOriginal)` grava. */
export function abrirFormularioPlano({ plano = null, aoSalvar } = {}) {
  const edicao = !!plano;
  let form = plano ? planoDoBanco(plano) : planoVazio();
  let salvando = false;

  return abrirDrawer((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formPlanoHtml({ form, erros, edicao });
      window.renderIcons?.();
      ligar(erros);
      fundo.querySelector('.cm-erro-campo input, .cm-erro-campo select')?.focus();
      if (!Object.keys(erros).length) fundo.querySelector('#cmpNome')?.focus();
    };

    const coletar = () => {
      const g = id => fundo.querySelector('#' + id);
      return {
        nome: g('cmpNome')?.value || '',
        descricao: g('cmpDescricao')?.value || '',
        frequencia_semanal: g('cmpFreq')?.value || '',
        duracao_valor: g('cmpDuracao')?.value || '',
        duracao_unidade: g('cmpUnidade')?.value || 'dia',
        preco_padrao: g('cmpPreco')?.value || '',
        tolerancia_dias: g('cmpTolerancia')?.value || '0',
        ativo: !!g('cmpAtivo')?.checked,
      };
    };

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));
      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const erros = validarPlano(form);
        if (Object.keys(erros).length) { desenhar(erros); return; }
        salvando = true;
        try {
          await aoSalvar(planoParaBanco(form), plano);
          fechar();
        } catch (e) {
          salvando = false;
          console.error('Comercial · salvar plano:', e);
          desenhar({ nome: 'Não consegui salvar: ' + (e?.message || e) });
        }
      });
    }

    desenhar();
  });
}

/** Formulário de assinatura. `aoSalvar(dadosParaBanco, { criarCobranca, plano })`. */
export function abrirFormularioAssinatura({ pacientes = [], planos = [], aoSalvar } = {}) {
  let form = assinaturaVazia();
  let salvando = false;
  const planoDe = id => planos.find(p => p.id === id) || null;

  return abrirDrawer((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formAssinaturaHtml({ form, erros, pacientes, planos, plano: planoDe(form.plano_id) });
      window.renderIcons?.();
      ligar();
      fundo.querySelector('.cm-erro-campo input, .cm-erro-campo select')?.focus();
    };

    const coletar = () => {
      const g = id => fundo.querySelector('#' + id);
      return {
        paciente_id: g('cmaPaciente')?.value || '',
        plano_id: g('cmaPlano')?.value || '',
        inicio_periodo: g('cmaInicio')?.value || '',
        data_inicio_original: g('cmaDesde')?.value || '',
        valor_contratado: g('cmaValor')?.value || '',
        horario: g('cmaHorario')?.value || '',
        observacoes: g('cmaObs')?.value || '',
        renovacao_automatica: !!g('cmaRenova')?.checked,
        criar_cobranca: !!g('cmaCobranca')?.checked,
      };
    };

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // Trocar plano ou data redesenha só o "Termina em": ver a data mudar na
      // hora é o que evita descobrir o período errado depois de salvar.
      ['cmaPlano', 'cmaInicio'].forEach(id => {
        fundo.querySelector('#' + id)?.addEventListener('change', () => {
          form = { ...form, ...coletar() };
          const p = planoDe(form.plano_id);
          const fim = p && form.inicio_periodo ? fimDoPeriodo(form.inicio_periodo, p) : null;
          const alvo = fundo.querySelector('[data-fim]');
          if (alvo) alvo.textContent = fim ? fim.split('-').reverse().join('/') : '—';
        });
      });

      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const plano = planoDe(form.plano_id);
        const erros = validarAssinatura(form, plano);
        if (Object.keys(erros).length) { desenhar(erros); return; }
        salvando = true;
        try {
          await aoSalvar(assinaturaParaBanco(form, plano), { criarCobranca: form.criar_cobranca, plano });
          fechar();
        } catch (e) {
          salvando = false;
          console.error('Comercial · salvar assinatura:', e);
          desenhar({ paciente_id: 'Não consegui salvar: ' + (e?.message || e) });
        }
      });
    }

    desenhar();
  });
}
