// Regras de cálculo da dieta. Este arquivo é o contrato: se algum destes
// testes precisar mudar, alguém está mudando a prescrição de todos os planos
// já salvos — e isso é uma decisão, não um refactor.

import { grupo, teste, igual, perto, ok } from './runner.mjs';
import {
  BASE_G, pesoDeItem, quantidadeDePeso, gramasDeMedida, medidaDoItem, MEDIDA_GRAMAS,
  macrosItem, macrosRefeicao, macrosPlano, distribuicaoMacros, progresso, statusMeta,
} from '../js/dieta-calc.js';

// Arroz cozido, valores por 100 g.
const ARROZ = { id: 'f1', nome: 'Arroz, tipo 1, cozido', calorias: 128, proteina: 2.5, carboidrato: 28.1, gordura: 0.2, fibra: 1.6 };
const MEDIDAS_ARROZ = [
  { descricao: 'colher de sopa cheia', gramas: 25 },
  { descricao: 'escumadeira', gramas: 90 },
];

grupo('dieta-calc · quantidade é múltiplo de 100 g', () => {
  teste('BASE_G é 100 — o contrato do banco', () => {
    igual(BASE_G, 100);
  });

  teste('pesoDeItem converte múltiplo para gramas', () => {
    igual(pesoDeItem({ quantidade: 1 }), 100);
    igual(pesoDeItem({ quantidade: 0.5 }), 50);
    igual(pesoDeItem({ quantidade: 2.5 }), 250);
  });

  teste('quantidadeDePeso é o caminho de volta', () => {
    igual(quantidadeDePeso(100), 1);
    igual(quantidadeDePeso(45), 0.45);
  });

  teste('ida e volta não perde valor', () => {
    for (const g of [1, 25, 45, 90, 137, 250]) {
      perto(pesoDeItem({ quantidade: quantidadeDePeso(g) }), g, 1e-9, `${g} g`);
    }
  });

  teste('entrada inválida vira 0, nunca NaN', () => {
    igual(pesoDeItem({ quantidade: 'abc' }), 0);
    igual(pesoDeItem(null), 0);
    igual(quantidadeDePeso(undefined), 0);
  });
});

grupo('dieta-calc · medida caseira', () => {
  teste('gramasDeMedida multiplica a medida escolhida', () => {
    igual(gramasDeMedida(MEDIDAS_ARROZ, 'colher de sopa cheia', 4), 100);
    igual(gramasDeMedida(MEDIDAS_ARROZ, 'escumadeira', 2), 180);
  });

  teste('sem medida conhecida, o número é em gramas', () => {
    igual(gramasDeMedida(MEDIDAS_ARROZ, MEDIDA_GRAMAS, 150), 150);
    igual(gramasDeMedida(MEDIDAS_ARROZ, null, 150), 150);
    igual(gramasDeMedida([], 'colher inexistente', 150), 150);
  });

  teste('medidaDoItem devolve o rótulo, o n e o peso da linha', () => {
    const sel = medidaDoItem(MEDIDAS_ARROZ, { quantidade: 1, medida: 'colher de sopa cheia' });
    igual(sel.medida, 'colher de sopa cheia');
    perto(sel.gramas, 100);
    perto(sel.n, 4, 1e-9, '100 g = 4 colheres de 25 g');
  });

  teste('item sem medida cai para gramas', () => {
    const sel = medidaDoItem(MEDIDAS_ARROZ, { quantidade: 0.45, medida: null });
    igual(sel.medida, MEDIDA_GRAMAS);
    perto(sel.gramas, 45);
    perto(sel.n, 45);
  });

  teste('trocar de medida mantém o peso (regra clínica)', () => {
    // 100 g de arroz = 4 colheres = 1,11 escumadeira. O peso não muda porque a
    // unidade de exibição mudou — quem muda a prescrição é o campo Qtd.
    const item = { quantidade: 1, medida: 'colher de sopa cheia' };
    const antes = medidaDoItem(MEDIDAS_ARROZ, item);
    const depois = medidaDoItem(MEDIDAS_ARROZ, { ...item, medida: 'escumadeira' });
    perto(antes.gramas, depois.gramas, 1e-9, 'o peso tem que ser o mesmo');
  });
});

grupo('dieta-calc · macros', () => {
  teste('macrosItem escala os valores de 100 g pela quantidade', () => {
    const m = macrosItem({ quantidade: 1.5, food: ARROZ });
    perto(m.kcal, 192);
    perto(m.prot, 3.75);
    perto(m.carb, 42.15);
    perto(m.gord, 0.3);
  });

  teste('item sem alimento não inventa macro', () => {
    const m = macrosItem({ quantidade: 2, food: null });
    perto(m.kcal, 0);
    perto(m.prot, 0);
  });

  teste('macrosRefeicao soma os itens', () => {
    const r = { itens: [
      { quantidade: 1, food: ARROZ },
      { quantidade: 0.5, food: ARROZ },
    ] };
    perto(macrosRefeicao(r).kcal, 192);
    perto(macrosRefeicao(r).carb, 42.15);
  });

  teste('macrosPlano soma as refeições', () => {
    const refs = [
      { itens: [{ quantidade: 1, food: ARROZ }] },
      { itens: [{ quantidade: 1, food: ARROZ }] },
    ];
    perto(macrosPlano(refs).kcal, 256);
  });

  teste('plano vazio soma zero sem quebrar', () => {
    perto(macrosPlano([]).kcal, 0);
    perto(macrosRefeicao({ itens: [] }).kcal, 0);
    perto(macrosPlano(null).kcal, 0);
  });

  teste('distribuicaoMacros devolve percentuais que fecham em ~100', () => {
    const d = distribuicaoMacros({ prot: 100, carb: 100, gord: 44.4, kcal: 1200 });
    const soma = d.prot + d.carb + d.gord;
    perto(soma, 100, 1.5, 'os três percentuais somam ~100');
  });
});

grupo('dieta-calc · progresso da meta', () => {
  teste('sem meta, não há percentual', () => {
    const p = progresso(1500, null);
    ok(!p.temMeta, 'não devia ter meta');
  });

  teste('com meta, calcula percentual e o que falta', () => {
    const p = progresso(1500, 2000);
    ok(p.temMeta);
    igual(p.pctReal, 75);
    perto(p.resta, 500);
  });

  teste('acima da meta reporta o excedente', () => {
    const p = progresso(2200, 2000);
    perto(p.excedeu, 200);
  });

  teste('statusMeta classifica sem julgar o que não tem meta', () => {
    igual(statusMeta(1000, null), 'sem-meta');
    igual(statusMeta(1900, 2000), 'perto');
    igual(statusMeta(2500, 2000), 'excesso');
  });
});
