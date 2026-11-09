// ═══════════════════════════════════════════════════════════
// BASE EVOLLO NA EVOLUÇÃO — base_id, Evoluir com referência e Novo ciclo
// ═══════════════════════════════════════════════════════════
// O treino passa a lembrar de qual modelo veio (treinos.base_id). Com isso:
//   · Evoluir usa o modelo de origem como referência ("mantenha o mesmo
//     treino base", seção 6 do prompt do gerador);
//   · Novo ciclo troca por OUTRO modelo da mesma combinação (ou do nível
//     seguinte) e mantém os exercícios que estão evoluindo ("trocar o treino
//     a cada 6 a 10 semanas", seção 5).

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import BASE from '../api/_dados/base-evollo.js';
import { escolherModelo, converterModelo, manterProgredindo } from '../api/_lib/base-evollo.js';
import { exerciciosProgredindo } from '../js/treino-ia-texto.js';
import { A_CRIAR } from '../db/base_evollo/mapa_biblioteca.mjs';
import handler, { montarDaBase, referenciaDaBase } from '../api/gerar-treino.js';

const BIB = JSON.parse(readFileSync(new URL('./dados/base-evollo-biblioteca.json', import.meta.url), 'utf8'))
  .map(([nome, grupo, equipamento]) => ({ id: `id:${nome}`, nome, grupo, equipamento }))
  .concat(A_CRIAR.map(c => ({ id: `id:${c.nome}`, nome: c.nome, grupo: c.grupo_muscular, equipamento: c.equipamento })));
const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
const dados = readFileSync(new URL('../js/treinos.js', import.meta.url), 'utf8');

grupo('base evollo · o treino lembra o modelo (base_id)', () => {
  teste('o treino gerado grava o modelo', () => {
    contem(ui, 'criarTreinoComBase(nutriId, {');
    contem(ui, "}, plano.base?.id || null);");
  });

  teste('sem a coluna no banco, grava sem ela em vez de falhar', () => {
    contem(dados, "if (/base_id/.test(`${e?.message || ''} ${e?.details || ''}`)) return criarTreino(nutriId, dados);");
  });

  teste('duplicar, prescrever modelo e salvar na biblioteca levam o base_id', () => {
    igual((dados.match(/\.\.\.comBase\((modelo|origem)\),/g) || []).length, 3);
  });

  teste('a migração existe e é re-executável', () => {
    const sql = readFileSync(new URL('../db/treino_base_id.sql', import.meta.url), 'utf8');
    contem(sql, 'add column if not exists base_id text');
  });
});

grupo('base evollo · quem está evoluindo', () => {
  const it = (id, exercicio_id) => ({ id, exercicio_id });
  const regs = new Map([
    ['subiu',   [{ series_realizadas: [{ peso: 50, reps: 8 }] }, { series_realizadas: [{ peso: 45, reps: 10 }] }]],
    ['reps',    [{ carga_realizada: 40, reps_realizadas: 12 }, { carga_realizada: 40, reps_realizadas: 10 }]],
    ['parado',  [{ series_realizadas: [{ peso: 30, reps: 10 }] }, { series_realizadas: [{ peso: 30, reps: 10 }] }]],
    ['caiu',    [{ series_realizadas: [{ peso: 20, reps: 10 }] }, { series_realizadas: [{ peso: 25, reps: 10 }] }]],
    ['uma',     [{ series_realizadas: [{ peso: 20, reps: 10 }] }]],
  ]);
  teste('carga subiu, ou mais repetições com a mesma carga', () => {
    const r = exerciciosProgredindo([it('subiu', 'A'), it('reps', 'B'), it('parado', 'C'), it('caiu', 'D'), it('uma', 'E')], regs);
    igual(r.sort().join(','), 'A,B');
  });
});

grupo('base evollo · novo ciclo', () => {
  const comb = { nivel: 'Intermediário', objetivo: 'Hipertrofia', dias: 4, enfase: 'equilibrado' };

  teste('OUTRO MODELO DA MESMA COMBINAÇÃO', () => {
    const atual = escolherModelo(BASE, comb, () => 0).modelo;
    const novo = escolherModelo(BASE, { ...comb, excluir: [atual.id] }, () => 0).modelo;
    ok(novo.id !== atual.id, `${atual.id} → ${novo.id}`);
    igual([novo.nivel, novo.objetivo, novo.freq, novo.enfase].join('|'), [atual.nivel, atual.objetivo, atual.freq, atual.enfase].join('|'));
  });

  teste('O QUE ESTÁ EVOLUINDO CONTINUA, NO LUGAR DO EQUIVALENTE', () => {
    const m = BASE.treinos.find(t => t.id === 'INT-37') || BASE.treinos.find(t => t.nivel === 'Intermediário');
    const conv = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    // Um supino que não está no modelo, mas está evoluindo.
    const dia = conv.dias.find(d => d.exercicios.some(e => BASE.exercicios[e._base]?.g === 'Peito' && BASE.exercicios[e._base]?.t === 'C'));
    const noModelo = new Set(dia.exercicios.map(e => e.exercicio_id));
    const fora = ['id:Supino reto com barra', 'id:Supino inclinado com barra', 'id:Supino reto com halteres'].find(id => !noModelo.has(id));
    const notas = manterProgredindo(BASE, conv.dias, { biblioteca: BIB, progredindo: [fora] });
    ok(dia.exercicios.some(e => e.exercicio_id === fora), 'o supino que evolui entrou no dia');
    contem(notas.join('\n'), 'está evoluindo');
    const ids = dia.exercicios.map(e => e.exercicio_id);
    igual(new Set(ids).size, ids.length, 'sem repetir no dia');
  });

  teste('exercício fora da base ou que não cabe mais não entra', () => {
    const m = BASE.treinos[60];
    const conv = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    igual(manterProgredindo(BASE, conv.dias, { biblioteca: BIB, progredindo: ['id-que-nao-existe'] }), []);
  });

  async function chamar(body) {
    const chamadas = [];
    const original = globalThis.fetch;
    globalThis.fetch = async () => { chamadas.push(1); throw new Error('não deveria chamar a IA'); };
    const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
    try { await handler({ method: 'POST', body }, res); } finally { globalThis.fetch = original; }
    return { res, chamadas };
  }

  teste('HANDLER: MESMA COMBINAÇÃO, OUTRO MODELO, SEM IA', async () => {
    const { res, chamadas } = await chamar({ modo: 'ciclo', baseIdAtual: 'INT-37', mesmaCombinacao: true,
      criterios: { nivel: 'Iniciante', objetivo: 'Força', dias: 2 },   // ignorados: vale o modelo
      biblioteca: BIB });
    igual(chamadas.length, 0);
    igual(res.code, 200);
    const atual = BASE.treinos.find(t => t.id === 'INT-37');
    const novo = BASE.treinos.find(t => t.id === res.body.base.id);
    ok(novo.id !== 'INT-37');
    igual([novo.nivel, novo.objetivo, novo.freq].join('|'), [atual.nivel, atual.objetivo, atual.freq].join('|'));
    contem(res.body.relatorio.ciclo, `INT-37 → ${novo.id}`);
  });

  teste('handler: subir de nível', async () => {
    const { res } = await chamar({ modo: 'ciclo', baseIdAtual: 'INT-37', mesmaCombinacao: true, subirNivel: true, criterios: {}, biblioteca: BIB });
    igual(res.body.base.nivel, 'Avançado');
    contem(res.body.relatorio.adaptacoes, 'Intermediário → Avançado');
  });

  teste('handler: treino sem modelo usa os campos do formulário', async () => {
    const { res } = await chamar({ modo: 'ciclo', baseIdAtual: null, criterios: { nivel: 'Iniciante', objetivo: 'Adaptação', dias: 3 }, biblioteca: BIB });
    igual(res.body.base.nivel, 'Iniciante');
    igual(res.body.base.id.startsWith('INI-'), true);
  });

  teste('a tela calcula o que evolui e manda o modelo atual', () => {
    contem(ui, 'payload.progredindo = exerciciosProgredindo(itens, await lerProgressoes(itens));');
    contem(ui, 'payload.baseIdAtual = baseIdAtual;');
    contem(ui, "ciclo:   { criar: 0, base: 1, evoluir: 0, ajustar: 0, ciclo: 1, musculos: 1, params: 1 },");
  });
});

grupo('base evollo · evoluir com o modelo de referência', () => {
  teste('a referência traz o modelo e os substitutos da base', () => {
    const r = referenciaDaBase('INT-37', BIB, null);
    contem(r.contexto, 'ESTE TREINO VEIO DO MODELO INT-37');
    contem(r.contexto, 'Mantenha o mesmo treino base');
    ok(r.permitidos.some(p => /· base$/.test(p.grupo)), 'substitutos marcados "base"');
    igual(referenciaDaBase('NAO-EXISTE', BIB, null), null);
  });

  teste('HANDLER: O EVOLUIR RECEBE A REFERÊNCIA E O TREINO NOVO HERDA O MODELO', async () => {
    process.env.ANTHROPIC_API_KEY = 'teste';
    const enviado = {};
    const original = globalThis.fetch;
    globalThis.fetch = async (_u, o) => {
      enviado.prompt = JSON.parse(o.body).messages[0].content;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({
        nome: 'Evoluído', dias: [{ dia: 'A', exercicios: [{ exercicio_id: 'id:Leg press', series: 4, repeticoes: '8-12' }] }], relatorio: {} }) }], stop_reason: 'end_turn' }) };
    };
    const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
    try {
      await handler({ method: 'POST', body: { modo: 'evoluir', baseId: 'INT-37', treinoAtualTexto: 'Dia A:\n  1. Leg press', progressaoTexto: '',
        criterios: {}, exercicios: [{ id: 'id:Leg press', nome: 'Leg press' }], biblioteca: BIB } }, res);
    } finally { globalThis.fetch = original; }
    contem(enviado.prompt, 'MODO: EVOLUIR O TREINO ATUAL');
    contem(enviado.prompt, 'ESTE TREINO VEIO DO MODELO INT-37');
    contem(enviado.prompt, 'Supino reto com barra', 'os substitutos da base entram na lista de exercícios');
    igual(res.body.base.id, 'INT-37');
  });

  teste('evoluir sem base_id segue como antes', () => {
    contem(ui, "if (modo === 'evoluir' && baseIdAtual) payload.baseId = baseIdAtual;");
  });
});
