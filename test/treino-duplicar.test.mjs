// ═══════════════════════════════════════════════════════════
// DUPLICAR TREINO — e o bi-set que as cópias antigas desmontavam
// ═══════════════════════════════════════════════════════════
// Três operações copiam itens de treino: prescrever um modelo, salvar na
// biblioteca e agora duplicar. Duas coisas podem dar errado aqui, e as duas em
// silêncio — o treino chega com o número certo de exercícios e a estrutura
// errada, que ninguém confere:
//
//   BI-SET PERDIDO. `grupo_id`, `grupo_pos` e `drop_ultimas` ficavam de fora da
//   cópia. O aluno recebia dois exercícios soltos onde havia um conjunto.
//
//   BI-SET APONTANDO PARA O TREINO ERRADO. `grupo_id` é o id de OUTRO item.
//   Copiado cru, os itens novos apontariam para os itens do treino ORIGINAL —
//   dois treinos amarrados por dentro. É pior que perder o bi-set, porque
//   editar um passa a quebrar o outro.
//
// Estes testes leem o código. Não substituem rodar contra o banco: provam que o
// que está escrito faz o combinado, e travam quem for editar depois.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/treinos.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

grupo('treinos · o nome da cópia', () => {
  teste('o sufixo mora num lugar só', async () => {
    // A tela precisa do mesmo texto para prever o nome no toast. Repetido em
    // prosa, viram duas fontes que discordam no dia em que uma mudar.
    const { SUFIXO_COPIA } = await import('../js/treinos.js');
    igual(SUFIXO_COPIA, ' - Cópia');
    contem(codigo, "(origem.nome || 'Treino') + SUFIXO_COPIA");
  });

  teste('treino sem nome não vira " - Cópia" solto', () => {
    // `nome` é NOT NULL na tabela; um treino salvo sem nome geraria uma cópia
    // chamada só pelo sufixo, que na lista parece defeito.
    contem(codigo, "origem.nome || 'Treino'");
  });
});

grupo('treinos · a cópia de itens é uma só', () => {
  teste('AS TRÊS OPERAÇÕES USAM O MESMO COPIADOR', () => {
    // Enquanto eram três blocos iguais, duas esqueciam quatro colunas.
    igual((codigo.match(/await copiarItens\(/g) || []).length, 3);
    contem(codigo, 'async function copiarItens(');
  });

  teste('nenhuma coluna do item fica de fora', () => {
    const bloco = codigo.slice(codigo.indexOf('async function copiarItens('),
                               codigo.indexOf('export async function prescreverModeloParaPaciente'));
    for (const c of ['exercicio_id', 'dia', 'ordem', 'series', 'repeticoes', 'carga',
      'cadencia', 'descanso', 'descanso_final', 'rir', 'rir_modo', 'metodo',
      'observacao', 'drop_ultimas', 'grupo_id', 'grupo_pos', 'grupo_obs']) {
      ok(bloco.includes(c + ':'), `faltou copiar ${c}`);
    }
  });

  teste('O BI-SET É REMAPEADO, NUNCA COPIADO CRU', () => {
    // Sem o de-para, `grupo_id` apontaria para o item do treino de origem.
    contem(codigo, 'const novoId = new Map(itens.map(it => [it.id, crypto.randomUUID()]));');
    contem(codigo, 'grupo_id:       it.grupo_id ? (novoId.get(it.grupo_id) ?? null) : null');
  });

  teste('âncora que não veio junto vira item solto, não ponteiro solto', () => {
    // `?? null` é a rede: se o par do bi-set não estiver na lista copiada, o
    // item perde o grupo em vez de apontar para fora do treino.
    contem(codigo, '?? null');
    contem(codigo, 'grupo_pos:      it.grupo_id ? it.grupo_pos : null');
  });

  teste('a progressão NÃO é copiada', () => {
    // Carga realizada é histórico do aluno, não parte da receita. Copiar
    // inventaria treino que ele nunca fez.
    const bloco = codigo.slice(codigo.indexOf('export async function duplicarTreino'));
    naoContem(bloco.slice(0, 900), 'treino_progressao');
  });
});

grupo('treinos · a cópia de aluno nasce inativa', () => {
  teste('MODELO NASCE ATIVO, TREINO DE ALUNO NASCE INATIVO', () => {
    // O app do aluno lista TODOS os treinos ativos (js/paciente-data.js,
    // `.eq('ativo', true)`). Nascendo ativa, a duplicata apareceria na tela
    // dele no mesmo segundo, ao lado da original, sem ninguém ter decidido.
    contem(codigo, 'const ehModelo = !origem.paciente_id;');
    contem(codigo, 'ativo:           extras.ativo ?? ehModelo,');
  });

  teste('a cópia fica no mesmo lugar da origem', () => {
    // Modelo duplica como modelo; treino de aluno duplica para o MESMO aluno.
    contem(codigo, 'paciente_id:     origem.paciente_id ?? null,');
  });

  teste('o app do aluno realmente filtra por ativo', () => {
    // Se este filtro sumir um dia, a decisão de nascer inativa perde o motivo
    // — e este teste é o que avisa.
    const pwa = readFileSync(new URL('../js/paciente-data.js', import.meta.url), 'utf8');
    contem(pwa, ".eq('ativo', true)");
  });
});

grupo('treinos · o botão na tela', () => {
  teste('duplicar aparece para modelo E para treino de aluno', () => {
    // O botão de "salvar na biblioteca" é condicional (`ehModelo ? '' : ...`);
    // o de duplicar não pode ser — duplicar um modelo é o caso mais comum.
    contem(ui, 'data-tr-dup="${t.id}"');
    const linha = ui.slice(ui.indexOf('data-tr-dup='), ui.indexOf('data-tr-dup=') + 200);
    naoContem(linha, 'ehModelo ?');
  });

  teste('não pede confirmação para uma ação reversível', () => {
    // Diálogo em ação que não destrói nada é diálogo que se aprende a fechar
    // sem ler — e aí também se fecha sem ler o de excluir.
    // Recorta ATÉ O FIM DA FUNÇÃO, não uma janela de N caracteres: a função
    // tem 11 linhas e a seguinte (salvarTreinoNaBiblioteca) chama confirmar()
    // legitimamente. Uma janela fixa passava do fim e acusava o vizinho.
    const ini = ui.indexOf('async function duplicarEsteTreino');
    const fn = ui.slice(ini, ui.indexOf('\n}', ini) + 2);
    naoContem(fn, 'confirmar(');
    contem(fn, 'await renderLista()');
  });

  teste('o toast diz o nome que saiu', () => {
    // A cópia entra ordenada por data de criação e nem sempre cai ao lado da
    // original: sem o nome, a pessoa procura na lista sem saber o que procurar.
    contem(ui, 'mostrarToast(`✓ "${copia.nome}" criado`)');
  });
});

grupo('treinos · a cópia vai sem carga e com todos os métodos', () => {
  teste('A CARGA NÃO VAI JUNTO', () => {
    // Duplicar reaproveita a RECEITA, não o desempenho. A carga que estava lá
    // era a do aluno naquele ciclo; levada para a cópia, o treino novo nasce
    // prescrevendo um peso que ninguém decidiu.
    contem(codigo, 'comCarga = true');
    contem(codigo, 'carga:          comCarga ? it.carga : null');
    contem(codigo, "copiarItens(itens, copia.id, origem.nutri_id, { comCarga: false })");
  });

  teste('zera explicitamente, não omite o campo', () => {
    // Omitir deixaria a coluna sujeita a default; `null` diz o que se quis.
    naoContem(codigo, 'comCarga ? it.carga : undefined');
  });

  teste('TODOS OS MÉTODOS VÃO JUNTO', () => {
    // É o que dá trabalho de montar e o que se quer manter ao duplicar.
    const bloco = codigo.slice(codigo.indexOf('async function copiarItens('),
                               codigo.indexOf('export async function prescreverModeloParaPaciente'));
    for (const c of ['metodo', 'drop_ultimas', 'grupo_id', 'grupo_pos', 'grupo_obs',
      'cadencia', 'rir', 'rir_modo', 'series', 'repeticoes', 'descanso', 'descanso_final']) {
      ok(bloco.includes(c + ':'), `método/parâmetro perdido na cópia: ${c}`);
    }
  });

  teste('as outras duas cópias seguem levando a carga', () => {
    // Prescrever um modelo e salvar na biblioteca NÃO mudaram de comportamento
    // nesta alteração. Se um dia se decidir que também não devem levar carga,
    // é uma decisão à parte — e este teste é o que obriga a tomá-la de propósito.
    contem(codigo, 'await copiarItens(itens, novo.id, modelo.nutri_id);');
    contem(codigo, 'await copiarItens(itens, modelo.id, origem.nutri_id);');
  });
});

// ───────────────────────────────────────────────────────────
// REORDENAR OS DIAS — arrastar as abas A/B/C/D
// ---------------------------------------------------------------------------
// O erro que estes testes existem para pegar é o UPDATE EM CASCATA, e ele é
// silencioso. A forma ingênua de mover o dia D para A seria
// `update where dia='D' set dia='A'` seguido de `where dia='A' set dia='B'` —
// e a segunda instrução pega também as linhas que a primeira acabou de mover.
// Como `dia` não tem unicidade, o banco aceita calado e o treino sai
// embaralhado, sem erro nenhum na tela.
// ───────────────────────────────────────────────────────────
grupo('treinos · reordenar dias', () => {
  teste('O FILTRO É POR ID, NÃO PELA LETRA', () => {
    // Ids não mudam durante a operação, então nenhuma instrução enxerga o
    // efeito da anterior. É a única forma de a cascata não acontecer.
    contem(codigo, 'const ids = itens.filter(it => it.dia === de).map(it => it.id);');
    contem(codigo, ".update({ dia: para }).in('id', ids)");
  });

  teste('dia que não mudou de letra não é tocado', () => {
    contem(codigo, 'if (de === para) continue;');
  });

  teste('menos de dois dias não faz nada', () => {
    contem(codigo, 'if (letras.length < 2) return { movidos: 0 };');
  });

  teste('a divisão do treino NÃO é alterada', () => {
    // `divisao` guarda QUANTOS dias existem ("ABC"); reordenar não muda isso.
    const bloco = codigo.slice(codigo.indexOf('export async function reordenarDias'),
                               codigo.indexOf('const LETRAS_DIA'));
    naoContem(bloco, "from('treinos')");
  });
});

grupo('treinos · arrastar as abas', () => {
  teste('ARRASTAR E SETAS CONVIVEM', () => {
    // O drag nativo do HTML não dispara em toque. Num tablet — que é onde
    // metade dos professores monta treino — a aba não sairia do lugar e a
    // função simplesmente não existiria.
    contem(ui, 'draggable="true"');
    contem(ui, 'data-mover=');
    contem(ui, "b.addEventListener('dragstart'");
    contem(ui, "b.addEventListener('drop'");
  });

  teste('dragover chama preventDefault, senão o drop nunca dispara', () => {
    const bloco = ui.slice(ui.indexOf("b.addEventListener('dragover'"),
                           ui.indexOf("b.addEventListener('dragleave'"));
    contem(bloco, 'ev.preventDefault()');
  });

  teste('o Firefox precisa de setData para iniciar o arrasto', () => {
    contem(ui, "ev.dataTransfer.setData('text/plain'");
  });

  teste('clicar na seta não troca a aba selecionada', () => {
    // A seta vive DENTRO do botão: sem parar a propagação, mover também
    // selecionaria outro dia e a pessoa perderia de vista o que acabou de mexer.
    contem(ui, "const mover = ev.target.closest('[data-mover]');");
    contem(ui, 'ev.stopPropagation();');
  });

  teste('as setas só aparecem na aba ativa e não passam da borda', () => {
    contem(ui, "d === _diaSel && _dias.length > 1");
    contem(ui, "${i === 0 ? 'hidden' : ''}");
    contem(ui, "${i === _dias.length - 1 ? 'hidden' : ''}");
  });

  teste('A TELA MUDA ANTES DO BANCO, E VOLTA SE ELE RECUSAR', () => {
    // Arrastar é gesto: esperar o servidor para a aba assumir a posição faz a
    // pessoa arrastar de novo achando que não pegou. Mas otimismo sem rollback
    // deixa a tela mentindo sobre o que está gravado.
    const fn = ui.slice(ui.indexOf('async function moverDia'), ui.indexOf('\n}', ui.indexOf('async function moverDia')));
    contem(fn, 'const antes = _dias.slice();');
    contem(fn, '_dias = antes;');
    contem(fn, 'mostrarErro(');
  });

  teste('o CSS avisa que dá para arrastar', () => {
    // Sem `cursor: grab` ninguém descobre a funcionalidade: nada na aba sugere
    // que ela se move.
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    contem(html, '.tr-dia-tab { cursor: grab');
    contem(html, '.tr-dia-alvo');
  });
});
