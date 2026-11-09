// ═══════════════════════════════════════════════════════════
// SELEÇÃO DE EXERCÍCIOS DA IA — o treino de 09/11
// ═══════════════════════════════════════════════════════════
// O treino gerado veio com o MESMO "Pulldown com braços estendidos" 3x no dia
// A, três crucifixos e nenhum supino. Duas causas:
//   1. a amostra enviada à IA era alfabética: dos 25 supinos que cabiam na
//      academia, 5 chegavam (como grupo secundário, nenhum);
//   2. nada impedia o mesmo exercício de se repetir no dia.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { familiaDe, bibliotecaCompacta } from '../js/treino-ia-biblioteca.js';
import handler from '../api/gerar-treino.js';

grupo('treinos · família de movimento', () => {
  teste('nomes reais da biblioteca', () => {
    igual(familiaDe('Supino reto com barra'), 'supino');
    igual(familiaDe('Supino inclinado na máquina articulada'), 'supino');
    igual(familiaDe('Crucifixo na máquina (voador)'), 'crucifixo');
    igual(familiaDe('Crossover na polia'), 'crucifixo');
    igual(familiaDe('Elevação lateral sentado'), 'elevacao lateral');
    igual(familiaDe('Elevação frontal com halteres'), 'elevacao frontal');
    igual(familiaDe('Rosca martelo alternada'), 'rosca martelo');
    igual(familiaDe('Cadeira extensora unilateral'), 'cadeira extensora');
    igual(familiaDe('Pulldown com braços estendidos (polia)'), 'pulldown');
    igual(familiaDe('Flexão declinada'), 'flexao', 'todas as flexões de braço são uma família');
    igual(familiaDe('Flexão com pés elevados'), 'flexao');
    igual(familiaDe('Flexão de perna em pé (máquina)'), 'flexao perna');
  });

  teste('alongamento vai por último; composto primeiro', () => {
    const exs = ['Alongamento de peito atrás da cabeça', 'Alongamento dinâmico de peito', 'Cotovelos para trás (alongamento de peito)',
      'Flexão aberta', 'Flexão declinada', 'Crossover na polia', 'Supino reto com barra', 'Supino na máquina']
      .map((nome, i) => ({ id: `x${i}`, nome, grupo_muscular: 'Peito' }));
    const bib = bibliotecaCompacta(exs, [], { comInventario: false, obrigatorios: [] }).slice(0, 3).map(e => e.nome);
    igual(bib[0], 'Supino na máquina', 'composto primeiro, nome mais curto');
    ok(!bib.some(n => /alongamento/i.test(n)), 'alongamento não toma lugar de exercício de força');
  });
});

// Peito como na biblioteca real: em ordem alfabética, os supinos vêm por último.
const peito = [
  ...['Crossover na polia', 'Crossover na polia baixa', 'Crossover unilateral na polia', 'Crucifixo com halteres',
      'Crucifixo declinado com halteres', 'Crucifixo inclinado com halteres', 'Crucifixo inclinado na polia',
      'Crucifixo na máquina (voador)', 'Crucifixo no banco reto na polia', 'Flexão aberta', 'Flexão de braços',
      'Flexão declinada', 'Flexão inclinada', 'Flexão com pés elevados', 'Flexão fechada para tríceps',
      'Supino com halteres pegada neutra', 'Supino declinado com barra', 'Supino inclinado com barra',
      'Supino na máquina articulada', 'Supino reto com barra'],
].map((nome, i) => ({ id: `p${i}`, nome, grupo_muscular: 'Peito', equipamento: '' }));

grupo('treinos · amostra enviada à IA', () => {
  teste('OS SUPINOS CHEGAM MESMO COMO GRUPO SECUNDÁRIO', () => {
    const bib = bibliotecaCompacta(peito, [], { comInventario: true });   // teto 15
    igual(bib.length, 15);
    ok(bib.filter(e => /supino/i.test(e.nome)).length >= 4, 'supino em toda rodada do rodízio');
    ok(bib.some(e => e.nome === 'Supino reto com barra'), 'o nome mais simples primeiro');
  });

  teste('nenhuma família passa de 40% das vagas', () => {
    const bib = bibliotecaCompacta(peito, [], { comInventario: true });   // 15 vagas → máx. 6
    const crucifixos = bib.filter(e => familiaDe(e.nome) === 'crucifixo').length;
    ok(crucifixos <= 6, `crucifixos: ${crucifixos}`);
    igual(bib.filter(e => familiaDe(e.nome) === 'supino').length, 5, 'composto pesa em dobro: os 5 supinos entram');
  });

  teste('o treino atual entra sempre (a IA pode mantê-lo)', () => {
    const bib = bibliotecaCompacta(peito, [], { comInventario: false, obrigatorios: ['p13'] });   // teto 10
    ok(bib.some(e => e.id === 'p13'), 'Flexão com pés elevados, do treino atual');
  });
});

// ── servidor: repetição no dia ───────────────────────────────
const BIB = [
  { id: 'pd', nome: 'Pulldown com braços estendidos (polia)' }, { id: 'v', nome: 'Crucifixo na máquina (voador)' },
  { id: 'c1', nome: 'Crucifixo inclinado com halteres' }, { id: 'c2', nome: 'Crucifixo no banco reto na polia' },
  { id: 's', nome: 'Supino reto com barra' }, { id: 'r', nome: 'Rosca direta com barra' },
];

async function chamar(plano) {
  process.env.ANTHROPIC_API_KEY = 'teste';
  const enviado = {};
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, o) => {
    enviado.prompt = JSON.parse(o.body).messages[0].content;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(plano) }], stop_reason: 'end_turn' }) };
  };
  const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
  try { await handler({ method: 'POST', body: { modo: 'criar', criterios: {}, exercicios: BIB } }, res); }
  finally { globalThis.fetch = original; }
  return { res, prompt: enviado.prompt };
}

grupo('treinos · servidor confere repetição no dia', () => {
  teste('O MESMO EXERCÍCIO 3x NO DIA FICA 1x E VIRA AVISO', async () => {
    const { res } = await chamar({ nome: 'T', dias: [{ dia: 'A', exercicios: [
      { exercicio_id: 'pd' }, { exercicio_id: 'pd' }, { exercicio_id: 'pd' }, { exercicio_id: 's' },
    ] }], relatorio: {} });
    igual(res.body.dias[0].exercicios.map(e => e.exercicio_id).join(','), 'pd,s');
    contem(res.body.relatorio.descartados, 'Exercício repetido no mesmo dia');
  });

  teste('o mesmo exercício em dias diferentes é permitido', async () => {
    const { res } = await chamar({ nome: 'T', dias: [
      { dia: 'A', exercicios: [{ exercicio_id: 'pd' }] }, { dia: 'B', exercicios: [{ exercicio_id: 'pd' }] },
    ], relatorio: {} });
    igual(res.body.dias.length, 2);
    ok(!res.body.relatorio.descartados);
  });

  teste('B do bi-set igual a um exercício do dia desfaz o bi-set', async () => {
    const { res } = await chamar({ nome: 'T', dias: [{ dia: 'A', exercicios: [
      { exercicio_id: 's' }, { exercicio_id: 'r', metodo: 'Bi-set', par: { exercicio_id: 's' } },
    ] }], relatorio: {} });
    const r = res.body.dias[0].exercicios[1];
    igual(r.metodo, 'Normal');
    ok(!r.par);
  });

  teste('três variações da mesma família no dia viram aviso, sem remover', async () => {
    const { res } = await chamar({ nome: 'T', dias: [{ dia: 'A', exercicios: [
      { exercicio_id: 'c1' }, { exercicio_id: 'v' }, { exercicio_id: 'c2' },
    ] }], relatorio: {} });
    igual(res.body.dias[0].exercicios.length, 3);
    contem(res.body.relatorio.descartados, '3× crucifixo');
  });

  teste('o prompt leva as regras de seleção', async () => {
    const { prompt } = await chamar({ nome: 'T', dias: [{ dia: 'A', exercicios: [{ exercicio_id: 's' }] }], relatorio: {} });
    contem(prompt, 'NUNCA repita o mesmo exercicio_id no mesmo dia');
    contem(prompt, 'peito → um supino');
  });
});
