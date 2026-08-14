// ═══════════════════════════════════════════════════════════
// COMERCIAL — o drawer do cliente e o registro de pagamento
// ═══════════════════════════════════════════════════════════
// É aqui que o pagamento entra, e é o ponto mais delicado do módulo: um
// pagamento registrado renova o período, e um período renovado errado só é
// descoberto trinta dias depois.
//
// O QUE ESTA TELA NÃO FAZ: criar um segundo sistema de pagamento. A cobrança
// já É um lançamento de receita; registrar o pagamento é marcar esse mesmo
// lançamento como pago. Não há "pagamento do cliente" separado das Receitas, e
// por isso não há como lançar duas vezes.

import {
  situacaoDoCliente, situacaoDaCobranca, SITUACAO_ROTULO, COBRANCA_ROTULO,
  textoDoVencimento, telefoneBonito, telefoneDigitos, saldoDaCobranca,
  renovar, diasEntre,
} from './comercial.js';
import { moeda, dataBR, dePara } from './comercial-ui.js';
import { valorDeTexto, mostrarToast, mostrarErro } from './utils.js';

/**
 * As frases das ações de cobrança, num lugar só.
 *
 * Fora daqui elas viravam variações do mesmo aviso escritas em três handlers
 * diferentes — e "recarregue para ver o estado atual" num lugar e "atualize os
 * dados" noutro fazem o usuário achar que são dois problemas.
 */
export const MSG = {
  criada:      'Cobrança criada.',
  // Duas frases porque são dois fatos: programar a troca do próximo ciclo é
  // decisão maior que criar a cobrança, e o toast é a única confirmação de que
  // ela ficou registrada.
  criadaComRenovacao:   'Cobrança criada e renovação programada.',
  removidaComRenovacao: 'Cobrança removida. A renovação programada foi cancelada junto.',
  atualizada:  'Cobrança atualizada.',
  removida:    'Cobrança removida.',
  naoPendente: 'Esta cobrança não está mais pendente. Atualize os dados e tente novamente.',
  duplicada:   'Já existe uma cobrança ativa para este vencimento.',
  falhou:      'Não foi possível concluir. Tente novamente.',
};

/** Erro do Postgres não é frase de gente. */
export function traduzirErroCobranca(e) {
  const m = String(e?.message || e || '').toLowerCase();
  if (m.includes('uq_comercial_cobranca_periodo') || m.includes('duplicate key')) return MSG.duplicada;
  // A RPC de pagamento devolve `pagou: false` quando a cobrança já não estava
  // pendente, e a camada de dados transforma isso em erro. É a mesma situação
  // que o `null` do caminho antigo — então a mesma frase.
  if (m.includes('nao_pendente')) return MSG.naoPendente;
  if (m.includes('row-level security') || m.includes('violates row-level')) return 'Sem permissão para esta cobrança.';
  if (m.includes('failed to fetch') || m.includes('networkerror')) return 'Sem conexão. Tente novamente.';
  return MSG.falhou;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const FORMAS = [
  ['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['debito', 'Débito'], ['credito', 'Crédito'],
  ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['debito_automatico', 'Débito automático'],
  ['outro', 'Outro'],
];

// ───────────────────────────────────────────────────────────
// MARCAÇÃO DO DRAWER
// ───────────────────────────────────────────────────────────

function secao(titulo, conteudo) {
  return `
    <section class="cm-dw-secao">
      <h3 class="cm-dw-t">${esc(titulo)}</h3>
      ${conteudo}
    </section>`;
}

/**
 * Uma linha de dado: rótulo à esquerda, valor à direita.
 *
 * `sub` é a informação de segunda ordem — "Vencido há 361 dias" debaixo da
 * data. Ela vem em ELEMENTO PRÓPRIO, não concatenada ao valor com um "·", e
 * essa é a diferença que faz a linha caber: no desktop as duas ficam na mesma
 * célula, uma sob a outra, e no celular a coluna inteira desce. Grudadas na
 * mesma frase, elas comprimiam a data justamente quando o texto era maior
 * (que é quando o cliente está mais atrasado).
 *
 * `tom: 'alerta'` pinta a segunda linha de vermelho discreto. Fica no
 * chamador porque quem sabe se é atraso é a regra, não a marcação.
 *
 * `valor` e `sub` entram como HTML — quem chama já escapou o que veio de dado.
 */
function linha(rot, valor, { sub = '', tom = '' } = {}) {
  return `
    <div class="cm-dw-linha">
      <span class="cm-dw-rot">${esc(rot)}</span>
      <span class="cm-dw-val">${valor}${
        sub ? `<span class="cm-dw-sub-val${tom ? ` cm-dw-${tom}` : ''}">${sub}</span>` : ''
      }</span>
    </div>`;
}

/** "Cliente desde 03/08/2024 · 2 anos" — o tempo de casa, que a planilha
 *  perdia a cada renovação por sobrescrever a linha. */
export function tempoDeCasa(desdeISO, hoje) {
  const dias = diasEntre(desdeISO, hoje);
  if (dias === null || dias < 0) return '';
  if (dias < 30) return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return resto ? `${anos}a ${resto}m` : `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

/**
 * O cabeçalho do cliente — identidade em cima, corpo rolando por baixo.
 *
 * A CLASSE `cm-drawer-topo` VOLTOU, e ela é o conserto do bug que causava
 * quase tudo o que se via de errado aqui. Este header saía com `cm-dw-topo`
 * sozinho, e essa classe NÃO EXISTIA no CSS — nenhum `padding`, nenhum
 * `display: flex`, nenhuma borda. Daí o título encostado na quina, o X caindo
 * numa linha só dele e a ausência de separação com o conteúdo. Não era falta
 * de estilo, era estilo escrito para um nome de classe que ninguém usava.
 * Agora ele carrega as duas: a base compartilhada com os outros drawers e a
 * `cm-dw-topo` com o que só o cliente tem.
 *
 * A alça (`cm-dw-alca`) só aparece no celular, onde o painel vira sheet de
 * baixo. Ela é `aria-hidden`: é affordance visual de arrasto, não informação.
 */
export function cabecalhoHtml(a, hoje) {
  const s = situacaoDoCliente(a, hoje);
  const tel = a.paciente?.telefone;
  return `
    <header class="cm-drawer-topo cm-dw-topo">
      <span class="cm-dw-alca" aria-hidden="true"></span>
      <div class="cm-dw-id">
        <h2 id="cmDwTit" class="cm-dw-nome">${esc(a.paciente?.nome || 'Sem nome')}</h2>
        <div class="cm-dw-sub">
          <span class="cm-badge cm-b-${esc(s)}">${esc(SITUACAO_ROTULO[s] || s)}</span>
          <span>${esc(a.plano?.nome || 'Sem plano')}</span>
          ${a.horario ? `<span>${esc(a.horario)}</span>` : ''}
        </div>
        ${tel ? `<a class="cm-dw-tel" href="https://wa.me/${esc(telefoneDigitos(tel))}" target="_blank" rel="noopener">
                   <i data-lucide="message-circle"></i> ${esc(telefoneBonito(tel))}</a>` : ''}
      </div>
      <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
    </header>`;
}

export function assinaturaHtml(a, hoje) {
  const casa = tempoDeCasa(a.data_inicio_original, hoje);
  // Atraso é conta, não dado — os mesmos `diasEntre` que a tela usa em todo
  // lugar. Aqui ele só decide a COR da segunda linha; o texto continua vindo
  // de `textoDoVencimento`, para não existirem duas frases para o mesmo fato.
  const dias = diasEntre(hoje, a.fim_periodo);
  return secao('Assinatura', `
    ${linha('Cliente desde', esc(dataBR(a.data_inicio_original)), { sub: casa ? esc(casa) : '' })}
    ${linha('Período atual', `<span class="cm-dw-periodo">${esc(dataBR(a.inicio_periodo))} → ${esc(dataBR(a.fim_periodo))}</span>`)}
    ${/* "Período termina em", e não "Próximo vencimento". São conceitos
          diferentes que, no ciclo em que a cobrança existe, têm a MESMA data —
          e o rótulo repetido fazia a segunda seção parecer repetição ou dado
          velho. Aqui é `assinatura.fim_periodo`; em "Próxima cobrança",
          "Vencimento" é `financeiro_lancamentos.vencimento`. */''}
    ${linha('Período termina em', esc(dataBR(a.fim_periodo)), {
      sub: esc(textoDoVencimento(a.fim_periodo, hoje)),
      tom: dias !== null && dias < 0 ? 'alerta' : '',
    })}
    ${linha('Plano', esc(a.plano?.nome || '—'))}
    ${linha('Valor contratado', esc(moeda(a.valor_contratado)))}
    ${a.renovacao_automatica ? '' : '<p class="cm-dw-nota">Renovação automática desligada: a próxima cobrança não nasce sozinha.</p>'}
  `);
}

/**
 * A próxima cobrança em aberto, com o botão de registrar pagamento.
 *
 * Se ela já estiver paga, o botão SOME e o lugar dele conta quando foi pago.
 * É o §13: uma cobrança paga não pode aceitar um segundo pagamento sem que
 * fique evidente que ela já tem um.
 */
export function cobrancaAbertaHtml(cobranca, hoje) {
  if (!cobranca) {
    // Continua SECUNDÁRIA (`cm-btn`, não `cm-btn-forte`): criar cobrança é
    // preparar trabalho, não concluir. Verde aqui competiria com "Registrar
    // pagamento", que é a ação que a tela quer induzir.
    return secao('Próxima cobrança', `
      <p class="cm-dw-nota">Nenhuma cobrança em aberto.</p>
      <div class="cm-dw-acoes">
        <button class="cm-btn" type="button" data-criar-cobranca>
          <i data-lucide="plus"></i> Criar cobrança do período
        </button>
      </div>`);
  }

  const st = situacaoDaCobranca(cobranca, hoje);
  const { valor, pago, saldo, parcial } = saldoDaCobranca(cobranca);

  if (st === 'pago') {
    return secao('Próxima cobrança', `
      <div class="cm-dw-aviso">
        <i data-lucide="circle-check-big"></i>
        <div>
          <b>Esta cobrança já possui um pagamento registrado.</b>
          <div>Pago em ${esc(dataBR(cobranca.pago_em))} · ${esc(moeda(pago))}</div>
        </div>
      </div>
      <div class="cm-dw-acoes">
        <button class="cm-btn" type="button" data-ver-receita="${esc(cobranca.id)}">
          <i data-lucide="external-link"></i> Ver receita
        </button>
      </div>`);
  }

  return secao('Próxima cobrança', `
    ${linha('Vencimento', esc(dataBR(cobranca.vencimento)), {
      sub: esc(textoDoVencimento(cobranca.vencimento, hoje)),
      tom: st === 'vencida' ? 'alerta' : '',
    })}
    ${linha('Valor', esc(moeda(valor)))}
    ${parcial ? linha('Já pago', esc(moeda(pago)), { sub: `falta ${esc(moeda(saldo))}` }) : ''}
    ${linha('Situação', `<span class="cm-badge cm-c-${esc(st)}">${esc(COBRANCA_ROTULO[st] || st)}</span>`)}
    <div class="cm-dw-acoes">
      <button class="cm-btn cm-btn-forte" type="button" data-registrar="${esc(cobranca.id)}">
        <i data-lucide="circle-dollar-sign"></i> Registrar pagamento
      </button>
      <button class="cm-btn cm-btn-sutil" type="button" data-cancelar-cobranca="${esc(cobranca.id)}">
        <i data-lucide="x"></i> Remover cobrança
      </button>
    </div>`);
}

const MES_EXT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** "Agosto/2026" — o PERÍODO da cobrança, que é o que o cliente reconhece. */
export function competenciaExtenso(iso) {
  const s = String(iso || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(s)) return '';
  const [ano, mes] = s.split('-');
  return `${MES_EXT[Number(mes) - 1]}/${ano}`;
}

/** "Vencida há 37 dias" / "Vence em 5 dias" — só para quem ainda não pagou. */
export function atrasoEmDias(cobranca, hoje) {
  if (!cobranca || cobranca.status !== 'pendente') return null;
  const d = diasEntre(hoje, cobranca.vencimento);
  if (d === null) return null;
  if (d < 0) return { dias: -d, vencida: true };
  return { dias: d, vencida: false };
}

/**
 * Uma linha do histórico, com as ações que o STATUS permite.
 *
 * O que decide as ações é o status REAL, não o rótulo: "Vencida" é situação
 * derivada da data sobre uma linha `pendente`, então ela aceita exatamente as
 * mesmas ações que uma pendente do mês que vem. Amarrar ação a rótulo faria a
 * mesma cobrança mudar de comportamento à meia-noite do vencimento.
 */
/** O rótulo da forma de pagamento, a partir do mesmo catálogo do formulário. */
export const formaRotulo = (f) => (FORMAS.find(([id]) => id === f) || [])[1] || null;

export function historicoItemHtml(c, hoje) {
  const st = situacaoDaCobranca(c, hoje);
  const { pago } = saldoDaCobranca(c);
  const atraso = atrasoEmDias(c, hoje);
  const editavel = c.status === 'pendente';   // pendente e vencida são a mesma linha

  // Pesos diferentes de propósito: a ação que a tela quer induzir é receber.
  // Três botões iguais fariam "Remover" ter o mesmo convite que "Registrar
  // pagamento", e o clique errado aqui tira dinheiro do "a receber".
  const acoes = editavel ? `
      <button class="cm-btn cm-btn-mini cm-btn-forte" type="button" data-registrar="${esc(c.id)}">
        Registrar pagamento
      </button>
      <button class="cm-btn cm-btn-mini" type="button" data-editar-cobranca="${esc(c.id)}">
        Editar
      </button>
      <button class="cm-btn cm-btn-mini cm-btn-sutil" type="button" data-cancelar-cobranca="${esc(c.id)}">
        Remover
      </button>`
    : c.status === 'pago' ? `
      <button class="cm-btn cm-btn-mini" type="button" data-ver-receita="${esc(c.id)}">
        Ver receita
      </button>`
    : '';   // cancelada não tem ação financeira nenhuma

  // A hierarquia da linha: competência → valor → vencimento → situação.
  // O período vem primeiro porque é como o cliente chama a cobrança
  // ("a de agosto"); a data solta só faz sentido depois de saber de qual mês.
  const forma = c.pago_em ? formaRotulo(c.forma_pagamento) : null;
  const detalhePago = c.pago_em
    ? `Paga em ${dataBR(c.pago_em)}${forma ? ` · ${forma}` : ''} · ${moeda(pago)}`
    : null;

  return `
    <li class="cm-dw-hist ${c.status === 'cancelado' ? 'cm-dw-hist-cancelada' : ''}">
      <div class="cm-dw-hist-id">
        <span class="cm-dw-hist-comp">${esc(competenciaExtenso(c.competencia || c.vencimento))}</span>
        <span class="cm-dw-hist-valor">${esc(moeda(c.valor))}</span>
      </div>
      <div class="cm-dw-hist-venc">Vencimento ${esc(dataBR(c.vencimento))}</div>
      <div class="cm-dw-hist-meta">
        <span class="cm-badge cm-c-${esc(st)}">${esc(COBRANCA_ROTULO[st] || st)}</span>
        ${atraso?.vencida ? `<span class="cm-dw-hist-atraso">há ${atraso.dias} ${atraso.dias === 1 ? 'dia' : 'dias'}</span>` : ''}
        ${detalhePago ? `<span>${esc(detalhePago)}</span>` : ''}
      </div>
      ${acoes ? `<div class="cm-dw-hist-acoes">${acoes}</div>` : ''}
    </li>`;
}

/**
 * O histórico é o que permite calcular recorrência, inadimplência e ticket
 * médio. Nada aqui é sobrescrito na renovação — foi por sobrescrever que a
 * planilha ficou sem passado.
 *
 * Cancelada não some do banco, some da LISTA OPERACIONAL: ela não é trabalho
 * a fazer. Continua a um clique de distância, porque "não operacional" e
 * "não existiu" são coisas diferentes, e auditoria vive da segunda.
 */
export function historicoHtml(cobrancas = [], hoje, { mostrarCanceladas = false } = {}) {
  // Ordena aqui em vez de confiar em quem chamou: `cobrancasDaAssinatura` já
  // devolve por vencimento desc, mas o histórico não pode depender disso —
  // uma consulta futura sem `order` deixaria a lista embaralhada em silêncio.
  const ordenadas = [...cobrancas].sort((a, b) =>
    String(b.vencimento || '').localeCompare(String(a.vencimento || '')));
  const canceladas = ordenadas.filter(c => c.status === 'cancelado');
  const operacionais = ordenadas.filter(c => c.status !== 'cancelado');

  const alternar = canceladas.length ? `
    <button class="cm-link-sutil" type="button" data-ver-canceladas aria-pressed="${mostrarCanceladas}">
      ${mostrarCanceladas ? 'Ocultar canceladas' : `Ver canceladas (${canceladas.length})`}
    </button>` : '';

  if (!operacionais.length && !(mostrarCanceladas && canceladas.length)) {
    return secao('Histórico', `
      <p class="cm-dw-nota">${canceladas.length
        ? 'Nenhuma cobrança ativa. Há registros cancelados no histórico.'
        : 'Ainda não há cobranças registradas.'}</p>
      ${alternar}`);
  }

  const lista = mostrarCanceladas ? ordenadas : operacionais;
  return secao('Histórico', `
    <ul class="cm-dw-hists">${lista.map(c => historicoItemHtml(c, hoje)).join('')}</ul>
    ${alternar}`);
}

export function observacoesHtml(a) {
  if (!a.observacoes) return '';
  return secao('Observações comerciais', `<p class="cm-dw-obs">${esc(a.observacoes)}</p>`);
}

export function drawerHtml({ assinatura, cobrancas = [], hoje, mostrarCanceladas = false, planos = [] }) {
  const aberta = cobrancas.find(c => c.status === 'pendente') ||
                 cobrancas.find(c => c.status === 'pago' && c.vencimento === assinatura.fim_periodo) || null;
  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-labelledby="cmDwTit">
      ${cabecalhoHtml(assinatura, hoje)}
      <div class="cm-drawer-corpo">
        ${assinaturaHtml(assinatura, hoje)}
        ${renovacaoProgramadaHtml(assinatura, planos)}
        ${cobrancaAbertaHtml(aberta, hoje)}
        ${observacoesHtml(assinatura)}
        ${historicoHtml(cobrancas, hoje, { mostrarCanceladas })}
      </div>
    </div>`;
}

/**
 * O texto da confirmação de remoção. Fora do handler para o teste poder
 * conferir a frase sem levantar DOM — e porque ela é a última coisa que o
 * profissional lê antes de tirar dinheiro do "a receber".
 */
/**
 * A frase da confirmação de remoção.
 *
 * TRÊS ESTADOS, não dois. A versão anterior tratava "não há renovação" e "não
 * sei se há" como a mesma coisa, e por isso falhava em SILÊNCIO: bastava o
 * drawer ter sido aberto a partir do cache da lista para o aviso da troca de
 * plano sumir, sem nada indicando que faltava informação.
 *
 *   renovacao_origem_id == esta cobrança  -> avisa a troca, nomeando os planos
 *   `conferido` e sem renovação            -> a frase genérica de sempre
 *   não `conferido`                        -> diz que NÃO SABE
 *
 * `conferido` é quem chama afirmando que acabou de ler a assinatura do banco.
 * Sem essa afirmação, a tela não pode concluir "sem renovação" — e o banco vai
 * cancelar a troca de qualquer forma, porque a RPC decide pelo
 * `renovacao_origem_id` real. Calar sobre isso seria mentir sobre uma
 * consequência que acontece.
 */
export function textoRemocao(cobranca, hoje, { assinatura = null, planos = [], conferido = false } = {}) {
  const atraso = atrasoEmDias(cobranca, hoje);
  const linhas = [
    `Remover a cobrança de ${competenciaExtenso(cobranca.competencia || cobranca.vencimento)}?`,
    '',
    moeda(cobranca.valor),
    `Vencimento em ${dataBR(cobranca.vencimento)}`,
  ];
  if (atraso?.vencida) linhas.push(`Vencida há ${atraso.dias} ${atraso.dias === 1 ? 'dia' : 'dias'}`);

  const ligada = !!assinatura?.renovacao_origem_id &&
                 assinatura.renovacao_origem_id === cobranca.id;

  if (ligada) {
    // Foi esta cobrança que programou a renovação, e o banco vai limpar as
    // duas coisas na mesma transação. Descobrir depois que a troca de plano
    // sumiu junto seria a pior forma de aprender a regra.
    const nomeDe = id => planos.find(p => p.id === id)?.nome || 'outro plano';
    const de = nomeDe(assinatura.plano_id);
    const para = nomeDe(assinatura.proximo_plano_id);
    linhas.push('', `Esta cobrança também programa a troca de ${de} para ${para} na próxima renovação. Removê-la cancela a troca.`);
  } else if (!conferido) {
    linhas.push('', 'Não foi possível confirmar com o servidor se esta cobrança programa uma troca de plano. Se programar, ela será cancelada junto.');
  }

  linhas.push('', 'A cobrança será cancelada e deixará de fazer parte do valor a receber. O histórico será preservado.');
  return linhas.join('\n');
}

/**
 * A renovação programada, quando existe — o "o que entra no próximo ciclo".
 *
 * Fica numa seção própria e não dentro de Assinatura de propósito: misturar as
 * duas na mesma lista é exatamente a confusão que a Solução D existe para
 * desfazer. O que está ali em cima é o vigente; isto aqui é o futuro.
 */
export function renovacaoProgramadaHtml(a, planos = []) {
  if (!a?.proximo_plano_id) return '';
  const nomeDe = id => planos.find(p => p.id === id)?.nome || '—';
  const trocaPlano = a.proximo_plano_id !== a.plano_id;
  const trocaValor = a.proximo_valor_contratado != null &&
    Number(a.proximo_valor_contratado) !== Number(a.valor_contratado);

  return secao('Próxima renovação', `
    ${trocaPlano ? linha('Plano', dePara(esc(nomeDe(a.plano_id)), esc(nomeDe(a.proximo_plano_id)))) : ''}
    ${trocaValor ? linha('Valor contratado', dePara(esc(moeda(a.valor_contratado)), esc(moeda(a.proximo_valor_contratado)))) : ''}
    ${linha('Definida em', esc(dataBR(String(a.renovacao_definida_em || '').slice(0, 10))))}
    <p class="cm-dw-nota">
      Entra em vigor quando a cobrança deste período for paga. Até lá, o período
      atual continua no plano e no valor de hoje.
    </p>
  `);
}

// ───────────────────────────────────────────────────────────
// REGISTRO DE PAGAMENTO
// ───────────────────────────────────────────────────────────

export function pagamentoVazio(cobranca) {
  return {
    pago_em: hojeISO(),
    valor_pago: cobranca?.valor == null ? '' : Number(cobranca.valor).toFixed(2).replace('.', ','),
    forma_pagamento: 'pix',
  };
}

export function validarPagamento(form = {}, cobranca = null) {
  const erros = {};
  if (!form.pago_em) erros.pago_em = 'Informe a data do pagamento.';

  const v = String(form.valor_pago || '').trim() ? valorDeTexto(form.valor_pago) : null;
  if (v == null || !(v > 0)) erros.valor_pago = 'Informe quanto foi recebido.';

  // Receber MENOS que o cobrado não é quitação. Pagamento parcial está
  // modelado (valor_pago) mas não implementado, então aqui a gente barra em
  // vez de tratar R$ 200 como se quitasse R$ 350.
  if (v != null && cobranca?.valor != null && v < Number(cobranca.valor)) {
    erros.valor_pago = `Valor menor que a cobrança (${moeda(cobranca.valor)}). Pagamento parcial ainda não está disponível.`;
  }

  if (!FORMAS.some(([id]) => id === form.forma_pagamento)) erros.forma_pagamento = 'Escolha a forma de pagamento.';

  return erros;
}

/**
 * O que a renovação vai fazer, mostrado ANTES de salvar.
 *
 * ELA PREVÊ O QUE A RPC VAI FAZER, e por isso resolve o PLANO QUE ENTRA
 * exatamente como `comercial_registrar_pagamento` resolve:
 *
 *   com renovação programada -> `proximo_plano_id` e `proximo_valor_contratado`
 *   sem                       -> o plano e o valor vigentes
 *
 * Até 13/08/2026 ela olhava só `assinatura.plano`. No primeiro pagamento real
 * com troca programada — CASO_TROCA_DE_PLANO, Mensal - 3x para Trimestral - 3x — a tela
 * previu 12/09 (30 dias do plano velho) e o banco gravou 11/11 (90 dias do
 * plano novo). O banco estava certo; a tela mentia no exato momento em que o
 * profissional aperta "Confirmar".
 *
 * `planos` é necessário porque o plano futuro NÃO vem embutido na assinatura:
 * o embed traz só `plano_id`. Sem a lista, não há como saber a duração dele.
 * Sem lista, cai no vigente — que é o comportamento de antes, e nunca pior.
 *
 * PARIDADE COM O SQL. Esta função e a RPC são duas implementações da mesma
 * regra, e é dívida conhecida. `test/comercial-drawer.test.mjs` tem um grupo
 * de paridade que compara as duas contra os mesmos casos: mudar uma sem a
 * outra derruba o teste.
 */
export function previaDaRenovacao(assinatura, pagoEm, planos = []) {
  if (!assinatura || !pagoEm) return null;

  const temProgramada = !!assinatura.proximo_plano_id;
  const planoFuturo = temProgramada
    ? (planos.find(p => p.id === assinatura.proximo_plano_id) || null)
    : null;

  // O plano que ENTRA. Com programação sem o plano na lista, seguir com o
  // vigente daria uma previsão errada com cara de certa — melhor devolver o
  // que se sabe e marcar que a previsão está incompleta.
  const plano = planoFuturo || assinatura.plano || {};

  // Nem o futuro nem o vigente resolveram: sem plano não há duração nem
  // tolerância, e `PLANO_PADRAO` inventaria 30 dias e 5 de tolerância com cara
  // de regra. Duração inventada é pior que previsão recusada.
  const semPlano = plano.duracao_valor == null;
  const novo = renovar({ fimVigente: assinatura.fim_periodo, dataPagamento: pagoEm, plano });
  if (!novo) return null;

  const atraso = diasEntre(assinatura.fim_periodo, pagoEm);
  const tol = plano.tolerancia_dias ?? 5;

  // Mesmo `coalesce` da RPC: valor futuro em branco quer dizer "não mexi no
  // preço", e aí vale o vigente.
  const valorNovo = temProgramada
    ? (assinatura.proximo_valor_contratado ?? assinatura.valor_contratado)
    : assinatura.valor_contratado;

  return {
    ...novo,
    atraso,
    forada: atraso > tol,
    tolerancia: tol,
    plano,
    planoNome: plano?.nome ?? null,
    planoAtualNome: assinatura.plano?.nome ?? null,
    trocaPlano: temProgramada && assinatura.proximo_plano_id !== assinatura.plano_id,
    valorNovo,
    valorAtual: assinatura.valor_contratado,
    trocaValor: temProgramada && Number(valorNovo) !== Number(assinatura.valor_contratado),
    // A tela precisa saber que não conseguiu resolver o plano, para não
    // apresentar como previsão firme o que é chute. Duas causas: a programação
    // aponta para um plano que não veio na lista, ou a assinatura não tem
    // plano nenhum.
    incompleta: (temProgramada && !planoFuturo) || semPlano,
    semPlano,
  };
}

export function formPagamentoHtml({ cobranca, assinatura, form = {}, erros = {}, hoje, planos = [] }) {
  const previa = previaDaRenovacao(assinatura, form.pago_em, planos);
  const cls = c => (erros[c] ? ' cm-erro-campo' : '');
  const msg = c => (erros[c] ? `<div class="cm-erro-msg">${esc(erros[c])}</div>` : '');

  return `
    <div class="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cmPgTit">
      <header class="cm-drawer-topo">
        <h2 id="cmPgTit">Registrar pagamento</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </header>

      <div class="cm-drawer-corpo">
        <div class="cm-dw-resumo">
          <div><b>${esc(assinatura.paciente?.nome || '')}</b></div>
          <div>${esc(assinatura.plano?.nome || '')} · vence ${esc(dataBR(cobranca.vencimento))} · ${esc(moeda(cobranca.valor))}</div>
        </div>

        <div class="cm-linha-campos">
          <div class="cm-campo${cls('pago_em')}">
            <label for="cmgData">Data do pagamento</label>
            <input id="cmgData" type="date" value="${esc(form.pago_em)}">
            ${msg('pago_em')}
          </div>
          <div class="cm-campo${cls('valor_pago')}">
            <label for="cmgValor">Valor recebido</label>
            <input id="cmgValor" type="text" inputmode="decimal" value="${esc(form.valor_pago)}">
            ${msg('valor_pago')}
          </div>
        </div>

        <div class="cm-campo${cls('forma_pagamento')}">
          <label for="cmgForma">Forma de pagamento</label>
          <select id="cmgForma">
            ${FORMAS.map(([id, rot]) => `<option value="${id}"${id === form.forma_pagamento ? ' selected' : ''}>${esc(rot)}</option>`).join('')}
          </select>
          ${msg('forma_pagamento')}
        </div>

        ${previa ? `
        <div class="cm-dw-previa" data-previa>
          <div class="cm-dw-previa-t">O que vai acontecer</div>
          <ul>
            <li>A cobrança fica <b>paga</b> em ${esc(dataBR(form.pago_em))}.</li>
            ${previa.trocaPlano
              ? `<li>O plano passa de ${esc(previa.planoAtualNome || '—')} para <b>${esc(previa.planoNome || '—')}</b>, como foi programado.</li>`
              : ''}
            ${previa.trocaValor
              ? `<li>O valor contratado passa de ${esc(moeda(previa.valorAtual))} para <b>${esc(moeda(previa.valorNovo))}</b>.</li>`
              : ''}
            <li>O período passa a ser <b>${esc(dataBR(previa.inicio_periodo))} → ${esc(dataBR(previa.fim_periodo))}</b>${
              previa.trocaPlano ? ` — ${esc(String(previa.plano?.duracao_valor ?? ''))} ${esc(previa.plano?.duracao_unidade === 'mes' ? 'meses' : 'dias')} do plano novo` : ''
            }.</li>
            ${previa.forada
              ? `<li class="cm-dw-alerta">Pagamento ${previa.atraso} dias após o vencimento — passou da tolerância de ${previa.tolerancia}. O período conta da data do pagamento.</li>`
              : (previa.atraso > 0
                  ? `<li>Atraso de ${previa.atraso} ${previa.atraso === 1 ? 'dia' : 'dias'}, dentro da tolerância de ${previa.tolerancia}: o período continua do término anterior.</li>`
                  : '<li>Pagamento antecipado: o período continua do término anterior, sem encurtar.</li>')}
            ${assinatura.renovacao_automatica ? '<li>A próxima cobrança é criada automaticamente.</li>' : ''}
            ${previa.incompleta
              ? '<li class="cm-dw-alerta">Há uma troca de plano programada que esta tela não conseguiu carregar. O período mostrado pode não ser o que será gravado — recarregue antes de confirmar.</li>'
              : ''}
          </ul>
        </div>` : ''}

        <p class="cm-ajuda-campo">
          Isto grava <b>um</b> lançamento de receita no Financeiro — o mesmo que já
          é esta cobrança. Não há um segundo lugar para registrar.
        </p>
      </div>

      <footer class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Cancelar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-confirmar>
          <i data-lucide="check"></i> Confirmar pagamento
        </button>
      </footer>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// MONTAGEM
// ───────────────────────────────────────────────────────────

let _aberto = false;

function raiz(desenhar) {
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

  try { desenhar(fundo, fechar); }
  catch (e) { fechar(); console.error('Comercial · drawer:', e); mostrarErro('Não foi possível abrir. Tente novamente.'); }
  return { fundo, fechar };
}

/** Abre o drawer do cliente. `aoMudar()` avisa a tela para recarregar. */
export async function abrirDrawerCliente({ assinatura, aoMudar }) {
  const dados = await import('./comercial-data.js');
  const hoje = hojeISO();
  let cobrancas = [];
  try { cobrancas = await dados.cobrancasDaAssinatura(assinatura.id); }
  catch (e) { console.error('Comercial · histórico:', e); }

  // Os planos entram aqui porque três coisas precisam deles: o select da
  // cobrança do período, o nome do plano futuro na seção de renovação e o
  // aviso da remoção. Buscá-los três vezes seria ida à rede para o mesmo
  // catálogo — e falhar a busca não pode impedir de abrir o cliente.
  let planos = [];
  try { planos = await dados.listarPlanos(); }
  catch (e) { console.error('Comercial · planos:', e); }

  // Só de exibição: alternar não vai ao banco, porque `cobrancasDaAssinatura`
  // já traz as canceladas junto. Filtrar no cliente é o certo aqui — são
  // poucas linhas por assinatura, e uma segunda consulta para esconder/mostrar
  // o que já está em memória seria ida à rede para nada.
  let mostrarCanceladas = false;

  /**
   * A ÚNICA porta para reler a assinatura do banco.
   *
   * Devolve `true` quando conseguiu conferir, e `false` quando não — e essa
   * diferença é a regra: campo ausente NÃO é ausência de renovação programada.
   * Quem decide alguma coisa a partir do estado da assinatura precisa saber se
   * está olhando o banco ou um objeto que pode ter vindo do cache da lista.
   *
   * O objeto que chega a `abrirDrawerCliente` vem de `_dados.assinaturas` em
   * js/comercial-ui.js, que só é recarregado por `initComercialUI`. Em
   * 13/08/2026 isso deixou a confirmação de remoção sem o aviso da troca de
   * plano: a lista estava parada no estado anterior à criação da cobrança.
   */
  async function lerAssinatura() {
    try {
      const nova = await dados.assinaturaDoPaciente(assinatura.paciente_id);
      if (nova) { assinatura = nova; return true; }
      return false;
    } catch (e) {
      console.error('Comercial · assinatura:', e);
      return false;
    }
  }

  // Ao ABRIR já relê: o drawer inteiro — a seção "Próxima renovação", o aviso
  // da remoção, a prévia do pagamento — passa a falar do estado do banco, e
  // não do retrato que a lista tinha quando foi montada.
  await lerAssinatura();

  return raiz((fundo, fechar) => {
    const desenhar = () => {
      fundo.innerHTML = drawerHtml({ assinatura, cobrancas, hoje, mostrarCanceladas, planos });
      window.renderIcons?.();
      ligar();
    };

    /**
     * Recarrega sem fechar o drawer.
     *
     * `confirmada` é a assinatura que a RPC acabou de devolver. Quando ela
     * vem, é a fonte: já é o estado que o banco gravou, e uma consulta a mais
     * só serviria para reperguntar o que já foi respondido.
     *
     * O MERGE preserva `paciente` e `plano`, que são embeds do PostgREST e
     * não vêm no retorno da RPC — ela devolve a LINHA, não a consulta. Sem o
     * merge, o cabeçalho ficaria sem nome de cliente.
     *
     * Sem `confirmada`, relê — é o caminho de quem mudou algo por fora.
     */
    async function recarregar(confirmada = null) {
      try { cobrancas = await dados.cobrancasDaAssinatura(assinatura.id); }
      catch (e) { console.error('Comercial · histórico:', e); }

      if (confirmada) assinatura = { ...assinatura, ...confirmada };
      else await lerAssinatura();
      desenhar();
      aoMudar?.();
    }

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // querySelectorAll, não querySelector: agora cada linha do histórico tem
      // as próprias ações, e não só a cobrança do topo.
      fundo.querySelectorAll('[data-registrar]').forEach(b =>
        b.addEventListener('click', () => {
          const cob = cobrancas.find(c => c.id === b.dataset.registrar);
          if (!cob) return;
          fechar();
          abrirRegistroPagamento({ assinatura, cobranca: cob, aoMudar, planos });
        }));

      // ABRE O FORMULÁRIO, não cria. O clique único assumia que o cliente
      // seguiria no mesmo plano — e na renovação ele pode trocar de plano, de
      // frequência ou de preço. Quem decide isso é quem está olhando o
      // cliente, não o código.
      //
      // Fecha antes porque `raiz()` só permite um drawer por vez. `aoVoltar`
      // devolve ao cliente: sair da cobrança não pode significar sair de quem
      // se estava olhando.
      fundo.querySelector('[data-criar-cobranca]')?.addEventListener('click', async () => {
        const { abrirFormularioCobrancaPeriodo } = await import('./comercial-formularios.js');
        fechar();
        abrirFormularioCobrancaPeriodo({
          assinatura,
          planos,
          aoSalvar: async ({ vencimento, valor, proximoPlanoId, proximoValor }) => {
            try {
              const r = await dados.criarCobrancaDoPeriodo({
                assinaturaId: assinatura.id,
                vencimento, valor, proximoPlanoId, proximoValor,
              });
              mostrarToast(r?.programou ? MSG.criadaComRenovacao : MSG.criada);
              // A LISTA ATRÁS TAMBÉM PRECISA SABER. `aoMudar` é o que recarrega
              // `_dados.assinaturas` em js/comercial-ui.js; sem ela o cache fica
              // no estado anterior à criação, e um drawer reaberto pela lista
              // volta sem os campos da renovação programada. Foi assim que a
              // confirmação de remoção perdeu o aviso da troca de plano.
              aoMudar?.();
              // REABRE COM O QUE O BANCO CONFIRMOU, não com a cópia que estava
              // em memória antes da ação. Reabrindo com a velha, a seção
              // "Próxima renovação" só aparecia depois de fechar e abrir o
              // cliente — a confirmação da decisão mais importante da tela
              // ficava invisível justamente na hora de tomá-la.
              abrirDrawerCliente({
                assinatura: r?.assinatura ? { ...assinatura, ...r.assinatura } : assinatura,
                aoMudar,
              });
            } catch (e) {
              console.error('Comercial · criar cobrança:', e);
              // O caso comum aqui é o índice único: já existe cobrança viva
              // para aquele vencimento. Sobe para o formulário mostrar no
              // campo, em vez de fechar tudo e perder o que foi digitado.
              throw new Error(traduzirErroCobranca(e));
            }
          },
        });
      });

      // Remover = cancelar. O período volta a ficar livre (o índice único
      // ignora canceladas), então a tela volta a oferecer criar a cobrança
      // certa no lugar. Vale para a cobrança do topo e para qualquer pendente
      // antiga do histórico: quem decide é o status, não a idade da linha.
      fundo.querySelectorAll('[data-cancelar-cobranca]').forEach(btn =>
        btn.addEventListener('click', async () => {
          const cob = cobrancas.find(c => c.id === btn.dataset.cancelarCobranca);
          if (!cob) return;

          // CONFERE O BANCO ANTES DE PERGUNTAR. A frase da confirmação é a
          // última coisa que o profissional lê antes de cancelar uma troca de
          // plano combinada com o cliente — ela não pode sair de um objeto que
          // pode estar velho. `conferido` diz ao texto se ele PODE afirmar que
          // não há renovação, ou se só não sabe.
          const conferido = await lerAssinatura();
          if (!confirm(textoRemocao(cob, hoje, { assinatura, planos, conferido }))) return;

          btn.disabled = true;
          try {
            const r = await dados.cancelarCobrancaDetalhado(cob.id);
            // `cancelou: false` = o banco não achou a linha PENDENTE. Quase
            // sempre porque ela foi paga ou removida em outra aba — não é
            // erro, mas a tela está velha e insistir seria mentir sobre o que
            // aconteceu.
            if (!r?.cancelou) mostrarErro(MSG.naoPendente);
            else mostrarToast(r.limpou_renovacao ? MSG.removidaComRenovacao : MSG.removida);
            // A RPC devolve a assinatura já sem a renovação programada: a
            // seção "Próxima renovação" some no mesmo redesenho, sem F5.
            // O drawer CONTINUA aberto: histórico, cobrança do topo e total a
            // receber saem do dado recarregado. Fechar obrigaria a reabrir o
            // cliente para ver o efeito do próprio clique.
            await recarregar(r?.assinatura || null);
          } catch (e) {
            console.error('Comercial · cancelar cobrança:', e);
            mostrarErro(traduzirErroCobranca(e));
            btn.disabled = false;
          }
        }));

      // A edição é outro drawer, e `raiz()` só permite um por vez — por isso
      // este fecha antes. `aoVoltar` é o que devolve o usuário para cá, já
      // recarregado: sair da edição não pode significar sair do cliente.
      fundo.querySelectorAll('[data-editar-cobranca]').forEach(btn =>
        btn.addEventListener('click', () => {
          const cob = cobrancas.find(c => c.id === btn.dataset.editarCobranca);
          if (!cob) return;
          fechar();
          abrirEdicaoCobranca({
            assinatura, cobranca: cob, aoMudar,
            aoVoltar: () => abrirDrawerCliente({ assinatura, aoMudar }),
          });
        }));

      fundo.querySelector('[data-ver-canceladas]')?.addEventListener('click', () => {
        mostrarCanceladas = !mostrarCanceladas;
        desenhar();
      });

      fundo.querySelectorAll('[data-ver-receita]').forEach(b =>
        b.addEventListener('click', () => {
          // O lançamento vive no Financeiro; a navegação é do painel.
          fundo.dispatchEvent(new CustomEvent('comercial:ver-receita', {
            bubbles: true, detail: { lancamentoId: b.dataset.verReceita },
          }));
        }));
    }

    desenhar();
  });
}

// ───────────────────────────────────────────────────────────
// EDITAR COBRANÇA
// ───────────────────────────────────────────────────────────

export function edicaoVazia(cobranca) {
  return {
    valor: cobranca?.valor == null ? '' : Number(cobranca.valor).toFixed(2).replace('.', ','),
    vencimento: String(cobranca?.vencimento || '').slice(0, 10),
    observacoes: cobranca?.observacoes || '',
  };
}

/** As regras do formulário, sem DOM — é o que o teste exercita. */
export function validarEdicao(form = {}) {
  const erros = {};
  const valor = valorDeTexto(form.valor);
  if (!(valor > 0)) erros.valor = 'Informe um valor maior que zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.vencimento || ''))) {
    erros.vencimento = 'Informe o vencimento.';
  }
  return { ok: !Object.keys(erros).length, erros, valor };
}

export function formEdicaoHtml({ cobranca, assinatura, form, erros = {}, hoje }) {
  const comp = competenciaExtenso(cobranca.competencia || cobranca.vencimento);
  const vencida = atrasoEmDias(cobranca, hoje)?.vencida;

  return `
    <div class="cm-drawer cm-dw" role="dialog" aria-modal="true" aria-label="Editar cobrança">
      <div class="cm-drawer-topo">
        <h2>Editar cobrança</h2>
        <button class="cm-drawer-x" type="button" data-fechar aria-label="Fechar"><i data-lucide="x"></i></button>
      </div>
      <div class="cm-drawer-corpo">
        <!-- O contexto vem como LEITURA, não como campo desabilitado: campo
             cinza convida a tentar clicar. Mudar o dono ou o período de uma
             cobrança não é correção, é outra cobrança — então eles nem se
             apresentam como coisa editável. -->
        <div class="cm-dw-leitura">
          ${linha('Cliente', esc(assinatura?.paciente?.nome || '—'))}
          ${linha('Plano', esc(assinatura?.plano?.nome || '—'))}
          ${linha('Competência', esc(comp))}
        </div>

        ${vencida ? `
        <p class="cm-dw-aviso-sutil">
          Esta cobrança está vencida. Ao alterar o vencimento, a situação será
          recalculada automaticamente.
        </p>` : ''}

        <div class="cm-campo${erros.valor ? ' cm-erro-campo' : ''}">
          <label for="cmEdValor">Valor</label>
          <input id="cmEdValor" type="text" inputmode="decimal" value="${esc(form.valor)}">
          ${erros.valor ? `<span class="cm-erro">${esc(erros.valor)}</span>` : ''}
        </div>
        <div class="cm-campo${erros.vencimento ? ' cm-erro-campo' : ''}">
          <label for="cmEdVenc">Vencimento</label>
          <input id="cmEdVenc" type="date" value="${esc(form.vencimento)}">
          ${erros.vencimento ? `<span class="cm-erro">${esc(erros.vencimento)}</span>` : ''}
        </div>
        <div class="cm-campo">
          <label for="cmEdObs">Observação</label>
          <textarea id="cmEdObs" rows="3">${esc(form.observacoes)}</textarea>
        </div>
      </div>
      <div class="cm-drawer-pe">
        <button class="cm-btn" type="button" data-fechar>Voltar</button>
        <button class="cm-btn cm-btn-forte" type="button" data-salvar>Salvar</button>
      </div>
    </div>`;
}

/**
 * Edita valor, vencimento e observação — só de cobrança em aberto.
 *
 * Atualiza o MESMO lançamento. Cancelar-e-recriar para corrigir um vencimento
 * deixaria duas linhas onde há uma cobrança só, e a auditoria do Financeiro
 * (que já existe, trg_auditoria_financeiro) contaria "cancelada" + "criada"
 * no lugar de "editada".
 */
export function abrirEdicaoCobranca({ assinatura, cobranca, aoMudar, aoVoltar }) {
  let form = edicaoVazia(cobranca);
  let salvando = false;
  const hoje = hojeISO();

  return raiz((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formEdicaoHtml({ cobranca, assinatura, form, erros, hoje });
      window.renderIcons?.();
      ligar();
    };

    function coletar() {
      return {
        valor: fundo.querySelector('#cmEdValor')?.value ?? '',
        vencimento: fundo.querySelector('#cmEdVenc')?.value ?? '',
        observacoes: fundo.querySelector('#cmEdObs')?.value ?? '',
      };
    }

    // Fechar por Voltar, Esc ou clique no fundo devolve ao cliente — sair da
    // edição não pode significar sair do cliente que se estava olhando.
    function voltar(fechar) { fechar(); aoVoltar?.(); }

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b =>
        b.addEventListener('click', () => voltar(fechar)));

      fundo.querySelector('[data-salvar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const { ok, erros, valor } = validarEdicao(form);
        if (!ok) { desenhar(erros); return; }

        salvando = true;
        try {
          const dados = await import('./comercial-data.js');
          const r = await dados.editarCobranca(cobranca.id, {
            valor,
            vencimento: form.vencimento,
            observacoes: form.observacoes.trim() || null,
          });
          if (!r) {
            mostrarErro(MSG.naoPendente);
          } else {
            mostrarToast(MSG.atualizada);
          }
          // Volta ao cliente com os dados recarregados. A situação, os dias de
          // atraso e o total a receber saem todos do dado novo — nenhum deles
          // é guardado, então "recalcular" é só redesenhar.
          fechar();
          aoMudar?.();
          aoVoltar?.();
        } catch (e) {
          console.error('Comercial · editar cobrança:', e);
          mostrarErro(traduzirErroCobranca(e));
          salvando = false;
        }
      });
    }

    desenhar();
  });
}

/** O formulário de pagamento. É ele que dispara a renovação. */
export function abrirRegistroPagamento({ assinatura, cobranca, aoMudar, planos = [] }) {
  let form = pagamentoVazio(cobranca);
  let salvando = false;
  const hoje = hojeISO();

  return raiz((fundo, fechar) => {
    const desenhar = (erros = {}) => {
      fundo.innerHTML = formPagamentoHtml({ cobranca, assinatura, form, erros, hoje, planos });
      window.renderIcons?.();
      ligar();
      fundo.querySelector('.cm-erro-campo input, .cm-erro-campo select')?.focus();
    };

    const coletar = () => ({
      pago_em: fundo.querySelector('#cmgData')?.value || '',
      valor_pago: fundo.querySelector('#cmgValor')?.value || '',
      forma_pagamento: fundo.querySelector('#cmgForma')?.value || '',
    });

    function ligar() {
      fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fechar()));

      // Mudar a data redesenha a prévia: ver que o período vai contar do
      // pagamento — e não do término — ANTES de confirmar é o que evita
      // descobrir isso trinta dias depois.
      fundo.querySelector('#cmgData')?.addEventListener('change', () => { form = coletar(); desenhar(); });

      fundo.querySelector('[data-confirmar]')?.addEventListener('click', async () => {
        if (salvando) return;
        form = coletar();
        const erros = validarPagamento(form, cobranca);
        if (Object.keys(erros).length) { desenhar(erros); return; }
        salvando = true;
        try {
          const dados = await import('./comercial-data.js');
          await dados.registrarPagamento({
            lancamentoId: cobranca.id,
            assinatura,
            pagoEm: form.pago_em,
            valorPago: valorDeTexto(form.valor_pago),
            formaPagamento: form.forma_pagamento,
          });
          fechar();
          aoMudar?.();
        } catch (e) {
          salvando = false;
          console.error('Comercial · registrar pagamento:', e);
          // A mesma tradução das outras ações de cobrança. O erro cru do
          // Postgres ia parar debaixo do campo de data, onde não ajudava
          // ninguém a entender o que fazer.
          desenhar({ pago_em: traduzirErroCobranca(e) });
        }
      });
    }

    desenhar();
  });
}
