-- ===========================================================================
-- Evollo · midias E exercicio_midias — O ACERVO DE ANIMACOES
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE (tabelas, indices, policies). NAO sobe arquivo, NAO
-- toca em `video_url`, NAO insere nenhuma midia.
--
-- Desfazer: db/exercicio_midias_desfazer.sql
-- Pre-requisito OBRIGATORIO: db/exercicios_delete_global.sql
-- Gate OBRIGATORIO antes de qualquer linha global: db/conferencia/128_rls_global_gate.sql
--
-- 100% re-executavel.
--
-- ===========================================================================
-- POR QUE UMA TABELA, E NAO MAIS UMA COLUNA
-- ---------------------------------------------------------------------------
-- `exercicios.video_url` e UM texto. A primeira leva tem, para o mesmo
-- exercicio, uma animacao masculina e uma feminina — duas midias, um
-- exercicio. Um campo escalar nao representa isso sem escolher uma e jogar a
-- outra fora.
--
-- E o caminho inverso tambem ja acontece HOJE, no dado que existe: a URL
-- `youtube.com/watch?v=zC3nLlEvin4` esta em QUATRO exercicios (rosca martelo,
-- alternada, cruzada e inclinada), e `sM6XUdt1rm4` em dois. O texto duplicado
-- e uma relacao muitos-para-muitos escrita a mao.
--
-- Estas tabelas nao inventam o comportamento. Passam a representa-lo.
--
-- ===========================================================================
-- O DESENHO DA PROPRIEDADE, QUE E A PARTE QUE IMPORTA
-- ---------------------------------------------------------------------------
-- Decisao do Eduardo: o acervo e CATALOGO GLOBAL do produto. O mesmo MP4 nao
-- se duplica por organizacao.
--
--   midias.nutri_id IS NULL           -> acervo do produto, todos leem
--   midias.nutri_id = <uuid>          -> video proprio de um profissional
--
-- Os exercicios, porem, sao PRIVADOS: 746 linhas, um dono, zero globais.
-- Midia global sozinha nao seria reutilizavel — outra organizacao nao tem as
-- linhas de `exercicios` para ligar nela.
--
-- Por isso o VINCULO tambem tem dono proprio, e tambem pode ser global:
--
--   exercicio_midias.nutri_id IS NULL -> vinculo de curadoria do produto
--   exercicio_midias.nutri_id = <uuid>-> ligacao que um profissional fez
--
-- Assim outra organizacao cria o SEU "Leg press" e aponta para a MESMA
-- `midia_id`. Zero duplicacao de arquivo.
--
-- ===========================================================================
-- ESTE SCRIPT INAUGURA `nutri_id IS NULL` NO BANCO
-- ---------------------------------------------------------------------------
-- Medido em db/conferencia/127f: 746 exercicios, 0 globais. O caminho global
-- da RLS existe na policy e NUNCA foi exercitado — sem dado, sem trafego, sem
-- comportamento observado.
--
-- Por isso as policies aqui NAO copiam `exercicios_owner`: aquela e uma policy
-- unica `for all`, e `for all` nao consegue proteger o DELETE (ver o cabecalho
-- de db/exercicios_delete_global.sql). Aqui e uma policy POR COMANDO desde o
-- inicio.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicio_midias_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) midias — O ARQUIVO
-- ---------------------------------------------------------------------------
create table if not exists public.midias (
  id             uuid primary key default gen_random_uuid(),

  -- NULL = catalogo global do produto. Preenchido = do profissional.
  nutri_id       uuid references auth.users(id) on delete cascade,

  -- 'mid_xxxxxxxx' — FNV-1a do nome do GIF de origem, calculado na conversao.
  -- E o que torna o seed re-executavel: rodar duas vezes nao cria duas linhas.
  -- Deriva do ARQUIVO, nao do exercicio: o cadastro pode ser renomeado sem que
  -- a midia mude de identidade.
  chave          text not null unique,

  tipo           text not null default 'animacao'
                   check (tipo in ('animacao', 'video')),

  -- Ou o arquivo e nosso (bucket + caminho), ou e link de terceiro (url).
  -- Nunca os dois, nunca nenhum — ver a constraint no fim do bloco.
  bucket         text,
  caminho        text,
  url            text,

  genero         text check (genero in ('masculino', 'feminino', 'neutro')),

  -- Procedencia. Daqui a um ano ninguem lembra que o MP4
  -- `cable-high-pulley-overhead-tricep-extension-upper-arms.mp4` saiu de
  -- MASCULINO/ACADEMIA/EXERCICIOS NO CABO OU POLIA/TRICEPS.
  origem_arquivo text,
  origem_pasta   text,

  largura        int,
  altura         int,
  duracao_s      numeric(6,2),
  frames         int,
  bytes          bigint,

  criado_em      timestamptz not null default now(),

  constraint midias_arquivo_ou_url check (
    (bucket is not null and caminho is not null and url is null) or
    (bucket is null     and caminho is null     and url is not null)
  )
);

alter table public.midias add column if not exists nutri_id       uuid;
alter table public.midias add column if not exists chave          text;
alter table public.midias add column if not exists tipo           text;
alter table public.midias add column if not exists bucket         text;
alter table public.midias add column if not exists caminho        text;
alter table public.midias add column if not exists url            text;
alter table public.midias add column if not exists genero         text;
alter table public.midias add column if not exists origem_arquivo text;
alter table public.midias add column if not exists origem_pasta   text;
alter table public.midias add column if not exists largura        int;
alter table public.midias add column if not exists altura         int;
alter table public.midias add column if not exists duracao_s      numeric(6,2);
alter table public.midias add column if not exists frames         int;
alter table public.midias add column if not exists bytes          bigint;

create index if not exists idx_midias_nutri  on public.midias (nutri_id);
create index if not exists idx_midias_global on public.midias (id) where nutri_id is null;


-- ---------------------------------------------------------------------------
-- 2) exercicio_midias — O VINCULO
-- ---------------------------------------------------------------------------
create table if not exists public.exercicio_midias (
  id           uuid primary key default gen_random_uuid(),

  -- Dono do VINCULO, nao da midia. NULL = vinculo de curadoria do produto.
  nutri_id     uuid references auth.users(id) on delete cascade,

  exercicio_id uuid not null references public.exercicios(id) on delete cascade,

  -- `restrict`, nao `cascade`: apagar midia usada por alguem tem que FALHAR,
  -- em vez de deixar exercicio sem demonstracao sem ninguem perceber.
  midia_id     uuid not null references public.midias(id) on delete restrict,

  papel        text not null default 'principal'
                 check (papel in ('principal', 'equivalente')),
  ordem        smallint not null default 0,
  criado_em    timestamptz not null default now(),

  -- O mesmo par nao entra duas vezes. E o que segura o seed re-executavel.
  unique (exercicio_id, midia_id)
);

alter table public.exercicio_midias add column if not exists nutri_id uuid;
alter table public.exercicio_midias add column if not exists papel    text;
alter table public.exercicio_midias add column if not exists ordem    smallint;

create index if not exists idx_em_exercicio on public.exercicio_midias (exercicio_id);
create index if not exists idx_em_midia     on public.exercicio_midias (midia_id);
create index if not exists idx_em_nutri     on public.exercicio_midias (nutri_id);


-- ---------------------------------------------------------------------------
-- 3) RLS DE midias
-- ---------------------------------------------------------------------------
-- A leitura tem tres vias, e a primeira e a que separa profissional de aluno:
--
--   global      — SO para MEMBRO ATIVO da organizacao. `organizacao_do_auth()`
--                 volta o id da organizacao para quem esta em
--                 `organizacao_usuarios` com status 'ativo', e NULL para o
--                 resto. Sem esta condicao, um aluno faria
--                 `select * from midias` e receberia o acervo inteiro: era o
--                 requisito "paciente nao ganha listagem irrestrita".
--   propria     — o video que o profissional enviou.
--   via treino  — o aluno le a midia do exercicio que esta no treino DELE, e
--                 so essa. E o mesmo caminho de `exercicios_paciente_read`.
--
-- A PRIMEIRA VERSAO DISTO ESCREVIA `paciente_do_auth() is null`, tratando "nao
-- e paciente" como sinonimo de "e profissional". O gate 128 derrubou: a prova
-- 3 falhou (o dono nao lia a propria global) enquanto a 6 passava. O motivo
-- esta em db/conferencia/128b: o auth user que possui os 746 exercicios TAMBEM
-- tem cadastro em `pacientes` — alguem que criou um paciente para si mesmo
-- para ver o app do aluno. Configuracao legitima, e os dois papeis nao se
-- excluem.
--
-- `organizacao_do_auth()` pergunta a coisa certa, e de quebra filtra
-- `status = 'ativo'` e `o.ativo`: funcionario desligado perde o acervo sem que
-- ninguem precise lembrar de revogar nada.
--
-- Escrita: tres policies, uma por comando. `auth.uid()` nunca e NULL numa
-- sessao autenticada, entao `nutri_id = auth.uid()` e FALSO para toda linha
-- global — usuario comum nao cria, nao edita e nao apaga o acervo do produto.
-- O acervo entra por `service_role`, que ignora RLS.
-- ---------------------------------------------------------------------------
alter table public.midias enable row level security;

drop policy if exists midias_read on public.midias;
create policy midias_read on public.midias
  for select
  using (
    (nutri_id is null and public.organizacao_do_auth() is not null)
    or nutri_id = auth.uid()
    or exists (
         select 1
           from public.exercicio_midias em
           join public.treino_exercicios te on te.exercicio_id = em.exercicio_id
           join public.treinos t            on t.id = te.treino_id
          where em.midia_id = midias.id
            and t.paciente_id = public.paciente_do_auth())
  );

drop policy if exists midias_insert on public.midias;
create policy midias_insert on public.midias
  for insert
  with check (nutri_id = auth.uid());

drop policy if exists midias_update on public.midias;
create policy midias_update on public.midias
  for update
  using      (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists midias_delete on public.midias;
create policy midias_delete on public.midias
  for delete
  using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 4) RLS DE exercicio_midias
-- ---------------------------------------------------------------------------
-- Mesma forma. O vinculo global e legivel por profissional; o aluno le apenas
-- o vinculo dos exercicios do proprio treino.
-- ---------------------------------------------------------------------------
alter table public.exercicio_midias enable row level security;

drop policy if exists exercicio_midias_read on public.exercicio_midias;
create policy exercicio_midias_read on public.exercicio_midias
  for select
  using (
    (nutri_id is null and public.organizacao_do_auth() is not null)
    or nutri_id = auth.uid()
    or exists (
         select 1
           from public.treino_exercicios te
           join public.treinos t on t.id = te.treino_id
          where te.exercicio_id = exercicio_midias.exercicio_id
            and t.paciente_id = public.paciente_do_auth())
  );

drop policy if exists exercicio_midias_insert on public.exercicio_midias;
create policy exercicio_midias_insert on public.exercicio_midias
  for insert
  with check (nutri_id = auth.uid());

drop policy if exists exercicio_midias_update on public.exercicio_midias;
create policy exercicio_midias_update on public.exercicio_midias
  for update
  using      (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

drop policy if exists exercicio_midias_delete on public.exercicio_midias;
create policy exercicio_midias_delete on public.exercicio_midias
  for delete
  using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 5) GRANTS
-- ---------------------------------------------------------------------------
-- Sem GRANT a RLS nao chega a ser avaliada: o acesso morre antes, na permissao
-- da tabela. `anon` NAO recebe nada — o app do aluno autentica.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.midias           to authenticated;
grant select, insert, update, delete on public.exercicio_midias to authenticated;

revoke all on public.midias           from anon;
revoke all on public.exercicio_midias from anon;


-- ---------------------------------------------------------------------------
-- 6) CONFERENCIA
-- ---------------------------------------------------------------------------
-- Esperado: duas tabelas, RLS ligada nas duas, 4 policies em cada, 0 linhas.
-- Isto NAO prova que a RLS funciona — o SQL Editor roda como service_role, que
-- a ignora. A prova e db/conferencia/128_rls_global_gate.sql.
-- ---------------------------------------------------------------------------
select c.relname                                   as tabela,
       c.relrowsecurity                            as rls_ligada,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as colunas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('midias', 'exercicio_midias')
order by c.relname;
