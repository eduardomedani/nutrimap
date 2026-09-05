// ═══════════════════════════════════════════════════════════
// FREQUÊNCIA — quem faltou no mês, e quanto
// ═══════════════════════════════════════════════════════════
// Funções puras sobre as linhas do relatório de presenças exportado do controle
// de acesso. Sem rede, sem DOM: a data de referência e os dados entram como
// argumento, e é isso que permite testar "quem estava em risco em 31/08" sem
// esperar agosto.
//
// AS COLUNAS DO ARQUIVO: Cliente · Modalidade · Contrato · Tipo · Data(com hora).

/** Uma linha crua vira um registro nomeado. Linha sem cliente é ignorada. */
export function lerPresencas(linhas = []) {
  const saida = [];
  for (const l of linhas.slice(1)) {
    const [cliente, modalidade, contrato, tipo, data] = l.celulas || [];
    if (!cliente) continue;
    const texto = String(data ?? '');
    // O arquivo traz "31/08/2026 20:00"; o parser devolve "2026-08-31 20:00"
    // quando a célula é data de verdade. Os dois formatos convivem porque o
    // exportador muda de versão para versão.
    const m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2}:\d{2})?/)
           || texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2}:\d{2})?/);
    if (!m) continue;
    const dia = texto.startsWith(m[1] + '/')
      ? `${m[3]}-${m[2]}-${m[1]}`
      : `${m[1]}-${m[2]}-${m[3]}`;
    saida.push({
      cliente: String(cliente).trim(),
      contrato: contrato ? String(contrato).trim() : '',
      tipo: String(tipo || '').trim(),
      dia,
      hora: m[4] || '',
    });
  }
  return saida;
}

/**
 * As linhas viram VISITAS: uma por cliente por dia.
 *
 * REGRA DA CASA, confirmada em 04/09/2026: o cliente agendado às 18h que chega
 * 18:21 entra na catraca manualmente, e o arquivo grava duas linhas — uma
 * "Agenda" e uma "Acesso". É a mesma visita. Em agosto isso valia para 147 das
 * 1.210 linhas: contar linha em vez de visita infla a frequência de todo mundo
 * em 14%, e ninguém veria.
 *
 * Fica a marcação do ACESSO, que é a entrada física. A Agenda é a hora cheia
 * reservada, e às vezes de uma hora que a pessoa não cumpriu.
 */
export function visitas(presencas = []) {
  const porDia = new Map();
  for (const p of presencas) {
    const k = p.cliente + '|' + p.dia;
    const atual = porDia.get(k);
    if (!atual || (p.tipo === 'Acesso' && atual.tipo !== 'Acesso')) porDia.set(k, p);
  }
  return [...porDia.values()];
}

/** "Mensal [5 dias]" → 5. Sem número legível, null. */
export function vezesPorSemana(contrato) {
  const m = String(contrato || '').match(/(\d+)\s*dias?/i);
  return m ? Number(m[1]) : null;
}

const DIA_MS = 86400000;
const comoData = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

/** A segunda-feira da semana de uma data — a chave que agrupa a semana. */
export function segundaDa(iso) {
  const d = comoData(iso);
  if (!d) return null;
  const seg = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DIA_MS);
  const p = x => String(x).padStart(2, '0');
  return `${seg.getFullYear()}-${p(seg.getMonth() + 1)}-${p(seg.getDate())}`;
}

/**
 * Quantos treinos o plano rendeu NAQUELE mês — o teto de cada frequência.
 *
 * NÃO É `vezes × 4`. Ninguém treina três vezes numa semana em que a academia
 * abriu um dia só: agosto de 2026 terminou com o dia 31 sozinho numa segunda,
 * e o plano 3x rendeu 13 treinos, não 15. Contar 15 acusaria de faltoso quem
 * fez tudo o que dava.
 *
 * Os dias vêm dos PRÓPRIOS dados: o que a academia abriu é o que apareceu no
 * arquivo. Feriado em que ninguém treinou não conta contra ninguém.
 */
export function tetoDoPlano(vezes, diasDoMes = []) {
  if (!vezes) return null;
  const porSemana = new Map();
  for (const d of new Set(diasDoMes)) {
    const s = segundaDa(d);
    porSemana.set(s, (porSemana.get(s) || 0) + 1);
  }
  let teto = 0;
  for (const dias of porSemana.values()) teto += Math.min(vezes, dias);
  return teto;
}

// ── as faixas do bônus, que também classificam o risco ─────────────────────
// Combinado de 04/09/2026. Elas moram aqui e não na tela porque são a mesma
// régua que o bônus por presença usa: se um dia mudarem, mudam nos dois.
export const FAIXAS = [
  { chave: 'critico', ate: 50,  rotulo: 'Até 50%',   valor: 0.30 },
  { chave: 'baixo',   ate: 70,  rotulo: '51 a 70%',  valor: 0.50 },
  { chave: 'bom',     ate: 85,  rotulo: '71 a 85%',  valor: 0.65 },
  { chave: 'otimo',   ate: 94,  rotulo: '86 a 94%',  valor: 0.80 },
  { chave: 'elite',   ate: 100, rotulo: '95 a 100%', valor: 1.00 },
];

export function faixaDe(pct) {
  return FAIXAS.find(f => pct <= f.ate) || FAIXAS[FAIXAS.length - 1];
}

/**
 * O retrato de cada aluno no mês.
 *
 * `ate` é o último dia do período — e não "hoje" — porque o relatório de agosto
 * tem de dar o mesmo número em setembro e em dezembro. Fechado o mês, ele não
 * pode mudar mais.
 */
export function retratoDosAlunos(presencas = [], { ate } = {}) {
  const V = visitas(presencas);
  const dias = [...new Set(V.map(v => v.dia))].sort();
  const fim = ate || dias[dias.length - 1] || '';
  const corte = segundaDa(fim);      // a última semana começa aqui

  const porAluno = new Map();
  for (const v of V) {
    const a = porAluno.get(v.cliente) || { cliente: v.cliente, contrato: '', visitas: [], ultimo: '' };
    a.visitas.push(v);
    if (v.dia > a.ultimo) a.ultimo = v.dia;
    porAluno.set(v.cliente, a);
  }
  // O contrato vem repetido em cada linha, mas a de "Acesso" manual às vezes vem
  // sem ele — fica o mais frequente, não o primeiro que aparecer.
  for (const p of presencas) {
    if (!p.contrato) continue;
    const a = porAluno.get(p.cliente);
    if (!a) continue;
    a._votos = a._votos || new Map();
    a._votos.set(p.contrato, (a._votos.get(p.contrato) || 0) + 1);
  }

  const metade = dias[Math.floor(dias.length / 2)] || fim;

  return [...porAluno.values()].map(a => {
    const contrato = a._votos ? [...a._votos].sort((x, y) => y[1] - x[1])[0][0] : '';
    const vezes = vezesPorSemana(contrato);
    const teto = tetoDoPlano(vezes, dias);
    const feitos = a.visitas.length;
    const pct = teto ? Math.min(100, Math.round((feitos / teto) * 100)) : null;

    const primeiraMetade = a.visitas.filter(v => v.dia < metade).length;
    const segundaMetade = a.visitas.filter(v => v.dia >= metade).length;
    const diasA = dias.filter(d => d < metade).length || 1;
    const diasB = dias.filter(d => d >= metade).length || 1;
    // Normalizado pelos dias de cada metade: as duas raramente têm o mesmo
    // tamanho, e comparar contagens cruas acusaria queda onde só houve mês.
    const ritmoA = primeiraMetade / diasA;
    const ritmoB = segundaMetade / diasB;

    const diasSemVir = a.ultimo ? Math.round((comoData(fim) - comoData(a.ultimo)) / DIA_MS) : null;

    return {
      cliente: a.cliente, contrato, vezes, teto, feitos, pct,
      faixa: pct === null ? null : faixaDe(pct),
      ultimo: a.ultimo, diasSemVir,
      primeiraMetade, segundaMetade,
      queda: ritmoA > 0 ? Math.round((1 - ritmoB / ritmoA) * 100) : 0,
    };
  }).sort((x, y) => x.cliente.localeCompare(y.cliente, 'pt-BR'));
}

// ───────────────────────────────────────────────────────────
// OS MOTIVOS
// ───────────────────────────────────────────────────────────
// Ordem de gravidade. Um aluno pode ter vários; o relatório agrupa pelo
// primeiro e mostra o resto ao lado.
//
// SUMIÇO VEM ANTES DE FREQUÊNCIA BAIXA, e não é detalhe: quem fez 60% e parou
// no dia 19 é caso perdido se ninguém ligar esta semana; quem fez 60% treinando
// até o último dia é rotina, não risco. O percentual sozinho não distingue os
// dois — foi o que a análise de agosto mostrou.

export const MOTIVOS_FREQUENCIA = [
  {
    chave: 'sumiu',
    peso: 1,
    rotulo: 'Parou de vir',
    detalhe: a => (a.diasSemVir !== null && a.diasSemVir >= 7
      ? `sem treinar há ${a.diasSemVir} dias — último em ${dataBR(a.ultimo)}` : null),
  },
  {
    chave: 'despencou',
    peso: 2,
    rotulo: 'Caiu na segunda quinzena',
    detalhe: a => (a.queda >= 40 && a.segundaMetade > 0
      ? `${a.primeiraMetade} treinos na 1ª quinzena, ${a.segundaMetade} na 2ª` : null),
  },
  // OS DOIS DE FREQUÊNCIA NÃO VÃO PARA A LINHA (`naLinha: false`). Eles contam
  // para "precisa de atenção" e definem a ordem, mas escrever "5 de 13 treinos
  // · 38%" na coluna Situação repetiria as colunas Treinos e Frequência, que
  // estão logo ao lado. A coluna Situação existe para dizer o que os números
  // NÃO dizem — e uma coluna que repete a vizinha ensina a não ler nenhuma.
  {
    chave: 'critico',
    peso: 3,
    rotulo: 'Frequência crítica',
    naLinha: false,
    detalhe: a => (a.pct !== null && a.pct <= 50
      ? `${a.feitos} de ${a.teto} treinos · ${a.pct}%` : null),
  },
  {
    chave: 'baixo',
    peso: 4,
    rotulo: 'Frequência baixa',
    naLinha: false,
    detalhe: a => (a.pct !== null && a.pct > 50 && a.pct <= 70
      ? `${a.feitos} de ${a.teto} treinos · ${a.pct}%` : null),
  },
  {
    chave: 'sem_plano',
    peso: 5,
    rotulo: 'Plano não identificado',
    // Não dá para dizer se faltou: sem o contrato na planilha não há teto. É
    // buraco de cadastro, e some da conta sem dar erro nenhum.
    detalhe: a => (a.pct === null
      ? `${a.feitos} ${a.feitos === 1 ? 'treino' : 'treinos'}, sem contrato na planilha` : null),
  },
];

export function motivosDoAluno(aluno) {
  const saida = [];
  for (const m of MOTIVOS_FREQUENCIA) {
    const detalhe = m.detalhe(aluno);
    if (detalhe) saida.push({
      chave: m.chave, rotulo: m.rotulo, peso: m.peso, detalhe,
      naLinha: m.naLinha !== false,
    });
  }
  return saida.sort((a, b) => a.peso - b.peso);
}

/**
 * A folha inteira: TODOS os alunos numa lista só, do mais crítico ao menos.
 *
 * A primeira versão agrupava por motivo — um bloco de "parou de vir", outro de
 * "caiu na segunda quinzena". Lia bem, mas escondia a comparação: para saber se
 * o aluno de 38% do bloco de cima estava pior que o de 45% do de baixo era
 * preciso vasculhar as duas listas. Ordenado por frequência, o pior está sempre
 * na primeira linha, e o olho desce até onde a atenção deixa de ser necessária.
 *
 * OS MOTIVOS NÃO SUMIRAM, mudaram de lugar: viram a coluna Situação, na mesma
 * linha do aluno. Quem parou de vir há 25 dias continua dizendo isso — só não
 * ocupa mais um bloco separado que impedia a comparação.
 */
export function relatorioDeFrequencia(presencas = [], { ate } = {}) {
  const brutos = retratoDosAlunos(presencas, { ate });
  const alunos = brutos.map(a => ({ ...a, motivos: motivosDoAluno(a) }));

  // SEM PLANO LEGÍVEL VAI PARA O FIM, e não para o topo. Percentual nulo não é
  // "zero por cento": é "não dá para saber", e pôr esses alunos na frente diria
  // que são os mais críticos quando o problema deles é de cadastro.
  const ordenados = [...alunos].sort((x, y) => {
    if ((x.pct === null) !== (y.pct === null)) return x.pct === null ? 1 : -1;
    return (x.pct ?? 0) - (y.pct ?? 0)
      // Empate de percentual: quem está há mais tempo sem aparecer primeiro —
      // 60% treinando ontem e 60% tendo parado no dia 6 são situações
      // diferentes, e a segunda tem menos tempo de conserto.
      || (y.diasSemVir ?? 0) - (x.diasSemVir ?? 0)
      // E nome por último, para a ordem não mudar entre duas impressões do
      // mesmo dia.
      || x.cliente.localeCompare(y.cliente, 'pt-BR');
  });

  const comPct = alunos.filter(a => a.pct !== null);
  const dias = [...new Set(visitas(presencas).map(v => v.dia))].sort();
  const precisam = alunos.filter(a => a.motivos.length).length;

  return {
    alunos: ordenados,
    total: precisam,
    emDia: alunos.length - precisam,
    // O índice onde a atenção deixa de ser necessária: a folha marca essa
    // fronteira com um filete, em vez de partir a tabela em duas.
    corte: ordenados.findIndex(a => a.motivos.length === 0),
    resumo: {
      alunos: alunos.length,
      visitas: visitas(presencas).length,
      linhas: presencas.length,
      de: dias[0] || '',
      ate: ate || dias[dias.length - 1] || '',
      diasAbertos: dias.length,
      esperado: comPct.reduce((s, a) => s + a.teto, 0),
      realizado: comPct.reduce((s, a) => s + a.feitos, 0),
    },
  };
}

/** '2026-08-31' → '31/08'. Data curta, que é o que cabe na linha impressa. */
function dataBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
}
