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
import { fimDoPeriodo, somarDias } from './comercial.js';
import { moeda, dataBR, dePara } from './comercial-ui.js';
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
// COBRANÇA DO PERÍODO — e a renovação que vem depois dela
// ───────────────────────────────────────────────────────────
// A distinção que este formulário existe para tornar impossível de confundir:
//
//   a assinatura           -> o que está VIGENTE agora
//   a renovação programada -> o que ENTRA no próximo ciclo
//
// Criar a cobrança NÃO mexe em plano, valor nem período da assinatura. Se
// mexesse, o período que ainda está correndo passaria a parecer que pertence
// ao plano novo — e o histórico deixaria de responder "qual plano estava
// vigente naquele período".

/**
 * O PRAZO DE PAGAMENTO de uma cobrança criada à mão: 30 dias corridos.
 *
 * NÃO é a duração de plano nenhum, e por isso não sai de `PLANO_PADRAO` nem do
 * plano do cliente. É outra coisa: o tempo que a GoUp dá para pagar uma
 * cobrança emitida hoje. Amarrar os dois faria mudar a duração de um plano
 * mexer no prazo de pagamento de todo mundo.
 *
 * DIAS CORRIDOS, não "+1 mês": 01/02 vira 03/03 em ano não bissexto, e é isso
 * mesmo. `somarDias` é o helper que o módulo já usa em `fimDoPeriodo`.
 */
export const PRAZO_COBRANCA_DIAS = 30;

/**
 * O estado inicial do formulário de cobrança do período.
 *
 * O VENCIMENTO É `hoje + 30`, e NÃO `assinatura.fim_periodo`.
 *
 * Até 13/08/2026 ele era o fim do período — e uma cobrança emitida hoje para
 * um período encerrado em julho nascia vencida há 28 dias. A regra da GoUp é
 * outra: o cliente recebe a cobrança agora e tem 30 dias para pagar. O atraso
 * do período é assunto da ASSINATURA ("Período termina em"), não do prazo que
 * o financeiro concede.
 *
 * São conceitos independentes, e é por isso que a tela os separa: a assinatura
 * pode ter terminado em 16/07 e a cobrança criada em 13/08 vencer em 12/09.
 *
 * `hoje` é ARGUMENTO — a data de referência nunca é implícita neste módulo, e
 * é o que permite testar "criada em 13/08" sem esperar 13/08.
 */
export function cobrancaDoPeriodoVazia(assinatura = {}, hoje = hojeISO()) {
  return {
    vencimento: somarDias(hoje, PRAZO_COBRANCA_DIAS) || '',
    valor: paraCampoValor(assinatura.valor_contratado),
    // Sugestões, não decisões: o plano atual vem selecionado porque é o caso
    // comum (§8 — renovar no mesmo plano não pode custar trabalho nenhum).
    proximo_plano_id: assinatura.plano_id || '',
    proximo_valor: paraCampoValor(assinatura.valor_contratado),
  };
}

/**
 * O vencimento da PRIMEIRA cobrança de uma assinatura nova.
 *
 * NÃO é `hoje + 30`, e a diferença tem motivo. A cobrança acima cobre um
 * período que JÁ CORREU, e por isso não pode nascer vencida — daí os 30 dias.
 * Esta cobre um ciclo que está COMEÇANDO, igual à cobrança automática que a
 * RPC de pagamento cria: o cliente usa o período inteiro e paga no fim para
 * renovar. Passá-la para `hoje + 30` faria um Trimestral vencer 60 dias antes
 * de o período acabar.
 *
 * O PISO existe porque `inicio_periodo` é campo editável no formulário: a
 * validação só impede começar antes de `data_inicio_original`, então dá para
 * cadastrar uma assinatura com período retroativo, e a primeira cobrança dela
 * nasceria vencida. A regra inteira cabe numa frase: vence no fim do período,
 * nunca antes de 30 dias da criação.
 *
 * A automática não precisa do piso — o período novo dela sempre termina no
 * futuro, mesmo no pior atraso que a tolerância aceita.
 */
export function vencimentoDaPrimeiraCobranca(assinatura = {}, hoje = hojeISO()) {
  const piso = somarDias(hoje, PRAZO_COBRANCA_DIAS);
  const fim = assinatura?.fim_periodo || '';
  if (!fim) return piso || '';
  if (!piso) return fim;
  // Datas ISO comparam como texto: 2026-09-12 > 2026-07-16 sem converter nada.
  return fim < piso ? piso : fim;
}

/**
 * O valor futuro que a TROCA DE PLANO sugere.
 *
 * Só é chamada quando o usuário mexe no select — nunca a cada render. Essa
 * distinção é a regra: trocar de plano sugere o preço dele; digitar um valor
 * à mão vence; trocar de plano de novo volta a sugerir.
 *
 * Sem isto, o formulário mantinha o valor do plano ANTIGO ao trocar de plano.
 * No E2E de 13/08/2026 a CASO_TROCA_DE_PLANO saiu de um Mensal de R$ 330 para um
 * Trimestral e o campo continuou R$ 330 — um trimestre pelo preço de um mês.
 * Foi pego a olho; quem não olhar, contrata errado em silêncio.
 *
 * `null` significa "não tenho o que sugerir, deixe como está": plano sem
 * `preco_padrao` não vira R$ 0,00, que afirmaria que o cliente não paga nada.
 */
export function valorSugeridoAoTrocarPlano(planoId, planos = [], assinatura = {}) {
  // "Manter o atual" volta ao valor vigente — é o que o campo tinha ao abrir.
  if (!planoId) return paraCampoValor(assinatura.valor_contratado);

  const plano = planos.find(p => p.id === planoId);
  if (!plano || plano.preco_padrao == null) return null;
  return paraCampoValor(plano.preco_padrao);
}

/**
 * O que MUDA da vigência atual para a próxima — só para a tela contar.
 *
 * QUEM DECIDE O QUE É GRAVADO É O BANCO. A RPC recebe plano e valor futuros
 * sempre, e só escreve a intenção se diferirem do que está vigente. Esta
 * função existe para o botão saber se diz "Criar cobrança" ou "Criar cobrança
 * e programar renovação", e para o resumo aparecer só quando há o que resumir.
 *
 * Duas fontes decidindo a mesma coisa divergiriam no primeiro arredondamento;
 * por isso aqui é descrição, e lá é decisão.
 */
export function mudancaDaRenovacao(form = {}, assinatura = {}) {
  const planoAtual = assinatura.plano_id || null;
  const planoFuturo = form.proximo_plano_id || planoAtual;

  const valorAtual = assinatura.valor_contratado == null ? null : Number(assinatura.valor_contratado);
  const bruto = String(form.proximo_valor ?? '').trim();
  const valorFuturo = bruto ? moedaParaNumero(bruto) : null;

  const trocaPlano = planoFuturo !== planoAtual;
  // Espelha o `p_proximo_valor is not null and ... is distinct from` da RPC:
  // campo vazio não é "mudou para nada", é "não mexi nisso".
  const trocaValor = valorFuturo != null &&
    (valorAtual == null || Math.abs(valorFuturo - valorAtual) >= 0.005);

  return { planoAtual, planoFuturo, valorAtual, valorFuturo, trocaPlano, trocaValor,
           mudou: trocaPlano || trocaValor };
}

export function validarCobrancaDoPeriodo(form = {}) {
  const erros = {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.vencimento || ''))) {
    erros.vencimento = 'Informe o vencimento.';
  }

  const v = String(form.valor ?? '').trim() ? moedaParaNumero(form.valor) : null;
  if (v == null || !(v > 0)) erros.valor = 'Informe o valor da cobrança.';

  if (String(form.proximo_valor ?? '').trim()) {
    const f = moedaParaNumero(form.proximo_valor);
    if (f == null || f < 0) erros.proximo_valor = 'Valor inválido.';
  }

  return erros;
}

/** O resumo só existe quando há mudança. Sem troca, o §13 pede silêncio: é
 *  simplesmente criar a cobrança, e um bloco "renovação programada" repetindo
 *  o plano atual só ensinaria o usuário a ignorar resumos. */
export function resumoRenovacaoHtml(mudanca, planos = []) {
  if (!mudanca?.mudou) return '';
  const nomeDe = id => planos.find(p => p.id === id)?.nome || '—';

  const linhaPlano = mudanca.trocaPlano
    ? `<div class="cm-dw-linha">
         <span class="cm-dw-rot">Plano</span>
         <span class="cm-dw-val">${dePara(esc(nomeDe(mudanca.planoAtual)), esc(nomeDe(mudanca.planoFuturo)))}</span>
       </div>`
    : '';

  const linhaValor = mudanca.trocaValor
    ? `<div class="cm-dw-linha">
         <span class="cm-dw-rot">Valor contratado</span>
         <span class="cm-dw-val">${dePara(esc(moeda(mudanca.valorAtual)), esc(moeda(mudanca.valorFuturo)))}</span>
       </div>`
    : '';

  // "O que vai mudar", não "Próxima renovação": esse já é o título da seção
  // dos campos logo acima, e o mesmo rótulo duas vezes na mesma tela faz o
  // resumo parecer repetição em vez de confirmação. Segue o padrão do
  // formulário de pagamento, que chama a prévia dele de "O que vai acontecer".
  return `
    <div class="cm-dw-previa" data-resumo>
      <div class="cm-dw-previa-t">O que vai mudar</div>
      ${linhaPlano}${linhaValor}
      <p class="cm-ajuda-campo">
        Vale a partir do <b>próximo período</b>. O período atual continua no
        plano e no valor de hoje até este pagamento ser registrado.
      </p>
    </div>`;
}

export function formCobrancaPeriodoHtml({ assinatura = {}, planos = [], form = {}, erros = {} } = {}) {
  const mudanca = mudancaDaRenovacao(form, assinatura);
  const planoAtualNome = planos.find(p => p.id === assinatura.plano_id)?.nome
    || assinatura.plano?.nome || '—';

  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-labelledby="cmCpTit">
      <header class="cm-drawer-topo">
        <h2 id="cmCpTit">Cobrança do período</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <!-- LEITURA, nunca campo. O período vigente não se edita por aqui:
             mudá-lo não seria correção, seria outro contrato. -->
        <div class="cm-dw-leitura">
          <div class="cm-dw-linha">
            <span class="cm-dw-rot">Plano atual</span>
            <span class="cm-dw-val">${esc(planoAtualNome)}</span>
          </div>
          <div class="cm-dw-linha">
            <span class="cm-dw-rot">Período atual</span>
            <span class="cm-dw-val">${esc(dataBR(assinatura.inicio_periodo))} → ${esc(dataBR(assinatura.fim_periodo))}</span>
          </div>
          <div class="cm-dw-linha">
            <span class="cm-dw-rot">Valor contratado</span>
            <span class="cm-dw-val">${esc(moeda(assinatura.valor_contratado))}</span>
          </div>
        </div>

        <section class="cm-dw-secao">
          <h3 class="cm-dw-t">Cobrança deste período</h3>
          <div class="cm-linha-campos">
            <div class="cm-campo${cls(erros, 'vencimento')}">
              <label for="cmcpVenc">Vencimento</label>
              <input id="cmcpVenc" type="date" value="${esc(form.vencimento)}">
              ${msg(erros, 'vencimento')}
            </div>
            <div class="cm-campo${cls(erros, 'valor')}">
              <label for="cmcpValor">Valor da cobrança</label>
              <input id="cmcpValor" type="text" inputmode="decimal" value="${esc(form.valor)}">
              ${msg(erros, 'valor')}
            </div>
          </div>
          <p class="cm-ajuda-campo">
            Esta cobrança é do período que <b>já está correndo</b>. Trocar o plano
            abaixo não muda o que ela cobra.
          </p>
        </section>

        <section class="cm-dw-secao">
          <h3 class="cm-dw-t">Próxima renovação</h3>
          <div class="cm-campo${cls(erros, 'proximo_plano_id')}">
            <label for="cmcpPlano">Plano a partir da próxima renovação</label>
            <select id="cmcpPlano">
              <option value="">Manter o atual</option>
              ${planos.map(p => `<option value="${esc(p.id)}"${p.id === form.proximo_plano_id ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}
            </select>
            ${msg(erros, 'proximo_plano_id')}
          </div>
          <div class="cm-campo${cls(erros, 'proximo_valor')}">
            <label for="cmcpProxValor">Valor contratado futuro</label>
            <input id="cmcpProxValor" type="text" inputmode="decimal" value="${esc(form.proximo_valor)}">
            ${msg(erros, 'proximo_valor')}
          </div>
          <p class="cm-ajuda-campo">
            Nada muda na assinatura agora. O plano e o valor daqui entram
            <b>quando esta cobrança for paga</b>.
          </p>
        </section>

        ${resumoRenovacaoHtml(mudanca, planos)}
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Cancelar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>
          <i data-lucide="check"></i> ${mudanca.mudou ? 'Criar cobrança e programar renovação' : 'Criar cobrança'}
        </button>
      </footer>
    </div>`;
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

/**
 * Cobrança do período, com a renovação do próximo ciclo junto.
 *
 * `aoSalvar({ vencimento, valor, proximoPlanoId, proximoValor })` — quem chama
 * manda para a RPC. Plano e valor futuros vão SEMPRE, mesmo iguais aos atuais:
 * é o banco que decide se aquilo é mudança, e mandar só quando a tela achou
 * que mudou criaria duas fontes para a mesma regra.
 *
 * Nada é salvo enquanto o usuário mexe nos campos (§14): trocar o plano só
 * redesenha o resumo e o texto do botão.
 */
export function abrirFormularioCobrancaPeriodo({ assinatura, planos = [], aoSalvar } = {}) {
  let form = cobrancaDoPeriodoVazia(assinatura);
  let salvando = false;

  return abrirDrawer((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formCobrancaPeriodoHtml({ assinatura, planos, form, erros });
      window.renderIcons?.();
      ligar();
      fundo.querySelector('.cm-erro-campo input, .cm-erro-campo select')?.focus();
    };

    const coletar = () => {
      const g = id => fundo.querySelector('#' + id);
      return {
        vencimento: g('cmcpVenc')?.value || '',
        valor: g('cmcpValor')?.value || '',
        proximo_plano_id: g('cmcpPlano')?.value || '',
        proximo_valor: g('cmcpProxValor')?.value || '',
      };
    };

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // TROCAR O PLANO sugere o preço dele. É a única ação que sobrescreve o
      // campo de valor — digitar à mão vence, e o valor manual sobrevive a
      // qualquer redesenho, porque o redesenho lê `form` e nada mais escreve
      // nele. Trocar de plano de novo volta a sugerir, agora do plano novo.
      fundo.querySelector('#cmcpPlano')?.addEventListener('change', () => {
        form = coletar();
        const sugerido = valorSugeridoAoTrocarPlano(form.proximo_plano_id, planos, assinatura);
        if (sugerido !== null) form.proximo_valor = sugerido;
        desenhar();
      });

      // Mexer no valor só redesenha o resumo e o texto do botão. Nada
      // sobrescreve o que foi digitado.
      fundo.querySelector('#cmcpProxValor')?.addEventListener('change', () => {
        form = coletar();
        desenhar();
      });

      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const erros = validarCobrancaDoPeriodo(form);
        if (Object.keys(erros).length) { desenhar(erros); return; }

        salvando = true;
        try {
          await aoSalvar({
            vencimento: form.vencimento,
            valor: moedaParaNumero(form.valor),
            proximoPlanoId: form.proximo_plano_id || null,
            proximoValor: String(form.proximo_valor || '').trim()
              ? moedaParaNumero(form.proximo_valor)
              : null,
          });
          fechar();
        } catch (e) {
          salvando = false;
          console.error('Comercial · cobrança do período:', e);
          desenhar({ vencimento: e?.message || String(e) });
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

// ───────────────────────────────────────────────────────────
// EDITAR ASSINATURA
// ───────────────────────────────────────────────────────────
// ESTA TELA NÃO EXISTIA, e a falta dela apareceu de um jeito torto: seis
// assinaturas estavam sem horário e não havia como preencher. `salvarAssinatura`
// existia em js/comercial-data.js desde a Etapa 2, testada, e nenhuma linha do
// frontend a chamava — depois de criada, uma assinatura só mudava de período, e
// só por pagamento.
//
// O QUE SE EDITA AQUI É CADASTRO, E SÓ. Horário, valor contratado, "cliente
// desde", observações e renovação automática. Nada que mova dinheiro ou tempo.
//
// O QUE FICA DE FORA, E POR QUÊ:
//
//   plano      trocar de plano no meio do período é o que a RENOVAÇÃO
//              PROGRAMADA já resolve — ela grava a intenção e o banco aplica no
//              próximo pagamento, com auditoria. Um `update` aqui trocaria o
//              plano sem tocar no período nem na cobrança em aberto, e as três
//              coisas passariam a discordar entre si.
//
//   período    ele anda por `comercial_registrar_pagamento`, e só. É essa
//              tomada única que garante "um pagamento = uma renovação".
//              Editá-lo à mão criaria a segunda porta.
//
//   cliente    mudar de quem é o contrato não é correção, é outro contrato.
//
// O contexto que não se edita aparece como LEITURA, e não como campo cinza —
// campo desabilitado convida a tentar clicar. Mesma decisão de
// `formEdicaoHtml` em js/comercial-drawer.js.

/** O formulário nasce do que está gravado, não vazio. */
export function edicaoAssinaturaVazia(assinatura = {}) {
  return {
    valor_contratado: paraCampoValor(assinatura.valor_contratado),
    horario: assinatura.horario || '',
    data_inicio_original: assinatura.data_inicio_original || '',
    observacoes: assinatura.observacoes || '',
    renovacao_automatica: assinatura.renovacao_automatica !== false,
  };
}

/**
 * Valida só o que esta tela deixa mexer.
 *
 * `inicio_periodo` entra como REFERÊNCIA para checar "cliente desde": é o mesmo
 * CHECK que a tabela tem (`inicio_periodo >= data_inicio_original`), e errar
 * aqui devolveria um erro cru do Postgres em vez de uma frase.
 */
export function validarEdicaoAssinatura(form = {}, { inicio_periodo = null } = {}) {
  const erros = {};

  if (String(form.valor_contratado || '').trim()) {
    const v = moedaParaNumero(form.valor_contratado);
    if (v == null || v < 0) erros.valor_contratado = 'Valor inválido.';
  }

  if (form.data_inicio_original && inicio_periodo &&
      String(inicio_periodo) < String(form.data_inicio_original)) {
    erros.data_inicio_original =
      'O cliente não pode ter começado depois do período que já está em curso.';
  }

  return erros;
}

/**
 * O que vai para o banco. Só as cinco chaves — mandar o objeto inteiro faria um
 * `update` reescrever período e plano com o que a tela tinha em memória.
 *
 * VALOR EM BRANCO VIRA NULL, e não o preço do plano. Na criação, branco copia o
 * preço vigente; aqui, apagar o campo é dizer "volte a seguir o plano". Copiar
 * o preço de novo congelaria o valor de hoje, que é o oposto do que a pessoa
 * pediu ao apagar.
 */
export function edicaoAssinaturaParaBanco(form = {}) {
  return {
    valor_contratado: String(form.valor_contratado || '').trim()
      ? moedaParaNumero(form.valor_contratado)
      : null,
    horario: String(form.horario || '').trim() || null,
    data_inicio_original: form.data_inicio_original || null,
    observacoes: String(form.observacoes || '').trim() || null,
    renovacao_automatica: form.renovacao_automatica !== false,
  };
}

/**
 * Os turnos que a operação usa. Lista fechada, e é isso que importa.
 *
 * O campo era texto livre com `datalist`. Três problemas, e o terceiro é o que
 * dói:
 *
 *   . no celular ele abre teclado para escolher entre duas opções;
 *   . o `datalist` é sugestão, não trava — aceita qualquer coisa;
 *   . "noturno", "Noturno " e "NOTURNO" viram TRÊS turnos diferentes na
 *     contagem do bônus da folha, e ninguém percebe: a tela mostra três linhas
 *     com números menores, todas parecendo certas.
 *
 * O terceiro é o motivo de a lista ser fechada e não só sugerida.
 */
export const HORARIOS = ['Diurno', 'Noturno'];

/**
 * O seletor de horário: rádios nativos vestidos com os chips do módulo.
 *
 * RÁDIO DE VERDADE, e não `<button>` com `aria-checked`. Botão exigiria
 * reimplementar seta do teclado, agrupamento e anúncio do leitor de tela — e
 * meia implementação disso é pior que nenhuma. Com `<input type="radio">` tudo
 * isso vem de graça e o CSS faz o resto.
 *
 * "SEM HORÁRIO" É UMA OPÇÃO EXPLÍCITA. Sem ela, quem marcasse por engano não
 * teria como desmarcar — e há cliente que legitimamente não tem turno, como
 * quem só faz diária.
 *
 * VALOR DESCONHECIDO VIRA CHIP PRÓPRIO. Se o banco tiver um turno fora da
 * lista — texto livre antigo —, ele aparece marcado em vez de sumir. Abrir a
 * tela não pode apagar em silêncio um dado que ninguém pediu para mudar.
 */
export function chipsHorarioHtml(valor) {
  const atual = String(valor || '').trim();
  const conhecidos = HORARIOS.slice();
  if (atual && !conhecidos.some(h => h.toLowerCase() === atual.toLowerCase())) {
    conhecidos.push(atual);
  }

  const chip = (v, rotulo, marcado) => `
    <label class="cm-chip-op">
      <input type="radio" name="cmEaHorario" value="${esc(v)}"${marcado ? ' checked' : ''}>
      <span class="cm-chip">${esc(rotulo)}</span>
    </label>`;

  return `
    <div class="cm-chips" role="radiogroup" aria-labelledby="cmEaHorarioRot">
      ${conhecidos.map(h => chip(h, h, h.toLowerCase() === atual.toLowerCase())).join('')}
      ${chip('', 'Sem horário', !atual)}
    </div>`;
}

export function formEdicaoAssinaturaHtml({ assinatura = {}, form = {}, erros = {} } = {}) {
  const plano = assinatura.plano || null;
  const periodo = assinatura.inicio_periodo && assinatura.fim_periodo
    ? `${dataBR(assinatura.inicio_periodo)} a ${dataBR(assinatura.fim_periodo)}`
    : '—';

  return `
    <div class="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cmEaTit">
      <header class="cm-drawer-topo">
        <h2 id="cmEaTit">Editar assinatura</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <div class="cm-dw-leitura">
          <div class="cm-dw-linha"><span>Cliente</span><b>${esc(assinatura.paciente?.nome || '—')}</b></div>
          <div class="cm-dw-linha"><span>Plano</span><b>${esc(plano?.nome || '—')}</b></div>
          <div class="cm-dw-linha"><span>Período atual</span><b>${esc(periodo)}</b></div>
        </div>

        <p class="cm-dw-aviso-sutil">
          Plano e período não mudam aqui. Para trocar de plano, use
          <b>Criar cobrança do período</b> — a troca entra na próxima renovação,
          com registro de quem decidiu e quando.
        </p>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls(erros, 'valor_contratado')}">
            <label for="cmEaValor">Valor contratado</label>
            <input id="cmEaValor" type="text" inputmode="decimal" value="${esc(form.valor_contratado)}"
                   placeholder="${plano?.preco_padrao != null ? paraCampoValor(plano.preco_padrao) : '330,00'}">
            ${msg(erros, 'valor_contratado')}
          </div>
          <div class="cm-campo">
            <span class="cm-rot" id="cmEaHorarioRot">Horário</span>
            ${chipsHorarioHtml(form.horario)}
          </div>
        </div>
        <p class="cm-ajuda-campo">
          Em branco, o valor volta a seguir o preço padrão do plano.
          O horário é o que separa os turnos no fechamento da folha.
        </p>

        <div class="cm-campo${cls(erros, 'data_inicio_original')}">
          <label for="cmEaDesde">Cliente desde</label>
          <input id="cmEaDesde" type="date" value="${esc(form.data_inicio_original)}">
          ${msg(erros, 'data_inicio_original')}
        </div>

        <div class="cm-campo">
          <label for="cmEaObs">Observações comerciais</label>
          <textarea id="cmEaObs" rows="2">${esc(form.observacoes)}</textarea>
        </div>
        <p class="cm-ajuda-campo">Separado do prontuário. Nada clínico aqui.</p>

        <label class="cm-check">
          <input id="cmEaRenova" type="checkbox"${form.renovacao_automatica !== false ? ' checked' : ''}>
          <span>Gerar a próxima cobrança automaticamente a cada pagamento</span>
        </label>
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Voltar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>
          <i data-lucide="check"></i> Salvar
        </button>
      </footer>
    </div>`;
}

/**
 * @param assinatura  a linha vigente, com `paciente` e `plano` embutidos
 * @param aoSalvar    recebe o patch já pronto para o banco
 * @param aoVoltar    devolve ao cliente — sair da edição não é sair do cliente
 */
export function abrirEdicaoAssinatura({ assinatura, aoSalvar, aoVoltar } = {}) {
  let form = edicaoAssinaturaVazia(assinatura);
  let salvando = false;

  return abrirDrawer((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formEdicaoAssinaturaHtml({ assinatura, form, erros });
      window.renderIcons?.();
      ligar();
      fundo.querySelector('.cm-erro-campo input')?.focus();
    };

    const coletar = () => {
      const g = id => fundo.querySelector('#' + id);
      return {
        valor_contratado: g('cmEaValor')?.value || '',
        horario: fundo.querySelector('input[name="cmEaHorario"]:checked')?.value || '',
        data_inicio_original: g('cmEaDesde')?.value || '',
        observacoes: g('cmEaObs')?.value || '',
        renovacao_automatica: !!g('cmEaRenova')?.checked,
      };
    };

    function voltar() { fechar(); aoVoltar?.(); }

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', voltar));

      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const erros = validarEdicaoAssinatura(form, assinatura);
        if (Object.keys(erros).length) { desenhar(erros); return; }

        salvando = true;
        try {
          await aoSalvar(edicaoAssinaturaParaBanco(form));
          voltar();
        } catch (e) {
          salvando = false;
          console.error('Comercial · editar assinatura:', e);
          desenhar({ valor_contratado: 'Não consegui salvar: ' + (e?.message || e) });
        }
      });
    }

    desenhar();
  });
}
