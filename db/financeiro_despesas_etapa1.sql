-- ===========================================================================
-- Evollo · Financeiro — DESPESAS, ETAPA 1 (schema)
-- ---------------------------------------------------------------------------
-- O cadastro de despesa precisa de tres coisas que a tabela ainda nao tinha:
-- um CICLO DE VIDA (pendente/pago/cancelado), um VENCIMENTO (sem ele nao existe
-- "contas a pagar") e um CENTRO DE CUSTO de verdade.
--
-- SOBRE O CENTRO DE CUSTO: a importacao de custos.csv leu a coluna
-- "CENTRO DE CUSTO" e gravou aqueles nomes como CATEGORIA. Foi um erro de
-- modelagem: ADMINISTRATIVO e OBRAS E EXPANSAO dizem ONDE o dinheiro foi
-- alocado, nao QUAL e a natureza do gasto. Este arquivo cria a entidade certa;
-- o movimento dos dados fica em db/financeiro_centros_custo_migrar.sql, para
-- ser rodado e conferido em separado.
--
-- SOBRE O STATUS: a tabela tinha `pago boolean`, que nao distingue "ainda nao
-- venceu" de "cancelado". O booleano CONTINUA existindo e sincronizado por
-- trigger — 2.487 linhas ja gravadas e todo o codigo da tela leem `pago`, e
-- trocar as duas coisas no mesmo passo seria trocar o pneu com o carro andando.
-- Nenhum valor monetario e tocado aqui: `status` e traduzido de um booleano que
-- ja existia.
--
-- "VENCIDO" NAO E STATUS GRAVADO. Vencido e pendente + vencimento no passado,
-- e isso muda sozinho a cada meia-noite. Gravar exigiria alguem rodando um job
-- para reescrever linhas todo dia, e uma linha nao reescrita mentiria.
--
-- Requer db/financeiro_lancamentos.sql. 100% re-executavel.
-- Desfazer: db/financeiro_despesas_etapa1_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================


-- ===========================================================================
-- 1) financeiro_centros_custo — ONDE o dinheiro foi alocado
-- ---------------------------------------------------------------------------
-- Entidade separada de `financeiro_categorias`, que responde outra pergunta:
-- categoria e a NATUREZA do gasto (Energia, Contabilidade, Aluguel), centro de
-- custo e a ALOCACAO (Estrutura, Administrativo, Marketing). "Energia do
-- Administrativo" precisa das duas para ser respondida, e uma dimensao so
-- obriga a escolher qual das perguntas fica sem resposta.
-- ===========================================================================
create table if not exists public.financeiro_centros_custo (
  id            uuid primary key default gen_random_uuid(),
  nutri_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,

  nome          text not null,
  descricao     text,
  ativo         boolean not null default true,
  ordem         integer not null default 0,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.financeiro_centros_custo add column if not exists descricao     text;
alter table public.financeiro_centros_custo add column if not exists ativo         boolean not null default true;
alter table public.financeiro_centros_custo add column if not exists ordem         integer not null default 0;
alter table public.financeiro_centros_custo add column if not exists criado_em     timestamptz not null default now();
alter table public.financeiro_centros_custo add column if not exists atualizado_em timestamptz not null default now();

create unique index if not exists uniq_financeiro_centros_custo_nome
  on public.financeiro_centros_custo (nutri_id, lower(nome));


-- ===========================================================================
-- 2) financeiro_lancamentos ganha o ciclo de vida
-- ---------------------------------------------------------------------------
-- `data` PERMANECE como o dia do movimento e continua sendo a origem da
-- competencia. Vencimento e pagamento sao datas NOVAS e distintas:
--
--   competencia -> a que mes a despesa pertence   (analise gerencial)
--   vencimento  -> quando vence                    (contas a pagar)
--   pago_em     -> quando o dinheiro saiu          (fluxo de caixa realizado)
--
-- Usar uma data para os tres contextos e o defeito classico do modulo
-- financeiro: o relatorio do mes fecha certo e o fluxo de caixa fica errado,
-- ou o contrario, e nao ha como saber qual dos dois esta mentindo.
-- ===========================================================================
alter table public.financeiro_lancamentos add column if not exists status          text;
alter table public.financeiro_lancamentos add column if not exists vencimento      date;
alter table public.financeiro_lancamentos add column if not exists pago_em         date;
alter table public.financeiro_lancamentos add column if not exists centro_custo_id uuid references public.financeiro_centros_custo(id) on delete set null;
alter table public.financeiro_lancamentos add column if not exists fornecedor      text;
alter table public.financeiro_lancamentos add column if not exists forma_pagamento text;
alter table public.financeiro_lancamentos add column if not exists documento       text;
alter table public.financeiro_lancamentos add column if not exists metadata        jsonb not null default '{}'::jsonb;
alter table public.financeiro_lancamentos add column if not exists atualizado_por  uuid;
alter table public.financeiro_lancamentos add column if not exists arquivado_em    timestamptz;

-- Backfill: traduz o booleano que ja existia. Roda so onde status ainda e nulo,
-- entao reexecutar nao desfaz nada que voce tenha mudado na tela depois.
update public.financeiro_lancamentos
   set status = case when pago then 'pago' else 'pendente' end
 where status is null;

alter table public.financeiro_lancamentos alter column status set default 'pendente';
alter table public.financeiro_lancamentos alter column status set not null;

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_status_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_status_check
  check (status in ('pendente', 'pago', 'cancelado'));

-- Pago sem data de pagamento deixaria o fluxo de caixa realizado sem eixo.
-- Nas linhas importadas, a data do movimento E a data do pagamento.
update public.financeiro_lancamentos
   set pago_em = data
 where status = 'pago' and pago_em is null;

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_pago_em_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_pago_em_check
  check (status <> 'pago' or pago_em is not null);

alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_forma_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_forma_check
  check (forma_pagamento is null or forma_pagamento in
    ('pix', 'dinheiro', 'boleto', 'debito', 'credito', 'transferencia', 'debito_automatico', 'outro'));

create index if not exists idx_financeiro_lancamentos_status
  on public.financeiro_lancamentos (nutri_id, status);
-- Indice parcial: "contas a pagar" so olha o que esta pendente e tem data.
create index if not exists idx_financeiro_lancamentos_vencimento
  on public.financeiro_lancamentos (nutri_id, vencimento)
  where status = 'pendente' and vencimento is not null;
create index if not exists idx_financeiro_lancamentos_pago_em
  on public.financeiro_lancamentos (nutri_id, pago_em) where pago_em is not null;
create index if not exists idx_financeiro_lancamentos_centro
  on public.financeiro_lancamentos (centro_custo_id);


-- ===========================================================================
-- 3) `pago` e `status` nao podem discordar
-- ---------------------------------------------------------------------------
-- Os dois vao coexistir enquanto a tela migra. Duas colunas dizendo a mesma
-- coisa divergem no primeiro update que toca so uma — entao o banco sincroniza,
-- em vez de confiar em quem escreve. A direcao e status -> pago quando o status
-- muda, e pago -> status quando so o booleano muda (o codigo antigo).
-- ===========================================================================
create or replace function public.sincronizar_pago_status()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.status is null then
      new.status := case when new.pago then 'pago' else 'pendente' end;
    else
      new.pago := (new.status = 'pago');
    end if;
    if new.status = 'pago' and new.pago_em is null then
      new.pago_em := new.data;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.pago := (new.status = 'pago');
    if new.status = 'pago' and new.pago_em is null then
      new.pago_em := coalesce(new.pago_em, current_date);
    end if;
  elsif new.pago is distinct from old.pago then
    new.status := case when new.pago then 'pago' else 'pendente' end;
    if new.pago and new.pago_em is null then new.pago_em := current_date; end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_sincronizar_pago_status on public.financeiro_lancamentos;
create trigger trg_sincronizar_pago_status
  before insert or update on public.financeiro_lancamentos
  for each row execute function public.sincronizar_pago_status();


-- ===========================================================================
-- 4) financeiro_auditoria — quem mudou o que, e para o que
-- ---------------------------------------------------------------------------
-- Mesmo formato de public.documento_auditoria, que ja funciona. NAO reaproveitei
-- aquela tabela: ela tem documento_id e colaborador_id proprios, e alargar o
-- schema dos documentos trabalhistas para caber despesa poria em risco algo que
-- ja esta em producao para ganhar uma tabela.
--
-- `antes` e `depois` guardam so os campos que mudaram. Gravar a linha inteira
-- encheria a tabela de ruido e esconderia a mudanca no meio dela.
-- ===========================================================================
create table if not exists public.financeiro_auditoria (
  id           uuid primary key default gen_random_uuid(),
  nutri_id     uuid not null,
  lancamento_id uuid,
  acao         text not null,
  usuario_id   uuid,
  antes        jsonb not null default '{}'::jsonb,
  depois       jsonb not null default '{}'::jsonb,
  criado_em    timestamptz not null default now()
);

create index if not exists idx_fa_lancamento
  on public.financeiro_auditoria (lancamento_id, criado_em desc);
create index if not exists idx_fa_nutri
  on public.financeiro_auditoria (nutri_id, criado_em desc);

-- SECURITY DEFINER: a trilha tem que ser gravada mesmo que a policy de INSERT
-- da auditoria nao valha para quem esta editando. Sem isso, o unico jeito de
-- nao deixar rastro seria justamente o caminho que interessa registrar.
create or replace function public.registrar_auditoria_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_antes  jsonb := '{}'::jsonb;
  v_depois jsonb := '{}'::jsonb;
  v_acao   text;
  v_campo  text;
begin
  if tg_op = 'INSERT' then
    insert into public.financeiro_auditoria (nutri_id, lancamento_id, acao, usuario_id, depois)
    values (new.nutri_id, new.id, 'criado', auth.uid(),
            jsonb_build_object('descricao', new.descricao, 'valor', new.valor,
                               'status', new.status, 'competencia', new.competencia));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.financeiro_auditoria (nutri_id, lancamento_id, acao, usuario_id, antes)
    values (old.nutri_id, old.id, 'excluido', auth.uid(),
            jsonb_build_object('descricao', old.descricao, 'valor', old.valor,
                               'status', old.status, 'competencia', old.competencia));
    return old;
  end if;

  -- Só os campos que mudaram, e só os que importam para o dinheiro.
  foreach v_campo in array array['descricao', 'valor', 'status', 'competencia',
                                 'vencimento', 'pago_em', 'categoria_id',
                                 'centro_custo_id', 'fornecedor', 'forma_pagamento']
  loop
    if to_jsonb(old) -> v_campo is distinct from to_jsonb(new) -> v_campo then
      v_antes  := v_antes  || jsonb_build_object(v_campo, to_jsonb(old) -> v_campo);
      v_depois := v_depois || jsonb_build_object(v_campo, to_jsonb(new) -> v_campo);
    end if;
  end loop;

  if v_antes = '{}'::jsonb then return new; end if;   -- nada que interesse mudou

  v_acao := case
    when v_depois ? 'status' and new.status = 'pago'      then 'pago'
    when v_depois ? 'status' and new.status = 'cancelado' then 'cancelado'
    else 'editado' end;

  insert into public.financeiro_auditoria (nutri_id, lancamento_id, acao, usuario_id, antes, depois)
  values (new.nutri_id, new.id, v_acao, auth.uid(), v_antes, v_depois);
  return new;
end;
$fn$;

drop trigger if exists trg_auditoria_financeiro on public.financeiro_lancamentos;
create trigger trg_auditoria_financeiro
  after insert or update or delete on public.financeiro_lancamentos
  for each row execute function public.registrar_auditoria_financeiro();


-- ===========================================================================
-- 5) A visao de resumo passa a ignorar o cancelado
-- ---------------------------------------------------------------------------
-- Cancelado nao e dinheiro: somar no total transformaria uma despesa desfeita
-- em custo. Ele continua na tabela e na lista, com o rotulo, porque apagar o
-- registro apagaria tambem a informacao de que aquilo um dia existiu.
-- ===========================================================================
create or replace view public.financeiro_resumo_mensal
with (security_invoker = on) as
select
  l.nutri_id,
  l.competencia,
  l.tipo,
  count(*)                                                     as lancamentos,
  count(*) filter (where l.valor is null)                      as pendentes,
  coalesce(sum(l.valor), 0)                                    as total,
  coalesce(sum(l.valor) filter (where l.status = 'pago'), 0)   as total_pago,
  coalesce(sum(l.valor) filter (where l.status = 'pendente'), 0) as total_aberto
from public.financeiro_lancamentos l
where l.status <> 'cancelado' and l.arquivado_em is null
group by l.nutri_id, l.competencia, l.tipo;


-- ===========================================================================
-- 6) RLS
-- ===========================================================================
alter table public.financeiro_centros_custo enable row level security;
alter table public.financeiro_auditoria     enable row level security;

drop policy if exists financeiro_centros_custo_select on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_insert on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_update on public.financeiro_centros_custo;
drop policy if exists financeiro_centros_custo_delete on public.financeiro_centros_custo;

create policy financeiro_centros_custo_select on public.financeiro_centros_custo
  for select to authenticated using (nutri_id = auth.uid());
create policy financeiro_centros_custo_insert on public.financeiro_centros_custo
  for insert to authenticated with check (nutri_id = auth.uid());
create policy financeiro_centros_custo_update on public.financeiro_centros_custo
  for update to authenticated using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());
create policy financeiro_centros_custo_delete on public.financeiro_centros_custo
  for delete to authenticated using (nutri_id = auth.uid());

-- Auditoria e SO LEITURA para quem usa o app. Quem escreve e o trigger, com
-- security definer. Uma trilha que o proprio auditado pode editar ou apagar nao
-- e trilha — e a possibilidade de apaga-la e exatamente o que ela existe para
-- impedir.
drop policy if exists financeiro_auditoria_select on public.financeiro_auditoria;
create policy financeiro_auditoria_select on public.financeiro_auditoria
  for select to authenticated using (nutri_id = auth.uid());

-- O lancamento passa a validar tambem o centro de custo: sem isso, um id de
-- outra conta entraria pela API e o relatorio dela somaria uma linha alheia.
drop policy if exists financeiro_lancamentos_insert on public.financeiro_lancamentos;
drop policy if exists financeiro_lancamentos_update on public.financeiro_lancamentos;

create policy financeiro_lancamentos_insert on public.financeiro_lancamentos
  for insert to authenticated
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = auth.uid()))
  );
create policy financeiro_lancamentos_update on public.financeiro_lancamentos
  for update to authenticated
  using (nutri_id = auth.uid())
  with check (
    nutri_id = auth.uid()
    and (categoria_id is null or exists (
      select 1 from public.financeiro_categorias c
       where c.id = categoria_id and c.nutri_id = auth.uid()))
    and (centro_custo_id is null or exists (
      select 1 from public.financeiro_centros_custo cc
       where cc.id = centro_custo_id and cc.nutri_id = auth.uid()))
  );


-- ===========================================================================
-- Conferencia. Esperado: 3 tabelas com RLS, status preenchido em TODAS as
-- linhas, 0 pagos sem data de pagamento, e a view com security_invoker.
-- ===========================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('financeiro_categorias', 'financeiro_lancamentos',
                        'financeiro_centros_custo', 'financeiro_auditoria')
      and rowsecurity)                                          as tabelas_com_rls,
  (select count(*) from public.financeiro_lancamentos where status is null) as sem_status,
  (select count(*) from public.financeiro_lancamentos
    where status = 'pago' and pago_em is null)                  as pago_sem_data,
  (select count(*) from public.financeiro_lancamentos where status = 'pago')      as pagos,
  (select count(*) from public.financeiro_lancamentos where status = 'pendente')  as pendentes,
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_options_to_table(c.reloptions) o on o.option_name = 'security_invoker'
    where n.nspname = 'public' and c.relname = 'financeiro_resumo_mensal'
      and o.option_value in ('on', 'true'))                     as view_segura;
