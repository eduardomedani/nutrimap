-- ===========================================================================
-- Evollo · Financeiro — CONTRACHEQUE PUBLICADO
-- ---------------------------------------------------------------------------
-- Ao fechar a folha, cada linha vira um HTML autossuficiente guardado no
-- Storage. E esse arquivo que o app do colaborador vai abrir, ao lado do
-- espelho de ponto do mesmo mes.
--
-- POR QUE ARQUIVO, E NAO RENDERIZAR NA HORA:
-- o contracheque e o documento de um pagamento que ja aconteceu. Montado a
-- partir da tabela, ele mudaria sozinho se a folha fosse reaberta e corrigida
-- — e o colaborador veria um recibo diferente do que assinou, sem nada
-- indicando a troca. O arquivo congela o que foi pago naquele dia.
--
-- `contracheque_gerado_em` e a data da PUBLICACAO, nao a do pagamento. Se a
-- folha for reaberta, corrigida e fechada de novo, esse carimbo muda e o
-- arquivo e substituido — o que ficou registrado e que houve nova versao.
--
-- Requer folha_schema.sql e funcionario_login_schema.sql. 100% re-executavel.
-- ===========================================================================

alter table public.folha_itens add column if not exists contracheque_arquivo   text;
alter table public.folha_itens add column if not exists contracheque_gerado_em timestamptz;


-- ===========================================================================
-- Bucket privado, mesma convencao de caminho do espelho de ponto:
--   <nutri_id>/<funcionario_id>/<competencia>-contracheque.html
-- A pasta 1 diz de quem e a conta; a pasta 2, de qual colaborador.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('contracheques', 'contracheques', false)
on conflict (id) do nothing;

drop policy if exists contracheque_nutri_all on storage.objects;
drop policy if exists contracheque_func_read on storage.objects;

create policy contracheque_nutri_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'contracheques'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'contracheques'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- O colaborador le so o que esta na PASTA DELE. O documento so existe depois
-- de a folha fechar, entao nao ha como ver rascunho por aqui.
create policy contracheque_func_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracheques'
    and (storage.foldername(name))[2] = public.funcionario_do_auth()::text
  );


-- ===========================================================================
-- Conferencia: bucket criado e nenhum contracheque publicado ainda.
-- ===========================================================================
select
  (select count(*) from storage.buckets where id = 'contracheques')            as bucket,
  (select count(*) from public.folha_itens where contracheque_arquivo is not null) as publicados;
