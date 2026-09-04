// ═══════════════════════════════════════════════════════════
// FOLHA · CORRIGIR UM LANÇAMENTO DO CONTRACHEQUE
// ═══════════════════════════════════════════════════════════
// Os lançamentos (`folha_adicionais`) sempre puderam ser criados e removidos.
// Faltava o meio: corrigir. Quem digitasse 580,00 no lugar de 850,00 tinha de
// apagar o chip e refazer — e refazer joga o lançamento para o FIM da lista,
// porque a `ordem` do novo é o tamanho da lista. Um contracheque com "bônus"
// antes de "vale-transporte" num mês e depois no outro não está errado, mas
// quem confere lado a lado perde tempo procurando.
//
// Daí `atualizarAdicional` não mexer em `ordem`: corrigir um valor não é pedir
// para o lançamento mudar de lugar.
//
// O QUE ESTE ARQUIVO NÃO TESTA, e é de propósito: a folha fechada. Ela é
// recusada pela policy `folha_adicionais_update`, que exige
// `folhas.status <> 'fechada'`. A tela esconde o botão, mas esconder é
// cortesia — a garantia mora no banco, e testá-la aqui seria testar o dublê.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { tabela, limpar, falhar, chamadas } from './duble-supabase.mjs';
import { atualizarAdicional } from '../js/folha.js';

const ler = f => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
const UI = ler('folha-ui.js');

const ultima = (nome, op) =>
  [...chamadas].reverse().find(c => c.tabela === nome && c.operacao === op);

grupo('folha · corrigir lançamento · o acesso ao banco', () => {
  teste('grava descrição e valor no lançamento certo', async () => {
    limpar();
    tabela('folha_adicionais', [{ id: 'add1', descricao: 'Bônus', valor: 850 }]);
    await atualizarAdicional('add1', { descricao: 'Bônus por número de alunos diurnos', valor: 280 });

    const c = ultima('folha_adicionais', 'update');
    ok(c, 'era para ter havido um update');
    igual(c.payload.descricao, 'Bônus por número de alunos diurnos');
    igual(c.payload.valor, 280);
    ok(c.filtros.some(f => f.coluna === 'id' && f.valor === 'add1'),
       'o update precisa ser filtrado pelo id: ' + JSON.stringify(c.filtros));
  });

  teste('não mexe na ordem', async () => {
    // A posição no contracheque é do lançamento, não de quem corrige o valor.
    limpar();
    tabela('folha_adicionais', [{ id: 'add1' }]);
    await atualizarAdicional('add1', { descricao: 'Vale', valor: -150 });
    ok(!('ordem' in ultima('folha_adicionais', 'update').payload),
       'corrigir o valor mandaria o lançamento para o fim da lista');
  });

  teste('não escolhe o dono', async () => {
    // Mesma regra da 4C: quem determina o tenant é o banco. Um `nutri_id`
    // vindo da tela seria o uuid da pessoa, não o da organização.
    limpar();
    tabela('folha_adicionais', [{ id: 'add1' }]);
    await atualizarAdicional('add1', { descricao: 'Vale', valor: -150 });
    ok(!('nutri_id' in ultima('folha_adicionais', 'update').payload));
  });

  teste('o erro do banco sobe, não vira silêncio', async () => {
    limpar();
    falhar('folha_adicionais', 'new row violates row-level security policy');
    let subiu = null;
    try { await atualizarAdicional('add1', { descricao: 'x', valor: 1 }); }
    catch (e) { subiu = e; }
    ok(subiu, 'update recusado pela policy tem de estourar, não devolver undefined');
  });
});

grupo('folha · corrigir lançamento · a tela', () => {
  teste('o rótulo do chip é o botão de editar', () => {
    // Um terceiro ícone dentro de uma pílula de 12px seria alvo pequeno demais
    // no celular. Clicar no que se quer corrigir é o gesto que a pessoa tenta
    // antes de procurar um botão.
    contem(UI, 'data-fp-edit-add');
    contem(UI, 'class="fp-add-rot"');
    contem(UI, "abrirFormAdicional(null, b.dataset.fpEditAdd)");
  });

  teste('a folha fechada não mostra o botão', () => {
    // O mesmo `fechada` que já escondia o ✕. Sem isso o clique iria ao banco
    // só para ser recusado pela policy.
    const bloco = UI.slice(UI.indexOf('const adicionais = (item.adicionais'),
                           UI.indexOf('return `\n    <tr data-fp-item='));
    contem(bloco, 'fechada');
    ok(bloco.indexOf('fechada') < bloco.indexOf('fp-add-rot'),
       'o botão de editar precisa estar DENTRO da condição de folha aberta');
  });

  teste('uma caixa serve aos dois casos', () => {
    // Duplicar o modal seria duplicar o combobox, a validação e a dica do
    // valor negativo — e as cópias divergiriam na primeira mudança.
    contem(UI, 'function abrirFormAdicional(itemId, adicionalId = null)');
    contem(UI, "editando ? 'Corrigir lançamento' : 'Novo lançamento'");
    contem(UI, "editando ? 'Salvar' : 'Adicionar'");
    igual((UI.match(/function abrirFormAdicional/g) || []).length, 1);
  });

  teste('corrigindo, o foco vai para o valor', () => {
    // A descrição vem da lista de sugestões e quase nunca é o que está errado.
    const bloco = UI.slice(UI.indexOf('if (editando) {'), UI.indexOf('} else {\n    desc.focus();'));
    contem(bloco, 'val.focus()');
    contem(bloco, 'val.select?.()');
  });

  teste('o item vem de quem contém o lançamento', () => {
    // Um `data-item` no chip seria a mesma informação escrita duas vezes.
    contem(UI, 'function acharAdicional(id)');
    contem(UI, 'const achado = adicionalId ? acharAdicional(adicionalId) : null');
    contem(UI, 'if (adicionalId && !achado) return;');
  });

  teste('salvar escolhe entre atualizar e inserir', () => {
    contem(UI, 'await atualizarAdicional(editando.id, { descricao, valor })');
    contem(UI, 'await adicionarAdicional(item.id, {');
    // `itemId` é null quando se edita; usá-lo no insert criaria um lançamento
    // órfão na primeira vez que alguém trocasse os ramos de lugar.
    naoContem(UI, 'await adicionarAdicional(itemId, {');
  });
});

grupo('folha · a caixa abre com as sugestões à vista', () => {
  // O BUG: `desc.focus()` corria ANTES de `montarCombo`, que é quem registra o
  // listener de `focus` do campo. Focar um campo cujo listener ainda não existe
  // não dispara nada — o cursor piscava e nenhuma sugestão aparecia. Quem
  // clicava em "+ adicional" via um formulário mudo e só descobria a lista
  // clicando na setinha.
  //
  // O teste é de ORDEM, não de comportamento, porque a causa é a ordem. Expor
  // um `abrir()` na combobox faria o sintoma sumir e deixaria a armadilha de
  // pé para o próximo campo que alguém focar cedo demais.
  const semComentario = UI.split('\n').filter(l => !l.trim().startsWith('//'));
  const linhaDe = (re) => semComentario.findIndex(l => re.test(l));

  teste('o foco vem depois de a combobox ser montada', () => {
    const combo = linhaDe(/const combo = montarCombo\(/);
    const foco = linhaDe(/^\s*else desc\.focus\(\);/);
    ok(combo > 0, 'não achei a montagem da combobox');
    ok(foco > 0, 'não achei o foco de abertura');
    ok(foco > combo,
       `o foco (linha ${foco}) precisa vir DEPOIS do montarCombo (linha ${combo}) — ` +
       'senão o evento de focus não encontra listener e a lista não abre');
  });

  teste('a combobox continua sendo quem abre a lista', () => {
    // Se um dia alguém chamar `combo.abrir()` aqui, é sinal de que a ordem
    // voltou a estar errada e o sintoma foi remendado por cima.
    naoContem(UI, 'combo.abrir()');
    contem(UI, "campo.addEventListener('focus', abrir)");
  });
});

grupo('folha · corrigir lançamento · o estilo', () => {
  teste('só o ✕ fica vermelho no hover', () => {
    // A regra era `.fp-add-chip button`, que agora pegaria os dois botões — e o
    // rótulo inteiro virar vermelho ao passar o mouse diria "isto apaga" bem no
    // botão que corrige.
    contem(CSS, '.fp-add-x:hover');
    naoContem(CSS, '.fp-add-chip button:hover');
  });

  teste('o rótulo não parece um botão, mas responde como um', () => {
    contem(CSS, '.fp-add-rot');
    contem(CSS, 'font: inherit');
    contem(CSS, 'color: inherit');
    contem(CSS, '.fp-add-rot:hover { text-decoration: underline; }');
    contem(CSS, '.fp-add-rot:focus-visible');
  });
});
