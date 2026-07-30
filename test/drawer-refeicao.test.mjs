// Drawer "Editar refeição" — a ergonomia do Nível 2.
//
// A regra da tela: "visualizar todos, editar um por vez". Antes, cada alimento
// carregava 9 controles simultâneos; numa refeição de seis eram ~54 alvos.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { alimentoItemHtml, listaAlimentosHtml } from '../js/dieta-linha.js';

const rf = readFileSync(new URL('../js/dieta-refeicao.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/dieta.css', import.meta.url), 'utf8');

const PAO = { id: 'f9', nome: 'Pão, trigo, forma, integral', fonte_dados: 'TACO',
              calorias: 253, proteina: 9.4, carboidrato: 49.9, gordura: 3.7 };
const CTX = { medidasDe: new Map([['f9', [{ descricao: 'fatia', gramas: 25 }]]]) };
const item = (extra = {}) => ({ id: 'i1', food_id: 'f9', food: PAO, quantidade: 0.45, medida: null, ...extra });

/**
 * Controles VISÍVEIS de um alimento. O conteúdo do menu não conta: ele nasce
 * `hidden` e só existe depois de um clique deliberado — não disputa a tela.
 */
const controles = (html) =>
  ((html.replace(/<div class="di-menu"[\s\S]*?<\/div>/, '').match(/<button|<input|<select/g)) || []).length;

grupo('drawer · visualizar todos, editar um por vez', () => {
  teste('o estado padrão é compacto', () => {
    const html = alimentoItemHtml(item(), 0, 3, CTX);
    naoContem(html, '<input', 'nenhum campo no repouso');
    naoContem(html, '<select');
  });

  teste('o compacto tem menos controles que o antigo', () => {
    // O item anterior tinha 9 (qtd, medida e seis botões + observação).
    const html = alimentoItemHtml(item({ substituicoes: ['x', 'y'] }), 0, 3, CTX);
    ok(controles(html) <= 4, `esperava até 4 controles no compacto, veio ${controles(html)}`);
  });

  teste('só o alimento escolhido abre os campos', () => {
    const lista = listaAlimentosHtml(
      [item(), item({ id: 'i2' }), item({ id: 'i3' })],
      { ...CTX, editando: 'i2' },
    );
    igual((lista.match(/al-item-edit/g) || []).length, 1, 'exatamente um em edição');
    igual((lista.match(/data-item-qtd/g) || []).length, 1, 'e um único campo de quantidade');
  });

  teste('o estado é exclusivo por construção', () => {
    // `_editando` guarda UM id; abrir outro substitui. Não é um Set.
    ok(/let _editando\s*=\s*null/.test(rf), 'o estado tem que ser um id, não uma coleção');
    ok(/_editando = \(_editando === id\) \? null : id/.test(rf),
      'abrir o mesmo fecha; abrir outro troca');
  });

  teste('Esc sai da edição do alimento antes de fechar o drawer', () => {
    const bloco = /_onTecla = \(e\) => \{[\s\S]*?\};/.exec(rf)?.[0] || '';
    contem(bloco, 'if (_editando)', 'a primeira camada do Esc é o alimento');
    ok(bloco.indexOf('fecharEdicaoItem') < bloco.indexOf('fecharRefeicao()'),
      'só depois de sair da edição é que o drawer fecha');
  });
});

grupo('drawer · hierarquia do alimento', () => {
  teste('a grade é a mesma em todos os itens', () => {
    ok(/--al-grid:/.test(css), 'faltou a variável da grade do alimento');
    const regra = /\.al-topo \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'grid-template-columns: var(--al-grid)',
      'nada de margens manuais por item');
  });

  teste('quantidade e peso têm mais contraste que os macros', () => {
    const peso = /\.al-peso \{[^}]*\}/.exec(css)?.[0] || '';
    const macros = /\.al-macros \{[^}]*\}/.exec(css)?.[0] || '';
    contem(peso, 'font-weight: 800', 'peso em destaque');
    contem(macros, 'var(--ink-mute)', 'macros em tom secundário');
    contem(macros, 'tabular-nums');
  });

  teste('o nome cabe numa linha, com o completo no tooltip', () => {
    const regra = /\.al-nome \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'white-space: nowrap');
    contem(regra, 'text-overflow: ellipsis');
    contem(alimentoItemHtml(item(), 0, 1, CTX), 'title="Pão, trigo, forma, integral"');
  });

  teste('o item em edição tem estado visual próprio', () => {
    ok(/\.al-item-edit \{[^}]*background/.test(css), 'fundo diferente');
    ok(/\.al-item-edit \{[^}]*box-shadow/.test(css), 'e um anel para localizar');
  });
});

grupo('drawer · resumo, rodapé e rolagem', () => {
  teste('o resumo é um container só, com divisórias internas', () => {
    const resumo = /\.rf-resumo \{[^}]*\}/.exec(css)?.[0] || '';
    contem(resumo, 'display: grid');
    contem(resumo, 'background: var(--bg-warm)', 'o fundo é do container');
    const dado = /\.rf-dado \{[^}]*\}/.exec(css)?.[0] || '';
    contem(dado, 'border-left', 'a separação é divisória interna');
    ok(!/\.rf-dado \{[^}]*box-shadow/.test(css), 'sem sombra por indicador');
    ok(!/\.rf-dado \{[^}]*border: /.test(css), 'e sem borda em volta de cada um');
  });

  teste('os seis indicadores aparecem sempre', () => {
    // Fibra zerada não pode sumir: a grade mudaria de forma entre refeições.
    for (const rot of ['Calorias', 'Proteína', 'Carboidrato', 'Gordura', 'Fibra', 'Peso total']) {
      contem(rf, `'${rot}'`, `faltou ${rot} no resumo`);
    }
    ok(!/m\.fibra > 0 \? dado/.test(rf), 'fibra não pode ser condicional na grade');
  });

  teste('o rodapé não cobre o fim do conteúdo', () => {
    const body = /\.rf-body \{[^}]*\}/.exec(css)?.[0] || '';
    contem(body, 'overflow-y: auto', 'a lista é a área rolável');
    const pad = /\.rf-body \{[^}]*padding: [^;]*?(\d+)px;/.exec(body);
    ok(pad && Number(pad[1]) >= 60, `esperava padding inferior >= 60px, veio ${pad?.[1]}`);
  });

  teste('cabeçalho e rodapé ficam fixos', () => {
    contem(/\.rf-hd \{[^}]*\}/.exec(css)?.[0] || '', 'flex-shrink: 0');
    contem(/\.rf-ft \{[^}]*\}/.exec(css)?.[0] || '', 'flex-shrink: 0');
  });

  teste('Concluir é primário; Excluir só fica vermelho no hover', () => {
    ok(/\.rf-ft-ok \{[^}]*background: var\(--moss\)/.test(css), 'Concluir é sólido');
    ok(!/\.rf-excluir \{[^}]*terracotta/.test(css), 'Excluir em repouso é neutro');
    ok(/\.rf-excluir:hover \{[^}]*terracotta/.test(css), 'e ganha vermelho no hover');
  });

  teste('o drawer tem largura de trabalho, sem virar página', () => {
    const regra = /\.rf-drawer \{[^}]*\}/.exec(css)?.[0] || '';
    const m = /clamp\((\d+)px, 52vw, (\d+)px\)/.exec(regra);
    ok(m, 'a largura tem que ser um clamp em torno de 52vw');
    ok(Number(m[1]) >= 680 && Number(m[2]) <= 860, `esperava entre 680 e 860, veio ${m[1]}–${m[2]}`);
  });
});

grupo('drawer · nome da refeição com sugestões', () => {
  teste('o campo não depende de datalist para mostrar as opções', () => {
    // <input list> só abre ao digitar ou com a seta — clicar não faz nada na
    // maioria dos navegadores. O gatilho tem que ser um botão de verdade.
    naoContem(rf, 'list="dlRefeicoes"', 'datalist não serve como único caminho');
    contem(rf, 'data-rf-nomes', 'faltou o botão que abre as sugestões');
    contem(rf, 'data-rf-nomes-pop', 'e o menu com elas');
    contem(rf, 'aria-haspopup="menu"');
  });

  teste('escolher uma sugestão salva pelo mesmo caminho de digitar', () => {
    const fn = /popNomes\.querySelectorAll[\s\S]*?\}\)\);/.exec(rf)?.[0] || '';
    contem(fn, 'campo.value = b.dataset.rfNomeOpcao', 'preenche o campo');
    contem(fn, "new Event('change'", 'e dispara o mesmo evento do salvamento');
  });

  teste('o campo continua livre', () => {
    contem(rf, 'placeholder="Ex.: Café da manhã"', 'nome de refeição é texto livre');
    ok(!/<select[^>]*data-ref-campo="nome"/.test(rf), 'não pode virar select fechado');
  });
});

grupo('drawer · adicionar alimento é inline', () => {
  const busca = readFileSync(new URL('../js/dieta-busca.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');

  teste('a busca tem modo embutido, sem fundo escurecido', () => {
    contem(busca, 'inline = false', 'faltou o modo inline');
    contem(busca, "inline ? '' : '<div class=\"di-drawer-fundo\"", 'inline não pode ter backdrop');
    ok(/\.di-drawer-inline \{[^}]*position: static/.test(css)
       || /\.di-drawer-inline \{[^}]*background: color-mix/.test(css),
      'embutida, ela é uma superfície no fluxo, não um painel fixo');
  });

  teste('a área de inclusão é distinta da lista prescrita', () => {
    // Acima tonalizado = procurando; abaixo branco = prescrito.
    const regra = /\.rf-add-area \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'color-mix(in srgb, var(--color-primary-400)',
      'a tonalidade tem que ser composta do token da marca, não cor solta');
    ok(/\.rf-secao-lista\.apos-busca \{[^}]*border-top/.test(css),
      'e uma divisória antes da lista já prescrita');
  });

  teste('com a refeição aberta, a busca NÃO vira segundo painel lateral', () => {
    contem(ui, 'estadoBusca().refId === refeicaoAberta()', 'a busca da refeição aberta é embutida');
    contem(ui, 'inline: true');
    contem(ui, 'estadoBusca().refId !== refeicaoAberta()', 'só a de outra refeição usa o painel');
  });

  teste('a área de inclusão fica entre Informações e Alimentos', () => {
    const i1 = rf.indexOf('Informações');
    const iAdd = rf.indexOf('rf-add-area');
    const i2 = rf.indexOf('rf-secao-lista');
    ok(i1 < iAdd && iAdd < i2, 'a ordem tem que ser Informações → + Alimento → Alimentos');
    ok(/\.rf-add-area \{[^}]*border-radius/.test(css), 'a área é uma superfície delimitada');
  });

  teste('a faixa grande dá lugar à busca, em vez de competir com ela', () => {
    // Antes a faixa virava um botão "FECHAR BUSCA" de largura total logo acima
    // do conteúdo que ela deveria emoldurar.
    contem(rf, 'ctx.buscaHtml || `', 'a área troca o botão pela busca, no mesmo lugar');
    // Sem comentários (de JS e de HTML): o texto não pode voltar como rótulo.
    const semComentarios = rf
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\/.*$/gm, '');
    ok(!/Fechar busca/.test(semComentarios), 'o fechar mora no cabeçalho da busca');
    contem(busca, 'id="diDwFechar"', 'e é lá que ele está');
    contem(busca, '<kbd>Esc</kbd>', 'com o atalho à vista');
  });

  teste('a busca aparece entre Informações e a lista prescrita', () => {
    const iBusca = rf.indexOf('${ctx.buscaHtml');
    ok(rf.indexOf('Informações') < iBusca, 'depois das informações');
    ok(iBusca < rf.indexOf('rf-secao-lista'), 'e antes da lista de alimentos');
  });
});

grupo('drawer · a busca não sobrevive ao painel que a hospeda', () => {
  const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');

  teste('fechar a refeição fecha a busca embutida', () => {
    // Regressão: a busca ficava aberta apontando para a refeição fechada. Sem
    // drawer para hospedá-la, a condição do painel lateral passava a valer e
    // ela reabria sozinha como "Adicionar em <refeição>".
    const fn = /export function fecharRefeicao\(\)[\s\S]*?\n\}/.exec(rf)?.[0] || '';
    contem(fn, 'aoFechar', 'o fechamento tem que avisar quem pendurou estado aqui');
    contem(ui, 'aoFechar: ()', 'e o dono do estado tem que tratar');
    ok(/if \(!buscaAberta\(\)\) return false;[\s\S]*?fecharBusca\(\)/.test(ui),
      'aoFechar precisa fechar a busca');
  });

  teste('trocar de refeição também leva a busca junto', () => {
    const fn = /export function abrirRefeicao[\s\S]*?\n\}/.exec(rf)?.[0] || '';
    contem(fn, 'const trocou', 'precisa saber que veio de outra refeição');
    contem(fn, 'if (trocou) api.aoFechar?.()',
      'senão a busca da refeição anterior fica pendurada');
  });

  teste('trocar de refeição não carrega a edição de item da anterior', () => {
    const fn = /export function abrirRefeicao[\s\S]*?\n\}/.exec(rf)?.[0] || '';
    contem(fn, '_editando = null', 'o item em edição pertence à refeição anterior');
  });

  teste('fechar dispara um render só', () => {
    const fn = /export function fecharRefeicao\(\)[\s\S]*?\n\}/.exec(rf)?.[0] || '';
    contem(fn, 'if (!api?.aoFechar?.()) api?.rerender()',
      'aoFechar já redesenha quando fecha a busca');
    igual((fn.match(/rerender\(\)/g) || []).length, 1, 'exatamente uma chamada de render');
  });
});

grupo('drawer · o painel fica fixo entre cliques', () => {
  const ui = readFileSync(new URL('../js/dieta-ui.js', import.meta.url), 'utf8');

  teste('a animação de entrada só toca na abertura de verdade', () => {
    // O painel é recriado a cada render (mover, salvar, adicionar, editar).
    // Sem distinguir "abriu" de "re-renderizou", o slide tocava a cada clique
    // e parecia que ele reabria sozinho.
    ok(/_drawerRenderizado/.test(ui), 'faltou lembrar o que já estava aberto');
    contem(ui, "_drawerRenderizado !== refeicaoAberta()", 'é isso que define "abriu agora"');
    contem(ui, "classList.add('rf-sem-anim')", 'e desliga a animação nos demais renders');
    ok(/\.rf-sem-anim \{[^}]*animation: none/.test(css), 'faltou a regra que a desliga');
  });

  teste('a busca lateral e o fundo também não piscam', () => {
    ok(/_buscaRenderizada/.test(ui), 'o painel de busca precisa do mesmo controle');
    const bloco = /if \(!buscaAbriuAgora\) \{[\s\S]*?\n  \}/.exec(ui)?.[0] || '';
    contem(bloco, '.di-drawer', 'o painel de busca');
    contem(bloco, '.di-drawer-fundo', 'e o fundo escurecido');
  });

  teste('rolagem, texto e foco sobrevivem ao render', () => {
    // innerHTML destrói tudo; o que o usuário espera reencontrar é reposto.
    const bloco = /const posicoes = \{[\s\S]*?\};/.exec(ui)?.[0] || '';
    contem(bloco, "'.rf-body'", 'a rolagem do painel');
    contem(bloco, "'.di-dw-lista'", 'a rolagem da lista de busca');
    contem(bloco, "'#diDwInput'", 'e o que estava sendo digitado');
    contem(ui, 'corpo.scrollTop = posicoes.corpo', 'a rolagem tem que ser devolvida');
  });

  teste('ao abrir de fato, a rolagem começa do topo', () => {
    contem(ui, 'posicoes.corpo != null && !abriuAgora',
      'restaurar rolagem numa abertura nova mostraria o meio do painel');
  });
});

grupo('drawer · nenhuma conta na interface', () => {
  teste('o drawer não recalcula nada', () => {
    naoContem(rf, '* 100', 'conversão de múltiplo de 100 g é do núcleo');
    naoContem(rf, '/ 100');
    contem(rf, "from './dieta-calc.js'", 'os números vêm de lá');
  });

  teste('a lista usa o adaptador de apresentação', () => {
    const linha = readFileSync(new URL('../js/dieta-linha.js', import.meta.url), 'utf8');
    const fn = /export function alimentoItemHtml[\s\S]*?\n\}/.exec(linha)?.[0] || '';
    contem(fn, 'itemParaResumo(', 'quantidade, medida e peso vêm prontos');
  });
});
