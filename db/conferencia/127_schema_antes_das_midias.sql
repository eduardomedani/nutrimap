-- ===========================================================================
-- O TERRENO ANTES DE CRIAR exercicio_midias E midias
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. Nenhuma tabela e criada, nenhum `video_url` e tocado.
--
-- POR QUE ELE EXISTE. O modelo novo (exercicios ↕ exercicio_midias ↕ midias)
-- so pode ser escrito depois de saber tres coisas que nao estao no repositorio:
--
--   1. se `exercicio_midias` ou `midias` JA existem neste banco, com outro
--      desenho — criar por cima seria destruir dado alheio;
--   2. como `video_url` esta sendo usado HOJE, arquivo por arquivo, para que a
--      migracao saiba o que preservar (sao URLs externas de clipe gratuito,
--      nao arquivos nossos: nao se apaga o que nao se pode reproduzir);
--   3. qual o formato de multi-tenancy que as tabelas novas tem que seguir.
--      `exercicios` tem `nutri_id` — se o catalogo e por organizacao, a midia
--      tambem precisa ser, ou a RLS da tabela nova sera a porta de entrada
--      para o dado de um cliente aparecer no outro.
--
-- Rodar no SQL Editor do Supabase e me mandar as saidas.
-- Para colar, use db/conferencia/127_schema_antes_das_midias_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) AS TABELAS DO MODELO JA EXISTEM?
-- ---------------------------------------------------------------------------
-- Se vier linha, o desenho novo tem que conviver com o que ja esta la, e nao
-- substituir. Se vier vazio, o terreno esta limpo.
-- ---------------------------------------------------------------------------
select c.relname                              as tabela,
       c.relrowsecurity                       as rls_ligada,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
                                              as colunas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('midias', 'exercicio_midias', 'exercicio_midia', 'exercicios_midias')
order by c.relname;


-- ---------------------------------------------------------------------------
-- 2) O QUE HA HOJE EM video_url
-- ---------------------------------------------------------------------------
-- Os 14 sao URLs externas. A migracao NAO pode apaga-las junto com a troca de
-- modelo: sao clipes que nao estao em disco nosso e que nao se reconstroi.
-- ---------------------------------------------------------------------------
select count(*)                                                  as exercicios,
       count(e.video_url) filter (where e.video_url <> '')        as com_video,
       count(*) filter (where e.video_url like 'http%')           as url_externa,
       count(distinct e.nutri_id)                                 as organizacoes
from public.exercicios e;

select e.nome,
       e.grupo_muscular,
       split_part(replace(e.video_url, 'https://', ''), '/', 1) as dominio,
       e.video_url
from public.exercicios e
where e.video_url is not null and e.video_url <> ''
order by e.nome;


-- ---------------------------------------------------------------------------
-- 3) O MOLDE DE MULTI-TENANCY QUE AS TABELAS NOVAS TEM QUE COPIAR
-- ---------------------------------------------------------------------------
-- Nao invento politica: copio a que ja governa `exercicios`. Se o catalogo e
-- por organizacao, a midia tem que ser tambem — ou a tabela nova vira o furo.
-- ---------------------------------------------------------------------------
select p.polname                              as politica,
       p.polcmd                               as comando,
       pg_get_expr(p.polqual, p.polrelid)     as usando,
       pg_get_expr(p.polwithcheck, p.polrelid) as com_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'exercicios'
order by p.polcmd, p.polname;


-- ---------------------------------------------------------------------------
-- 4) OS BUCKETS DE STORAGE QUE JA EXISTEM
-- ---------------------------------------------------------------------------
-- Para decidir se o MP4 vai para um bucket novo ou para um existente — e se o
-- que existe e publico, porque animacao de exercicio o aluno precisa ver sem
-- sessao autenticada em alguns fluxos.
-- ---------------------------------------------------------------------------
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
order by name;


-- ---------------------------------------------------------------------------
-- 5) QUANTOS EXERCICIOS ESTAO REALMENTE PRESCRITOS
-- ---------------------------------------------------------------------------
-- Da a medida do que 54 animacoes cobrem: o alvo nao e o catalogo de 746, e o
-- que os alunos de fato recebem.
-- ---------------------------------------------------------------------------
select count(distinct te.exercicio_id)                          as exercicios_prescritos,
       count(distinct te.exercicio_id) filter
         (where e.video_url is not null and e.video_url <> '')   as ja_com_video,
       count(*)                                                 as linhas_de_prescricao
from public.treino_exercicios te
join public.exercicios e on e.id = te.exercicio_id;
