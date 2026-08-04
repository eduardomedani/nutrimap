// O contrato do cronômetro de descanso. Um "90s" digitado pelo profissional
// tem de virar exatamente 90 segundos na tela do aluno — e um texto que não dá
// para entender tem de virar `null` (sem cronômetro), nunca um número errado.
// Foi um número errado que fez o app parecer quebrado: "1-2 min" contava
// 1 SEGUNDO, o anel piscava e sumia, e a série parecia "não contar o tempo".

import { grupo, teste, igual } from './runner.mjs';
import { segDescanso, descansoDoItem, fmtRelogio, fmtSegLongo } from '../js/execucao-core.js';

grupo('execução · descanso — formatos que o profissional escreve', () => {
  teste('segundos, com e sem unidade', () => {
    igual(segDescanso('60s'), 60);
    igual(segDescanso('90'), 90);
    igual(segDescanso('45 seg'), 45);
    igual(segDescanso('90 segundos'), 90);
    igual(segDescanso(120), 120);
  });

  teste('minutos, inteiros e quebrados', () => {
    igual(segDescanso('2min'), 120);
    igual(segDescanso('2 MIN'), 120);
    igual(segDescanso('1 minuto'), 60);
    igual(segDescanso('1,5 min'), 90);
  });

  teste('minuto + segundos avulsos', () => {
    igual(segDescanso('1min30'), 90);
    igual(segDescanso('1 min 30s'), 90);
    igual(segDescanso('1 min 30 s'), 90);
    igual(segDescanso('1m30'), 90);
    igual(segDescanso('1:30'), 90);
    igual(segDescanso('01:30'), 90);
  });

  teste('faixa vale o menor extremo — e a unidade vem do outro lado', () => {
    igual(segDescanso('60-90s'), 60);
    igual(segDescanso('60 a 90 segundos'), 60);
    igual(segDescanso('1-2 min'), 60);       // já valeu 1 segundo
    igual(segDescanso('2-3 min'), 120);      // já valeu 2 segundos
    igual(segDescanso('1 a 2 min'), 60);
    igual(segDescanso('de 1 a 2 minutos'), 60);
    igual(segDescanso('30s a 1min'), 30);
    igual(segDescanso('2 min a 3 min'), 120);
  });

  teste('prefixo de aproximação não apaga o número', () => {
    igual(segDescanso('até 90s'), 90);       // já ficava sem cronômetro
    igual(segDescanso('~60s'), 60);
    igual(segDescanso('aprox. 2 min'), 120);
  });

  teste('sem descanso prescrito é null, nunca zero', () => {
    igual(segDescanso(''), null);
    igual(segDescanso('   '), null);
    igual(segDescanso(null), null);
    igual(segDescanso(undefined), null);
    igual(segDescanso('0'), null);
    igual(segDescanso('à vontade'), null);
    igual(segDescanso(0), null);
    igual(segDescanso(-30), null);
  });
});

grupo('execução · de onde sai o descanso de cada série', () => {
  const treino = { descanso_padrao: '90s' };

  teste('o exercício manda; o treino é só a rede de segurança', () => {
    igual(descansoDoItem({ descanso: '60s' }, treino), { entre: 60, final: 60 });
    igual(descansoDoItem({ descanso: null }, treino), { entre: 90, final: 90 });
  });

  teste('sem padrão no treino e sem descanso no item: nada de cronômetro', () => {
    igual(descansoDoItem({ descanso: null }, { descanso_padrao: null }), { entre: null, final: null });
    igual(descansoDoItem(null, null), { entre: null, final: null });
  });

  teste('a última série usa o descanso final quando ele existe', () => {
    igual(descansoDoItem({ descanso: '60s', descanso_final: '2min' }, treino), { entre: 60, final: 120 });
  });

  teste('descanso final sozinho não cronometra as séries do meio', () => {
    // Este é o outro jeito de "umas contam e outras não" dentro do MESMO
    // exercício — e aqui é prescrição, não defeito.
    igual(descansoDoItem({ descanso_final: '2min' }, { descanso_padrao: null }),
      { entre: null, final: 120 });
  });
});

grupo('execução · relógio', () => {
  teste('o anel mostra m:ss', () => {
    igual(fmtRelogio(90), '1:30');
    igual(fmtRelogio(45), '0:45');
    igual(fmtRelogio(0), '0:00');
    igual(fmtRelogio(-5), '0:00');
    igual(fmtRelogio(600), '10:00');
  });

  teste('a prescrição é lida por extenso', () => {
    igual(fmtSegLongo(45), '45 s');
    igual(fmtSegLongo(60), '1 min');
    igual(fmtSegLongo(90), '1 min 30 s');
    igual(fmtSegLongo(180), '3 min');
  });
});
