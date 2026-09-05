// ═══════════════════════════════════════════════════════════
// CALCULADORA DE INVESTIMENTO — a conta que decide uma compra
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: a calculadora só pode dizer o que ela sabe.
//
// Há duas maneiras de ela mentir, e as duas são convidativas:
//
//   1) apresentar a MÉDIA como se fosse o mês. Quem quebra é o mês ruim, e uma
//      parcela que cabe na média e não cabe no pior mês vai ser paga com aperto
//      pelo menos uma vez por ano;
//   2) inventar retorno para EQUIPAMENTO. Uma esteira nova não traz um número
//      conhecido de alunos — e um ROI adivinhado seria justamente o número que
//      decide a compra.
//
// A régua vem do combinado de 05/09/2026: R$ 20.000 de reserva, metade da sobra
// vira parcela, doze meses de histórico, até doze parcelas.

import { grupo, teste, ok, igual, perto, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  REGUA, TIPOS, historicoMensal, capacidade, entradaMaxima, parcelaDe,
  veredicto, cenarios, melhorCenario, ganhoMensal, payback,
  custoDePosse, custoPorMesDeVida, ticketMedio, analisar,
  idsDeInvestimento, NOMES_DE_INVESTIMENTO,
} from '../js/investimento.js';

// Doze meses de sobra, um deles no vermelho — como um ano de verdade.
const HISTORICO = [
  { competencia: '2025-09-01', sobra: 4000 },
  { competencia: '2025-10-01', sobra: 5000 },
  { competencia: '2025-11-01', sobra: 3000 },
  { competencia: '2025-12-01', sobra: 8000 },
  { competencia: '2026-01-01', sobra: 2000 },
  { competencia: '2026-02-01', sobra: -1000 },   // o mês ruim
  { competencia: '2026-03-01', sobra: 4000 },
  { competencia: '2026-04-01', sobra: 4000 },
  { competencia: '2026-05-01', sobra: 5000 },
  { competencia: '2026-06-01', sobra: 6000 },
  { competencia: '2026-07-01', sobra: 4000 },
  { competencia: '2026-08-01', sobra: 4000 },
];

// ───────────────────────────────────────────────────────────
grupo('investimento · o que o caixa mostrou', () => {
  const cap = capacidade(HISTORICO);

  teste('a média sai de todos os meses, inclusive o vermelho', () => {
    // Tirar o mês ruim produziria uma capacidade que a operação nunca teve.
    igual(cap.meses, 12);
    igual(cap.media, 4000);
    igual(cap.pior, -1000);
    igual(cap.negativos, 1);
  });

  teste('a capacidade é metade da sobra média', () => {
    igual(cap.capacidade, 2000);
  });

  teste('o pior mês aparece com número próprio', () => {
    // É ele que diz se a parcela vai ser paga com aperto em algum momento.
    // Mostrar só a média esconderia exatamente o mês que preocupa.
    igual(cap.noPiorMes, -500);
  });

  teste('sem histórico, tudo é zero — e não indefinido', () => {
    const vazio = capacidade([]);
    igual(vazio.capacidade, 0);
    igual(vazio.meses, 0);
  });

  teste('a soma passa por centavos inteiros, como o resto do módulo', () => {
    const c = capacidade([{ sobra: 0.1 }, { sobra: 0.2 }], { fatiaDaSobra: 1 });
    igual(c.media, 0.15);
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · o histórico sai do caixa realizado', () => {
  const LANCS = [
    { tipo: 'receita', status: 'pago', pago_em: '2026-08-05', valor: 20000 },
    { tipo: 'despesa', status: 'pago', pago_em: '2026-08-10', valor: 3000 },
    // Folha de agosto, marcada: entra na parcela `folha`, não em despesa.
    { tipo: 'despesa', status: 'pago', pago_em: '2026-08-03', valor: 8000,
      origem: 'planilha', competencia: '2026-08-01', metadata: { folha: true } },
    // Pendente: compromisso não é dinheiro que andou.
    { tipo: 'despesa', status: 'pendente', vencimento: '2026-08-20', valor: 5000 },
  ];

  const h = historicoMensal(LANCS, [], { hoje: '2026-09-05', meses: 12 });

  teste('o mês corrente fica de fora', () => {
    // Setembro está pela metade, e um mês incompleto derruba a média por um
    // motivo que não é sobre o negócio.
    igual(h.length, 12);
    igual(h[h.length - 1].competencia, '2026-08-01');
    igual(h[0].competencia, '2025-09-01');
  });

  teste('entrou, saiu e sobrou vêm do pago_em', () => {
    const ago = h[h.length - 1];
    igual(ago.entrou, 20000);
    igual(ago.saiu, 11000, 'despesa + folha');
    igual(ago.folha, 8000);
    igual(ago.sobra, 9000);
  });

  teste('o que não foi pago não entra', () => {
    ok(!h.some(m => m.saiu === 16000), 'o pendente vazou para o realizado');
  });

  teste('a folha sem lançamento entra pela competência, uma vez só', () => {
    const so = historicoMensal([], [{ competencia: '2026-08-01', total: 7000 }],
                               { hoje: '2026-09-05', meses: 12 });
    const ago = so[so.length - 1];
    igual(ago.folha, 7000);
    igual(ago.sobra, -7000);
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · a entrada não fura a reserva', () => {
  teste('a entrada máxima é o caixa menos a reserva', () => {
    igual(entradaMaxima(50000), 30000);
    igual(entradaMaxima(50000, { reserva: 10000 }), 40000);
  });

  teste('caixa abaixo da reserva é entrada ZERO, não negativa', () => {
    // Entrada devedora não existe: o que existe é não poder dar entrada.
    igual(entradaMaxima(15000), 0);
    igual(entradaMaxima(0), 0);
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · o parcelamento', () => {
  teste('sem juros é divisão simples', () => {
    igual(parcelaDe(12000, 12, 0), 1000);
    igual(parcelaDe(1000, 3, 0), 333.33);
  });

  teste('com juros é a fórmula que a loja usa', () => {
    // Price: 10.000 em 12x a 2% ao mês dá 945,60.
    perto(parcelaDe(10000, 12, 0.02), 945.60, 0.02);
  });

  teste('zero parcelas não é dividir por zero', () => {
    igual(parcelaDe(1000, 0), 0);
  });

  const cap = capacidade(HISTORICO);        // média 4.000, capacidade 2.000

  teste('cabe, aperta e estoura são três respostas diferentes', () => {
    // Sem o meio-termo, consumir 55% da sobra teria o mesmo vermelho de
    // consumir 300% — e são decisões diferentes.
    igual(veredicto(1500, cap), 'cabe');
    igual(veredicto(2000, cap), 'cabe');
    igual(veredicto(3000, cap), 'aperta');
    igual(veredicto(5000, cap), 'estoura');
  });

  const lista = cenarios({ valor: 12000, entrada: 0, semJurosAte: 12 }, cap);

  teste('um cenário por prazo, até o limite do cartão', () => {
    igual(lista.length, 12);
    igual(lista[0].parcelas, 1);
    igual(lista[11].parcelas, 12);
  });

  teste('sem juros dentro do prazo do fornecedor, com juros fora', () => {
    const comTaxa = cenarios({ valor: 12000, semJurosAte: 6, taxaMes: 0.02 }, cap);
    igual(comTaxa[5].comJuros, false, '6x ainda é sem juros');
    igual(comTaxa[5].juros, 0);
    igual(comTaxa[6].comJuros, true, '7x já tem juros');
    ok(comTaxa[6].juros > 0);
  });

  teste('o desconto à vista só vale à vista', () => {
    // Aplicá-lo a todos os cenários faria o parcelado parecer mais barato.
    const l = cenarios({ valor: 10000, semJurosAte: 12, descontoAVista: 1000 }, cap);
    igual(l[0].custoTotal, 9000);
    igual(l[9].custoTotal, 10000);
    igual(l[9].acimaDoAVista, 1000, 'parcelar custa o desconto perdido');
  });

  teste('a entrada sai do financiado, e os juros correm só sobre o resto', () => {
    const l = cenarios({ valor: 12000, entrada: 6000, semJurosAte: 1, taxaMes: 0.02 }, cap);
    igual(l[5].financiado, 6000);
    ok(l[5].parcela < 1100, 'a parcela tem que refletir o valor financiado, não o total');
  });

  teste('o melhor cenário é o MENOR prazo que cabe', () => {
    // Prazo curto solta o caixa antes e paga menos juros; alongar sem precisar
    // é comprar aperto futuro.
    const m = melhorCenario(lista);
    igual(m.parcelas, 6, '12.000 em 6x = 2.000, exatamente a capacidade');
    igual(m.parcela, 2000);
  });

  teste('sem nenhum que caiba, o melhor é o que só aperta', () => {
    const caro = cenarios({ valor: 40000, semJurosAte: 12 }, cap);
    igual(melhorCenario(caro).veredicto, 'aperta');
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · o retorno, só onde ele existe', () => {
  teste('revenda: margem × giro, menos o custo que ela cria', () => {
    igual(ganhoMensal({ tipo: 'revenda', margem: 20, giro: 50, custoMensal: 100 }), 900);
  });

  teste('ampliação: alunos × ticket médio real', () => {
    igual(ganhoMensal({ tipo: 'ampliacao', alunos: 5, ticket: 150, custoMensal: 50 }), 700);
  });

  teste('equipamento devolve NULL, não zero', () => {
    // Zero diria "não traz nada", que é uma afirmação. Null diz "não sei", que
    // é a verdade sobre um aparelho.
    igual(ganhoMensal({ tipo: 'equipamento', custoMensal: 50 }), null);
    igual(TIPOS.equipamento.retorno, null);
  });

  teste('sem ganho não há payback — e não há payback fingido', () => {
    igual(payback(10000, null), null);
  });

  teste('ganho que não cobre o custo não se paga NUNCA', () => {
    // Arredondar para um número grande esconderia que ele não se paga.
    igual(payback(10000, 0), Infinity);
    igual(payback(10000, -50), Infinity);
  });

  teste('payback é o custo dividido pelo ganho líquido', () => {
    igual(payback(9000, 900), 10);
  });

  teste('o custo de posse é sempre maior que a parcela', () => {
    // A manutenção não some porque a compra foi aprovada.
    igual(custoDePosse(1000, 50), 1050);
    igual(custoDePosse(1000, 0), 1000);
  });

  teste('o custo por mês de vida compara o que a etiqueta esconde', () => {
    // R$ 4.000 que dura 10 anos custa menos por mês que R$ 2.000 que dura 3.
    const dezAnos = custoPorMesDeVida(4000, 0, 10);
    const tresAnos = custoPorMesDeVida(2000, 0, 3);
    ok(dezAnos < tresAnos, `${dezAnos} devia ser menor que ${tresAnos}`);
    igual(custoPorMesDeVida(1200, 50, 1), 150, '1200/12 + 50');
    igual(custoPorMesDeVida(1000, 10, 0), null, 'sem vida útil não há conta');
  });

  teste('o ticket médio é o que se paga, não o preço de tabela', () => {
    // Desconto negociado faz parte do que entra no caixa.
    igual(ticketMedio([
      { status: 'ativa', valor_contratado: 100 },
      { status: 'ativa', valor_contratado: 200 },
      { status: 'ativa', valor_contratado: null, plano: { preco_padrao: 300 } },
      { status: 'cancelada', valor_contratado: 9999 },
    ]), 200);
    igual(ticketMedio([]), null);
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · a análise inteira', () => {
  const base = { valor: 12000, entrada: 0, caixaHoje: 50000, semJurosAte: 12 };

  teste('junta capacidade, cenários e o melhor prazo', () => {
    const a = analisar({ ...base, tipo: 'equipamento', custoMensal: 50, anosDeVida: 10 },
                       { historico: HISTORICO });
    igual(a.capacidade.capacidade, 2000);
    igual(a.entradaMaxima, 30000);
    igual(a.melhor.parcelas, 6);
    igual(a.custoDePosse, 2050, 'parcela + manutenção');
    igual(a.ganhoMensal, null);
    igual(a.paybackMeses, null);
  });

  teste('o alerta do pior mês aparece quando ele não cobre a parcela', () => {
    const a = analisar({ ...base, tipo: 'equipamento' }, { historico: HISTORICO });
    ok(a.alertas.some(t => t.includes('pior mês')), a.alertas.join(' | '));
  });

  teste('entrada acima do que a reserva permite vira alerta, não erro', () => {
    // A pessoa pode ter caixa que o sistema não conhece. O alerta informa; ele
    // não impede a simulação.
    const a = analisar({ ...base, entrada: 40000, tipo: 'equipamento' }, { historico: HISTORICO });
    ok(a.alertas.some(t => t.includes('reserva')));
    igual(a.entradaMaxima, 30000);
  });

  teste('mês no vermelho é dito com todas as letras', () => {
    const a = analisar({ ...base, tipo: 'equipamento' }, { historico: HISTORICO });
    ok(a.alertas.some(t => t.includes('vermelho')));
  });

  teste('equipamento declara que não responde sobre lucro', () => {
    const a = analisar({ ...base, tipo: 'equipamento' }, { historico: HISTORICO });
    ok(a.alertas.some(t => t.includes('não tem retorno estimável')), a.alertas.join(' | '));
  });

  teste('ampliação responde payback, porque o dado existe', () => {
    const a = analisar({ ...base, tipo: 'ampliacao', alunos: 5, ticket: 150, custoMensal: 0 },
                       { historico: HISTORICO });
    igual(a.ganhoMensal, 750);
    igual(a.paybackMeses, 16);
  });

  teste('nada cabe: a análise diz isso em vez de escolher o menos pior', () => {
    const a = analisar({ valor: 200000, caixaHoje: 21000, tipo: 'equipamento', semJurosAte: 12 },
                       { historico: HISTORICO });
    igual(a.melhor, null);
    ok(a.alertas.some(t => t.includes('Nenhum prazo')));
  });

  teste('a régua da tela vence a régua padrão', () => {
    const a = analisar({ ...base, tipo: 'equipamento' },
                       { historico: HISTORICO, regua: { fatiaDaSobra: 1, parcelasMax: 6 } });
    igual(a.capacidade.capacidade, 4000);
    igual(a.cenarios.length, 6);
    igual(a.melhor.parcelas, 3, 'com a régua inteira, 3x já cabe');
  });

  teste('os padrões são os combinados em 05/09/2026', () => {
    igual(REGUA, { reserva: 20000, fatiaDaSobra: 0.5, meses: 12, parcelasMax: 12 });
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · a tela', () => {
  const ui = readFileSync(new URL('../js/financeiro-investimento-ui.js', import.meta.url), 'utf8');
  const casca = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');

  teste('a régua aparece ANTES da resposta', () => {
    // Um veredicto "cabe" sem dizer contra o quê é palpite com cara de conta.
    const iRegua = ui.indexOf('reguaHtml(analise)');
    const iResultado = ui.indexOf('resultadoHtml(analise');
    ok(iRegua > 0 && iRegua < iResultado, 'o resultado não pode vir antes da régua');
    contem(ui, 'O que o caixa tem mostrado');
    contem(ui, 'Pior mês');
  });

  teste('equipamento não ganha payback inventado', () => {
    // O número que decide a compra não pode ser o único que não vem de lugar
    // nenhum. Ver `ganhoMensal` em js/investimento.js.
    contem(ui, 'Sobre retorno, esta tela não responde');
    contem(ui, 'a.ganhoMensal === null');
  });

  teste('a tela não consulta o banco', () => {
    // Quem lê é financeiro.js, e a calculadora usa o MESMO cache das outras
    // abas: uma consulta própria traria os mesmos lançamentos com outro
    // recorte, e os dois números divergiriam.
    naoContem(ui, ".from('", 'a tela não fala com o banco');
    naoContem(ui, 'supabase.js');
    contem(casca, 'lancamentos: d.lancamentos', 'a aba tem que reusar o cache');
  });

  teste('mexer na régua refaz o histórico', () => {
    // Sem isso, "meses de histórico" seria um campo sem efeito sobre a resposta.
    contem(ui, '_dados.historico = historicoMensal(');
  });

  teste('o campo de dinheiro usa a mesma máscara do resto do sistema', () => {
    contem(ui, 'mascararCampoDeDinheiro');
    // E o resultado só se refaz ao SAIR do campo: redesenhar a cada tecla
    // tiraria o foco no meio da digitação.
    contem(ui, "el.addEventListener('change', redesenhar)");
  });

  teste('a aba está no Financeiro e carrega sob demanda', () => {
    contem(casca, "id: 'investimento'");
    contem(casca, "import('./financeiro-investimento-ui.js')");
  });
});

// ───────────────────────────────────────────────────────────
grupo('investimento · a compra passada não é custo de operar', () => {
  // O DEFEITO QUE ISTO CONSERTA: enquanto equipamento e obra contavam como
  // saída, um ano de muita compra derrubava a sobra e a calculadora recomendava
  // não comprar — justamente por ter comprado. O erro se realimenta: quanto
  // mais se investe, menos ela deixa investir.
  const CATEGORIAS = [
    { id: 'cat-eq', nome: 'Equipamentos' },
    { id: 'cat-en', nome: 'Energia' },
  ];
  const CENTROS = [
    { id: 'cc-inv', nome: 'INVESTIMENTO' },
    { id: 'cc-adm', nome: 'ADMINISTRATIVO' },
  ];

  const LANCS = [
    { tipo: 'receita', status: 'pago', pago_em: '2026-08-05', valor: 20000 },
    { tipo: 'despesa', status: 'pago', pago_em: '2026-08-07', valor: 1000, categoria_id: 'cat-en' },
    // A esteira comprada em agosto: eventual, e o tipo de gasto que se decide.
    { tipo: 'despesa', status: 'pago', pago_em: '2026-08-09', valor: 9000, categoria_id: 'cat-eq' },
    // A obra, reconhecida pelo CENTRO de custo.
    { tipo: 'despesa', status: 'pago', pago_em: '2026-08-11', valor: 5000, centro_custo_id: 'cc-inv' },
  ];

  const ids = idsDeInvestimento(CATEGORIAS, CENTROS);

  teste('reconhece por categoria E por centro de custo', () => {
    ok(ids.has('cat-eq'));
    ok(ids.has('cc-inv'));
    ok(!ids.has('cat-en'), 'energia é custo de operar');
    ok(!ids.has('cc-adm'), 'administrativo é alocação, não investimento');
  });

  teste('a sobra ignora a compra e conta o resto', () => {
    const h = historicoMensal(LANCS, [], { hoje: '2026-09-05', investimentoIds: ids });
    const ago = h[h.length - 1];
    igual(ago.entrou, 20000);
    igual(ago.saiu, 1000, 'só a energia é custo de operar');
    igual(ago.investido, 14000, 'esteira + obra');
    igual(ago.sobra, 19000, 'a sobra é o que a operação gera PARA investir');
  });

  teste('sem a separação, a sobra despencaria', () => {
    // O comportamento antigo, para o teste mostrar o tamanho da diferença.
    const h = historicoMensal(LANCS, [], { hoje: '2026-09-05' });
    igual(h[h.length - 1].sobra, 5000);
  });

  teste('a capacidade soma o que foi tirado, para a tela poder dizer', () => {
    // Sem esse número a tela esconderia a própria régua: a pessoa veria uma
    // sobra alta sem saber que R$ 14.000 de compras não estão nela.
    const h = historicoMensal(LANCS, [], { hoje: '2026-09-05', investimentoIds: ids });
    igual(capacidade(h).investido, 14000);
  });

  teste('sem os ids, nada é tirado — e isso é o padrão seguro', () => {
    // Quem não classificou as despesas ainda não pode ter linha excluída por
    // adivinhação: sem categoria e sem centro, tudo continua sendo custo.
    igual(idsDeInvestimento([], []).size, 0);
    const h = historicoMensal(LANCS, [], { hoje: '2026-09-05', investimentoIds: new Set() });
    igual(h[h.length - 1].investido, 0);
  });

  teste('os nomes reconhecidos são os do plano de contas real', () => {
    for (const nome of ['equipamentos', 'obras e reforma', 'investimento', 'obras e expansão']) {
      ok(NOMES_DE_INVESTIMENTO.includes(nome), `faltou ${nome}`);
    }
  });
});
