-- ===========================================================================
-- MIGRATION B — CONFERENCIA DO PAGAMENTO TRANSACIONAL
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rodar DEPOIS de aplicar
-- db/comercial_pagamento_transacional.sql.
--
-- A Migration B nao escreve em tabela nenhuma: ela cria uma funcao. Entao a
-- conferencia tem duas metades:
--
--   o que TEM que existir  -> a funcao, definer, ACL fechada para anon, teto
--   o que NAO pode ter mudado -> assinaturas, cobrancas e auditoria, iguais
--                                aos numeros de antes de aplicar
--
-- E uma terceira, que so faz sentido depois de o frontend passar a usar a RPC:
--   RENOVACOES -> uma linha `renovada` por pagamento, nunca duas
--
-- Para colar no SQL Editor, use db/conferencia/95_pagamento_transacional_LIMPO.sql
-- ===========================================================================

drop table if exists conf95;
create temp table conf95 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_dono uuid;
  v_n    int;
  v_txt  text;
  r      record;
begin
  select o.proprietario_user_id into v_dono
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  -- ═══════════ A FUNCAO ═══════════
  for r in
    select p.proname, p.prosecdef,
           pg_get_function_identity_arguments(p.oid)              as args,
           has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
           pg_get_functiondef(p.oid)                             as fonte
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento'
  loop
    insert into conf95 values (10, 'RPC', 'assinatura', r.args,
      case when r.args like '%p_lancamento_id uuid%' and r.args not like '%nutri%'
           then 'OK (sem nutri_id vindo do frontend)' else 'FALHOU' end);

    insert into conf95 values (11, 'RPC', 'security definer', r.prosecdef::text,
      case when r.prosecdef then 'OK' else 'FALHOU' end);

    insert into conf95 values (12, 'RPC', 'ACL',
      'anon ' || r.anon_exec::text || ' | authenticated ' || r.auth_exec::text,
      case when not r.anon_exec and r.auth_exec then 'OK' else 'FALHOU' end);

    insert into conf95 values (13, 'RPC', 'as tres validacoes',
      case when r.fonte like '%organizacao_do_auth%' then 'org ' else '' end ||
      case when r.fonte like '%tem_permissao%'       then 'permissao ' else '' end ||
      case when r.fonte like '%is distinct from auth.uid()%' then 'teto' else '' end,
      case when r.fonte like '%organizacao_do_auth%'
            and r.fonte like '%tem_permissao%'
            and r.fonte like '%is distinct from auth.uid()%'
           then 'OK' else 'FALHOU' end);

    insert into conf95 values (14, 'RPC', 'marcador do teto',
      case when r.fonte like '%REMOVER NA SUBETAPA%' then 'presente' else 'AUSENTE' end,
      case when r.fonte like '%REMOVER NA SUBETAPA%' then 'OK' else 'FALHOU (o _LIMPO comeu o aviso)' end);

    -- A trava contra dupla renovacao e do banco: sem o predicado de pendente
    -- no update, dois cliques renovariam duas vezes.
    insert into conf95 values (15, 'RPC', 'trava de pendente',
      case when r.fonte like '%and status = ''pendente''%' then 'presente' else 'AUSENTE' end,
      case when r.fonte like '%and status = ''pendente''%'
           then 'OK (um pagamento = uma renovacao)' else 'FALHOU' end);

    -- A tolerancia tem que sair do plano que ENTRA.
    insert into conf95 values (16, 'RPC', 'tolerancia do plano que entra',
      case when r.fonte like '%v_tolerancia := coalesce(v_plano.tolerancia_dias%' then 'do plano carregado' else 'NAO ENCONTRADA' end,
      case when r.fonte like '%v_tolerancia := coalesce(v_plano.tolerancia_dias%'
            and r.fonte like '%v_plano_id := v_ass.proximo_plano_id%'
           then 'OK' else 'FALHOU' end);

    -- E a intencao tem que ser consumida no mesmo update.
    insert into conf95 values (17, 'RPC', 'consome a renovacao programada',
      case when r.fonte like '%proximo_plano_id         = null%' then 'limpa as cinco' else 'NAO LIMPA' end,
      case when r.fonte like '%proximo_plano_id         = null%'
            and r.fonte like '%renovacao_origem_id      = null%'
           then 'OK' else 'FALHOU' end);
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'comercial_registrar_pagamento';
  insert into conf95 values (18, 'RPC', '~ existe', v_n::text,
    case when v_n = 1 then 'OK' else 'FALHOU (esperado 1)' end);

  -- ═══════════ O QUE NAO PODE TER MUDADO ═══════════
  select count(*) into v_n from public.comercial_assinaturas;
  insert into conf95 values (20, 'INTACTO', 'assinaturas', v_n::text,
    'comparar com o numero de antes de aplicar a B');

  select count(*) into v_n from public.financeiro_lancamentos where assinatura_id is not null;
  insert into conf95 values (21, 'INTACTO', 'cobrancas de assinatura', v_n::text,
    'comparar com o numero de antes de aplicar a B');

  select count(*) into v_n from public.comercial_assinatura_auditoria;
  insert into conf95 values (22, 'INTACTO', 'auditoria', v_n::text,
    'a B nao escreve nada ao ser aplicada');

  -- ═══════════ A MIGRATION A CONTINUA DE PE ═══════════
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('comercial_criar_cobranca_do_periodo', 'comercial_cancelar_cobranca');
  insert into conf95 values (30, 'MIGRATION A', 'funcoes ainda existem', v_n::text,
    case when v_n = 2 then 'OK' else 'FALHOU' end);

  select pg_get_constraintdef(oid) into v_txt from pg_constraint
   where conname = 'comercial_assinatura_auditoria_acao_check';
  insert into conf95 values (31, 'MIGRATION A', 'CHECK da acao', coalesce(v_txt, '(nenhum)'),
    case when v_txt like '%renovada%' and v_txt like '%renovacao_programada%'
          and v_txt not like '%plano_alterado%'
         then 'OK (tres acoes, sem evento duplicado)' else 'FALHOU' end);

  -- ═══════════ ETAPA 4A INTACTA ═══════════
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'comercial_planos';
  insert into conf95 values (40, 'ETAPA 4A', 'policies de comercial_planos', v_n::text,
    case when v_n = 4 then 'OK (intacta)' else 'FALHOU' end);

  -- ═══════════ UM PAGAMENTO = UMA RENOVACAO ═══════════
  -- So faz sentido depois de o frontend passar a usar a RPC. Antes disso, zero
  -- e o esperado.
  select count(*) into v_n from public.comercial_assinatura_auditoria where acao = 'renovada';
  insert into conf95 values (50, 'RENOVACOES', 'eventos `renovada`', v_n::text,
    'zero enquanto o frontend nao usar a RPC');

  -- Duas linhas `renovada` para o MESMO lancamento seriam a dupla renovacao
  -- que a trava de pendente existe para impedir.
  select count(*) into v_n from (
    select depois ->> 'lancamento_id' as lanc, count(*) as n
      from public.comercial_assinatura_auditoria
     where acao = 'renovada' and depois ? 'lancamento_id'
     group by 1 having count(*) > 1
  ) x;
  insert into conf95 values (51, 'RENOVACOES', 'lancamentos renovados DUAS vezes', v_n::text,
    case when v_n = 0 then 'OK (um pagamento = uma renovacao)'
         else 'FALHOU — houve dupla renovacao' end);

  -- E nenhuma intencao pode sobreviver a um pagamento.
  select count(*) into v_n from public.comercial_assinaturas a
   where a.proximo_plano_id is not null
     and exists (select 1 from public.financeiro_lancamentos l
                  where l.assinatura_id = a.id and l.id = a.renovacao_origem_id
                    and l.status = 'pago');
  insert into conf95 values (52, 'RENOVACOES', 'intencao viva com a cobranca de origem JA PAGA', v_n::text,
    case when v_n = 0 then 'OK (consumida no pagamento)'
         else 'FALHOU — intencao sobreviveu ao pagamento' end);
end $$;

insert into conf95
select 999, 'VEREDITO',
  case when exists (select 1 from conf95 where resultado like 'FALHOU%')
       then 'HA FALHAS' else 'MIGRATION B APLICADA — conferir os INTACTO contra o retrato anterior' end,
  coalesce((select string_agg(distinct item, ', ') from conf95 where resultado like 'FALHOU%'), 'nada a apontar'),
  '';

select ordem, secao, item, valor, resultado from conf95 order by ordem, item;
