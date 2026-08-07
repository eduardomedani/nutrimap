-- ===========================================================================
-- Evollo · O nome do paciente vem do questionario quando o cadastro nao tem
-- ---------------------------------------------------------------------------
-- Um paciente cadastrado so pelo codigo nasce sem nome: quem digita o nome e o
-- profissional, e nesse fluxo ele nao digita nada. O questionario PERGUNTA o
-- nome (anamnese.html, campo q1_1) e guarda em `respostas`, mas nada nunca
-- levou esse valor para `pacientes.nome`.
--
-- O resultado aparece como "(SEM NOME)" em qualquer lista, e a pessoa fica
-- invisivel. Foi assim que um questionario completo de 30/06/2026 — 14 modulos
-- respondidos — passou cinco semanas sem ninguem perceber que existia.
--
-- O QUE ESTE SCRIPT FAZ:
--   1. um gatilho: ao salvar o modulo m1, se o cadastro nao tem nome, ele
--      recebe o nome, o e-mail e o telefone do questionario
--   2. um preenchimento unico, para quem ja respondeu antes do gatilho existir
--
-- SO PREENCHE O QUE ESTA VAZIO. Nunca sobrescreve nome digitado pelo
-- profissional: se ele escreveu "Maria (irma da Ana)", esse texto tem contexto
-- que o questionario nao tem.
--
-- E GATILHO, e nao alteracao das RPCs, porque `rpc_salvar_respostas` e
-- `rpc_marcar_completo` sao SECURITY DEFINER escritas antes do versionamento:
-- reescreve-las exigiria copiar um corpo que ninguem tem aqui, e perder uma
-- linha delas sairia caro. O gatilho e aditivo e nao encosta nelas.
--
-- Desfazer: db/paciente_nome_do_questionario_desfazer.sql
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

create or replace function public.fn_paciente_nome_do_questionario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_email text;
  v_fone  text;
begin
  if new.modulo is distinct from 'm1' then
    return new;
  end if;

  v_nome  := nullif(btrim(coalesce(new.dados ->> 'q1_1', '')), '');
  v_email := nullif(btrim(coalesce(new.dados ->> 'q1_2', '')), '');
  v_fone  := nullif(regexp_replace(coalesce(new.dados ->> 'q1_3', ''), '\D', '', 'g'), '');

  if v_nome is null and v_email is null and v_fone is null then
    return new;
  end if;

  -- `coalesce(nullif(btrim(...), ''), ...)` em cada coluna: o que ja estiver
  -- preenchido fica como esta. O questionario completa, nao corrige.
  update public.pacientes p
     set nome     = coalesce(nullif(btrim(coalesce(p.nome, '')), ''), v_nome),
         email    = coalesce(nullif(btrim(coalesce(p.email, '')), ''), v_email),
         telefone = coalesce(nullif(btrim(coalesce(p.telefone, '')), ''), v_fone)
   where p.id = new.paciente_id
     and (nullif(btrim(coalesce(p.nome, '')), '') is null
       or nullif(btrim(coalesce(p.email, '')), '') is null
       or nullif(btrim(coalesce(p.telefone, '')), '') is null);

  return new;
end;
$$;

drop trigger if exists trg_paciente_nome_do_questionario on public.respostas;
create trigger trg_paciente_nome_do_questionario
  after insert or update of dados on public.respostas
  for each row execute function public.fn_paciente_nome_do_questionario();


-- ===========================================================================
-- Preenchimento unico: quem respondeu ANTES de o gatilho existir
-- ===========================================================================
update public.pacientes p
   set nome     = coalesce(nullif(btrim(coalesce(p.nome, '')), ''),
                           nullif(btrim(coalesce(r.dados ->> 'q1_1', '')), '')),
       email    = coalesce(nullif(btrim(coalesce(p.email, '')), ''),
                           nullif(btrim(coalesce(r.dados ->> 'q1_2', '')), '')),
       telefone = coalesce(nullif(btrim(coalesce(p.telefone, '')), ''),
                           nullif(regexp_replace(coalesce(r.dados ->> 'q1_3', ''), '\D', '', 'g'), ''))
  from public.respostas r
 where r.paciente_id = p.id
   and r.modulo = 'm1'
   and nullif(btrim(coalesce(p.nome, '')), '') is null
   and nullif(btrim(coalesce(r.dados ->> 'q1_1', '')), '') is not null;


-- ===========================================================================
-- Conferencia. Esperado: sem_nome 0, e o gatilho existindo.
-- ===========================================================================
select
  (select count(*) from public.pacientes
    where nullif(btrim(coalesce(nome, '')), '') is null)          as sem_nome,
  (select count(*) from public.pacientes
    where nullif(btrim(coalesce(nome, '')), '') is null
      and exists (select 1 from public.respostas r
                   where r.paciente_id = pacientes.id and r.modulo = 'm1'))
                                                                  as sem_nome_mas_respondeu,
  (select count(*) from pg_trigger
    where tgname = 'trg_paciente_nome_do_questionario')            as gatilho;
