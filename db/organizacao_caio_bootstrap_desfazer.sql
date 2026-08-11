-- ===========================================================================
-- Evollo · DESFAZER — organizacao propria da segunda conta de nutricionista
-- ---------------------------------------------------------------------------
-- Desfaz db/organizacao_caio_bootstrap.sql.
--
-- E UM ROLLBACK COMPLETO, e pode ser, porque o bootstrap nao criou dado: criou
-- duas linhas de metadado. Nao ha resposta de paciente nem arquivo em jogo —
-- ao contrario do desfazer do check-in, que preserva as tabelas de proposito.
--
-- O paciente do Caio, o evento de timeline e o registro em codigos_uso NAO SAO
-- TOCADOS por este script, pelo mesmo motivo de nao terem sido tocados pelo
-- bootstrap: eles nunca dependeram da organizacao. Continuam com
-- `nutri_id` = uuid da conta dele, exatamente como antes.
--
-- DEPOIS DE RODAR ISTO, `organizacao_do_auth()` volta a devolver NULL para ele
-- — que e o estado de hoje.
--
-- ATENCAO A ORDEM. O vinculo sai primeiro. `organizacao_usuarios.organizacao_id`
-- tem `on delete cascade`, entao apagar a organizacao antes levaria o vinculo
-- junto e daria certo — mas deixaria o script dependendo de um cascade em vez
-- de dizer o que faz. Explicito e melhor.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  v_uid constant uuid := 'bc631909-3c59-459d-817a-fd0fd218879c';
  v_n   integer;
begin
  -- Guarda: nao apagar uma organizacao que ganhou gente no meio do caminho.
  -- Se alguem foi convidado para a organizacao do Caio depois do bootstrap,
  -- apagar aqui derrubaria o acesso dessa pessoa sem aviso.
  select count(*) into v_n
    from public.organizacao_usuarios ou
   where ou.organizacao_id = v_uid and ou.auth_user_id <> v_uid;

  if v_n > 0 then
    raise exception 'ABORTADO: a organizacao tem % outro(s) membro(s) alem do proprietario. Remova-os antes.', v_n;
  end if;

  delete from public.organizacao_usuarios where auth_user_id = v_uid and organizacao_id = v_uid;
  delete from public.organizacoes         where id = v_uid and proprietario_user_id = v_uid;

  raise notice 'Desfeito. A conta % volta a nao pertencer a organizacao nenhuma.', v_uid;
end $$;


-- ===========================================================================
-- Conferencia. Esperado:
--   organizacoes = 1 (so a principal)
--   vinculo = 0
--   pacientes_do_caio = 1  (intocado, como sempre esteve)
-- ===========================================================================
select
  (select count(*) from public.organizacoes)                              as organizacoes,
  (select count(*) from public.organizacao_usuarios ou
    where ou.auth_user_id = 'bc631909-3c59-459d-817a-fd0fd218879c')       as vinculo,
  (select count(*) from public.pacientes p
    where p.nutri_id = 'bc631909-3c59-459d-817a-fd0fd218879c')            as pacientes_do_caio;
