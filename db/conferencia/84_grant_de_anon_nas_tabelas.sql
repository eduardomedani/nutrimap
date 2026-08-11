-- ===========================================================================
-- O GRANT DE anon NAS TABELAS — o check-in trouxe isso, ou ja era assim?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. Um select so.
--
-- POR QUE ESTE SCRIPT EXISTE. O script 83 acusou, nas seis tabelas novas de
-- check-in, `anon: SELECT`. A pergunta que decide o que fazer e uma so:
--
--   isso e uma REGRESSAO que a aplicacao de agora introduziu,
--   ou e a LINHA DE BASE do projeto inteiro?
--
-- Sao diagnosticos opostos. Se so o check-in tem, o schema dele fez algo
-- diferente e precisa ser corrigido. Se as 62 tabelas tem, o grant vem do
-- `alter default privileges` que o proprio Supabase configura no schema
-- public, e o check-in apenas herdou o padrao — corrigir so ele seria remendo
-- em um lugar de sessenta.
--
-- ---------------------------------------------------------------------------
-- O GRANT SOZINHO NAO VAZA NADA, E ISSO IMPORTA PARA NAO EXAGERAR O ALARME
-- ---------------------------------------------------------------------------
-- Grant de tabela e RLS sao duas portas em serie. As onze policies de check-in
-- sao `to authenticated`; com RLS ligada e nenhuma policy que alcance `anon`,
-- o anonimo tem a chave da porta e encontra a sala vazia — le zero linha.
--
-- O que o grant custa e a segunda camada: no dia em que alguem criar uma
-- policy sem `to authenticated`, ela passa a valer para o anonimo tambem, e
-- ninguem escreveu isso em lugar nenhum. E defesa em profundidade, nao
-- vazamento.
--
-- A coluna `rls` e a que separa risco real de risco teorico: tabela com grant
-- de anon E SEM RLS esta aberta de verdade.
--
-- Para colar no SQL Editor, use db/conferencia/84_grant_de_anon_nas_tabelas_LIMPO.sql
-- ===========================================================================

with tabelas as (
  select c.relname::text as tabela, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
medido as (
  select t.tabela, t.rls,
         has_table_privilege('anon',          'public.' || t.tabela, 'select') as anon_le,
         has_table_privilege('anon',          'public.' || t.tabela, 'insert') as anon_escreve,
         has_table_privilege('authenticated', 'public.' || t.tabela, 'select') as auth_le,
         t.tabela like 'checkin!_%' escape '!'                                 as e_checkin,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tabela
             and 'anon' = any(p.roles))                                        as policies_para_anon
    from tabelas t
)
-- O numero na frente do `item` e o que ordena o resumo. Sem ele, o
-- `order by` alfabetico embaralharia as oito linhas e a leitura se perderia.
select 'A RESUMO' as bloco, item, valor, nota from (
  values
    ('1 tabelas em public',
        (select count(*)::text from medido), ''),
    ('2 com SELECT para anon',
        (select count(*)::text from medido where anon_le),
        'se for igual ao total, o grant vem do default privileges do Supabase'),
    ('3 DAS QUAIS sao de check-in',
        (select count(*)::text from medido where anon_le and e_checkin),
        'seis significa que o check-in seguiu o padrao, nao que criou o problema'),
    ('4 com INSERT para anon',
        (select count(*)::text from medido where anon_escreve), ''),
    ('5 com grant de anon E SEM RLS',
        (select count(*)::text from medido where anon_le and not rls),
        'ESTE e o numero que importa: zero = nenhuma tabela realmente aberta'),
    ('6 com policy que alcanca anon',
        (select count(*)::text from medido where policies_para_anon > 0),
        'policy to public ou to anon transforma o grant em leitura de verdade'),
    ('7 sem SELECT para authenticated',
        (select count(*)::text from medido where not auth_le),
        'qualquer numero acima de zero e tabela que o front nao consegue ler'),
    ('8 VEREDITO',
        case
          when (select count(*) from medido where anon_le and not rls) > 0
            then 'HA TABELA ABERTA PARA ANON'
          when (select count(*) from medido where policies_para_anon > 0) > 0
            then 'HA POLICY ALCANCANDO ANON'
          when (select count(*) from medido where anon_le)
             = (select count(*) from medido)
            then 'LINHA DE BASE DO PROJETO — o check-in nao introduziu nada'
          when (select count(*) from medido where anon_le and e_checkin) = 6
           and (select count(*) from medido where anon_le and not e_checkin) = 0
            then 'REGRESSAO — so o check-in tem o grant'
          else 'MISTO — ver a lista abaixo'
        end, '')
) as t(item, valor, nota)
union all
select 'B SEM RLS', tabela, 'anon le: ' || anon_le::text, 'RLS DESLIGADA'
  from medido where not rls
union all
select 'C POLICY PARA ANON', tabela, policies_para_anon::text || ' policies', ''
  from medido where policies_para_anon > 0
union all
select 'D SEM GRANT PARA ANON', tabela, 'anon nao le', 'excecao ao padrao'
  from medido where not anon_le
order by 1, 2;
