// ═══════════════════════════════════════════════════════════
// COMERCIAL · RELATÓRIO DE QUEM PRECISA DE ATENÇÃO
// ═══════════════════════════════════════════════════════════
// A aba Clientes responde "como está cada um". Esta responde outra pergunta:
// "quem eu procuro hoje, e por quê". A diferença não é de apresentação — é o
// motivo vir ESCRITO, porque a folha é impressa em preto e branco e uma cor de
// badge não sobrevive à impressora.
//
// O que este arquivo protege é a regra de agrupamento. Um cliente com três
// motivos aparecendo em três blocos seria ligado três vezes, ou riscado num e
// esquecido nos outros — e é o tipo de erro que só aparece depois de a folha
// já estar na mão de alguém.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { motivosDeAtencao, agruparPorAtencao, MOTIVOS } from '../js/comercial.js';
import { relatorioHtml, ABAS, telaHtml, linhaFrequenciaHtml, tabelaFrequenciaHtml } from '../js/comercial-ui.js';

const CSS = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../js/comercial-ui.js', import.meta.url), 'utf8');
const HOJE = '2026-09-04';

const cliente = (nome, extra = {}) => ({
  id: 'a-' + nome, status: 'ativa', horario: 'Diurno',
  fim_periodo: '2026-10-01',
  paciente: { id: 'p-' + nome, nome, telefone: '27999887766' },
  plano: { nome: 'Mensal - 5x' },
  ...extra,
});

grupo('comercial · motivos de atenção', () => {
  teste('mensalidade vencida diz HÁ QUANTOS DIAS', () => {
    // "Vencido" manda ligar; "vencido há 20 dias" manda ligar hoje. O detalhe é
    // a diferença entre uma lista que se lê e uma que se usa.
    const m = motivosDeAtencao(cliente('A', { fim_periodo: '2026-08-15' }), HOJE);
    igual(m[0].chave, 'vencido');
    igual(m[0].detalhe, 'há 20 dias');
  });

  teste('um dia é "dia", não "dias"', () => {
    const m = motivosDeAtencao(cliente('A', { fim_periodo: '2026-09-03' }), HOJE);
    igual(m[0].detalhe, 'há 1 dia');
  });

  teste('cobrança vencida é motivo próprio, separado do vencimento', () => {
    // Um cliente em dia pode ter cobrança vencida do período seguinte, e um
    // vencido pode estar com tudo pago. Misturar os dois foi o que fez a
    // planilha antiga ter duas colunas de status dizendo a mesma coisa.
    const m = motivosDeAtencao(cliente('B', {
      cobrancaAberta: { status: 'pendente', vencimento: '2026-08-30' },
    }), HOJE);
    igual(m[0].chave, 'cobranca_vencida');
    contem(m[0].detalhe, '30/08');
    contem(m[0].detalhe, 'há 5 dias');
  });

  teste('sem turno é buraco de cadastro que custa dinheiro', () => {
    // Sem turno o aluno não entra na contagem de nenhum bônus — some da conta
    // sem dar erro nenhum.
    const m = motivosDeAtencao(cliente('C', { horario: '  ' }), HOJE);
    igual(m[0].chave, 'sem_turno');
  });

  teste('cliente em ordem não gera motivo nenhum', () => {
    igual(motivosDeAtencao(cliente('D'), HOJE).length, 0);
  });

  teste('cancelado fica de fora', () => {
    // Quem cancelou não é trabalho pendente, é histórico. Campanha de
    // reativação seria outra lista, com outro nome.
    igual(motivosDeAtencao(cliente('E', { status: 'cancelada', fim_periodo: '2026-01-01' }), HOJE).length, 0);
  });

  teste('vários motivos vêm juntos, do mais grave ao menos', () => {
    const m = motivosDeAtencao(cliente('F', { fim_periodo: '2026-08-15', horario: '' }), HOJE);
    igual(m.length, 2);
    igual(m[0].chave, 'vencido');
    igual(m[1].chave, 'sem_turno');
    ok(m[0].peso < m[1].peso, 'a ordem tem que sair do peso, não da ordem de escrita');
  });

  teste('a ordem por peso não depende da ordem de escrita', () => {
    // `motivosDeAtencao` ordena por peso, e hoje MOTIVOS já está declarada em
    // ordem — então o sort parece redundante. Uma mutação provou que é: apagá-lo
    // não quebrava nada. Ele fica como defesa barata para o dia em que alguém
    // inserir um motivo no meio da lista, e ESTE teste é o que avisa nesse dia.
    const pesos = MOTIVOS.map(m => m.peso);
    igual(pesos.join(','), [...pesos].sort((a, b) => a - b).join(','),
      'MOTIVOS saiu de ordem — o sort ainda salva a saída, mas a lista ficou confusa de ler');

    // E a garantia de verdade: embaralhado, o resultado tem de sair igual.
    const embaralhado = [...MOTIVOS].reverse();
    const cli = cliente('Z', { fim_periodo: '2026-08-15', horario: '' });
    const manual = embaralhado
      .map(m => ({ chave: m.chave, peso: m.peso, detalhe: m.detalhe(cli, HOJE) }))
      .filter(m => m.detalhe)
      .sort((a, b) => a.peso - b.peso)
      .map(m => m.chave);
    igual(manual.join(','), motivosDeAtencao(cli, HOJE).map(m => m.chave).join(','));
  });

  teste('os pesos são únicos', () => {
    // Peso repetido faz a ordem depender de quem foi escrito primeiro, e a
    // folha muda de ordem sozinha quando alguém acrescenta um motivo no meio.
    const pesos = MOTIVOS.map(m => m.peso);
    igual(new Set(pesos).size, pesos.length, 'dois motivos com o mesmo peso: ' + pesos.join(','));
  });
});

grupo('comercial · agrupamento do relatório', () => {
  const lista = [
    cliente('Vencido antigo', { fim_periodo: '2026-08-10' }),
    cliente('Vencido novo', { fim_periodo: '2026-09-01' }),
    cliente('Sem turno', { horario: '' }),
    cliente('Em ordem'),
    cliente('Cancelado', { status: 'cancelada' }),
  ];

  teste('o cliente aparece UMA vez, no grupo do motivo mais grave', () => {
    // É o que faz a folha ser percorrível. Repetido, o mesmo nome seria ligado
    // duas vezes — ou riscado num bloco e esquecido no outro.
    const r = agruparPorAtencao([cliente('Duplo', { fim_periodo: '2026-08-15', horario: '' })], HOJE);
    igual(r.total, 1);
    igual(r.grupos.length, 1);
    igual(r.grupos[0].chave, 'vencido');
    igual(r.grupos[0].clientes[0].motivos.length, 2, 'o segundo motivo não pode sumir, só mudar de lugar');
  });

  teste('dentro do grupo, o mais urgente primeiro', () => {
    const r = agruparPorAtencao(lista, HOJE);
    const g = r.grupos.find(x => x.chave === 'vencido');
    igual(g.clientes[0].assinatura.paciente.nome, 'Vencido antigo',
      'quem está há 25 dias sem pagar vem antes de quem está há 3');
  });

  teste('grupos vazios não aparecem', () => {
    const r = agruparPorAtencao(lista, HOJE);
    ok(r.grupos.every(g => g.clientes.length > 0));
    ok(!r.grupos.some(g => g.chave === 'pausado'));
  });

  teste('os grupos vêm na ordem de gravidade', () => {
    const r = agruparPorAtencao(lista, HOJE);
    const pesos = r.grupos.map(g => g.peso);
    igual(pesos.join(','), [...pesos].sort((a, b) => a - b).join(','));
  });

  teste('quem está em ordem é contado, não listado', () => {
    // O número existe para dar tamanho ao trabalho: "12 na lista, 71 em ordem"
    // diz uma coisa; "12 na lista" sozinho não diz nada.
    const r = agruparPorAtencao(lista, HOJE);
    igual(r.semMotivo, 1, 'cancelado não pode ser contado como em ordem — ele sai da folha inteira');
    igual(r.total, 3);
  });
});

grupo('comercial · a folha', () => {
  const html = relatorioHtml([
    cliente('Fulano de Tal', { fim_periodo: '2026-08-15', horario: '' }),
    cliente('Beltrana', { cobrancaAberta: { status: 'pendente', vencimento: '2026-08-30' } }),
  ], HOJE);

  teste('a aba entra depois de Planos', () => {
    const ids = ABAS.map(a => a.id);
    igual(ids.join(','), 'visao,clientes,planos,relatorio');
  });

  teste('sem arquivo, a aba pede o arquivo em vez de mostrar nada', () => {
    // A aba passou a ser o relatório de FREQUÊNCIA do mês, que depende da
    // planilha de presenças. Sem ela não há relatório — e uma tela vazia
    // faria a aba parecer quebrada.
    const t = telaHtml({ aba: 'relatorio', assinaturas: [cliente('X')], hoje: HOJE });
    contem(t, 'cm-freq-abrir');
    contem(t, 'Escolher arquivo');
    naoContem(t, 'cm-tabela-caixa');
  });

  teste('o motivo vem escrito, não codificado em cor', () => {
    // A folha é impressa em preto e branco. Uma badge colorida vira um
    // retângulo cinza que não informa nada.
    contem(html, 'Mensalidade vencida');
    contem(html, 'há 20 dias');
    contem(html, 'Cobrança vencida');
  });

  teste('os motivos secundários aparecem na mesma linha', () => {
    contem(html, 'cm-rel-tambem');
    contem(html, 'também: sem turno definido');
  });

  teste('o cabeçalho diz de quando é a foto', () => {
    // Folha impressa sem data vira folha de qualquer dia, e alguém liga para
    // quem já pagou na semana passada.
    contem(html, '04/09/2026');
    contem(html, 'Posição de');
  });

  teste('o telefone vem em texto, não como link', () => {
    // Na folha impressa um link não ajuda; na tela, o nome já abre o cliente.
    contem(html, '(27) 99988-7766');
    naoContem(html, 'wa.me');
  });

  teste('sem ninguém para procurar, a folha diz isso', () => {
    const limpo = relatorioHtml([cliente('Tudo certo')], HOJE);
    contem(limpo, 'Ninguém precisa de atenção agora');
    naoContem(limpo, 'cm-rel-grupo');
  });

  teste('o nome do cliente é escapado', () => {
    const perigo = relatorioHtml([cliente('<script>x</script>', { fim_periodo: '2026-08-15' })], HOJE);
    naoContem(perigo, '<script>x</script>');
    contem(perigo, '&lt;script&gt;');
  });
});

grupo('comercial · a tabela de frequência', () => {
  const aluno = (cliente, pct, motivos) => ({
    cliente, contrato: 'Mensal [5 dias]', feitos: 8, teto: 21, pct,
    faixa: { chave: pct <= 50 ? 'critico' : 'bom' }, motivos,
  });
  const M = {
    sumiu: { chave: 'sumiu', rotulo: 'Parou de vir', detalhe: 'sem treinar há 25 dias', naLinha: true },
    critico: { chave: 'critico', rotulo: 'Frequência crítica', detalhe: '8 de 21 treinos · 38%', naLinha: false },
  };

  teste('a coluna Situação não repete Treinos nem Frequência', () => {
    // "8 de 21 treinos · 38%" está inteiro nas duas colunas ao lado. Uma coluna
    // que repete a vizinha ensina a não ler nenhuma das duas.
    const html = linhaFrequenciaHtml(aluno('Fulano', 38, [M.critico]));
    naoContem(html, '8 de 21 treinos');
    contem(html, '8 / 21', 'a coluna Treinos continua lá');
    contem(html, '38%');
  });

  teste('o que as colunas NÃO dizem aparece', () => {
    const html = linhaFrequenciaHtml(aluno('Fulano', 38, [M.sumiu, M.critico]));
    contem(html, 'sem treinar há 25 dias');
    naoContem(html, '8 de 21 treinos');
  });

  teste('quem não tem motivo nenhum é marcado como em dia', () => {
    contem(linhaFrequenciaHtml(aluno('Fulano', 90, [])), 'em dia');
    // E quem tem só o motivo redundante fica com a célula vazia: a cor e o
    // número já contaram a história, e escrever "em dia" ali seria mentira.
    naoContem(linhaFrequenciaHtml(aluno('Fulano', 38, [M.critico])), 'em dia');
  });

  teste('o filete marca a fronteira, e só nela', () => {
    const r = {
      corte: 1,
      alunos: [aluno('Critico', 38, [M.critico]), aluno('EmDia', 90, []), aluno('Outro', 95, [])],
    };
    const html = tabelaFrequenciaHtml(r);
    igual((html.match(/cm-freq-corte/g) || []).length, 1, 'um filete, não um por linha');
    // Do <tbody> para a frente: o <tr> do cabeçalho também casaria e deslocaria
    // o índice em um.
    const corpo = html.slice(html.indexOf('<tbody>'));
    const linhas = corpo.split('<tr').slice(1);
    ok(linhas[1].includes('cm-freq-corte'),
      'o filete tem que cair no primeiro em dia, não no último que precisa de atenção');
    ok(!linhas[0].includes('cm-freq-corte'));
  });

  teste('sem corte, sem filete', () => {
    // `corte` é -1 quando todo mundo precisa de atenção, e 0 quando ninguém
    // precisa. Nos dois casos não há fronteira para marcar.
    const todos = tabelaFrequenciaHtml({ corte: -1, alunos: [aluno('A', 38, [M.critico])] });
    naoContem(todos, 'cm-freq-corte');
    const nenhum = tabelaFrequenciaHtml({ corte: 0, alunos: [aluno('A', 90, [])] });
    naoContem(nenhum, 'cm-freq-corte');
  });

  teste('o filete existe no CSS, e no papel também', () => {
    contem(CSS, '.cm-freq-corte td { border-top: 2px solid var(--border-strong, var(--border)); }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-freq-corte td { border-top: 2px solid #000; }');
  });
});

grupo('comercial · a impressão', () => {
  teste('imprime a folha, não a tela', () => {
    contem(CSS, '@media print');
    contem(CSS, '@page { size: A4 portrait; margin: 14mm 15mm; }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-abas');
    contem(bloco, 'display: none !important');
  });

  teste('em preto e branco o que separa é o filete, não o fundo', () => {
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, 'background: transparent');
    contem(bloco, 'border-bottom: 1px solid #000');
  });

  teste('um grupo não se parte entre páginas sem repetir o título', () => {
    // Quem lê a página 2 não saberia o motivo daquela lista.
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, 'page-break-inside: avoid');
    contem(bloco, 'display: table-header-group');
  });

  teste('só o nome fica à esquerda; o resto centraliza', () => {
    // Plano, treinos, frequência e motivo são valores curtos. Centralizados
    // eles ficam sob o próprio cabeçalho em vez de encostados na borda de uma
    // coluna larga — no papel, sem hover nem zebra para guiar o olho, é o que
    // mantém a linha legível de ponta a ponta.
    contem(CSS, '.cm-rel-tab th:not(:first-child),');
    contem(CSS, '.cm-rel-tab td:not(.cm-rel-nome) { text-align: center; }');
    // E o alinhamento mora num lugar só: uma segunda regra por coluna seria
    // outra fonte para a mesma decisão, e as duas discordariam na primeira
    // mudança.
    ok(!/\.cm-freq-num[^{]*\{[^}]*text-align/.test(CSS),
      'o alinhamento voltou a ser declarado na coluna');
  });

  teste('a folha impressa cabe: fonte, padding e larguras', () => {
    // Cada linha economizada é uma pessoa a mais por página, e uma página a
    // menos para virar com o telefone no ombro.
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-rel-tab { font-size: 9.5pt; }');
    // Sem largura fixa, o motivo (o texto mais longo) espreme o nome até
    // quebrar em três linhas — e nome quebrado é o que mais atrapalha quem
    // procura uma pessoa na folha.
    contem(bloco, '.cm-rel-tab th:nth-child(1) { width: 34%; }');
    contem(bloco, '.cm-rel-tab th:nth-child(5) { width: auto; }');
  });

  teste('a data de emissão aparece só no papel', () => {
    // Na tela é ruído: quem está olhando sabe que dia é hoje. No papel é o que
    // impede a folha de virar folha de qualquer dia, e alguém ligar para quem
    // já voltou a treinar na semana passada.
    contem(CSS, '.cm-rel-emissao { display: none; }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-rel-emissao {');
    contem(bloco, 'display: block');
    contem(UI, 'Impresso em ${esc(dataBR(hoje))}');
    contem(UI, 'relatorioFrequenciaHtml(frequencia, hoje)');
  });

  teste('a caixa de riscar existe só no papel', () => {
    // Na tela seria um controle que não controla nada, e um checkbox falso
    // ensina a desconfiar dos de verdade.
    contem(CSS, '.cm-rel-ok { display: none; }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-rel-ok { display: table-cell');
    contem(bloco, "content: ''");
  });

  teste('o botão chama window.print', () => {
    contem(UI, "querySelector('[data-imprimir-relatorio]')");
    contem(UI, 'window.print()');
    // `?.` porque a aba pode não estar aberta: sem ele, abrir Clientes
    // estouraria em cima de um botão que não existe naquela aba.
    contem(UI, "?.addEventListener('click', () => window.print())");
  });
});
