// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — o que a tela do aluno mostra em cada horário
// ═══════════════════════════════════════════════════════════
// A tela só MOSTRA; quem aceita ou recusa é o banco (db/agenda_treino.sql).
// Mas mostrar errado também é defeito: botão "Reservar" num horário lotado,
// ou "Desmarcar" depois do prazo, vira toque que dá erro.

import { grupo, teste, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { estadoDoHorario, agruparPorDia, horariosVisiveis } from '../js/pwa-agenda-ui.js';

const ctx = (o = {}) => ({ agora: '2026-11-10T10:00:00', abre_dias_antes: 2, cancela_horas_antes: 1, limite: 3, usados: 2, ...o });
const h = (o = {}) => ({ grade_id: 'g', data: '2026-11-11', hora: '18:00', duracao_min: 60, capacidade: 9, ocupados: 4, meu: null, ...o });

grupo('agenda · estado de cada horário', () => {
  teste('horário livre, dentro da janela e com saldo: reservar', () => igual(estadoDoHorario(h(), ctx()), 'reservar'));
  teste('horário que já passou', () => igual(estadoDoHorario(h({ data: '2026-11-10', hora: '09:00' }), ctx()), 'passou'));
  teste('lotado', () => igual(estadoDoHorario(h({ ocupados: 9 }), ctx()), 'lotado'));
  teste('fora da janela de 2 dias: abre depois', () => igual(estadoDoHorario(h({ data: '2026-11-13' }), ctx()), 'abre'));
  teste('no limite da janela (hoje + 2) ainda abre', () => igual(estadoDoHorario(h({ data: '2026-11-12' }), ctx()), 'reservar'));
  teste('SEMANA COMPLETA: sem saldo do plano', () => igual(estadoDoHorario(h(), ctx({ usados: 3 })), 'sem_saldo'));
  teste('SEM PLANO não é semana completa (limite 0)', () => {
    igual(estadoDoHorario(h(), ctx({ limite: 0, usados: 0 })), 'sem_plano');
    igual(estadoDoHorario(h(), ctx({ limite: null, usados: 0 })), 'sem_plano');
    igual(estadoDoHorario(h({ ocupados: 9 }), ctx({ limite: 0 })), 'lotado', 'lotado continua lotado');
  });
  teste('meu fixo com prazo: desmarcar', () => igual(estadoDoHorario(h({ meu: 'fixo' }), ctx()), 'desmarcar'));
  teste('minha reserva a menos de 1h: prazo encerrado', () =>
    igual(estadoDoHorario(h({ meu: 'reserva', data: '2026-11-10', hora: '10:30' }), ctx()), 'prazo'));
  teste('exatamente 1h antes ainda desmarca', () =>
    igual(estadoDoHorario(h({ meu: 'fixo', data: '2026-11-10', hora: '11:00' }), ctx()), 'desmarcar'));
  teste('fixo desmarcado, com vaga e saldo: voltar', () => igual(estadoDoHorario(h({ meu: 'desmarcado' }), ctx()), 'voltar'));
  teste('fixo desmarcado mas lotado: lotado', () => igual(estadoDoHorario(h({ meu: 'desmarcado', ocupados: 9 }), ctx()), 'lotado'));
  teste('meu horário lotado continua "desmarcar" (a vaga é minha)', () => igual(estadoDoHorario(h({ meu: 'fixo', ocupados: 9 }), ctx()), 'desmarcar'));
});

grupo('agenda · tela', () => {
  teste('agrupa por dia, na ordem que veio', () => {
    const r = agruparPorDia([h({ data: '2026-11-11', hora: '06:00' }), h({ data: '2026-11-11' }), h({ data: '2026-11-12' })]);
    igual(r.map(d => [d.data, d.lista.length]), [['2026-11-11', 2], ['2026-11-12', 1]]);
  });

  teste('horário encerrado some, a não ser que fosse meu', () => {
    const r = horariosVisiveis([
      h({ data: '2026-11-09', hora: '18:00' }),
      h({ data: '2026-11-09', hora: '19:00', meu: 'fixo' }),
      h({ data: '2026-11-10', hora: '09:00', meu: 'desmarcado' }),
      h({ data: '2026-11-10', hora: '18:00' }),
    ], ctx());
    igual(r.map(x => x.data + ' ' + x.hora), ['2026-11-09 19:00', '2026-11-10 18:00']);
  });

  teste('desmarcar pede confirmação NUM CARTÃO; regra mostrada é a que veio do servidor', () => {
    const ui = readFileSync(new URL('../js/pwa-agenda-ui.js', import.meta.url), 'utf8');
    contem(ui, "if (acao === 'desmarcar' && !(await cartao(m.confirmarDesmarque))) return;");
    contem(ui, 'A reserva abre ${s.abre_dias_antes} dia(s) antes.');
  });

  teste('toda resposta é cartão com OK — nada de toast que some sozinho', () => {
    const ui = readFileSync(new URL('../js/pwa-agenda-ui.js', import.meta.url), 'utf8');
    igual(/mostrarToast|confirmar\(/.test(ui), false);
    contem(ui, 'role="alertdialog"');
    // O fundo não fecha o cartão: só o botão (o OK é "li").
    igual(/fundo\.addEventListener\('click'/.test(ui), false);
  });

  teste('o aluno só fala com as funções do banco (nenhuma tabela direto)', () => {
    const dados = readFileSync(new URL('../js/pwa-agenda-data.js', import.meta.url), 'utf8');
    contem(dados, "sb.rpc('agenda_aluno_semana'");
    contem(dados, "sb.rpc('agenda_aluno_reservar'");
    contem(dados, "sb.rpc('agenda_aluno_desmarcar'");
    igual(/sb\.from\(/.test(dados), false);
  });
});

import { inicioDaSemana, marcasDosDias, casasDoMes, sentidoDoDeslize } from '../js/pwa-agenda-ui.js';

grupo('agenda · dia a dia e mês', () => {
  teste('a semana começa na segunda (domingo é o fim, não o começo)', () => {
    igual(inicioDaSemana('2026-11-10'), '2026-11-09');
    igual(inicioDaSemana('2026-11-09'), '2026-11-09');
    igual(inicioDaSemana('2026-11-15'), '2026-11-09', 'domingo');
    igual(inicioDaSemana('2026-11-01'), '2026-10-26', 'atravessa o mês');
  });

  teste('bolinha: treino vence desmarcado no mesmo dia; dia sem nada fica sem', () => {
    const m = marcasDosDias([
      h({ data: '2026-11-10', meu: 'desmarcado' }),
      h({ data: '2026-11-10', hora: '19:00', meu: 'reserva' }),
      h({ data: '2026-11-11', meu: 'desmarcado' }),
      h({ data: '2026-11-12', meu: 'fixo' }),
      h({ data: '2026-11-13' }),
    ]);
    igual([...m.entries()], [['2026-11-10', 'treino'], ['2026-11-11', 'desmarcado'], ['2026-11-12', 'treino']]);
  });

  teste('fim do contrato: o banco não manda `meu`, então não há bolinha', () => {
    igual(marcasDosDias([h({ data: '2026-12-20', meu: null })]).size, 0);
  });

  teste('novembro de 2026: começa na segunda 26/10, termina no domingo 06/12', () => {
    const c = casasDoMes(2026, 11);
    igual([c[0].data, c.at(-1).data, c.length % 7], ['2026-10-26', '2026-12-06', 0]);
    igual(c.filter(x => x.doMes).length, 30);
  });

  teste('fevereiro e virada de ano', () => {
    igual(casasDoMes(2027, 2).filter(x => x.doMes).length, 28);
    igual(casasDoMes(2026, 12).at(-1).data, '2027-01-03');
  });

  teste('deslize: 50px na horizontal troca; rolagem vertical não', () => {
    igual(sentidoDoDeslize(-80, 10), 1, 'para a esquerda = próximo dia');
    igual(sentidoDoDeslize(80, 10), -1, 'para a direita = dia anterior');
    igual(sentidoDoDeslize(-40, 0), 0, 'curto demais');
    igual(sentidoDoDeslize(-80, 70), 0, 'era rolagem na diagonal');
  });

  teste('dia selecionado: texto claro sobre o verde passa de 4,5:1', () => {
    const tokens = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
    const hex = n => tokens.match(new RegExp(`${n}:\\s*(#[0-9A-Fa-f]{6})`))[1];
    const lum = hx => { const [r, g, b] = hx.slice(1).match(/\w\w/g).map(x => { let v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [a, b] = [lum(hex('--surface')), lum(hex('--color-primary-700'))].sort((x, y) => y - x);
    const r = (a + 0.05) / (b + 0.05);
    igual(r >= 4.5, true, `razão ${r.toFixed(2)}`);
  });

  teste('a troca de dia respeita movimento reduzido', () => {
    const css = readFileSync(new URL('../css/pwa-agenda.css', import.meta.url), 'utf8');
    contem(css, '@media (prefers-reduced-motion: reduce) { .ag-entra-dir, .ag-entra-esq { animation: none; } }');
  });
});

grupo('app · o Safari não infla letra por conta própria', () => {
  teste('text-size-adjust em 100% (não none: o zoom de acessibilidade continua)', () => {
    const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
    contem(shell, 'html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }');
  });
});

import { mensagensDaAgenda } from '../js/pwa-agenda-ui.js';

grupo('agenda · uma aula por dia e as mensagens', () => {
  const semana = (extra = []) => ctx({ horarios: [h({ grade_id: 'g18', hora: '18:00', meu: 'fixo' }), ...extra] });

  teste('com aula no dia, os OUTROS horários do dia ficam fechados', () => {
    igual(estadoDoHorario(h({ grade_id: 'g06', hora: '06:00' }), semana()), 'outro_no_dia');
    igual(estadoDoHorario(h({ grade_id: 'g18', hora: '18:00', meu: 'fixo' }), semana()), 'desmarcar', 'a própria aula continua desmarcável');
    igual(estadoDoHorario(h({ grade_id: 'g06', data: '2026-11-12', hora: '06:00' }), semana()), 'reservar', 'outro dia: livre');
  });

  teste('fixo DESMARCADO libera o dia para outra reserva', () => {
    const s = ctx({ horarios: [h({ grade_id: 'g18', hora: '18:00', meu: 'desmarcado' })] });
    igual(estadoDoHorario(h({ grade_id: 'g06', hora: '07:00' }), s), 'reservar');
  });

  teste('as mensagens sempre dizem a regra', () => {
    const m = mensagensDaAgenda({ data: '2026-11-11', hora: '18:00', horas: 1, limite: 3, horaDoDia: '18:00' });
    contem(m.desmarcada.texto, 'Você poderá remarcar a aula');
    contem(m.desmarcada.regra, 'até 1 hora antes');
    contem(m.foraDoPrazo.titulo, 'Não é possível cancelar');
    contem(m.foraDoPrazo.texto, 'pelo horário');
    contem(m.foraDoPrazo.texto, 'conta como feita');
    contem(m.umaPorDia.texto, 'às 18:00');
    contem(m.umaPorDia.regra, 'até 3 por semana');
    igual(m.confirmarDesmarque.cancelar, 'Manter aula', 'a pergunta tem saída');
  });

  teste('prazo em horas: 1 hora, 2 horas, 1,5 horas', () => {
    contem(mensagensDaAgenda({ data: '2026-11-11', hora: '18:00', horas: 2 }).foraDoPrazo.regra, 'até 2 horas antes');
    contem(mensagensDaAgenda({ data: '2026-11-11', hora: '18:00', horas: 1.5 }).foraDoPrazo.regra, 'até 1,5 horas antes');
  });

  teste('aula que passou sem ser desmarcada aparece como Concluída', () => {
    const ui = readFileSync(new URL('../js/pwa-agenda-ui.js', import.meta.url), 'utf8');
    contem(ui, "const concluida = est === 'passou' && meu;");
    contem(ui, '✓ Concluída');
  });
});

import { planoHtml } from '../js/pwa-inicio-ui.js';

grupo('início · seu plano (vigência, feitas, disponíveis)', () => {
  const r = { ativo: true, plano: 'Mensal 3x', frequencia: 3, inicio: '2026-10-27', fim: '2026-12-10', feitas: 7, disponiveis: 15 };
  teste('mostra vigência, quanto falta e os dois números', () => {
    const html = planoHtml(r, '2026-11-10');
    contem(html, 'Mensal 3x');
    contem(html, 'Vigência 27/10 a 10/12 · faltam 30 dias');
    contem(html, 'Aulas feitas');
    contem(html, '>7 <small>aulas</small>');
    contem(html, '>15 <small>aulas</small>');
  });
  teste('sem agenda, sem plano ou sem resposta: o bloco não aparece', () => {
    igual(planoHtml(null), '');
    igual(planoHtml({ ativo: false }), '');
    igual(planoHtml({ ativo: true, plano: null }), '');
  });
  teste('singular e fim do plano', () => {
    contem(planoHtml({ ...r, feitas: 1 }, '2026-11-10'), '>1 <small>aula</small>');
    contem(planoHtml(r, '2026-12-10'), 'termina hoje');
  });
});

grupo('agenda · migração de 1 aula por dia', () => {
  const sql = readFileSync(new URL('../db/agenda_uma_aula_por_dia.sql', import.meta.url), 'utf8');
  const des = readFileSync(new URL('../db/agenda_uma_aula_por_dia_desfazer.sql', import.meta.url), 'utf8');
  teste('toda função com search_path fixo e as internas trancadas', () => {
    const funcoes = sql.match(/create or replace function public\.[a-z_]+/g) || [];
    igual(funcoes.length, 5);
    igual((sql.match(/set search_path = public/g) || []).length, 5);
    for (const f of ['agenda__aulas_no_dia(uuid, date)', 'agenda__reservar(uuid, uuid, date, text, boolean)', 'agenda__fixo_confere()', 'agenda__aulas_feitas(uuid, uuid, date, timestamp)'])
      contem(sql, `revoke all on function public.${f} from public, anon, authenticated;`);
  });
  teste('o resumo é só do próprio aluno e só para quem está logado', () => {
    contem(sql, 'v_pac uuid := public.paciente_do_auth()');
    contem(sql, 'revoke all on function public.agenda_aluno_resumo() from public, anon;');
    contem(sql, 'grant execute on function public.agenda_aluno_resumo() to authenticated;');
  });
  teste('a reserva recusa a segunda aula do dia e o fixo, o segundo no mesmo dia da semana', () => {
    contem(sql, 'if public.agenda__aulas_no_dia(p_paciente, p_data) >= 1 then');
    contem(sql, 'gf.dia_semana = gn.dia_semana');
  });
  teste('não mexe em tabela nem em dado', () => {
    igual(/\b(alter|drop) table|\bdelete from|\bupdate public\.agenda_(config|grade|fixos)\b|insert into public\.agenda_(config|grade|fixos)/i.test(sql), false);
  });
  teste('o desfazer volta as duas funções e tira as três novas', () => {
    contem(des, 'create or replace function public.agenda__reservar(');
    contem(des, 'create or replace function public.agenda__fixo_confere()');
    for (const f of ['agenda_aluno_resumo()', 'agenda__aulas_feitas(uuid, uuid, date, timestamp)', 'agenda__aulas_no_dia(uuid, date)'])
      contem(des, `drop function if exists public.${f};`);
    igual(des.includes('aulas_no_dia(p_paciente'), false, 'a reserva antiga não usa a função que sai');
  });
});
