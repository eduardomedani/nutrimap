-- ===========================================================================
-- DESFAZER db/comercial_bonificar_assinatura.sql
-- ---------------------------------------------------------------------------
-- Devolve a assinatura ao plano, valor e periodo que ela tinha antes de virar
-- cortesia, lendo o `antes` da trilha de auditoria — por isso o script
-- original grava aquele JSON estruturado, e nao uma frase.
--
-- Troque `v_nome` para a mesma pessoa que voce bonificou.
--
-- ELE USA A ULTIMA BONIFICACAO DA PESSOA. Se voce bonificou, desfez e
-- bonificou de novo, e o estado imediatamente anterior a ULTIMA que volta —
-- que e o que "desfazer" quer dizer.
--
-- O PERIODO VOLTA COMO ESTAVA, inclusive vencido. Nao ha o que inventar aqui:
-- se o contrato estava vencido antes da cortesia, ele volta vencido, e a
-- pessoa reaparece na fila de urgencia como reaparecia antes. Empurrar o
-- periodo para a frente seria dar de presente um mes que ninguem decidiu dar.
--
-- O PLANO "Bonificacao" NAO E APAGADO. Ele pode estar em uso por outra pessoa,
-- e um plano sem uso nao e sujeira que valha o risco. Se quiser somir com ele,
-- desative na tela de planos.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_bonificar_assinatura_desfazer_LIMPO.sql
-- ===========================================================================

do $desfaz$
declare
  v_nome  text := 'NOME COMPLETO DO CLIENTE';   -- <<< troque aqui
  v_org   uuid;
  v_pac   uuid;
  v_ass   uuid;
  v_antes jsonb;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi tocado';
  end if;

  select p.id into v_pac
    from public.pacientes p
   where p.nutri_id = v_org
     and lower(translate(trim(p.nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       = lower(translate(trim(v_nome),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
   limit 1;

  if v_pac is null then
    raise exception 'cliente "%" nao encontrado. Nada foi tocado.', v_nome;
  end if;

  select au.assinatura_id, au.antes
    into v_ass, v_antes
    from public.comercial_assinatura_auditoria au
    join public.comercial_assinaturas a on a.id = au.assinatura_id
   where a.paciente_id = v_pac and au.acao = 'bonificada'
   order by au.criado_em desc
   limit 1;

  if v_ass is null then
    raise exception 'nenhuma bonificacao registrada para "%". Nada foi tocado.', v_nome;
  end if;

  update public.comercial_assinaturas a
     set plano_id             = nullif(v_antes ->> 'plano_id', '')::uuid,
         valor_contratado     = nullif(v_antes ->> 'valor_contratado', '')::numeric,
         inicio_periodo       = (v_antes ->> 'inicio_periodo')::date,
         fim_periodo          = (v_antes ->> 'fim_periodo')::date,
         status               = coalesce(nullif(v_antes ->> 'status', ''), 'ativa'),
         renovacao_automatica = coalesce((v_antes ->> 'renovacao_automatica')::boolean, false),
         atualizado_em        = now()
   where a.id = v_ass;

  insert into public.comercial_assinatura_auditoria
    (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
  select a.nutri_id, a.id, 'bonificacao_desfeita', auth.uid(),
         jsonb_build_object('plano', 'Bonificacao', 'valor_contratado', 0),
         v_antes
    from public.comercial_assinaturas a
   where a.id = v_ass;

  raise notice 'restaurado: %', v_antes::text;
end $desfaz$;


-- ===========================================================================
-- CONFERENCIA. Esperado: ainda_bonificado = 0 para a pessoa desfeita.
-- ===========================================================================
select
  (select count(*) from public.comercial_assinaturas a
     join public.comercial_planos pl on pl.id = a.plano_id
    where lower(pl.nome) = 'bonificacao' and a.status = 'ativa') as ainda_bonificado;
