// ═══════════════════════════════════════════════════════════
// XSS pela anamnese — o painel do profissional não executa o que o paciente
// escreve
// ═══════════════════════════════════════════════════════════
// A anamnese é gravada por `rpc_salvar_respostas`, aberta para `anon`: quem tem
// o código de 6 caracteres grava QUALQUER jsonb, inclusive valores fora das
// opções do formulário. Esse conteúdo era posto cru em innerHTML no relatório
// (index.html e ficha) e no card do recordatório — rodando na sessão do
// profissional, com acesso a todos os pacientes.
//
// Estes testes NÃO executam nada: montam o HTML com cargas maliciosas e
// inspecionam o texto produzido. Nenhuma sessão real é tocada.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grupo, teste, ok, igual } from './runner.mjs';
import { tabela, limpar } from './duble-supabase.mjs';
import { escaparHtml } from '../js/html-seguro.js';
import { gerarRelatorio } from '../js/relatorio.js';
import { renderCardRecordatorio, rotuloDaRefeicao } from '../js/recordatorio-ia.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Cargas: uma por forma de fuga (conteúdo, atributo com aspas duplas, com
//    apóstrofo, fechamento de tag, esquema javascript:, evento sem tag nova).
const CARGAS = [
  `<img src=x onerror="window.__xss=1">`,
  `"><script>window.__xss=1</script>`,
  `'><svg onload=window.__xss=1>`,
  `</div><iframe srcdoc="<script>parent.__xss=1</script>"></iframe>`,
  `<a href="javascript:window.__xss=1">clique</a>`,
  `' onmouseover='window.__xss=1' x='`,
  `" onfocus="window.__xss=1" autofocus x="`,
  `<details open ontoggle=window.__xss=1>`,
];

// ── Inspetor ────────────────────────────────────────────────
// Lê as tags do HTML produzido como um parser leria e recusa o que só poderia
// ter vindo de fora: tag perigosa, atributo de evento, atributo de URL.
// O único `on*` legítimo do relatório é o botão de imprimir.
const TAGS_PROIBIDAS = new Set(['script', 'img', 'iframe', 'object', 'embed', 'style', 'link',
  'meta', 'base', 'a', 'details', 'video', 'audio', 'math', 'form', 'input', 'textarea', 'template']);
const ATRIBUTOS_URL = new Set(['href', 'src', 'srcdoc', 'action', 'formaction', 'xlink:href', 'autofocus']);
const EVENTOS_PERMITIDOS = new Set(['onclick="window.print()"']);

function problemasNoHtml(html) {
  const problemas = [];
  const TAG = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^>]*)>/g;
  const ATR = /([^\s"'=<>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let t;
  while ((t = TAG.exec(html))) {
    const nome = t[2].toLowerCase();
    if (TAGS_PROIBIDAS.has(nome)) problemas.push(`tag <${nome}>`);
    if (t[1]) continue;
    let a;
    while ((a = ATR.exec(t[3]))) {
      const atr = a[1].toLowerCase();
      if (atr.startsWith('on') && !EVENTOS_PERMITIDOS.has(`${atr}=${a[2] || ''}`)) problemas.push(`atributo ${atr} em <${nome}>`);
      if (ATRIBUTOS_URL.has(atr)) problemas.push(`atributo ${atr} em <${nome}>`);
      if (atr.includes('__xss') || atr.includes('window')) problemas.push(`atributo forjado ${atr} em <${nome}>`);
    }
  }
  return problemas;
}

/** O que o navegador faz ao ler um atributo: desfaz as entidades. */
function desfazerEntidades(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ── Anamnese com TODOS os campos que o relatório lê preenchidos com `v` ──
function anamneseCom(v, { numerosValidos = false } = {}) {
  const n = (valido) => numerosValidos ? valido : v;
  return {
    m1: { q1_1: v, q1_2: v, q1_3: v, q1_4: numerosValidos ? '1990-01-01' : v, q1_5: v, q1_6: v, q1_8: v },
    m2: { q2_1: v, q2_2: v, q2_3: v, q2_7: v, q2_8: v },
    m3: { q3_1: [v, 'Diabetes tipo 2'], q3_2: 'Sim', q3_2_detalhe: v, q3_3: v, q3_4: v, q3_5: v,
          q3_alergias: [v, 'amendoim'], q3_alergias_detalhe: v, q3_intolerancias: [v], q3_intolerancias_detalhe: v,
          q3_padrao: v, q3_padrao_detalhe: v, q3_gestacao: v },
    m4: { q4_1: n('70'), q4_2: n('165'), q4_3: v, q4_4: n('62'), q4_5: v },
    m5: { q5_1: v, q5_2: v, q5_4: v, q5_7: v, q5_7b: v, q5_8: v, q5_9: v, q5_10: v, q5_11: v, q5_12: v },
    m6: { q6_1: v, q6_2: v, q6_3: v, q6_meq_1: v },
    m7: { q7_1: v, q7_2: v, q7_3: v, q7_4: v, q7_5: v, q7_9: v, q7_10: v },
    m8: { q8_1: 'Sim', q8_2: v, q8_3: v, q8_6: 'Sim', q8_7: v, q8_7_time: v },
    m9: { q9_1: v, q9_10: v, q9_11: v },
    m10: { q10_1: v, q10_neat: v, q10_passos: v, q10_corrida_freq: '3', q10_corrida_int: v },
    m13: { q13_1: v, q13_2: v, q13_3: v, q13_4: [v], q13_5: v, q13_6: v, q13_7: v },
  };
}

function prepararBanco(v, opcoes) {
  limpar();
  tabela('pacientes', [{ id: 'p1', codigo: v, nome: v, status: 'completo' }]);
  tabela('respostas', Object.entries(anamneseCom(v, opcoes))
    .map(([modulo, dados]) => ({ paciente_id: 'p1', modulo, dados })));
}

// ═══════════════════════════════════════════════════════════
grupo('segurança · escaparHtml', () => {
  teste('escapa os cinco caracteres que abrem marcação ou fecham atributo', () => {
    igual(escaparHtml(`<a href="x" title='y'>&</a>`),
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  teste('nulo e indefinido viram texto vazio, número vira texto', () => {
    igual([escaparHtml(null), escaparHtml(undefined), escaparHtml(70.5)], ['', '', '70.5']);
  });
  teste('o navegador recupera exatamente o texto original', () => {
    for (const c of CARGAS) igual(desfazerEntidades(escaparHtml(c)), c);
  });
});

grupo('segurança · relatório da anamnese com cargas maliciosas', () => {
  for (const [i, carga] of CARGAS.entries()) {
    teste(`carga ${i + 1} em todos os campos: nenhuma tag ou evento injetado`, async () => {
      prepararBanco(carga);
      const html = await gerarRelatorio('p1');
      igual(problemasNoHtml(html), [], `carga: ${carga}`);
    });
    teste(`carga ${i + 1} com números válidos (abre prescrição e recordatório): inerte`, async () => {
      prepararBanco(carga, { numerosValidos: true });
      const html = await gerarRelatorio('p1');
      ok(html.includes('macros-card'), 'o caminho da prescrição precisa ter rodado');
      ok(html.includes('rec-calc-container'), 'o caminho do recordatório precisa ter rodado');
      igual(problemasNoHtml(html), [], `carga: ${carga}`);
    });
  }

  teste('o texto legítimo continua aparecendo, só que como texto', async () => {
    const legitimo = `Arroz & feijão "caseiro", copo d'água <1x/dia>`;
    prepararBanco(legitimo);
    const html = await gerarRelatorio('p1');
    ok(html.includes(escaparHtml(legitimo)), 'o valor escapado deve estar no relatório');
    ok(!html.includes(legitimo), 'o valor cru não pode estar no relatório');
  });

  teste('o inspetor reconhece uma injeção de verdade (controle do próprio teste)', () => {
    ok(problemasNoHtml(`<div>${CARGAS[0]}</div>`).length > 0);
    ok(problemasNoHtml(`<div data-x='${CARGAS[5]}'></div>`).length > 0);
    igual(problemasNoHtml(`<button onclick="window.print()">x</button>`), []);
  });
});

grupo('segurança · recordatório (atributo data-refeicoes e card da IA)', () => {
  teste('apóstrofo no recordatório não fecha mais o atributo', async () => {
    prepararBanco(CARGAS[5], { numerosValidos: true });
    const html = await gerarRelatorio('p1');
    const m = html.match(/data-refeicoes="([^"]*)"/);
    ok(m, 'o atributo deve ser delimitado por aspas duplas');
    ok(!m[1].includes("'"), 'nenhum apóstrofo cru dentro do atributo');
  });

  teste('ida e volta pelo atributo devolve exatamente o que o paciente escreveu', async () => {
    prepararBanco(CARGAS[1], { numerosValidos: true });
    const html = await gerarRelatorio('p1');
    const bruto = html.match(/data-refeicoes="([^"]*)"/)[1];
    const refeicoes = JSON.parse(decodeURIComponent(desfazerEntidades(bruto)));
    ok(refeicoes.some(r => r[2] === CARGAS[1]), 'a descrição volta íntegra');
  });

  for (const [i, carga] of CARGAS.entries()) {
    teste(`card do recordatório com carga ${i + 1} na descrição, horário, rótulo e observação da IA`, () => {
      const refeicoes = [
        ['<i data-lucide="coffee"></i> Café da manhã', 'Sim', carga, carga],
        [carga, 'Sim', 'pão', '07:00'],
      ];
      const html = renderCardRecordatorio(
        { kcal_total: 1800, prot_g: 90, carb_g: 200, gord_g: 60, observacao: carga, get_kcal: null }, refeicoes);
      igual(problemasNoHtml(html), [], `carga: ${carga}`);
    });
  }

  teste('rótulo legítimo com ícone continua com o ícone', () => {
    const r = '<i data-lucide="coffee"></i> Café da manhã';
    igual(rotuloDaRefeicao(r), r);
  });
  teste('rótulo com qualquer outra marcação é escapado', () => {
    igual(rotuloDaRefeicao('<i data-lucide="x" onclick="y"></i> A'),
      escaparHtml('<i data-lucide="x" onclick="y"></i> A'));
    igual(rotuloDaRefeicao('<i data-lucide="coffee"></i> <b>A</b>'),
      escaparHtml('<i data-lucide="coffee"></i> <b>A</b>'));
  });
});

grupo('segurança · index.html escapa o nome do paciente', () => {
  const html = readFileSync(resolve(RAIZ, 'index.html'), 'utf8');

  teste('importa o escape compartilhado', () => {
    ok(html.includes(`import { escaparHtml as esc } from './js/html-seguro.js';`));
  });
  teste('lista de clientes: nome, iniciais, código e status passam por esc()', () => {
    const linha = html.split('\n').find(l => l.includes('<div class="patient-row">'));
    ok(linha, 'achei a linha do cliente');
    for (const trecho of ['${esc(iniciaisDoNome(p.nome))}', "${esc(p.nome || '(sem nome)')}",
      '${esc(p.codigo)}', '${esc(status)}', '${esc(p.nome || p.codigo)}']) {
      ok(linha.includes(trecho), `falta ${trecho}`);
    }
    ok(!/\$\{p\.nome/.test(linha), 'nenhum ${p.nome...} cru');
  });
  teste('lista de treinos a vencer: nome do paciente passa por esc()', () => {
    ok(html.includes('<div class="gt-nome">${esc(nome)}</div>'));
    ok(!html.includes('<div class="gt-nome">${nome}</div>'));
  });
});
