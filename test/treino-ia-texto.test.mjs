// ═══════════════════════════════════════════════════════════
// O QUE A IA LÊ AO EVOLUIR/AJUSTAR — treino atual e cargas
// ═══════════════════════════════════════════════════════════
// Três buracos fechados aqui: a IA só via a ÚLTIMA sessão de carga; não via
// descanso/cadência/RIR/drop/observação; e não via o B dos bi-sets.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { montarTextoTreino, montarTextoProgressao, SESSOES_POR_EXERCICIO } from '../js/treino-ia-texto.js';
import handler from '../api/gerar-treino.js';

const ex = nome => ({ nome });
const ITENS = [
  { id: 'a1', dia: 'A', ordem: 0, exercicio: ex('Supino na máquina'), series: 4, repeticoes: '8-10', carga: '40kg',
    descanso: '90s', cadencia: '3-0-1', rir: '1-2', metodo: 'Drop-set', drop_ultimas: 2, observacao: 'Aparelho: Supino articulado reto' },
  { id: 'a2', dia: 'A', ordem: 1, exercicio: ex('Rosca direta com barra'), series: 3, repeticoes: '10-12', descanso: '60s',
    metodo: 'Bi-set', grupo_id: 'a2', grupo_pos: 'A', rir: '1' },
  { id: 'a3', dia: 'A', ordem: 1, exercicio: ex('Tríceps pulley (polia)'), series: 3, repeticoes: '12', grupo_id: 'a2', grupo_pos: 'B' },
  { id: 'b1', dia: 'B', ordem: 0, exercicio: ex('Leg press'), series: 4, repeticoes: '10' },
];

grupo('treinos · texto do treino atual para a IA', () => {
  const txt = montarTextoTreino(ITENS);

  teste('descanso, cadência, RIR, drop e observação vão junto', () => {
    contem(txt, '1. Supino na máquina — 4x 8-10 · carga 40kg · descanso 90s · cadência 3-0-1 · RIR 1-2 · Drop-set (últimas 2) · obs: Aparelho: Supino articulado reto');
  });

  teste('O BI-SET VAI COMO BLOCO, COM O B', () => {
    contem(txt, '2. Bi-set (descanso 60s após o par):');
    contem(txt, 'A) Rosca direta com barra — 3x 10-12 · RIR 1');
    contem(txt, 'B) Tríceps pulley (polia) — 3x 12');
  });

  teste('o B não aparece solto como exercício próprio', () => {
    igual((txt.match(/Tríceps pulley/g) || []).length, 1);
  });

  teste('dias em ordem, numerados', () => {
    ok(txt.indexOf('Dia A:') < txt.indexOf('Dia B:'));
    contem(txt, 'Dia B:\n  1. Leg press — 4x 10');
  });
});

grupo('treinos · histórico de cargas para a IA', () => {
  const regs = new Map([
    ['a1', [
      { data: '2026-11-05', series_realizadas: [{ peso: 45, reps: 8 }, { peso: 45, reps: 7 }] },
      { data: '2026-10-29', series_realizadas: [{ peso: 42.5, reps: 9 }] },
      { data: '2026-10-22', carga_realizada: 40, reps_realizadas: 10 },
      { data: '2026-10-15', carga_realizada: 40, reps_realizadas: 9 },
      { data: '2026-10-08', carga_realizada: 37.5, reps_realizadas: 10 },
    ]],
    ['a3', [{ data: '2026-11-05', series_realizadas: [{ peso: 25, reps: 12 }] }]],
    ['b1', [{ data: '2026-11-04' }]],   // sessão sem carga: não conta
  ]);
  const txt = montarTextoProgressao(ITENS, regs);

  teste(`AS ÚLTIMAS ${SESSOES_POR_EXERCICIO} SESSÕES, COM DATA — não só a última`, () => {
    contem(txt, 'Supino na máquina — 5 sessões; mais recentes primeiro: 05/11: 45x8, 45x7 | 29/10: 42.5x9 | 22/10: 40kg x 10 | 15/10: 40kg x 9');
    ok(!txt.includes('08/10'), 'a quinta sessão fica de fora do detalhe');
  });

  teste('o B do bi-set tem carga própria', () => {
    contem(txt, 'Tríceps pulley (polia) (B do bi-set) — 1 sessões');
  });

  teste('sessão sem carga não vira linha', () => {
    ok(!txt.includes('Leg press'));
  });

  teste('sem registro nenhum, diz isso', () => {
    igual(montarTextoProgressao(ITENS, new Map()), 'O aluno ainda não registrou cargas.');
  });
});

// ── API: o par do bi-set ────────────────────────────────────
const BIB = [
  { id: 'x1', nome: 'Rosca direta com barra' }, { id: 'x2', nome: 'Tríceps pulley (polia)' }, { id: 'x3', nome: 'Leg press' },
];

async function chamar(body, plano) {
  process.env.ANTHROPIC_API_KEY = 'teste';
  const enviado = {};
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, o) => {
    enviado.prompt = JSON.parse(o.body).messages[0].content;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(plano) }], stop_reason: 'end_turn' }) };
  };
  const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
  try { await handler({ method: 'POST', body }, res); } finally { globalThis.fetch = original; }
  return { res, prompt: enviado.prompt };
}

const plano = exercicios => ({ nome: 'T', dias: [{ dia: 'A', exercicios }], relatorio: {} });

grupo('treinos · bi-set gerado pela IA', () => {
  teste('bi-set com par válido passa inteiro', async () => {
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB },
      plano([{ exercicio_id: 'x1', series: 3, metodo: 'Bi-set', par: { exercicio_id: 'x2', repeticoes: '12' } }]));
    const e = res.body.dias[0].exercicios[0];
    igual(e.metodo, 'Bi-set');
    igual(e.par.exercicio_id, 'x2');
  });

  teste('PAR INVÁLIDO DESFAZ O BI-SET E AVISA', async () => {
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB }, plano([
      { exercicio_id: 'x1', metodo: 'Bi-set' },                                   // sem par
      { exercicio_id: 'x3', metodo: 'Bi-set', par: { exercicio_id: 'x3' } },     // A = B
      { exercicio_id: 'x2', metodo: 'Bi-set', par: { exercicio_id: 'nao-existe' } },
    ]));
    for (const e of res.body.dias[0].exercicios) {
      igual(e.metodo, 'Normal');
      ok(!e.par);
    }
    contem(res.body.relatorio.descartados, 'Bi-sets desfeitos');
    contem(res.body.relatorio.descartados, 'A e B iguais');
  });

  teste('par sem "Bi-set" no método vira Bi-set', async () => {
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB },
      plano([{ exercicio_id: 'x1', metodo: 'Normal', par: { exercicio_id: 'x2' } }]));
    igual(res.body.dias[0].exercicios[0].metodo, 'Bi-set');
  });

  teste('com inventário, o B também precisa caber', async () => {
    const inventario = { disponiveis: [{ id: 'EQ22', tipo: 'equipamento', nome: 'Cross over' }], ausentes: [] };
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB, inventario },
      plano([{ exercicio_id: 'x1', equipamento_id: 'EQ22', metodo: 'Bi-set', par: { exercicio_id: 'x2', equipamento_id: 'EQ99' } }]));
    igual(res.body.dias[0].exercicios[0].metodo, 'Normal');
    contem(res.body.relatorio.descartados, 'B fora do inventário');
  });

  teste('o prompt ensina o formato do par e não proíbe mais o bi-set', async () => {
    const { prompt } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB }, plano([{ exercicio_id: 'x1' }]));
    contem(prompt, '"par": { "exercicio_id": "id-do-B"');
    contem(prompt, '(NÃO use tri-set/super-set)');
  });
});

grupo('treinos · gravação do bi-set gerado', () => {
  const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
  teste('A vira âncora e B aponta para ele, como no editor', () => {
    contem(ui, "await atualizarItem(a.id, { grupo_id: a.id, grupo_pos: 'A' });");
    contem(ui, "grupo_id: a.id,\n            grupo_pos: 'B',");
  });
});
