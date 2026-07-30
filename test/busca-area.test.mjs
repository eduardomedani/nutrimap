// Área "Adicionar alimento" embutida no drawer da refeição.
//
// A regra que organiza tudo aqui: acima é FERRAMENTA (procurando), abaixo é
// PRESCRIÇÃO (já montado). As duas não podem parecer o mesmo nível.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { chaveDeFonte, filtrarPorFonte, ABAS, FILTROS } from '../js/dieta-busca.js';

const busca = readFileSync(new URL('../js/dieta-busca.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

grupo('busca · superfície e hierarquia', () => {
  teste('a área tem tonalidade própria, composta do token da marca', () => {
    // A superfície é da ÁREA, não da busca: ela existe igual nos dois estados,
    // então abrir a busca não muda o fundo nem a posição.
    const regra = /\.rf-add-area \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'color-mix(in srgb, var(--color-primary-400)',
      'nada de cor nova hardcoded: a tonalidade sai do token');
    ok(!/#[0-9a-f]{6}/i.test(regra), 'sem hex solto na superfície');
    contem(regra, 'border:', 'e uma borda sutil delimitando');
  });

  teste('fechada e aberta são a MESMA área, no mesmo lugar', () => {
    const rf = readFileSync(new URL('../js/dieta-refeicao.js', import.meta.url), 'utf8');
    // Um container só, que troca o conteúdo — não dois blocos alternando.
    contem(rf, 'class="rf-add-area', 'faltou o container da área');
    contem(rf, "ctx.buscaHtml || `", 'o conteúdo é botão OU busca, dentro dele');
    // A busca embutida não pode desenhar uma segunda moldura por dentro.
    const inline = /\.di-drawer-inline \{[^}]*\}/.exec(css)?.[0] || '';
    contem(inline, 'background: none', 'a busca herda a superfície da área');
    contem(inline, 'border: none', 'sem caixa dentro de caixa');
  });

  teste('o título é a AÇÃO; a refeição é contexto', () => {
    const i1 = busca.indexOf('Adicionar alimento</div>');
    const i2 = busca.indexOf('di-dw-eyebrow');
    ok(i1 > -1, 'faltou o título "Adicionar alimento"');
    ok(i1 < i2, 'o título vem antes do nome da refeição');
    contem(busca, 'Em ${esc(nomeRefeicao', 'o nome vira contexto secundário');
    // O eyebrow deixou de ser caixa alta gigante.
    ok(/\.di-drawer-inline \.di-dw-eyebrow \{[^}]*text-transform: none/.test(css));
  });

  teste('o campo de busca é o elemento dominante', () => {
    const regra = /\.di-drawer-inline \.di-dw-busca \{[^}]*\}/.exec(css)?.[0] || '';
    const h = /height: (\d+)px/.exec(regra);
    ok(h && Number(h[1]) >= 48 && Number(h[1]) <= 54, `altura esperada 48–54px, veio ${h?.[1]}`);
    const input = /\.di-drawer-inline \.di-dw-busca input \{[^}]*\}/.exec(css)?.[0] || '';
    const f = /font-size: ([\d.]+)px/.exec(input);
    ok(f && Number(f[1]) >= 15, `fonte esperada >= 15px, veio ${f?.[1]}`);
  });

  teste('o campo é delimitado por contorno, não por preenchimento', () => {
    // Uma coisa OU outra: a caixa branca com borda desenhava um bloco dentro
    // do bloco. Fica só a linha, e o verde da área aparece por baixo.
    const regra = /\.di-drawer-inline \.di-dw-busca \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'background: none', 'sem preenchimento próprio');
    contem(regra, 'border: 1.5px solid', 'a delimitação é a linha');
  });

  teste('o input ocupa toda a largura útil do campo', () => {
    // Era o <input> dentro do wrapper que ficava espremido, não o wrapper.
    const input = /\.di-drawer-inline \.di-dw-busca input \{[^}]*\}/.exec(css)?.[0] || '';
    contem(input, 'flex: 1 1 auto');
    contem(input, 'width: 100%');
    contem(input, 'min-width: 0', 'sem isto o flex não deixa o input encolher/crescer direito');
  });

  teste('o foco é claro e sem brilho exagerado', () => {
    const foco = /\.di-drawer-inline \.di-dw-busca:focus-within \{[^}]*\}/.exec(css)?.[0] || '';
    contem(foco, 'border-color: var(--moss)', 'a borda fecha em verde institucional');
    contem(foco, 'box-shadow: 0 0 0 3px', 'anel discreto, não glow');
  });

  teste('o placeholder está completo', () => {
    contem(busca, 'Buscar alimento, marca, receita ou código de barras');
  });

  teste('as abas são secundárias ao campo', () => {
    const aba = /\.di-drawer-inline \.di-dw-aba\.ativa \{[^}]*\}/.exec(css)?.[0] || '';
    contem(aba, 'border-bottom-color: var(--moss)', 'indicador inferior');
    contem(aba, 'background: none', 'sem fundo pesado');
  });
});

grupo('busca · resultados e ações', () => {
  teste('o botão Adicionar tem destaque e três estados', () => {
    const regra = /\.di-res-add \{[^}]*\}/.exec(css)?.[0] || '';
    const h = /height: (\d+)px/.exec(regra);
    ok(h && Number(h[1]) >= 34 && Number(h[1]) <= 38, `altura esperada 34–38px, veio ${h?.[1]}`);
    contem(regra, 'color-mix(in srgb, var(--color-primary-400)', 'outline verde em repouso');
    ok(/\.di-res-add:hover:not\(:disabled\) \{[^}]*background: var\(--moss\)/.test(css), 'sólido no hover');

    contem(busca, 'function botaoAddHtml', 'faltou o construtor dos estados');
    contem(busca, 'Adicionando');
    contem(busca, 'Adicionado');
  });

  teste('adicionar não trava a busca inteira', () => {
    // O estado é POR ITEM: só o botão clicado muda.
    contem(busca, '_adicionando = al.id', 'o item em voo é identificado');
    contem(busca, '_adicionando === a.id', 'e só ele mostra carregamento');
    const fn = /async function adicionar\(i\)[\s\S]*?\n\}/.exec(busca)?.[0] || '';
    naoContem(fn, '_buscando = true', 'o carregamento global não pode ser acionado');
  });

  teste('"Adicionado" some sozinho e avisa o leitor de tela', () => {
    contem(busca, '_timerAdicionado', 'o estado de sucesso é temporário');
    contem(busca, 'diDwAviso', 'faltou a região aria-live');
    contem(busca, 'aria-live="polite"');
  });

  teste('favoritar tem alvo confortável e estados distintos', () => {
    const regra = /\.di-drawer-inline \.di-res-fav \{[^}]*\}/.exec(css)?.[0] || '';
    const w = /width: (\d+)px/.exec(regra);
    ok(w && Number(w[1]) >= 32, `alvo esperado >= 32px, veio ${w?.[1]}`);
    ok(/\.di-drawer-inline \.di-res-fav\.ativo \{[^}]*var\(--gold\)/.test(css), 'ativo bem diferente');
    contem(busca, 'aria-pressed=', 'e o estado é anunciado');
  });

  teste('a lista de resultados tem altura limitada e rola sozinha', () => {
    const regra = /\.di-drawer-inline \.di-dw-lista \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'max-height', 'não pode empurrar a prescrição para baixo');
    ok(/\.di-dw-lista \{[^}]*overflow-y: auto/.test(css), 'só os resultados rolam');
  });
});

grupo('busca · estados vazios', () => {
  teste('sem resultado, o vazio explica e oferece saída', () => {
    contem(busca, 'Nenhum alimento encontrado.');
    contem(busca, 'Tente outro termo ou altere os filtros.');
    contem(busca, 'Limpar filtros', 'com ação para desfazer o filtro');
  });

  teste('filtro escondendo tudo não vira "nada encontrado"', () => {
    // Dizer "nada encontrado" mandaria o nutri procurar o erro no lugar errado.
    contem(busca, 'escondido', 'o texto tem que apontar o filtro');
    contem(busca, "acao: 'limpar'");
  });

  teste('campo vazio mostra conteúdo útil, não uma área em branco', () => {
    contem(busca, 'Comece a digitar.');
    contem(busca, 'Ou escolha entre favoritos, recentes e mais usados.');
    igual(ABAS.map(([k]) => k), ['alimentos', 'favoritos', 'recentes', 'maisusados']);
  });
});

grupo('busca · o que não pode ter mudado', () => {
  teste('a lógica de filtro continua a mesma', () => {
    const todos = [
      { id: 'a', fonte_dados: 'TACO', nutri_id: null },
      { id: 'b', fonte_dados: 'USDA', nutri_id: null },
      { id: 'c', fonte_dados: 'Proprio', nutri_id: 'n1' },
    ];
    igual(filtrarPorFonte(todos, new Set(['taco'])).map(f => f.id), ['a']);
    igual(filtrarPorFonte(todos, new Set()).length, 3);
    igual(chaveDeFonte(todos[2]), 'proprios');
  });

  teste('os filtros do briefing continuam disponíveis', () => {
    const chaves = FILTROS.map(f => f.chave);
    for (const c of ['taco', 'usda', 'proprios', 'receitas']) {
      ok(chaves.includes(c), `faltou o filtro ${c}`);
    }
    const receitas = FILTROS.find(f => f.chave === 'receitas');
    ok(receitas.indisponivel, 'Receitas precisa explicar por que não funciona ainda');
  });

  teste('o fluxo de adição não mudou', () => {
    const fn = /async function adicionar\(i\)[\s\S]*?\n\}/.exec(busca)?.[0] || '';
    contem(fn, '_api.adicionar(_refId, al)', 'mesma chamada de sempre');
    contem(fn, "inp.value = ''", 'limpa o termo, como antes');
    contem(fn, 'carregarAba()', 'e volta às sugestões');
  });

  teste('a busca não faz conta nutricional', () => {
    naoContem(busca, '* 100');
    naoContem(busca, '/ 100');
    contem(busca, "from './dieta-calc.js'", 'só formatação vem de lá');
  });
});
