// Resumo do financeiro — os gráficos.
//
// O que este arquivo protege: a GEOMETRIA, não a existência do desenho. Um
// gráfico que renderiza sem erro e mente sobre a proporção é pior que um que
// não renderiza — ninguém desconfia dele.

import { grupo, teste, ok, igual, contem, naoContem, perto } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  CORES, SERIES, rotuloCurto, escalaBonita, curto, graficoMensal, graficoPorPessoa,
} from '../js/resumo-grafico.js';

const MESES = [
  { competencia: '2026-06-01', base: 4000, adicionais: 1000, total: 5000, pessoas: 6 },
  { competencia: '2026-07-01', base: 6000, adicionais: 2000, total: 8000, pessoas: 6 },
  { competencia: '2026-08-01', base: 3000, adicionais: 0,    total: 3000, pessoas: 5 },
];

grupo('resumo · escala do eixo', () => {
  teste('o topo é número redondo, não o máximo cru', () => {
    // Eixo terminando em 8.137,42 obriga a ler o número para entender a
    // altura; terminando em 10 mil a altura se lê sozinha.
    const e = escalaBonita(8137.42);
    igual(e.topo % e.passo, 0);
    ok(e.topo >= 8137.42, 'o topo não pode cortar a maior barra');
    ok(e.topo <= 8137.42 * 1.6, `topo exagerado achata o gráfico: ${e.topo}`);
  });

  teste('escala em faixas diferentes de grandeza', () => {
    for (const max of [90, 900, 9000, 90000, 157083]) {
      const e = escalaBonita(max);
      ok(e.topo >= max, `topo ${e.topo} corta o máximo ${max}`);
      ok(e.passo > 0);
      igual(Math.round(e.topo / e.passo), 4, 'quatro divisões mantêm a grade legível');
    }
  });

  teste('sem dado não quebra', () => {
    ok(escalaBonita(0).topo > 0);
    ok(escalaBonita(null).topo > 0);
    ok(escalaBonita(NaN).topo > 0);
  });

  teste('valores do eixo em forma curta', () => {
    igual(curto(0), '0');
    igual(curto(750), '750');
    igual(curto(12000), '12 mil');
    igual(curto(12500), '12,5 mil');
  });

  teste('rótulo do mês cabe no eixo', () => {
    igual(rotuloCurto('2026-08-01'), 'ago/26');
    igual(rotuloCurto('2024-01-01'), 'jan/24');
    igual(rotuloCurto(''), '');
  });
});

grupo('resumo · a barra diz a verdade', () => {
  const { svg, barras } = graficoMensal(MESES, { largura: 700, altura: 240 });

  teste('a altura é proporcional ao valor', () => {
    // O mês de 8 mil tem que ter barra do dobro do de 4 mil. Se o desenho
    // mentir aqui, nenhuma outra coisa importa.
    const [jun, jul, ago] = barras;
    perto(jul.altura / jun.altura, 8000 / 5000, 0.02, 'jul/jun');
    perto(ago.altura / jun.altura, 3000 / 5000, 0.02, 'ago/jun');
  });

  teste('a barra começa no zero', () => {
    // Eixo truncado é a mentira mais comum em gráfico de barras.
    const alturas = barras.map(b => b.altura / (b.total || 1));
    perto(alturas[0], alturas[1], 0.001, 'mesma escala para todos');
    perto(alturas[1], alturas[2], 0.001);
  });

  teste('os dois segmentos somam a barra', () => {
    const g = /<g class="rg-barra" data-rg-mes="0">([\s\S]*?)<\/g>/.exec(svg)[1];
    const alturas = [...g.matchAll(/class="rg-seg[^"]*"[^>]*height="([\d.]+)"/g)]
      .map(m => Number(m[1]));
    igual(alturas.length, 2, 'junho tem base e adicional');
    // 2px de vão entre os segmentos, como entre as barras.
    perto(alturas[0] + alturas[1] + 2, barras[0].altura, 0.5);
  });

  teste('mês sem adicional desenha um segmento só', () => {
    const g = /data-rg-mes="2">([\s\S]*?)<\/g>/.exec(svg)[1];
    igual((g.match(/class="rg-seg/g) || []).length, 1);
  });

  teste('o alvo do mouse é maior que a marca', () => {
    // Barra de 3px de altura é impossível de mirar.
    const alvo = /class="rg-alvo"[^>]*width="([\d.]+)"/.exec(svg);
    ok(Number(alvo[1]) > barras[0].largura, 'o alvo tem que cobrir a faixa do mês');
  });

  teste('não rotula todo mês — eles colidiriam', () => {
    const rotulos = (svg.match(/class="rg-eixo-x"/g) || []).length;
    const muitos = graficoMensal(
      Array.from({ length: 24 }, (_, i) => ({
        competencia: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
        base: 100, adicionais: 10, total: 110,
      })));
    const rotulos24 = (muitos.svg.match(/class="rg-eixo-x"/g) || []).length;
    ok(rotulos <= 3);
    ok(rotulos24 <= 10, `24 meses geraram ${rotulos24} rótulos — vão colidir`);
  });

  teste('tem rótulo acessível descrevendo o gráfico', () => {
    contem(svg, 'role="img"');
    contem(svg, 'aria-label=');
  });

  teste('lista vazia devolve nada, sem quebrar', () => {
    igual(graficoMensal([]).svg, '');
    igual(graficoMensal(null).barras, []);
  });
});

grupo('resumo · cores', () => {
  teste('as duas séries usam tokens, não hex solto', () => {
    // Cor literal fora de tokens.css é o que faz a marca divergir com o tempo.
    for (const s of SERIES) ok(s.cor.startsWith('var(--'), `${s.rotulo} usa ${s.cor}`);
    igual(Object.keys(CORES).length, 2);
  });

  teste('o verde da marca NÃO é usado como área', () => {
    // #18B984 reprovou no contraste contra branco (2,46:1) na validação de
    // paleta. Ele é cor de botão; área grande sobre branco usa o 700.
    const css = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
    ok(/\.rg-base \{ fill: var\(--color-primary-700\)/.test(css));
    ok(!/\.rg-(base|add) \{ fill: var\(--primary\)/.test(css), 'o verde de ação não vira área');
  });

  teste('cada série tem rótulo — identidade nunca é só cor', () => {
    for (const s of SERIES) ok(s.rotulo && s.rotulo.length > 3);
  });

  teste('a barra por pessoa é de uma cor só', () => {
    // Pintar cada pessoa de uma cor faria a cor significar identidade num
    // gráfico onde ela não significa nada.
    const html = graficoPorPessoa([
      { nome: 'Aline', total: 2000 }, { nome: 'Mateus', total: 1000 },
    ]);
    igual((html.match(/style="width:/g) || []).length, 2);
    naoContem(html, 'background:', 'a cor da barra vem do CSS, não do inline');
  });
});

grupo('resumo · por colaborador', () => {
  teste('ordena do maior para o menor', () => {
    const html = graficoPorPessoa([
      { nome: 'Menor', total: 100 },
      { nome: 'Maior', total: 900 },
      { nome: 'Meio', total: 500 },
    ]);
    const ordem = [...html.matchAll(/rg-pessoa-nome"[^>]*>([^<]+)</g)].map(m => m[1]);
    igual(ordem, ['Maior', 'Meio', 'Menor']);
  });

  teste('a largura é proporcional ao maior', () => {
    const html = graficoPorPessoa([
      { nome: 'A', total: 1000 }, { nome: 'B', total: 250 },
    ]);
    const larguras = [...html.matchAll(/width:([\d.]+)%/g)].map(m => Number(m[1]));
    igual(larguras[0], 100);
    perto(larguras[1], 25, 0.1);
  });

  teste('nome digitado nunca vira marcação', () => {
    const html = graficoPorPessoa([{ nome: '<img onerror=x>', total: 10 }]);
    naoContem(html, '<img');
  });

  teste('lista vazia devolve nada', () => {
    igual(graficoPorPessoa([]), '');
    igual(graficoPorPessoa(null), '');
  });
});

grupo('resumo · tela', () => {
  const ui = readFileSync(new URL('../js/resumo-ui.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../db/financeiro_resumo.sql', import.meta.url), 'utf8');

  teste('a tabela existe como alternativa ao gráfico', () => {
    // É onde se confere o número exato que o gráfico só sugere — e o que
    // torna a tela utilizável por quem não distingue as duas cores.
    ok(ui.includes('tabelaHtml'), 'faltou a tabela');
    ok(ui.includes('Ver tabela'), 'e o botão que a alcança');
  });

  teste('o balão de hover existe', () => {
    ok(ui.includes('ligarHover'), 'gráfico em HTML sem hover desperdiça o meio');
    ok(ui.includes('mouseleave'), 'e tem que sumir ao sair');
  });

  teste('o recorte é o mesmo nos dois gráficos', () => {
    // Totais que não fecham entre si destroem a confiança na tela inteira.
    ok(/const janela = new Set\(mesesVisiveis\(\)/.test(ui));
  });

  teste('avisa quando o último mês é rascunho', () => {
    // Somar um mês que ainda vai mudar sem dizer isso é um número errado com
    // cara de certo.
    ok(ui.includes('ainda está em rascunho'));
  });

  teste('agrega no banco, não no navegador', () => {
    // Trazer 133 linhas com seus adicionais para somar em JS funcionaria hoje
    // e não funcionaria no terceiro ano.
    ok(sql.includes('create or replace view public.folha_resumo_mensal'));
    ok(sql.includes('create or replace view public.folha_resumo_colaborador'));
    ok(ui.includes("from('folha_resumo_mensal')"));
  });

  teste('as views novas nascem com security_invoker', () => {
    // Conta a cláusula de verdade, não a menção no comentário do cabeçalho.
    igual((sql.match(/^with \(security_invoker = on\) as$/gm) || []).length, 2,
      'as duas views, sem exceção');
  });

  teste('o Resumo é a primeira aba do Financeiro', () => {
    const casca = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');
    const ordem = [...casca.matchAll(/\{ id: '(\w+)'/g)].map(m => m[1]);
    igual(ordem[0], 'resumo', 'quem abre o Financeiro quer o panorama primeiro');
    ok(casca.includes("import('./resumo-ui.js')"));
  });
});
