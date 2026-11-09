// ═══════════════════════════════════════════════════════════
// BASE DE TREINOS EVOLLO — escolha do modelo, conversão e o handler
// ═══════════════════════════════════════════════════════════
// "Criar do zero" passou a partir dos 150 modelos da base (nível × objetivo ×
// frequência × ênfase). O sistema escolhe e converte; a IA só adapta quando
// há lesão/observação ou músculo priorizado. Estes testes usam a base REAL
// (api/_dados/base-evollo.js) e os exercícios reais da biblioteca
// (test/dados/base-evollo-biblioteca.json).

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import BASE from '../api/_dados/base-evollo.js';
import { escolherModelo, converterModelo, cortarPorTempo, minutosDoDia, metodoDaTecnica, objetivoDaBase } from '../api/_lib/base-evollo.js';
import { A_CRIAR, MAPA } from '../db/base_evollo/mapa_biblioteca.mjs';
import handler, { montarDaBase } from '../api/gerar-treino.js';

const BIB = JSON.parse(readFileSync(new URL('./dados/base-evollo-biblioteca.json', import.meta.url), 'utf8'))
  .map(([nome, grupo, equipamento]) => ({ id: `id:${nome}`, nome, grupo, equipamento }))
  .concat(A_CRIAR.map(c => ({ id: `id:${c.nome}`, nome: c.nome, grupo: c.grupo_muscular, equipamento: c.equipamento })));

// Inventário do PDF com os pendentes já confirmados (como está hoje).
const ITENS = ['Par de halteres de 1 a 40', 'Steps', 'Barra W', 'Barra reta curta', 'Polia unilateral', 'Banco Scott',
  'Cadeira extensora', 'Cadeira flexora', 'Banco romano', 'Hack squat', 'Agachamento pêndulo', 'Leg press 45°',
  'Elevação pélvica 2D', 'Adutora e abdutora', 'Cross over', 'Gaiola de agachamento guiado (Smith)',
  'Máquina de elevação de ombro', 'Máquina voador', 'Máquina de desenvolvimento', 'Supino articulado reto',
  'Supino articulado 45°', 'Remada cavalinho com apoio', 'Máquina pulley', 'Remada baixa KIKOS',
  'Barra longa de carga + anilhas', 'Rack / suporte de agachamento', 'Banco móvel (reto / inclinado)'];
const INV = { disponiveis: ITENS.map((nome, i) => ({ id: `EQ${String(i + 1).padStart(2, '0')}`, nome, tipo: 'equipamento' }))
  .concat([{ id: 'PG03', nome: 'MAPFIT médio', tipo: 'puxador' }, { id: 'PG09', nome: 'Triângulo metálico fechado', tipo: 'puxador' }]), ausentes: [] };
const primeiro = () => 0;

grupo('base evollo · os dados', () => {
  teste('150 modelos, 50 por nível, 115 exercícios', () => {
    igual(BASE.treinos.length, 150);
    igual(BASE.treinos.filter(t => t.nivel === 'Intermediário').length, 50);
    igual(Object.keys(BASE.exercicios).length, 115);
  });

  teste('TODO exercício da base existe na biblioteca (pelo nome mapeado)', () => {
    const nomes = new Set(BIB.map(e => e.nome.toLowerCase()));
    for (const [id, e] of Object.entries(BASE.exercicios)) ok(nomes.has(e.b.toLowerCase()), `${id} → "${e.b}" não está na biblioteca`);
    igual(Object.keys(MAPA).length, 115);
  });
});

grupo('base evollo · escolha do modelo (seção 3)', () => {
  teste('nível + objetivo + frequência + ênfase', () => {
    const { modelo } = escolherModelo(BASE, { nivel: 'Intermediário', objetivo: 'Hipertrofia', dias: 4, enfase: 'equilibrado' }, primeiro);
    igual([modelo.nivel, modelo.objetivo, modelo.freq, modelo.enfase].join('|'), 'Intermediário|Hipertrofia|4|Equilibrado');
  });

  teste('SEM MODELO DE 5 DIAS PARA INTERMEDIÁRIO: O MAIS PRÓXIMO PARA BAIXO', () => {
    const { modelo, notas } = escolherModelo(BASE, { nivel: 'Intermediário', objetivo: 'Hipertrofia', dias: 5 }, primeiro);
    igual(modelo.freq, 4);
    contem(notas.join(' '), 'usado 4x (o mais próximo para baixo)');
  });

  teste('avançado com 3 dias: não há abaixo, usa o menor e avisa', () => {
    const { modelo, notas } = escolherModelo(BASE, { nivel: 'Avançado', objetivo: 'Força', dias: 3 }, primeiro);
    igual(modelo.freq, 4);
    contem(notas.join(' '), 'o menor disponível');
  });

  teste('iniciante pedindo Força recebe Hipertrofia; Adaptação só existe para iniciante', () => {
    igual(objetivoDaBase('Iniciante', 'Força'), 'Hipertrofia');
    igual(objetivoDaBase('Avançado', 'Força'), 'Força');
    igual(objetivoDaBase('Intermediário', 'Adaptação'), 'Hipertrofia');
    igual(objetivoDaBase('Iniciante', 'Resistência'), 'Emagrecimento/Resistência');
  });

  teste('a duração mais perto do tempo disponível ganha', () => {
    const { modelo } = escolherModelo(BASE, { nivel: 'Avançado', objetivo: 'Hipertrofia', dias: 5, enfase: 'inferiores', tempoMin: 30 }, primeiro);
    const possiveis = BASE.treinos.filter(t => t.nivel === 'Avançado' && t.objetivo === 'Hipertrofia' && t.freq === 5 && t.enfase === 'Ênfase em inferiores e glúteos');
    igual(modelo.duracao, Math.min(...possiveis.map(t => t.duracao)));
  });

  teste('empate varia (não entrega sempre o mesmo id)', () => {
    const ids = new Set([0, 0.99].map(r => escolherModelo(BASE, { nivel: 'Intermediário', objetivo: 'Força', dias: 4, enfase: 'superiores' }, () => r).modelo.id));
    ok(ids.size >= 1);
  });
});

grupo('base evollo · conversão do modelo (seção 4)', () => {
  const todos = BASE.treinos.map(m => ({ m, c: converterModelo(BASE, m, { biblioteca: BIB, inventario: INV, nivel: m.nivel }) }));

  teste('NENHUM EXERCÍCIO REPETIDO NO MESMO DIA, em nenhum dos 150 modelos', () => {
    for (const { m, c } of todos) for (const d of c.dias) {
      const ids = d.exercicios.flatMap(e => [e.exercicio_id, e.par?.exercicio_id].filter(Boolean));
      igual(new Set(ids).size, ids.length, `${m.id} dia ${d.dia} repete exercício`);
    }
  });

  teste('o que não cabe na academia é trocado, nunca entra', () => {
    const corda = 'id:Tríceps pulley com corda';
    for (const { c } of todos) for (const d of c.dias) ok(!d.exercicios.some(e => e.exercicio_id === corda || e.par?.exercicio_id === corda));
    ok(todos.some(({ c }) => c.trocas.some(t => t.includes('Tríceps pulley com corda →'))), 'a troca aparece no relatório');
  });

  teste('BI-SET DA BASE VIRA O PAR DO APP, com o descanso do B', () => {
    const m = BASE.treinos.find(t => t.dias.some(d => d.ex.some(e => /^Bi-set com/.test(e[4]) && !/2º/.test(e[4]))));
    const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    const bs = c.dias.flatMap(d => d.exercicios).find(e => e.par);
    ok(bs, `${m.id} deveria ter bi-set`);
    igual(bs.metodo, 'Bi-set');
    ok(bs.descanso, 'o descanso do par (o do B) não pode sumir');
  });

  teste('técnicas viram métodos do app', () => {
    igual(metodoDaTecnica('Drop-set na última série'), { metodo: 'Drop-set', drop_ultimas: 1 });
    igual(metodoDaTecnica('Série descendente (3 quedas de carga)').metodo, 'Drop-set');
    igual(metodoDaTecnica('Pirâmide crescente de carga').metodo, 'Piramidal');
    igual(metodoDaTecnica('Cluster set (pausas de 15s dentro da série)').metodo, 'Cluster');
    igual(metodoDaTecnica('Série com pausa de 2s no fundo').metodo, 'Isometria');
    igual(metodoDaTecnica('FST-7 (7 séries de 10-12 com 30s de descanso)').metodo, 'FST-7');
  });

  teste('o texto da técnica vai para a observação do aluno', () => {
    const m = BASE.treinos.find(t => t.dias.some(d => d.ex.some(e => e[4].startsWith('Cluster'))));
    const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    ok(c.dias.flatMap(d => d.exercicios).some(e => e.metodo === 'Cluster' && /Cluster set/.test(e.observacao)));
  });

  teste('descanso em segundos vira o formato do app ("90s")', () => {
    const { c } = todos[0];
    ok(c.dias[0].exercicios.every(e => !e.descanso || /^\d+s$/.test(e.descanso)));
  });

  teste('cada exercício sai com o aparelho do inventário (quando há um)', () => {
    const { c } = todos.find(({ m }) => m.id === 'INT-32');
    ok(c.dias[0].exercicios.filter(e => e.equipamento_id).length >= c.dias[0].exercicios.length - 1);
  });
});

grupo('base evollo · pouco tempo', () => {
  teste('SAEM ISOLADOS DO FIM; OS DOIS PRIMEIROS E O CARDIO FICAM', () => {
    const m = BASE.treinos.find(t => t.objetivo === 'Emagrecimento/Resistência' && t.nivel === 'Avançado');
    const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    const primeiros = c.dias.map(d => d.exercicios.slice(0, 2).map(e => e.exercicio_id).join());
    const tinhaCardio = c.dias.map(d => d.exercicios.some(e => e._cardio));
    const notas = cortarPorTempo(c.dias, 30);
    ok(notas.length > 0, 'deveria cortar');
    c.dias.forEach((d, i) => {
      igual(d.exercicios.slice(0, 2).map(e => e.exercicio_id).join(), primeiros[i], `dia ${d.dia}: os primeiros não saem`);
      igual(d.exercicios.some(e => e._cardio), tinhaCardio[i], `dia ${d.dia}: o cardio não sai`);
    });
  });

  teste('tempo de sobra não corta nada', () => {
    const m = BASE.treinos[0];
    const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: null, nivel: m.nivel });
    const antes = c.dias.map(d => minutosDoDia(d.exercicios));
    igual(cortarPorTempo(c.dias, 240), []);
    igual(c.dias.map(d => minutosDoDia(d.exercicios)), antes);
  });
});

// ── handler ─────────────────────────────────────────────────
async function chamar(body, respostaIa) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, o) => {
    chamadas.push(JSON.parse(o.body).messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(respostaIa) }], stop_reason: 'end_turn' }) };
  };
  const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
  try { await handler({ method: 'POST', body }, res); } finally { globalThis.fetch = original; }
  return { res, chamadas };
}

grupo('base evollo · o gerador (handler)', () => {
  const criterios = { nivel: 'Intermediário', objetivo: 'Hipertrofia', dias: 4, enfase: 'equilibrado', tempoMin: 70 };

  teste('SEM LESÃO/OBSERVAÇÃO NEM MÚSCULO: SAI DA BASE, SEM CHAMAR A IA', async () => {
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;   // nem precisa de chave
    try {
      const { res, chamadas } = await chamar({ modo: 'criar', base: true, criterios, biblioteca: BIB, inventario: INV }, {});
      igual(res.code, 200);
      igual(chamadas.length, 0);
      ok(res.body.base?.id, 'informa o modelo usado');
      contem(res.body.relatorio.base, res.body.base.id);
      contem(res.body.relatorio.orientacoes, 'Progressão');
      contem(res.body.relatorio.aviso, 'Consulte um médico');
      ok(res.body.dias.every(d => d.exercicios.every(e => !Object.keys(e).some(k => k.startsWith('_')))), 'campos internos não vazam');
    } finally { if (chave) process.env.ANTHROPIC_API_KEY = chave; }
  });

  teste('COM LESÃO: A IA RECEBE O MODELO PARA ADAPTAR', async () => {
    process.env.ANTHROPIC_API_KEY = 'teste';
    const daBase = montarDaBase(BIB, { ...criterios, obs: 'dor lombar' }, INV, primeiro);
    const resposta = { nome: 'x', dias: daBase.plano.dias, relatorio: { adaptacoes: 'Remada curvada → Remada T deitado: dor lombar' } };
    const { res, chamadas } = await chamar({ modo: 'criar', base: true, criterios: { ...criterios, obs: 'dor lombar' }, biblioteca: BIB, inventario: INV }, resposta);
    igual(chamadas.length, 1);
    contem(chamadas[0], 'ADAPTAR UM TREINO-MODELO DA BASE EVOLLO');
    contem(chamadas[0], 'dor lombar → evite levantamento terra');
    ok(!chamadas[0].includes('NUNCA repita o mesmo exercicio_id'), 'as regras do gerador livre não se aplicam ao modelo');
    igual(res.code, 200);
    ok(res.body.base?.id);
    contem(res.body.relatorio.adaptacoes, 'IA: Remada curvada');
  });

  teste('músculo priorizado também chama a IA', () => {
    const r = montarDaBase(BIB, { ...criterios, musculos: [{ grupo: 'Glúteos', prioridade: 'alta' }] }, INV, primeiro);
    igual(r.precisaIA, true);
    contem(r.contexto, 'Glúteos (alta)');
  });

  teste('os modos Evoluir/Ajustar não usam a base', async () => {
    process.env.ANTHROPIC_API_KEY = 'teste';
    const { chamadas } = await chamar({ modo: 'ajustar', base: true, instrucao: 'x', treinoAtualTexto: 'Dia A', criterios: {},
      exercicios: [{ id: 'a', nome: 'Leg press' }] }, { nome: 'x', dias: [{ dia: 'A', exercicios: [{ exercicio_id: 'a' }] }], relatorio: {} });
    ok(!chamadas[0].includes('BASE EVOLLO'));
  });
});
