// ═══════════════════════════════════════════════════════════
// FERIADO TRABALHADO — hora extra de 100%
// ═══════════════════════════════════════════════════════════
// O erro que estes testes travam é pagar a hora do feriado TRÊS vezes: as
// horas do dia já estão nas horas da folha, a R$ 13. O adicional é só a outra
// metade — 5:53 × R$ 13,00 —, e é isso que faz a hora sair a R$ 26.
//
// Os números são os de 07/09/2026, tirados do espelho de setembro.

import { grupo, teste, ok, igual } from './runner.mjs';
import {
  horasNoDia, linhasDoFeriado, descricaoHoraExtraFeriado, prefixoDoFeriado, diaCurto,
} from '../js/feriado.js';
import { linhasDoContracheque, horaExtraDeFeriado } from '../js/contracheque.js';

const DIA = '2026-09-07';
const turno = (dia, de, ate) => ({ dia, de, ate });
const PESSOAS = [
  { nome: 'Eduardo', cpf: '169.459.787-37', funcao: 'Estagiário',
    turnos: [turno(DIA, 354, 474), turno(DIA, 976, 1209), turno('2026-09-08', 354, 474)], impares: [] },
  { nome: 'Aline', cpf: '13740672706', funcao: 'Estagiária',
    turnos: [turno(DIA, 469, 572)], impares: [] },
  { nome: 'Beatriz', cpf: '12762086779', funcao: 'Estagiária',
    turnos: [turno('2026-09-08', 400, 500)], impares: [] },
  { nome: 'Rafael', cpf: '15867198740', funcao: 'Professor',
    turnos: [], impares: [{ dia: DIA, de: 357 }] },
];
const item = (id, cpf, extra = {}) => ({
  id, modo: 'horas', valor_hora: 13, adicionais: [], funcionario: { cpf }, ...extra,
});

grupo('feriado · quem trabalhou no dia', () => {
  teste('soma os turnos do dia, e só do dia', () => {
    const h = horasNoDia(PESSOAS, DIA);
    igual(h.map(p => [p.nome, p.minutos]), [['Eduardo', 353], ['Aline', 103], ['Rafael', 0]]);
  });

  teste('quem não bateu ponto no feriado não aparece', () => {
    ok(!horasNoDia(PESSOAS, DIA).some(p => p.nome === 'Beatriz'));
  });

  teste('batida sem saída aparece, sem horas, para alguém corrigir', () => {
    const rafael = horasNoDia(PESSOAS, DIA).find(p => p.nome === 'Rafael');
    igual(rafael.impar, true);
    igual(rafael.minutos, 0);
  });
});

grupo('feriado · o valor da hora extra', () => {
  const itens = [item('e', '16945978737'), item('a', '13740672706'), item('r', '15867198740')];

  teste('SÓ A DIFERENÇA: 5:53 × R$ 13,00 = R$ 76,48', () => {
    // Somado às 5:53 que já estão nas horas da folha, a hora sai a R$ 26.
    const eduardo = linhasDoFeriado(PESSOAS, itens, DIA).find(l => l.nome === 'Eduardo');
    igual(eduardo.valor, 76.48);
    igual(eduardo.descricao, 'Horas extras feriado 07/09 — 5:53 × R$ 13,00 (100%)');
  });

  teste('casa pela folha pelo CPF, com ou sem pontuação', () => {
    const eduardo = linhasDoFeriado(PESSOAS, itens, DIA).find(l => l.nome === 'Eduardo');
    igual(eduardo.item.id, 'e');
  });

  teste('batida ímpar não gera valor', () => {
    const rafael = linhasDoFeriado(PESSOAS, itens, DIA).find(l => l.nome === 'Rafael');
    igual(rafael.valor, null);
  });

  teste('salário fixo não tem valor/hora: aparece, sem valor, para lançar à mão', () => {
    const l = linhasDoFeriado(PESSOAS, [item('e', '16945978737', { modo: 'fixo', valor_hora: null })], DIA)
      .find(x => x.nome === 'Eduardo');
    igual(l.valor, null);
    ok(l.item, 'a linha existe na folha');
  });

  teste('fora da folha: aparece sem linha', () => {
    const l = linhasDoFeriado(PESSOAS, [], DIA).find(x => x.nome === 'Aline');
    igual(l.item, null);
  });

  teste('o que já foi lançado não entra de novo', () => {
    const lancado = item('a', '13740672706', {
      adicionais: [{ descricao: 'Horas extras feriado 07/09 — 1:43 × R$ 13,00 (100%)', valor: 22.32 }],
    });
    const l = linhasDoFeriado(PESSOAS, [lancado], DIA).find(x => x.nome === 'Aline');
    igual(l.jaLancado, true);
  });

  teste('o prefixo é do dia, não de qualquer feriado', () => {
    igual(prefixoDoFeriado('2026-11-15'), 'Horas extras feriado 15/11');
    igual(diaCurto(DIA), '07/09');
  });
});

grupo('feriado · no contracheque', () => {
  teste('as horas vão para a coluna de referência, como as horas trabalhadas', () => {
    const linhas = linhasDoContracheque({
      modo: 'horas', minutos: 4800, valor_base: 1040,
      adicionais: [{ descricao: descricaoHoraExtraFeriado(DIA, 353, 13), valor: 76.48 }],
    });
    igual(linhas[1], {
      descricao: 'Horas extras feriado 07/09 (100%) · R$ 13,00/h',
      referencia: '5:53',
      valor: 76.48,
    });
  });

  teste('outro adicional continua como estava', () => {
    igual(horaExtraDeFeriado('Bônus por presença de alunos — setembro'), null);
    const linhas = linhasDoContracheque({
      modo: 'horas', minutos: 60, valor_base: 13,
      adicionais: [{ descricao: 'Premiação', valor: 50 }],
    });
    igual(linhas[1], { descricao: 'Premiação', referencia: '', valor: 50 });
  });
});
