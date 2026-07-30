// Testes estruturais: o que quebra o app inteiro antes de qualquer regra.

import { grupo, teste, ok, igual } from './runner.mjs';
import { conferirImports } from './check-imports.mjs';
import { readFileSync, readdirSync } from 'node:fs';

grupo('estrutura · imports e exports', () => {
  teste('todo import nomeado existe como export no destino', () => {
    const { arquivos, problemas } = conferirImports();
    ok(arquivos > 0, 'não achou nenhum módulo para conferir');
    ok(problemas.length === 0, `imports quebrados:\n      ${problemas.join('\n      ')}`);
  });
});

grupo('estrutura · os módulos da dieta carregam', () => {
  // Import de verdade, com o Supabase dublado. Pega erro de topo de arquivo —
  // o tipo que só apareceria como tela branca no navegador.
  const MODULOS = [
    '../js/dieta-calc.js',
    '../js/dieta-linha.js',
    '../js/dieta-busca.js',
    '../js/dieta.js',
    '../js/dieta-ui.js',
    '../js/dieta-grupos.js',
    '../js/dieta-gerar.js',
  ];

  for (const caminho of MODULOS) {
    teste(`carrega ${caminho.replace('../js/', '')}`, async () => {
      const mod = await import(caminho);
      ok(mod && Object.keys(mod).length > 0, 'módulo carregou sem exportar nada');
    });
  }

  teste('dieta-ui expõe as duas entradas que o index.html usa', async () => {
    const mod = await import('../js/dieta-ui.js');
    ok(typeof mod.initDietaUIParaPaciente === 'function');
    ok(typeof mod.initBibliotecaDietas === 'function');
  });
});

grupo('estrutura · CSS da dieta saiu do index.html', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

  teste('o index.html não tem mais regras .di-', () => {
    const dentroDoStyle = index.slice(index.indexOf('<style>'), index.indexOf('</style>'));
    const regras = dentroDoStyle.match(/^\s*\.di-[a-z-]+\s*\{/gm) || [];
    igual(regras.length, 0, `sobraram regras no <style>: ${regras.slice(0, 3).join(' ')}`);
  });

  teste('o index.html carrega css/dieta.css', () => {
    ok(index.includes('href="css/dieta.css"'), 'faltou o <link>');
  });

  teste('dieta.css vem ANTES de tokens.css e brand.css', () => {
    // brand.css sobrescreve .di-secao-tit, .di-ref e as barras de macro. Se a
    // ordem inverter, a folha da dieta vence a marca e a tela muda de cara.
    const iDieta = index.indexOf('href="css/dieta.css"');
    const iTokens = index.indexOf('href="css/tokens.css"');
    const iBrand = index.indexOf('href="css/brand.css"');
    ok(iDieta > 0 && iTokens > 0 && iBrand > 0, 'faltou algum <link>');
    ok(iDieta < iTokens && iDieta < iBrand, 'dieta.css tem que vir antes de tokens/brand');
  });

  teste('o CSS extraído tem as classes principais da prescrição', () => {
    for (const classe of ['.di-tr', '.di-item', '.di-drawer', '.di-card', '.di-somas']) {
      ok(css.includes(classe), `faltou ${classe} no css/dieta.css`);
    }
  });

  teste('as peças novas têm estilo', () => {
    for (const classe of ['.di-badge', '.di-sub-chip', '.di-subs', '.di-filtro', '.di-res-fav',
                          '.di-it-obs', '.di-tb', '.di-tb-btn', '.di-somas', '.di-sb']) {
      ok(css.includes(classe), `faltou ${classe} no css/dieta.css`);
    }
  });

  teste('a tela usa toda a largura (sem max-width na prescrição)', () => {
    // O max-width de 1200px deixava um terço do monitor vazio.
    const regra = /\.di-rx \{[^}]*\}/.exec(css)?.[0] || '';
    ok(regra.includes('max-width: none'), `\n      .di-rx ainda limita a largura: ${regra}`);
  });

  teste('o chip de status não colide com o chip de substituição', () => {
    // Os dois se chamavam .di-chip; o segundo apagava a formatação do primeiro.
    const statusChip = /^\s*\.di-chip \{/m.exec(css);
    const subChip = /^\s*\.di-sub-chip \{/m.exec(css);
    ok(statusChip, 'faltou o .di-chip do status do plano');
    ok(subChip, 'a substituição tem que usar .di-sub-chip');
  });
});

grupo('estrutura · barra de ferramentas', () => {
  const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');
  // Toda ação do dia a dia tem botão próprio E fiação. Botão renderizado sem
  // listener é o defeito clássico deste tipo de barra: parece pronto e não faz
  // nada. Aqui os dois lados são conferidos pelo mesmo id.
  const ACOES = ['diAddRefeicao', 'diEditarCalc', 'diDuplicar', 'diPdf',
                 'diRecolher', 'diExpandir', 'diAtalhos', 'diSalvarRasc', 'diPublicar', 'plDadosEditar'];

  for (const id of ACOES) {
    teste(`${id} é renderizado e ligado`, () => {
      // O id pode vir literal no HTML ou pelo helper btn('id', ...).
      const renderizado = ui.includes(`id="${id}"`) || ui.includes(`btn('${id}'`);
      ok(renderizado, `faltou o botão ${id} na barra`);
      ok(ui.includes(`ao('${id}'`) || ui.includes(`#${id}`), `o botão ${id} não está ligado a nada`);
    });
  }

  teste('não sobrou menu "..." escondendo ação diária do plano', () => {
    ok(!ui.includes('data-mais='), 'o menu de ações do plano devia ter saído');
    ok(!ui.includes('id="diMaisBtn"'), 'o botão "..." do plano devia ter saído');
  });

  teste('a barra de somas mostra o que o briefing pediu', () => {
    for (const rotulo of ['Calorias', 'Proteína', 'Carboidrato', 'Gordura', 'Fibra', 'Meta']) {
      ok(ui.includes(`>${rotulo}<`) || ui.includes(`'${rotulo}'`), `faltou ${rotulo} na barra de somas`);
    }
  });

  teste('Ctrl+Enter adiciona alimento na refeição do cursor', () => {
    ok(ui.includes("e.key === 'Enter'"), 'faltou o atalho Ctrl+Enter');
    ok(ui.includes('refeicaoDoFoco'), 'o atalho tem que respeitar onde o cursor está');
  });
});

grupo('estrutura · nada de cálculo paralelo na interface', () => {
  // A regra "quantidade é múltiplo de 100 g" mora em dieta-calc.js. Se outro
  // módulo escrever `* 100` ou `/ 100` por conta própria, a conta passa a ter
  // duas versões — e uma delas vai ficar para trás.
  teste('só dieta-calc.js define a base de 100 g', () => {
    const suspeitos = [];
    for (const arq of readdirSync(new URL('../js/', import.meta.url))) {
      if (!arq.endsWith('.js') || arq === 'dieta-calc.js') continue;
      if (!arq.startsWith('dieta')) continue;
      const src = readFileSync(new URL(`../js/${arq}`, import.meta.url), 'utf8');
      // split em /\r?\n/, não em '\n': com CRLF o \r sobra no fim da linha, e
      // como '.' não casa terminador de linha, /\/\/.*$/ não removeria o
      // comentário — todo comentário viraria falso positivo.
      for (const linha of src.split(/\r?\n/)) {
        const codigo = linha.replace(/\/\/.*$/, '');
        if (/\bquantidade\b[^\n]*[*/]\s*100\b|\b100\s*[*/][^\n]*\bquantidade\b/.test(codigo)) {
          suspeitos.push(`${arq}: ${linha.trim()}`);
        }
      }
    }
    igual(suspeitos, [], 'converta pelas funções de dieta-calc.js');
  });
});
