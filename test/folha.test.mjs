// Financeiro · folha de pagamento.
//
// O que este arquivo protege: a conta. A planilha que este módulo substitui
// tem 133 pagamentos conferidos; se `valorBase` mudar de arredondamento, o
// histórico importado passa a divergir do que foi pago de verdade — e não há
// como saber qual dos dois está certo depois.

import { grupo, teste, ok, igual, perto } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  minutosDeTexto, textoDeMinutos, valorBase, arredondar,
  totalItem, totalFolha, totalMinutos,
  nomeCompetencia, competenciaDe, competenciaAtual, proximaCompetencia,
  traduzirErroFolha, STATUS_FOLHA,
} from '../js/folha.js';
import { formatarBRL, valorDeTexto } from '../js/utils.js';

grupo('folha · leitura das horas do ponto', () => {
  teste('h:mm é a forma principal', () => {
    igual(minutosDeTexto('48:41'), 2921);
    igual(minutosDeTexto('0:00'), 0);
    igual(minutosDeTexto('161:44'), 9704);
  });

  teste('aceita o que a pessoa realmente digita', () => {
    igual(minutosDeTexto('48h41'), 2921);
    igual(minutosDeTexto('48 41'), 2921);
    igual(minutosDeTexto(' 48:41 '), 2921);
    igual(minutosDeTexto('48'), 2880, 'só o número são horas cheias');
    igual(minutosDeTexto('48h'), 2880);
  });

  teste('lixo vira null, nunca zero', () => {
    // Virar zero em silêncio pagaria R$ 0,00 a alguém que trabalhou o mês.
    igual(minutosDeTexto(''), null);
    igual(minutosDeTexto('abc'), null);
    igual(minutosDeTexto('48:99'), null, 'minuto acima de 59 não existe');
    igual(minutosDeTexto(null), null);
  });

  teste('volta para texto sem inventar zero', () => {
    igual(textoDeMinutos(2921), '48:41');
    igual(textoDeMinutos(0), '0:00');
    igual(textoDeMinutos(null), '');
    igual(textoDeMinutos(undefined), '');
    igual(textoDeMinutos(9704), '161:44');
  });
});

grupo('folha · a conta da planilha', () => {
  teste('minutos ÷ 60 × valor/hora', () => {
    // Linhas reais da planilha "Ponto - PONTO", conferidas uma a uma.
    igual(valorBase(9704, 14), 2264.27);    // Josely, jan/2024
    igual(valorBase(3297, 10), 549.50);     // Aline, jan/2024
    igual(valorBase(2920, 13), 632.67);     // Aline, ago/2026
    igual(valorBase(3193, 13), 691.82);     // Beatriz, ago/2026
    igual(valorBase(2631, 34), 1490.90);    // Rafael, ago/2026
    igual(valorBase(4201, 28), 1960.47);    // Josely, ago/2026
  });

  teste('arredonda em duas casas, meio para cima', () => {
    igual(arredondar(2264.2666), 2264.27);
    igual(arredondar(1.005), 1.01);
    igual(arredondar(0), 0);
    igual(arredondar('abc'), 0);
  });

  teste('sem horas ou sem valor a base é zero', () => {
    igual(valorBase(null, 13), 0);
    igual(valorBase(2920, null), 0);
    igual(valorBase(undefined, undefined), 0);
  });

  teste('total da linha soma os adicionais', () => {
    const item = {
      valor_base: 632.67,
      adicionais: [{ valor: 580 }, { valor: 1100 }],
    };
    igual(totalItem(item), 2312.67);
  });

  teste('adicional negativo é desconto', () => {
    // "PAGAMENTO DE FÉRIAS" no histórico reduz o total do mês.
    igual(totalItem({ valor_base: 586.80, adicionais: [{ valor: -36 }] }), 550.80);
  });

  teste('linha sem adicional nenhum', () => {
    igual(totalItem({ valor_base: 481.43 }), 481.43);
    igual(totalItem({ valor_base: 481.43, adicionais: [] }), 481.43);
    igual(totalItem(null), 0);
  });

  teste('o total do mês e o total de horas', () => {
    const itens = [
      { valor_base: 632.67, minutos: 2920, adicionais: [{ valor: 1680 }] },
      { valor_base: 1206.40, minutos: 5568, adicionais: [] },
      { valor_base: 481.43, minutos: 2222, adicionais: [] },
    ];
    igual(totalFolha(itens), 4000.50);
    igual(totalMinutos(itens), 10710);
    igual(textoDeMinutos(totalMinutos(itens)), '178:30');
    igual(totalFolha([]), 0);
  });
});

grupo('folha · dinheiro em texto', () => {
  teste('lê o que o brasileiro digita', () => {
    igual(valorDeTexto('R$ 1.234,56'), 1234.56);
    igual(valorDeTexto('1234,56'), 1234.56);
    igual(valorDeTexto('1234.56'), 1234.56);
    igual(valorDeTexto('17'), 17);
    igual(valorDeTexto('-36,00'), -36);
  });

  teste('vazio e lixo devolvem null', () => {
    igual(valorDeTexto(''), null);
    igual(valorDeTexto('  '), null);
    igual(valorDeTexto('abc'), null);
    igual(valorDeTexto(null), null);
  });

  teste('formata em real', () => {
    const s = formatarBRL(2312.67);
    ok(s.includes('2.312,67'), s);
    ok(s.includes('R$'), s);
    ok(formatarBRL(0).includes('0,00'));
    ok(formatarBRL(null).includes('0,00'), 'null não pode virar NaN na tela');
  });

  teste('o ponto do milhar não vira decimal', () => {
    // "1.800" é mil e oitocentos, não um e oitenta.
    igual(valorDeTexto('R$ 1.800,00'), 1800);
    perto(valorDeTexto('2.000'), 2000, 0.001);
  });
});

grupo('folha · competências', () => {
  teste('nome do mês em português', () => {
    igual(nomeCompetencia('2026-08-01'), 'Agosto de 2026');
    igual(nomeCompetencia('2024-01-01'), 'Janeiro de 2024');
    igual(nomeCompetencia(''), '—');
    igual(nomeCompetencia(null), '—');
  });

  teste('monta a competência com zero à esquerda', () => {
    igual(competenciaDe(2026, 8), '2026-08-01');
    igual(competenciaDe(2026, 12), '2026-12-01');
  });

  teste('a competência atual sai da data dada', () => {
    igual(competenciaAtual(new Date(2026, 7, 4)), '2026-08-01');
    igual(competenciaAtual(new Date(2026, 0, 31)), '2026-01-01');
  });

  teste('próxima competência vira o ano', () => {
    igual(proximaCompetencia('2026-08-01'), '2026-09-01');
    igual(proximaCompetencia('2026-12-01'), '2027-01-01');
  });

  teste('os dois status têm rótulo', () => {
    igual(Object.keys(STATUS_FOLHA).sort(), ['fechada', 'rascunho']);
  });
});

grupo('folha · erros com instrução', () => {
  teste('mês repetido', () => {
    const m = traduzirErroFolha('duplicate key value violates unique constraint "uniq_folhas_competencia"');
    ok(m.includes('mês'), m);
    ok(!m.includes('constraint'), 'não repassar o texto cru do banco');
  });

  teste('tabela que ainda não existe manda rodar o schema', () => {
    const m = traduzirErroFolha('relation "public.folhas" does not exist');
    ok(m.includes('folha_schema.sql'), m);
  });
});

grupo('folha · fiação da tela', () => {
  const casca = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');

  teste('o Financeiro tem as duas seções', () => {
    ok(casca.includes("id: 'funcionarios'"), 'faltou a aba de funcionários');
    ok(casca.includes("id: 'folha'"), 'faltou a aba da folha');
    ok(casca.includes("import('./folha-ui.js')"), 'a aba da folha não carrega o módulo');
    ok(casca.includes("import('./funcionarios-ui.js')"), 'a aba de funcionários não carrega o módulo');
  });

  teste('cada campo grava ao sair dele', () => {
    // Sem autosave, meia hora de digitação some num F5.
    ok(ui.includes("addEventListener('change'"), 'faltou gravar no change');
    ok(ui.includes('gravarLinha'), 'faltou a gravação por linha');
    ok(ui.includes("addEventListener('input'"), 'o total tem que acompanhar a digitação');
  });

  teste('folha fechada não aceita edição na tela', () => {
    ok(ui.includes('const trava'), 'faltou a trava de folha fechada');
    ok(/if \(!item \|\| trava\(\)\) return/.test(ui), 'gravarLinha tem que respeitar a trava');
    ok(ui.includes('reabrirFolha'), 'e tem que existir caminho para reabrir');
  });

  teste('digitação inválida avisa em vez de virar zero', () => {
    // Os TRÊS campos. Um valor/hora ilegível zerava o pagamento da pessoa sem
    // dizer nada, e o erro só apareceria no dia do Pix.
    ok(ui.includes('não é um total de horas'), 'faltou o aviso das horas');
    ok(ui.includes('não é um valor por hora'), 'faltou o aviso do valor/hora');
    ok(ui.includes('não é um valor. Use vírgula'), 'faltou o aviso do valor fixo');
  });

  teste('fechar relê do banco antes de publicar', () => {
    // A tela pode estar velha — outra aba, um campo salvo e não redesenhado —
    // e fechar publicaria contracheques com números que já não valem.
    const trecho = ui.slice(ui.indexOf('async function concluir()'));
    const iRelê = trecho.indexOf('await carregarFolha(_folha.id)');
    const iPub = trecho.indexOf('await publicarContracheques(');
    ok(iRelê > 0 && iRelê < iPub, 'a releitura tem que vir antes da publicação');
  });

  teste('folha fechada não oferece excluir competência', () => {
    // O botão existia e nunca funcionava: a policy de delete barra folha
    // fechada, então o clique só produzia um erro depois da confirmação.
    ok(/\$\{fechada \? '' : `\s*<button class="btn" id="fpExcluir"/.test(ui),
      'o botão tem que sumir com a folha fechada');
  });

  teste('duas abas abrindo o mesmo mês não quebram a folha', async () => {
    const { ehLinhaDuplicada } = await import('../js/folha.js');
    ok(ehLinhaDuplicada({ code: '23505' }), 'faltou reconhecer o código do Postgres');
    ok(ehLinhaDuplicada({ message: 'duplicate key value violates "uniq_folha_itens_funcionario"' }));
    ok(!ehLinhaDuplicada({ code: '42501', message: 'permission denied' }), 'outros erros continuam erro');

    const folha = readFileSync(new URL('../js/folha.js', import.meta.url), 'utf8');
    ok(/if \(error && !ehLinhaDuplicada\(error\)\) throw error/.test(folha),
      'linha já existente não pode abortar a abertura da folha');
  });

  teste('os lançamentos recorrentes estão na lista', async () => {
    const { ADICIONAIS_SUGERIDOS } = await import('../js/folha.js');
    for (const s of ['Bônus por número de alunos', 'Bônus por presença do aluno',
      'Auxílio faculdade', 'Premiação']) {
      ok(ADICIONAIS_SUGERIDOS.includes(s), `faltou "${s}" nas sugestões`);
    }
    ok(ui.includes('montarCombo'), 'a lista tem que virar combobox');
  });

  teste('sugestão é sugestão, não lista fechada', () => {
    // O histórico tem "10% de bônus", "FERIADO", "PAGAMENTO DE FÉRIAS". Um
    // <select> obrigaria a mentir na descrição no mês da quinta opção.
    const campo = /<input[^>]*fp-add-desc[^>]*>/s.exec(ui)?.[0] || '';
    ok(campo.includes('type="text"'), 'a descrição tem que continuar sendo texto livre');
    ok(!/<select[^>]*fp-add-desc/.test(ui), 'nada de select fechando as opções');
    ok(ui.includes('Nenhuma sugestão — pode escrever a sua'),
      'digitar algo fora da lista tem que continuar parecendo permitido');
  });

  teste('a combobox abre sozinha e anda pelo teclado', () => {
    // A nativa (datalist) só abre pela setinha e ignora as setas do teclado.
    ok(!/<datalist\s+id=/.test(ui), 'a datalist nativa devia ter saído da marcação');
    ok(!/list="fpDl/.test(ui), 'e nenhum campo pode continuar apontando para ela');
    ok(/campo\.addEventListener\('focus', abrir\)/.test(ui), 'tem que abrir ao focar');
    for (const tecla of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) {
      ok(ui.includes(`e.key === '${tecla}'`), `faltou tratar ${tecla}`);
    }
  });

  teste('escolher com o mouse usa mousedown, não click', () => {
    // O blur do campo chega antes do click e a lista já teria fechado —
    // clicar numa opção não faria nada.
    ok(/li\.addEventListener\('mousedown'/.test(ui), 'a escolha tem que ser no mousedown');
  });

  teste('o primeiro Esc fecha a lista, não a caixa', () => {
    ok(/if \(aberta\(\)\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); fechar\(\); \}/.test(ui),
      'sem stopPropagation, um Esc fecharia a caixa inteira junto com a lista');
  });

  teste('o filtro ignora acento', () => {
    // "bonus" tem que achar "Bônus por número de alunos".
    ok(/normalizar\(campo\.value\)/.test(ui), 'o termo digitado tem que ser normalizado');
    ok(/normalizar\(o\)\.includes\(termo\)/.test(ui), 'e a opção também');
  });

  teste('Enter na lista escolhe; fora dela, salva', () => {
    ok(/e\.key === 'Enter' && !combo\.aberta\(\)/.test(ui),
      'com a lista aberta o Enter escolhe a opção, não fecha o formulário');
  });

  teste('adicionar abre uma caixa sobre a tela, não dentro da célula', () => {
    // Na célula da tabela os campos se empilhavam e a linha se deformava a
    // cada tecla; a coluna de adicionais é a mais estreita da folha.
    ok(ui.includes("fundo.className = 'fp-modal'"), 'faltou a caixa de cadastro');
    ok(ui.includes('document.body.appendChild(fundo)'), 'a caixa fica sobre a tela toda');
    ok(!/celula\.appendChild\(form\)/.test(ui), 'o formulário não pode voltar para dentro da célula');
    ok(/role="dialog"[\s\S]{0,60}aria-modal="true"/.test(ui), 'faltou anunciar como diálogo');
  });

  teste('a caixa fecha por Esc, pelo X e pelo fundo', () => {
    ok(/e\.key === 'Escape'[\s\S]{0,60}fechar\(\)/.test(ui), 'Esc tem que fechar');
    ok(ui.includes('data-fp-fechar'), 'faltou o botão de fechar');
    ok(/if \(e\.target === fundo\) fechar\(\)/.test(ui), 'clique no fundo fecha');
    ok(/removeEventListener\('keydown', aoTeclado\)/.test(ui), 'e o listener sai junto');
  });

  teste('não abre duas caixas empilhadas', () => {
    ok(/if \(document\.querySelector\('\.fp-modal'\)\) return/.test(ui), 'uma caixa por vez');
  });

  teste('escolher a sugestão joga o cursor no valor', () => {
    // De um mês para o outro muda o valor, não o nome do lançamento.
    ok(/montarCombo\([\s\S]{0,90}\(\) => val\.focus\(\)\)/.test(ui));
  });

  teste('a tela diz que valor negativo é desconto', () => {
    ok(ui.includes('Valor negativo é desconto'), 'sem isso ninguém adivinha como lançar desconto');
  });

  teste('folha fechada oferece a saída no lugar onde a pessoa esbarra', () => {
    // Esconder a faixa de importação deixava a tela sem nenhum caminho à
    // vista: quem procurava o botão de importar não achava nada, e o único
    // aviso era um texto no rodapé.
    ok(ui.includes('fp-importar-travada'), 'a faixa tem que continuar visível, explicando');
    ok(/Folha fechada — não aceita importação/.test(ui), 'e dizer por que não aceita');
    ok(/fp-importar-travada[\s\S]{0,400}data-fp-reabrir/.test(ui),
      'com o botão de reabrir dentro dela, não só no rodapé');
  });

  teste('reabrir funciona nos dois lugares', () => {
    const botoes = (ui.match(/data-fp-reabrir/g) || []).length;
    ok(botoes >= 2, 'faixa e rodapé — os dois pontos onde se esbarra na folha fechada');
    ok(/querySelectorAll\('\[data-fp-reabrir\]'\)/.test(ui), 'e os dois têm que estar ligados');
  });

  teste('o adicional exige descrição', () => {
    // Um valor sem descrição é um número que ninguém consegue explicar depois.
    ok(ui.includes('Descreva o adicional'), 'faltou exigir a descrição');
  });

  teste('a importação do ponto confere antes de escrever', () => {
    // Importação que grava direto obriga a conferir seis linhas depois do fato.
    ok(ui.includes("import('./ponto-pdf.js')"), 'faltou carregar o leitor de PDF');
    ok(ui.includes('resumoDaImportacao'), 'faltou o resumo do que foi lido');
    ok(/confirmar\(\{[\s\S]{0,200}Preencher horas/.test(ui), 'tem que confirmar antes de preencher');
  });

  teste('o ponto casa pelo CPF antes do nome', () => {
    // Nome vindo de PDF varia em acento e espaço; CPF não.
    ok(/porCpf|ponto\.cpf/.test(ui), 'faltou o casamento por CPF');
    ok(ui.includes('normalizar'), 'e o nome como segunda tentativa');
  });

  teste('o resumo diz de que mês é o ponto e para qual folha vai', () => {
    // O ponto de julho é pago na folha de agosto: conferir mês contra mês daria
    // alarme falso todo mês, e não avisar nada deixaria preencher a folha errada.
    ok(ui.includes('cabecalhoDoPeriodo'), 'faltou o cabeçalho de período');
    ok(ui.includes('proximaCompetencia'), 'o mês seguinte é a referência do aviso');
    ok(/Preenchendo a folha de/.test(ui), 'tem que dizer qual folha vai receber');
  });

  teste('folha fechada recusa importação', () => {
    ok(/if \(trava\(\)\) \{ mostrarErro/.test(ui), 'importar numa folha fechada tem que avisar');
  });

  teste('a tabela rola sozinha em vez de espremer a página', () => {
    ok(/\.fp-tabela-wrap \{[^}]*overflow-x: auto/s.test(css), 'a tabela larga tem que rolar dentro do próprio container');
  });

  teste('as colunas de valor ficam centradas, cabeçalho e conteúdo', () => {
    ok(/\.fp-tabela \.fp-num,\s*\.fp-tabela th\.fp-num \{ text-align: center/.test(css),
      'número e título têm que compartilhar o mesmo alinhamento');
    ok(/\.fp-in \{[^}]*text-align: center/s.test(css), 'o campo digitável também');
    ok(/\.fp-tabela \.fp-adicionais,\s*\.fp-tabela th\.fp-adicionais \{ text-align: center/.test(css),
      'a coluna de adicionais também');
    ok(ui.includes('<th class="fp-adicionais">'), 'sem a classe, o título fica solto à esquerda');
  });

  teste('a chave Pix vem depois do total e dá para copiar', () => {
    // Mostrar sem copiar obrigaria a redigitar 11 dígitos por pessoa na hora
    // de pagar — que é exatamente o erro que a coluna existe para evitar.
    ok(/fp-total[\s\S]{0,200}<td class="fp-pix">/.test(ui), 'a coluna tem que vir depois do total');
    ok(ui.includes('<th class="fp-pix">Chave Pix</th>'), 'faltou o título da coluna');
    ok(ui.includes('copiarParaClipboard'), 'a chave tem que ser copiável');
    ok(/\.fp-tabela \.fp-pix,\s*\.fp-tabela th\.fp-pix \{ text-align: center/.test(css),
      'título e conteúdo centrados');
  });

  teste('a chave não aparece duas vezes na linha', () => {
    // Ela saiu da linha de baixo do nome quando ganhou coluna própria.
    ok(!/fp-nome-sub[^\n]*chave_pix/.test(ui), 'chave repetida polui a linha');
  });

  teste('as classes da folha existem no CSS', () => {
    for (const c of ['.fp-barra', '.fp-tabela', '.fp-add-chip', '.fp-total-valor', '.fin-aba']) {
      ok(css.includes(c), `faltou ${c} no css/financeiro.css`);
    }
  });
});

grupo('folha · schema e histórico', () => {
  const schema = readFileSync(new URL('../db/folha_schema.sql', import.meta.url), 'utf8');
  const seed = readFileSync(new URL('../db/folha_historico_seed.sql', import.meta.url), 'utf8');

  teste('as três tabelas e a visão de totais', () => {
    for (const t of ['public.folhas', 'public.folha_itens', 'public.folha_adicionais', 'public.folha_itens_totais']) {
      ok(schema.includes(t), `faltou ${t}`);
    }
  });

  teste('uma folha por mês e uma linha por pessoa', () => {
    ok(schema.includes('uniq_folhas_competencia'), 'faltou impedir duas folhas do mesmo mês');
    ok(schema.includes('uniq_folha_itens_funcionario'), 'faltou impedir a mesma pessoa duas vezes na folha');
  });

  teste('adicional pode ser negativo', () => {
    // Desconto é adicional com sinal trocado; um CHECK de valor >= 0 quebraria
    // a importação do histórico ("PAGAMENTO DE FÉRIAS").
    ok(!/folha_adicionais_valor_check/.test(schema), 'nada de CHECK proibindo valor negativo');
  });

  teste('o valor/hora fica gravado na linha da folha', () => {
    // Reajuste no cadastro não pode reescrever pagamento antigo.
    ok(/create table if not exists public\.folha_itens[\s\S]*valor_hora/.test(schema));
    ok(/create table if not exists public\.folha_itens[\s\S]*valor_base/.test(schema));
  });

  teste('o histórico importado tem as 31 competências', () => {
    const inserts = seed.match(/insert into public\.folhas/g) || [];
    igual(inserts.length, 31, 'a planilha tem 31 meses de pagamento');
  });

  teste('o histórico entra como folha fechada', () => {
    ok(seed.includes("'fechada'"), 'pagamento antigo não é rascunho');
  });

  teste('quem saiu da equipe entra desligado, não some', () => {
    for (const nome of ['Adriany', 'Thayssa', 'Samara']) {
      ok(seed.includes(`'${nome}'`), `faltou ${nome} no histórico`);
    }
    ok(seed.includes('false,'), 'os que saíram têm que entrar como inativos');
  });
});
