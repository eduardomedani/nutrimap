-- ===========================================================================
-- Evollo · COMERCIAL — "REMOVER COBRANCA" PERDE A TRAVA DE PROPRIETARIO
-- ---------------------------------------------------------------------------
-- GERADO a partir de db/comercial_renovacao_programada.sql, o unico arquivo
-- que define comercial_cancelar_cobranca: o corpo e o MESMO de producao, menos
-- o bloco da trava. Nenhuma outra linha foi escrita a mao.
--
-- O QUE ACONTECIA. A funcao nasceu na Migration A (13/08/2026) com a trava que
-- compara a organizacao da assinatura com o id de quem clicou. A Etapa 4B
-- (01/09) tirou a trava das RPCs de criar cobranca e registrar pagamento, mas
-- nunca reescreveu esta. Conferencia 136 (11/09/2026): so o Proprietario
-- remove cobranca; Administrador e Recepcao, que tem comercial.editar, recebem
-- "Nao foi possivel concluir".
--
-- DECISAO (11/09/2026): remove cobranca quem tem comercial.editar — a mesma
-- regra de criar e receber. Hoje: Proprietario, Administrador e Recepcao. O
-- Financeiro NAO entra (nao tem comercial.editar, por decisao registrada em
-- db/organizacao_ajuste_perfil_financeiro.sql).
--
-- O QUE CONTINUA EXIGIDO, nesta ordem: sessao, organizacao, comercial.editar,
-- cobranca de assinatura, assinatura da mesma organizacao, status pendente.
-- Cobranca paga continua sem poder ser cancelada. A limpeza da renovacao
-- programada, com trilha na auditoria, continua igual.
--
-- GUARDA: so segue se a funcao em producao for a da Migration A COM a trava.
-- Se alguem ja mexeu nela, para antes de qualquer alteracao. Tudo numa
-- transacao.
--
-- Nao altera dado nenhum.
--
-- Desfazer: db/comercial_cancelar_sem_teto_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/comercial_cancelar_sem_teto_LIMPO.sql
-- ===========================================================================

-- ===========================================================================
-- 0) A GUARDA — so segue se producao estiver COM a trava
-- ===========================================================================
do $guarda$
declare
  v_n int;
begin
  select count(*) into v_n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = 'comercial_cancelar_cobranca'
     and p.prosrc like '%comercial.editar%'
     and p.prosrc like '%cobranca fora da organizacao%'
     and p.prosrc like '%renovacao_cancelada%'
     and (p.prosrc like '%TETO TEMPORARIO%');
  if v_n <> 1 then
    raise exception 'comercial_cancelar_cobranca em producao nao esta no estado esperado (COM a trava). Nada foi alterado. Rode a conferencia do fim deste arquivo e me mostre.';
  end if;
end $guarda$;

-- ===========================================================================
-- 1) A FUNCAO — o corpo da Migration A, menos a trava
-- ===========================================================================
create or replace function public.comercial_cancelar_cobranca(p_lancamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org  uuid;
  v_lanc public.financeiro_lancamentos%rowtype;
  v_ass  public.comercial_assinaturas%rowtype;
  v_limpou boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sem sessao' using errcode = '42501';
  end if;

  v_org := public.organizacao_do_auth();
  if v_org is null then
    raise exception 'sem organizacao' using errcode = '42501';
  end if;

  if not public.tem_permissao('comercial.editar') then
    raise exception 'sem permissao comercial.editar' using errcode = '42501';
  end if;

  select * into v_lanc from public.financeiro_lancamentos where id = p_lancamento_id;
  if not found then
    raise exception 'cobranca nao encontrada' using errcode = 'P0002';
  end if;

  -- So cobranca de assinatura. O Financeiro tem os proprios caminhos para
  -- lancamento avulso, e esta funcao nao pode virar atalho para eles.
  if v_lanc.assinatura_id is null then
    raise exception 'lancamento nao e cobranca de assinatura' using errcode = '23514';
  end if;

  select * into v_ass from public.comercial_assinaturas where id = v_lanc.assinatura_id;
  if not found then
    raise exception 'assinatura nao encontrada' using errcode = 'P0002';
  end if;
  if v_ass.nutri_id is distinct from v_org then
    raise exception 'cobranca fora da organizacao' using errcode = '42501';
  end if;

  -- (sem trava de proprietario) Quem decide o acesso sao as tres checagens
  -- acima: sessao, organizacao da assinatura e comercial.editar — a mesma
  -- regra de criar cobranca e registrar pagamento (decisao de 11/09/2026).

  -- A trava e do BANCO: cobranca paga nao casa aqui, e a funcao devolve
  -- `cancelou: false`. Nao da para cancelar um periodo ja recebido por dois
  -- cliques rapidos ou por duas abas.
  if v_lanc.status is distinct from 'pendente' then
    return jsonb_build_object('cancelou', false, 'motivo', 'nao_pendente');
  end if;

  update public.financeiro_lancamentos
     set status = 'cancelado'
   where id = v_lanc.id and status = 'pendente'
  returning * into v_lanc;

  if not found then
    return jsonb_build_object('cancelou', false, 'motivo', 'nao_pendente');
  end if;

  -- A intencao cai junto SE foi esta cobranca que a programou.
  if v_ass.renovacao_origem_id = v_lanc.id then
    insert into public.comercial_assinatura_auditoria
      (nutri_id, assinatura_id, acao, usuario_id, antes, depois)
    values
      (v_ass.nutri_id, v_ass.id, 'renovacao_cancelada', auth.uid(),
       jsonb_build_object('proximo_plano_id', v_ass.proximo_plano_id,
                          'proximo_valor_contratado', v_ass.proximo_valor_contratado,
                          'renovacao_origem_id', v_ass.renovacao_origem_id),
       jsonb_build_object('proximo_plano_id', null,
                          'proximo_valor_contratado', null,
                          'renovacao_origem_id', null));

    update public.comercial_assinaturas
       set proximo_plano_id         = null,
           proximo_valor_contratado = null,
           renovacao_definida_em    = null,
           renovacao_definida_por   = null,
           renovacao_origem_id      = null
     where id = v_ass.id
    returning * into v_ass;

    v_limpou := true;
  end if;

  return jsonb_build_object(
    'cancelou',   true,
    'cobranca',   to_jsonb(v_lanc),
    'assinatura', to_jsonb(v_ass),
    'limpou_renovacao', v_limpou
  );
end;
$fn$;

revoke all on function public.comercial_cancelar_cobranca(uuid) from public, anon;
grant execute on function public.comercial_cancelar_cobranca(uuid) to authenticated;


-- ===========================================================================
-- CONFERENCIA. Esperado: funcoes 1 · com_teto 0 · com_organizacao 1 ·
-- com_permissao 1 · limpa_renovacao 1 · definer 1 · funcoes_com_teto nenhuma
-- ===========================================================================
select
  count(*)                                                       as funcoes,
  count(*) filter (where p.prosrc like '%TETO TEMPORARIO%')      as com_teto,
  count(*) filter (where p.prosrc like '%cobranca fora da organizacao%') as com_organizacao,
  count(*) filter (where p.prosrc like '%comercial.editar%')     as com_permissao,
  count(*) filter (where p.prosrc like '%renovacao_cancelada%')  as limpa_renovacao,
  count(*) filter (where p.prosecdef)                            as definer,
  (select coalesce(string_agg(o.proname, ', ' order by o.proname), 'nenhuma')
     from pg_proc o
     join pg_namespace ons on ons.oid = o.pronamespace
    where ons.nspname = 'public'
      and o.prosrc like '%TETO TEMPORARIO%')                     as funcoes_com_teto
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.proname = 'comercial_cancelar_cobranca';
