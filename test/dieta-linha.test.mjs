// A linha do alimento: badge de fonte, leitura defensiva das substituições
// gravadas no jsonb, e a renderização (que é string pura, então dá para
// verificar sem navegador).

import { grupo, teste, igual, ok, contem, naoContem } from './runner.mjs';
import {
  itensHtml, itemRowHtml, substituicoesDoItem, fonteDoAlimento, badgeFonteHtml, ligarItens,
} from '../js/dieta-linha.js';
import { criarNo, criarContainer } from './dom-falso.mjs';

const PAO = {
  id: 'f9', nome: 'Pão, trigo, forma, integral', fonte_dados: 'TACO',
  calorias: 253, proteina: 9.4, carboidrato: 49.9, gordura: 3.7,
};
const MEDIDAS = new Map([['f9', [{ descricao: 'fatia', gramas: 25 }]]]);
const CTX = { medidasDe: MEDIDAS };

const item = (extra = {}) => ({ id: 'i1', food_id: 'f9', food: PAO, quantidade: 0.45, medida: null, ...extra });

grupo('dieta-linha · badge de fonte', () => {
  teste('reconhece as fontes do catálogo', () => {
    igual(fonteDoAlimento({ fonte_dados: 'TACO' }).rotulo, 'TACO');
    igual(fonteDoAlimento({ fonte_dados: 'USDA' }).rotulo, 'USDA');
    igual(fonteDoAlimento({ fonte_dados: 'OpenFoodFacts' }).rotulo, 'OFF');
    igual(fonteDoAlimento({ fonte_dados: 'Proprio' }).rotulo, 'Próprio');
  });

  teste('fonte desconhecida não vira badge inventado', () => {
    igual(fonteDoAlimento({ fonte_dados: 'SeiLá' }), null);
    igual(fonteDoAlimento({}), null);
    igual(badgeFonteHtml({ fonte_dados: 'SeiLá' }), '');
  });

  teste('marca não é fonte — são coisas diferentes na linha', () => {
    const html = itemRowHtml(item({ food: { ...PAO, marca: 'Pullman' } }), 0, 1, CTX);
    contem(html, 'di-badge', 'badge da procedência');
    contem(html, 'Pullman');
    contem(html, 'di-it-marca', 'a marca tem o próprio lugar');
  });
});

grupo('dieta-linha · substituições do jsonb (somente leitura)', () => {
  teste('lê o formato que o gerador grava', () => {
    const subs = substituicoesDoItem(item({
      substituicoes: [
        { nome: 'Goma de tapioca hidratada', quantidade: 0.55, medida: '55g' },
        { nome: 'Cuscuz, de milho, cozido com sal', quantidade: 0.7, medida: '70g' },
      ],
    }));
    igual(subs.length, 2);
    igual(subs[0].nome, 'Goma de tapioca hidratada');
    igual(subs[0].detalhe, '55g');
  });

  teste('sem medida, deriva o peso da quantidade (múltiplo de 100 g)', () => {
    const subs = substituicoesDoItem(item({ substituicoes: [{ nome: 'Aveia', quantidade: 0.4 }] }));
    igual(subs[0].detalhe, '40 g');
  });

  teste('jsonb ausente ou de outro formato não quebra a linha', () => {
    igual(substituicoesDoItem(item({ substituicoes: null })), []);
    igual(substituicoesDoItem(item({ substituicoes: undefined })), []);
    igual(substituicoesDoItem(item({ substituicoes: {} })), []);
    igual(substituicoesDoItem(item({ substituicoes: 'tapioca' })), []);
    igual(substituicoesDoItem({}), []);
  });

  teste('descarta entrada sem nome, mantém as boas', () => {
    const subs = substituicoesDoItem(item({
      substituicoes: [{ quantidade: 1 }, null, { nome: '  ' }, { nome: 'Cuscuz' }],
    }));
    igual(subs.length, 1);
    igual(subs[0].nome, 'Cuscuz');
  });

  teste('aceita string solta como nome', () => {
    igual(substituicoesDoItem(item({ substituicoes: ['Tapioca'] })), [{ nome: 'Tapioca', detalhe: '' }]);
  });

  teste('mostra 3 chips e resume o resto', () => {
    const html = itemRowHtml(item({
      substituicoes: ['Tapioca', 'Cuscuz', 'Pão francês', 'Batata-doce', 'Mandioca'],
    }), 0, 1, CTX);
    contem(html, 'Tapioca');
    contem(html, 'Cuscuz');
    contem(html, 'Pão francês');
    contem(html, '+2', 'as duas restantes viram contador');
    naoContem(html, '>Mandioca<', 'a quarta em diante não vira chip');
  });

  teste('o bloco de chips é clicável e abre o painel', () => {
    const html = itemRowHtml(item({ substituicoes: ['Tapioca'] }), 0, 1, CTX);
    contem(html, '<button class="di-subs"', 'tem que ser botão, não div');
    contem(html, 'data-item-subs="i1"');
    contem(html, 'aria-label="Ver as 1 substituições deste alimento"');
  });

  teste('sem substituições, o bloco não existe', () => {
    naoContem(itemRowHtml(item(), 0, 1, CTX), 'di-subs');
  });
});

grupo('dieta-linha · renderização', () => {
  teste('mostra peso e macros vindos de dieta-calc', () => {
    const html = itemRowHtml(item({ quantidade: 0.45 }), 0, 1, CTX);
    contem(html, '45</b> g', 'peso final em gramas');
    contem(html, '114', '253 kcal x 0,45 = 113,85 -> 114');
  });

  teste('quantidade aparece NA MEDIDA escolhida', () => {
    // 45 g com medida "fatia" (25 g) = 1,8 fatias.
    const html = itemRowHtml(item({ medida: 'fatia' }), 0, 1, CTX);
    contem(html, 'value="1.8"');
  });

  teste('observação só aparece quando existe', () => {
    naoContem(itemRowHtml(item(), 0, 1, CTX), 'di-it-obs');
    contem(itemRowHtml(item({ observacao: 'sem açúcar' }), 0, 1, CTX), 'sem açúcar');
  });

  teste('observação em branco no banco não cria linha', () => {
    naoContem(itemRowHtml(item({ observacao: '   ' }), 0, 1, CTX), 'di-it-obs');
  });

  teste('as ações do dia a dia ficam VISÍVEIS na linha', () => {
    const html = itemRowHtml(item(), 0, 2, CTX);
    for (const acao of ['data-item-up', 'data-item-down', 'data-item-dup', 'data-item-obs', 'data-item-subs']) {
      contem(html, `${acao}="i1"`, `${acao} tem que estar na linha, não escondida`);
    }
  });

  teste('o menu "..." guarda só o que é raro e destrutivo', () => {
    const html = itemRowHtml(item(), 0, 2, CTX);
    const menu = /<div class="di-menu"[\s\S]*?<\/div>/.exec(html)?.[0] || '';
    contem(menu, 'data-item-del', 'remover é o que sobra no menu');
    naoContem(menu, 'data-item-dup', 'duplicar é diário — não pode estar escondido');
    naoContem(menu, 'data-item-up', 'mover é diário — não pode estar escondido');
  });

  teste('o botão de substituições marca quando existem', () => {
    const semSubs = itemRowHtml(item(), 0, 1, CTX);
    const comSubs = itemRowHtml(item({ substituicoes: ['Tapioca'] }), 0, 1, CTX);
    contem(semSubs, 'data-item-subs', 'o botão existe sempre');
    contem(comSubs, 'di-iact ativo', 'e fica aceso quando há alternativas');
  });

  teste('primeira linha não sobe e última não desce', () => {
    contem(itemRowHtml(item(), 0, 3, CTX), 'data-item-up="i1" disabled');
    contem(itemRowHtml(item(), 2, 3, CTX), 'data-item-down="i1" disabled');
  });

  teste('alimento removido não quebra a linha', () => {
    const html = itemRowHtml({ id: 'i2', quantidade: 1, food: null }, 0, 1, CTX);
    contem(html, '(alimento removido)');
  });

  teste('escapa HTML vindo do nome do alimento', () => {
    const html = itemRowHtml(item({ food: { ...PAO, nome: 'Pão <script>x</script>' } }), 0, 1, CTX);
    naoContem(html, '<script>');
    contem(html, '&lt;script&gt;');
  });

  teste('itensHtml monta cabeçalho e uma linha por item', () => {
    const html = itensHtml([item(), item({ id: 'i2' })], CTX);
    contem(html, 'role="table"');
    contem(html, 'data-item-row="i1"');
    contem(html, 'data-item-row="i2"');
  });
});

grupo('dieta-linha · teclado e eventos', () => {
  const montar = () => {
    const qtd = criarNo({ 'data-item-qtd': 'i1', value: '2' });
    const med = criarNo({ 'data-item-med': 'i1' });
    const obs = criarNo({ 'data-item-campo': 'observacao', 'data-item-id': 'i1' });
    const cont = criarContainer([qtd, med, obs]);
    const chamou = [];
    ligarItens(cont, {
      salvarQuantidade: (id, opts) => chamou.push(['qtd', id, opts]),
      trocarMedida: (id) => chamou.push(['medida', id]),
      salvarCampo: (el) => chamou.push(['campo', el.dataset.itemCampo]),
    });
    return { qtd, med, obs, chamou };
  };

  teste('change na quantidade salva', () => {
    const { qtd, chamou } = montar();
    qtd.disparar('change');
    igual(chamou[0][0], 'qtd');
    igual(chamou[0][1], 'i1');
  });

  teste('Enter salva e pede para descer para o próximo alimento', () => {
    const { qtd, chamou } = montar();
    const ev = qtd.disparar('keydown', { key: 'Enter', shiftKey: false });
    ok(ev.defaultPrevented, 'Enter não pode submeter a página');
    igual(chamou[0][2], { seguir: 1 });
  });

  teste('Shift+Enter sobe em vez de descer', () => {
    const { qtd, chamou } = montar();
    qtd.disparar('keydown', { key: 'Enter', shiftKey: true });
    igual(chamou[0][2], { seguir: -1 });
  });

  teste('outras teclas não disparam salvamento', () => {
    const { qtd, chamou } = montar();
    qtd.disparar('keydown', { key: 'a' });
    qtd.disparar('keydown', { key: 'Tab' });
    igual(chamou.length, 0);
  });

  teste('focar seleciona o conteúdo (digitar substitui)', () => {
    const { qtd } = montar();
    qtd.disparar('focus');
    ok(qtd.foiSelecionado, 'esperava select() no foco');
  });

  teste('medida e observação continuam ligadas', () => {
    const { med, obs, chamou } = montar();
    med.disparar('change');
    obs.disparar('change');
    igual(chamou.map(c => c[0]), ['medida', 'campo']);
  });

  teste('clicar em substituições chama o callback com o id do item', () => {
    const alvo = criarNo({ 'data-item-subs': 'i7' });
    const chamou = [];
    ligarItens(criarContainer([alvo]), { verSubstituicoes: (id) => chamou.push(id) });
    alvo.disparar('click');
    igual(chamou, ['i7']);
  });
});
