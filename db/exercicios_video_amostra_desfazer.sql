-- ===========================================================================
-- DESFAZER db/exercicios_video_amostra.sql
-- ---------------------------------------------------------------------------
-- Tira das fichas de exercicio as URLs de amostra, devolvendo `video_url` a
-- nulo. Nao apaga nada alem disso.
--
-- A MARCA E O PREFIXO DA URL. Toda amostra comeca com
-- `https://ymove.app/api/free/` — nenhum video proprio, do YouTube ou de
-- qualquer outro lugar comeca assim. Entao o desfazer nao precisa de coluna de
-- controle nem de lista de ids: ele reconhece o que limpar pelo proprio dado.
--
-- ISSO PRESERVA O QUE VOCE CADASTROU. Se durante o teste alguem gravou um
-- video da casa e pos no lugar de uma amostra, aquela URL nao tem o prefixo, e
-- este script passa por ela sem tocar.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicios_video_amostra_desfazer_LIMPO.sql
-- ===========================================================================

do $desfaz$
declare
  v_org uuid;
  v_n   int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  update public.exercicios e
     set video_url = null
   where e.nutri_id = v_org
     and e.video_url like 'https://ymove.app/api/free/%';

  get diagnostics v_n = row_count;
  raise notice 'amostras removidas: %', v_n;
end $desfaz$;


-- ===========================================================================
-- CONFERENCIA. Esperado: amostras = 0 · com_video_proprio = o que voce cadastrou
-- ===========================================================================
select
  (select count(*) from public.exercicios
    where video_url like 'https://ymove.app/api/free/%')                        as amostras,
  (select count(*) from public.exercicios
    where video_url is not null
      and video_url not like 'https://ymove.app/api/free/%')                    as com_video_proprio;
