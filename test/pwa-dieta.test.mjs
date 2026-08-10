// ═══════════════════════════════════════════════════════════
// PWA · DIETA — Etapa 1
// ═══════════════════════════════════════════════════════════
// A marcação é GERADA aqui, não lida como texto do arquivo. Foi assim que se
// pegou, no módulo financeiro, um formulário que nunca abria e cujos testes
// passavam porque conferiam se as palavras estavam no fonte.
//
// O que estes testes protegem, além do desenho: que a tela do PACIENTE não
// mostre nada de administrador. Um botão de excluir numa prescrição não é só
// feio — sugere que ela é editável, que é o oposto do que ela é.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  porcao, numeroBR, hora, dataBR, ordenarRefeicoes, refeicaoAtual,
  estadoDaRefeicao, normalizarSubstituicoes, montarPlano, resumoDoDia,
  proximaRefeicao, formatarPorcaoPaciente, formatarSubstitutoPaciente, textoDaPorcao,
} from '../js/pwa-dieta-data.js';
import { sheetHtml } from '../js/pwa-dieta-ui.js';
import {
  telaHtml, vazioHtml, erroHtml, esqueletoHtml, refeicaoHtml, alimentoHtml,
  cabecalhoHtml, resumoHtml, iconeDaRefeicao, horaAgora,
} from '../js/pwa-dieta-ui.js';

const PLANO = {
  id: 'p1', nome: 'Plano de emagrecimento', objetivo: 'Reduzir 4 kg em 12 semanas',
  data_inicio: '2026-08-01', data_fim: '2026-10-31', criado_em: '2026-08-27T10:00:00Z',
  observacoes: 'Beba 2 litros de água por dia.',
};

const REFEICOES = [
  { id: 'r2', nome: 'Almoço',        horario: '12:30:00', ordem: 1, observacao: null },
  { id: 'r1', nome: 'Café da manhã', horario: '07:00:00', ordem: 2,
    observacao: 'Consuma até 1 hora antes do treino.' },
  { id: 'r3', nome: 'Ceia',          horario: null,       ordem: 3, observacao: null },
  { id: 'ra', nome: 'Vitamina proteica', horario: '07:00:00', ordem: 4,
    substitui_refeicao_id: 'r1', instrucao: 'Use quando estiver fora de casa.' },
];

// `quantidade` é MULTIPLICADOR DE 100 g (BASE_G), não a porção. 0,45 = 45 g.
// Era exatamente isso que a primeira versão da tela imprimia cru.
const ITENS = [
  { id: 'i1', refeicao_id: 'r1', food_id: 'f1', quantidade: 0.45, medida: 'fatia', ordem: 0,
    substituicoes: [{ nome: 'Tapioca', quantidade: 2, medida: 'colher de sopa' }] },
  { id: 'i2', refeicao_id: 'r1', food_id: 'f2', quantidade: 2, medida: null, ordem: 1,
    observacao: 'Sem açúcar.' },
  { id: 'i3', refeicao_id: 'r2', alimento_id: 'a1', quantidade: 1.2, medida: 'colher de sopa', ordem: 0 },
  { id: 'i4', refeicao_id: 'ra', food_id: 'f3', quantidade: 0.9, medida: 'unidade', ordem: 0 },
];

const MEDIDAS = new Map([
  ['f1', [{ descricao: 'fatia', gramas: 45 }]],
  ['f3', [{ descricao: 'unidade', gramas: 90 }]],
]);

const NOMES = new Map([['f1', 'Pão integral'], ['f2', 'Leite desnatado'],
                       ['f3', 'Banana'], ['a1', 'Arroz integral']]);

const dieta = montarPlano({ plano: PLANO, refeicoes: REFEICOES, itens: ITENS,
                            nomes: NOMES, medidas: MEDIDAS });

// ───────────────────────────────────────────────────────────
grupo('dieta · formatação em pt-BR', () => {
  teste('pluraliza pela quantidade, não pelo texto gravado', () => {
    // O profissional escreve a medida no singular ao montar o plano; é a
    // porção que decide. "2 Colher(es)" é como um sistema avisa que não foi
    // pensado.
    igual(porcao(1, 'fatia'), '1 fatia');
    igual(porcao(2, 'fatia'), '2 fatias');
    igual(porcao(1, 'colher de sopa'), '1 colher de sopa');
    igual(porcao(2, 'colher de sopa'), '2 colheres de sopa');
    igual(porcao(1, 'unidade'), '1 unidade');
    igual(porcao(3, 'unidade'), '3 unidades');
  });

  teste('plural irregular não vira "s" no fim', () => {
    igual(porcao(2, 'pão'), '2 pães');
    igual(porcao(2, 'porção'), '2 porções');
    igual(porcao(2, 'colher de chá'), '2 colheres de chá');
  });

  teste('unidade de medida não pluraliza', () => {
    igual(porcao(30, 'g'), '30 g');
    igual(porcao(200, 'ml'), '200 ml');
    igual(porcao(1, 'g'), '1 g');
  });

  teste('medida desconhecida vai como o profissional escreveu', () => {
    // Inventar plural erraria em "pastel", "pão de queijo" e afins.
    igual(porcao(2, 'sachê'), '2 sachê');
  });

  teste('número sem casa decimal inútil', () => {
    igual(numeroBR(2), '2');
    igual(numeroBR(1.5), '1,5');
    igual(numeroBR(2.0), '2');
  });

  teste('hora e data sem passar por fuso', () => {
    igual(hora('07:00:00'), '07:00');
    igual(hora(null), '');
    igual(dataBR('2026-08-27'), '27/08/2026');
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · o valor interno NUNCA chega ao paciente', () => {
  // ACONTECEU DUAS VEZES, e por dois motivos diferentes:
  //   1) `refeicao_itens.quantidade` é multiplicador de 100 g — 0,45 são 45 g;
  //   2) a `medida` das substituições é RÓTULO DE PESO pronto ("45g"), não
  //      medida caseira. Tratá-la como caseira imprimia "0,45 45g".
  // O gerador escreve assim em js/dieta-gerar.js:130.

  teste('o item usa a medida caseira quando ela existe', () => {
    const p = formatarPorcaoPaciente({ quantidade: 0.45, medida: 'fatia' },
                                     [{ descricao: 'fatia', gramas: 45 }]);
    igual(p, { medida: '1 fatia', peso: '45 g', gramas: 45 });
    igual(textoDaPorcao(p), '1 fatia • 45 g');
  });

  teste('sem medida caseira, sobra o peso — nunca o fator', () => {
    const p = formatarPorcaoPaciente({ quantidade: 0.3, medida: null }, []);
    igual(p.medida, null);
    igual(p.peso, '30 g');
    igual(textoDaPorcao(p), '30 g');
  });

  teste('o rótulo de peso do gerador vira peso legível', () => {
    // "45g" → "45 g". Sem isso a tela mostrava "0,45 45g".
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 0.45, medida: '45g' }),
          { medida: null, peso: '45 g' });
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 0.3, medida: '30g' }),
          { medida: null, peso: '30 g' });
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 1, medida: '100g' }),
          { medida: null, peso: '100 g' });
  });

  teste('ml NUNCA vira g', () => {
    // A unidade vem do próprio rótulo; trocá-la seria mentir sobre o que medir.
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 2, medida: '200ml' }),
          { medida: null, peso: '200 ml' });
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 0.2, medida: '200 ml' }).peso,
          '200 ml');
  });

  teste('sem rótulo, o peso sai do multiplicador', () => {
    igual(formatarSubstitutoPaciente({ nome: 'X', quantidade: 0.7 }),
          { medida: null, peso: '70 g' });
  });

  teste('rótulo que NÃO é peso vale como medida caseira', () => {
    // Um profissional que escreveu "2 colheres de sopa" à mão. A contagem não
    // dá para derivar do multiplicador, então o rótulo vai como foi escrito.
    const p = formatarSubstitutoPaciente({ nome: 'X', quantidade: 0.3, medida: '2 colheres de sopa' });
    igual(p.medida, '2 colheres de sopa');
    igual(p.peso, '30 g');
    igual(textoDaPorcao(p), '2 colheres de sopa • 30 g');
  });

  teste('a folha de substituições não imprime nenhum fator', () => {
    const alimento = {
      id: 'i1', nome: 'Pão integral', medida: '1 fatia', peso: '45 g',
      substituicoes: [
        formatarSubstitutoPaciente({ nome: 'Aveia em flocos', quantidade: 0.3, medida: '30g' }),
        formatarSubstitutoPaciente({ nome: 'Tapioca', quantidade: 0.45, medida: '45g' }),
        formatarSubstitutoPaciente({ nome: 'Cuscuz', quantidade: 1, medida: '100g' }),
      ].map((p, i) => ({ id: `s${i}`, nome: ['Aveia em flocos', 'Tapioca', 'Cuscuz'][i], ...p })),
    };
    const html = sheetHtml(alimento);

    contem(html, 'Porção atual');
    contem(html, '1 fatia • 45 g');
    contem(html, '30 g');
    contem(html, '100 g');
    for (const fator of ['0,45', '0,3', '45g', '30g', '100g']) {
      naoContem(html, fator, `"${fator}" é valor interno`);
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · ordem e estado das refeições', () => {
  teste('ordena por horário, não pela ordem de cadastro', () => {
    // O paciente lê a lista de cima para baixo como se fosse o dia. Ordenar por
    // `ordem` poria o almoço antes do café se o profissional os cadastrasse
    // nessa sequência.
    igual(dieta.refeicoes.map(r => r.nome), ['Café da manhã', 'Almoço']);
  });

  teste('refeição VAZIA não aparece para o paciente', () => {
    // "Ceia" não tem alimento, orientação nem alternativa. Um plano publicado
    // com "nenhum alimento cadastrado" faz o paciente duvidar do plano inteiro.
    ok(!dieta.refeicoes.some(r => r.nome === 'Ceia'));
  });

  teste('mas refeição vazia COM orientação aparece', () => {
    // Ali o profissional escreveu algo de propósito, e é isso que ele quer que
    // seja lido.
    const d = montarPlano({
      plano: PLANO, nomes: NOMES, itens: [],
      refeicoes: [{ id: 'x', nome: 'Ceia', horario: '22:00:00', ordem: 1,
                    observacao: 'Apenas chá, se sentir fome.' }],
    });
    igual(d.refeicoes.length, 1);
    igual(d.refeicoes[0].observacao, 'Apenas chá, se sentir fome.');
  });

  teste('refeição sem horário ordena para o fim', () => {
    const ordenadas = ordenarRefeicoes([
      { id: 'a', horario: null, ordem: 1 },
      { id: 'b', horario: '07:00:00', ordem: 2 },
    ]);
    igual(ordenadas.map(r => r.id), ['b', 'a']);
  });

  teste('a alternativa NÃO entra na lista principal', () => {
    // Ela pertence à refeição que substitui — listá-la solta faria o paciente
    // achar que tem uma refeição a mais no dia.
    ok(!dieta.refeicoes.some(r => r.nome === 'Vitamina proteica'));
    igual(dieta.refeicoes[0].alternativas.length, 1);
    igual(dieta.refeicoes[0].alternativas[0].nome, 'Vitamina proteica');
  });

  teste('a refeição atual é a última que já começou', () => {
    igual(refeicaoAtual(dieta.refeicoes, '13:00'), 'r2');
    igual(refeicaoAtual(dieta.refeicoes, '08:00'), 'r1');
  });

  teste('antes da primeira, destaca a primeira', () => {
    // Às 6h o que interessa é o café das 7h, não o jantar de ontem.
    igual(refeicaoAtual(dieta.refeicoes, '06:00'), 'r1');
  });

  teste('estados: passada, atual, sem horário', () => {
    const id = refeicaoAtual(dieta.refeicoes, '13:00');
    igual(estadoDaRefeicao(dieta.refeicoes[0], id, '13:00'), 'passada');
    igual(estadoDaRefeicao(dieta.refeicoes[1], id, '13:00'), 'atual');
    // Refeição de verdade, não índice que já não existe: passar `undefined`
    // devolveria 'sem-horario' por acidente e o teste passaria sem provar nada.
    igual(estadoDaRefeicao({ id: 'z', horario: null }, id, '13:00'), 'sem-horario');
  });

  teste('o resumo do dia sai da própria lista', () => {
    const r = resumoDoDia(dieta.refeicoes);
    igual(r.refeicoes, 2);
    igual(r.primeira, '07:00');
    igual(r.ultima, '12:30');
  });

  teste('"agora" e "próxima" convivem — são coisas diferentes', () => {
    // Às 13h o almoço das 12:30 é o atual; não há outra depois, então não há
    // próxima. Às 8h o café é o atual e o almoço é o próximo.
    const idAtual = refeicaoAtual(dieta.refeicoes, '08:00');
    const idProx = proximaRefeicao(dieta.refeicoes, '08:00');
    igual(idAtual, 'r1');
    igual(idProx, 'r2');
    igual(estadoDaRefeicao(dieta.refeicoes[0], idAtual, '08:00', idProx), 'atual');
    igual(estadoDaRefeicao(dieta.refeicoes[1], idAtual, '08:00', idProx), 'proxima');
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · montagem do plano', () => {
  teste('sem plano, não monta nada', () => {
    igual(montarPlano({ plano: null }), null);
  });

  teste('o nome vem de foods e também da tabela legada', () => {
    // db/foods_ligacao.sql repontou os itens para food_id, mas itens antigos só
    // têm alimento_id. Ler as duas é o que faz o plano antigo continuar legível.
    igual(dieta.refeicoes[0].alimentos[0].nome, 'Pão integral');
    igual(dieta.refeicoes[1].alimentos[0].nome, 'Arroz integral');
  });

  teste('alimento sem nome conhecido não quebra a tela', () => {
    const d = montarPlano({ plano: PLANO, refeicoes: [REFEICOES[1]],
                            itens: [ITENS[0]], nomes: new Map() });
    igual(d.refeicoes[0].alimentos[0].nome, 'Alimento');
  });

  teste('substituições normalizam de jsonb bagunçado', () => {
    // Vem de planilha e de tela: pode chegar null, objeto solto ou lista com
    // buraco.
    igual(normalizarSubstituicoes(null), []);
    igual(normalizarSubstituicoes({ nome: 'Tapioca' }).length, 1);
    igual(normalizarSubstituicoes([null, { nome: 'X' }, {}]).length, 1);
  });

  teste('temSubstituicoes só quando há substituto de verdade', () => {
    // Sem isto a tela mostraria "0 substituições" ou abriria um sheet vazio.
    igual(dieta.refeicoes[0].alimentos[0].temSubstituicoes, true);
    igual(dieta.refeicoes[0].alimentos[1].temSubstituicoes, false);
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · a tela é gerada, não lida como texto', () => {
  const html = telaHtml(dieta, '13:00');

  teste('o plano aparece com nome, objetivo e período', () => {
    contem(html, 'Plano de emagrecimento');
    contem(html, 'Reduzir 4 kg em 12 semanas');
    contem(html, '01/08/2026 a 31/10/2026');
    contem(html, 'Atualizado em 27/08/2026');
  });

  teste('as refeições saem em ordem de horário', () => {
    const iCafe = html.indexOf('Café da manhã');
    const iAlmoco = html.indexOf('Almoço');
    ok(iCafe > 0 && iCafe < iAlmoco, 'a ordem da tela não é a do dia');
  });

  teste('O MULTIPLICADOR INTERNO NÃO CHEGA AO PACIENTE', () => {
    // `quantidade` 0,45 é 45 g. A primeira versão desta tela imprimia "0,45",
    // que não significa nada para quem vai comer.
    contem(html, 'Pão integral');
    contem(html, '1 fatia');
    contem(html, '45 g');
    for (const interno of ['0,45', '0,7', '1,2', '0,9']) {
      naoContem(html, interno, `"${interno}" é multiplicador interno, não porção`);
    }
  });

  teste('sem medida caseira, a porção é o peso — e não se repete', () => {
    // 2 × 100 g = 200 g, sem medida cadastrada. Mostrar "200 g   200 g" seria
    // ruído.
    contem(html, '200 g');
    igual((html.match(/200 g/g) || []).length, 1);
  });

  teste('a observação do alimento e a da refeição aparecem', () => {
    contem(html, 'Sem açúcar.');
    contem(html, 'Consuma até 1 hora antes do treino.');
    contem(html, 'Orientação da refeição');
  });

  teste('a observação INTERNA do plano não chega ao paciente', () => {
    // js/dieta.js:695 grava ali "Gerado automaticamente · Estrutura A —
    // arroz e feijão": é nota do gerador, não orientação ao paciente.
    naoContem(html, 'Beba 2 litros de água por dia.');
    naoContem(html, 'Orientações gerais');
    naoContem(html, 'Gerado automaticamente');
  });

  teste('a refeição do horário atual é marcada, mas fica FECHADA', () => {
    contem(html, 'dt-atual');
    contem(html, '>agora<');
    naoContem(html, 'aria-expanded="true"', 'nenhuma refeição pode abrir sozinha');
  });

  teste('NADA de administrador na tela do paciente', () => {
    // Um botão de excluir numa prescrição sugere que ela é editável.
    for (const proibido of ['Editar', 'Excluir', 'TACO', 'USDA', 'kcal',
                            'data-lucide="trash', 'data-lucide="pencil']) {
      naoContem(html, proibido, `"${proibido}" não é para o paciente`);
    }
  });

  teste('nenhum id técnico vaza como texto visível', () => {
    // Os ids aparecem em atributos (aria-labelledby), nunca no conteúdo.
    naoContem(html, '>p1<');
    naoContem(html, '>f1<');
  });

  teste('o texto é escapado', () => {
    const d = montarPlano({
      plano: { ...PLANO, nome: '<script>alert(1)</script>' },
      refeicoes: [], itens: [], nomes: new Map(),
    });
    naoContem(telaHtml(d, '10:00'), '<script>alert(1)</script>');
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · os quatro estados', () => {
  teste('sem plano, o vazio mantém a mensagem atual', () => {
    const v = telaHtml(null, '10:00');
    contem(v, 'Sua dieta está a caminho');
    contem(v, 'Em breve seu profissional vai liberar seu plano alimentar por aqui.');
    contem(v, 'Plano alimentar em breve');
  });

  teste('o vazio é leve: um bloco secundário, não uma pilha de cards', () => {
    igual((vazioHtml().match(/dt-vazio-box/g) || []).length, 3, 'só uma caixa secundária');
  });

  teste('o erro não mostra jargão do Supabase', () => {
    const e = erroHtml();
    contem(e, 'Não foi possível carregar sua dieta');
    contem(e, 'Tentar novamente');
    for (const jargao of ['PGRST', 'supabase', 'JWT', 'RLS', 'policy']) {
      naoContem(e, jargao);
    }
  });

  teste('o esqueleto tem a FORMA da tela, não um spinner', () => {
    const s = esqueletoHtml();
    igual((s.match(/dt-sk-card/g) || []).length, 2, 'duas refeições no esqueleto');
    ok((s.match(/dt-sk-linha/g) || []).length >= 6, 'linhas de alimento no esqueleto');
    contem(s, 'aria-live="polite"');
    naoContem(s, 'spinner');
  });

  teste('o esqueleto NÃO contém a frase do estado vazio', () => {
    // Se contivesse, o vazio piscaria antes dos dados para quem já tem dieta.
    naoContem(esqueletoHtml(), 'Sua dieta está a caminho');
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · acessibilidade e identidade', () => {
  const css = readFileSync(new URL('../css/pwa-dieta.css', import.meta.url), 'utf8');
  const html = telaHtml(dieta, '13:00');

  teste('o cabeçalho é um <button>, não uma div com clique', () => {
    // Leitor de tela anuncia "botão, recolhido"; Enter e Espaço funcionam de
    // graça; o foco aparece no desktop sem nada a mais.
    contem(html, '<button class="dt-card-topo" type="button"');
    contem(html, 'aria-expanded="false"');
    contem(html, 'aria-controls="dt-c-r1"');
    contem(html, 'id="dt-c-r1"');
    contem(html, 'role="region"');
  });

  teste('o corpo fechado fica no DOM, escondido', () => {
    // Removê-lo tiraria o alvo do aria-controls e a animação não teria de onde
    // partir.
    contem(html, 'aria-labelledby="dt-b-r1" hidden');
  });

  teste('a lista de alimentos é lista de verdade', () => {
    // Leitor de tela anuncia "lista com 2 itens"; div solta não anuncia nada.
    contem(html, '<ul class="dt-itens">');
    contem(html, '<li class="dt-item">');
  });

  teste('a barra inferior não cobre a última refeição', () => {
    // A reserva é da casca (--pa-nav-reserva, em app.html) e vale para as três
    // telas. Aqui só se garante que a dieta não abre uma segunda, que era como
    // o vão de ~112px embaixo da última refeição nascia.
    const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
    contem(shell, '--pa-nav-reserva: calc(var(--pa-nav-h) + var(--pa-nav-safe) + 16px);');
    contem(shell, 'padding: 18px 16px var(--pa-nav-reserva);');
    ok(!/^\s*\.dt\s*\{[^}]*padding-bottom/m.test(css), 'a dieta não declara reserva própria');
    ok(!css.includes('main.pa-main:has('), 'zerar a reserva da casca é sinal de reserva duplicada');
  });

  teste('quem pediu menos movimento não recebe animação', () => {
    contem(css, '@media (prefers-reduced-motion: reduce)');
  });

  teste('nenhuma cor literal nova — a identidade é a do Evollo', () => {
    const cores = css.match(/#[0-9a-f]{3,8}\b/gi) || [];
    igual(cores, [], `cor literal no CSS da dieta: ${cores.join(', ')}`);
  });

  teste('NUNCA duas colunas, em nenhum breakpoint', () => {
    // O plano é uma sequência no tempo; duas colunas quebram a ordem de leitura
    // e produzem cards de alturas diferentes. No desktop limita-se só a largura.
    naoContem(css, 'grid-template-columns: repeat(2');
    naoContem(css, 'columns:');
    const lista = (/\.dt-lista \{[^}]*\}/.exec(css) || [''])[0];
    contem(lista, 'flex-direction: column');
    contem(css, 'max-width: 780px');
  });

  teste('os cards fechados têm a mesma altura', () => {
    // Sem isso, um nome longo deixa um card mais alto que o vizinho e a lista
    // vira degrau.
    const topo = (/\.dt-card-topo \{[^}]*\}/.exec(css) || [''])[0];
    contem(topo, 'min-height: 72px');
  });

  teste('o botão de substituições tem texto, não só ícone', () => {
    contem(refeicaoHtml(dieta.refeicoes[0], 'futura'), 'Substituições');
    contem(css, '.dt-sub-btn');
  });

  teste('o ícone da refeição sai do nome, com padrão seguro', () => {
    igual(iconeDaRefeicao('Café da manhã'), 'coffee');
    igual(iconeDaRefeicao('Almoço'), 'utensils');
    igual(iconeDaRefeicao('Jantar'), 'moon');
    igual(iconeDaRefeicao('Refeição 4'), 'utensils', 'ícone errado ensina categoria errada');
  });

  teste('a hora atual usa o relógio local, não UTC', () => {
    igual(horaAgora(new Date(2026, 7, 5, 7, 3, 0)), '07:03');
    igual(horaAgora(new Date(2026, 11, 31, 22, 30, 0)), '22:30');
  });
});

// ───────────────────────────────────────────────────────────
grupo('dieta · segurança e fronteira do módulo', () => {
  const data = readFileSync(new URL('../js/pwa-dieta-data.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/pwa-dieta-ui.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../db/dieta_paciente_leitura.sql', import.meta.url), 'utf8');
  const paciente = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');

  teste('o plano só aparece quando ATIVO — nos dois lados', () => {
    // Sem estado de rascunho no schema, `ativo` é a publicação. A policy é
    // quem garante; a consulta repete porque policies são OR'd e uma conta que
    // seja nutri e paciente lê pelos dois caminhos.
    contem(sql, 'paciente_id = public.paciente_do_auth() and ativo');
    contem(data, ".eq('ativo', true)");
  });

  teste('as refeições e os itens também exigem plano ativo', () => {
    // Sem isto, desativar um plano esconderia o cabeçalho e deixaria as
    // refeições legíveis pela API.
    igual((sql.match(/and p\.ativo/g) || []).length >= 3, true);
  });

  teste('foods e food_measures ganharam leitura de paciente', () => {
    // Sem elas o nome do alimento próprio do nutri não aparece: a policy geral
    // de foods exige nutri_id = auth.uid(), e para o paciente isso é a conta
    // dele.
    contem(sql, 'create policy foods_paciente_read on public.foods');
    contem(sql, 'create policy food_measures_paciente_read on public.food_measures');
  });

  teste('o alcance é o mínimo: só o que está no plano do paciente', () => {
    // Sem os comentários: o cabeçalho do arquivo EXPLICA a policy geral que
    // deixava o paciente sem os alimentos, e proibir a frase proibiria a
    // explicação. O que não pode é ela aparecer numa policy.
    const instrucoes = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    naoContem(instrucoes, 'using (true)');
    naoContem(instrucoes, 'nutri_id is null or nutri_id = auth.uid()');
    // Toda policy nova amarra ao paciente autenticado.
    const policies = (instrucoes.match(/create policy/g) || []).length;
    const amarras = (instrucoes.match(/paciente_do_auth\(\)/g) || []).length;
    ok(amarras >= policies, `${policies} policies, só ${amarras} amarradas ao paciente`);
  });

  teste('a tela do PWA não escreve no banco', () => {
    // Leitura e só. Um insert aqui seria o paciente editando a prescrição.
    for (const escrita of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      naoContem(data, escrita, `a dieta do paciente não pode ${escrita}`);
      naoContem(ui, escrita);
    }
  });

  teste('a tela não fala com o banco — quem lê é a camada de dados', () => {
    naoContem(ui, "from('");
    naoContem(ui, 'supabase.js');
  });

  teste('a casca desenha a navegação antes de buscar os dados', () => {
    // Esperar a rede aqui deixaria a barra inferior sumida, e o paciente
    // tocaria numa tela sem saída.
    const i = paciente.indexOf('function renderDieta');
    const bloco = paciente.slice(i, i + 900);
    ok(bloco.indexOf('bottomNav()') < bloco.indexOf("import('./pwa-dieta-ui.js')"),
       'a navegação tem que existir antes do carregamento');
  });

  teste('a tela de treino não foi tocada', () => {
    ok(paciente.includes('renderTreino') || paciente.includes("_secao    = 'treino'"),
       'o treino sumiu do PWA');
  });
});

grupo('dieta · o RLS é a segunda camada, nunca a primeira', () => {
  const fonte = readFileSync(new URL('../js/pwa-dieta-data.js', import.meta.url), 'utf8');
  const casca = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');

  teste('a busca do plano filtra por paciente EXPLICITAMENTE', () => {
    // As policies são OR'd: `planos_paciente_read` (o plano é meu) OU
    // `planos_owner` (sou o nutri dono). Numa conta que é as duas coisas, a
    // consulta sem filtro devolvia o plano ativo mais recente de QUALQUER
    // paciente — e com .limit(1) o app abria a dieta de outra pessoa.
    const trecho = fonte.slice(fonte.indexOf("from('planos_alimentares')"),
                               fonte.indexOf("from('planos_alimentares')") + 300);
    contem(trecho, ".eq('paciente_id', meu)");
    contem(trecho, ".eq('ativo', true)");
  });

  teste('sem paciente identificado, não devolve plano nenhum', () => {
    // Devolver "o primeiro que aparecer" seria pior que devolver nada.
    contem(fonte, 'if (!meu) return null;');
  });

  teste('o id do paciente sai de auth_user_id, que é único', () => {
    contem(fonte, "eq('auth_user_id', user.id)");
  });

  teste('a casca entrega o id que já tem, para não repetir a consulta', () => {
    contem(casca, 'pacienteId: _paciente?.id');
  });
});
