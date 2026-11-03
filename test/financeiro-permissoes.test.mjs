// O que este arquivo protege: quem não tem `financeiro.visualizar` não pode ver
// valor do Financeiro, nem parcial. A RLS devolve as cobranças de assinatura a quem
// tem `comercial.visualizar`, e a tela somaria essas linhas como se fossem o caixa
// da empresa, sem aviso. Por isso a trava é conferida ANTES de qualquer leitura.
//
// Também ficam aqui as regressões do balão do gráfico e da troca de página.

import { readFileSync } from 'node:fs';
import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { rpc, tabela, limpar, chamadas } from './duble-supabase.mjs';
import { limparPermissoes, carregarPermissoes } from '../js/permissoes.js';
import { initFinanceiroUI, abrirSecao } from '../js/financeiro-ui.js';
import { rolarParaInicio, serieDeCaixa, serieAnual } from '../js/financeiro.js';
import { graficoReceitaDespesa, tamanhoDoGrafico } from '../js/financeiro-grafico.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');
const DESPESAS = readFileSync(new URL('../js/financeiro-despesas-ui.js', import.meta.url), 'utf8');

const TABELAS_FINANCEIRAS = ['financeiro_lancamentos', 'financeiro_categorias', 'folha_resumo_mensal'];
const leituras = () => chamadas.filter(c => TABELAS_FINANCEIRAS.includes(c.tabela));

function elemento() {
  return {
    innerHTML: '', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, setAttribute() {},
  };
}

/** Uma página mínima: só os dois elementos que o módulo procura. */
function prepararPagina(permissoes) {
  limpar();
  limparPermissoes();
  rpc('minhas_permissoes', () => permissoes);
  for (const t of TABELAS_FINANCEIRAS) tabela(t, []);
  const page = elemento(), miolo = elemento();
  document.getElementById = id => ({ 'page-financeiro': page, finConteudo: miolo }[id] || null);
  return { page, miolo };
}

grupo('financeiro · quem não tem a permissão não vê nada', () => {
  // A Recepção real: Comercial sim, Financeiro não.
  const RECEPCAO = ['clientes.visualizar', 'comercial.visualizar', 'comercial.editar'];

  teste('Recepção: nenhuma leitura financeira, e a tela é de bloqueio', async () => {
    const { page } = prepararPagina(RECEPCAO);
    await initFinanceiroUI('visao-geral', {});
    igual(leituras().length, 0, 'o dado não pode passar pela rede para depois sumir');
    contem(page.innerHTML, 'não tem acesso');
    ok(!/R\$/.test(page.innerHTML), 'nenhum valor na tela');
  });

  for (const aba of ['receitas', 'despesas', 'fluxo-caixa', 'categorias', 'investimento']) {
    teste(`entrada direta em #financeiro/${aba} também é barrada`, async () => {
      prepararPagina(RECEPCAO);
      await initFinanceiroUI(aba, {});
      igual(leituras().length, 0);
    });
  }

  teste('sem permissão nenhuma, ou com a consulta falhando, nega', async () => {
    const { page } = prepararPagina([]);
    await initFinanceiroUI('visao-geral', {});
    igual(leituras().length, 0);
    contem(page.innerHTML, 'não tem acesso');
  });

  teste('trocar de aba com a permissão perdida não lê nada', async () => {
    const { miolo } = prepararPagina(RECEPCAO);
    await carregarPermissoes();
    await abrirSecao('fluxo-caixa');
    igual(leituras().length, 0);
    contem(miolo.innerHTML, 'não tem acesso');
  });

  teste('quem tem a permissão continua lendo', async () => {
    prepararPagina(['financeiro.visualizar']);
    await initFinanceiroUI('visao-geral', {});
    ok(leituras().length > 0, 'a trava não pode bloquear o proprietário');
  });

  teste('a exceção individual vale: o que conta é a permissão efetiva', async () => {
    // `minhas_permissoes` já devolve perfil + exceções. Recepção com exceção abre.
    prepararPagina([...RECEPCAO, 'financeiro.visualizar']);
    await initFinanceiroUI('visao-geral', {});
    ok(leituras().length > 0);
  });
});

grupo('financeiro · todas as entradas passam pelo portão', () => {
  teste('o item de menu exige a permissão e nasce oculto', () => {
    const item = /<div class="nav-item" data-page="financeiro"[^>]*>/.exec(INDEX)?.[0] || '';
    contem(item, 'data-exige="financeiro.visualizar"');
    contem(item, 'hidden');
  });

  teste('a rota exige a permissão', () => {
    const i = INDEX.indexOf('const EXIGE_PERMISSAO');
    contem(INDEX.slice(i, INDEX.indexOf('};', i)), "financeiro: 'financeiro.visualizar'");
  });

  teste('o módulo só é aberto de dentro de navegar(), depois de podeAbrir', () => {
    const inicio = INDEX.indexOf('function navegar(pagina, secao)');
    const portao = INDEX.indexOf('if (!podeAbrir(pagina))', inicio);
    const abertura = INDEX.indexOf('abrirFinanceiro(secao)', inicio);
    ok(inicio > 0 && portao > inicio && abertura > portao, 'o portão vem antes da abertura');
    igual(INDEX.split('abrirFinanceiro(').length - 1, 2, 'só a definição e a chamada em navegar');
    igual(INDEX.split('initFinanceiroUI').length - 1, 2, 'só abrirFinanceiro carrega o módulo');
  });

  teste('o link direto passa por navegar()', () => {
    const i = INDEX.indexOf("h.startsWith('financeiro/')");
    contem(INDEX.slice(i, i + 80), "navegar('financeiro'");
  });

  teste('o módulo confere a permissão antes de ler, no init e na troca de aba', () => {
    const init = UI.slice(UI.indexOf('export async function initFinanceiroUI'));
    ok(init.indexOf('pode(PERMISSAO_DO_MODULO)') < init.indexOf('montarSecao(alvo.id)'));
    const secao = UI.slice(UI.indexOf('async function montarSecao'));
    ok(secao.indexOf('pode(PERMISSAO_DO_MODULO)') < secao.indexOf('montarVisaoGeral(miolo)'));
  });
});

grupo('financeiro · o balão mostra o valor que o gráfico desenha', () => {
  const LANCS = [
    { id: 'r', tipo: 'receita', competencia: '2026-09-01', pago_em: '2026-10-05', valor: 3523.45, status: 'pago' },
    { id: 'd', tipo: 'despesa', competencia: '2026-10-01', pago_em: '2026-10-07', valor: 900, status: 'pago' },
  ];

  teste('competência: a barra traz o valor da receita, não a geometria', () => {
    const { barras } = graficoReceitaDespesa(serieAnual(LANCS, [], '2026'));
    igual(barras[8].receita, 3523.45);
    igual(barras[9].receita, 0);
  });

  teste('caixa: a mesma receita aparece no mês em que entrou', () => {
    const { barras } = graficoReceitaDespesa(serieDeCaixa(LANCS, [], '2026'));
    igual(barras[9].receita, 3523.45);
    igual(barras[8].receita, 0);
  });

  teste('valor e resultado fecham no mesmo mês', () => {
    const { barras } = graficoReceitaDespesa(serieDeCaixa(LANCS, [], '2026'));
    igual(barras[9].receita - barras[9].despesa - barras[9].folha, barras[9].resultado);
  });

  teste('a altura desenhada corresponde ao valor', () => {
    const { barras, topo } = graficoReceitaDespesa(serieAnual(LANCS, [], '2026'));
    const area = 260 - 26 - 12;
    ok(Math.abs(barras[8].barraReceita.altura - (3523.45 / topo) * area) < 0.01);
  });

  teste('o balão abre por toque e fecha ao tocar fora, nos dois gráficos', () => {
    const balao = UI.slice(UI.indexOf('function ligarBalao'));
    contem(balao, "g.addEventListener('click'");
    contem(balao, "document.addEventListener('click'");
    contem(balao, 'document.removeEventListener');
    igual(UI.split('ligarBalao(plot, tip').length - 1, 3, 'a definição e os dois gráficos');
  });
});

grupo('financeiro · gráfico em tela pequena', () => {
  teste('no celular o desenho nasce na largura real, sem encolher o texto', () => {
    const t = tamanhoDoGrafico(343);
    igual(t.largura, 343);
    igual(t.altura, 240);
    contem(graficoReceitaDespesa([{ competencia: '2026-01-01' }], t).svg, 'viewBox="0 0 343 240"');
  });

  teste('no computador nada muda', () => {
    igual(tamanhoDoGrafico(1593), {});
    igual(tamanhoDoGrafico(560), {});
  });

  teste('sem largura conhecida vale o padrão', () => {
    igual(tamanhoDoGrafico(0), {});
    igual(tamanhoDoGrafico(undefined), {});
  });

  teste('largura mínima para os doze meses caberem', () => {
    igual(tamanhoDoGrafico(200).largura, 280);
  });
});

grupo('financeiro · trocar de página volta ao início da lista', () => {
  teste('rola o elemento para o topo', () => {
    let opcoes = null;
    rolarParaInicio({ scrollIntoView(o) { opcoes = o; } });
    igual(opcoes, { block: 'start' });
  });

  teste('sem elemento não quebra', () => {
    rolarParaInicio(null);
    rolarParaInicio({});
    ok(true);
  });

  teste('Receitas e Despesas rolam ao trocar de página', () => {
    contem(UI, 'desenharLista(); rolarParaInicio(alvo);');
    contem(DESPESAS, '_pagina++; lista(); rolarParaInicio(cx);');
    contem(DESPESAS, '_pagina--; lista(); rolarParaInicio(cx);');
  });

  teste('filtrar não rola: só a troca de página', () => {
    const busca = UI.slice(UI.indexOf("querySelector('#fxBusca')"), UI.indexOf("querySelector('#fxNovo')"));
    ok(!busca.includes('rolarParaInicio'));
  });
});
