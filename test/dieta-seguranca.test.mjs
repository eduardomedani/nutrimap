// ═══════════════════════════════════════════════════════════
// Segurança alimentar — vocabulário, anamnese e validador
// ═══════════════════════════════════════════════════════════
// O validador ainda NÃO está ligado à publicação (falta a origem dos
// marcadores no banco). Estes testes fixam o comportamento que ele terá quando
// for ligado: alergia e contraindicação bloqueiam, inclusive quando falta
// informação; o resto exige justificativa; e item, substituição e refeição
// alternativa são todos conferidos — nunca pelo nome do alimento.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grupo, teste, ok, igual } from './runner.mjs';
import {
  ALERGENOS, INTOLERANCIAS, PADROES, GESTACAO, MARCADORES,
  restricoesDaAnamnese, validarPlano,
} from '../js/dieta-seguranca.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Catálogo curado de teste
const CURADOS = new Map([
  ['f-queijo',  { curado: true, marcadores: ['contem_leite', 'contem_lactose', 'origem_animal'] }],
  ['f-arroz',   { curado: true, marcadores: [] }],
  ['f-pao',     { curado: true, marcadores: ['contem_trigo', 'contem_gluten'] }],
  ['f-amend',   { curado: true, marcadores: ['contem_amendoim'] }],
  ['f-frango',  { curado: true, marcadores: ['origem_animal', 'carne'] }],
  ['f-sardinha',{ curado: true, marcadores: ['origem_animal', 'pescado', 'contem_peixe'] }],
]);

const plano = (itens, extra = {}) => [{ id: 'r1', nome: 'Almoço', substitui_refeicao_id: null, itens, ...extra }];
const item = (id, food_id, nome, substituicoes = []) => ({ id, food_id, food: { nome }, substituicoes });
const SEM_RESTRICAO = { informado: true, restricoes: [] };

grupo('segurança alimentar · anamnese → restrições', () => {
  teste('pergunta não respondida (anamnese antiga) NÃO é "sem alergia"', () => {
    igual(restricoesDaAnamnese({}).informado, false);
  });
  teste('"nenhuma" é resposta: informado e sem restrição', () => {
    igual(restricoesDaAnamnese({ q3_alergias: ['nenhuma'], q3_intolerancias: ['nenhuma'], q3_padrao: 'onivoro', q3_gestacao: 'nao' }),
      { informado: true, restricoes: [] });
  });
  teste('códigos viram restrições estruturadas', () => {
    igual(restricoesDaAnamnese({ q3_alergias: ['amendoim', 'leite'], q3_intolerancias: ['celiaca'], q3_padrao: 'vegano', q3_gestacao: 'gestante' }).restricoes,
      ['alergia:amendoim', 'alergia:leite', 'intolerancia:celiaca', 'padrao:vegano', 'condicao:gestante']);
  });
  teste('valor fora do vocabulário vira "outra" (não é ignorado)', () => {
    igual(restricoesDaAnamnese({ q3_alergias: ['<b>kiwi</b>'] }).restricoes, ['alergia:outra']);
  });
});

grupo('segurança alimentar · bloqueio por alergia e contraindicação', () => {
  const alergiaLeite = { informado: true, restricoes: ['alergia:leite'] };

  teste('alergia × item com o alérgeno: bloqueia', () => {
    const r = validarPlano({ paciente: alergiaLeite, refeicoes: plano([item('i1', 'f-queijo', 'Queijo minas')]), marcadores: CURADOS });
    igual([r.podePublicar, r.bloqueantes], [false, 1]);
  });
  teste('alergia × SUBSTITUIÇÃO com o alérgeno: bloqueia', () => {
    const r = validarPlano({ paciente: alergiaLeite, marcadores: CURADOS,
      refeicoes: plano([item('i1', 'f-arroz', 'Arroz', [{ food_id: 'f-queijo', nome: 'Queijo' }])]) });
    ok(!r.podePublicar);
    igual(r.conflitos[0].local.tipo, 'substituicao');
  });
  teste('alergia × REFEIÇÃO ALTERNATIVA com o alérgeno: bloqueia', () => {
    const r = validarPlano({ paciente: alergiaLeite, marcadores: CURADOS,
      refeicoes: [
        { id: 'r1', nome: 'Café', itens: [item('i1', 'f-arroz', 'Arroz')] },
        { id: 'r2', nome: 'Vitamina', substitui_refeicao_id: 'r1', itens: [item('i2', 'f-queijo', 'Queijo')] },
      ] });
    ok(!r.podePublicar);
    igual(r.conflitos[0].local.alternativa, true);
  });
  teste('justificativa NÃO libera alergia', () => {
    const refeicoes = plano([item('i1', 'f-queijo', 'Queijo')]);
    const id = validarPlano({ paciente: alergiaLeite, refeicoes, marcadores: CURADOS }).conflitos[0].id;
    const r = validarPlano({ paciente: alergiaLeite, refeicoes, marcadores: CURADOS, justificativas: { [id]: 'tolera bem' } });
    ok(!r.podePublicar);
  });
  teste('doença celíaca é contraindicação: glúten bloqueia', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['intolerancia:celiaca'] },
      refeicoes: plano([item('i1', 'f-pao', 'Pão')]), marcadores: CURADOS });
    igual(r.bloqueantes, 1);
  });
  teste('cada alergia do vocabulário bloqueia o marcador correspondente', () => {
    for (const a of Object.keys(ALERGENOS)) {
      const m = new Map([['x', { curado: true, marcadores: [`contem_${a}`] }]]);
      const r = validarPlano({ paciente: { informado: true, restricoes: [`alergia:${a}`] }, refeicoes: plano([item('i', 'x', 'X')]), marcadores: m });
      igual(r.bloqueantes, 1, `alergia a ${a}`);
    }
  });
});

grupo('segurança alimentar · informação insuficiente', () => {
  teste('alergias não informadas bloqueiam, mesmo com plano "inocente"', () => {
    const r = validarPlano({ paciente: { informado: false, restricoes: [] }, refeicoes: plano([item('i1', 'f-arroz', 'Arroz')]), marcadores: CURADOS });
    ok(!r.podePublicar);
    ok(r.conflitos.some(c => c.regra === 'alergias-nao-informadas'));
  });
  teste('com alergia, alimento SEM curadoria bloqueia', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['alergia:amendoim'] },
      refeicoes: plano([item('i1', 'f-desconhecido', 'Pasta de amendoim')]), marcadores: CURADOS });
    igual(r.conflitos[0].regra, 'alimento-nao-curado');
    igual(r.conflitos[0].nivel, 'bloqueante');
  });
  teste('com alergia, substituição sem food_id (jsonb antigo) bloqueia', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['alergia:peixe'] },
      refeicoes: plano([item('i1', 'f-frango', 'Frango', [{ nome: 'Atum em água', quantidade: 1 }])]), marcadores: CURADOS });
    ok(!r.podePublicar);
    igual(r.conflitos[0].local.tipo, 'substituicao');
  });
  teste('alergia em texto livre ("outra") bloqueia até ser estruturada', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['alergia:outra'] }, refeicoes: [], marcadores: CURADOS });
    ok(!r.podePublicar);
  });
  teste('sem nenhuma restrição informada, alimento sem curadoria não gera conflito', () => {
    const r = validarPlano({ paciente: SEM_RESTRICAO, refeicoes: plano([item('i1', 'f-desconhecido', 'X')]), marcadores: CURADOS });
    igual(r.conflitos, []);
    ok(r.podePublicar);
  });
});

grupo('segurança alimentar · conflitos que o profissional pode justificar', () => {
  const lactose = { informado: true, restricoes: ['intolerancia:lactose'] };
  teste('intolerância à lactose × queijo: pede justificativa', () => {
    const r = validarPlano({ paciente: lactose, refeicoes: plano([item('i1', 'f-queijo', 'Queijo')]), marcadores: CURADOS });
    igual([r.bloqueantes, r.semJustificativa, r.podePublicar], [0, 1, false]);
  });
  teste('com justificativa registrada, libera e guarda o texto', () => {
    const refeicoes = plano([item('i1', 'f-queijo', 'Queijo')]);
    const id = validarPlano({ paciente: lactose, refeicoes, marcadores: CURADOS }).conflitos[0].id;
    const r = validarPlano({ paciente: lactose, refeicoes, marcadores: CURADOS, justificativas: { [id]: 'Queijo curado, tolera em consulta' } });
    ok(r.podePublicar);
    igual(r.conflitos[0].justificativa, 'Queijo curado, tolera em consulta');
  });
  teste('justificativa em branco não conta', () => {
    const refeicoes = plano([item('i1', 'f-queijo', 'Queijo')]);
    const id = validarPlano({ paciente: lactose, refeicoes, marcadores: CURADOS }).conflitos[0].id;
    ok(!validarPlano({ paciente: lactose, refeicoes, marcadores: CURADOS, justificativas: { [id]: '   ' } }).podePublicar);
  });
  teste('vegano × frango, vegetariano × sardinha, pescetariano aceita sardinha', () => {
    const v = (p, f) => validarPlano({ paciente: { informado: true, restricoes: [p] }, refeicoes: plano([item('i', f, f)]), marcadores: CURADOS });
    igual(v('padrao:vegano', 'f-frango').semJustificativa, 1);
    igual(v('padrao:ovolacto', 'f-sardinha').semJustificativa, 1);
    igual(v('padrao:pescetariano', 'f-sardinha').conflitos, []);
  });
  teste('gestação exige justificativa (revisão clínica), não bloqueia sozinha', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['condicao:gestante'] }, refeicoes: [], marcadores: CURADOS });
    igual([r.bloqueantes, r.semJustificativa], [0, 1]);
  });
});

grupo('segurança alimentar · nada é decidido pelo nome do alimento', () => {
  teste('nome que "parece" amendoim, com marcadores curados limpos, não conflita', () => {
    const m = new Map([['x', { curado: true, marcadores: [] }]]);
    const r = validarPlano({ paciente: { informado: true, restricoes: ['alergia:amendoim'] }, refeicoes: plano([item('i', 'x', 'Amendoim de mentira')]), marcadores: m });
    igual(r.conflitos, []);
  });
  teste('nome inocente com marcador de amendoim conflita', () => {
    const r = validarPlano({ paciente: { informado: true, restricoes: ['alergia:amendoim'] }, refeicoes: plano([item('i', 'f-amend', 'Paçoca')]), marcadores: CURADOS });
    igual(r.bloqueantes, 1);
  });
  teste('o validador não lê o nome para decidir (não há includes/match/indexOf sobre nome)', () => {
    const src = readFileSync(resolve(RAIZ, 'js/dieta-seguranca.js'), 'utf8');
    ok(!/nome[^\n]*\.(includes|match|indexOf|search|test)\(/.test(src));
    ok(!/\.toLowerCase\(\)/.test(src));
  });
});

grupo('segurança alimentar · a anamnese coleta com o mesmo vocabulário', () => {
  const html = readFileSync(resolve(RAIZ, 'anamnese.html'), 'utf8');
  const valores = (nome) => [...html.matchAll(new RegExp(`name="${nome}" value="([^"]+)"`, 'g'))].map(m => m[1]);

  teste('alergias: todo código do vocabulário existe no formulário, + nenhuma e outra', () => {
    igual(valores('q3_alergias').sort(), [...Object.keys(ALERGENOS), 'nenhuma', 'outra'].sort());
  });
  teste('intolerâncias, padrão e gestação batem com o vocabulário', () => {
    igual(valores('q3_intolerancias').sort(), [...Object.keys(INTOLERANCIAS), 'nenhuma', 'outra'].sort());
    igual(valores('q3_padrao').sort(), [...Object.keys(PADROES), 'outro'].sort());
    igual(valores('q3_gestacao').sort(), Object.keys(GESTACAO).sort());
  });
  teste('as quatro perguntas são obrigatórias', () => {
    for (const n of ['q3_alergias', 'q3_intolerancias', 'q3_padrao', 'q3_gestacao']) {
      ok(new RegExp(`name="${n}" value="[^"]+" required`).test(html), `${n} sem required`);
    }
  });
  teste('"nenhuma" é exclusiva e a função está exposta para o onchange', () => {
    ok(html.includes('function marcarExclusivo(el, condId)'));
    ok(html.includes('window.marcarExclusivo = marcarExclusivo;'));
  });
  teste('todo marcador usado nas regras está no vocabulário de marcadores', () => {
    const src = readFileSync(resolve(RAIZ, 'js/dieta-seguranca.js'), 'utf8');
    const usados = [...src.matchAll(/proibe: \[([^\]]+)\]/g)].flatMap(m => m[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1)));
    igual(usados.filter(u => !MARCADORES.includes(u)), []);
  });
});
