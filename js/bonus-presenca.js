// ═══════════════════════════════════════════════════════════
// BÔNUS POR PRESENÇA — o cruzamento que vira dinheiro
// ═══════════════════════════════════════════════════════════
// Duas planilhas entram: as presenças dos alunos (js/frequencia.js) e o espelho
// de ponto (js/ponto-planilha.js). Para cada presença, quem estava dentro do
// próprio turno batido NAQUELE minuto ganha por ela.
//
// A REGRA DE PREÇO, combinada em 04/09/2026: o valor da presença depende do
// APROVEITAMENTO DO ALUNO no mês — quantos dos treinos que ele contratou ele
// fez. Aluno assíduo vale mais porque aluno que não falta é aluno que renova, e
// é esse comportamento que o bônus compra.
//
//   até 50%  R$ 0,30      71 a 85%  R$ 0,65      95 a 100%  R$ 1,00
//   51 a 70% R$ 0,50      86 a 94%  R$ 0,80
//
// NENHUMA FAIXA VALE ZERO, e é deliberado. A versão anterior da tabela pagava
// nada abaixo de 60%, o que tirava do estagiário todo incentivo de correr atrás
// justamente de quem está a caminho de cancelar — que é quem o programa mais
// quer alcançar.
//
// O TOPO É ESTREITO DE PROPÓSITO: 95 a 100% saiu de dentro da antiga faixa de
// 86 a 100%, e não por cima dela. Quem fazia 90% continua valendo R$ 0,80; o
// real inteiro é o degrau de quem chega ao mês quase cheio, que antes pagava o
// mesmo que 86%.

import { FAIXAS, faixaDe, visitas, retratoDosAlunos } from './frequencia.js';

/** O minuto do dia de uma presença. */
const minutoDaPresenca = p => {
  const m = String(p.hora || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Quem estava na sala naquele minuto.
 *
 * O turno é fechado dos dois lados (`de <= t <= ate`): quem bateu a saída às
 * 09:31 estava lá às 09:31. Turno sem `ate` não entra — ver `turnosDoDia`.
 */
function presentes(pessoas, dia, minuto) {
  return pessoas.filter(p =>
    p.turnos.some(t => t.dia === dia && t.ate != null && minuto >= t.de && minuto <= t.ate));
}

/**
 * O bônus de cada colaborador no período.
 *
 * `elegivel` decide quem entra — por padrão, só quem tem "estagi" na função.
 * Professores batem o mesmo ponto e cobrem os mesmos horários; incluí-los muda
 * o custo e, principalmente, multiplica os casos de divisão, porque professor e
 * estagiário quase sempre estão juntos.
 *
 * PRESENÇA COM DUAS PESSOAS NA SALA É DIVIDIDA, não paga em dobro. Uma presença
 * é uma presença: assim o custo do programa depende de quantos ALUNOS vieram, e
 * não de quantas pessoas foram escaladas — reforçar um turno cheio deixaria de
 * dobrar a conta.
 */
export function calcularBonus(presencas = [], pessoas = [], {
  ate,
  elegivel = p => /estagi/i.test(String(p.funcao || '')),
  alunoElegivel = null,
} = {}) {
  const alunos = retratoDosAlunos(presencas, { ate });
  const pctDoAluno = new Map(alunos.map(a => [a.cliente, a.pct]));
  const equipe = pessoas.filter(elegivel);

  const placar = new Map(equipe.map(p => [p.nome, {
    nome: p.nome, cpf: p.cpf, funcao: p.funcao,
    presencas: 0, divididas: 0, valor: 0,
  }]));

  let semDono = 0, semPlano = 0, divididas = 0, comDesconto = 0;

  for (const v of visitas(presencas)) {
    // DESCONTO ALTO NÃO GERA BÔNUS, a mesma régua do bônus por aluno ativo
    // (`DESCONTO_MAXIMO`, hoje 10%). Quem decide é quem chama: aqui só se sabe
    // o nome que veio na planilha, e o desconto mora na assinatura.
    //
    // Sem a lista, ninguém é barrado. É de propósito: se a consulta ao banco
    // falhar, o mês fecha pagando a mais — que se corrige — em vez de fechar
    // pagando zero para todo mundo, que ninguém percebe até o estagiário
    // reclamar.
    if (alunoElegivel && !alunoElegivel(v.cliente)) { comDesconto++; continue; }

    const pct = pctDoAluno.get(v.cliente);
    // Sem plano legível não há aproveitamento, e sem aproveitamento não há
    // faixa. Pagar pelo piso seria inventar um dado que o arquivo não tem.
    if (pct === null || pct === undefined) { semPlano++; continue; }

    const minuto = minutoDaPresenca(v);
    if (minuto === null) { semDono++; continue; }

    const naSala = presentes(equipe, v.dia, minuto);
    if (!naSala.length) { semDono++; continue; }
    if (naSala.length > 1) divididas++;

    const valor = faixaDe(pct).valor / naSala.length;
    for (const p of naSala) {
      const r = placar.get(p.nome);
      r.presencas++;
      if (naSala.length > 1) r.divididas++;
      r.valor += valor;
    }
  }

  // Arredonda só no fim: somar centavos já arredondados a cada presença
  // acumula erro, e a conta tem mais de mil parcelas.
  const linhas = [...placar.values()]
    .map(r => ({ ...r, valor: Math.round(r.valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);

  const V = visitas(presencas);
  return {
    linhas,
    total: Math.round(linhas.reduce((s, r) => s + r.valor, 0) * 100) / 100,
    visitas: V.length,
    comDono: V.length - semDono - semPlano - comDesconto,
    semDono,
    semPlano,
    // Sai no resumo da tela, e não só na conta: uma queda no bônus sem motivo
    // visível é o tipo de coisa que vira desconfiança na folha.
    comDesconto,
    divididas,
    impares: pessoas.filter(p => p.impares?.length)
      .map(p => ({ nome: p.nome, dias: p.impares.map(i => i.dia) })),
  };
}

/** A descrição que vai para o contracheque — ela é o que explica o valor. */
export function descricaoDoBonus(competencia) {
  const m = String(competencia || '').match(/^(\d{4})-(\d{2})/);
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return m ? `Bônus por presença de alunos — ${MES[+m[2] - 1]}` : 'Bônus por presença de alunos';
}

/** A tabela de faixas, para a tela mostrar sem redeclarar os números. */
export { FAIXAS };
