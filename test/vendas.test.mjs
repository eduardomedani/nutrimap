// ═══════════════════════════════════════════════════════════
// IMPORTAÇÃO DE VENDAS — leitor de .xlsx e o SQL gerado
// ═══════════════════════════════════════════════════════════
// O leitor é caseiro porque o projeto não tem node_modules, então ele precisa
// de teste mais do que uma biblioteca teria: os três pontos onde um leitor de
// xlsx erra em silêncio são o epoch da data, o índice do sharedStrings e o
// cabeçalho local do zip. Errar qualquer um produz números plausíveis e
// errados — o pior tipo de defeito num módulo financeiro.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  serialParaISO, lerSharedStrings, lerEstilosDeData, lerLinhas, lerVendas, montarSql, soma, pacoteDe,
} from '../db/gerador_vendas.mjs';
import { soma as somaCustos } from '../db/gerador_custos.mjs';

// ───────────────────────────────────────────────────────────
grupo('xlsx · data é número de série, e o epoch tem uma pegadinha', () => {
  teste('o epoch é 30/12/1899, não 01/01/1900', () => {
    // A Microsoft manteve o bug do bissexto de 1900 do Lotus 1-2-3: existe um
    // 29/02/1900 que nunca existiu. Por isso o epoch da conversão é 30/12/1899
    // e não 31/12. Usar a data "certa" erraria TODAS as datas em um dia — e um
    // dia na virada do mês joga a venda na competência errada.
    igual(serialParaISO(45222), '2023-10-23');
    igual(serialParaISO(46027), '2026-01-05');
    igual(serialParaISO(43863), '2020-02-02');
    igual(serialParaISO(61), '1900-03-01');
  });

  teste('serial fracionário (data com hora) mantém o dia', () => {
    igual(serialParaISO(45222.75), '2023-10-23');
  });
});

// ───────────────────────────────────────────────────────────
grupo('xlsx · sharedStrings e estilos', () => {
  teste('o texto da célula vem por índice', () => {
    const xml = '<sst><si><t>Mensal - 5x</t></si><si><t>Suplemento</t></si></sst>';
    igual(lerSharedStrings(xml), ['Mensal - 5x', 'Suplemento']);
  });

  teste('<si> partida em vários <t> vira um texto só', () => {
    // Acontece quando parte do texto está formatada diferente. Ler só o
    // primeiro <t> truncaria o nome do cliente sem avisar.
    const xml = '<sst><si><r><t>Ana </t></r><r><t>Paula</t></r></si></sst>';
    igual(lerSharedStrings(xml), ['Ana Paula']);
  });

  teste('entidade XML é desescapada', () => {
    igual(lerSharedStrings('<sst><si><t>Sa&#250;de &amp; Cia</t></si></sst>'), ['Saúde & Cia']);
  });

  teste('formato com d/m/y marca a coluna como data', () => {
    const xml = `<styleSheet>
      <numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>
               <numFmt numFmtId="165" formatCode="0.00"/></numFmts>
      <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs>
    </styleSheet>`;
    igual(lerEstilosDeData(xml), [false, true, false, true]);
  });

  teste('"d" dentro de texto entre aspas não faz virar data', () => {
    const xml = `<styleSheet>
      <numFmts><numFmt numFmtId="166" formatCode="&quot;dias&quot;\\ 0"/></numFmts>
      <cellXfs><xf numFmtId="166"/></cellXfs>
    </styleSheet>`;
    igual(lerEstilosDeData(xml), [false]);
  });

  teste('o "d" de [Red] não faz a coluna de moeda virar data', () => {
    // Formato real da planilha "Pagamentos": moeda com negativo em vermelho.
    // Lendo o [Red] como código de data, a coluna Valor virava 1900-10-26.
    const xml = `<styleSheet>
      <numFmts><numFmt numFmtId="8" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/></numFmts>
      <cellXfs><xf numFmtId="8"/></cellXfs>
    </styleSheet>`;
    igual(lerEstilosDeData(xml), [false]);
  });

  teste('locale entre colchetes não basta para virar data', () => {
    const xml = `<styleSheet>
      <numFmts><numFmt numFmtId="167" formatCode="[$-416]#,##0.00"/></numFmts>
      <cellXfs><xf numFmtId="167"/></cellXfs>
    </styleSheet>`;
    igual(lerEstilosDeData(xml), [false]);
  });

  teste('data de verdade continua sendo data depois dos descartes', () => {
    const xml = `<styleSheet>
      <numFmts><numFmt numFmtId="168" formatCode="[$-416]dd/mm/yyyy;@"/></numFmts>
      <cellXfs><xf numFmtId="168"/></cellXfs>
    </styleSheet>`;
    igual(lerEstilosDeData(xml), [true]);
  });
});

// ───────────────────────────────────────────────────────────
grupo('xlsx · células viram linhas', () => {
  const shared = ['Nome', 'Mensal - 5x', 'Angela', 'PIX'];
  const ehData = [false, true];
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" s="1"><v>45222</v></c><c r="D2" t="s"><v>2</v></c>
                <c r="E2" t="s"><v>1</v></c><c r="F2"><v>350</v></c>
                <c r="J2" t="s"><v>3</v></c></row>
  </sheetData></worksheet>`;

  const linhas = lerLinhas(sheet, shared, ehData);

  teste('coluna vazia no meio não desloca as seguintes', () => {
    // A célula B2 e C2 não existem no XML. Se o leitor empilhasse por ordem de
    // aparição, o nome cairia na coluna do mês e tudo depois andaria.
    const c = linhas[1].celulas;
    igual(c[0], '2023-10-23');
    igual(c[3], 'Angela');
    igual(c[4], 'Mensal - 5x');
    igual(c[5], 350);
    igual(c[9], 'PIX');
  });

  teste('a referência da coluna é decodificada de A..Z e além', () => {
    const s = `<worksheet><row r="1"><c r="AA1"><v>7</v></c></row></worksheet>`;
    igual(lerLinhas(s, [], [])[0].celulas[26], 7);
  });

  teste('célula vazia autofechada não rouba o valor da seguinte', () => {
    // O Excel escreve <c r="B1" s="6"/> para a célula que tem só formatação.
    // Casando o </c> da célula seguinte, o leitor gravava 42 na coluna B e
    // perdia a C — a linha inteira andava sem aviso.
    const s = `<worksheet><row r="1">` +
              `<c r="A1"><v>1</v></c><c r="B1" s="6"/><c r="C1"><v>42</v></c>` +
              `</row></worksheet>`;
    const c = lerLinhas(s, [], [])[0].celulas;
    igual(c[0], 1);
    igual(c[1], null);   // a célula existe e está vazia — não é o 42 da C
    igual(c[2], 42);
  });
});

// ───────────────────────────────────────────────────────────
grupo('vendas · o que entra e o que fica de fora', () => {
  // Cabeçalho + as situações reais da planilha do Eduardo.
  const linhas = [
    { num: 1, celulas: ['Data', 'Mês', 'Ano', 'Nome', 'Pacote', 'Valor', 'DESCONTO', '% Desconto', 'Pago', 'Forma', 'OBS'] },
    { num: 2, celulas: ['2026-05-11', 5, 2026, 'Marlucia Helmer Vaz', 'Mensal - 3x', 330, 13, null, null, 'PIX', null] },
    { num: 3, celulas: ['2026-04-29', 4, 2026, 'Luana Alves Sant\'Ana', 13, null, null, null, null, null, null] },
    { num: 4, celulas: ['0', 0, 0, 'Daiane Zuccolotto Falqueto', 'Mensal - 5x', 350, 13, null, null, null, null] },
    { num: 5, celulas: ['2026-01-15', 1, 2026, 'Fulano', 'Diária', 30, 13, null, 'Não', 'DINHEIRO', 'devolvido'] },
    { num: 6, celulas: [null, null, null, null, null, null, null, null, null, null, null] },
  ];

  const { dentro, fora } = lerVendas(linhas);

  teste('linha sem data válida fica de fora, e é nomeada', () => {
    // Sem data não há competência, e competência é NOT NULL. Chutar a data pelo
    // vizinho decidiria o mês de uma venda no palpite.
    igual(fora.map(r => r.linha), [4]);
    igual(fora[0].nome, 'Daiane Zuccolotto Falqueto');
  });

  teste('linha totalmente vazia não vira lançamento', () => {
    igual(dentro.map(r => r.linha), [2, 3, 5]);
  });

  teste('pacote numérico não vira categoria — a coluna escorregou', () => {
    igual(dentro.find(r => r.linha === 3).pacote, '');
  });

  teste('as grafias duplicadas do Trimestral são unificadas na importação', () => {
    // A correção mora no GERADOR, não só no banco: arrumar as categorias pelo
    // app e reimportar depois traria "Trimestral - 5x" de volta, e ninguém
    // desconfiaria — a categoria certa continuaria existindo, com metade das
    // vendas. A forma sem hífen é a correta (Eduardo, 05/08/2026).
    igual(pacoteDe('Trimestral - 5x'), 'Trimestral 5x');
    igual(pacoteDe('Trimestral - 3x'), 'Trimestral 3x');
    igual(pacoteDe('trimestral - 5x'), 'Trimestral 5x', 'a comparação ignora caixa');
    igual(pacoteDe('  Trimestral - 3x  '), 'Trimestral 3x', 'espaço em volta não escapa');
  });

  teste('só a variação comprovada é unificada — nome parecido não basta', () => {
    // Semestral e Mensal só existem com hífen na planilha: não há o que juntar,
    // e "normalizar" por semelhança inventaria um plano que não existe.
    igual(pacoteDe('Mensal - 5x'), 'Mensal - 5x');
    igual(pacoteDe('Semestral - 3x'), 'Semestral - 3x');
    igual(pacoteDe('Trimestral 5x'), 'Trimestral 5x');
    igual(pacoteDe('camisas'), 'camisas');
  });

  teste('"Pago" em branco é recebido; "Não" é em aberto', () => {
    igual(dentro.find(r => r.linha === 2).pago, true);
    igual(dentro.find(r => r.linha === 5).pago, false);
  });

  teste('forma de pagamento e observação viajam juntas', () => {
    igual(dentro.find(r => r.linha === 5).forma, 'DINHEIRO');
    igual(dentro.find(r => r.linha === 5).obs, 'devolvido');
  });
});

// ───────────────────────────────────────────────────────────
grupo('vendas · o SQL gerado', () => {
  const linhas = [
    { num: 1, celulas: ['Data', 'Mês', 'Ano', 'Nome', 'Pacote', 'Valor', 'DESCONTO', '% Desconto', 'Pago', 'Forma', 'OBS'] },
    { num: 2, celulas: ['2026-05-11', 5, 2026, 'Luana Alves Sant\'Ana', 'Mensal - 3x', 330, 13, null, null, 'PIX', null] },
    { num: 3, celulas: ['2026-04-29', 4, 2026, 'Sem Pacote', null, null, 165, 0.43, null, null, null] },
  ];
  const sql = montarSql(linhas);

  teste('apóstrofo no nome do cliente é escapado', () => {
    contem(sql, "'Luana Alves Sant''Ana'");
  });

  teste('o lançamento é receita, não despesa', () => {
    contem(sql, "'receita'");
    naoContem(sql, "v_nutri, 'despesa'", 'venda não é despesa');
  });

  teste('DESCONTO e % Desconto não entram', () => {
    // As duas colunas estão inconsistentes na planilha: em 1.627 linhas
    // "DESCONTO" vale 13 seja qual for o valor. Nenhuma delas é caixa.
    const valores = sql.slice(sql.indexOf('insert into public.financeiro_lancamentos'),
                              sql.indexOf('as v(linha,'));
    naoContem(valores, ', 13,', 'a coluna DESCONTO vazou para o insert');
    naoContem(valores, '0.43', 'a taxa de desconto vazou para o insert');
    contem(valores, '330.00', 'o valor recebido é o que entra');
  });

  teste('valor ausente vira null tipado, não zero', () => {
    contem(sql, 'null::numeric');
  });

  teste('a competência é derivada da data, como o CHECK do banco exige', () => {
    contem(sql, "date_trunc('month', v.data)::date");
  });
});

// ───────────────────────────────────────────────────────────
grupo('importação · as duas planilhas não se atropelam', () => {
  // ESTE É O TESTE QUE IMPORTA MAIS NESTE ARQUIVO. Cada seed apaga e recria o
  // que trouxe, filtrando por `origem`. Se os dois usassem a mesma marca,
  // reimportar os custos apagaria as 2.177 vendas em silêncio, e o estrago só
  // apareceria no total do mês seguinte.
  const custos = readFileSync(new URL('../db/gerador_custos.mjs', import.meta.url), 'utf8');
  const vendas = readFileSync(new URL('../db/gerador_vendas.mjs', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../db/financeiro_lancamentos.sql', import.meta.url), 'utf8');

  teste('custos apaga só a própria origem', () => {
    const i = custos.indexOf('delete from public.financeiro_lancamentos');
    ok(i > 0, 'sumiu o delete do gerador de custos');
    contem(custos.slice(i, i + 200), "origem = 'planilha'");
  });

  teste('vendas apaga só a própria origem', () => {
    const i = vendas.indexOf('delete from public.financeiro_lancamentos');
    ok(i > 0, 'sumiu o delete do gerador de vendas');
    contem(vendas.slice(i, i + 200), "origem = 'vendas'");
  });

  teste('as duas marcas são diferentes', () => {
    ok(custos.includes("'planilha', v.linha"), 'custos precisa gravar origem planilha');
    ok(vendas.includes("'vendas', v.linha"), 'vendas precisa gravar origem vendas');
  });

  teste('o schema aceita as quatro origens', () => {
    // A quarta é 'folha', e é a única que o próprio sistema escreve: o espelho
    // de uma folha fechada (db/financeiro_folha_despesa.sql). As três de
    // importação continuam intocadas — o que importa aqui é que as marcas não
    // se misturem, porque cada seed apaga o que trouxe filtrando por elas.
    contem(schema, "check (origem in ('manual', 'planilha', 'vendas', 'folha'))");
  });

  teste('nenhum dos dois usa truncate', () => {
    naoContem(custos, 'truncate');
    naoContem(vendas, 'truncate');
  });

  teste('os dois gravam `status` explicitamente', () => {
    // A coluna tem default 'pendente' e um trigger que sincroniza pago<->status.
    // Omitir status faria o default vencer, o trigger concluir pago = false, e
    // TODOS os lançamentos virarem pendentes na reimportação — sem erro nenhum
    // na tela, que é o pior jeito de um número ficar errado.
    for (const [nome, src] of [['custos', custos], ['vendas', vendas]]) {
      contem(src, "case when v.pago then 'pago' else 'pendente' end", `${nome} sem status`);
      contem(src, 'case when v.pago then v.data else null end', `${nome} sem pago_em`);
      ok(/pago, status, pago_em,/.test(src), `${nome}: status fora da lista de colunas`);
    }
  });

  teste('o total esperado bate com o que o Postgres soma', () => {
    // ACONTECEU: o cabeçalho do seed de vendas declarava R$ 593.781,26 e o
    // banco devolveu R$ 593.781,27, porque a soma em float acumula erro e o
    // `sum(numeric)` do Postgres não. Um esperado errado por um centavo ensina
    // quem confere a ignorar divergência — e a próxima é de mil reais.
    const trapaca = [{ valor: 0.1 }, { valor: 0.2 }];
    igual(soma(trapaca), 0.3);
    igual(somaCustos(trapaca), 0.3);
    igual(soma(Array(100).fill({ valor: 0.01 })), 1);
    igual(soma([{ valor: null }, { valor: 10 }]), 10, 'sem valor não entra na soma');
  });
});
