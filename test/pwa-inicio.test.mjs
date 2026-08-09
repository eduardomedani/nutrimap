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
  formatarConsulta, formatarMeta, diasAte,
} from '../js/pwa-inicio-data.js';
import {
  inicioHtml, hojeHtml, progressoHtml, atalhosHtml, linhaHoje, dataLonga, montarDados,
  metasHtml, renderInicioPaciente,
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

  teste('sem consulta agendada, a linha não existe', () => {
    // `null` é resposta legítima do RPC: não há consulta marcada.
    naoContem(html, 'Próxima consulta');
  });

  teste('sem metas, a seção inteira não existe', () => {
    naoContem(html, 'Suas metas');
  });
});

grupo('início · a próxima consulta', () => {
  const consulta = (quando, modalidade = 'presencial') =>
    formatarConsulta({ data_hora: quando, tipo: 'retorno', modalidade }, '2026-08-06');

  teste('data e hora saem no formato do paciente', () => {
    const c = consulta('2026-08-12T14:30:00-03:00');
    igual(c.data, '12/08');
    igual(c.hora, '14:30');
  });

  teste('perto, vira contagem; longe, vira data', () => {
    // "em 3 dias" diz mais que "09/08" para quem abre o app de manhã. Depois
    // de uma semana a contagem perde a graça e a data volta a ser o dado.
    igual(consulta('2026-08-06T09:00:00-03:00').quando, 'hoje');
    igual(consulta('2026-08-07T09:00:00-03:00').quando, 'amanhã');
    igual(consulta('2026-08-09T09:00:00-03:00').quando, 'em 3 dias');
    igual(consulta('2026-09-01T09:00:00-03:00').quando, '');
  });

  teste('online e presencial se distinguem', () => {
    igual(consulta('2026-08-12T14:30:00-03:00', 'online').online, true);
    igual(consulta('2026-08-12T14:30:00-03:00').online, false);
  });

  teste('resposta vazia ou inválida não vira linha', () => {
    igual(formatarConsulta(null, '2026-08-06'), null);
    igual(formatarConsulta({}, '2026-08-06'), null);
    igual(formatarConsulta({ data_hora: 'abacaxi' }, '2026-08-06'), null);
  });

  teste('a linha da consulta NÃO é botão — não há tela de consultas', () => {
    // Um botão que não leva a lugar nenhum é promessa que o toque não cumpre.
    const html = hojeHtml({
      refeicao: null, treino: null,
      consulta: { data: '12/08', hora: '14:30', online: false, quando: 'em 6 dias' },
    });
    contem(html, 'Próxima consulta');
    contem(html, 'in-linha-fixa');
    naoContem(html, '<button');
  });
});

grupo('início · as metas', () => {
  teste('com início e alvo, mostra o percurso', () => {
    const m = formatarMeta({ tipo: 'peso', valor_inicial: 82, valor_alvo: 76, unidade: 'kg', prazo: '2026-09-30' });
    igual(m.nome, 'Peso');
    igual(m.alvo, '82 → 76 kg');
    igual(m.prazo, '30/09/2026');
  });

  teste('só com alvo, mostra só o alvo', () => {
    const m = formatarMeta({ tipo: 'frequencia_treino', valor_alvo: 4, unidade: 'x/semana' });
    igual(m.nome, 'Treinos por semana');
    igual(m.alvo, '4 x/semana');
    igual(m.prazo, '');
  });

  teste('o título do profissional ganha do rótulo do tipo', () => {
    igual(formatarMeta({ tipo: 'habito', titulo: 'Dormir antes das 23h' }).nome, 'Dormir antes das 23h');
    igual(formatarMeta({ tipo: 'habito', titulo: '   ' }).nome, 'Hábito');
  });

  teste('meta sem número nenhum ainda tem nome', () => {
    const m = formatarMeta({ tipo: 'cintura' });
    igual(m.nome, 'Cintura');
    igual(m.alvo, '');
  });

  teste('a lista não oferece nenhum controle de edição', () => {
    // A meta é combinada pelo profissional. Um campo aqui sugeriria que o
    // paciente pode mudar o combinado — não há policy de escrita para ele.
    const html = metasHtml([{ nome: 'Peso', alvo: '82 → 76 kg', prazo: '30/09/2026' }]);
    contem(html, 'Suas metas');
    contem(html, '82 → 76 kg');
    naoContem(html, '<button');
    naoContem(html, '<input');
  });

  teste('lista vazia não deixa um título órfão', () => {
    igual(metasHtml([]), '');
    igual(metasHtml(null), '');
  });
});

grupo('início · a migração não pode vazar nota do profissional', () => {
  const sql = readFileSync(new URL('../db/paciente_inicio_leitura.sql', import.meta.url), 'utf8');
  // Só o corpo executável: os comentários explicam justamente o que não entra,
  // e citam os nomes das colunas proibidas.
  const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  teste('nenhuma das colunas de nota interna é devolvida', () => {
    // Só o que as funções DECLARAM devolver e o que elas selecionam. O bloco de
    // conferência no fim do arquivo cita as colunas proibidas de propósito —
    // ele é a checagem em tempo de execução da mesma regra.
    const corpo = codigo.slice(0, codigo.lastIndexOf('select\n  count(*)'));
    for (const coluna of ['observacoes', 'relato', 'conduta', 'resumo', 'motivo']) {
      naoContem(corpo, coluna);
    }
    ok(corpo.includes('rpc_paciente_metas'), 'o corte não pode engolir a segunda função');
  });

  teste('são funções, não policies de select nas tabelas', () => {
    // RLS filtra linha, não coluna: uma policy liberaria a linha inteira.
    naoContem(codigo, 'create policy');
    contem(codigo, 'security definer');
  });

  teste('as duas filtram pelo paciente da sessão', () => {
    igual(codigo.split('paciente_do_auth()').length - 1, 2);
  });

  teste('anon não executa — o EXECUTE é revogado antes de ser dado', () => {
    igual(codigo.split('revoke all on function').length - 1, 2);
    igual(codigo.split('to authenticated;').length - 1, 2);
  });

  teste('existe o desfazer, e ele derruba as duas', () => {
    const undo = readFileSync(new URL('../db/paciente_inicio_leitura_desfazer.sql', import.meta.url), 'utf8');
    contem(undo, 'drop function if exists public.rpc_paciente_proxima_consulta()');
    contem(undo, 'drop function if exists public.rpc_paciente_metas()');
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

  teste('a seção nunca fica vazia — Documentos é permanente', () => {
    // Antes ela sumia inteira sem treino nem dieta. Agora Documentos é módulo
    // permanente e sempre ocupa uma linha, então "Acesso rápido" sempre tem
    // pelo menos um destino de verdade — nada de título sobre o nada.
    const so = atalhosHtml({ temTreino: false, temDieta: false });
    contem(so, 'Acesso rápido');
    contem(so, 'data-ir="documentos"');
    naoContem(so, 'data-ir="treino"');
    naoContem(so, 'data-ir="dieta"');
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
    querySelector: () => null,
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

  teste('a tela pinta ANTES de o treino chegar', async () => {
    // O app ficava em "Abrindo..." esperando treinos -> itens -> progressão,
    // três idas à rede encadeadas, para só então desenhar. O nome já basta.
    const cx = alvo();
    let liberar;
    const treino = new Promise(r => { liberar = r; });

    const pronto = renderInicioPaciente(cx, BRUTO, {
      treino,
      carregarDieta: async () => null,
      carregarConsulta: async () => null,
      carregarMetas: async () => [],
    });

    contem(cx.innerHTML, 'Bom dia, Eduardo');       // já desenhou
    contem(cx.innerHTML, 'Treino do dia');
    contem(cx.innerHTML, 'in-sk');                  // em esqueleto

    liberar({ dias: ['A', 'B'], proximo: 'B', datasTreinadas: ['2026-08-05'] });
    await pronto;
    contem(cx.innerHTML, 'Treino B');
    naoContem(cx.innerHTML, 'in-sk');
  });

  teste('enquanto carrega, o progresso não mente zero', async () => {
    // "0 dias" piscando antes de virar "3 dias" afirma algo falso sobre o
    // esforço de quem está olhando.
    const cx = alvo();
    const treino = new Promise(() => {});          // nunca resolve
    renderInicioPaciente(cx, BRUTO, {
      treino,
      carregarDieta: async () => null,
      carregarConsulta: async () => null,
      carregarMetas: async () => [],
    });
    contem(cx.innerHTML, 'in-sk-num');
    naoContem(cx.innerHTML, '0 <small>dias</small>');
    naoContem(cx.innerHTML, '0 <small>treinos</small>');
  });

  teste('sem promessa de treino, nada fica em esqueleto à toa', async () => {
    const cx = alvo();
    await renderInicioPaciente(cx, { ...BRUTO, dias: ['A'], proximo: 'A' }, {
      carregarDieta: async () => null,
      carregarConsulta: async () => null,
      carregarMetas: async () => [],
    });
    naoContem(cx.innerHTML, 'in-sk');
    contem(cx.innerHTML, 'Treino A');
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

  teste('com TUDO falhando, a tela diz que não carregou — não que não há nada', async () => {
    // "Nada programado ainda" com a rede fora afirma sobre o plano do paciente
    // uma coisa que a tela não sabe.
    const cx = alvo();
    const err = console.error;
    console.error = () => {};
    try {
      await renderInicioPaciente(cx, BRUTO, {
        treino: Promise.reject(new Error('rede')),
        carregarDieta: async () => { throw new Error('rede'); },
        carregarConsulta: async () => { throw new Error('rede'); },
        carregarMetas: async () => { throw new Error('rede'); },
      });
    } finally { console.error = err; }
    contem(cx.innerHTML, 'Não foi possível carregar');
    contem(cx.innerHTML, 'Tentar novamente');
    naoContem(cx.innerHTML, 'Nada programado ainda');
  });

  teste('uma fonte de pé já basta para a tela normal aparecer', async () => {
    const cx = alvo();
    const err = console.error;
    console.error = () => {};
    try {
      await renderInicioPaciente(cx, BRUTO, {
        treino: Promise.resolve({ dias: ['A'], proximo: 'A', datasTreinadas: [] }),
        carregarDieta: async () => { throw new Error('rede'); },
        carregarConsulta: async () => { throw new Error('rede'); },
        carregarMetas: async () => { throw new Error('rede'); },
      });
    } finally { console.error = err; }
    naoContem(cx.innerHTML, 'Não foi possível carregar');
    contem(cx.innerHTML, 'Treino A');
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
    // A reserva não mora mais aqui: é da casca, em --pa-nav-reserva. Esta
    // folha só não pode reabrir uma segunda — ver o grupo da barra inferior.
    const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
    contem(shell, 'padding: 18px 16px var(--pa-nav-reserva);');
    ok(!/padding-bottom/.test(css.slice(0, css.indexOf('.inicio .pa-hero'))),
       'reserva declarada aqui volta a somar com a da casca');
  });

  teste('quem pediu menos movimento não recebe animação', () => {
    contem(css, '@media (prefers-reduced-motion: reduce)');
  });
});

grupo('início · o topo não rouba meia tela', () => {
  const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/pwa-inicio.css', import.meta.url), 'utf8');

  teste('a topbar usa MAX do inset, não SOMA', () => {
    // Somar dava folga em cima de folga: 55px viravam 102px no iPhone, em
    // TODAS as telas. O inset já é a distância que afasta da barra de status.
    contem(shell, 'padding: max(12px, env(safe-area-inset-top)) 18px 12px');
    naoContem(shell, 'padding: calc(12px + env(safe-area-inset-top)) 18px 12px');
  });

  teste('o hero do Início não tem título estático', () => {
    // "Hoje" era palavra fixa em corpo 27 — manchete para informação zero.
    const html = inicioHtml({ saudacao: 'Bom dia', nome: 'Eduardo', hoje: '2026-08-06', treino: null, refeicao: null });
    naoContem(html, '<div class="pa-hero-title">Hoje</div>');
    contem(html, 'Bom dia, Eduardo');
    contem(html, 'Quinta-feira, 6 de agosto');
  });

  teste('o hero compacto é só do Início — o do Treino não muda', () => {
    // No Treino o título diz "Vamos treinar?" ou "Mandou bem!": informação.
    contem(css, '.inicio .pa-hero');
    ok(!/^\.pa-hero \{/m.test(css), 'o Início não pode redefinir o hero global');
  });
});

grupo('início · a barra inferior encosta no fim da TELA', () => {
  const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const inicioCss = readFileSync(new URL('../css/pwa-inicio.css', import.meta.url), 'utf8');
  const dietaCss = readFileSync(new URL('../css/pwa-dieta.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');

  // Só a regra da barra, para as asserções não pegarem env() de outra tela.
  const regraNav = shell.slice(shell.indexOf('.pa-bottomnav {'));
  const corpoNav = regraNav.slice(0, regraNav.indexOf('}') + 1);

  teste('a barra pertence à viewport, não ao fluxo da página', () => {
    // Dashboard curto, dieta longa, estado vazio, loading, erro: a posição não
    // pode depender de quanto conteúdo existe acima.
    contem(corpoNav, 'position: fixed');
    contem(corpoNav, 'bottom: 0');
    contem(corpoNav, 'left: 0');
    contem(corpoNav, 'right: 0');
    ok(!/position:\s*(absolute|sticky)/.test(corpoNav),
       'absolute ou sticky prendem a barra ao conteúdo');
  });

  teste('não sobrou spacer artificial abaixo da barra', () => {
    // Eram 80px pintados com a cor da própria barra logo abaixo dela. Onde o
    // fim do viewport não é o fim da tela, viravam a faixa vazia que fazia o
    // menu parecer boiando no meio da tela.
    naoContem(shell, '.pa-bottomnav::after');
    naoContem(shell, '.pa-bottomnav::before');
    ok(!/\.pa-bottomnav[^{]*\{[^}]*margin-bottom/.test(shell),
       'margem embaixo da barra é vão artificial');
    ok(!/\.pa-bottomnav[^{]*\{[^}]*bottom:\s*-/.test(shell),
       'bottom negativo é valor mágico, não correção');
  });

  teste('a safe-area é contada UMA vez, e é na barra', () => {
    // Contar duas vezes (body + barra, ou barra + conteúdo dela) é o que
    // empurra o menu para cima e abre a faixa embaixo.
    igual((corpoNav.match(/env\(safe-area-inset-bottom/g) || []).length, 2,
          'uma na altura mínima, uma no padding — e nada além disso');
    contem(corpoNav, 'padding-bottom: env(safe-area-inset-bottom, 0px);');
    // `[\s;{]` antes: sem isso o próprio `padding-bottom:` casaria com o
    // padrão e a guarda acusaria a regra certa.
    ok(!/[\s;{]bottom:\s*env\(safe-area-inset-bottom/.test(corpoNav),
       'bottom: env(...) junto com padding-bottom: env(...) aplica o inset duas vezes');

    const regraBody = shell.slice(shell.indexOf('  body {'));
    ok(!regraBody.slice(0, regraBody.indexOf('}')).includes('safe-area-inset-bottom'),
       'o body não move uma barra fixed — só cria tira morta e dobra o inset');
  });

  teste('sem inset, a barra encosta sozinha — nada de altura de iPhone', () => {
    // Android e desktop: env() vale 0 e a barra fica rente ao fim da tela.
    contem(corpoNav, 'env(safe-area-inset-bottom, 0px)');
    ok(!/\b(34|44|83)px\b/.test(corpoNav),
       'altura de um modelo específico de iPhone não pode virar constante');
  });

  teste('a área útil é compacta: entre 64 e 72px, fora a safe-area', () => {
    const m = shell.match(/--pa-nav-h:\s*(\d+)px/);
    ok(m, 'a altura da barra tem que ser uma variável, não número solto');
    const h = Number(m[1]);
    ok(h >= 64 && h <= 72, `área útil de ${h}px — fora da faixa 64–72px`);
    contem(corpoNav, 'min-height: calc(var(--pa-nav-h) + env(safe-area-inset-bottom, 0px));');
  });

  teste('ícone e rótulo ficam centralizados no item', () => {
    const item = shell.slice(shell.indexOf('.pa-nav-item {'));
    const corpo = item.slice(0, item.indexOf('}') + 1);
    contem(corpo, 'justify-content: center');
    contem(corpo, 'align-items: center');
    contem(corpo, 'flex-direction: column');
  });

  teste('o conteúdo reserva espaço, e a reserva sai da MESMA variável', () => {
    // O último cartão precisa poder rolar acima da barra sem ficar escondido.
    contem(shell, '--pa-nav-reserva: calc(var(--pa-nav-h) + env(safe-area-inset-bottom, 0px) + 16px);');
    contem(shell, '.pa-main { max-width: 620px; margin: 0 auto; padding: 18px 16px var(--pa-nav-reserva); }');
    ok(!/\.pa-main \{[^}]*96px/.test(shell),
       'reserva em número solto descola da barra no primeiro ajuste');
  });

  teste('a reserva mora em UM lugar — nenhuma tela declara a sua', () => {
    // O vão nascia disto: casca e folha reservando o mesmo espaço, e um
    // `:has()` para cancelar uma delas. Duas fontes para o mesmo número.
    for (const [nome, css] of [['pwa-inicio.css', inicioCss], ['pwa-dieta.css', dietaCss]]) {
      ok(!/^\s*(\.inicio|\.dt)\s*\{[^}]*padding-bottom/m.test(css),
         `${nome} não pode declarar a própria reserva`);
      ok(!css.includes('main.pa-main:has('),
         `${nome} zerando a reserva da casca é sinal de reserva duplicada`);
    }
  });

  teste('Início, Treino e Dieta usam a MESMA barra', () => {
    // Uma fonte de verdade: bottomNav(). Nada de .inicio-bottomnav.
    //
    // A conferência compara as DUAS contagens entre si, e não com um número
    // fixo: o invariante é "toda tela que pinta a casca tem a barra", não
    // "existem N telas". Fixar o número faz a guarda quebrar na próxima tela
    // que nascer — foi o que aconteceu quando Documentos virou a sexta — e uma
    // guarda que grita por crescimento normal é uma guarda que se aprende a
    // desligar.
    const telas = (ui.match(/<main class="pa-main/g) || []).length;
    const barras = (ui.match(/\$\{bottomNav\(\)\}/g) || []).length;
    ok(telas >= 5, `só achei ${telas} telas — o app do aluno tem mais que isso`);
    igual(barras, telas,
          'toda tela do app do aluno monta a barra pelo mesmo componente');
    igual((ui.match(/class="pa-bottomnav"/g) || []).length, 1,
          'a marcação da barra existe em um lugar só');
    for (const css of [inicioCss, dietaCss]) {
      ok(!/bottomnav|bottom-nav/i.test(css), 'nenhuma tela redefine a barra por conta própria');
    }
  });

  teste('as telas de altura cheia usam dvh, com vh de reserva', () => {
    // No Safari 100vh é sempre a altura MAIOR, com a barra dinâmica recolhida.
    contem(shell, 'min-height: 100vh; min-height: 100dvh;');
    contem(shell, 'min-height: 80vh; min-height: 80dvh;');
  });

  teste('o viewport declara viewport-fit=cover, uma vez só', () => {
    // Sem isso o iOS não informa env(safe-area-inset-*) nenhum.
    contem(shell, 'viewport-fit=cover');
    igual((shell.match(/name="viewport"/g) || []).length, 1);
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
