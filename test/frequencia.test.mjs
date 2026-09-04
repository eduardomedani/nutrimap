// ═══════════════════════════════════════════════════════════
// FREQUÊNCIA — quem faltou no mês, e quanto
// ═══════════════════════════════════════════════════════════
// Duas contas erradas aqui viram injustiça com nome e sobrenome: acusar de
// faltoso quem treinou tudo o que dava, ou deixar passar quem parou de vir há
// três semanas. As duas já quase aconteceram nos dados de agosto de 2026, e é
// contra elas que este arquivo existe.
//
//   CONTAR LINHA EM VEZ DE VISITA. O cliente agendado às 18h que chega 18:21
//   entra manualmente e gera DUAS linhas. Eram 147 das 1.210 de agosto — 14%
//   de frequência inflada para todo mundo, sem nada parecer errado.
//
//   TETO COMO `vezes × 4`. Agosto terminou com o dia 31 sozinho numa segunda.
//   O plano 3x rendeu 13 treinos, não 15: quem fez 13 fez tudo, e a conta
//   ingênua o marcaria em 87%.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import {
  lerPresencas, visitas, vezesPorSemana, segundaDa, tetoDoPlano,
  faixaDe, FAIXAS, retratoDosAlunos, motivosDoAluno, relatorioDeFrequencia,
  MOTIVOS_FREQUENCIA,
} from '../js/frequencia.js';

const linha = (cliente, contrato, tipo, data) => ({ celulas: [cliente, 'Musculação', contrato, tipo, data] });
const CAB = { celulas: ['Cliente', 'Modalidade', 'Contrato', 'Tipo', 'Data'] };

grupo('frequência · lendo o arquivo', () => {
  teste('aceita o formato do exportador e o do parser', () => {
    // O arquivo traz "31/08/2026 20:00"; quando a célula é data de verdade o
    // parser devolve "2026-08-31 20:00". Os dois convivem entre versões do
    // exportador, e quebrar num deles esvaziaria o relatório sem dizer por quê.
    const p = lerPresencas([CAB,
      linha('Ana', 'Mensal [5 dias]', 'Agenda', '31/08/2026 20:00'),
      linha('Bia', 'Mensal [3 dias]', 'Acesso', '2026-08-30 06:15'),
    ]);
    igual(p.length, 2);
    igual(p[0].dia, '2026-08-31');
    igual(p[0].hora, '20:00');
    igual(p[1].dia, '2026-08-30');
  });

  teste('linha sem cliente ou sem data é ignorada, não quebra', () => {
    const p = lerPresencas([CAB,
      linha('', 'Mensal [5 dias]', 'Agenda', '31/08/2026 20:00'),
      linha('Ana', 'Mensal [5 dias]', 'Agenda', 'sem data'),
      linha('Ana', 'Mensal [5 dias]', 'Agenda', '31/08/2026 20:00'),
    ]);
    igual(p.length, 1);
  });
});

grupo('frequência · uma visita por dia', () => {
  teste('Agenda e Acesso no mesmo dia são a MESMA visita', () => {
    // Regra da casa, 04/09/2026: o atrasado entra manualmente e gera as duas.
    const p = lerPresencas([CAB,
      linha('Ana', 'Mensal [5 dias]', 'Agenda', '31/08/2026 18:00'),
      linha('Ana', 'Mensal [5 dias]', 'Acesso', '31/08/2026 18:21'),
    ]);
    const v = visitas(p);
    igual(v.length, 1, 'duas linhas, uma visita');
    igual(v[0].tipo, 'Acesso', 'fica a entrada FÍSICA, não a hora reservada');
    igual(v[0].hora, '18:21');
  });

  teste('dias diferentes são visitas diferentes', () => {
    const p = lerPresencas([CAB,
      linha('Ana', 'Mensal [5 dias]', 'Acesso', '30/08/2026 18:00'),
      linha('Ana', 'Mensal [5 dias]', 'Acesso', '31/08/2026 18:00'),
    ]);
    igual(visitas(p).length, 2);
  });

  teste('a ordem das linhas não muda o resultado', () => {
    // O Acesso vem depois no arquivo, mas pode vir antes noutra exportação.
    const antes = lerPresencas([CAB,
      linha('Ana', 'M', 'Acesso', '31/08/2026 18:21'),
      linha('Ana', 'M', 'Agenda', '31/08/2026 18:00'),
    ]);
    igual(visitas(antes)[0].tipo, 'Acesso');
  });
});

grupo('frequência · o teto do plano', () => {
  const AGOSTO = [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    '2026-08-31',
  ];

  teste('a semana começa na segunda', () => {
    igual(segundaDa('2026-08-31'), '2026-08-31', 'segunda é a própria');
    igual(segundaDa('2026-08-07'), '2026-08-03', 'sexta recua até a segunda');
    igual(segundaDa('2026-08-09'), '2026-08-03', 'domingo ainda é da semana anterior');
  });

  teste('NÃO é vezes × 4 — a última semana de agosto tem um dia só', () => {
    // Ninguém treina três vezes numa segunda-feira solitária. Contar 15
    // marcaria em 87% quem fez tudo o que dava.
    igual(tetoDoPlano(3, AGOSTO), 13);
    igual(tetoDoPlano(5, AGOSTO), 21, 'o plano 5x coincide com todo dia aberto');
  });

  teste('o teto sai dos dias que a academia ABRIU', () => {
    // Feriado em que ninguém treinou não conta contra ninguém: se o dia não
    // aparece no arquivo, ele não existiu.
    const semSexta = AGOSTO.filter(d => !d.endsWith('-07'));
    ok(tetoDoPlano(5, semSexta) < tetoDoPlano(5, AGOSTO));
  });

  teste('plano sem número legível não tem teto', () => {
    igual(vezesPorSemana('Mensal [5 dias]'), 5);
    igual(vezesPorSemana('Trimestral [3 dias]'), 3);
    igual(vezesPorSemana('Diária'), null);
    igual(tetoDoPlano(null, AGOSTO), null);
  });
});

grupo('frequência · as faixas', () => {
  teste('são a mesma régua do bônus por presença', () => {
    // Combinado de 04/09/2026. Se um dia mudarem, têm de mudar nos dois.
    igual(FAIXAS.map(f => f.ate).join(','), '50,70,85,100');
    igual(FAIXAS.map(f => f.valor).join(','), '0.3,0.5,0.65,0.8');
  });

  teste('as bordas caem na faixa de baixo', () => {
    igual(faixaDe(50).chave, 'critico');
    igual(faixaDe(51).chave, 'baixo');
    igual(faixaDe(70).chave, 'baixo');
    igual(faixaDe(71).chave, 'bom');
    igual(faixaDe(85).chave, 'bom');
    igual(faixaDe(86).chave, 'otimo');
    igual(faixaDe(100).chave, 'otimo');
  });
});

// ── um mês de mentira, com casos plantados ────────────────────────────────
function mesDeTeste() {
  const dias = ['03', '04', '05', '06', '07', '10', '11', '12', '13', '14',
    '17', '18', '19', '20', '21', '24', '25', '26', '27', '28', '31'];
  const l = [CAB];
  const treina = (nome, plano, quais) => {
    for (const d of quais) l.push(linha(nome, plano, 'Acesso', `${d}/08/2026 07:00`));
  };
  treina('Assiduo', 'Mensal [5 dias]', dias);                  // 21 de 21 = 100%
  treina('Sumido', 'Mensal [5 dias]', dias.slice(0, 4));       // parou em 06/08
  treina('Despencou', 'Mensal [3 dias]', ['03', '04', '05', '06', '07', '10', '11', '31']);
  treina('Critico', 'Mensal [3 dias]', ['03', '10', '17', '24', '31']);  // 5 de 13 = 38%
  // Baixo e SemPlano treinam ATÉ O ÚLTIMO DIA de propósito: espalhados só na
  // primeira metade, eles virariam "sumiu", que é mais grave, e o teste nunca
  // chegaria a exercitar a faixa de percentual que ele diz testar.
  treina('Baixo', 'Mensal [5 dias]',
    ['03', '04', '05', '07', '10', '12', '14', '17', '19', '21', '25', '28', '31']); // 13 de 21 = 62%
  treina('SemPlano', 'Diária', ['03', '17', '31']);
  return lerPresencas(l);
}

grupo('frequência · os motivos', () => {
  const r = relatorioDeFrequencia(mesDeTeste(), { ate: '2026-08-31' });
  const de = nome => r.alunos.find(a => a.cliente === nome);

  teste('quem treinou tudo não gera motivo nenhum', () => {
    igual(de('Assiduo').pct, 100);
    igual(motivosDoAluno(de('Assiduo')).length, 0);
  });

  teste('sumiço vem ANTES de frequência baixa', () => {
    // Quem fez 60% e parou no dia 6 é caso perdido se ninguém ligar esta
    // semana; quem fez 60% treinando até o último dia é rotina, não risco. O
    // percentual sozinho não distingue os dois.
    const m = motivosDoAluno(de('Sumido'));
    igual(m[0].chave, 'sumiu');
    contem(m[0].detalhe, 'sem treinar há 25 dias');
    ok(m.length > 1, 'a frequência baixa continua listada, só não é a manchete');
  });

  teste('a queda é medida por RITMO, não por contagem crua', () => {
    // As duas metades do mês raramente têm o mesmo número de dias abertos.
    // Comparar contagens cruas acusaria queda onde só houve mês mais curto.
    const m = motivosDoAluno(de('Despencou'));
    igual(m[0].chave, 'despencou');
    contem(m[0].detalhe, 'na 1ª quinzena');
  });

  teste('crítico e baixo se separam em 50%', () => {
    igual(motivosDoAluno(de('Critico'))[0].chave, 'critico');
    igual(motivosDoAluno(de('Baixo'))[0].chave, 'baixo');
    igual(de('Critico').pct, 38);
    igual(de('Baixo').pct, 62);
  });

  teste('sem contrato legível, o motivo é o buraco de cadastro', () => {
    // Sem teto não dá para dizer se faltou. Some da conta sem dar erro nenhum,
    // então precisa aparecer na folha.
    igual(de('SemPlano').pct, null);
    igual(motivosDoAluno(de('SemPlano'))[0].chave, 'sem_plano');
  });

  teste('os pesos são únicos e a lista está em ordem', () => {
    const pesos = MOTIVOS_FREQUENCIA.map(m => m.peso);
    igual(new Set(pesos).size, pesos.length, 'peso repetido faz a ordem depender de quem foi escrito antes');
    igual(pesos.join(','), [...pesos].sort((a, b) => a - b).join(','));
  });
});

grupo('frequência · a folha', () => {
  const r = relatorioDeFrequencia(mesDeTeste(), { ate: '2026-08-31' });

  teste('o aluno aparece uma vez, no grupo do motivo mais grave', () => {
    const nomes = r.grupos.flatMap(g => g.alunos.map(a => a.cliente));
    igual(nomes.length, new Set(nomes).size, 'nome repetido faz ligar duas vezes');
  });

  teste('quem está em dia é contado, não listado', () => {
    igual(r.emDia, 1, 'só o Assiduo');
    igual(r.total, 5);
  });

  teste('o resumo separa linhas de visitas', () => {
    // São números diferentes e a folha mostra os dois: se um dia divergirem
    // muito, é sinal de que o exportador mudou de comportamento.
    ok(r.resumo.visitas <= r.resumo.linhas);
    igual(r.resumo.diasAbertos, 21);
    igual(r.resumo.de, '2026-08-03');
    igual(r.resumo.ate, '2026-08-31');
  });

  teste('o esperado é a soma dos tetos, não uma multiplicação', () => {
    // 2 alunos de 3x (13) + 3 de 5x (21) = 26 + 63 = 89. O SemPlano não entra.
    igual(r.resumo.esperado, 89);
  });

  teste('o relatório de agosto não muda em dezembro', () => {
    // `ate` é o fim do PERÍODO, não "hoje". Fechado o mês, o número está
    // fechado — senão a folha impressa hoje discorda da reimpressa amanhã.
    const outra = relatorioDeFrequencia(mesDeTeste(), { ate: '2026-08-31' });
    igual(JSON.stringify(outra.resumo), JSON.stringify(r.resumo));
  });
});
