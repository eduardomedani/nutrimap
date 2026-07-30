// REFEIÇÕES ALTERNATIVAS — uma refeição que substitui outra por inteiro.
//
// A regra que não pode falhar: o paciente come o café da manhã OU a vitamina
// proteica, nunca os dois. Somar as duas infla o total do dia e a comparação
// com a meta vira ficção.

import { grupo, teste, ok, igual, perto, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { macrosPlano } from '../js/dieta-calc.js';

const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');
const svc = readFileSync(new URL('../js/dieta.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../db/refeicoes_alternativas.sql', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

const ALIMENTO = { calorias: 100, proteina: 10, carboidrato: 20, gordura: 5, fibra: 2 };
const refeicao = (id, extra = {}) => ({
  id, nome: id, itens: [{ quantidade: 1, food: ALIMENTO }], ...extra,
});

// Reproduz principais() de dieta-ui.js — a filtragem que protege o total.
const principais = (refs) => refs.filter(r => !r.substitui_refeicao_id);

grupo('alternativas · o total do dia não conta duas vezes', () => {
  const rotina = [
    refeicao('cafe'),
    refeicao('vitamina', { substitui_refeicao_id: 'cafe' }),
    refeicao('panqueca', { substitui_refeicao_id: 'cafe' }),
    refeicao('almoco'),
  ];

  teste('somar tudo inflaria o plano — é o erro que a filtragem evita', () => {
    perto(macrosPlano(rotina).kcal, 400, 1e-9, 'quatro refeições somadas');
    perto(macrosPlano(principais(rotina)).kcal, 200, 1e-9, 'só café + almoço entram no dia');
  });

  teste('os macros seguem a mesma regra', () => {
    const m = macrosPlano(principais(rotina));
    perto(m.prot, 20);
    perto(m.carb, 40);
    perto(m.gord, 10);
  });

  teste('a contagem de refeições também ignora alternativas', () => {
    igual(principais(rotina).length, 2, 'o dia tem 2 refeições, não 4');
  });

  teste('sem alternativas, nada muda', () => {
    const simples = [refeicao('cafe'), refeicao('almoco')];
    perto(macrosPlano(principais(simples)).kcal, macrosPlano(simples).kcal);
  });

  teste('a UI usa principais() em TODOS os pontos de total', () => {
    // Um ponto esquecido faz o número da tela discordar do número do evento.
    ok(/const t = macrosPlano\(principais\(\)\)/.test(ui), 'barra de somas');
    ok(/const n = principais\(\).length/.test(ui), 'contagem de refeições');
    ok(/const m = macrosPlano\(principais\(\)\) \|\| \{\}/.test(ui), 'resumo do evento de timeline');
    ok(/meals: principais\(\).length/.test(ui), 'metadata do evento');
    ok(!/macrosPlano\(_refeicoes\)/.test(ui), 'não pode sobrar soma sobre a lista crua');
  });

  teste('dieta-calc segue sem saber que alternativa existe', () => {
    const calc = readFileSync(new URL('../js/dieta-calc.js', import.meta.url), 'utf8');
    naoContem(calc, 'substitui_refeicao_id', 'a filtragem é do consumo, não do núcleo');
  });
});

grupo('alternativas · rotina', () => {
  teste('aparecem agrupadas sob a principal, não soltas', () => {
    contem(ui, 'const alts = alternativasDe(r.id)');
    contem(ui, 'class="rt-alts"', 'faltou o container do grupo');
    contem(ui, "refeicaoCardHtml(a, 0, 1, { alternativa: true })");
    ok(/\.rt-alts \{[^}]*border-left/.test(css), 'o recuo tem que ser visível');
  });

  teste('a alternativa mostra "ou" no lugar do horário', () => {
    // O horário é o da principal; repeti-lo sugeriria outra refeição no dia.
    contem(ui, "ehAlt ? '<span class=\"rt-ou\">ou</span>'");
  });

  teste('a principal conta quantas alternativas tem', () => {
    contem(ui, "conta(alts.length, 'alternativa', 'alternativas')");
  });

  teste('alternativa não lista alternativas de si mesma', () => {
    // Alternativa de alternativa não significa nada para o paciente.
    contem(ui, 'const alts = ehAlt ? [] : alternativasDe(r.id)');
  });

  teste('a orientação ao paciente aparece quando existe', () => {
    contem(ui, 'const instrucao = String(r.instrucao');
    contem(ui, 'esc(instrucao)');
  });
});

grupo('alternativas · criação', () => {
  teste('o switch existe e revela os campos', () => {
    contem(ui, 'id="diNovaRefAlt"', 'faltou o switch');
    contem(ui, 'id="diNovaRefSubstitui"', 'faltou o seletor da refeição substituída');
    contem(ui, 'id="diNovaRefInstrucao"', 'faltou a orientação ao paciente');
    contem(ui, 'altCampos.hidden = !alt.checked');
  });

  teste('só refeições principais podem ser substituídas', () => {
    const bloco = /<select id="diNovaRefSubstitui"[\s\S]*?<\/select>/.exec(ui)?.[0] || '';
    contem(bloco, 'principais().map', 'alternativa de alternativa não existe');
  });

  teste('sem principal na tela, o bloco some', () => {
    contem(ui, "if (!principais().length) alt.closest('.di-alt-bloco')?.setAttribute('hidden', '')");
  });

  teste('alternativa sem destino não é gravada', () => {
    contem(ui, 'if (ehAlt && !substitui)', 'faltou a validação');
    contem(ui, 'Escolha qual refeição esta alternativa substitui');
  });

  teste('switch desligado grava vínculo nulo, não lixo', () => {
    contem(ui, 'const substitui = ehAlt ? (qs(\'diNovaRefSubstitui\')?.value || null) : null');
    contem(ui, 'const instrucao = ehAlt ?');
  });
});

grupo('alternativas · duplicação preserva o vínculo', () => {
  teste('duplicar repassa os campos novos', () => {
    // Antes a desestruturação descartava tudo que não fosse nome/hora/ordem.
    contem(svc, 'substitui_refeicao_id, instrucao } = {}', 'a assinatura tem que aceitá-los');
    contem(svc, 'refeicao.substitui_refeicao_id || null', 'e herdar da origem por padrão');
  });

  teste('duplicar principal gera principal; duplicar alternativa gera alternativa', () => {
    const fn = /export async function duplicarRefeicao[\s\S]*?\n\}/.exec(svc)?.[0] || '';
    contem(fn, 'substitui_refeicao_id !== undefined', 'só sobrescreve quando informado');
  });
});

grupo('alternativas · a migração', () => {
  teste('o SQL é aditivo e re-executável', () => {
    contem(sql, 'add column if not exists substitui_refeicao_id');
    contem(sql, 'add column if not exists instrucao');
    contem(sql, 'create index if not exists');
    naoContem(sql, 'drop column', 'nada destrutivo');
    naoContem(sql, 'delete from', 'nada destrutivo');
    naoContem(sql, 'update public.plano_refeicoes set', 'nenhuma linha existente é alterada');
  });

  teste('apagar a principal leva as alternativas junto', () => {
    // Alternativa órfã não significa nada: ela existe em função de outra.
    contem(sql, 'on delete cascade');
  });

  teste('o SQL não mexe em RLS', () => {
    naoContem(sql, 'create policy');
    naoContem(sql, 'alter table public.plano_refeicoes enable row level security');
  });
});
