// ═══════════════════════════════════════════════════════════
// FINANCEIRO DA EMPRESA — cálculo e importação
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é uma coisa só: o número exibido tem que ser
// conferível. Duas maneiras de quebrar isso, e as duas já quase aconteceram na
// planilha de origem:
//
//   1) somar como zero o lançamento que não tem valor — o total fica com cara
//      de fechado sem estar;
//   2) contar a folha duas vezes — uma pela linha importada, outra pela
//      apuração de folhas/folha_itens.
//
// A segunda mudou de forma, não de gravidade. A folha DEIXOU de ser descartada
// na importação: ela entra marcada em `metadata.folha`, e é a marca que faz
// `folhaDoPeriodo()` dar a competência a uma fonte só. O que continua valendo
// é que a marca sai da DESCRIÇÃO, nunca da coluna: a planilha tem FOPAG em
// ADMINISTRATIVO e FOPAG sem centro nenhum, e classificar pela coluna erraria
// R$ 53.859,25 sem nenhum aviso na tela.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  somar, porCategoria, porAno, porCompetencia, pendencias, custoDoMes,
  anoDa, dataBR, hojeISO, SEM_CATEGORIA,
  serieAnual, totaisDoAno, anosDisponiveis, fluxoDeCaixa, forasDoFluxo,
} from '../js/financeiro.js';
import {
  graficoReceitaDespesa, legendaHtml, SERIES, graficoFluxo, legendaFluxoHtml, SERIES_FLUXO,
} from '../js/financeiro-grafico.js';
import { lerValor, lerData, ehFolha, lerCsv, montarSql, centroUnificado } from '../db/gerador_custos.mjs';

const CATS = [
  { id: 'c1', nome: 'ADMINISTRATIVO' },
  { id: 'c2', nome: 'LIMPEZA' },
];

const LANCS = [
  { id: '1', competencia: '2025-01-01', data: '2025-01-03', valor: 100, categoria_id: 'c1', pago: true },
  { id: '2', competencia: '2025-01-01', data: '2025-01-09', valor: 50,  categoria_id: 'c2', pago: true },
  { id: '3', competencia: '2025-02-01', data: '2025-02-03', valor: 200, categoria_id: 'c1', pago: false },
  { id: '4', competencia: '2026-02-01', data: '2026-02-10', valor: null, categoria_id: null, pago: true },
];

// ───────────────────────────────────────────────────────────
grupo('financeiro · o total não mente sobre o que sabe', () => {
  teste('lançamento sem valor não vale zero — fica fora da soma', () => {
    igual(somar(LANCS), 350);
    igual(somar([]), 0);
    igual(somar(null), 0);
  });

  teste('a soma é exata em centavos, como a do banco', () => {
    // ACONTECEU: somando as 2.177 vendas em float, a tela dava R$ 593.781,26 e
    // o Postgres, que soma `numeric` exato, devolvia R$ 593.781,27. Um centavo
    // não é dinheiro; é o sinal que ensina quem confere a ignorar divergência.
    igual(somar([{ valor: 0.1 }, { valor: 0.2 }]), 0.3);
    igual(somar([{ valor: 332.50 }, { valor: 283.75 }, { valor: 373.66 }]), 989.91);

    // 100 centavos somados um a um: em float isso escorrega, em inteiro não.
    const cem = Array(100).fill({ valor: 0.01 });
    igual(somar(cem), 1);
  });

  teste('os agrupamentos também somam em centavos', () => {
    const l = [
      { competencia: '2026-01-01', valor: 0.1, categoria_id: 'c1' },
      { competencia: '2026-01-01', valor: 0.2, categoria_id: 'c1' },
    ];
    igual(porCategoria(l, [{ id: 'c1', nome: 'X' }])[0].total, 0.3);
    igual(porCompetencia(l)[0].total, 0.3);
    igual(porAno(l)[0].total, 0.3);
    igual(custoDoMes(l, { total: 0.1 }).total, 0.4);
  });

  teste('e aparece como pendência, para o total não passar por fechado', () => {
    const p = pendencias(LANCS);
    igual(p.semValor.map(l => l.id), ['4']);
    igual(p.semCategoria.map(l => l.id), ['4']);
    igual(p.naoPagos.map(l => l.id), ['3']);
  });

  teste('sem categoria é uma linha própria, não some no "outros"', () => {
    const cats = porCategoria(LANCS, CATS);
    const sem = cats.find(c => c.id === null);
    ok(sem, 'a linha sem categoria tem que existir no relatório');
    igual(sem.nome, SEM_CATEGORIA);
    igual(sem.n, 1);
  });

  teste('as categorias saem da maior para a menor', () => {
    const cats = porCategoria(LANCS, CATS);
    igual(cats.map(c => c.total), [300, 50, 0]);
    igual(cats[0].nome, 'ADMINISTRATIVO');
  });

  teste('por ano e por competência, em ordem cronológica', () => {
    igual(porAno(LANCS), [{ ano: '2025', total: 350 }, { ano: '2026', total: 0 }]);
    igual(porCompetencia(LANCS).map(c => c.competencia),
          ['2025-01-01', '2025-02-01', '2026-02-01']);
  });
});

// ───────────────────────────────────────────────────────────
grupo('financeiro · despesa e folha são duas parcelas', () => {
  teste('o custo do mês declara de que é feito', () => {
    const c = custoDoMes([{ valor: 1000 }, { valor: 500 }], { total: 7500 });
    igual(c, { despesas: 1500, folha: 7500, total: 9000 });
  });

  teste('sem folha no mês, a parcela é zero e o total continua legível', () => {
    igual(custoDoMes([{ valor: 100 }], null), { despesas: 100, folha: 0, total: 100 });
  });
});

// ───────────────────────────────────────────────────────────
grupo('financeiro · datas sem passar por fuso', () => {
  teste('a data vira DD/MM/AAAA sem new Date()', () => {
    // new Date('2026-04-30') é meia-noite UTC: no fuso do Brasil isso é dia 29.
    igual(dataBR('2026-04-30'), '30/04/2026');
    igual(dataBR(''), '—');
    igual(anoDa('2026-04-01'), '2026');
  });

  teste('hoje usa o relógio local, não UTC', () => {
    // 31/12/2026 às 22h no horário de Brasília: toISOString() já diz 2027-01-01,
    // e o lançamento cairia na competência do ano seguinte.
    const virada = new Date(2026, 11, 31, 22, 30, 0);
    igual(hojeISO(virada), '2026-12-31');
    igual(hojeISO(new Date(2026, 0, 5, 3, 0, 0)), '2026-01-05');
  });
});

// ───────────────────────────────────────────────────────────
grupo('financeiro · a série do ano', () => {
  const LANCS_ANO = [
    { competencia: '2026-01-01', tipo: 'receita', valor: 1000 },
    { competencia: '2026-01-01', tipo: 'despesa', valor: 300 },
    { competencia: '2026-03-01', tipo: 'receita', valor: 500 },
    { competencia: '2025-01-01', tipo: 'receita', valor: 9999 },   // outro ano, fora
  ];
  const FOLHA_ANO = [
    { competencia: '2026-01-01', total: 200 },
    { competencia: '2026-02-01', total: 150 },
  ];

  const serie = serieAnual(LANCS_ANO, FOLHA_ANO, '2026');

  teste('são sempre doze meses, inclusive os vazios', () => {
    // Desenhar só os meses com movimento comprime o eixo e faz uma operação de
    // três meses parecer um ano cheio. A lacuna é informação.
    igual(serie.length, 12);
    igual(serie[0].competencia, '2026-01-01');
    igual(serie[11].competencia, '2026-12-01');
    igual(serie[6].receita, 0);
    igual(serie[6].custo, 0);
  });

  teste('receita, despesa e folha ficam separadas', () => {
    igual(serie[0].receita, 1000);
    igual(serie[0].despesa, 300);
    igual(serie[0].folha, 200);
    igual(serie[0].custo, 500, 'custo é despesa + folha');
    igual(serie[0].resultado, 500, 'resultado é receita − custo');
  });

  teste('mês só com folha continua com custo', () => {
    igual(serie[1].despesa, 0);
    igual(serie[1].folha, 150);
    igual(serie[1].custo, 150);
    igual(serie[1].resultado, -150);
  });

  teste('outro ano não vaza para dentro da série', () => {
    igual(serie.reduce((s, m) => s + m.receita, 0), 1500);
  });

  teste('os totais do ano saem da própria série', () => {
    // Somar por outro caminho faria o número escrito e a altura da barra
    // discordarem — e aí não há como saber qual dos dois está certo.
    const t = totaisDoAno(serie);
    igual(t, { receita: 1500, despesa: 300, folha: 350, custo: 650, resultado: 850 });
  });

  teste('a série também soma em centavos', () => {
    const s = serieAnual([
      { competencia: '2026-01-01', tipo: 'receita', valor: 0.1 },
      { competencia: '2026-01-01', tipo: 'receita', valor: 0.2 },
    ], [], '2026');
    igual(s[0].receita, 0.3);
  });

  teste('os anos disponíveis incluem os que só têm folha', () => {
    // Um ano só de folha, sem lançamento nenhum, ainda é um ano com custo.
    igual(anosDisponiveis(LANCS_ANO, [{ competencia: '2023-05-01' }]), ['2026', '2025', '2023']);
  });
});

// ───────────────────────────────────────────────────────────
grupo('gráfico · a altura da barra significa o valor', () => {
  const MESES = [
    { competencia: '2026-01-01', receita: 1000, despesa: 400, folha: 200, custo: 600, resultado: 400 },
    { competencia: '2026-02-01', receita: 600,  despesa: 600, folha: 0,   custo: 600, resultado: 0 },
    { competencia: '2026-03-01', receita: 0,    despesa: 0,   folha: 0,   custo: 0,   resultado: 0 },
  ];

  teste('sem mês nenhum não se desenha eixo vazio', () => {
    igual(graficoReceitaDespesa([]).svg, '');
    igual(graficoReceitaDespesa(null).barras, []);
  });

  teste('UMA escala só para receita e despesa', () => {
    // Com duas escalas, barras de mesma altura significariam valores
    // diferentes — e o gráfico mentiria exatamente no que ele existe para
    // mostrar: qual dos dois é maior.
    const { barras } = graficoReceitaDespesa(MESES);
    const fev = barras[1];
    ok(Math.abs(fev.receita.altura - fev.custo.altura) < 0.05,
       'receita 600 e custo 600 têm que desenhar a mesma altura');
  });

  teste('o topo do eixo cobre o maior dos dois lados', () => {
    const { topo } = graficoReceitaDespesa(MESES);
    ok(topo >= 1000, `topo ${topo} corta a receita de 1000`);
  });

  teste('receita à esquerda, custo à direita, sem sobrepor', () => {
    const { barras } = graficoReceitaDespesa(MESES);
    const jan = barras[0];
    ok(jan.receita.x + jan.largura <= jan.custo.x, 'as duas barras do mês se sobrepõem');
    ok(jan.receita.x < jan.centro && jan.custo.x >= jan.centro, 'as barras não ladeiam o centro do mês');
  });

  teste('a despesa é empilhada: o segmento da folha fica por cima', () => {
    const { svg } = graficoReceitaDespesa(MESES);
    contem(svg, 'fg-despesa');
    contem(svg, 'fg-folha');
    // Uma barra só de "despesa" apagaria de onde cada pedaço veio.
    const { barras } = graficoReceitaDespesa(MESES);
    ok(barras[0].custo.altura > 0);
  });

  teste('mês zerado não desenha retângulo', () => {
    const { svg } = graficoReceitaDespesa([MESES[2]]);
    naoContem(svg, 'fg-receita', 'mês sem receita não pode ganhar barra');
    naoContem(svg, 'fg-despesa');
  });

  teste('todo mês tem alvo de hover, mesmo o vazio', () => {
    // O alvo é a faixa inteira do mês: um mês de valor baixo tem barra de 3px,
    // e mirar nela é impossível.
    const { svg } = graficoReceitaDespesa(MESES);
    igual((svg.match(/rg-alvo/g) || []).length, 3);
    igual((svg.match(/data-fg-mes=/g) || []).length, 3);
  });

  teste('a legenda sai do mesmo lugar que as cores', () => {
    // Legenda escrita à mão continua verde depois que o gráfico virou azul.
    const l = legendaHtml();
    for (const s of SERIES) contem(l, s.rotulo);
    igual(SERIES.length, 3);
  });

  teste('o SVG se descreve para quem não o enxerga', () => {
    contem(graficoReceitaDespesa(MESES).svg, 'role="img"');
    contem(graficoReceitaDespesa(MESES).svg, 'aria-label=');
  });
});

// ───────────────────────────────────────────────────────────
grupo('fluxo de caixa · realizado pelo pagamento, projetado pelo vencimento', () => {
  const LANCS = [
    // Competência de JULHO, paga em AGOSTO: sai do caixa em agosto.
    { tipo: 'despesa', competencia: '2026-07-01', status: 'pago', pago_em: '2026-08-10', valor: 500 },
    { tipo: 'receita', competencia: '2026-08-01', status: 'pago', pago_em: '2026-08-05', valor: 3000 },
    // Pendente: é compromisso, entra no projetado pelo vencimento.
    { tipo: 'despesa', competencia: '2026-08-01', status: 'pendente', vencimento: '2026-09-20', valor: 700 },
    { tipo: 'receita', competencia: '2026-08-01', status: 'pendente', vencimento: '2026-09-02', valor: 900 },
    // Cancelada não entra em lugar nenhum.
    { tipo: 'despesa', competencia: '2026-08-01', status: 'cancelado', pago_em: '2026-08-01', valor: 9999 },
    // Paga sem data: não há mês onde pôr.
    { tipo: 'despesa', competencia: '2026-08-01', status: 'pago', valor: 40 },
  ];
  const FOLHA = [{ competencia: '2026-08-01', total: 1000 }];
  const f = fluxoDeCaixa(LANCS, FOLHA, '2026');
  const ago = f[7], jul = f[6], set = f[8];

  teste('o realizado usa pago_em, não a competência', () => {
    // A despesa é de julho e saiu do caixa em agosto — é isso que o extrato do
    // banco mostra. Usar a competência poria o dinheiro no mês errado.
    igual(jul.saiu, 0, 'julho não pode ter saída: o dinheiro saiu em agosto');
    igual(ago.saiuLancado, 500);
  });

  teste('a folha entra como saída realizada', () => {
    igual(ago.folha, 1000);
    igual(ago.saiu, 1500, 'saiu = despesas pagas + folha');
    igual(ago.entrou, 3000);
    igual(ago.saldo, 1500);
  });

  teste('o pendente vai para o projetado, pelo vencimento — e não soma no saldo', () => {
    igual(set.aPagar, 700);
    igual(set.aReceber, 900);
    igual(set.projetado, 200);
    igual(set.entrou, 0, 'compromisso não é dinheiro que andou');
    igual(set.saiu, 0);
  });

  teste('cancelado não entra nem no realizado nem no projetado', () => {
    ok(!f.some(m => m.saiu > 1500 || m.aPagar > 700), 'a linha cancelada vazou para o fluxo');
  });

  teste('o acumulado atravessa os meses', () => {
    igual(ago.acumulado, 1500);
    igual(set.acumulado, 1500, 'mês sem movimento mantém o acumulado');
    igual(f[11].acumulado, 1500);
  });

  teste('pago sem data fica FORA e é contado à parte', () => {
    // Chutar um mês poria dinheiro no lugar errado do calendário.
    const fora = forasDoFluxo(LANCS);
    igual(fora.pagoSemData.length, 1);
    igual(fora.pendenteSemVencimento.length, 0);
    ok(!f.some(m => m.saiuLancado === 40), 'a linha sem data entrou em algum mês');
  });

  teste('são sempre doze meses', () => {
    igual(f.length, 12);
    igual(f[0].competencia, '2026-01-01');
  });
});

// ───────────────────────────────────────────────────────────
grupo('gráfico do fluxo · dois lados do zero', () => {
  const MESES = [
    { competencia: '2026-01-01', entrou: 1000, saiu: 400, saldo: 600, acumulado: 600 },
    { competencia: '2026-02-01', entrou: 400, saiu: 1000, saldo: -600, acumulado: 0 },
  ];

  teste('sem mês nenhum não se desenha eixo', () => {
    igual(graficoFluxo([]).svg, '');
  });

  teste('entrada e saída de mesmo valor desenham a mesma altura', () => {
    // Com escalas diferentes, o gráfico mentiria sobre qual dos dois é maior.
    const { barras } = graficoFluxo(MESES);
    ok(Math.abs(barras[0].entradaAltura - barras[1].saidaAltura) < 0.05);
    ok(Math.abs(barras[0].saidaAltura - barras[1].entradaAltura) < 0.05);
  });

  teste('o eixo zero é desenhado', () => {
    // Sem ele, "acima" e "abaixo" não significam nada.
    contem(graficoFluxo(MESES).svg, 'fg-zero');
  });

  teste('o acumulado é linha, não barra', () => {
    const svg = graficoFluxo(MESES).svg;
    contem(svg, '<polyline class="fg-acumulado"');
  });

  teste('a legenda declara que o acumulado tem escala própria', () => {
    // Ele é uma ordem de grandeza acima do movimento mensal; sem o aviso, a
    // altura da linha seria lida na régua das barras.
    contem(legendaFluxoHtml(), 'escala própria');
    igual(SERIES_FLUXO.length, 3);
  });
});

// ───────────────────────────────────────────────────────────
grupo('financeiro · a tela registra, não só lê o que foi importado', () => {
  const ui = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');

  teste('há um caminho para criar lançamento', () => {
    contem(ui, 'criarLancamento', 'sem isto o módulo só mostra o passado importado');
    contem(ui, 'Nova despesa');
    contem(ui, 'Nova receita');
  });

  teste('Despesas e Contas a pagar são o mesmo módulo, com recorte diferente', () => {
    // Conta a pagar é despesa pendente com vencimento, não uma coleção própria.
    // Duplicar a lista criaria dois lugares para corrigir cada defeito de
    // filtro, e o segundo é sempre o que fica para trás.
    contem(ui, "montarDespesas(miolo, 'despesas')");
    contem(ui, "montarDespesas(miolo, 'contas-pagar')");
    igual((ui.match(/async function montarDespesas/g) || []).length, 1, 'uma implementação só');
  });

  teste('a casca não reimplementa a lista de despesas', () => {
    // O módulo dedicado é quem monta filtros, tabela e ações. Se a casca voltar
    // a desenhar linha de despesa, existem duas listas para manter.
    contem(ui, "import('./financeiro-despesas-ui.js')");
    naoContem(ui, 'dsp-tabela', 'a tabela de despesa mora no módulo próprio');
    naoContem(ui, 'dspFStatus', 'os filtros de despesa moram no módulo próprio');
  });

  teste('a data padrão do formulário não passa por toISOString', () => {
    // UTC muda o dia depois das 21h no Brasil. `toISOString` pode aparecer para
    // carimbar um INSTANTE (preservado_em), nunca para escolher um DIA.
    const form = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');
    contem(form, 'hojeISO()');
    naoContem(form, "value=\"${new Date().toISOString()", 'campo de data não pode nascer de UTC');
    naoContem(form, 'toISOString().slice(0, 10)', 'isso é escolher um dia por UTC');
  });

  teste('a casca não guarda mais um formulário próprio', () => {
    // Receita abria modal centralizado e despesa abria drawer: duas telas para
    // a mesma tarefa, com duas validações. Agora é um só.
    naoContem(ui, 'fp-modal-caixa', 'o modal de receita devia ter saído');
    contem(ui, "import('./financeiro-lancamento-form.js')");
  });

  teste('excluir avisa quando a linha veio da planilha', () => {
    // Reimportar traz de volta. Quem apaga precisa saber antes, não depois.
    contem(ui, 'Rodar a importação de novo vai trazê-la de volta');
  });

  teste('a tela continua sem falar com o banco', () => {
    naoContem(ui, 'from(', 'quem consulta é financeiro.js');
    naoContem(ui, 'supabase.js', 'a tela não importa o cliente');
  });
});

// ───────────────────────────────────────────────────────────
grupo('importação · a planilha de custos', () => {
  teste('valor em pt-BR vira número; vazio vira nulo', () => {
    igual(lerValor('R$ 1.728,08'), 1728.08);
    igual(lerValor('R$ 49,90'), 49.9);
    igual(lerValor(''), null);
    igual(lerValor('   '), null);
  });

  teste('data brasileira vira ISO', () => {
    igual(lerData('04/11/2023'), '2023-11-04');
    igual(lerData(''), null);
    igual(lerData('11/2023'), null);
  });

  teste('folha é reconhecida pela DESCRIÇÃO, não pela coluna', () => {
    // As três formas que a planilha usa para a mesma coisa.
    ok(ehFolha('FOPAG REF: MAIO26'));
    ok(ehFolha('Pagamento Professor (Josely)'));
    ok(ehFolha('Pagamento Estagiário (Aline)'));
    // E o que NÃO é folha, mesmo estando no centro de custo COLABORADORES.
    ok(!ehFolha('Uniformes (2/2)'));
    ok(!ehFolha('MEI'));
    ok(!ehFolha('Energia'));
  });
});

// ───────────────────────────────────────────────────────────
grupo('importação · o gerador marca a folha, e não a descarta', () => {
  // Uma planilha mínima com as armadilhas reais do arquivo do Eduardo.
  const CSV = [
    'Data da Venda;Mês;Ano;Descrição;;Valor;Pago?;CENTRO DE CUSTO;Observações',
    '03/11/2025;11;2025;Energia;;R$ 1.437,79;Sim;ADMINISTRATIVO;',
    '02/02/2026;2;2026;FOPAG REF: JANEIRO26;;R$ 7.533,61;Sim;ADMINISTRATIVO;',   // folha fora de COLABORADORES
    '20/05/2026;5;2026;FOPAG REF: MAIO26;;R$ 8.093,47;Sim;;',                    // folha sem centro
    '16/06/2025;6;2025;Uniformes (2/2);;R$ 1.313,25;Sim;COLABORADORES;',         // COLABORADORES sem ser folha
    '30/04/2026;4;2026;REFORMA INTERNA - CP;;;Sim;INVESTIMENTO;',                // sem valor
    '13/05/2026;5;2026;Tomadas pretas;;R$ 417,14;Sim;;',                         // sem centro
    '15/07/2026;7;2026;REMADA CAVALINHA (2/5);;R$ 688,20;Não;;',                 // não pago
    ';;;;;;;;',
    ';;;;;;;;',
  ].join('\n');

  const linhas = lerCsv(CSV);
  const folha = linhas.filter(r => r.folha);

  teste('as duas FOPAG ENTRAM, e entram marcadas', () => {
    // Antes elas eram descartadas. Agora a planilha é a fonte do histórico de
    // folha (out/2023 a mai/2026) e a marca é o que impede a dupla contagem —
    // ver `ehDespesaDeFolha` e `folhaDoPeriodo` em js/financeiro.js.
    igual(folha.map(r => r.descricao), ['FOPAG REF: JANEIRO26', 'FOPAG REF: MAIO26']);
    igual(folha.reduce((s, r) => s + r.valor, 0), 15627.08);
    igual(linhas.length, 7, 'nenhuma linha da planilha pode ficar de fora');
  });

  teste('a marca vem da descrição, mesmo com centro de custo diferente', () => {
    // Uma das duas está em ADMINISTRATIVO e a outra sem centro nenhum.
    ok(folha.every(r => r.folha));
    ok(linhas.find(r => r.descricao === 'Uniformes (2/2)').folha === false,
       'linha de COLABORADORES que não é folha não pode ser marcada');
  });

  teste('as linhas vazias do rodapé não viram lançamento', () => {
    igual(linhas.filter(r => !r.folha).length, 5);
  });

  teste('sem valor e sem centro entram assim mesmo, sem chute', () => {
    const semValor = linhas.find(r => r.descricao === 'REFORMA INTERNA - CP');
    igual(semValor.valor, null, 'valor ausente não pode virar 0');
    const semCentro = linhas.find(r => r.descricao === 'Tomadas pretas');
    igual(semCentro.centro, '', 'centro ausente não pode ser inferido do texto');
  });

  teste('"Não" na coluna Pago vira pago = false', () => {
    igual(linhas.find(r => r.descricao.startsWith('REMADA')).pago, false);
    igual(linhas.find(r => r.descricao === 'Energia').pago, true);
  });
});

// ───────────────────────────────────────────────────────────
grupo('importação · o SQL gerado', () => {
  const CSV = [
    'Data da Venda;Mês;Ano;Descrição;;Valor;Pago?;CENTRO DE CUSTO;Observações',
    "03/11/2025;11;2025;Conserto d'água;;R$ 100,00;Sim;MANUTENÇÃO;PIX",
    '02/02/2026;2;2026;FOPAG REF: JANEIRO26;;R$ 7.533,61;Sim;ADMINISTRATIVO;',
    '30/04/2026;4;2026;REFORMA INTERNA - CP;;;Sim;INVESTIMENTO;',
  ].join('\n');

  const sql = montarSql(lerCsv(CSV));

  teste('apóstrofo na descrição é escapado', () => {
    // Sem isso, "Conserto d'água" fecha a string e o resto da linha vira comando.
    contem(sql, "'Conserto d''água'");
  });

  teste('valor ausente vira null tipado, não zero', () => {
    contem(sql, 'null::numeric');
    naoContem(sql, "'REFORMA INTERNA - CP', 0.00", 'valor ausente não pode virar zero');
  });

  teste('a folha ENTRA no insert, e entra marcada', () => {
    // Era o contrário até a planilha virar a fonte do histórico de folha. O que
    // impede a dupla contagem agora não é o descarte, é a marca: com ela,
    // `folhaDoPeriodo()` deixa a apuração de folhas/folha_itens de fora daquela
    // competência.
    const valores = sql.slice(sql.indexOf('insert into public.financeiro_lancamentos'),
                              sql.indexOf('as v(linha,'));
    contem(valores, 'FOPAG REF: JANEIRO26', 'a folha da planilha tem que entrar');
    contem(sql, `case when v.folha then '{"folha": true}'::jsonb else '{}'::jsonb end`);
  });

  teste('o centro de custo vai para o campo de centro de custo', () => {
    // A importação de 2026 gravou centro como CATEGORIA e precisou de uma
    // migração para desfazer. A categoria fica nula: ela responde a natureza do
    // gasto, que a planilha não informa.
    contem(sql, 'insert into public.financeiro_centros_custo');
    contem(sql, 'left join public.financeiro_centros_custo cc');
    const colunas = sql.slice(sql.indexOf('insert into public.financeiro_lancamentos'),
                              sql.indexOf('origem, origem_linha, metadata)'));
    contem(colunas, 'centro_custo_id');
    naoContem(colunas, 'categoria_id', 'a natureza do gasto não sai da coluna de alocação');
  });

  teste('a competência é derivada da data, como o CHECK do banco exige', () => {
    contem(sql, "date_trunc('month', v.data)::date");
  });

  teste('re-executável: apaga só o que veio da planilha', () => {
    contem(sql, "delete from public.financeiro_lancamentos");
    contem(sql, "origem = 'planilha'");
    naoContem(sql, 'truncate', 'o import não pode limpar a tabela inteira');
  });

  teste('o lançamento feito à mão na tela não é tocado', () => {
    const del = sql.slice(sql.indexOf('delete from public.financeiro_lancamentos'),
                          sql.indexOf('insert into public.financeiro_lancamentos'));
    contem(del, "origem = 'planilha'", 'o delete tem que ser filtrado por origem');
  });

  teste('fecha com a conferência que devolve um número', () => {
    contem(sql, 'as lancamentos');
    contem(sql, 'as linhas_de_folha');
    contem(sql, 'as sem_centro');
    contem(sql, 'as sem_valor');
  });
});

// ───────────────────────────────────────────────────────────
grupo('importação · o centro de custo escrito de vários jeitos', () => {
  teste('as três grafias de manutenção viram uma', () => {
    // Separadas, o relatório racha o total entre três linhas e nenhuma delas
    // mostra quanto a manutenção custou. Decidido em 05/09/2026.
    igual(centroUnificado('MANUTENÇÃO CORRETIVA'), 'MANUTENÇÃO');
    igual(centroUnificado('Manutenção e Reforma Estofados'), 'MANUTENÇÃO');
    igual(centroUnificado('MANUTENÇÃO'), 'MANUTENÇÃO');
  });

  teste('quem não está no mapa passa intacto, só sem espaço em volta', () => {
    igual(centroUnificado('  ADMINISTRATIVO '), 'ADMINISTRATIVO');
    igual(centroUnificado('LIMPEZA'), 'LIMPEZA');
    igual(centroUnificado(''), '');
    igual(centroUnificado(null), '');
  });

  teste('a normalização acontece na LEITURA, não só no banco', () => {
    // O gerador lê a planilha crua: arrumar apenas as linhas já importadas
    // traria a grafia de volta na próxima reimportação, e ninguém desconfiaria
    // porque o centro certo continuaria existindo — só que com parte das
    // despesas. É a mesma lição de db/financeiro_categorias_grafias.sql.
    const linhas = lerCsv([
      'Data da Venda;Mês;Ano;Descrição;;Valor;Pago?;CENTRO DE CUSTO;Observações',
      '03/11/2025;11;2025;Conserto do portão;;R$ 50,00;Sim;MANUTENÇÃO CORRETIVA;',
      '04/11/2025;11;2025;Estofados;;R$ 1.700,00;Sim;Manutenção e Reforma Estofados;',
    ].join('\n'));
    igual(linhas.map(r => r.centro), ['MANUTENÇÃO', 'MANUTENÇÃO']);
  });
});

// ───────────────────────────────────────────────────────────
grupo('financeiro · o atalho da pendência leva onde a linha está', () => {
  const ui = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');

  teste('a pendência de receita abre RECEITAS, não Despesas', () => {
    // ACONTECEU em 05/09/2026: o alerta dizia "6 sem valor" — seis receitas da
    // importação de vendas —, o botão abria Despesas, e a lista vinha vazia.
    // O número passava por errado sem ser, e não havia como descobrir onde as
    // seis estavam.
    contem(ui, "['receita', 'receitas', 'receita']", 'faltou o destino da receita');
    contem(ui, '_filtroPendencia', 'o filtro tem que carregar a seção junto');
    naoContem(ui, '_filtroDespesa', 'o filtro de destino único devia ter saído');
  });

  teste('a aba Receitas entende o recorte que o atalho arma', () => {
    // Sem isso o atalho abriria a lista inteira e a pessoa teria de achar as
    // seis no meio de duas mil.
    contem(ui, "_filtro.pendencia === 'sem-valor'");
    contem(ui, "_filtro.pendencia === 'sem-categoria'");
  });

  teste('o recorte é visível e tem saída', () => {
    // Ano e categoria têm select; a pendência chega pelo atalho e não tem
    // controle nenhum. Sem o chip, a lista fica curta sem explicação e não há
    // como voltar ao todo.
    contem(ui, 'fxLimparPend');
    contem(ui, 'function ligarLimparPendencia');
    igual((ui.match(/ligarLimparPendencia\(\);/g) || []).length, 2,
          'os dois caminhos — lista cheia e lista vazia — desenham o botão');
  });

  teste('"não pago" continua só para despesa', () => {
    // Receita em aberto é contas a receber, que é outra pergunta e tem aba
    // própria — contá-la aqui mandaria a pessoa para a lista errada de novo.
    contem(ui, 'naoPagosDespesa');
  });
});
