// Leitura do espelho de ponto (PDF).
//
// O que este arquivo protege: a ESCOLHA DA COLUNA. O relatório muda de forma
// conforme quem trabalhou à noite — quem só faz diurno tem 4 colunas, quem tem
// hora noturna tem 6. Pegar "o primeiro número depois de Total:" acerta nos
// dois layouts de hoje por acaso; se um dia o gerador imprimir o total de
// Previstas, essa regra passa a pagar todo mundo pelo número errado, com uma
// cara perfeitamente normal na tela.
//
// Os casos abaixo são as coordenadas reais extraídas dos 6 PDFs de julho/2026.

import { grupo, teste, ok, igual, lanca } from './runner.mjs';
import { interpretarGrade, minutosDeHhmm, minutosDeHoras, traduzirErroPonto } from '../js/ponto-pdf.js';

// Layout de quem só tem hora diurna (Aline, Beatriz, Eduardo, Josely).
const DIURNO = [
  { x: 8, y: -606, texto: 'Colaborador: Ana Vitória de Almeida' },
  { x: 8, y: -600, texto: 'CPF: 111.444.777-35' },
  { x: 8, y: -594, texto: 'Período: 01/07/2026-31/07/2026' },
  { x: 8, y: -590, texto: 'Função: Estagiária' },
  { x: 827, y: -81, texto: 'Previstas' },
  { x: 884, y: -81, texto: 'Diurnas' },
  { x: 932, y: -81, texto: 'Intervalo' },
  { x: 995, y: -81, texto: 'Faltas' },
  { x: 8, y: -519, texto: 'Total:' },
  { x: 888, y: -519, texto: '48:41' },
  { x: 940, y: -519, texto: '24:12' },
  { x: 987, y: -519, texto: '-43:42' },
];

// Layout de quem tem hora noturna (Mateus, Rafael): duas colunas a mais, e o
// x=888 — que no layout de cima era Diurnas — agora é "Not.Red.".
const NOTURNO = [
  { x: 8, y: -606, texto: 'Colaborador: Marcos Loureiro Campos' },
  { x: 8, y: -600, texto: 'CPF: 222.555.888-46' },
  { x: 8, y: -594, texto: 'Período: 01/07/2026-31/07/2026' },
  { x: 723, y: -81, texto: 'Previstas' },
  { x: 781, y: -81, texto: 'Diurnas' },
  { x: 827, y: -81, texto: 'Noturnas' },
  { x: 881, y: -81, texto: 'Not.Red.' },
  { x: 932, y: -81, texto: 'Intervalo' },
  { x: 995, y: -81, texto: 'Faltas' },
  { x: 8, y: -519, texto: 'Total:' },
  { x: 785, y: -519, texto: '92:45' },
  { x: 837, y: -519, texto: '07:08' },
  { x: 888, y: -519, texto: '08:13' },
  { x: 940, y: -519, texto: '00:00' },
  { x: 987, y: -519, texto: '-15:05' },
];

// Formato novo (outubro/2026, coordenadas reais; nome e CPF fictícios): a coluna
// "Normais" no lugar de "Diurnas", sem linha "Total:", rodapé de rótulo e valor,
// horas em decimal e o período escrito com "a". As células vêm duplicadas no
// rodapé porque o gerador desenha cada uma duas vezes.
const NORMAIS = [
  { x: 612, y: -32.3, texto: '02/10/2026 a 31/10/2026' },
  { x: 647.6, y: -18, texto: 'Período:' },
  { x: 139.5, y: -46.5, texto: 'Função:' },
  { x: 178.5, y: -46.5, texto: 'Professor' },
  { x: 12, y: -77.3, texto: 'Colaborador:' },
  { x: 72, y: -77.3, texto: 'Ana Vitória de Almeida' },
  { x: 12, y: -91.5, texto: 'CPF:' },
  { x: 35.3, y: -91.5, texto: '111.444.777-35' },
  { x: 6.8, y: -113.3, texto: 'Data' },
  { x: 305.3, y: -113.3, texto: 'Ent. 1' },
  { x: 429.8, y: -113.3, texto: 'Saí. 1' },
  { x: 609.4, y: -113.3, texto: 'Prevista' },
  { x: 778.1, y: -113.3, texto: 'Normais' },
  { x: 935.6, y: -113.3, texto: 'Faltas' },
  { x: 6.8, y: -129, texto: '02/10/26 - sex' },
  { x: 305.3, y: -129, texto: '15,97' },
  { x: 429.8, y: -129, texto: '20,00' },
  { x: 618.8, y: -129, texto: '5,00' },
  { x: 788.6, y: -129, texto: '4,03' },
  { x: 938.3, y: -129, texto: '-0,97' },
  { x: 6.8, y: -598.5, texto: 'Previstas:' },
  { x: 6.8, y: -598.5, texto: 'Previstas:' },
  { x: 54, y: -598.5, texto: '105:00' },
  { x: 90.8, y: -598.5, texto: 'Normais:' },
  { x: 90.8, y: -598.5, texto: 'Normais:' },
  { x: 135.8, y: -598.5, texto: '70,12' },
  { x: 135.8, y: -598.5, texto: '70,12' },
  { x: 174.8, y: -598.5, texto: 'Faltas:' },
  { x: 207.8, y: -598.5, texto: '-35,05' },
];

grupo('ponto · formato novo (Normais em decimal)', () => {
  teste('as horas normais vêm do rodapé, em decimal: 70,12 são 70h07', () => {
    const r = interpretarGrade(NORMAIS);
    igual(r.minutosDiurnas, 4207, 'nem 70h12 (4212), nem o 105:00 de Previstas');
    igual(r.minutosNoturnas, null, 'sem noturnas no rodapé não se inventa valor');
  });

  teste('a ordem das células não importa', () => {
    igual(interpretarGrade([...NORMAIS].reverse()).minutosDiurnas, 4207);
  });

  teste('o período escrito com "a" dá a competência', () => {
    const r = interpretarGrade(NORMAIS);
    igual(r.periodo, { inicio: '02/10/2026', fim: '31/10/2026' });
    igual(r.competencia, '2026-10-01');
  });

  teste('nome e CPF continuam casando', () => {
    const r = interpretarGrade(NORMAIS);
    igual(r.nome, 'Ana Vitória de Almeida');
    igual(r.cpf, '11144477735');
  });

  teste('noturnas no rodapé também são lidas em decimal', () => {
    const comNoturnas = [...NORMAIS,
      { x: 250, y: -598.5, texto: 'Noturnas:' },
      { x: 300, y: -598.5, texto: '7,50' },
    ];
    igual(interpretarGrade(comNoturnas).minutosNoturnas, 450);
  });

  teste('sem o rodapé, não lê nada', async () => {
    const semRodape = NORMAIS.filter(c => c.texto !== 'Normais:');
    const e = await lanca(() => interpretarGrade(semRodape));
    ok(String(e.message).includes('sem_total'), e.message);
  });

  teste('rodapé com valor ilegível não pega o total do rótulo seguinte', async () => {
    const semValor = NORMAIS.filter(c => c.texto !== '70,12');
    const e = await lanca(() => interpretarGrade(semValor));
    ok(String(e.message).includes('total_diurnas_ilegivel'), e.message);
  });

  teste('minutosDeHoras aceita os dois formatos', () => {
    igual(minutosDeHoras('48:41'), 2921);
    igual(minutosDeHoras('70,12'), 4207);
    igual(minutosDeHoras('-35,05'), -2103);
    igual(minutosDeHoras('0,00'), 0);
    igual(minutosDeHoras('Falta'), null);
    igual(minutosDeHoras('04:60'), null);
  });
});

grupo('ponto · h:mm', () => {
  teste('lê o formato do relatório', () => {
    igual(minutosDeHhmm('48:41'), 2921);
    igual(minutosDeHhmm('00:00'), 0);
    igual(minutosDeHhmm('161:44'), 9704);
  });

  teste('a coluna de faltas vem negativa', () => {
    igual(minutosDeHhmm('-43:42'), -2622);
  });

  teste('o que não é h:mm devolve null', () => {
    igual(minutosDeHhmm('Total:'), null);
    igual(minutosDeHhmm('-'), null);
    igual(minutosDeHhmm('04:60'), null, 'minuto 60 não existe');
    igual(minutosDeHhmm(''), null);
    igual(minutosDeHhmm(null), null);
  });
});

grupo('ponto · a coluna certa em cada layout', () => {
  teste('layout de 4 colunas: diurnas é 48:41', () => {
    const r = interpretarGrade(DIURNO);
    igual(r.minutosDiurnas, 2921);
    igual(r.minutosNoturnas, null, 'sem coluna de noturnas não se inventa valor');
  });

  teste('layout de 6 colunas: diurnas é 92:45, não 08:13', () => {
    // 08:13 está em x=888 — exatamente onde ficava "Diurnas" no outro layout.
    // É este o erro que a leitura por posição existe para evitar.
    const r = interpretarGrade(NOTURNO);
    igual(r.minutosDiurnas, 5565);
    igual(r.minutosNoturnas, 428, '07:08 de noturnas');
  });

  teste('a ordem das células não importa', () => {
    const embaralhado = [...NOTURNO].reverse();
    igual(interpretarGrade(embaralhado).minutosDiurnas, 5565);
  });

  teste('devolve as colunas que encontrou', () => {
    igual(interpretarGrade(DIURNO).colunas, ['Previstas', 'Diurnas', 'Intervalo', 'Faltas']);
    igual(interpretarGrade(NOTURNO).colunas,
      ['Previstas', 'Diurnas', 'Noturnas', 'Not.Red.', 'Intervalo', 'Faltas']);
  });
});

grupo('ponto · identificação de quem é', () => {
  teste('nome, CPF e período', () => {
    const r = interpretarGrade(DIURNO);
    igual(r.nome, 'Ana Vitória de Almeida');
    igual(r.cpf, '11144477735', 'CPF sem pontuação, para casar com o cadastro');
    igual(r.periodo, { inicio: '01/07/2026', fim: '31/07/2026' });
    igual(r.competencia, '2026-07-01');
  });

  teste('o CPF do cabeçalho, não o do crachá', () => {
    // O relatório repete o CPF como número de crachá, sem pontuação. Se a
    // leitura pegasse o crachá, um dígito diferente já quebraria o casamento.
    igual(interpretarGrade(NOTURNO).cpf, '22255588846');
  });
});

grupo('ponto · falha em vez de chutar', () => {
  teste('sem cabeçalho Diurnas, não lê nada', async () => {
    // Numa folha de pagamento, um número plausível e errado é pior que erro.
    const semColuna = DIURNO.filter(c => c.texto !== 'Diurnas');
    const e = await lanca(() => interpretarGrade(semColuna));
    ok(String(e.message).includes('sem_coluna_diurnas'), e.message);
  });

  teste('sem linha Total, não lê nada', async () => {
    const semTotal = DIURNO.filter(c => c.texto !== 'Total:');
    const e = await lanca(() => interpretarGrade(semTotal));
    ok(String(e.message).includes('sem_total'), e.message);
  });

  teste('total ilegível na coluna certa também falha', async () => {
    const trocado = DIURNO.map(c => (c.x === 888 && c.y === -519 ? { ...c, texto: '-' } : c));
    const e = await lanca(() => interpretarGrade(trocado));
    ok(String(e.message).includes('total_diurnas_ilegivel'), e.message);
  });

  teste('cada falha vira frase de gente', () => {
    for (const [erro, trecho] of [
      ['ponto_pdf_sem_coluna_diurnas', 'Diurnas'],
      ['ponto_pdf_sem_total', 'Total:'],
      ['ponto_pdf_sem_texto', 'digitalizado'],
      ['ponto_pdf_sem_descompressor', 'navegador'],
    ]) {
      const m = traduzirErroPonto(erro);
      ok(m.includes(trecho), `"${erro}" virou "${m}"`);
      ok(!m.includes('_'), 'não repassar o código do erro');
    }
  });
});
