// O adaptador de apresentação do resumo: traduzir o item do banco para o que o
// profissional lê, sem confundir os três conceitos.
//
//   quantidade  o número prescrito NA MEDIDA escolhida
//   medida      o nome da unidade
//   peso        o peso final em gramas
//
// O banco guarda `quantidade` como MÚLTIPLO DE 100 g. Esse valor interno nunca
// pode vazar para a tela — é a origem do "valor errado" que este arquivo trava.

import { grupo, teste, igual, ok, contem } from './runner.mjs';
import { itemParaResumo } from '../js/dieta-linha.js';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

// Medidas caseiras cadastradas para os alimentos dos casos.
const OVO = [{ descricao: 'unidade média', gramas: 45 }];
const CAFE = [{ descricao: 'xícara de chá (200 ml)', gramas: 200 }];
const ARROZ = [{ descricao: 'colher de sopa cheia', gramas: 25 }];

grupo('resumo · quantidade, medida e peso', () => {
  teste('gramas: 45 g prescritos', () => {
    // quantidade interna 0,45 = 45 g. A tela mostra 45, não 0,45.
    const v = itemParaResumo({ quantidade: 0.45, medida: null }, []);
    igual(v.quantidade, '45');
    igual(v.medida, 'gramas');
    igual(v.pesoTexto, '45 g');
  });

  teste('unidade: 2 unidades médias = 90 g', () => {
    const v = itemParaResumo({ quantidade: 0.9, medida: 'unidade média' }, OVO);
    igual(v.quantidade, '2', 'a quantidade é 2, não 90 nem 0,9');
    igual(v.medida, 'unidade média', 'a medida não pode virar "gramas"');
    igual(v.pesoTexto, '90 g');
  });

  teste('xícara: 1 xícara de 200 g', () => {
    const v = itemParaResumo({ quantidade: 2, medida: 'xícara de chá (200 ml)' }, CAFE);
    igual(v.quantidade, '1');
    igual(v.medida, 'xícara de chá (200 ml)');
    igual(v.pesoTexto, '200 g');
  });

  teste('fração de medida: 2,5 colheres', () => {
    const v = itemParaResumo({ quantidade: 0.625, medida: 'colher de sopa cheia' }, ARROZ);
    igual(v.quantidade, '2,5');
    igual(v.pesoTexto, '62,5 g');
  });

  teste('o valor interno (múltiplo de 100 g) nunca aparece', () => {
    for (const caso of [
      { item: { quantidade: 0.45, medida: null }, medidas: [] },
      { item: { quantidade: 0.9, medida: 'unidade média' }, medidas: OVO },
    ]) {
      const v = itemParaResumo(caso.item, caso.medidas);
      ok(v.quantidade !== String(caso.item.quantidade),
        `a quantidade exibida (${v.quantidade}) não pode ser o valor interno`);
    }
  });

  teste('o peso não muda quando a medida muda', () => {
    // Trocar a unidade de exibição não altera a prescrição.
    const emGramas = itemParaResumo({ quantidade: 0.9, medida: null }, OVO);
    const emUnidades = itemParaResumo({ quantidade: 0.9, medida: 'unidade média' }, OVO);
    igual(emGramas.peso, emUnidades.peso, 'o peso é o mesmo nos dois');
    igual(emGramas.quantidade, '90');
    igual(emUnidades.quantidade, '2');
  });
});

grupo('resumo · dado ausente ou inconsistente', () => {
  teste('medida salva que sumiu do cadastro NÃO vira "gramas"', () => {
    // O item foi prescrito em "unidade média", mas a medida foi apagada de
    // food_measures. Dizer "gramas" afirmaria uma prescrição que não é a real.
    const v = itemParaResumo({ quantidade: 0.9, medida: 'unidade média' }, []);
    igual(v.medida, 'unidade média', 'mostra o que está salvo no item');
    igual(v.quantidade, null, 'sem a medida não dá para derivar a quantidade');
    ok(!v.medidaConhecida, 'e sinaliza que o cadastro está inconsistente');
    igual(v.pesoTexto, '90 g', 'o peso continua correto: não depende da medida');
  });

  teste('medida com gramas zerado também não é confiável', () => {
    const v = itemParaResumo({ quantidade: 0.5, medida: 'porção' }, [{ descricao: 'porção', gramas: 0 }]);
    igual(v.quantidade, null);
    ok(!v.medidaConhecida);
  });

  teste('item sem nada não quebra a refeição', () => {
    const v = itemParaResumo({}, []);
    igual(v.quantidade, '0');
    igual(v.medida, 'gramas');
    igual(v.pesoTexto, '0 g');
  });

  teste('a tela mostra "—" só quando o valor não existe', () => {
    const uiSrc = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(uiSrc)?.[0] || '';
    contem(fn, 'v.quantidade ??', 'o traço é fallback da quantidade, não regra geral');
    contem(fn, 'rt-al-nulo', 'e tem estilo próprio de ausência');
  });
});

grupo('resumo · unidades', () => {
  teste('o peso sai em gramas — food_measures só guarda gramas', () => {
    // Não existe coluna de unidade em food_measures: uma medida "em ml" carrega
    // o ml no NOME, e o peso continua sendo peso. Inventar "200 ml" no campo de
    // peso seria criar uma unidade que o banco não representa.
    const v = itemParaResumo({ quantidade: 2, medida: 'xícara de chá (200 ml)' }, CAFE);
    contem(v.pesoTexto, ' g', 'peso em gramas');
    contem(v.medida, 'ml', 'o ml aparece no nome da medida, que é onde ele existe');
  });

  teste('nunca gruda "g" na quantidade', () => {
    const v = itemParaResumo({ quantidade: 0.9, medida: 'unidade média' }, OVO);
    ok(!String(v.quantidade).includes('g'), 'quantidade é número puro');
  });
});

grupo('resumo · barra de ações numa linha só', () => {
  const bar = /\.rt-bar \{[^}]*\}/.exec(css)?.[0] || '';

  teste('os três botões ficam no mesmo container, em linha', () => {
    contem(bar, 'display: flex');
    contem(bar, 'flex-wrap: nowrap', 'no desktop nenhum botão pode cair para baixo');
    contem(bar, 'justify-content: flex-start', 'alinhados à esquerda');
  });

  teste('nada de space-between nem margin-left automática', () => {
    ok(!/\.rt-bar \{[^}]*space-between/.test(css), 'space-between espalharia as ações');
    ok(!/\.rt-acao-3 \{[^}]*margin-left: auto/.test(css),
      'era o margin-left:auto que isolava "Duplicar" na direita');
  });

  teste('largura pelo conteúdo, nunca 100% no desktop', () => {
    const acao = /\.rt-acao \{[^}]*\}/.exec(css)?.[0] || '';
    contem(acao, 'flex: 0 0 auto', 'o botão não estica nem encolhe');
    contem(acao, 'white-space: nowrap');
    // width: 100% só pode existir dentro de media query de mobile.
    const fora = css.split('@media')[0];
    ok(!/\.rt-acao \{[^}]*width: 100%/.test(fora), 'largura cheia é só no mobile');
  });

  teste('altura idêntica nos três', () => {
    contem(/\.rt-acao \{[^}]*\}/.exec(css)?.[0] || '', 'height: 38px');
  });

  teste('mobile: principal na primeira linha, as outras duas embaixo', () => {
    // Pega o bloco de media query que trata a barra, não o primeiro do arquivo.
    const mob = (css.match(/@media \(max-width: 5\d0px\) \{[\s\S]*?\n  \}/g) || [])
      .find(b => b.includes('.rt-bar')) || '';
    ok(mob, 'faltou o tratamento mobile da barra de ações');
    contem(mob, 'grid-template-columns: 1fr 1fr');
    contem(mob, 'grid-column: 1 / -1', 'Editar refeição ocupa a linha toda');
  });
});
