-- ===========================================================================
-- ETAPA 4C — PRONTIDAO, ANTES E DEPOIS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Rode DUAS vezes: antes de migrar e depois.
--
-- COMO LER. Cada secao diz o valor esperado na coluna `resultado`:
--
--   ANTES  -> FASE 1 tem que estar OK e FASE 2 "ainda nao"
--   DEPOIS -> tudo OK
--
-- A secao COLABORADOR e a mais importante das duas vezes, e pelo mesmo motivo
-- que CLINICO era na 4B: ela mede o que NAO pode mudar. O colaborador ve o
-- proprio contracheque por `funcionario_do_auth()`, que nao e tenancy — se
-- alguma dessas policies for "padronizada" junto com as outras, o app do
-- colaborador cai e ninguem percebe ate ele reclamar.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/conferencia/112_prontidao_4c_LIMPO.sql
-- ===========================================================================

drop table if exists conf112;
create temp table conf112 (ordem int, secao text, item text, valor text, resultado text);

do $$
declare
  v_org  uuid;
  v_n    int;
  v_txt  text;
  r      record;
  ALVOS  text[] := array['folhas','folha_itens','folha_adicionais','funcionarios',
                         'colaborador_documentos','documentos_pendentes'];
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  insert into conf112 values (0, 'PREMISSA', 'organizacao', coalesce(v_org::text, 'NAO ACHOU'),
    case when v_org is null then 'sem organizacao a 4C nao pode rodar' else 'OK' end);

  -- ═══════════ FASE 1 — o frontend ja esta no ar? ═══════════
  -- Nenhum SQL enxerga o frontend. O que da para medir e o EFEITO: linha
  -- recente com dono diferente da organizacao denuncia codigo antigo
  -- escrevendo.
  foreach v_txt in array ALVOS loop
    execute format('select count(*) from public.%I where nutri_id <> $1', v_txt)
      into v_n using v_org;
    insert into conf112 values (10, 'FASE 1', 'linhas fora da organizacao em ' || v_txt, v_n::text,
      case when v_n = 0 then 'OK'
           else 'apagar ANTES de migrar — depois somem para todos' end);
  end loop;

  -- A folha fantasma tem assinatura propria: rascunho, vazia, dono diferente.
  select count(*) into v_n
    from public.folhas f
   where f.nutri_id <> v_org
     and f.status = 'rascunho'
     and not exists (select 1 from public.folha_itens i where i.folha_id = f.id);
  insert into conf112 values (11, 'FASE 1', 'folhas fantasma (rascunho vazia)', v_n::text,
    case when v_n = 0 then 'OK' else 'rode db/folha_apagar_fantasmas.sql' end);

  -- Arquivo na pasta errada. O caminho e {dono}/{colaborador}/..., entao a
  -- primeira pasta tem que ser a organizacao.
  select count(*) into v_n
    from storage.objects
   where bucket_id = 'colaborador-documentos'
     and (storage.foldername(name))[1] <> v_org::text;
  insert into conf112 values (12, 'FASE 1', 'arquivos fora da pasta da organizacao', v_n::text,
    case when v_n = 0 then 'OK'
         else 'ficam inacessiveis apos migrar — mover ou apagar antes' end);

  -- ═══════════ FASE 2 — as policies ═══════════
  foreach v_txt in array ALVOS loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = v_txt
       and coalesce(qual,'') || coalesce(with_check,'') like '%organizacao_do_auth%';
    insert into conf112 values (20, 'FASE 2', 'policies migradas em ' || v_txt, v_n::text,
      case when v_n >= 1 then 'OK' else 'ainda nao' end);
  end loop;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'nutri_id'
     and table_name = any (ALVOS)
     and column_default like '%organizacao_do_auth%';
  insert into conf112 values (21, 'FASE 2', 'defaults migrados', v_n || ' de 6',
    case when v_n = 6 then 'OK' else 'ainda nao' end);

  -- Tenancy sem permissao faria qualquer membro ativo ver salario e CPF.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = any (ALVOS)
     and coalesce(qual,'') || coalesce(with_check,'') like '%organizacao_do_auth%'
     and coalesce(qual,'') || coalesce(with_check,'') not like '%tem_permissao%';
  insert into conf112 values (22, 'FASE 2', 'policies com tenancy e SEM permissao', v_n::text,
    case when v_n = 0 then 'OK' else 'REGRESSAO — membro ve salario sem a chave' end);

  -- Tudo sob `equipe.folha`, que e a chave sensivel. Se aparecer
  -- `equipe.visualizar` governando tabela, alguem liberou o cadastro — e
  -- salario e CPF sao COLUNAS da mesma linha.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = any (ALVOS)
     and coalesce(qual,'') || coalesce(with_check,'') like '%equipe.visualizar%';
  insert into conf112 values (23, 'FASE 2', 'tabela liberada por equipe.visualizar', v_n::text,
    case when v_n = 0 then 'OK — RLS protege linha, nao coluna'
         else 'PERIGO — quem so ve cadastro passou a ver salario' end);

  -- ═══════════ O BUCKET ═══════════
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'cd_storage_nutri'
     and coalesce(qual,'') like '%organizacao_do_auth%';
  insert into conf112 values (30, 'BUCKET', 'cd_storage_nutri migrada', v_n::text,
    case when v_n = 1 then 'OK' else 'ainda nao' end);

  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'cd_storage_colaborador';
  insert into conf112 values (31, 'BUCKET', 'cd_storage_colaborador intacta', v_n::text,
    case when v_n = 1 then 'OK' else 'SUMIU — o colaborador perdeu o proprio arquivo' end);

  -- ═══════════ COLABORADOR — o que NAO pode mudar ═══════════
  -- Cinco policies em `public` dao ao colaborador acesso ao PROPRIO dado. Elas
  -- nao falam de tenancy, e por isso a 4C nao as toca — derrubar uma tiraria o
  -- contracheque dele do ar.
  --
  -- A CONFERENCIA E NOMINAL, e a primeira versao deste script errou nisso: ela
  -- procurava `funcionario_do_auth` e concluiu "ALGUMA SUMIU" porque so duas
  -- usam essa funcao. As cinco resolvem por TRES mecanismos diferentes:
  --
  --   funcionarios_self_read           auth_user_id = auth.uid()
  --   folhas_funcionario_read          folha_tem_linha_minha(id)
  --   folha_itens_funcionario_read     funcionario_do_auth()
  --   folha_adicionais_funcionario_read item_e_meu(item_id)
  --   cd_colaborador_select            funcionario_do_auth()
  --
  -- Procurar UM mecanismo e concluir sobre CINCO policies foi o erro. Alarme que
  -- grita sem motivo treina a ignorar alarme.
  for r in
    select x.tabela, x.policy,
           (select count(*) from pg_policies p
             where p.schemaname = 'public'
               and p.tablename = x.tabela and p.policyname = x.policy) as existe
      from (values
        ('funcionarios',           'funcionarios_self_read'),
        ('folhas',                 'folhas_funcionario_read'),
        ('folha_itens',            'folha_itens_funcionario_read'),
        ('folha_adicionais',       'folha_adicionais_funcionario_read'),
        ('colaborador_documentos', 'cd_colaborador_select')
      ) as x(tabela, policy)
  loop
    insert into conf112 values (40, 'COLABORADOR', r.tabela || ' · ' || r.policy,
      case when r.existe = 1 then 'existe' else 'AUSENTE' end,
      case when r.existe = 1 then 'intacta'
           else 'SUMIU — o app do colaborador quebra' end);
  end loop;

  select count(*) into v_n
    from pg_policies p
   where p.schemaname = 'public'
     and p.policyname in ('funcionarios_self_read','folhas_funcionario_read',
                          'folha_itens_funcionario_read','folha_adicionais_funcionario_read',
                          'cd_colaborador_select');
  insert into conf112 values (41, 'COLABORADOR', 'as cinco do proprio funcionario', v_n || ' de 5',
    case when v_n = 5 then 'OK' else 'ALGUMA SUMIU — o app do colaborador quebra' end);

  -- ═══════════ A TRAVA DA FOLHA FECHADA ═══════════
  -- Ela e anterior a qualquer discussao de tenancy: folha fechada nao aceita
  -- mexer nas linhas, e isso vale no banco.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('folha_itens','folha_adicionais','folhas')
     and coalesce(qual,'') || coalesce(with_check,'') like '%fechada%';
  insert into conf112 values (50, 'FOLHA FECHADA', 'policies que checam o status', v_n::text,
    case when v_n >= 6 then 'OK'
         else 'a trava afrouxou — folha fechada voltou a aceitar mudanca' end);

  select count(*) into v_n from public.folhas where status = 'fechada';
  insert into conf112 values (51, 'FOLHA FECHADA', 'folhas fechadas hoje', v_n::text, '');

  -- ═══════════ QUEM OPERA ═══════════
  for r in
    select coalesce((select u.email from auth.users u where u.id = ou.auth_user_id),
                    ou.auth_user_id::text)                                as quem,
           p.nome                                                         as perfil,
           ou.organizacao_id,
           (select string_agg(pm.chave || '=' ||
                     case when coalesce(
                            (select up.concede from public.usuario_permissoes up
                              where up.usuario_id = ou.id and up.permissao_chave = pm.chave),
                            (select true from public.perfil_permissoes pp
                              where pp.perfil_id = ou.perfil_id and pp.permissao_chave = pm.chave),
                            false)
                          then 'sim' else 'NAO' end, ', ' order by pm.chave)
              from public.permissoes pm where pm.chave like 'equipe.%')   as chaves
      from public.organizacao_usuarios ou
      join public.perfis p on p.id = ou.perfil_id
     where ou.status = 'ativo'
     order by p.nome
  loop
    insert into conf112 values (60, 'QUEM OPERA', r.quem,
      'perfil ' || r.perfil || ' | ' || coalesce(r.chaves, '(sem chaves)'),
      case when r.organizacao_id <> v_org then 'de outra organizacao'
           when r.chaves like '%equipe.folha=sim%' then 'opera a folha'
           else 'nao abre a folha' end);
  end loop;

  -- ═══════════ OS NUMEROS QUE NAO PODEM MUDAR ═══════════
  select count(*) into v_n from public.folhas;
  insert into conf112 values (70, 'DADO INTOCADO', 'folhas', v_n::text, '');
  select count(*) into v_n from public.folha_itens;
  insert into conf112 values (70, 'DADO INTOCADO', 'itens', v_n::text, '');
  select count(*) into v_n from public.funcionarios;
  insert into conf112 values (70, 'DADO INTOCADO', 'funcionarios', v_n::text, '');
  select count(*) into v_n from public.colaborador_documentos;
  insert into conf112 values (70, 'DADO INTOCADO', 'documentos', v_n::text, '');
  select count(*) into v_n from storage.objects where bucket_id = 'colaborador-documentos';
  insert into conf112 values (70, 'DADO INTOCADO', 'arquivos no bucket', v_n::text, '');
end $$;

select ordem, secao, item, valor, resultado from conf112 order by ordem, item;
