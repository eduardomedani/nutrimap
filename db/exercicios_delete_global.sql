-- ===========================================================================
-- Evollo · O FURO DO DELETE EM exercicios, ANTES DA PRIMEIRA LINHA GLOBAL
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE (so policies). Desfazer: db/exercicios_delete_global_desfazer.sql
--
-- 100% re-executavel.
--
-- ===========================================================================
-- O QUE ESTA ERRADO HOJE
-- ---------------------------------------------------------------------------
-- A policy que governa `exercicios` e uma so, para TODOS os comandos:
--
--     exercicios_owner · comando *
--     usando:    (nutri_id = auth.uid()) OR (nutri_id IS NULL)
--     com check: (nutri_id = auth.uid())
--
-- `with check` so e avaliado em INSERT e UPDATE. DELETE nao tem `with check` —
-- so `using`. E `using` aceita `nutri_id IS NULL`.
--
-- Entao: QUALQUER USUARIO AUTENTICADO PODE APAGAR UMA LINHA GLOBAL.
--
-- No UPDATE o efeito e outro e igualmente ruim: `using` deixa o usuario
-- alcancar a linha global, e `with check` exige que o resultado tenha
-- `nutri_id = auth.uid()`. Ele nao consegue editar mantendo global, mas
-- consegue TOMAR POSSE dela.
--
-- ===========================================================================
-- POR QUE AGORA, E POR QUE E SEGURO
-- ---------------------------------------------------------------------------
-- Hoje o banco tem 746 exercicios, TODOS com dono, ZERO globais. O furo e
-- latente: nao ha linha global para apagar. Medido em db/conferencia/127f.
--
-- Isso torna esta correcao um evento de risco zero: nenhuma linha existente
-- muda de comportamento, porque a diferenca so aparece em `nutri_id IS NULL`.
--
-- E torna o momento obrigatorio. O acervo global de midias vai inaugurar o
-- padrao. Consertar depois significa consertar com dado exposto.
--
-- ===========================================================================
-- O QUE MUDA, E O QUE NAO MUDA
-- ---------------------------------------------------------------------------
-- A policy unica vira quatro, uma por comando:
--
--   SELECT  identico ao de hoje — le o proprio E o global.
--   INSERT  identico — so cria com o proprio nutri_id.
--   UPDATE  MUDA: `using` deixa de aceitar global. Nao ha mais tomada de posse.
--   DELETE  MUDA: `using` deixa de aceitar global. E o conserto.
--
-- `exercicios_paciente_read` NAO E TOCADA. Ela e SELECT-only e ja esta certa.
--
-- Como `auth.uid()` nunca e NULL numa sessao autenticada, `nutri_id =
-- auth.uid()` e falso para toda linha global — que e exatamente o efeito
-- desejado em UPDATE e DELETE.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicios_delete_global_LIMPO.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) A POLICY UNICA SAI
-- ---------------------------------------------------------------------------
drop policy if exists exercicios_owner on public.exercicios;


-- ---------------------------------------------------------------------------
-- 2) QUATRO ENTRAM NO LUGAR
-- ---------------------------------------------------------------------------

-- Leitura: o proprio e o global. Igual ao que ja valia.
drop policy if exists exercicios_owner_select on public.exercicios;
create policy exercicios_owner_select on public.exercicios
  for select
  using (nutri_id = auth.uid() or nutri_id is null);

-- Criacao: so com o proprio dono. Ninguem cria global pelo app.
drop policy if exists exercicios_owner_insert on public.exercicios;
create policy exercicios_owner_insert on public.exercicios
  for insert
  with check (nutri_id = auth.uid());

-- Edicao: `using` sem a clausula global — a linha global fica FORA DE ALCANCE.
drop policy if exists exercicios_owner_update on public.exercicios;
create policy exercicios_owner_update on public.exercicios
  for update
  using (nutri_id = auth.uid())
  with check (nutri_id = auth.uid());

-- Exclusao: o conserto. Sem `nutri_id is null` no `using`.
drop policy if exists exercicios_owner_delete on public.exercicios;
create policy exercicios_owner_delete on public.exercicios
  for delete
  using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 3) CONFERENCIA
-- ---------------------------------------------------------------------------
-- Esperado: cinco policies. As quatro novas mais `exercicios_paciente_read`,
-- intacta. Nenhuma linha com comando '*'.
-- ---------------------------------------------------------------------------
select p.polname                               as politica,
       p.polcmd                                as comando,
       pg_get_expr(p.polqual, p.polrelid)      as usando,
       pg_get_expr(p.polwithcheck, p.polrelid) as com_check
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'exercicios'
order by p.polcmd, p.polname;
