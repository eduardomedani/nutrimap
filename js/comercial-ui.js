// ═══════════════════════════════════════════════════════════
// COMERCIAL — visão geral, lista de clientes e catálogo de planos
// ═══════════════════════════════════════════════════════════
// A marcação é gerada por funções puras (dado -> string), para que o teste
// confira a TELA e não as palavras do arquivo.
//
// O QUE ESTA TELA NÃO É: a planilha com 17 colunas. São dez colunas, e o resto
// mora no drawer. Dezessete colunas simultâneas no monitor obrigam o olho a
// varrer na horizontal para ler UMA linha — foi o que tornou a planilha
// cansativa de operar todo dia.

import {
  situacaoDoCliente, situacaoDaCobranca, SITUACAO_ROTULO, COBRANCA_ROTULO,
  textoDoVencimento, pesoDaUrgencia, telefoneBonito, telefoneDigitos,
  saldoDaCobranca, diasAteVencer,
} from './comercial.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * R$ 1.234,50 — ou "—" quando não há valor.
 *
 * Ausente e zero são coisas diferentes: um contrato sem `valor_contratado` é
 * um contrato cujo preço ninguém preencheu, e mostrá-lo como "R$ 0,00" afirma
 * que o cliente não paga nada. `Number(null)` é 0, então o teste tem que vir
 * antes da conversão.
 */
export function moeda(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

export function dataBR(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// ───────────────────────────────────────────────────────────
// VISÃO GERAL
// ───────────────────────────────────────────────────────────

/**
 * Os indicadores do topo.
 *
 * "A receber" e "Recebido no mês" são coisas diferentes e ficam lado a lado de
 * propósito: um mês pode ter recebido muito e ainda ter muito a receber, e ver
 * só um dos dois dá a impressão errada sobre o caixa.
 */
export function indicadoresHtml(ind = {}) {
  const tile = (rot, valor, tom = '', detalhe = '') => `
    <div class="cm-kpi${tom ? ' cm-kpi-' + tom : ''}">
      <div class="cm-kpi-rot">${esc(rot)}</div>
      <div class="cm-kpi-val">${esc(String(valor))}</div>
      ${detalhe ? `<div class="cm-kpi-det">${esc(detalhe)}</div>` : ''}
    </div>`;

  return `
    <div class="cm-kpis">
      ${tile('Ativos', ind.ativos ?? 0, 'ok')}
      ${tile('Vencem em 7 dias', ind.venceEmBreve ?? 0, ind.venceEmBreve ? 'aviso' : '')}
      ${tile('Vencidos', ind.vencidos ?? 0, ind.vencidos ? 'risco' : '')}
      ${tile('Recebido no mês', moeda(ind.recebidoNoMes ?? 0), 'ok')}
      ${tile('A receber', moeda(ind.aReceber ?? 0), (ind.aReceber ?? 0) > 0 ? 'aviso' : '')}
      ${tile('Receita recorrente', moeda(ind.receitaRecorrente ?? 0), '', 'estimada por 30 dias')}
    </div>`;
}

/** Quebra por plano e por horário — as duas leituras que a planilha dava com
 *  tabela dinâmica. */
export function quebrasHtml(assinaturas = [], hoje) {
  const vivos = assinaturas.filter(a => {
    const s = situacaoDoCliente(a, hoje);
    return s === 'ativo' || s === 'vence_em_breve';
  });
  if (!vivos.length) return '';

  const contar = chave => {
    const m = new Map();
    for (const a of vivos) {
      const k = chave(a) || 'Sem definição';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };

  const bloco = (titulo, pares) => `
    <div class="cm-quebra">
      <h3 class="cm-quebra-t">${esc(titulo)}</h3>
      <ul class="cm-quebra-lista">
        ${pares.map(([k, v]) => `
          <li><span>${esc(k)}</span><b>${v}</b></li>`).join('')}
      </ul>
    </div>`;

  return `
    <div class="cm-quebras">
      ${bloco('Por plano', contar(a => a.plano?.nome))}
      ${bloco('Por horário', contar(a => a.horario))}
    </div>`;
}

// ───────────────────────────────────────────────────────────
// LISTA DE CLIENTES
// ───────────────────────────────────────────────────────────

export function badgeSituacao(situacao) {
  return `<span class="cm-badge cm-b-${esc(situacao)}">${esc(SITUACAO_ROTULO[situacao] || situacao)}</span>`;
}

export function badgeCobranca(situacao) {
  if (!situacao) return '<span class="cm-vazio">—</span>';
  return `<span class="cm-badge cm-c-${esc(situacao)}">${esc(COBRANCA_ROTULO[situacao] || situacao)}</span>`;
}

/**
 * Uma linha da tabela.
 *
 * A linha inteira NÃO muda de cor: só o badge. Linha colorida transforma a
 * tabela num semáforo onde o texto fica ilegível, e quando metade dos clientes
 * está em algum estado a tela vira uma parede de cor.
 */
export function linhaClienteHtml(assinatura, hoje) {
  const a = assinatura;
  const situacao = situacaoDoCliente(a, hoje);
  const cob = a.cobrancaAberta ? situacaoDaCobranca(a.cobrancaAberta, hoje) : null;
  const tel = a.paciente?.telefone;

  return `
    <tr class="cm-linha" data-assinatura="${esc(a.id)}" tabindex="0">
      <td class="cm-td-nome">
        <span class="cm-nome">${esc(a.paciente?.nome || 'Sem nome')}</span>
        ${a.observacoes ? '<i data-lucide="sticky-note" class="cm-tem-obs" title="Tem observação comercial"></i>' : ''}
      </td>
      <td>${esc(a.plano?.nome || '—')}</td>
      <td>${esc(a.horario || '—')}</td>
      <td class="cm-td-periodo">${esc(dataBR(a.inicio_periodo))} → ${esc(dataBR(a.fim_periodo))}</td>
      <td class="cm-td-vence">
        <span class="cm-vence-data">${esc(dataBR(a.fim_periodo))}</span>
        <span class="cm-vence-txt">${esc(textoDoVencimento(a.fim_periodo, hoje))}</span>
      </td>
      <td>${badgeSituacao(situacao)}</td>
      <td class="cm-td-valor">${esc(moeda(a.valor_contratado))}</td>
      <td>${badgeCobranca(cob)}</td>
      <td class="cm-td-contato">
        ${tel
          ? `<a href="https://wa.me/${esc(telefoneDigitos(tel))}" target="_blank" rel="noopener"
                class="cm-wa" title="WhatsApp"><i data-lucide="message-circle"></i>${esc(telefoneBonito(tel))}</a>`
          : '<span class="cm-vazio">—</span>'}
      </td>
      <td class="cm-td-acoes">
        <button class="cm-acao" type="button" data-abrir="${esc(a.id)}" title="Abrir cliente">
          <i data-lucide="chevron-right"></i>
        </button>
      </td>
    </tr>`;
}

export const COLUNAS = [
  'Cliente', 'Plano', 'Horário', 'Período', 'Próximo vencimento',
  'Situação', 'Valor', 'Pagamento', 'Contato', '',
];

export function tabelaHtml(assinaturas = [], hoje) {
  if (!assinaturas.length) {
    return `
      <div class="cm-vazio-bloco">
        <i data-lucide="users"></i>
        <div class="cm-vazio-t">Nenhum cliente nesse recorte</div>
        <div class="cm-vazio-s">Mude os filtros ou cadastre uma assinatura.</div>
      </div>`;
  }
  return `
    <div class="cm-tabela-caixa">
      <table class="cm-tabela">
        <thead><tr>${COLUNAS.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${assinaturas.map(a => linhaClienteHtml(a, hoje)).join('')}</tbody>
      </table>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// FILTROS E ORDENAÇÃO
// ───────────────────────────────────────────────────────────

export const FILTROS_RAPIDOS = [
  { id: 'todos',     rotulo: 'Todos' },
  { id: 'ativos',    rotulo: 'Ativos' },
  { id: 'semana',    rotulo: 'Vencem esta semana' },
  { id: 'vencidos',  rotulo: 'Vencidos' },
  { id: 'pendentes', rotulo: 'Pagamentos pendentes' },
  { id: 'cancelados', rotulo: 'Cancelados' },
];

export function filtrosHtml(ativo = 'todos', busca = '') {
  return `
    <div class="cm-filtros">
      <div class="cm-busca">
        <i data-lucide="search"></i>
        <input type="search" id="cmBusca" placeholder="Buscar cliente" value="${esc(busca)}"
               autocomplete="off" spellcheck="false">
      </div>
      <div class="cm-chips" role="tablist">
        ${FILTROS_RAPIDOS.map(f => `
          <button class="cm-chip${f.id === ativo ? ' ativo' : ''}" type="button"
                  role="tab" aria-selected="${f.id === ativo}" data-filtro="${f.id}">${esc(f.rotulo)}</button>`).join('')}
      </div>
    </div>`;
}

/** Aplica busca e filtro rápido. Puro: recebe a lista, devolve a lista. */
export function aplicarFiltro(assinaturas = [], { filtro = 'todos', busca = '', hoje } = {}) {
  const termo = String(busca || '').trim().toLowerCase();
  let saida = assinaturas;

  if (termo) {
    saida = saida.filter(a => String(a.paciente?.nome || '').toLowerCase().includes(termo));
  }

  const sit = a => situacaoDoCliente(a, hoje);
  switch (filtro) {
    case 'ativos':
      saida = saida.filter(a => ['ativo', 'vence_em_breve'].includes(sit(a))); break;
    case 'semana': {
      saida = saida.filter(a => {
        const d = diasAteVencer(a.fim_periodo, hoje);
        return sit(a) !== 'cancelado' && d !== null && d >= 0 && d <= 7;
      });
      break;
    }
    case 'vencidos':
      saida = saida.filter(a => sit(a) === 'vencido'); break;
    case 'pendentes':
      saida = saida.filter(a => a.cobrancaAberta && situacaoDaCobranca(a.cobrancaAberta, hoje) !== 'pago'); break;
    case 'cancelados':
      saida = saida.filter(a => sit(a) === 'cancelado'); break;
    default:
      // "Todos" NÃO inclui cancelado: o dia a dia é sobre quem está no estúdio.
      // Cancelado tem chip próprio.
      saida = saida.filter(a => sit(a) !== 'cancelado');
  }
  return saida;
}

export const ORDENS = ['urgencia', 'nome', 'vencimento', 'valor', 'plano'];

export function ordenar(assinaturas = [], ordem = 'urgencia', hoje) {
  const l = [...assinaturas];
  switch (ordem) {
    case 'nome':
      return l.sort((a, b) => String(a.paciente?.nome || '').localeCompare(String(b.paciente?.nome || ''), 'pt-BR'));
    case 'vencimento':
      return l.sort((a, b) => String(a.fim_periodo).localeCompare(String(b.fim_periodo)));
    case 'valor':
      return l.sort((a, b) => Number(b.valor_contratado || 0) - Number(a.valor_contratado || 0));
    case 'plano':
      return l.sort((a, b) => String(a.plano?.nome || '').localeCompare(String(b.plano?.nome || ''), 'pt-BR'));
    default:
      // Urgência: vencido primeiro, e entre vencidos o mais antigo na frente —
      // quem está há 27 dias sem pagar importa mais que quem está há 1.
      return l.sort((a, b) => {
        const pa = pesoDaUrgencia(a, hoje), pb = pesoDaUrgencia(b, hoje);
        return pa[0] - pb[0] || pa[1] - pb[1];
      });
  }
}

export function ordenacaoHtml(ordem = 'urgencia') {
  const rot = { urgencia: 'Urgência', nome: 'Nome', vencimento: 'Vencimento', valor: 'Valor', plano: 'Plano' };
  return `
    <label class="cm-ordem">
      <span>Ordenar por</span>
      <select id="cmOrdem">
        ${ORDENS.map(o => `<option value="${o}"${o === ordem ? ' selected' : ''}>${esc(rot[o])}</option>`).join('')}
      </select>
    </label>`;
}

// ───────────────────────────────────────────────────────────
// CATÁLOGO DE PLANOS
// ───────────────────────────────────────────────────────────

/** "30 dias", "3 meses" — a duração legível. */
export function duracaoTexto(plano) {
  const v = Number(plano?.duracao_valor || 0);
  if (!v) return '—';
  const un = plano?.duracao_unidade === 'mes' ? (v === 1 ? 'mês' : 'meses') : (v === 1 ? 'dia' : 'dias');
  return `${v} ${un}`;
}

export function planosHtml(planos = []) {
  if (!planos.length) {
    return `
      <div class="cm-vazio-bloco">
        <i data-lucide="package"></i>
        <div class="cm-vazio-t">Nenhum plano cadastrado</div>
        <div class="cm-vazio-s">Os planos guardam duração, preço padrão e tolerância de atraso.</div>
        <button class="cm-btn cm-btn-forte" type="button" data-novo-plano>
          <i data-lucide="plus"></i> Criar plano
        </button>
      </div>`;
  }

  const linha = p => `
    <tr data-plano="${esc(p.id)}">
      <td class="cm-td-nome"><span class="cm-nome">${esc(p.nome)}</span></td>
      <td>${esc(duracaoTexto(p))}</td>
      <td>${p.frequencia_semanal ? esc(p.frequencia_semanal + 'x/semana') : '—'}</td>
      <td class="cm-td-valor">${esc(moeda(p.preco_padrao))}</td>
      <td>${esc(p.tolerancia_dias ?? 0)} ${Number(p.tolerancia_dias) === 1 ? 'dia' : 'dias'}</td>
      <td>${p.ativo ? '<span class="cm-badge cm-b-ativo">Ativo</span>' : '<span class="cm-badge cm-b-cancelado">Inativo</span>'}</td>
      <td class="cm-td-acoes">
        <button class="cm-acao" type="button" data-editar-plano="${esc(p.id)}" title="Editar">
          <i data-lucide="pencil"></i>
        </button>
      </td>
    </tr>`;

  return `
    <div class="cm-secao-topo">
      <p class="cm-ajuda">
        Mudar o preço de um plano <b>não altera</b> contratos já feitos — cada assinatura
        guarda o valor que foi combinado com aquele cliente.
      </p>
      <button class="cm-btn cm-btn-forte" type="button" data-novo-plano>
        <i data-lucide="plus"></i> Novo plano
      </button>
    </div>
    <div class="cm-tabela-caixa">
      <table class="cm-tabela">
        <thead><tr>
          <th>Plano</th><th>Duração</th><th>Frequência</th><th>Preço padrão</th>
          <th>Tolerância</th><th>Situação</th><th></th>
        </tr></thead>
        <tbody>${planos.map(linha).join('')}</tbody>
      </table>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// A TELA
// ───────────────────────────────────────────────────────────

export const ABAS = [
  { id: 'visao',    rotulo: 'Visão geral' },
  { id: 'clientes', rotulo: 'Clientes' },
  { id: 'planos',   rotulo: 'Planos' },
];

export function abasHtml(ativa = 'visao') {
  return `
    <div class="cm-abas" role="tablist">
      ${ABAS.map(a => `
        <button class="cm-aba${a.id === ativa ? ' ativa' : ''}" type="button"
                role="tab" aria-selected="${a.id === ativa}" data-aba="${a.id}">${esc(a.rotulo)}</button>`).join('')}
    </div>`;
}

export function telaHtml({ aba = 'visao', indicadores = {}, assinaturas = [], planos = [], hoje, filtro = 'todos', busca = '', ordem = 'urgencia' } = {}) {
  let corpo = '';

  if (aba === 'visao') {
    corpo = `
      ${indicadoresHtml(indicadores)}
      ${quebrasHtml(assinaturas, hoje)}`;
  } else if (aba === 'planos') {
    corpo = planosHtml(planos);
  } else {
    const lista = ordenar(aplicarFiltro(assinaturas, { filtro, busca, hoje }), ordem, hoje);
    corpo = `
      <div class="cm-secao-topo">
        ${filtrosHtml(filtro, busca)}
        ${ordenacaoHtml(ordem)}
      </div>
      <div class="cm-contagem">${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'}</div>
      ${tabelaHtml(lista, hoje)}`;
  }

  return `
    <div class="cm">
      ${abasHtml(aba)}
      <div class="cm-corpo">${corpo}</div>
    </div>`;
}

// ───────────────────────────────────────────────────────────
// MONTAGEM
// ───────────────────────────────────────────────────────────

// O estado da tela vive aqui e não no DOM: reler filtro e ordem de dentro do
// HTML a cada clique é como o módulo antigo perdia a seleção ao redesenhar.
const _estado = { aba: 'visao', filtro: 'todos', busca: '', ordem: 'urgencia' };
let _dados = { assinaturas: [], planos: [], indicadores: {} };

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Tabela que ainda não existe no banco. O PostgREST devolve 42P01 do Postgres
 *  ou PGRST205 do próprio cache de schema — os dois querem dizer o mesmo. */
function ehSchemaFaltando(e) {
  const t = `${e?.code || ''} ${e?.message || ''}`;
  return t.includes('42P01') || t.includes('PGRST205') || /does not exist|não existe/i.test(t);
}

/**
 * Monta a tela dentro de `#page-comercial`.
 *
 * Pinta o esqueleto antes de buscar: a lista de clientes são três consultas, e
 * deixar a página em branco enquanto elas voltam foi o problema que o Início
 * do PWA teve.
 */
export async function initComercialUI(alvo = 'page-comercial', secao = 'visao') {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;

  if (ABAS.some(a => a.id === secao)) _estado.aba = secao;
  cx.innerHTML = `<div class="cm"><div class="loading"><div class="spinner"></div>Carregando...</div></div>`;

  try {
    const dados = await import('./comercial-data.js');
    const hoje = hojeISO();
    const [assinaturas, planos, receitas] = await Promise.all([
      dados.listarAssinaturas(),
      dados.listarPlanos({ incluirInativos: true }),
      dados.receitasDeClientes(),
    ]);

    // A cobrança aberta de cada assinatura: a mais recente ainda não paga.
    // Uma passada só sobre as receitas — não uma consulta por cliente.
    const abertaPor = new Map();
    for (const r of receitas) {
      if (r.status !== 'pendente' || !r.assinatura_id) continue;
      const atual = abertaPor.get(r.assinatura_id);
      if (!atual || String(r.vencimento) < String(atual.vencimento)) abertaPor.set(r.assinatura_id, r);
    }
    for (const a of assinaturas) a.cobrancaAberta = abertaPor.get(a.id) || null;

    const { indicadores } = await import('./comercial.js');
    _dados = {
      assinaturas,
      planos,
      indicadores: indicadores({ assinaturas, lancamentos: receitas, hoje }),
    };
    pintar(cx);
  } catch (e) {
    console.error('Comercial:', e);
    cx.innerHTML = ehSchemaFaltando(e) ? semSchemaHtml() : erroHtml();
    cx.querySelector('#cmRetry')?.addEventListener('click', () => initComercialUI(cx, _estado.aba));
  }
}

function pintar(cx) {
  cx.innerHTML = telaHtml({ ..._dados, ..._estado, hoje: hojeISO() });
  ligar(cx);
  window.renderIcons?.();
}

function ligar(cx) {
  cx.querySelectorAll('[data-aba]').forEach(b =>
    b.addEventListener('click', () => {
      _estado.aba = b.dataset.aba;
      pintar(cx);
      try { history.replaceState(null, '', '#comercial/' + _estado.aba); } catch (e) {}
    }));

  cx.querySelectorAll('[data-filtro]').forEach(b =>
    b.addEventListener('click', () => { _estado.filtro = b.dataset.filtro; pintar(cx); }));

  const busca = cx.querySelector('#cmBusca');
  if (busca) {
    busca.addEventListener('input', () => {
      _estado.busca = busca.value;
      pintar(cx);
      // Redesenhar troca o input por outro: sem devolver o foco e o cursor, a
      // segunda letra da busca cairia fora do campo.
      const novo = cx.querySelector('#cmBusca');
      if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    });
  }

  const ordem = cx.querySelector('#cmOrdem');
  if (ordem) ordem.addEventListener('change', () => { _estado.ordem = ordem.value; pintar(cx); });

  // O drawer do cliente ainda não existe; o clique fica registrado para quando
  // existir, em vez de abrir algo pela metade.
  cx.querySelectorAll('[data-abrir]').forEach(b =>
    b.addEventListener('click', () => {
      cx.dispatchEvent(new CustomEvent('comercial:abrir-cliente', {
        bubbles: true, detail: { assinaturaId: b.dataset.abrir },
      }));
    }));
}

export function erroHtml() {
  return `
    <div class="cm-vazio-bloco">
      <i data-lucide="cloud-off"></i>
      <div class="cm-vazio-t">Não foi possível carregar</div>
      <div class="cm-vazio-s">Verifique sua conexão e tente novamente.</div>
      <button class="cm-btn cm-btn-forte" type="button" id="cmRetry">
        <i data-lucide="rotate-cw"></i> Tentar novamente
      </button>
    </div>`;
}

/** Aviso de banco não migrado — a mesma linguagem que o financeiro já usa. */
export function semSchemaHtml() {
  return `
    <div class="cm-vazio-bloco">
      <i data-lucide="database"></i>
      <div class="cm-vazio-t">O módulo comercial ainda não está no banco</div>
      <div class="cm-vazio-s">
        Rode <code>db/comercial_etapa1_vinculo.sql</code> e depois
        <code>db/comercial_etapa2_planos.sql</code> no SQL Editor do Supabase.
      </div>
    </div>`;
}
