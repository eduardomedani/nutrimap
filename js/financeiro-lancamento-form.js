// ═══════════════════════════════════════════════════════════
// LANÇAMENTO — drawer de cadastro e edição (despesa e receita)
// ═══════════════════════════════════════════════════════════
// UM drawer para os dois lados do caixa. Antes, despesa abria painel lateral e
// receita abria modal centralizado: duas telas para a mesma tarefa, com duas
// validações e dois espaçamentos — e a segunda é sempre a que fica para trás.
// O que muda entre elas são PALAVRAS (pago/recebido, fornecedor/cliente) e um
// campo (centro de custo só faz sentido em despesa). Isso é parâmetro, não
// arquivo novo.
//
// Painel lateral, não modal centralizado: lançar é tarefa repetitiva, e quem
// registra seis contas seguidas precisa continuar vendo a lista atrás para
// saber onde parou. Mesma estrutura do drawer da dieta (js/dieta-refeicao.js):
// corpo rolável entre cabeçalho e rodapé fixos, ESC fecha.
//
// O MESMO DRAWER CRIA E EDITA. Duas telas para o mesmo objeto viram duas
// validações, e a segunda fica para trás.
//
// SEÇÕES, NÃO UMA LISTA CONTÍNUA. São dezoito campos: em fila única, o olho não
// encontra o que procura e a pessoa preenche na ordem errada. Cada seção
// responde uma pergunta — o que é, quanto custa, quando, de quem.
//
// O QUE ESTA ETAPA NÃO TEM, e por quê:
//   · conta de pagamento — não existe tabela de contas; um <select> com opções
//     inventadas gravaria texto que finge ser vínculo;
//   · anexos — não há bucket financeiro. Etapa própria;
//   · parcelamento e recorrência — exigem grupo_parcelamento_id e um motor de
//     recorrência que ainda não existem. Não simulo repetindo lançamento.

import {
  listarCategorias, listarCentrosCusto, criarCategoria, criarCentroCusto,
  criarDespesa, salvarDespesa, excluirLancamento, cancelarDespesa,
  formatarBRL, hojeISO, competenciaDe, somarDias, fimDoMes, nomeCompetencia,
} from './financeiro.js';
import {
  validarLancamento, lancamentoParaBanco, preservarOriginal,
  STATUS, TERMOS, rotulosStatus, FORMAS_PAGAMENTO, competenciaDeData,
} from './financeiro-lancamento-validacao.js';
import {
  secaoOrigemHtml, validarOrigem, modoDeSalvar, preencherDaCobranca, origemDoLancamento,
} from './financeiro-origem.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** As cobranças em aberto do cliente escolhido. Fora do `drawerHtml` para o
 *  teste poder exercitar a lista sem montar o formulário inteiro. */
export function cobrancasDoForm(form = {}, assinaturas = []) {
  return (assinaturas.find(a => a.id === form.assinatura_id)?.cobrancas) || [];
}

/** O formulário zerado. Nada de fornecedor, categoria ou valor adivinhados —
 *  só o que é fato: ainda não pagou, é deste mês. */
export function lancamentoVazio(hoje = hojeISO()) {
  return {
    descricao: '', valor: '', valorIndefinido: false,
    competencia: competenciaDeData(hoje),
    vencimento: '', status: 'pendente', pago_em: '', forma_pagamento: '',
    categoria_id: '', centro_custo_id: '', fornecedor: '', documento: '', observacoes: '',
  };
}

/** Do banco para o formulário. */
export function lancamentoDoBanco(l) {
  return {
    descricao: l.descricao || '',
    valor: l.valor == null ? '' : Number(l.valor).toFixed(2).replace('.', ','),
    valorIndefinido: l.valor == null,
    competencia: l.competencia || '',
    vencimento: l.vencimento || '',
    status: l.status || (l.pago ? 'pago' : 'pendente'),
    pago_em: l.pago_em || '',
    forma_pagamento: l.forma_pagamento || '',
    categoria_id: l.categoria_id || '',
    centro_custo_id: l.centro_custo_id || '',
    fornecedor: l.fornecedor || '',
    documento: l.documento || '',
    observacoes: l.observacoes || '',
  };
}

let _aberto = false;

/**
 * Abre o drawer.
 *
 * @param {object} opcoes
 *   (não recebe mais o dono das linhas — ele sai do default da coluna no banco
 *    desde a Etapa 4B. O encanamento que trazia `nutriId` desde
 *    `initFinanceiroUI` foi removido junto.)
 *   tipo        — 'despesa' (padrão) ou 'receita'
 *   lancamento  — null cria; objeto edita
 *   inicial     — formulário pré-preenchido (duplicar)
 *   aoSalvar    — chamado depois de gravar, para a tela recarregar
 */
export async function abrirLancamento({
  tipo = 'despesa', lancamento = null, inicial = null, aoSalvar = null,
} = {}) {
  if (_aberto) return;
  _aberto = true;

  const ehReceita = tipo === 'receita';
  const t = TERMOS[ehReceita ? 'receita' : 'despesa'];
  const rotStatus = rotulosStatus(tipo);
  const edicao = !!lancamento;

  let form = inicial || (edicao ? lancamentoDoBanco(lancamento) : lancamentoVazio());
  let sujo = false;
  let salvando = false;

  let categorias = [], centros = [], assinaturasCom = [];
  try { categorias = await listarCategorias(tipo); } catch (e) { categorias = []; }

  // Clientes com cobrança em aberto. Só para receita, e sem derrubar nada se o
  // módulo comercial ainda não estiver no banco — o financeiro existia antes
  // dele e tem que continuar abrindo sem ele.
  if (ehReceita) {
    try {
      const dados = await import('./comercial-data.js');
      assinaturasCom = await dados.assinaturasComCobrancaAberta();
    } catch (e) { assinaturasCom = []; }
  }
  // Centro de custo só existe para despesa, e a tabela pode nem ter sido criada
  // ainda. O cadastro não pode ficar refém disso.
  if (!ehReceita) { try { centros = await listarCentrosCusto(); } catch (e) { centros = []; } }

  const fundo = document.createElement('div');
  fundo.className = 'dsp-drawer-raiz';
  document.body.appendChild(fundo);
  document.body.classList.add('dsp-travado');

  const fechar = (forcado = false) => {
    if (!forcado && sujo && !confirm('Você tem alterações não salvas. Descartar?')) return;
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('dsp-travado');
    fundo.remove();
    _aberto = false;
  };
  function aoTeclado(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); }
  }
  document.addEventListener('keydown', aoTeclado);

  // SE O DESENHO FALHAR, A TRAVA TEM QUE CAIR. `_aberto` existe para não abrir
  // dois drawers; se um erro o deixasse ligado, o botão ficaria morto para
  // sempre — e sem nada na tela dizendo por quê, que foi exatamente o que
  // aconteceu com o erro de zona morta temporal.
  try {
    desenhar();
  } catch (e) {
    document.removeEventListener('keydown', aoTeclado);
    document.body.classList.remove('dsp-travado');
    fundo.remove();
    _aberto = false;
    console.error('Falha ao montar o drawer de lançamento:', e);
    alert('Não consegui abrir o formulário: ' + (e?.message || e));
  }

  function desenhar(erros = {}) {
    fundo.innerHTML = drawerHtml({ tipo, form, erros, edicao, categorias, centros, lancamento, assinaturas: assinaturasCom });
    ligar();
    const alvo = fundo.querySelector('.dsp-erro-campo input, .dsp-erro-campo select') ||
                 fundo.querySelector('#dspDescricao');
    if (alvo) alvo.focus();
  }

  function coletar() {
    const g = id => fundo.querySelector('#' + id);
    const mes = g('dspCompetencia')?.value || '';
    return {
      descricao: g('dspDescricao')?.value || '',
      valor: g('dspValor')?.value || '',
      valorIndefinido: !!g('dspSemValor')?.checked,
      competencia: mes ? `${mes}-01` : '',
      vencimento: g('dspVencimento')?.value || '',
      status: g('dspStatus')?.value || 'pendente',
      pago_em: g('dspPagoEm')?.value || '',
      forma_pagamento: g('dspForma')?.value || '',
      categoria_id: g('dspCategoria')?.value || '',
      centro_custo_id: g('dspCentro')?.value || '',
      fornecedor: g('dspFornecedor')?.value || '',
      documento: g('dspDocumento')?.value || '',
      observacoes: g('dspObs')?.value || '',
      // Origem só existe em receita; em despesa os três voltam vazios e nada
      // no resto do formulário olha para eles.
      origem: g('dspOrigem')?.value || form.origem || 'outra',
      assinatura_id: g('dspCliente')?.value || '',
      cobranca_id: g('dspCobranca')?.value || '',
    };
  }

  function ligar() {
    fundo.querySelectorAll('[data-dsp-fechar]').forEach(b => b.addEventListener('click', () => fechar()));
    fundo.addEventListener('input', () => { sujo = true; });

    // Trocar status ou "sem valor" redesenha: os campos de pagamento aparecem e
    // somem, e mantê-los escondidos no DOM faria o coletar() ler campo morto.
    const status = fundo.querySelector('#dspStatus');
    if (status) status.addEventListener('change', () => { form = coletar(); sujo = true; desenhar(); });

    const semValor = fundo.querySelector('#dspSemValor');
    if (semValor) semValor.addEventListener('change', () => { form = coletar(); sujo = true; desenhar(); });

    // Origem: trocar qualquer um dos três redesenha, porque os seletores
    // seguintes dependem do anterior e a cobrança escolhida dita descrição,
    // valor, categoria e datas.
    const origem = fundo.querySelector('#dspOrigem');
    if (origem) origem.addEventListener('change', () => {
      form = { ...coletar(), assinatura_id: '', cobranca_id: '' };
      sujo = true; desenhar();
    });

    const cliente = fundo.querySelector('#dspCliente');
    if (cliente) cliente.addEventListener('change', () => {
      form = { ...coletar(), cobranca_id: '' };
      sujo = true; desenhar();
    });

    const cobranca = fundo.querySelector('#dspCobranca');
    if (cobranca) cobranca.addEventListener('change', () => {
      form = coletar();
      const a = assinaturasCom.find(x => x.id === form.assinatura_id);
      const c = (a?.cobrancas || []).find(x => x.id === form.cobranca_id);
      if (c) form = { ...form, ...preencherDaCobranca(c, a) };
      sujo = true; desenhar();
    });

    fundo.querySelectorAll('[data-venc]').forEach(b => b.addEventListener('click', () => {
      const campo = fundo.querySelector('#dspVencimento');
      const hoje = hojeISO();
      const q = b.dataset.venc;
      campo.value = q === 'hoje' ? hoje
                  : q === 'amanha' ? somarDias(hoje, 1)
                  : q === '7' ? somarDias(hoje, 7)
                  : fimDoMes(hoje);
      sujo = true;
    }));

    const novaCat = fundo.querySelector('#dspNovaCategoria');
    if (novaCat) novaCat.addEventListener('click', () => criarEmLinha('categoria'));
    const novoCC = fundo.querySelector('#dspNovoCentro');
    if (novoCC) novoCC.addEventListener('click', () => criarEmLinha('centro'));

    const rascunho = fundo.querySelector('#dspRascunho');
    if (rascunho) rascunho.addEventListener('click', () => gravar({ rascunho: true }));
    // Guardado como todos os outros: um querySelector que volta nulo derrubava
    // o `ligar()` inteiro, e com ele os listeners já registrados acima.
    const salvar = fundo.querySelector('#dspSalvar');
    if (salvar) salvar.addEventListener('click', () => gravar({ rascunho: false }));

    const cancelar = fundo.querySelector('#dspCancelarLanc');
    if (cancelar) cancelar.addEventListener('click', aoCancelarLancamento);
  }

  /** Cria categoria/centro sem sair do lançamento. */
  async function criarEmLinha(qual) {
    const nome = prompt(qual === 'categoria'
      ? `Nome da nova categoria de ${t.titulo}:`
      : 'Nome do novo centro de custo:');
    if (!nome || !nome.trim()) return;

    form = coletar();
    try {
      if (qual === 'categoria') {
        const c = await criarCategoria({ nome: nome.trim(), tipo });
        categorias = await listarCategorias(tipo);
        form.categoria_id = c.id;
      } else {
        const c = await criarCentroCusto(nome.trim());
        centros = await listarCentrosCusto();
        form.centro_custo_id = c.id;
      }
      sujo = true;
      desenhar();
    } catch (e) {
      const dup = /duplicate key|unique/i.test(String(e?.message || ''));
      alert(dup ? `Já existe "${nome.trim()}".` : 'Não consegui criar: ' + (e?.message || e));
    }
  }

  async function gravar({ rascunho }) {
    if (salvando) return;                       // trava o duplo envio
    form = coletar();

    const erros = { ...validarLancamento(form, { rascunho, tipo }), ...validarOrigem(form) };
    if (Object.keys(erros).length) { desenhar(erros); return; }

    const botao = fundo.querySelector('#dspSalvar');
    const rotulo = botao.innerHTML;
    salvando = true;
    botao.disabled = true;
    botao.innerHTML = '<i data-lucide="loader"></i> Salvando...';

    try {
      const campos = lancamentoParaBanco(form, tipo);

      // COM COBRANÇA ESCOLHIDA, NÃO SE CRIA NADA. A cobrança já é um
      // lançamento pendente: criar outro faria o mesmo dinheiro aparecer duas
      // vezes no caixa e deixaria a cobrança em aberto, cobrando quem pagou.
      // Aqui se dá baixa nela — o mesmo caminho do drawer do cliente.
      if (!edicao && modoDeSalvar(form) === 'pagamento') {
        const a = assinaturasCom.find(x => x.id === form.assinatura_id);
        const dados = await import('./comercial-data.js');
        await dados.registrarPagamento({
          lancamentoId: form.cobranca_id,
          assinatura: a,
          pagoEm: campos.pago_em || campos.data || hojeISO(),
          valorPago: campos.valor,
          formaPagamento: campos.forma_pagamento || null,
        });
        botao.innerHTML = '<i data-lucide="check"></i> Cobrança quitada';
        sujo = false;
        if (aoSalvar) await aoSalvar();
        fechar(true);
        return;
      }

      if (edicao) {
        // Antes de a primeira edição sobrescrever, o que a planilha dizia vai
        // para metadata. Depois dela já não há de onde recuperar.
        const preserva = preservarOriginal(lancamento);
        if (preserva) {
          preserva.original.preservado_em = new Date().toISOString();
          campos.metadata = { ...(lancamento.metadata || {}), ...preserva };
        }
        await salvarDespesa(lancamento.id, campos);
      } else {
        await criarDespesa(campos);
      }

      botao.innerHTML = '<i data-lucide="check"></i> Salvo';
      sujo = false;
      if (aoSalvar) await aoSalvar();
      fechar(true);
    } catch (e) {
      salvando = false;
      botao.disabled = false;
      botao.innerHTML = rotulo;
      alert('Não consegui gravar: ' + (e?.message || e));
    }
  }

  async function aoCancelarLancamento() {
    if (!confirm(
      `Cancelar "${lancamento.descricao}"?\n\n` +
      'O lançamento sai dos totais e dos alertas, mas continua na lista com o ' +
      'rótulo Cancelado. Nada é apagado.')) return;
    try {
      await cancelarDespesa(lancamento.id);
      sujo = false;
      if (aoSalvar) await aoSalvar();
      fechar(true);
    } catch (e) {
      alert('Não consegui cancelar: ' + (e?.message || e));
    }
  }
}

/** Atalho de leitura para quem só lida com despesa. */
export const abrirDespesa = (o = {}) => abrirLancamento({ ...o, tipo: 'despesa' });

export { excluirLancamento, competenciaDe, lancamentoDoBanco as despesaDoBanco };


// ═══════════════════════════════════════════════════════════
// A MARCAÇÃO, COMO FUNÇÃO PURA
// ═══════════════════════════════════════════════════════════
// Entram os dados, sai a marcação. Nada de DOM, nada de rede — mesmo contrato
// de js/financeiro-grafico.js, e pela mesma razão: é o que permite ao teste
// EXECUTAR o formulário em vez de conferir strings no arquivo.
//
// Isto não é gosto por pureza. Enquanto a marcação morava dentro do closure,
// um erro de zona morta temporal ( usada antes da própria declaração)
// fazia o drawer não abrir, e os testes passavam todos: eles liam o arquivo
// como texto e nunca chamaram a função.
export function drawerHtml(ctx = {}) {
  const {
    form = {}, erros = {}, edicao = false,
    categorias = [], centros = [], lancamento = null, assinaturas = [],
  } = ctx;
  const tipo = ctx.tipo === 'receita' ? 'receita' : 'despesa';
  const ehReceita = tipo === 'receita';
  const t = TERMOS[tipo];
  const rotStatus = rotulosStatus(tipo);
  const titulo = `${edicao ? 'Editar' : 'Nova'} ${t.titulo}`;

  // ── seções ───────────────────────────────────────────────
  // DECLARADAS COM `function`, NÃO COM `const`. `desenhar()` roda antes destas
  // linhas serem alcançadas, e uma arrow em `const` ainda está na zona morta
  // temporal nesse momento: o drawer lançava "Cannot access 'cls' before
  // initialization" e simplesmente não abria — sem nada na tela dizendo por quê.
  function erroHtml(erros, nome) {
    return erros[nome]
      ? `<p class="dsp-erro" id="dspErro-${nome}" role="alert">${esc(erros[nome])}</p>` : '';
  }
  function cls(erros, nome) { return erros[nome] ? ' dsp-erro-campo' : ''; }
  function aria(erros, nome) {
    return erros[nome] ? ` aria-invalid="true" aria-describedby="dspErro-${nome}"` : '';
  }

  function secaoIdentificacao(f, erros) {
    return `
      <section class="dsp-secao">
        <h3 class="dsp-secao-tit">Identificação</h3>
        <div class="dsp-campo${cls(erros, 'descricao')}">
          <label for="dspDescricao">Descrição <span class="dsp-req" aria-hidden="true">*</span></label>
          <input type="text" id="dspDescricao" class="np-input" placeholder="${esc(t.descreva)}"
                 value="${esc(f.descricao)}" required${aria(erros, 'descricao')}>
          ${erroHtml(erros, 'descricao')}
        </div>
      </section>`;
  }

  function secaoValor(f, erros) {
    return `
      <section class="dsp-secao">
        <h3 class="dsp-secao-tit">Valor e classificação</h3>
        <div class="dsp-par">
          <div class="dsp-campo${cls(erros, 'valor')}">
            <label for="dspValor">Valor total <span class="dsp-req" aria-hidden="true">*</span></label>
            <input type="text" id="dspValor" class="np-input" placeholder="R$ 0,00" inputmode="decimal"
                   value="${esc(f.valor)}"${f.valorIndefinido ? ' disabled' : ''}${aria(erros, 'valor')}>
            ${erroHtml(erros, 'valor')}
            <label class="dsp-check">
              <input type="checkbox" id="dspSemValor"${f.valorIndefinido ? ' checked' : ''}>
              <span>Valor ainda não definido</span>
            </label>
          </div>

          <div class="dsp-campo${cls(erros, 'categoria_id')}">
            <label for="dspCategoria">Categoria <span class="dsp-req" aria-hidden="true">*</span></label>
            <div class="dsp-com-botao">
              <select id="dspCategoria" class="fp-select"${aria(erros, 'categoria_id')}>
                <option value="">— Sem categoria —</option>
                ${categorias.map(c => `<option value="${c.id}"${c.id === f.categoria_id ? ' selected' : ''}>${
                  esc(c.nome)}${c.ativo === false ? ' (inativa)' : ''}</option>`).join('')}
              </select>
              <button type="button" class="dsp-mais" id="dspNovaCategoria"
                      aria-label="Criar categoria"><i data-lucide="plus"></i></button>
            </div>
            ${erroHtml(erros, 'categoria_id')}
            <p class="dsp-dica">${ehReceita
              ? 'O que foi vendido: Mensal - 5x, Suplemento, Diária.'
              : 'A natureza do gasto: Energia, Aluguel, Contabilidade.'}</p>
          </div>
        </div>

        ${ehReceita ? '' : `
        <div class="dsp-campo">
          <label for="dspCentro">Centro de custo</label>
          <div class="dsp-com-botao">
            <select id="dspCentro" class="fp-select"${centros.length ? '' : ' disabled'}>
              <option value="">— Sem centro de custo —</option>
              ${centros.map(c => `<option value="${c.id}"${c.id === f.centro_custo_id ? ' selected' : ''}>${
                esc(c.nome)}</option>`).join('')}
            </select>
            <button type="button" class="dsp-mais" id="dspNovoCentro"${centros.length ? '' : ' disabled'}
                    aria-label="Criar centro de custo"><i data-lucide="plus"></i></button>
          </div>
          <p class="dsp-dica">${centros.length
            ? 'Onde o gasto foi alocado: Estrutura, Administrativo, Marketing.'
            : 'Rode <code>db/financeiro_centros_custo_migrar.sql</code> para habilitar.'}</p>
        </div>`}
      </section>`;
  }

  function secaoDatas(f, erros) {
    const pago = f.status === 'pago';
    return `
      <section class="dsp-secao">
        <h3 class="dsp-secao-tit">Datas e ${ehReceita ? 'recebimento' : 'pagamento'}</h3>
        <div class="dsp-par">
          <div class="dsp-campo${cls(erros, 'competencia')}">
            <label for="dspCompetencia">Competência <span class="dsp-req" aria-hidden="true">*</span></label>
            <input type="month" id="dspCompetencia" class="np-input"
                   value="${esc(String(f.competencia || '').slice(0, 7))}"${aria(erros, 'competencia')}>
            ${erroHtml(erros, 'competencia')}
            <p class="dsp-dica">O mês a que pertence${
              f.competencia ? ` — ${esc(nomeCompetencia(f.competencia))}` : ''}.</p>
          </div>

          <div class="dsp-campo${cls(erros, 'vencimento')}">
            <label for="dspVencimento">Vencimento</label>
            <input type="date" id="dspVencimento" class="np-input" value="${esc(f.vencimento)}"${
              aria(erros, 'vencimento')}>
            <div class="dsp-atalhos">
              <button type="button" data-venc="hoje">Hoje</button>
              <button type="button" data-venc="amanha">Amanhã</button>
              <button type="button" data-venc="7">Em 7 dias</button>
              <button type="button" data-venc="fim">Fim do mês</button>
            </div>
            ${erroHtml(erros, 'vencimento')}
          </div>
        </div>

        <div class="dsp-par">
          <div class="dsp-campo${cls(erros, 'status')}">
            <label for="dspStatus">Situação <span class="dsp-req" aria-hidden="true">*</span></label>
            <select id="dspStatus" class="fp-select"${aria(erros, 'status')}>
              ${Object.keys(STATUS).map(id =>
                `<option value="${id}"${id === f.status ? ' selected' : ''}>${rotStatus[id]}</option>`).join('')}
            </select>
            ${erroHtml(erros, 'status')}
            <p class="dsp-dica">“Vencido” não se escolhe: sai de pendente + vencimento passado.</p>
          </div>

          ${pago ? `
          <div class="dsp-campo${cls(erros, 'pago_em')}">
            <label for="dspPagoEm">${t.dataPagamento} <span class="dsp-req" aria-hidden="true">*</span></label>
            <input type="date" id="dspPagoEm" class="np-input" value="${esc(f.pago_em || hojeISO())}"${
              aria(erros, 'pago_em')}>
            ${erroHtml(erros, 'pago_em')}
          </div>` : '<div class="dsp-campo dsp-vazio-par" aria-hidden="true"></div>'}
        </div>

        ${pago ? `
        <div class="dsp-campo">
          <label for="dspForma">Forma de ${ehReceita ? 'recebimento' : 'pagamento'}</label>
          <select id="dspForma" class="fp-select">
            <option value="">— Não informada —</option>
            ${FORMAS_PAGAMENTO.map(o =>
              `<option value="${o.id}"${o.id === f.forma_pagamento ? ' selected' : ''}>${o.rotulo}</option>`).join('')}
          </select>
        </div>` : ''}
      </section>`;
  }

  function secaoQuem(f) {
    return `
      <section class="dsp-secao">
        <h3 class="dsp-secao-tit">${t.quemSecao}</h3>
        <div class="dsp-par">
          <div class="dsp-campo">
            <label for="dspFornecedor">${t.quem}</label>
            <input type="text" id="dspFornecedor" class="np-input" placeholder="Quem ${
              ehReceita ? 'pagou' : 'recebeu'}" value="${esc(f.fornecedor)}">
            <p class="dsp-dica">${t.quemDica}</p>
          </div>
          <div class="dsp-campo">
            <label for="dspDocumento">Documento</label>
            <input type="text" id="dspDocumento" class="np-input" placeholder="NF, boleto, recibo"
                   value="${esc(f.documento)}">
          </div>
        </div>
      </section>`;
  }

  function secaoObservacoes(f) {
    return `
      <section class="dsp-secao">
        <h3 class="dsp-secao-tit">Observações</h3>
        <div class="dsp-campo">
          <label for="dspObs">Observações</label>
          <textarea id="dspObs" class="np-input dsp-textarea" rows="3"
                    placeholder="Motivo, período coberto, detalhes da negociação">${esc(f.observacoes)}</textarea>
        </div>
      </section>`;
  }

  /** O que ainda não existe, dito com todas as letras. Um campo desabilitado
   *  sem explicação lê-se como defeito; dito assim, lê-se como etapa. */
  function avancadoHtml() {
    return `
      <section class="dsp-secao dsp-secao-futura">
        <h3 class="dsp-secao-tit">Ainda não disponível</h3>
        <ul class="dsp-futuro">
          <li><i data-lucide="paperclip"></i> Anexos — depende de um bucket financeiro próprio</li>
          <li><i data-lucide="copy"></i> Parcelamento — depende do grupo de parcelas no banco</li>
          <li><i data-lucide="repeat"></i> Recorrência — depende do motor de repetição</li>
          <li><i data-lucide="landmark"></i> Conta de pagamento — não há cadastro de contas</li>
        </ul>
        <p class="dsp-dica">Nada aqui é simulado enquanto não existir de verdade.</p>
      </section>`;
  }

  function avisosHtml(l) {
    const partes = [];
    if ((l.status || (l.pago ? 'pago' : 'pendente')) === 'pago') {
      partes.push(`<div class="dsp-aviso"><i data-lucide="info"></i><div>${t.afeta}</div></div>`);
    }
    // O espelho da folha NÃO é importação: ele se refaz a cada fechamento, e
    // é isso que precisa estar dito antes de alguém editar o valor aqui.
    if (l.origem === 'folha') {
      partes.push(`<div class="dsp-aviso dsp-aviso-origem">
        <i data-lucide="users-round"></i>
        <div>
          <strong>Origem: folha de pagamento</strong>
          <div class="dsp-origem-dados">
            O valor é apurado em Equipe e reescrito toda vez que a folha desta
            competência é fechada. Corrigir aqui vale até o próximo fechamento —
            para mudar o número de verdade, reabra a folha e corrija lá.
          </div>
        </div>
      </div>`);
    } else if (l.origem && l.origem !== 'manual') {
      const orig = l.metadata?.original;
      partes.push(`<div class="dsp-aviso dsp-aviso-origem">
        <i data-lucide="file-input"></i>
        <div>
          <strong>Origem: importação</strong>
          <div class="dsp-origem-dados">
            ${l.origem === 'planilha' ? 'custos.csv' : 'Vendas.xlsx'}${
              l.origem_linha ? ` · linha ${l.origem_linha}` : ''}
          </div>
          ${orig ? `<div class="dsp-origem-dados">
            Original: ${esc(orig.descricao || '—')}${
              orig.valor != null ? ` · ${esc(formatarBRL(orig.valor))}` : ' · sem valor'}
          </div>` : ''}
        </div>
      </div>`);
    }
    return partes.join('');
  }

  // ── comportamento ────────────────────────────────────────
  return `
      <aside class="dsp-drawer" role="dialog" aria-modal="true" aria-labelledby="dspTitulo">
        <header class="dsp-topo">
          <div class="dsp-topo-txt">
            <div class="dsp-eyebrow">
              <i data-lucide="${ehReceita ? 'trending-up' : 'trending-down'}"></i>
              Financeiro da empresa
            </div>
            <h2 class="dsp-titulo" id="dspTitulo">${titulo}</h2>
            <p class="dsp-sub">${edicao ? t.subEdicao : t.subNovo}</p>
          </div>
          <button class="dsp-x" data-dsp-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
        </header>

        <div class="dsp-body">
          ${edicao ? avisosHtml(lancamento) : ''}
          ${ehReceita ? secaoOrigemHtml({ form, assinaturas, cobrancas: cobrancasDoForm(form, assinaturas), erros }) : ''}
          ${secaoIdentificacao(form, erros)}
          ${secaoValor(form, erros)}
          ${secaoDatas(form, erros)}
          ${secaoQuem(form)}
          ${secaoObservacoes(form)}
          ${avancadoHtml()}
        </div>

        <footer class="dsp-ft">
          ${edicao ? `
            <button class="btn dsp-danger" id="dspCancelarLanc">
              <i data-lucide="ban"></i> Cancelar lançamento
            </button>` : '<span></span>'}
          <div class="dsp-ft-dir">
            <button class="btn" data-dsp-fechar>Fechar</button>
            ${edicao ? '' : `<button class="btn" id="dspRascunho">Salvar rascunho</button>`}
            <button class="btn primary" id="dspSalvar">
              <i data-lucide="check"></i> ${edicao ? 'Salvar alterações' : `Salvar ${t.titulo}`}
            </button>
          </div>
        </footer>
      </aside>`;

}
