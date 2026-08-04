// Contracheque — o recibo de pagamento de uma linha da folha.
//
// O que este arquivo protege: o documento tem que dizer a MESMA coisa que a
// folha. Ele é o papel que a pessoa assina; se recalculasse por conta própria,
// um dia discordaria da tela e não haveria como saber qual dos dois pagou.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  EMPRESA, linhasDoContracheque, valorPorExtenso, htmlContracheque, htmlContracheques,
  resumoDoContracheque, codigoDaLinha,
} from '../js/contracheque.js';
import { totalItem } from '../js/folha.js';

const FICHA = {
  id: 'i1',
  modo: 'horas',
  minutos: 2920,
  valor_hora: 13,
  valor_base: 632.67,
  ponto_inicio: '2026-07-01',
  ponto_fim: '2026-07-31',
  funcionario: {
    nome: 'Ana Vitória de Almeida',
    cpf: '11144477735',
    cargo: 'Administrador',
    unidade: 'Go Up',
    chave_pix: '27999990001',
  },
  adicionais: [
    { descricao: '58 alunos ativos', valor: 580 },
    { descricao: 'Limpezas', valor: 1100 },
  ],
};

const FOLHA = { competencia: '2026-08-01', data_pagamento: '2026-08-03', status: 'fechada' };
const OPCOES = { nomeCompetencia: () => 'Agosto de 2026', formatarData: (d) => d };

grupo('contracheque · o que é discriminado', () => {
  teste('horas, referência e cada adicional viram linha', () => {
    const linhas = linhasDoContracheque(FICHA);
    igual(linhas.length, 3);
    igual(linhas[0].descricao, 'Horas trabalhadas');
    igual(linhas[0].valor, 632.67);
    igual(linhas[1].descricao, '58 alunos ativos');
    igual(linhas[2].valor, 1100);
  });

  teste('a referência traz só a quantidade de horas', () => {
    // O valor da hora fica fora do recibo: o que a pessoa confere é quanto
    // tempo foi apurado e quanto isso deu.
    igual(linhasDoContracheque(FICHA)[0].referencia, '48:40');
  });

  teste('mensalista não mostra hora nenhuma', () => {
    const linhas = linhasDoContracheque({ modo: 'fixo', valor_base: 1800, adicionais: [] });
    igual(linhas.length, 1);
    igual(linhas[0].descricao, 'Valor mensal');
    igual(linhas[0].referencia, '');
  });

  teste('adicional sem descrição não vira linha anônima', () => {
    const linhas = linhasDoContracheque({ modo: 'fixo', valor_base: 0, adicionais: [{ valor: -50 }] });
    igual(linhas[1].descricao, 'Desconto');
  });

  teste('linha vazia não quebra', () => {
    igual(linhasDoContracheque(null), []);
    igual(linhasDoContracheque({ modo: 'horas', valor_base: 0 }).length, 1);
  });
});

grupo('contracheque · vencimentos, descontos e líquido', () => {
  teste('a separação por sinal não muda o total', () => {
    // Vencimentos e descontos são AGRUPAMENTO das mesmas linhas. Se a soma das
    // duas colunas deixar de bater com o líquido, o documento passa a mostrar
    // três números que não fecham entre si.
    const r = resumoDoContracheque(FICHA);
    igual(r.vencimentos, 2312.67);
    igual(r.descontos, 0);
    igual(r.liquido, 2312.67);
    igual(r.vencimentos - r.descontos, r.liquido);
  });

  teste('desconto sai positivo na coluna dele', () => {
    const comDesconto = {
      ...FICHA,
      adicionais: [{ descricao: '58 alunos ativos', valor: 580 }, { descricao: 'Vale', valor: -120 }],
    };
    const r = resumoDoContracheque(comDesconto);
    igual(r.vencimentos, 1212.67);
    igual(r.descontos, 120, 'na coluna de descontos o valor é positivo');
    igual(r.liquido, 1092.67);
    igual(r.vencimentos - r.descontos, r.liquido);
  });

  teste('o líquido é o mesmo número que a folha mostra', () => {
    igual(resumoDoContracheque(FICHA).liquido, totalItem(FICHA));
  });

  teste('linha só de desconto não vira vencimento negativo', () => {
    const r = resumoDoContracheque({ modo: 'fixo', valor_base: 0, adicionais: [{ valor: -50 }] });
    igual(r.vencimentos, 0);
    igual(r.descontos, 50);
    igual(r.liquido, -50);
  });

  teste('o código do lançamento tem dois dígitos', () => {
    igual(codigoDaLinha(0), '01');
    igual(codigoDaLinha(9), '10');
  });
});

grupo('contracheque · valor por extenso', () => {
  teste('reais e centavos', () => {
    igual(valorPorExtenso(2312.67), 'dois mil trezentos e doze reais e sessenta e sete centavos');
    igual(valorPorExtenso(632.67), 'seiscentos e trinta e dois reais e sessenta e sete centavos');
    igual(valorPorExtenso(1), 'um real');
    igual(valorPorExtenso(2), 'dois reais');
  });

  teste('o "e" entre milhar e resto segue a regra', () => {
    // Resto abaixo de cem ou centena redonda pede "e"; resto comum, não.
    igual(valorPorExtenso(1800), 'mil e oitocentos reais');
    igual(valorPorExtenso(1083), 'mil e oitenta e três reais');
    igual(valorPorExtenso(2312), 'dois mil trezentos e doze reais');
    igual(valorPorExtenso(1000), 'mil reais');
  });

  teste('cem é cem, cento e um é cento', () => {
    igual(valorPorExtenso(100), 'cem reais');
    igual(valorPorExtenso(101), 'cento e um reais');
  });

  teste('só centavos', () => {
    igual(valorPorExtenso(0.5), 'cinquenta centavos');
    igual(valorPorExtenso(0.01), 'um centavo');
    igual(valorPorExtenso(0), 'zero real');
  });

  teste('o total do histórico inteiro', () => {
    igual(valorPorExtenso(157083.71),
      'cento e cinquenta e sete mil e oitenta e três reais e setenta e um centavos');
  });

  teste('não inventa texto para o que não sabe escrever', () => {
    igual(valorPorExtenso(NaN), '');
    igual(valorPorExtenso('abc'), '');
    igual(valorPorExtenso(1000000), '', 'acima de um milhão não é folha de pagamento');
  });
});

grupo('contracheque · o documento', () => {
  const html = htmlContracheque(FICHA, FOLHA, OPCOES);

  teste('identifica empregador e empregado', () => {
    contem(html, EMPRESA.nome);
    contem(html, EMPRESA.cnpj);
    contem(html, 'Ana Vitória de Almeida');
    contem(html, '111.444.777-35', 'CPF formatado, como em documento');
    contem(html, 'Administrador');
  });

  teste('mostra o período do ponto que originou as horas', () => {
    contem(html, '2026-07-01');
    contem(html, '2026-07-31');
  });

  teste('a leitura desce na ordem de um contracheque', () => {
    // Empresa → colaborador → lançamentos → totais → pagamento → declaração →
    // assinatura. Fora de ordem, o documento deixa de ser reconhecível.
    const ordem = ['cc-cab', 'cc-colab', 'cc-lanc', 'cc-resumo', 'cc-pag', 'cc-decl', 'cc-assin'];
    let anterior = -1;
    for (const marca of ordem) {
      const pos = html.indexOf(marca);
      ok(pos > anterior, `"${marca}" está fora de ordem no documento`);
      anterior = pos;
    }
  });

  teste('a tabela tem as cinco colunas', () => {
    for (const titulo of ['Cód.', 'Descrição', 'Referência', 'Vencimentos', 'Descontos']) {
      contem(html, `>${titulo}<`, 'faltou coluna no cabeçalho da tabela');
    }
  });

  teste('cada lançamento é numerado', () => {
    contem(html, '>01<');
    contem(html, '>02<');
    contem(html, '>03<');
  });

  teste('coluna sem valor traz travessão, não fica vazia', () => {
    // Célula em branco deixa dúvida se o valor é zero ou se faltou preencher.
    // Aqui: 3 linhas sem desconto + 2 adicionais sem referência.
    igual((html.match(/>—</g) || []).length, 5);
    ok(!/<td class="cc-c-val"><\/td>/.test(html), 'nenhuma célula de valor fica vazia');
    ok(!/<td class="cc-c-ref"><\/td>/.test(html), 'nem a de referência');
  });

  teste('o total do papel é o mesmo da folha', () => {
    // Se o documento recalculasse, um dia discordaria da tela.
    // O espaço depois de "R$" é um NBSP posto pelo toLocaleString — comparar a
    // string inteira falharia por um caractere invisível.
    contem(html, '2.312,67');
    contem(html, 'Valor líquido');
    igual(totalItem(FICHA), 2312.67);
  });

  teste('o total saiu de dentro da tabela de lançamentos', () => {
    // Total misturado com os lançamentos é o que fazia a leitura se perder.
    ok(!/<tfoot/.test(html), 'o total agora é bloco próprio, não rodapé da tabela');
    ok(html.indexOf('cc-resumo') > html.indexOf('</table>'), 'o resumo vem depois da tabela');
  });

  teste('o pagamento vem em campos separados, não numa frase', () => {
    contem(html, 'Dados do pagamento');
    contem(html, '>Data<');
    contem(html, '>Forma<');
    contem(html, '>Chave / conta<');
    contem(html, '>Pix<');
  });

  teste('traz a quitação com o valor por extenso', () => {
    contem(html, 'Declaro ter recebido');
    contem(html, 'dando plena quitação');
    contem(html, 'dois mil trezentos e doze reais e sessenta e sete centavos');
  });

  teste('valor ausente não vira "zero real"', () => {
    // O extenso afirma quitação: dizer "zero real" onde faltou dado seria
    // declarar que nada era devido.
    igual(valorPorExtenso(null), '');
    igual(valorPorExtenso(undefined), '');
    igual(valorPorExtenso(0), 'zero real', 'mas zero de verdade continua zero');
  });

  teste('diz como foi pago', () => {
    contem(html, '2026-08-03');
    contem(html, '27999990001');
  });

  teste('tem linha de assinatura, e uma via só', () => {
    contem(html, 'cc-assin');
    igual((html.match(/class="cc-assin"/g) || []).length, 1, 'não é para sair em duas vias');
  });

  teste('escapa o que veio digitado', () => {
    const perigoso = { ...FICHA, funcionario: { ...FICHA.funcionario, nome: '<script>x</script>' } };
    const saida = htmlContracheque(perigoso, FOLHA, OPCOES);
    naoContem(saida, '<script>', 'nome é texto digitado — nunca vira marcação');
  });

  teste('sem data de pagamento não mente', () => {
    const semData = htmlContracheque(FICHA, { ...FOLHA, data_pagamento: null }, OPCOES);
    contem(semData, '27999990001', 'a chave continua lá');
    contem(semData, '>—<', 'e a data vira travessão');
    naoContem(semData, 'undefined');
    naoContem(semData, 'null');
  });

  teste('sem chave Pix, forma e chave viram travessão', () => {
    const semPix = htmlContracheque(
      { ...FICHA, funcionario: { ...FICHA.funcionario, chave_pix: null } }, FOLHA, OPCOES);
    naoContem(semPix, '>Pix<', 'não afirmar Pix quando não há chave');
    naoContem(semPix, 'undefined');
  });

  teste('folha inteira sai com um documento por pessoa', () => {
    const varios = htmlContracheques([FICHA, { ...FICHA, id: 'i2' }], FOLHA, OPCOES);
    igual((varios.match(/<article class="cc">/g) || []).length, 2);
    igual(htmlContracheques([], FOLHA, OPCOES), '');
  });
});

grupo('contracheque · impressão', () => {
  // O documento vive em css/contracheque.css (é ele que vai embutido no
  // arquivo publicado); a moldura da tela ficou em css/financeiro.css.
  const css = readFileSync(new URL('../css/contracheque.css', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
  const print = css.slice(css.indexOf('@media print'));

  teste('um recibo por página e sem a barra de ações', () => {
    ok(/\.cc \{[^}]*break-after: page/s.test(print), 'faltou quebrar a página entre recibos');
    ok(/\.cc-barra \{ display: none !important/.test(chrome), 'os botões não são documento');
  });

  teste('o último recibo não força uma página em branco', () => {
    ok(/\.cc:last-child \{[^}]*break-after: auto/s.test(css), 'sobraria uma folha vazia na impressora');
  });

  teste('nenhum bloco é partido no meio da página', () => {
    for (const bloco of ['.cc-lanc', '.cc-resumo', '.cc-decl', '.cc-assin']) {
      ok(print.includes(bloco), `${bloco} tem que estar na lista de break-inside: avoid`);
    }
    ok(print.includes('break-inside: avoid'), 'faltou a regra em si');
  });

  teste('sem sombra e sem arredondamento no papel', () => {
    ok(/\.cc \{[^}]*box-shadow: none/s.test(print), 'sombra não imprime, só suja');
    ok(/\.cc \{[^}]*border-radius: 0/s.test(print), 'documento não tem canto arredondado');
  });

  teste('em preto e branco quem separa é o filete, não o fundo', () => {
    // Fundo cinza claro some numa impressora a laser: sem borda, os blocos
    // encostam uns nos outros.
    ok(print.includes('background: transparent !important'), 'os fundos têm que sair');
    ok(/\.cc-resumo \{ border-top: 2px solid #000/.test(print), 'e virar linha preta');
  });

  teste('o cabeçalho do painel só some quando o contracheque está aberto', () => {
    // .page-header é compartilhado; apagá-lo sem condição estragaria a
    // impressão do relatório do cliente. Isso é moldura de TELA, então a regra
    // fica no financeiro.css e não vai junto no arquivo publicado.
    ok(chrome.includes('body:has(.cc-folhas) .page-header'), 'o esconde tem que ser condicional');
    ok(chrome.includes('body:has(.cc-folhas) .fin-abas'), 'as abas também não são documento');
    ok(!css.includes('body:has'), 'o documento publicado não conhece o painel');
  });
});

grupo('contracheque · papel A4', () => {
  const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');

  teste('o @page não mora no CSS', () => {
    // Regra de documento não tem seletor: escrita na folha de estilo, ela
    // valeria também para a impressão do relatório do cliente.
    ok(!css.includes('@page'), 'o @page fixo afetaria os outros documentos do sistema');
  });

  teste('A4 entra na hora de imprimir e sai depois', () => {
    ok(/size: A4/.test(ui), 'faltou definir o tamanho do papel');
    ok(ui.includes("addEventListener('beforeprint'"), 'faltou ligar antes de imprimir');
    ok(ui.includes("addEventListener('afterprint'"), 'faltou desligar depois');
    ok(/margin: \d+mm/.test(ui), 'faltou a margem da página');
  });

  teste('a regra só vale com o contracheque em tela', () => {
    // Ctrl+P em qualquer outra tela não pode herdar o papel do recibo.
    ok(/document\.querySelector\('\.cc-folhas'\)[\s\S]{0,80}removerA4/.test(ui),
      'sem o contracheque na tela, a regra tem que ser retirada');
  });

  teste('não empilha uma tag de estilo por impressão', () => {
    ok(/if \(document\.getElementById\(ESTILO_A4\)\) return/.test(ui), 'faltou a guarda contra duplicar');
    ok(/if \(_a4Ligado\) return/.test(ui), 'e contra registrar o listener duas vezes');
  });
});

grupo('contracheque · celular', () => {
  const css = readFileSync(new URL('../css/contracheque.css', import.meta.url), 'utf8');

  teste('a tabela rola em vez de virar lista solta', () => {
    // Quebrar os lançamentos em texto corrido destruiria a relação entre
    // descrição, referência e a coluna de que aquele valor veio.
    ok(/\.cc-lanc-wrap \{ overflow-x: auto/.test(css), 'faltou a rolagem controlada');
    ok(/\.cc-lanc \{ min-width:/.test(css), 'sem largura mínima a tabela se esmaga');
  });

  teste('as cinco colunas continuam no desktop', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'));
    ok(!/display: block/.test(mobile.slice(0, 900)), 'nada de desmontar a tabela');
  });
});
