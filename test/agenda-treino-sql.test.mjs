// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — o SQL (db/agenda_treino.sql)
// ═══════════════════════════════════════════════════════════
// O comportamento foi ensaiado num Postgres em memória (PGlite, 33 cenários:
// vaga, limite semanal, janela, prazo, recepção, agenda desligada, desfazer).
// Aqui ficam as GUARDAS do arquivo — as que, quebradas, abrem a agenda para
// quem não devia ou deixam a regra ter atalho.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/agenda_treino.sql', import.meta.url), 'utf8');
const desfazer = readFileSync(new URL('../db/agenda_treino_desfazer.sql', import.meta.url), 'utf8');
const funcoes = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)[\s\S]*?\$fn\$;/g)];

grupo('agenda de treino · SQL', () => {
  teste('16 funções, todas com search_path fixo', () => {
    igual(funcoes.length, 16);
    for (const [corpo, nome] of funcoes) ok(/set search_path = public/.test(corpo), `${nome} sem search_path`);
  });

  teste('FUNÇÃO INTERNA (agenda__*) NÃO É EXECUTÁVEL POR NINGUÉM DO APP', () => {
    const internas = funcoes.map(f => f[1]).filter(n => n.startsWith('agenda__'));
    igual(internas.length, 10);
    for (const n of internas) contem(sql, `revoke all on function public.${n}(`);
    ok(!/grant execute on function public\.agenda__/.test(sql), 'nenhum grant para função interna');
  });

  teste('as 6 públicas: revoke de anon, grant só para authenticated', () => {
    for (const n of ['agenda_aluno_semana', 'agenda_aluno_reservar', 'agenda_aluno_desmarcar',
                     'agenda_painel_semana', 'agenda_recepcao_reservar', 'agenda_recepcao_desmarcar']) {
      ok(new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon;`).test(sql), `${n} sem revoke`);
      ok(new RegExp(`grant execute on function public\\.${n}\\([^)]*\\) to authenticated;`).test(sql), `${n} sem grant`);
    }
    ok(!/to anon/.test(sql), 'nada para anon');
  });

  teste('O ALUNO SÓ AGE SOBRE SI (paciente_do_auth) E COM OS PRAZOS DO APP', () => {
    contem(sql, "return public.agenda__reservar(v_pac, p_grade, p_data, 'app', true);");
    contem(sql, "return public.agenda__desmarcar(v_pac, p_grade, p_data, 'app', true);");
    igual((sql.match(/v_pac uuid := public\.paciente_do_auth\(\)/g) || []).length, 3);
  });

  teste('recepção: permissão agenda.editar e aluno da MESMA organização', () => {
    igual((sql.match(/tem_permissao\('agenda\.editar'\)\s*\n\s*or not exists \(select 1 from public\.pacientes where id = p_paciente and nutri_id = public\.organizacao_do_auth\(\)\)/g) || []).length, 2);
  });

  teste('movimentos só se escrevem pelas funções (sem policy de escrita)', () => {
    ok(!/on public\.agenda_movimentos for (insert|update|delete)/.test(sql));
    contem(sql, 'create policy agenda_mov_select on public.agenda_movimentos for select');
  });

  teste('vaga e limite com trava contra corrida', () => {
    contem(sql, "pg_advisory_xact_lock(hashtextextended('agenda:' || p_grade::text");
    contem(sql, "pg_advisory_xact_lock(hashtextextended('agenda-aluno:' || p_paciente::text");
    contem(sql, 'if v_uso >= v_limite then');
    contem(sql, 'if public.agenda__ocupacao(p_grade, p_data) >= g.capacidade then');
  });

  teste('NÃO ALTERA TABELA EXISTENTE (comercial, financeiro, pacientes, treinos)', () => {
    ok(!/alter table public\.(comercial|financeiro|pacientes|treino|exercicio)/.test(sql));
    ok(!/(insert into|update|delete from) public\.(comercial|financeiro|pacientes|treino)/i.test(sql.replace(/--.*$/gm, '')));
  });

  teste('o aluno só vê com a agenda ligada (mês em paralelo com a Next Fit)', () => {
    contem(sql, "ativo               boolean not null default false");
    contem(sql, "if not found or not c.ativo then return jsonb_build_object('ativo', false); end if;");
  });

  teste('o desfazer remove as 4 tabelas e as funções públicas', () => {
    for (const t of ['agenda_config', 'agenda_grade', 'agenda_fixos', 'agenda_movimentos']) contem(desfazer, `drop table if exists public.${t};`);
    for (const [, n, args] of funcoes) ok(desfazer.includes(`drop function if exists public.${n}(`), `${n} fica no desfazer`);
  });
});
