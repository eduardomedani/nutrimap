// ═══════════════════════════════════════════════════════════
// A FOLHA FECHADA VIRA DESPESA — e não vira duas
// ═══════════════════════════════════════════════════════════
// Fechar a folha passou a criar uma despesa no caixa da empresa
// (db/financeiro_folha_despesa.sql). O risco inteiro dessa mudança é UM:
//
//   o custo da equipe existir em dois lugares — na apuração de
//   folhas/folha_itens, lida pela view `folha_resumo_mensal`, e no lançamento
//   espelho — e a tela somar os dois.
//
// Ninguém percebe isso olhando: o mês simplesmente fica com o dobro do custo de
// pessoal, num sistema onde a folha é a maior despesa. Foi exatamente por esse
// medo que a importação da planilha de custos deixou 88 linhas de FOPAG de fora
// (ver test/financeiro.test.mjs). O que mudou não é o medo: é que agora existe
// um vínculo (`folha_id`, `origem = 'folha'`) e uma regra de precedência.
//
// Estes testes protegem a regra de precedência, não a existência do lançamento.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  descricaoDespesaDaFolha, DESPESA_DA_FOLHA, traduzirErroLancamento, nomeCompetencia,
} from '../js/folha.js';
import {
  ehDespesaDeFolha, separarFolha, folhaDoPeriodo,
  serieAnual, totaisDoAno, fluxoDeCaixa, somar,
} from '../js/financeiro.js';

const SQL = readFileSync(new URL('../db/financeiro_folha_despesa.sql', import.meta.url), 'utf8');

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · o nome da despesa', () => {
  teste('é "Folha de Pagamento - <mês> de <ano>"', () => {
    igual(descricaoDespesaDaFolha('2026-09-01'), 'Folha de Pagamento - Setembro de 2026');
    igual(descricaoDespesaDaFolha('2026-01-01'), 'Folha de Pagamento - Janeiro de 2026');
  });

  teste('o ano faz parte do nome', () => {
    // "Folha de Pagamento - Setembro" seria ambíguo já no segundo ano de
    // operação, e o histórico deste projeto tem três.
    ok(descricaoDespesaDaFolha('2025-09-01') !== descricaoDespesaDaFolha('2026-09-01'));
  });

  teste('o mês é o da COMPETÊNCIA, que é como a folha se chama na tela', () => {
    // A folha de setembro paga o trabalho de agosto (js/folha.js,
    // `mesTrabalhado`). Nomear a despesa pelo mês trabalhado faria quem procura
    // no caixa não achar pelo nome que viu na folha.
    contem(descricaoDespesaDaFolha('2026-09-01'), nomeCompetencia('2026-09-01'));
  });

  teste('o banco monta o MESMO texto', () => {
    // São duas fontes do mesmo nome — a tela precisa dele antes de fechar, o
    // backfill precisa dele sem tela. Duas fontes divergem no dia em que uma
    // muda, e este teste é o que impede.
    contem(SQL, `'${DESPESA_DA_FOLHA} - '`);
    contem(SQL, "|| ' de ' || extract(year from f.competencia)");
    for (const mes of ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                       'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']) {
      contem(SQL, `'${mes}'`, 'o array de meses do SQL tem que bater com o do JS');
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · reconhecer o espelho', () => {
  teste('é a ORIGEM que diz, não a descrição', () => {
    ok(ehDespesaDeFolha({ origem: 'folha' }));
    // Alguém pode lançar à mão uma despesa com esse nome — e ela é uma despesa
    // comum. Tratá-la como espelho faria o mês perder a folha apurada.
    ok(!ehDespesaDeFolha({ origem: 'manual', descricao: 'Folha de Pagamento - Agosto de 2026' }));
    ok(!ehDespesaDeFolha({ origem: 'planilha' }));
    ok(!ehDespesaDeFolha(null));
  });

  teste('separar não perde nem duplica linha', () => {
    const lista = [{ origem: 'manual' }, { origem: 'folha' }, { origem: 'vendas' }];
    const { operacao, daFolha } = separarFolha(lista);
    igual(operacao.length, 2);
    igual(daFolha.length, 1);
    igual(separarFolha(null), { operacao: [], daFolha: [] });
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · uma fonte por competência', () => {
  const APURADA = [
    { competencia: '2026-08-01', total: 8000, status: 'fechada' },
    { competencia: '2026-09-01', total: 9000, status: 'fechada' },
    { competencia: '2026-10-01', total: 5000, status: 'rascunho' },
  ];

  teste('onde há lançamento, a apuração NÃO soma junto', () => {
    // O caso que este módulo inteiro existe para não deixar acontecer.
    const meses = folhaDoPeriodo([
      { tipo: 'despesa', origem: 'folha', competencia: '2026-08-01', valor: 8000, status: 'pago' },
    ], APURADA);

    igual(meses.length, 3, 'nenhuma competência pode aparecer duas vezes');
    igual(meses.find(m => m.competencia === '2026-08-01'),
          { competencia: '2026-08-01', total: 8000, lancado: true });
    igual(somar(meses.map(m => ({ valor: m.total }))), 22000);
  });

  teste('o valor que vale é o do lançamento, não o da apuração', () => {
    // Se os dois discordarem — alguém corrigiu a despesa no caixa —, quem manda
    // é a linha que está no caixa: é ela que o extrato bancário espelha.
    const meses = folhaDoPeriodo([
      { tipo: 'despesa', origem: 'folha', competencia: '2026-08-01', valor: 7777.77, status: 'pago' },
    ], APURADA);
    igual(meses.find(m => m.competencia === '2026-08-01').total, 7777.77);
  });

  teste('sem lançamento, vale a apuração — como sempre foi', () => {
    const meses = folhaDoPeriodo([], APURADA);
    igual(meses.map(m => m.total), [8000, 9000, 5000]);
    ok(meses.every(m => !m.lancado));
  });

  teste('espelho CANCELADO devolve a palavra à apuração', () => {
    // É o que acontece ao reabrir a folha: o lançamento é cancelado e o mês
    // volta a ser respondido pelo número que está sendo mexido.
    const meses = folhaDoPeriodo([
      { tipo: 'despesa', origem: 'folha', competencia: '2026-08-01', valor: 8000, status: 'cancelado' },
    ], APURADA);
    igual(meses.find(m => m.competencia === '2026-08-01').total, 8000);
    igual(meses.find(m => m.competencia === '2026-08-01').lancado, false);
  });

  teste('mês só com lançamento, sem apuração nenhuma, também aparece', () => {
    const meses = folhaDoPeriodo([
      { tipo: 'despesa', origem: 'folha', competencia: '2026-07-01', valor: 100, status: 'pago' },
    ], []);
    igual(meses, [{ competencia: '2026-07-01', total: 100, lancado: true }]);
  });

  teste('a soma continua em centavos inteiros', () => {
    const meses = folhaDoPeriodo([
      { tipo: 'despesa', origem: 'folha', competencia: '2026-07-01', valor: 0.1, status: 'pago' },
      { tipo: 'despesa', origem: 'folha', competencia: '2026-07-01', valor: 0.2, status: 'pago' },
    ], []);
    igual(meses[0].total, 0.3);
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · a série do ano não conta duas vezes', () => {
  const LANCS = [
    { tipo: 'receita', competencia: '2026-08-01', valor: 20000, status: 'pago', pago_em: '2026-08-05' },
    { tipo: 'despesa', competencia: '2026-08-01', valor: 1500, status: 'pago', pago_em: '2026-08-07' },
    { tipo: 'despesa', competencia: '2026-08-01', valor: 8000, status: 'pago', pago_em: '2026-08-03',
      origem: 'folha' },
  ];
  const APURADA = [{ competencia: '2026-08-01', total: 8000 }];
  const serie = serieAnual(LANCS, APURADA, '2026');
  const ago = serie[7];

  teste('o espelho fica na parcela `folha`, não na de despesa', () => {
    // Ele é uma despesa lançada, mas continua sendo custo de EQUIPE. Somá-lo
    // com as despesas de operação apagaria a única pergunta que o gráfico
    // empilhado responde: quanto foi equipe e quanto foi o resto.
    igual(ago.despesa, 1500);
    igual(ago.folha, 8000);
  });

  teste('o custo do mês é 9.500, não 17.500', () => {
    igual(ago.custo, 9500, 'a folha entrou duas vezes: lançada e apurada');
    igual(ago.resultado, 10500);
  });

  teste('os totais do ano seguem a mesma regra', () => {
    const t = totaisDoAno(serie);
    igual(t, { receita: 20000, despesa: 1500, folha: 8000, custo: 9500, resultado: 10500 });
  });

  teste('folha ainda não lançada continua entrando pela apuração', () => {
    const s = serieAnual([], [{ competencia: '2026-08-01', total: 8000 }], '2026');
    igual(s[7].folha, 8000);
    igual(s[7].custo, 8000);
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · o fluxo de caixa', () => {
  const LANCS = [
    // Folha de AGOSTO paga em 03/08 — a convenção da casa: paga-se entre os
    // dias 1 e 4 da competência.
    { tipo: 'despesa', competencia: '2026-08-01', valor: 8000, status: 'pago',
      pago_em: '2026-08-03', origem: 'folha' },
    // Folha de SETEMBRO fechada sem data de pagamento: pendente, sem
    // vencimento. Não há mês onde pô-la, e chutar seria pior.
    { tipo: 'despesa', competencia: '2026-09-01', valor: 9000, status: 'pendente',
      origem: 'folha' },
    { tipo: 'despesa', competencia: '2026-08-01', valor: 500, status: 'pago', pago_em: '2026-08-10' },
  ];
  const APURADA = [
    { competencia: '2026-08-01', total: 8000 },
    { competencia: '2026-09-01', total: 9000 },
    { competencia: '2026-10-01', total: 7000 },   // ainda em rascunho, sem espelho
  ];
  const f = fluxoDeCaixa(LANCS, APURADA, '2026');
  const [ago, set, out] = [f[7], f[8], f[9]];

  teste('a folha lançada sai pelo pago_em, e conta uma vez só', () => {
    igual(ago.folha, 8000);
    igual(ago.saiuLancado, 500, 'o espelho não pode entrar como despesa de operação');
    igual(ago.saiu, 8500);
  });

  teste('a folha sem espelho continua entrando pela competência', () => {
    igual(out.folha, 7000);
    igual(out.saiu, 7000);
  });

  teste('espelho pendente não vira saída realizada', () => {
    // Fechar sem data de pagamento é possível, e o dinheiro ainda não andou.
    igual(set.folha, 0, 'a apuração de setembro não pode voltar pela porta dos fundos');
    igual(set.saiu, 0);
  });

  teste('o saldo do mês desconta a folha uma vez', () => {
    igual(ago.saldo, -8500);
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · o SQL', () => {
  const DESFAZER = readFileSync(
    new URL('../db/financeiro_folha_despesa_desfazer.sql', import.meta.url), 'utf8');

  teste('uma folha, um lançamento — a trava mora no banco', () => {
    // Sem ela, fechar duas vezes (ou duas abas fechando junto) criaria dois
    // espelhos do mesmo mês, e a tela somaria os dois.
    contem(SQL, 'create unique index if not exists uniq_financeiro_lancamentos_folha');
    contem(SQL, 'where folha_id is not null');
  });

  teste("a origem 'folha' é aceita pelo CHECK — nos dois arquivos", () => {
    contem(SQL, "check (origem in ('manual', 'planilha', 'vendas', 'folha'))");
    // O canônico também: reexecutar db/financeiro_lancamentos.sql depois desta
    // migration não pode derrubar a marca nova.
    const canonico = readFileSync(
      new URL('../db/financeiro_lancamentos.sql', import.meta.url), 'utf8');
    contem(canonico, "check (origem in ('manual', 'planilha', 'vendas', 'folha'))");
  });

  teste('a RPC exige equipe.folha e a folha da própria organização', () => {
    // Quem fecha a folha não precisa ter `financeiro.lancar` — e não ganha
    // nenhum outro poder no caixa por causa disto.
    contem(SQL, "tem_permissao('equipe.folha')");
    contem(SQL, 'folha de outra organizacao');
    contem(SQL, 'grant execute on function public.financeiro_lancar_folha(uuid) to authenticated');
  });

  teste('a função interna NÃO é exposta ao app', () => {
    // Ela pula toda a validação de sessão, de propósito, para o backfill poder
    // rodar no SQL Editor. Exposta, seria um caminho para lançar despesa sem
    // permissão nenhuma.
    contem(SQL, 'revoke all on function public.financeiro_folha_sincronizar(uuid) from anon, authenticated');
  });

  teste('reabrir CANCELA, não apaga', () => {
    // Apagar levaria junto a informação de que aquele mês chegou a ser fechado.
    contem(SQL, "set status = 'cancelado'");
    naoContem(SQL, 'delete from public.financeiro_lancamentos');
  });

  teste('o espelho não sobrescreve o que alguém classificou', () => {
    // Centro de custo, observação e forma de pagamento ficam fora do update.
    contem(SQL, 'categoria_id  = coalesce(l.categoria_id, v_cat)');
    naoContem(SQL, 'centro_custo_id = null');
  });

  teste('fechar sem data de pagamento não inventa uma', () => {
    contem(SQL, "case when f.data_pagamento is null then 'pendente' else 'pago' end");
  });

  teste('o backfill só toca folha FECHADA e é idempotente', () => {
    contem(SQL, "from public.folhas where status = 'fechada'");
    contem(SQL, 'perform public.financeiro_folha_sincronizar(r.id)');
  });

  teste('o desfazer devolve o estado anterior por inteiro', () => {
    contem(DESFAZER, "delete from public.financeiro_lancamentos where origem = 'folha'");
    contem(DESFAZER, 'drop function if exists public.financeiro_lancar_folha(uuid)');
    contem(DESFAZER, 'drop column if exists folha_id');
    contem(DESFAZER, "check (origem in ('manual', 'planilha', 'vendas'))");
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · a tela da folha', () => {
  const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');

  teste('fechar lança, reabrir cancela', () => {
    contem(ui, 'lancarFolhaNoFinanceiro');
    igual((ui.match(/espelharNoFinanceiro\(\)/g) || []).length, 3,
          'a chamada tem que existir no fechar, no reabrir e na definição');
  });

  teste('a confirmação diz o nome da despesa ANTES de fechar', () => {
    // Fechar a folha passou a mexer no caixa da empresa. Descobrir isso depois
    // é descobrir tarde.
    contem(ui, 'descricaoDespesaDaFolha(_folha.competencia)');
    contem(ui, 'No Financeiro: despesa');
  });

  teste('falhar no lançamento não desfaz o fechamento', () => {
    // Mesma regra de `publicarContracheques`: a folha fechada é o registro do
    // pagamento, e travá-la por causa do caixa deixaria o mês aberto por um
    // motivo que nada tem a ver com o dinheiro pago.
    contem(ui, 'traduzirErroLancamento');
    contem(ui, 'return null;');
  });

  teste('a mensagem de erro diz em que estado a folha ficou', () => {
    igual(traduzirErroLancamento('sem permissao equipe.folha'),
          'A folha está salva, mas você não tem permissão para lançá-la no Financeiro.');
    contem(traduzirErroLancamento('Could not find the function'),
           'db/financeiro_folha_despesa.sql');
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · o drawer da despesa', () => {
  const form = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');

  teste('o espelho não é anunciado como importação', () => {
    // O ramo de importação diz "custos.csv" ou "Vendas.xlsx" — as duas únicas
    // origens que ele conhecia. Sem o `else`, a despesa da folha ganharia um
    // aviso apontando para uma planilha de onde ela nunca veio.
    contem(form, "if (l.origem === 'folha')");
    contem(form, "} else if (l.origem && l.origem !== 'manual') {");
  });

  teste('e avisa que o valor é reescrito no próximo fechamento', () => {
    contem(form, 'Origem: folha de pagamento');
    contem(form, 'reabra a folha');
  });
});

// ───────────────────────────────────────────────────────────
grupo('folha no financeiro · a planilha manda no passado', () => {
  // As FOPAG de out/2023 a mai/2026 vieram da planilha de despesas, marcadas em
  // `metadata.folha` (db/gerador_custos.mjs). Elas são despesa lançada E são
  // folha: sem esse reconhecimento, o mês somaria a linha importada mais a
  // apuração de folhas/folha_itens — a mesma dupla contagem que a importação
  // antiga evitava jogando as FOPAG fora.
  const FOPAG = {
    tipo: 'despesa', origem: 'planilha', competencia: '2026-05-01',
    descricao: 'FOPAG REF: ABRIL', valor: 8157.74, status: 'pago',
    pago_em: '2026-05-04', metadata: { folha: true },
  };

  teste('a FOPAG importada é folha, mesmo com origem planilha', () => {
    ok(ehDespesaDeFolha(FOPAG));
    // E uma despesa comum da mesma importação continua sendo despesa.
    ok(!ehDespesaDeFolha({ tipo: 'despesa', origem: 'planilha', descricao: 'Energia',
                           metadata: {} }));
    ok(!ehDespesaDeFolha({ origem: 'planilha', metadata: { folha: false } }));
  });

  teste('onde a planilha respondeu, a apuração não soma junto', () => {
    const meses = folhaDoPeriodo([FOPAG], [{ competencia: '2026-05-01', total: 8157.74 }]);
    igual(meses.length, 1, 'a competência não pode aparecer duas vezes');
    igual(meses[0].total, 8157.74);
    ok(meses[0].lancado);
  });

  teste('duas FOPAG no mesmo mês somam — é o que a planilha traz em 2026', () => {
    // fev/26, mar/26, abr/26 e mai/26 têm a folha e mais R$ 2.000,00.
    const meses = folhaDoPeriodo([
      FOPAG,
      { ...FOPAG, descricao: 'FOPAG REF: ABRIL', valor: 2000 },
    ], []);
    igual(meses[0].total, 10157.74);
  });

  teste('a FOPAG não entra como despesa de operação na série do ano', () => {
    const serie = serieAnual([FOPAG, {
      tipo: 'despesa', competencia: '2026-05-01', valor: 500, status: 'pago',
      pago_em: '2026-05-06', origem: 'planilha', metadata: {},
    }], [{ competencia: '2026-05-01', total: 8157.74 }], '2026');
    igual(serie[4].despesa, 500);
    igual(serie[4].folha, 8157.74);
    igual(serie[4].custo, 8657.74, 'a folha entrou duas vezes');
  });

  teste('o espelho da folha cede a vez à planilha, no banco', () => {
    // A trava não pode viver só na tela: rodar o backfill depois da importação
    // criaria o segundo lançamento do mesmo mês.
    contem(SQL, "l.metadata ->> 'folha' = 'true'");
    contem(SQL, "'planilha'::text");
  });
});
