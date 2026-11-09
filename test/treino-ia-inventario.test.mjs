// ═══════════════════════════════════════════════════════════
// GERADOR DE TREINOS × INVENTÁRIO DA ACADEMIA
// ═══════════════════════════════════════════════════════════
// O erro que estes testes pegam é o gerador prescrever o que a academia não
// tem. A trava NÃO pode depender da IA obedecer ao prompt: o servidor confere
// cada exercício contra as estações e puxadores DISPONÍVEIS e descarta o resto
// — e o descarte aparece no relatório, para o profissional ver o buraco.
//
// E o outro lado: quem não tem inventário (outras organizações) tem de receber
// exatamente o gerador de antes.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import handler from '../api/gerar-treino.js';
import { inventarioParaIA } from '../js/treinos.js';
import { proximoId } from '../js/academia-ui.js';

const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../db/treino_academia_inventario.sql', import.meta.url), 'utf8');

const BIB = [
  { id: 'x-leg', nome: 'Leg press 45°', grupo: 'Quadríceps', equipamento: 'Máquina' },
  { id: 'x-agl', nome: 'Agachamento livre com barra', grupo: 'Quadríceps', equipamento: 'Barra' },
  { id: 'x-rem', nome: 'Remada baixa triângulo', grupo: 'Costas', equipamento: 'Polia/Cabo' },
];

const INV = {
  disponiveis: [
    { id: 'EQ18', tipo: 'equipamento', nome: 'Leg press 45°' },
    { id: 'EQ31', tipo: 'equipamento', nome: 'Remada baixa KIKOS' },
    { id: 'PG09', tipo: 'puxador', nome: 'Triângulo metálico fechado' },
  ],
  ausentes: ['Barra longa de carga + anilhas', 'Rack / suporte de agachamento'],
};

// Chama o handler com um fetch falso que devolve `plano` como resposta da IA
// e guarda o prompt enviado.
async function chamar(body, plano) {
  process.env.ANTHROPIC_API_KEY = 'teste';
  const enviado = {};
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    enviado.prompt = JSON.parse(opts.body).messages[0].content;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(plano) }], stop_reason: 'end_turn' }) };
  };
  const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; } };
  try { await handler({ method: 'POST', body }, res); }
  finally { globalThis.fetch = fetchOriginal; }
  return { res, prompt: enviado.prompt };
}

const PLANO = () => ({
  nome: 'T', objetivo: 'hipertrofia',
  dias: [{ dia: 'A', foco: 'Pernas + Costas', exercicios: [
    { exercicio_id: 'x-leg', equipamento_id: 'eq18', acessorio_id: '', series: 4, repeticoes: '8-12', metodo: 'Normal' },
    { exercicio_id: 'x-agl', equipamento_id: 'EQ34', acessorio_id: '', series: 4, repeticoes: '6-8', metodo: 'Normal' },
    { exercicio_id: 'x-rem', equipamento_id: 'EQ31', acessorio_id: 'PG99', series: 3, repeticoes: '10-12', metodo: 'Normal' },
  ] }],
  relatorio: { estrutura: 'x' },
});

grupo('treinos · gerador respeita o inventário da academia', () => {
  teste('O SERVIDOR DESCARTA O QUE NÃO CABE NA ACADEMIA', async () => {
    // EQ34 (rack) está "a confirmar" → fora; PG99 não existe → fora.
    const { res } = await chamar({ modo: 'criar', criterios: { musculos: [{ grupo: 'Quadríceps', prioridade: 'alta' }] },
                                   exercicios: BIB, inventario: INV }, PLANO());
    igual(res.code, 200);
    const ids = res.body.dias[0].exercicios.map(e => e.exercicio_id);
    igual(ids.join(','), 'x-leg');
    igual(res.body.dias[0].exercicios[0].equipamento_id, 'EQ18', 'id normalizado para maiúsculas');
  });

  teste('o descarte aparece no relatório, com o nome do exercício', async () => {
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB, inventario: INV }, PLANO());
    contem(res.body.relatorio.descartados, 'Agachamento livre com barra');
    contem(res.body.relatorio.descartados, 'Remada baixa triângulo');
    igual(res.body.relatorio.estrutura, 'x', 'o relatório da IA continua inteiro');
  });

  teste('o prompt leva estações, puxadores, ausentes e as regras', async () => {
    const { prompt } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB, inventario: INV }, PLANO());
    contem(prompt, 'EQ18 | Leg press 45°');
    contem(prompt, 'PG09 | Triângulo metálico fechado');
    contem(prompt, 'Rack / suporte de agachamento');
    contem(prompt, 'REGRAS DO INVENTÁRIO');
    contem(prompt, '"equipamento_id"');
    contem(prompt, 'x-agl | Agachamento livre com barra | Quadríceps | Barra');
  });

  teste('SEM INVENTÁRIO, O GERADOR É O DE ANTES', async () => {
    // Outras organizações não cadastraram academia: nada pode ser descartado
    // por falta de equipamento_id, e o prompt não fala de inventário.
    const plano = PLANO();
    plano.dias[0].exercicios.forEach(e => { delete e.equipamento_id; delete e.acessorio_id; });
    const { res, prompt } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB }, plano);
    igual(res.body.dias[0].exercicios.length, 3);
    ok(!res.body.relatorio.descartados, 'sem descarte');
    ok(!prompt.includes('INVENTÁRIO DA ACADEMIA'), 'prompt sem inventário');
    ok(!prompt.includes('"equipamento_id"'), 'formato sem equipamento_id');
  });

  teste('inventário sem nenhuma estação disponível não trava tudo', async () => {
    const soPuxador = { disponiveis: [INV.disponiveis[2]], ausentes: [] };
    const plano = PLANO();
    const { res } = await chamar({ modo: 'criar', criterios: {}, exercicios: BIB, inventario: soPuxador }, plano);
    igual(res.body.dias[0].exercicios.length, 3, 'tratado como sem inventário');
  });

  teste('evoluir/ajustar com inventário manda trocar o que não cabe', async () => {
    const { prompt } = await chamar({ modo: 'ajustar', instrucao: 'x', treinoAtualTexto: 'Dia A:\n  - Agachamento livre',
                                      criterios: {}, exercicios: BIB, inventario: INV }, PLANO());
    contem(prompt, 'NÃO for executável com o inventário deve ser substituído');
  });
});

grupo('treinos · recorte do inventário para a IA', () => {
  const inv = (over = {}) => ({ ativo: true, itens: [
    { id: 'EQ01', tipo: 'equipamento', nome: 'Halteres', situacao: 'disponivel' },
    { id: 'EQ33', tipo: 'equipamento', nome: 'Barra + anilhas', situacao: 'pendente' },
    { id: 'EQ09', tipo: 'equipamento', nome: 'Polia quebrada', situacao: 'indisponivel' },
    { id: 'PG09', tipo: 'puxador', nome: 'Triângulo', situacao: 'disponivel' },
  ], ...over });

  teste('só o DISPONÍVEL vai como existente; o resto vai como ausente', () => {
    const r = inventarioParaIA(inv());
    igual(r.disponiveis.map(i => i.id).join(','), 'EQ01,PG09');
    igual(r.ausentes.join(','), 'Barra + anilhas,Polia quebrada');
  });

  teste('desligado, inexistente ou vazio = sem restrição', () => {
    igual(inventarioParaIA(inv({ ativo: false })), null);
    igual(inventarioParaIA(null), null);
    igual(inventarioParaIA({ ativo: true, itens: [] }), null);
  });

  teste('ids novos não reaproveitam número em uso', () => {
    const itens = [{ id: 'EQ01' }, { id: 'EQ35' }, { id: 'PG12' }];
    igual(proximoId('equipamento', itens), 'EQ36');
    igual(proximoId('puxador', itens), 'PG13');
    igual(proximoId('puxador', []), 'PG01');
  });
});

grupo('treinos · a tela do gerador e a carga do banco', () => {
  teste('o gerador manda o inventário só com a caixa marcada', () => {
    contem(ui, "_invIA && document.getElementById('iaUsarInv')?.checked ? _invIA : null");
    contem(ui, 'if (inv) payload.inventario = inv;');
  });

  teste('o aparelho vai para a observação do exercício salvo', () => {
    // É o que o aluno vê no app: em qual máquina fazer.
    contem(ui, "ex._estacao ? `Aparelho: ${ex._estacao}` : ''");
  });

  teste('a carga não sobrescreve o que foi editado pela tela', () => {
    contem(sql, 'on conflict (nutri_id) do nothing');
  });

  teste('pendentes do PDF entram como pendentes, não disponíveis', () => {
    for (const id of ['EQ33', 'EQ34', 'EQ35']) {
      ok(new RegExp(`'${id}'[^\\n]*'pendente'\\)`).test(sql), `${id} deveria estar pendente`);
    }
  });

  teste('RLS: só o dono, sem linha global', () => {
    contem(sql, 'enable row level security');
    ok(!/academia_inventario[\s\S]{0,200}nutri_id is null/.test(sql), 'nenhuma policy aceita nutri_id nulo');
  });
});
