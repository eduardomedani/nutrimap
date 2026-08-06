// ═══════════════════════════════════════════════════════════
// PWA · INÍCIO — a tela de abertura do app do aluno
// ═══════════════════════════════════════════════════════════
// Como no teste da dieta, a marcação é GERADA aqui e conferida como marcação,
// não procurada como palavra no fonte.
//
// O que estes testes protegem, além do desenho: que a tela não prometa o que o
// banco não tem. Água, check-in, peso e aderência à dieta não existem em
// nenhum schema — e um painel que mostra "Água: 0 de 2,5 L" fixo ensina o
// paciente a não acreditar em número nenhum da tela.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  inicioDaSemana, somarDias, treinosNaSemana, proximaRefeicaoDoDia, treinoDoDia,
} from '../js/pwa-inicio-data.js';
import {
  inicioHtml, hojeHtml, progressoHtml, atalhosHtml, linhaHoje, dataLonga, montarDados,
  renderInicioPaciente,
} from '../js/pwa-inicio-ui.js';

const css = readFileSync(new URL('../css/pwa-inicio.css', import.meta.url), 'utf8');
const casca = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');

// 2026-08-03 é uma segunda; 2026-08-06, quinta; 2026-08-09, domingo.
const REFEICOES = [
  { id: 'r1', nome: 'Café da manhã', horario: '07:00' },
  { id: 'r2', nome: 'Almoço',        horario: '12:00' },
  { id: 'r3', nome: 'Jantar',        horario: '19:30' },
  { id: 'r4', nome: 'Ceia',          horario: null    },
];

// ───────────────────────────────────────────────────────────
grupo('início · a semana do paciente', () => {
  teste('a semana começa na segunda, não no domingo', () => {
    // O aluno conta "treinei 3 vezes essa semana" da segunda ao domingo.
    igual(inicioDaSemana('2026-08-06'), '2026-08-03');
    igual(inicioDaSemana('2026-08-03'), '2026-08-03');
  });

  teste('domingo ainda pertence à semana que começou na segunda anterior', () => {
    // O erro clássico: getDay() devolve 0 no domingo e joga o dia para a
    // semana seguinte, zerando a contagem justo no fim de semana.
    igual(inicioDaSemana('2026-08-09'), '2026-08-03');
    igual(inicioDaSemana('2026-08-10'), '2026-08-10');
  });

  teste('data inválida não derruba a conta', () => {
    igual(inicioDaSemana('abacaxi'), null);
    igual(inicioDaSemana(''), null);
    igual(inicioDaSemana(null), null);
    igual(treinosNaSemana(['2026-08-04'], 'abacaxi'), 0);
  });

  teste('somarDias anda dentro do mês e para fora dele', () => {
    igual(somarDias('2026-08-03', 6), '2026-08-09');
    igual(somarDias('2026-07-31', 1), '2026-08-01');
  });
});

grupo('início · treinos da semana', () => {
  teste('conta DIAS, não registros', () => {
    // 12 exercícios registrados na segunda são um treino, não doze.
    igual(treinosNaSemana(['2026-08-03', '2026-08-03', '2026-08-03'], '2026-08-06'), 1);
  });

  teste('o que é de outra semana não entra', () => {
    const datas = ['2026-07-31', '2026-08-03', '2026-08-05', '2026-08-10'];
    igual(treinosNaSemana(datas, '2026-08-06'), 2);
  });

  teste('domingo entra na conta da própria semana', () => {
    igual(treinosNaSemana(['2026-08-09'], '2026-08-06'), 1);
  });

  teste('sem treino nenhum, é zero — não é erro', () => {
    igual(treinosNaSemana([], '2026-08-06'), 0);
    igual(treinosNaSemana(null, '2026-08-06'), 0);
  });
});

grupo('início · a próxima refeição', () => {
  teste('é a primeira que ainda não começou', () => {
    const r = proximaRefeicaoDoDia(REFEICOES, '08:30');
    igual(r.nome, 'Almoço');
    igual(r.horario, '12:00');
    igual(r.amanha, false);
  });

  teste('depois da última do dia, mostra a primeira de amanhã', () => {
    // Às 23h o que interessa é o café das 7h. Devolver null deixaria a linha
    // vazia e a tela com cara de quebrada.
    const r = proximaRefeicaoDoDia(REFEICOES, '23:00');
    igual(r.nome, 'Café da manhã');
    igual(r.amanha, true);
  });

  teste('refeição sem horário não vira "próxima"', () => {
    // A ceia não tem hora: ela não pode ganhar de quem tem.
    const r = proximaRefeicaoDoDia(REFEICOES, '20:00');
    igual(r.nome, 'Café da manhã');
    ok(r.horario !== null, 'a próxima precisa ter horário');
  });

  teste('plano sem nenhum horário não tem próxima', () => {
    igual(proximaRefeicaoDoDia([{ id: 'x', nome: 'Ceia', horario: null }], '10:00'), null);
    igual(proximaRefeicaoDoDia([], '10:00'), null);
  });
});

grupo('início · o treino do dia', () => {
  teste('sem dias cadastrados, não há treino do dia', () => {
    igual(treinoDoDia({ dias: [] }), null);
    igual(treinoDoDia({}), null);
  });

  teste('quem ainda não treinou vê o próximo sugerido', () => {
    const t = treinoDoDia({ dias: ['A', 'B', 'C'], proximo: 'B', treinadoHoje: null });
    igual(t.dia, 'B');
    igual(t.feito, false);
  });

  teste('quem já treinou hoje vê o que fez, e o que vem depois', () => {
    const t = treinoDoDia({ dias: ['A', 'B', 'C'], proximo: 'C', treinadoHoje: 'B' });
    igual(t.dia, 'B');
    igual(t.feito, true);
    igual(t.proximo, 'C');
  });
});

grupo('início · a tela', () => {
  const DADOS = {
    saudacao: 'Bom dia', nome: 'Eduardo', hoje: '2026-08-06',
    refeicao: { nome: 'Almoço', horario: '12:00', amanha: false },
    treino: { dia: 'E', feito: false, proximo: null },
    exercicios: 7, grupos: 'Peito · Tríceps',
    sequencia: 3, recordes: 2, semana: 4,
    temTreino: true, temDieta: true,
  };
  const html = inicioHtml(DADOS);

  teste('cumprimenta pelo primeiro nome', () => {
    contem(html, 'Bom dia, Eduardo');
  });

  teste('a data aparece por extenso, sem o ano', () => {
    contem(html, 'Quinta');
    naoContem(html, '2026');
  });

  teste('a próxima refeição aparece com nome e hora', () => {
    contem(html, 'Próxima refeição');
    contem(html, 'Almoço · 12:00');
  });

  teste('o treino do dia aparece com o que tem dentro', () => {
    contem(html, 'Treino do dia');
    contem(html, 'Treino E');
    contem(html, '7 exercícios');
  });

  teste('cada linha do bloco Hoje é um botão que leva a algum lugar', () => {
    // Uma <div> com onclick não se anuncia como navegável para o leitor de tela.
    contem(html, '<button class="in-linha" type="button" data-ir="dieta"');
    contem(html, '<button class="in-linha" type="button" data-ir="treino"');
  });

  teste('NADA de água, check-in, peso ou aderência', () => {
    // Nenhum dos quatro existe no banco. Enquanto não existir, a tela não
    // finge que existe — nem com traço, nem com zero, nem com "em breve".
    for (const proibido of ['Água', 'gua:', 'Check-in', 'check-in', 'Registrar peso', 'Aderência', 'em breve']) {
      naoContem(html, proibido);
    }
  });

  teste('nenhuma consulta ou meta, que o paciente não tem permissão de ler', () => {
    // consultas_select e paciente_metas_select são `nutri_id = auth.uid()`:
    // pelo app do paciente as duas voltam vazias.
    naoContem(html, 'consulta');
    naoContem(html, 'Meta');
  });
});

grupo('início · o que ainda não carregou', () => {
  teste('a refeição desconhecida vira esqueleto, não linha vazia', () => {
    const html = hojeHtml({ refeicao: undefined, treino: { dia: 'A', feito: false } });
    contem(html, 'in-sk');
    contem(html, 'Próxima refeição');
  });

  teste('o esqueleto não é clicável nem é anunciado', () => {
    const html = linhaHoje({ rotulo: 'Próxima refeição', carregando: true });
    naoContem(html, '<button');
    contem(html, 'aria-hidden="true"');
  });

  teste('sem dieta, a linha da refeição simplesmente não existe', () => {
    // `null` (buscou e não há plano) é diferente de `undefined` (ainda buscando).
    const html = hojeHtml({ refeicao: null, treino: { dia: 'A', feito: false } });
    naoContem(html, 'Próxima refeição');
    contem(html, 'Treino do dia');
  });

  teste('sem treino e sem dieta, a tela diz isso em vez de ficar vazia', () => {
    const html = inicioHtml({ saudacao: 'Boa noite', nome: 'Ana', refeicao: null, treino: null });
    contem(html, 'Nada programado ainda');
  });
});

grupo('início · progresso e atalhos', () => {
  teste('são três números, e todos existem no banco', () => {
    const html = progressoHtml({ sequencia: 3, recordes: 2, semana: 4 });
    contem(html, 'Sequência');
    contem(html, 'Na semana');
    contem(html, 'Recordes');
    naoContem(html, 'Peso');
    naoContem(html, 'Aderência');
  });

  teste('singular e plural conforme o número', () => {
    contem(progressoHtml({ sequencia: 1, semana: 1 }), '1 <small>dia</small>');
    contem(progressoHtml({ sequencia: 1, semana: 1 }), '1 <small>treino</small>');
    contem(progressoHtml({ sequencia: 2, semana: 3 }), '2 <small>dias</small>');
    contem(progressoHtml({ sequencia: 2, semana: 3 }), '3 <small>treinos</small>');
  });

  teste('só entra atalho que chega a uma tela que existe', () => {
    const html = atalhosHtml({ temTreino: true, temDieta: true });
    contem(html, 'Iniciar treino');
    contem(html, 'Ver dieta');
    naoContem(html, 'Responder check-in');
    naoContem(html, 'Registrar peso');
  });

  teste('sem dieta publicada, não se oferece "Ver dieta"', () => {
    const html = atalhosHtml({ temTreino: true, temDieta: false });
    contem(html, 'Iniciar treino');
    naoContem(html, 'Ver dieta');
  });

  teste('sem nada para onde ir, a seção inteira some', () => {
    igual(atalhosHtml({ temTreino: false, temDieta: false }), '');
  });
});

grupo('início · a casca entrega matéria-prima, o módulo faz a conta', () => {
  teste('montarDados deriva treino do dia e treinos da semana', () => {
    const d = montarDados({
      saudacao: 'Boa tarde', nome: 'Eduardo', hoje: '2026-08-06',
      dias: ['A', 'B'], proximo: 'B', treinadoHoje: null,
      datasTreinadas: ['2026-08-03', '2026-08-05', '2026-07-30'],
    });
    igual(d.treino.dia, 'B');
    igual(d.semana, 2);
    igual(d.temTreino, true);
  });

  teste('paciente sem treino nenhum não trava a tela', () => {
    const d = montarDados({ hoje: '2026-08-06', dias: [], datasTreinadas: [] });
    igual(d.treino, null);
    igual(d.temTreino, false);
    igual(d.semana, 0);
  });

  teste('o Início é a terceira aba, e a primeira da barra', () => {
    // Conferido no fonte da casca porque `bottomNav` não é exportada.
    const nav = casca.slice(casca.indexOf('function bottomNav'), casca.indexOf('function bottomNav') + 420);
    ok(nav.indexOf("'inicio'") < nav.indexOf("'treino'"), 'Início vem antes de Treino na barra');
    ok(nav.includes("'dieta'"), 'Dieta continua na barra');
  });

  teste('o app abre no Início', () => {
    contem(casca, "let _secao    = 'inicio'");
    contem(casca, 'renderInicio();');
  });

  teste('Início e Treino leem a MESMA carga de dados', () => {
    // Duas buscas separadas viram duas verdades no dia em que uma mudar.
    contem(casca, 'async function carregarTreino()');
    ok(casca.split('await meusTreinos(').length === 2, 'meusTreinos é chamado num lugar só');
  });
});

grupo('início · a montagem, com a dieta chegando depois', () => {
  // Alvo de mentira: só precisa guardar o innerHTML e não ter filhos.
  const alvo = () => ({
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelectorAll: () => [],
  });
  const BRUTO = { saudacao: 'Bom dia', nome: 'Eduardo', hoje: '2026-08-06', dias: ['A'], proximo: 'A' };

  teste('a primeira pintura já mostra o treino, com a refeição em esqueleto', async () => {
    const cx = alvo();
    const espera = new Promise(r => setTimeout(r, 0));
    renderInicioPaciente(cx, BRUTO, { carregarDieta: async () => { await espera; return null; } });
    await Promise.resolve();
    contem(cx.innerHTML, 'Treino A');
    contem(cx.innerHTML, 'in-sk');
  });

  teste('plano SEM horário nenhum ainda oferece o atalho da dieta', async () => {
    // O bug que isto tranca: amarrar o atalho à "próxima refeição" fazia a
    // dieta sumir do Início de quem tem plano sem horários.
    const cx = alvo();
    const dieta = { refeicoes: [{ id: 'x', nome: 'Ceia', horario: null }] };
    await renderInicioPaciente(cx, BRUTO, { carregarDieta: async () => dieta, agora: '10:00' });
    naoContem(cx.innerHTML, 'Próxima refeição');
    contem(cx.innerHTML, 'Ver dieta');
  });

  teste('com horário, a linha aparece e o atalho também', async () => {
    const cx = alvo();
    const dieta = { refeicoes: REFEICOES };
    await renderInicioPaciente(cx, BRUTO, { carregarDieta: async () => dieta, agora: '08:30' });
    contem(cx.innerHTML, 'Almoço · 12:00');
    contem(cx.innerHTML, 'Ver dieta');
  });

  teste('dieta que falha não derruba o resto da tela', async () => {
    const cx = alvo();
    const err = console.error;
    console.error = () => {};      // o módulo loga de propósito; aqui é ruído
    try {
      await renderInicioPaciente(cx, BRUTO, { carregarDieta: async () => { throw new Error('rede'); } });
    } finally { console.error = err; }
    contem(cx.innerHTML, 'Treino A');
    contem(cx.innerHTML, 'Iniciar treino');
    naoContem(cx.innerHTML, 'Ver dieta');
    naoContem(cx.innerHTML, 'in-sk');       // o esqueleto não pode ficar preso
  });

  teste('paciente sem plano não vê atalho de dieta', async () => {
    const cx = alvo();
    await renderInicioPaciente(cx, BRUTO, { carregarDieta: async () => null });
    naoContem(cx.innerHTML, 'Ver dieta');
    contem(cx.innerHTML, 'Iniciar treino');
  });
});

grupo('início · o CSS', () => {
  teste('nenhuma cor literal — a identidade é a do Evollo', () => {
    const cores = css.match(/#[0-9a-f]{3,8}\b/gi) || [];
    igual(cores, [], `cor literal no CSS do início: ${cores.join(', ')}`);
  });

  teste('a barra inferior não cobre o último atalho', () => {
    contem(css, 'var(--pa-nav-h');
    contem(css, 'env(safe-area-inset-bottom');
  });

  teste('a reserva da casca é zerada, para as duas não se somarem', () => {
    // O bug que a dieta teve: 96px da casca + 73px da folha = vão de 112px.
    contem(css, 'main.pa-main:has(.inicio) { padding-bottom: 0; }');
  });

  teste('quem pediu menos movimento não recebe animação', () => {
    contem(css, '@media (prefers-reduced-motion: reduce)');
  });
});

grupo('início · datas por extenso', () => {
  teste('primeira letra maiúscula, sem ano', () => {
    igual(dataLonga('2026-08-06'), 'Quinta-feira, 6 de agosto');
  });

  teste('lixo não vira "Invalid Date" na tela', () => {
    igual(dataLonga('abacaxi'), '');
    igual(dataLonga(null), '');
  });
});
