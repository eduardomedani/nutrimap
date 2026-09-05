// ═══════════════════════════════════════════════════════════
// BÔNUS POR PRESENÇA — o cruzamento que vira dinheiro
// ═══════════════════════════════════════════════════════════
// Este é o arquivo que decide quanto cada estagiário recebe. Três erros aqui
// pagam a mais ou a menos sem nada parecer quebrado:
//
//   TURNO SEM SAÍDA TRATADO COMO "ATÉ O FIM DO DIA". Batida ímpar acontece —
//   alguém esquece de bater ao sair. Se o turno ficar aberto, a pessoa recebe
//   por todas as presenças da tarde inteira, inclusive as de quem já foi embora.
//
//   PRESENÇA PAGA EM DOBRO quando duas pessoas estão na sala. Uma presença é
//   uma presença; pagando cheio para os dois, reforçar um turno passa a dobrar
//   a conta e o custo deixa de depender de quantos ALUNOS vieram.
//
//   ARREDONDAR A CADA PRESENÇA. São mais de mil parcelas de centavos; somar
//   já arredondado acumula erro de reais no fim do mês.

import { grupo, teste, ok, igual, perto } from './runner.mjs';
import { minutoDe, textoDoMinuto, turnosDoDia, lerAba } from '../js/ponto-planilha.js';
import { calcularBonus, descricaoDoBonus } from '../js/bonus-presenca.js';
import { lerPresencas, faixaDe } from '../js/frequencia.js';

grupo('espelho de ponto · as marcações', () => {
  teste('lê hora com e sem o asterisco de ajuste manual', () => {
    igual(minutoDe('08:03'), 483);
    igual(minutoDe('08:03*'), 483, 'o asterisco marca ajuste manual, não muda a hora');
    igual(minutoDe('04:34'), 274);
    igual(minutoDe(''), null);
    igual(minutoDe('almoço'), null);
    igual(textoDoMinuto(483), '08:03');
  });

  teste('as batidas viram turnos aos pares', () => {
    const r = turnosDoDia('08:03 | 09:31', '2026-08-03');
    igual(r.turnos.length, 1);
    igual(r.turnos[0].de, 483);
    igual(r.turnos[0].ate, 571);
    igual(r.impar, null);
  });

  teste('quatro batidas são dois turnos — entrada, almoço, volta, saída', () => {
    const r = turnosDoDia('04:34 | 09:33 | 15:41 | 21:03', '2026-08-03');
    igual(r.turnos.length, 2);
    igual(r.turnos[1].de, 941);
    igual(r.turnos[1].ate, 1263);
  });

  teste('BATIDA ÍMPAR NÃO VIRA TURNO ABERTO', () => {
    // Entrada sem saída acontece. Tratada como "ficou até o fim do dia", ela
    // daria à pessoa todas as presenças da tarde inteira.
    const r = turnosDoDia('08:03 | 09:31 | 15:00', '2026-08-03');
    igual(r.turnos.length, 1, 'só o par completo vira turno');
    ok(r.impar, 'e a sobra volta à parte, para alguém corrigir');
    igual(r.impar.de, 900);
  });

  teste('as batidas são ordenadas antes de emparelhar', () => {
    // Se o arquivo trouxer fora de ordem, o par tem que continuar sendo
    // entrada→saída, e não saída→entrada, que daria turno negativo.
    const r = turnosDoDia('09:31 | 08:03', '2026-08-03');
    igual(r.turnos[0].de, 483);
    igual(r.turnos[0].ate, 571);
  });

  teste('a aba diz quem é a pessoa', () => {
    const linhas = [
      { celulas: ['ESPELHO DE PONTO'] },
      { celulas: ['Colaborador:', 'Aline Vitório de Armita'] },
      { celulas: ['CPF:', '137.406.727-06'] },
      { celulas: ['Função:', 'Estagiária'] },
      { celulas: ['Data', 'Dia', 'Marcações'] },
      { celulas: ['03/08/2026', null, '08:03 | 09:31'] },
      { celulas: ['04/08/2026', null, ''] },
      { celulas: ['Totais', null, ''] },
    ];
    const a = lerAba(linhas);
    igual(a.nome, 'Aline Vitório de Armita');
    igual(a.cpf, '13740672706', 'o CPF entra só com dígitos, como o resto do sistema guarda');
    igual(a.funcao, 'Estagiária');
    igual(a.turnos.length, 1, 'dia sem marcação não vira turno, e a linha de totais não é data');
  });
});

// ── um mês de mentira, com os casos que importam ──────────────────────────
const CAB = { celulas: ['Cliente', 'Modalidade', 'Contrato', 'Tipo', 'Data'] };
const pres = (cliente, plano, dia, hora, tipo = 'Acesso') =>
  ({ celulas: [cliente, 'Musculação', plano, tipo, `${dia}/08/2026 ${hora}`] });

const pessoa = (nome, funcao, turnos, impares = []) => ({
  nome, funcao, cpf: '000', turnos, impares,
});
const turno = (dia, de, ate) => ({ dia: `2026-08-${dia}`, de, ate });

grupo('bônus · quem ganha pela presença', () => {
  // Um aluno de 5x que treina todo dia útil = 100% = faixa de R$ 1,00.
  const dias = ['03', '04', '05', '06', '07', '10', '11', '12', '13', '14',
    '17', '18', '19', '20', '21', '24', '25', '26', '27', '28', '31'];
  const presencas = lerPresencas([CAB, ...dias.map(d => pres('Assiduo', 'Mensal [5 dias]', d, '07:00'))]);

  teste('quem estava na sala naquele minuto leva a presença', () => {
    const manha = pessoa('Manha', 'Estagiária', dias.map(d => turno(d, 420, 540)));
    const r = calcularBonus(presencas, [manha], { ate: '2026-08-31' });
    igual(r.linhas[0].presencas, 21);
    perto(r.linhas[0].valor, 21 * 1.00, 0.01, 'aluno de 100% vale R$ 1,00');
    igual(r.semDono, 0);
  });

  teste('quem não estava não leva nada', () => {
    const tarde = pessoa('Tarde', 'Estagiária', dias.map(d => turno(d, 900, 1260)));
    const r = calcularBonus(presencas, [tarde], { ate: '2026-08-31' });
    igual(r.linhas[0].presencas, 0);
    igual(r.semDono, 21);
  });

  teste('o turno é fechado dos dois lados', () => {
    // Quem bateu a saída às 07:00 estava lá às 07:00.
    const justo = pessoa('Justo', 'Estagiária', dias.map(d => turno(d, 420, 420)));
    igual(calcularBonus(presencas, [justo], { ate: '2026-08-31' }).linhas[0].presencas, 21);
  });

  teste('PRESENÇA COM DOIS NA SALA É DIVIDIDA, não paga em dobro', () => {
    // Assim o custo depende de quantos ALUNOS vieram, não de quantas pessoas
    // foram escaladas — reforçar um turno cheio deixa de dobrar a conta.
    const a = pessoa('A', 'Estagiária', dias.map(d => turno(d, 420, 540)));
    const b = pessoa('B', 'Estagiário', dias.map(d => turno(d, 420, 540)));
    const r = calcularBonus(presencas, [a, b], { ate: '2026-08-31' });
    perto(r.total, 21 * 1.00, 0.01, 'o total tem que ser o MESMO de um estagiário sozinho');
    perto(r.linhas[0].valor, 21 * 0.50, 0.01);
    igual(r.linhas[0].divididas, 21);
    igual(r.divididas, 21);
  });

  teste('turno sem saída não conta — nem para o bem nem para o mal', () => {
    const meio = pessoa('Meio', 'Estagiária',
      dias.map(d => ({ dia: `2026-08-${d}`, de: 420, ate: null })));
    igual(calcularBonus(presencas, [meio], { ate: '2026-08-31' }).linhas[0].presencas, 0);
  });

  teste('só quem é estagiário entra, por padrão', () => {
    // Professores batem o mesmo ponto e cobrem os mesmos horários. Incluí-los
    // é decisão de negócio, não default.
    const prof = pessoa('Prof', 'Professor', dias.map(d => turno(d, 420, 540)));
    const est = pessoa('Est', 'Estagiária', dias.map(d => turno(d, 420, 540)));
    const r = calcularBonus(presencas, [prof, est], { ate: '2026-08-31' });
    igual(r.linhas.length, 1);
    igual(r.linhas[0].nome, 'Est');
    // E dá para incluir, quando a decisão for outra.
    const todos = calcularBonus(presencas, [prof, est], { ate: '2026-08-31', elegivel: () => true });
    igual(todos.linhas.length, 2);
  });
});

grupo('bônus · a faixa vem do aluno, não do estagiário', () => {
  const dias = ['03', '04', '05', '06', '07', '10', '11', '12', '13', '14',
    '17', '18', '19', '20', '21', '24', '25', '26', '27', '28', '31'];
  const estag = pessoa('E', 'Estagiária', dias.map(d => turno(d, 400, 600)));

  teste('aluno assíduo vale mais que aluno faltoso, na mesma sala', () => {
    // É a regra inteira do programa: aluno que não falta é aluno que renova.
    const linhas = [CAB,
      ...dias.map(d => pres('Cheio', 'Mensal [5 dias]', d, '07:00')),          // 100% → 1,00
      ...dias.slice(0, 6).map(d => pres('Pouco', 'Mensal [5 dias]', d, '07:10')), // 29% → 0,30
    ];
    const r = calcularBonus(lerPresencas(linhas), [estag], { ate: '2026-08-31' });
    igual(r.linhas[0].presencas, 27);
    perto(r.linhas[0].valor, 21 * 1.00 + 6 * 0.30, 0.01);
  });

  teste('aluno sem plano legível não gera bônus', () => {
    // Sem contrato não há teto, sem teto não há aproveitamento, sem
    // aproveitamento não há faixa. Pagar pelo piso inventaria um dado.
    const linhas = [CAB, ...dias.map(d => pres('SemPlano', 'Diária', d, '07:00'))];
    const r = calcularBonus(lerPresencas(linhas), [estag], { ate: '2026-08-31' });
    igual(r.linhas[0].presencas, 0);
    igual(r.semPlano, 21);
  });

  teste('Agenda e Acesso do mesmo dia pagam UMA vez', () => {
    // O atrasado entra manualmente e gera duas linhas. Pagar as duas infla o
    // bônus em 14%, que foi o que a planilha de agosto mostrou.
    const linhas = [CAB,
      ...dias.map(d => pres('Ana', 'Mensal [5 dias]', d, '07:00', 'Agenda')),
      ...dias.map(d => pres('Ana', 'Mensal [5 dias]', d, '07:21', 'Acesso')),
    ];
    const r = calcularBonus(lerPresencas(linhas), [estag], { ate: '2026-08-31' });
    igual(r.linhas[0].presencas, 21, 'vinte e um dias, vinte e uma presenças');
  });
});

grupo('bônus · a conta fecha', () => {
  teste('arredonda uma vez, no fim', () => {
    // Três presenças a R$ 0,65 divididas por 2 dão R$ 0,325 cada. Arredondando
    // a cada parcela, some ou nasce centavo; o total tem mais de mil parcelas.
    //
    // O caso precisa de uma parcela QUEBRADA para provar alguma coisa: com uma
    // faixa que divide redondo, os dois jeitos de arredondar dão o mesmo número
    // e o teste passaria mesmo com o erro dentro.
    const dias = ['03', '04', '05'];
    const linhas = [CAB,
      ...dias.map(d => pres('X', 'Mensal [4 dias]', d, '07:00')),
      // O dia 06 existe só para o plano de 4x render teto 4 naquela semana, e
      // cai fora do turno de propósito: ninguém recebe por ele.
      pres('Y', 'Mensal [4 dias]', '06', '20:00'),
    ];
    const a = pessoa('A', 'Estagiária', dias.map(d => turno(d, 400, 600)));
    const b = pessoa('B', 'Estagiária', dias.map(d => turno(d, 400, 600)));
    const r = calcularBonus(lerPresencas(linhas), [a, b], { ate: '2026-08-06' });
    // X fez 3 de 4 = 75% → R$ 0,65, divididos por dois = R$ 0,325 por presença.
    // 3 × 0,325 = 0,975 → 0,98. Arredondado a cada parcela daria 0,99.
    perto(r.linhas[0].valor, 0.98, 0.001);
    perto(r.total, 1.96, 0.001);
    igual(r.semDono, 1, 'a presença do dia 06 não tinha ninguém na sala');
  });

  teste('a faixa nova de 95 a 100% não invade a de baixo', () => {
    // O real inteiro é degrau, não reajuste da faixa anterior: quem está em 86
    // a 94% continua valendo R$ 0,80, e a fronteira é o que costuma escorregar
    // quando uma faixa é partida em duas.
    igual(faixaDe(94).valor, 0.80);
    igual(faixaDe(95).valor, 1.00);
    igual(faixaDe(100).valor, 1.00);
    igual(faixaDe(85).valor, 0.65, 'o teto de baixo não se mexeu');
  });

  teste('a descrição diz o mês que o bônus pagou', () => {
    // Ela é o que explica o valor no contracheque um ano depois.
    igual(descricaoDoBonus('2026-09-01'), 'Bônus por presença de alunos — setembro');
    igual(descricaoDoBonus(''), 'Bônus por presença de alunos');
  });

  teste('as batidas ímpares sobem para a tela', () => {
    // Elas não entram no cálculo, mas precisam aparecer: o colaborador está
    // recebendo menos por um erro de marcação, e ninguém saberia.
    const p = pessoa('A', 'Estagiária', [], [{ dia: '2026-08-10', de: 900 }]);
    const r = calcularBonus(lerPresencas([CAB]), [p], { ate: '2026-08-31' });
    igual(r.impares.length, 1);
    igual(r.impares[0].dias[0], '2026-08-10');
  });
});
