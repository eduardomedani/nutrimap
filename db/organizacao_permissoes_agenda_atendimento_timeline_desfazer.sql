-- ===========================================================================
-- Evollo · DESFAZER — Agenda, Atendimento e Timeline no catalogo
-- ---------------------------------------------------------------------------
-- Desfaz db/organizacao_permissoes_agenda_atendimento_timeline.sql.
-- 34 -> 27.
--
-- E ROLLBACK COMPLETO, e pode ser: a migration nao criou objeto nem dado de
-- ninguem. Criou sete linhas de catalogo e os vinculos delas com os perfis.
--
-- `perfil_permissoes.permissao_chave` tem `on delete cascade` para
-- `permissoes.chave`, entao apagar as sete chaves ja levaria os vinculos. O
-- delete dos vinculos vem ANTES mesmo assim: um script que depende de cascade
-- silencioso e um script que nao diz o que faz.
--
-- ---------------------------------------------------------------------------
-- A GUARDA QUE IMPEDE APAGAR ALGO QUE ALGUEM ESTA USANDO
-- ---------------------------------------------------------------------------
-- Se, entre a migration e este desfazer, alguem tiver concedido ou bloqueado
-- uma dessas chaves para um usuario especifico (public.usuario_permissoes), o
-- script ABORTA. Excecao individual e decisao de alguem sobre uma pessoa; ela
-- nao pode desaparecer como efeito colateral de um rollback de catalogo.
--
-- ---------------------------------------------------------------------------
-- NAO RODE ISTO DEPOIS DA ETAPA 4
-- ---------------------------------------------------------------------------
-- No dia em que as policies de public.consultas e das tres tabelas de timeline
-- passarem a exigir estas chaves, apaga-las nao "volta ao estado anterior":
-- deixa policy chamando `tem_permissao()` de chave que nao existe mais, e
-- `tem_permissao` de chave inexistente e false. O resultado seria o modulo
-- inteiro invisivel para todo mundo, inclusive para o proprietario.
--
-- Este arquivo vale enquanto as chaves ainda nao governam policy nenhuma.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  CHAVES text[] := array['atendimento.visualizar','atendimento.registrar',
                         'agenda.visualizar','agenda.criar','agenda.editar',
                         'timeline.visualizar','timeline.gerenciar'];
  v_n     integer;
  v_lista text;
begin
  -- ── Guarda 1: excecao individual concedida a alguem ─────────────────────
  select count(*), string_agg(distinct up.permissao_chave, ', ')
    into v_n, v_lista
    from public.usuario_permissoes up
   where up.permissao_chave = any(CHAVES);

  if v_n > 0 then
    raise exception
      'ABORTADO: ha % excecao(oes) individual(is) usando estas chaves (%). Remova-as antes — elas sao decisao sobre uma pessoa.',
      v_n, v_lista;
  end if;

  -- ── Guarda 2: alguma policy ja depende das chaves ───────────────────────
  -- Le o texto real das policies do banco. Se qualquer uma citar uma das sete,
  -- a Etapa 4 ja passou por aqui e este desfazer virou destrutivo.
  select count(*), string_agg(p.schemaname || '.' || p.tablename || ' / ' || p.policyname, ', ')
    into v_n, v_lista
    from pg_policies p
   where exists (
     select 1 from unnest(CHAVES) c
      where coalesce(p.qual, '') like '%' || c || '%'
         or coalesce(p.with_check, '') like '%' || c || '%'
   );

  if v_n > 0 then
    raise exception
      'ABORTADO: % policy(ies) ja dependem destas chaves (%). Apaga-las tornaria o modulo invisivel para todos.',
      v_n, v_lista;
  end if;

  delete from public.perfil_permissoes where permissao_chave = any(CHAVES);
  delete from public.permissoes         where chave          = any(CHAVES);

  raise notice 'Desfeito. Catalogo de volta a % chaves.', (select count(*) from public.permissoes);
end $$;


-- ===========================================================================
-- Conferencia. Esperado:
--   permissoes = 27 · sobraram = 0
--   proprietario = 27 · administrador = 25
--   nutricionista = 15 · recepcao = 5 · treinador = 6 · financeiro = 5
-- ===========================================================================
select
  (select count(*) from public.permissoes)                                       as permissoes,
  (select count(*) from public.permissoes
    where modulo in ('agenda','timeline') or chave like 'atendimento.%')          as sobraram,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'proprietario')                  as proprietario,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'administrador')                 as administrador,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'nutricionista')                 as nutricionista,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'recepcao')                      as recepcao,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'treinador')                     as treinador,
  (select count(*) from public.perfil_permissoes pp join public.perfis p on p.id = pp.perfil_id
    where p.organizacao_id is null and p.chave = 'financeiro')                    as financeiro;
