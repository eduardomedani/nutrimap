-- ===========================================================================
-- OBJETO ESTRANHO AO EVOLLO — public.pedcrm_novo_membro()
-- ---------------------------------------------------------------------------
-- NAO E MIGRATION. NAO E BASELINE DO EVOLLO. NAO EXECUTE.
--
-- Este arquivo nao versiona um objeto do produto: ele REGISTRA um objeto de
-- OUTRO produto que esta vivo neste banco. O nome do arquivo nao termina em
-- `_baseline.sql` de proposito — o baseline legado do Evollo e o retrato do
-- que e nosso, e isto aqui nao e.
--
-- Existe para que o script de prontidao pare de acusar "objeto desconhecido"
-- sem que ninguem consiga dizer o que ele e. Classificado, o objeto deixa de
-- ser desconhecido; continua sendo estranho.
--
-- Retrato lido do banco em 11/08/2026 com pg_get_functiondef
-- (db/conferencia/81_signup_e_pedcrm.sql, blocos A, B e F).
--
-- ===========================================================================
-- CLASSIFICACAO: PEDCRM
-- ---------------------------------------------------------------------------
-- Nao e COMPARTILHADO, e a distincao importa. Compartilhado seria "os dois
-- produtos usam este banco". O que ha e residuo: a funcao veio junto, as
-- tabelas dela nao.
--
-- A PROVA. A funcao le public.clinicas e escreve public.membros_clinica.
-- Nenhuma das duas existe aqui. O bloco F do 81 listou as 56 tabelas de
-- public, e nem `clinicas` nem `membros_clinica` estao na lista. Nao ha
-- schema fora do padrao, e o unico objeto com cara de outro produto e esta
-- funcao. O banco NAO e compartilhado.
--
-- COMO ELA CHEGOU AQUI. O caminho mais provavel e um script do PedCRM rodado
-- com o SQL Editor apontando para o projeto errado. E exatamente o mesmo erro
-- que produziu, em sentido inverso, o "relation public.nutricionistas does
-- not exist" investigado pelo script 80.
--
-- REFERENCIA NO FRONTEND DO EVOLLO: nenhuma. Busca por "pedcrm" em js, html,
-- sql e mjs devolveu zero ocorrencia.
--
-- ===========================================================================
-- O RISCO REAL, QUE NAO E ZERO
-- ---------------------------------------------------------------------------
-- O gatilho `trg_pedcrm_novo_membro` esta ATIVO em auth.users, AFTER INSERT,
-- ao lado de on_auth_user_created. Ele nao quebra hoje por um detalhe de
-- plpgsql: comandos SQL dentro do corpo so sao preparados quando a execucao
-- CHEGA neles. Como todo cadastro do Evollo entra sem `codigo_clinica` no
-- raw_user_meta_data, a funcao devolve `new` na primeira condicao e nunca
-- alcanca o `select ... from public.clinicas`.
--
-- No dia em que uma conta for criada com `codigo_clinica` no metadado, o
-- cadastro inteiro falha com "relation public.clinicas does not exist" —
-- porque o gatilho e AFTER INSERT na mesma transacao do signUp.
--
-- Probabilidade baixa. Consequencia total: ninguem cria conta.
--
-- ===========================================================================
-- O QUE FAZER — DECISAO DO PROPRIETARIO, NAO DESTA ETAPA
-- ---------------------------------------------------------------------------
-- A) remover o gatilho e a funcao deste banco, se o PedCRM tem projeto proprio
--    e este e residuo puro;
-- B) deixar como esta e apenas manter registrado;
-- C) confirmar antes com o PedCRM que nada la depende deste projeto.
--
-- Nada foi removido. Nada foi alterado.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A FUNCAO, FIEL AO BANCO — reproduzida para registro, nao para aplicar
-- ---------------------------------------------------------------------------
create or replace function public.pedcrm_novo_membro()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
  declare
    v_codigo     text;
    v_nome       text;
    v_clinica_id uuid;
  begin
    v_codigo := nullif(trim(new.raw_user_meta_data ->> 'codigo_clinica'), '');
    v_nome   := coalesce(
                  nullif(trim(new.raw_user_meta_data ->> 'nome'), ''),
                  split_part(new.email, '@', 1)
                );

    if v_codigo is null then
      return new;
    end if;

    select id into v_clinica_id
    from public.clinicas
    where codigo_publico = v_codigo
    limit 1;

    if v_clinica_id is null then
      return new;
    end if;

    if not exists (
      select 1 from public.membros_clinica
      where user_id = new.id and clinica_id = v_clinica_id
    ) then
      insert into public.membros_clinica
        (id, clinica_id, user_id, papel, nome, ativo, criado_em)
      values
        (gen_random_uuid(), v_clinica_id, new.id, 'medico', v_nome, true, now());
    end if;

    return new;
  end;
  $function$;


-- ---------------------------------------------------------------------------
-- O GATILHO, FIEL AO BANCO
-- ---------------------------------------------------------------------------
-- Ativo em auth.users. Registrado aqui apenas como documentacao do estado; a
-- linha fica comentada porque este arquivo nao deve criar nada.
--
--   CREATE TRIGGER trg_pedcrm_novo_membro AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION pedcrm_novo_membro()
