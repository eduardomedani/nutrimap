// NÍVEL 1 — a linha da refeição: grade alinhada, formatação padronizada e
// cliques que acertam o alvo certo.
//
// A renderização é string pura, então dá para verificar sem navegador. O
// comportamento do clique é verificado com o DOM falso, exercitando a MESMA
// delegação que a tela usa.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { criarNo, criarContainer } from './dom-falso.mjs';

const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

grupo('rotina · grade alinhada', () => {
  teste('todas as linhas leem a MESMA definição de colunas', () => {
    // Uma variável só: é o que impede uma coluna de sair do lugar em relação
    // à outra quando o conteúdo de uma refeição é mais longo.
    ok(/--rt-cols:/.test(css), 'faltou a variável das colunas');
    const regra = /\.rt-linha \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'grid-template-columns: var(--rt-cols)',
      'a linha tem que ler a variável, nunca larguras soltas');
  });

  teste('as ações ocupam espaço real e ficam centradas na linha', () => {
    // Regressão: com `position: absolute` + `top` fixo, mudar a altura da linha
    // tirava os botões do eixo — foi assim que eles "caíram para baixo".
    const topo = /\.rt-topo \{[^}]*\}/.exec(css)?.[0] || '';
    contem(topo, 'display: flex', 'linha e ações têm que dividir a mesma faixa');
    contem(topo, 'align-items: center', 'é isso que mantém os botões no eixo');
    ok(!/\.rt-acts \{[^}]*position: absolute/.test(css),
      'as ações não podem mais ser posicionadas de forma absoluta');
  });

  teste('há respiro entre o último número e os botões', () => {
    const topo = /\.rt-topo \{[^}]*\}/.exec(css)?.[0] || '';
    contem(topo, 'gap: var(--rt-respiro)', 'o afastamento é o gap, não padding solto');
    const px = /--rt-respiro: (\d+)px/.exec(css);
    ok(px && Number(px[1]) >= 72, `esperava >= 72px de respiro, veio ${px?.[1]}px`);
  });

  teste('valores numéricos são tabulares e alinhados à direita', () => {
    contem(/\.rt-val-num \{[^}]*\}/.exec(css)?.[0] || '', 'font-variant-numeric: tabular-nums');
    // O bloco valor+legenda encosta na direita da coluna: é o que faz kcal
    // ficar embaixo de kcal mesmo com números de larguras diferentes.
    ok(/\.rt-val \{[^}]*align-items: flex-end/.test(css), 'faltou alinhar o indicador à direita');
  });

  teste('toda linha recolhida tem a mesma altura', () => {
    ok(/\.rt-linha \{[^}]*min-height:/.test(css), 'faltou min-height na linha');
  });

  teste('cada indicador traz a própria legenda em texto', () => {
    // A legenda vive na célula, não numa faixa de cabeçalho: o rótulo fica
    // colado no número e o olho não precisa subir para lembrar a coluna.
    for (const rotulo of ['Calorias', 'Proteína', 'Carboidrato', 'Gordura']) {
      contem(ui, `'${rotulo}'`, `faltou o rótulo ${rotulo}`);
    }
    ok(ui.includes('rt-val-lbl'), 'a legenda precisa de elemento próprio');
  });
});

grupo('rotina · formatação padronizada', () => {
  // O formatador de exibição vive na UI porque dieta-calc.fmtG omite o ",0"
  // de propósito (bom em texto corrido, ruim em coluna).
  const fmtMacro = (v) => (Number(v) || 0)
    .toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  teste('macro SEMPRE com uma casa decimal', () => {
    igual(fmtMacro(49), '49,0', 'inteiro não pode virar "49"');
    igual(fmtMacro(41.7), '41,7');
    igual(fmtMacro(0), '0,0', 'refeição vazia mostra 0,0 — não some da grade');
    igual(fmtMacro(14.05), '14,1');
  });

  teste('a UI usa esse formatador nas colunas de macro', () => {
    ok(ui.includes('const fmtMacro'), 'faltou o formatador de coluna');
    ok(/fmtMacro\(m\.prot\)/.test(ui) && /fmtMacro\(m\.carb\)/.test(ui) && /fmtMacro\(m\.gord\)/.test(ui),
      'proteína, carboidrato e gordura têm que passar por ele');
  });

  teste('kcal continua inteiro, via dieta-calc', () => {
    ok(/fmtKcal\(m\.kcal\)/.test(ui), 'kcal usa o formatador do núcleo');
  });
});

grupo('rotina · cliques acertam o alvo', () => {
  // Reproduz a delegação de dieta-ui.js: ação primeiro, linha depois.
  function montarRotina() {
    const chamou = [];
    const linha = criarNo({ 'data-ref-toggle': 'r1' });
    const editar = criarNo({ 'data-acao': 'editar', 'data-ref': 'r1' });
    const subir = criarNo({ 'data-acao': 'subir', 'data-ref': 'r1' });
    const descer = criarNo({ 'data-acao': 'descer', 'data-ref': 'r2' });
    const menu = criarNo({ 'data-acao': 'menu', 'data-ref': 'r3' });
    const desativado = criarNo({ 'data-acao': 'subir', 'data-ref': 'r1', disabled: true });

    // `closest` do DOM falso: cada nó é a própria raiz, então o alvo do evento
    // já é o botão — que é exatamente o caso real de clique no ícone.
    const aoClicar = (e) => {
      const btn = e.target.atributos['data-acao'] !== undefined ? e.target : null;
      if (btn && !btn.disabled) {
        e.stopPropagation();
        chamou.push(['acao', btn.dataset.acao, btn.dataset.ref]);
        return;
      }
      if (e.target.atributos['data-ref-toggle'] !== undefined) {
        chamou.push(['abrir', e.target.dataset.refToggle]);
      }
    };
    for (const n of [linha, editar, subir, descer, menu, desativado]) n.addEventListener('click', aoClicar);
    return { chamou, linha, editar, subir, descer, menu, desativado };
  }

  teste('clicar na linha abre o resumo daquela refeição', () => {
    const { chamou, linha } = montarRotina();
    linha.disparar('click');
    igual(chamou, [['abrir', 'r1']]);
  });

  teste('clicar numa ação NÃO abre o resumo', () => {
    const { chamou, editar } = montarRotina();
    editar.disparar('click');
    igual(chamou, [['acao', 'editar', 'r1']], 'só a ação, nunca a abertura junto');
  });

  teste('cada ação leva o id da SUA refeição', () => {
    const { chamou, subir, descer, menu } = montarRotina();
    subir.disparar('click');
    descer.disparar('click');
    menu.disparar('click');
    igual(chamou, [['acao', 'subir', 'r1'], ['acao', 'descer', 'r2'], ['acao', 'menu', 'r3']]);
  });

  teste('botão desabilitado não dispara nada', () => {
    const { chamou, desativado } = montarRotina();
    desativado.disparar('click');
    igual(chamou, []);
  });
});

grupo('rotina · delegação não duplica listeners', () => {
  teste('o container é marcado para não religar a cada render', () => {
    // Ligar botão a botão fazia o número de listeners crescer com o número de
    // renders (mover, salvar, abrir resumo — todos re-renderizam).
    ok(ui.includes("cont.dataset.delegado !== '1'"), 'faltou a guarda de registro único');
    ok(ui.includes('aoClicarNaRotina'), 'faltou o handler delegado');
    ok(!/querySelectorAll\('\[data-ref-(up|down|dup|del)\]'\)/.test(ui),
      'não deve sobrar ligação botão a botão nas ações da refeição');
  });

  teste('o handler resolve ação antes de linha, com stopPropagation', () => {
    const fn = /function aoClicarNaRotina[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    const iAcao = fn.indexOf('data-acao');
    const iLinha = fn.indexOf('data-ref-toggle');
    ok(iAcao > -1 && iLinha > -1, 'o handler tem que tratar os dois casos');
    ok(iAcao < iLinha, 'a ação tem que ser resolvida ANTES da linha');
    contem(fn, 'stopPropagation');
  });
});

grupo('rotina · resumo inline', () => {
  teste('o resumo é somente leitura', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    ok(fn, 'faltou a função do resumo');
    naoContem(fn, '<input', 'nada de campo editável no resumo');
    naoContem(fn, '<select', 'nada de campo editável no resumo');
    naoContem(fn, '<textarea', 'nada de campo editável no resumo');
  });

  teste('mostra as cinco colunas do briefing', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    for (const c of ['rt-al-nome', 'rt-al-qtd', 'rt-al-med', 'rt-al-peso', 'rt-al-subs']) {
      contem(fn, c, `faltou a coluna ${c}`);
    }
    contem(fn, 'itemParaResumo(', 'os valores têm que vir do adaptador único');
  });

  teste('cabeçalho e linhas usam a MESMA grade', () => {
    ok(/--al-cols:/.test(css), 'faltou a variável das colunas do resumo');
    const regra = /\.rt-al \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'grid-template-columns: var(--al-cols)',
      'a linha tem que ler a variável, e o cabeçalho herda a mesma');
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    contem(fn, 'rt-al rt-al-th', 'o cabeçalho é uma linha da mesma lista');
  });

  teste('nenhum cálculo é refeito dentro do template', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    naoContem(fn, 'medidaDoItem(', 'o adaptador já resolveu isso');
    naoContem(fn, 'pesoDeItem(', 'idem');
    naoContem(fn, '* 100', 'nada de converter múltiplo de 100 g na mão');
  });

  teste('substituição vira chip clicável de "opções"', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    contem(fn, "'opção' : 'opções'", 'o rótulo é "opções", não "substituições"');
    contem(fn, 'data-acao="subs"', 'o chip tem que abrir o painel');
    ok(/<button class="rt-al-chip"/.test(fn), 'o chip precisa ser botão de verdade');
  });

  teste('cada alimento tem ações rápidas no hover', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    for (const a of ['editar', 'subs', 'dup-item', 'del-item']) {
      contem(fn, `rapida('${a}'`, `faltou a ação rápida ${a}`);
    }
    ok(/\.rt-al-acts \{[^}]*opacity: 0;/.test(css), 'as ações rápidas ficam discretas até o hover');
    ok(/\.rt-al:hover \.rt-al-acts/.test(css), 'e aparecem no hover da linha');
  });

  teste('não repete os macros que já estão no cabeçalho', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    naoContem(fn, 'fmtMacro', 'macro é assunto da linha, não do resumo');
  });

  teste('refeição vazia mostra estado útil com ação', () => {
    const fn = /function resumoRefeicaoHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    contem(fn, 'ainda não possui alimentos');
    contem(fn, 'Adicionar primeiro alimento');
  });

  teste('a Action Bar tem três níveis de hierarquia', () => {
    const fn = /function actionBarHtml[\s\S]*?\n\}/.exec(ui)?.[0] || '';
    ok(fn, 'faltou a Action Bar');
    contem(fn, 'rt-acao-1', 'Editar refeição é a ação principal');
    contem(fn, 'rt-acao-2', 'Adicionar alimento é a secundária');
    contem(fn, 'rt-acao-3', 'Duplicar é a terciária');
    // Sólido, outline verde, outline cinza — três pesos, não três iguais.
    ok(/\.rt-acao-1 \{[^}]*background: var\(--moss\)/.test(css), 'a principal tem que ser sólida');
    ok(/\.rt-acao-2 \{[^}]*border-color: color-mix/.test(css), 'a secundária é outline verde');
    ok(/\.rt-acao-3 \{[^}]*border-color: var\(--line\)/.test(css), 'a terciária é outline cinza');
  });

  teste('os três botões têm a mesma altura e 12px entre eles', () => {
    contem(/\.rt-acao \{[^}]*\}/.exec(css)?.[0] || '', 'height: 38px', 'altura uniforme');
    contem(/\.rt-bar \{[^}]*\}/.exec(css)?.[0] || '', 'gap: 12px');
    ok(/\.rt-bar \{[^}]*border-top/.test(css), 'a barra é separada por uma divisória discreta');
  });

  teste('várias refeições podem ficar abertas ao mesmo tempo', () => {
    ok(/_resumos\s*=\s*new Set\(\)/.test(ui), 'o estado tem que ser um conjunto, não um id só');
    ok(/_resumos\.has\(id\) \? _resumos\.delete\(id\) : _resumos\.add\(id\)/.test(ui)
       || /if \(_resumos\.has\(id\)\) _resumos\.delete\(id\); else _resumos\.add\(id\);/.test(ui),
      'alternar não pode fechar as outras');
  });
});

grupo('rotina · acessibilidade', () => {
  teste('a linha é um botão de verdade (Enter e Espaço de graça)', () => {
    ok(/<button class="rt-linha"/.test(ui), 'a linha tem que ser <button>, não div');
  });

  teste('estado de expansão é anunciado', () => {
    contem(ui, 'aria-expanded="${aberta}"', 'faltou aria-expanded na linha');
    contem(ui, 'aria-controls="${painelId}"', 'faltou aria-controls apontando o painel');
    contem(ui, 'id="${painelId}"', 'o painel precisa do id referenciado');
  });

  teste('cada ação tem rótulo acessível com o nome da refeição', () => {
    contem(ui, 'aria-label="${esc(rotulo)} — ${esc(r.nome', 'ícone sem rótulo não diz nada ao leitor de tela');
  });

  teste('a seta indica o estado por rotação, não só por cor', () => {
    ok(/\.rt-card\.aberta \.rt-seta \{[^}]*transform: rotate/.test(css), 'faltou girar a seta ao abrir');
  });
});
