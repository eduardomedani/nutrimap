// ═══════════════════════════════════════════════════════════
// MÁSCARA DE DINHEIRO — o número cresce da direita
// ═══════════════════════════════════════════════════════════
// A tabela que originou isto, pedida em 04/09/2026:
//
//        1 → R$ 0,01      1250 → R$ 12,50
//       12 → R$ 0,12     12500 → R$ 125,00
//      125 → R$ 1,25    125000 → R$ 1.250,00
//
// O QUE ELA RESOLVE. "1250" para mil duzentos e cinquenta e "12,50" para doze
// e cinquenta são a mesma sequência de teclas com um caractere de diferença, e
// o campo aceitava as duas caladas. Num campo de folha de pagamento isso é a
// diferença entre pagar R$ 12,50 e R$ 1.250,00, e só se descobre no extrato.
//
// ARMADILHA DO INTL: `toLocaleString('pt-BR', {currency})` separa "R$" do
// número com ESPAÇO NÃO-QUEBRÁVEL (U+00A0), não com espaço comum. Comparar com
// 'R$ 0,01' digitado à mão falha por um byte invisível — aconteceu ao conferir
// esta tabela pela primeira vez. Daí `mesmo()` normalizar antes de comparar:
// o teste é sobre o valor, não sobre qual espaço o navegador escolheu.

import { grupo, teste, ok, igual } from './runner.mjs';
import { mascaraDeCentavos, valorDeTexto, formatarBRL } from '../js/utils.js';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
const normal = s => String(s).replace(/ /g, ' ');
const mesmo = (a, b, msg) => igual(normal(a), normal(b), msg);

grupo('máscara de centavos · a tabela pedida', () => {
  const TABELA = [
    ['1',      'R$ 0,01'],
    ['12',     'R$ 0,12'],
    ['125',    'R$ 1,25'],
    ['1250',   'R$ 12,50'],
    ['12500',  'R$ 125,00'],
    ['125000', 'R$ 1.250,00'],
  ];

  for (const [digitado, esperado] of TABELA) {
    teste(`${digitado} → ${esperado}`, () => {
      mesmo(mascaraDeCentavos(digitado), esperado);
    });
  }
});

grupo('máscara de centavos · digitar tecla a tecla', () => {
  teste('cada dígito empurra o anterior para a esquerda', () => {
    // É assim que o campo se comporta de verdade: o valor anterior volta
    // mascarado e recebe mais um dígito no fim.
    let campo = '';
    const vistos = [];
    for (const tecla of '125000') {
      campo = mascaraDeCentavos(campo + tecla);
      vistos.push(normal(campo));
    }
    igual(vistos.join(' | '),
      'R$ 0,01 | R$ 0,12 | R$ 1,25 | R$ 12,50 | R$ 125,00 | R$ 1.250,00');
  });

  teste('o backspace desfaz na mesma ordem', () => {
    // Apagar o último caractere de "R$ 1,25" deixa "R$ 1,2" — dígitos "12" —
    // que volta a ser R$ 0,12. A máscara não precisa saber que houve
    // apagamento; ela só reage aos dígitos que sobraram.
    let campo = mascaraDeCentavos('125000');
    const vistos = [];
    for (let i = 0; i < 6; i++) {
      campo = mascaraDeCentavos(campo.slice(0, -1));
      vistos.push(normal(campo));
    }
    igual(vistos.join(' | '),
      'R$ 125,00 | R$ 12,50 | R$ 1,25 | R$ 0,12 | R$ 0,01 | ',
      'o último apagamento tem que chegar a BRANCO — enquanto zero virava R$ 0,00 o campo travava aqui');
  });
});

grupo('máscara de centavos · as bordas', () => {
  teste('vazio continua vazio', () => {
    // Devolver "R$ 0,00" aqui impediria de limpar o campo: cada tecla de
    // apagar traria o zero de volta e o campo nunca esvaziaria.
    igual(mascaraDeCentavos(''), '');
    igual(mascaraDeCentavos('abc'), '');
    igual(mascaraDeCentavos(null), '');
    igual(mascaraDeCentavos(undefined), '');
  });

  teste('o sinal de desconto sobrevive', () => {
    // Desconto se lança com valor negativo, e o "-" costuma ser digitado
    // ANTES dos dígitos — quando ainda não há número para ele acompanhar.
    igual(mascaraDeCentavos('-'), '-', 'só o sinal ainda não é um número, mas não pode sumir');
    mesmo(mascaraDeCentavos('-1'), '-R$ 0,01');
    mesmo(mascaraDeCentavos('-15000'), '-R$ 150,00');
  });

  teste('só zeros é vazio; zeros à esquerda não contam', () => {
    // "0" precisa cair no vazio, e não em "R$ 0,00": era esse zero teimoso que
    // impedia o campo de esvaziar quando se apagava tudo.
    igual(mascaraDeCentavos('0'), '');
    igual(mascaraDeCentavos('000'), '');
    mesmo(mascaraDeCentavos('0012'), 'R$ 0,12');
  });

  teste('não estoura com dígito demais', () => {
    // Doze dígitos são R$ 9.999.999.999,99. Além disso o Number começa a
    // perder precisão, e um valor de folha que chega lá é engano de digitação.
    const muitos = mascaraDeCentavos('9'.repeat(30));
    ok(!/e\+/i.test(muitos), 'não pode virar notação científica: ' + muitos);
    ok(Number.isFinite(valorDeTexto(muitos)), 'e tem que continuar legível de volta');
    // O CORTE PRECISA SER AFERIDO PELO NÚMERO DE DÍGITOS. Só olhar para
    // "não virou notação científica" deixa passar um corte em 30 — uma
    // mutação provou: `Number` engole 30 dígitos sem reclamar, mentindo os
    // últimos, e o campo mostraria um valor que não é o que se digitou.
    igual(muitos.replace(/\D/g, '').length, 12,
      'doze dígitos, nem mais: além disso o Number perde precisão em silêncio');
    ok(Number.isSafeInteger(Math.round(valorDeTexto(muitos) * 100)),
      'os centavos ainda têm que caber num inteiro exato');
  });
});

grupo('máscara de centavos · fecha o ciclo com o resto do sistema', () => {
  teste('o que a máscara escreve, valorDeTexto lê', () => {
    // O campo mascarado é o que vai para `valorDeTexto` no salvar. Se as duas
    // discordarem, a tela mostra um valor e o banco grava outro — que é
    // exatamente o erro que a máscara existe para impedir.
    for (const digitado of ['1', '12', '125', '1250', '12500', '125000', '-15000']) {
      const texto = mascaraDeCentavos(digitado);
      const numero = valorDeTexto(texto);
      ok(numero !== null, `valorDeTexto não leu "${texto}"`);
      mesmo(formatarBRL(numero), texto, `ida e volta mudou o valor de "${digitado}"`);
    }
  });

  teste('é idempotente: mascarar o já mascarado não muda nada', () => {
    // O handler roda a cada `input`, e um render pode devolver ao campo um
    // valor já formatado. Se a segunda passada mudasse o número, o valor
    // andaria sozinho na tela.
    for (const digitado of ['1', '125000', '-15000']) {
      const uma = mascaraDeCentavos(digitado);
      igual(mascaraDeCentavos(uma), uma, `"${digitado}" mudou na segunda passada`);
    }
  });
});

grupo('máscara de centavos · onde ela está ligada', () => {
  // A função que mexe no campo mora em js/utils.js desde que o Financeiro
  // passou a usá-la também: o campo de dinheiro da folha e o do lançamento têm
  // que se comportar igual, e dois trechos iguais em dois módulos divergem no
  // primeiro ajuste de um lado só.
  teste('nos campos de dinheiro da folha, e no lançamento', () => {
    ok(/querySelectorAll\('\.fp-vh, \.fp-base-in'\)[\s\S]{0,120}mascararCampoDeDinheiro/.test(UI),
      'faltou ligar nos campos de valor/hora e valor fixo');
    ok(/val\.addEventListener\('input', \(\) => mascararCampoDeDinheiro\(val\)\)/.test(UI),
      'faltou ligar no campo Valor do lançamento');
  });

  teste('e no Valor total do Financeiro', () => {
    // Receita e despesa usam o mesmo drawer. Sem a máscara, "1250" salvava mil
    // duzentos e cinquenta reais onde a pessoa quis doze e cinquenta — o mesmo
    // defeito que a folha já tinha corrigido, pela outra porta.
    const form = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');
    ok(/valor\.addEventListener\('input', \(\) => mascararCampoDeDinheiro\(valor\)\)/.test(form),
      'faltou ligar no campo Valor total');
    ok(/value="\$\{esc\(mascaraDeCentavos\(f\.valor\)\)\}"/.test(form),
      'o campo tem que NASCER no mesmo formato que a máscara escreve');
  });

  teste('NÃO nas horas — "48:41" é tempo, não dinheiro', () => {
    const linha = UI.split('\n').find(l => l.includes("'.fp-vh, .fp-base-in'"));
    ok(linha && !linha.includes('fp-horas'),
      'a máscara de dinheiro não pode encostar no campo de ponto');
  });

  teste('a máscara corre ANTES do recálculo da linha', () => {
    // Listeners do mesmo evento correm na ordem de registro. Invertido, o
    // recálculo leria "1250" como mil duzentos e cinquenta e o total piscaria
    // esse número antes de o campo virar R$ 12,50.
    const semComentario = UI.split('\n').filter(l => !l.trim().startsWith('//'));
    const mascara = semComentario.findIndex(l => l.includes('mascararCampoDeDinheiro(el)'));
    const recalculo = semComentario.findIndex(l => l.includes('recalcularLinha(el.closest'));
    ok(mascara > 0 && recalculo > 0, 'não achei os dois handlers');
    ok(mascara < recalculo,
      `a máscara (linha ${mascara}) tem que ser registrada antes do recálculo (linha ${recalculo})`);
  });

  teste('o cursor vai para o fim', () => {
    // O número cresce da direita e a pontuação anda a cada tecla. Preservar a
    // posição original deixaria o cursor no meio de um separador que mudou de
    // lugar, e a tecla seguinte cairia onde ninguém pediu.
    //
    // Confere em js/utils.js, que é onde a função passou a morar quando o
    // Financeiro começou a usá-la: procurar em folha-ui.js daria falso alarme
    // justamente por ela ter deixado de ser duplicada.
    const utils = readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');
    ok(/setSelectionRange\?\.\(depois\.length, depois\.length\)/.test(utils));
  });

  teste('o campo mostra o mesmo formato que a máscara escreve', () => {
    // Enquanto os inputs nasciam com "17,00" e a máscara escrevia "R$ 17,00",
    // o campo trocava de formato sozinho a cada gravação.
    ok(/class="fp-in fp-vh" value="\$\{formatarBRL\(item\.valor_hora\)\}"/.test(UI));
    ok(/class="fp-in fp-base-in" value="\$\{formatarBRL\(item\.valor_base\)\}"/.test(UI));
    ok(!/numeroBR/.test(UI), 'numeroBR ficou sem uso quando os campos passaram a formatarBRL');
  });
});
