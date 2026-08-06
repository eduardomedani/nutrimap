// ═══════════════════════════════════════════════════════════
// FINANCEIRO — a origem de uma receita
// ═══════════════════════════════════════════════════════════
// Responde "de onde veio esse dinheiro" no formulário de receita, e é o que
// liga o Financeiro ao Comercial sem criar um segundo financeiro.
//
// A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA EVITAR:
//
// A cobrança de um cliente JÁ É um lançamento de receita, criado pendente
// quando o período nasce. Se escolher a cobrança em "Nova receita" e salvar
// criasse uma linha nova, o mesmo dinheiro apareceria duas vezes no caixa — e
// a cobrança continuaria pendente, cobrando quem já pagou.
//
// Por isso `modoDeSalvar()`: com uma cobrança escolhida, o botão deixa de
// criar e passa a REGISTRAR O PAGAMENTO daquele lançamento. É a mesma coisa
// que o drawer do cliente faz, pela outra porta.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ORIGENS = [
  ['cliente', 'Cliente'],
  ['venda', 'Venda avulsa'],
  ['outra', 'Outra receita'],
];

/** A origem de um lançamento que já existe — derivada, nunca gravada. Ter uma
 *  coluna `origem_comercial` criaria uma segunda verdade que pode discordar
 *  do `assinatura_id`. */
export function origemDoLancamento(lancamento) {
  if (!lancamento) return 'outra';
  if (lancamento.assinatura_id || lancamento.paciente_id) return 'cliente';
  if (lancamento.origem === 'vendas') return 'venda';
  return 'outra';
}

/**
 * O que o botão Salvar vai fazer.
 *
 * 'pagamento' — há uma cobrança escolhida: marca ela como paga e renova.
 * 'novo'      — não há: cria um lançamento como sempre.
 */
export function modoDeSalvar(form = {}) {
  return form.origem === 'cliente' && form.cobranca_id ? 'pagamento' : 'novo';
}

/** Descreve uma cobrança numa linha, para o seletor. */
export function rotuloDaCobranca(c, assinatura) {
  const partes = [];
  if (assinatura?.plano?.nome) partes.push(assinatura.plano.nome);
  if (c?.vencimento) {
    const [a, m, d] = String(c.vencimento).split('-');
    partes.push(`vence ${d}/${m}/${a}`);
  }
  if (c?.valor != null) {
    partes.push(Number(c.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  }
  return partes.join(' — ');
}

/**
 * A seção de origem.
 *
 * Só existe para receita: despesa não tem cliente. Os seletores de cliente e
 * de cobrança aparecem apenas quando a origem é "Cliente" — mostrá-los
 * desabilitados o tempo todo enche a tela de campo morto.
 */
export function secaoOrigemHtml({ form = {}, assinaturas = [], cobrancas = [], erros = {} } = {}) {
  const origem = form.origem || 'outra';
  const ehCliente = origem === 'cliente';
  const escolhida = cobrancas.find(c => c.id === form.cobranca_id) || null;
  const assinatura = assinaturas.find(a => a.id === form.assinatura_id) || null;

  const cls = c => (erros[c] ? ' dsp-erro-campo' : '');
  const err = c => (erros[c] ? `<p class="dsp-erro" role="alert">${esc(erros[c])}</p>` : '');

  return `
    <section class="dsp-secao">
      <h3 class="dsp-secao-tit">Origem</h3>

      <div class="dsp-campo">
        <label for="dspOrigem">De onde veio</label>
        <select id="dspOrigem" class="np-input">
          ${ORIGENS.map(([id, rot]) => `<option value="${id}"${id === origem ? ' selected' : ''}>${esc(rot)}</option>`).join('')}
        </select>
        <p class="dsp-dica">Receita de cliente se liga à cobrança dele; as outras entram soltas no caixa.</p>
      </div>

      ${!ehCliente ? '' : `
      <div class="dsp-campo${cls('assinatura_id')}">
        <label for="dspCliente">Cliente</label>
        <select id="dspCliente" class="np-input">
          <option value="">Escolha…</option>
          ${assinaturas.map(a => `<option value="${esc(a.id)}"${a.id === form.assinatura_id ? ' selected' : ''}>${esc(a.paciente?.nome || 'Sem nome')}</option>`).join('')}
        </select>
        ${err('assinatura_id')}
        ${assinaturas.length ? '' : '<p class="dsp-dica">Nenhum cliente com assinatura. Cadastre em Administração &rsaquo; Comercial.</p>'}
      </div>

      <div class="dsp-campo${cls('cobranca_id')}">
        <label for="dspCobranca">Cobrança</label>
        <select id="dspCobranca" class="np-input"${assinatura ? '' : ' disabled'}>
          <option value="">${assinatura ? 'Escolha…' : 'Escolha o cliente primeiro'}</option>
          ${cobrancas.map(c => `<option value="${esc(c.id)}"${c.id === form.cobranca_id ? ' selected' : ''}>${esc(rotuloDaCobranca(c, assinatura))}</option>`).join('')}
        </select>
        ${err('cobranca_id')}
        ${assinatura && !cobrancas.length
          ? '<p class="dsp-dica">Esse cliente não tem cobrança em aberto.</p>' : ''}
      </div>

      ${escolhida ? `
      <div class="dsp-aviso">
        <i data-lucide="link"></i>
        <div>
          <strong>Isto vai dar baixa nessa cobrança.</strong>
          <div class="dsp-origem-dados">
            Nenhum lançamento novo é criado — a cobrança já é o lançamento. Ao
            salvar, ela fica paga e o período do cliente é renovado.
          </div>
        </div>
      </div>` : ''}
      `}
    </section>`;
}

/** Valida só o que é da origem; o resto do formulário tem a validação dele. */
export function validarOrigem(form = {}) {
  const erros = {};
  if (form.origem !== 'cliente') return erros;
  if (!form.assinatura_id) erros.assinatura_id = 'Escolha o cliente.';
  else if (!form.cobranca_id) erros.cobranca_id = 'Escolha a cobrança que este pagamento quita.';
  return erros;
}

/** Os campos que a cobrança escolhida dita ao formulário. Descrição e valor
 *  vêm dela para o operador não redigitar — e não divergir. */
export function preencherDaCobranca(cobranca, assinatura) {
  if (!cobranca) return {};
  return {
    descricao: cobranca.descricao ||
      `${assinatura?.plano?.nome || 'Mensalidade'} — ${assinatura?.paciente?.nome || ''}`.trim(),
    valor: cobranca.valor == null ? '' : Number(cobranca.valor).toFixed(2).replace('.', ','),
    categoria_id: cobranca.categoria_id || '',
    vencimento: cobranca.vencimento || '',
    competencia: String(cobranca.competencia || '').slice(0, 7),
  };
}
