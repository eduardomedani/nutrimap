-- ===========================================================================
-- Evollo · CANAL COMERCIAL — o WhatsApp da organização para o app do aluno
-- ---------------------------------------------------------------------------
-- A vitrine do serviço não contratado (js/pwa-ofertas.js) mostra o botão
-- "Consultar planos pelo WhatsApp" SÓ quando a organização do paciente tem
-- um número configurado. Sem este script, o front cai na orientação
-- ("fale com a recepção ou com o seu profissional") — nada quebra.
--
-- O QUE MUDA:
--   1) organizacoes.whatsapp_comercial (texto só com dígitos, opcional).
--   2) rpc_paciente_canal_comercial(): devolve APENAS o nome da organização e
--      esse número, para o paciente logado. SECURITY DEFINER no padrão
--      rpc_paciente_*: nenhuma policy nova, nenhuma tabela exposta.
--
-- ADITIVO: nenhum dado existente muda; a coluna nasce vazia em todas as
-- organizações. Re-executável. Desfazer: db/canal_comercial_desfazer.sql
--
-- NÃO APLICADO. Rodar no SQL Editor do Supabase só depois de autorizado.
-- Para configurar (exemplo, trocar o nome e o número reais):
--   update public.organizacoes set whatsapp_comercial = '5511999999999'
--    where nome = '<nome da organização>';
-- ===========================================================================

alter table public.organizacoes add column if not exists whatsapp_comercial text;
alter table public.organizacoes drop constraint if exists organizacoes_whatsapp_comercial_valido;
alter table public.organizacoes add constraint organizacoes_whatsapp_comercial_valido
  check (whatsapp_comercial is null or whatsapp_comercial ~ '^[0-9]{10,13}$');

-- O paciente chega à organização pelo profissional que o cadastrou
-- (pacientes.nutri_id → organizacao_usuarios). Só organização ativa e vínculo
-- ativo; sem número, a linha não volta.
create or replace function public.rpc_paciente_canal_comercial()
returns table (
  organizacao text,
  whatsapp    text
)
language sql
stable
security definer
set search_path = public
as $$
  select o.nome, o.whatsapp_comercial
    from public.pacientes p
    join public.organizacao_usuarios ou
      on ou.auth_user_id = p.nutri_id and ou.status = 'ativo'
    join public.organizacoes o
      on o.id = ou.organizacao_id and o.ativo
   where p.id = public.paciente_do_auth()
     and o.whatsapp_comercial is not null
   limit 1;
$$;

revoke all on function public.rpc_paciente_canal_comercial() from public, anon;
grant execute on function public.rpc_paciente_canal_comercial() to authenticated;
