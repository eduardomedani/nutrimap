-- ===========================================================================
-- BASELINE DE OBJETO JA EXISTENTE — o caminho do cadastro (auth.users)
-- ---------------------------------------------------------------------------
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
--
-- Retrato fiel de public.handle_new_user() e do gatilho on_auth_user_created,
-- lidos do banco em 11/08/2026 com pg_get_functiondef e pg_get_triggerdef
-- (db/conferencia/81_signup_e_pedcrm.sql, blocos A e B). Copiado, nao
-- reescrito de memoria.
--
-- POR QUE ELE PRECISOU EXISTIR. O script 79 acusou `handle_new_user` como
-- objeto vivo que o repositorio nao conhecia. Ele nao aparecia em NENHUM
-- arquivo js, html, sql ou mjs deste projeto — e mesmo assim roda em toda
-- criacao de conta, com SECURITY DEFINER. Um objeto assim nao pode entrar na
-- Etapa 4 sem estar escrito em algum lugar.
--
-- ===========================================================================
-- O QUE ELE FAZ, EM UMA FRASE
-- ---------------------------------------------------------------------------
-- Toda linha nova em auth.users ganha, na MESMA TRANSACAO, uma linha em
-- public.nutricionistas. Sem excecao e sem condicao.
--
-- Foi conferido no banco, nao suposto: das 6 contas de auth.users, 6 tem
-- linha em nutricionistas. Zero ficaram de fora.
--
-- ---------------------------------------------------------------------------
-- A CONSEQUENCIA QUE MUDOU O DIAGNOSTICO DA ETAPA 3.5
-- ---------------------------------------------------------------------------
-- "Estar em public.nutricionistas" NAO significa ser nutricionista. E carimbo
-- automatico de existencia. O script 73 tinha lido quatro contas como
-- "nutricionistas fora da organizacao"; o script 82 mostrou o que elas sao:
--
--   conta A -> PACIENTE, criou login no PWA do aluno
--   conta B -> PACIENTE, criou login no PWA do aluno
--   conta C -> conta de teste do proprio proprietario, so a linha automatica
--   conta D -> unico nutricionista de verdade fora da organizacao
--
-- Os e-mails saem daqui de proposito: o repositorio e publico e a conclusao
-- nao depende de quem sao. Para ver as quatro com nome, rode
-- db/conferencia/82_quem_sao_as_seis_contas.sql, que consulta o banco em vez
-- de guardar a resposta.
--
-- Dois pacientes do PWA viraram "nutricionistas" no banco por causa deste
-- gatilho. Nao ha bug de vinculo nem conta invasora: ha um carimbo.
--
-- ---------------------------------------------------------------------------
-- POR QUE O `nome` DE TRES CONTAS E O PROPRIO E-MAIL
-- ---------------------------------------------------------------------------
-- O gatilho faz coalesce(raw_user_meta_data->>'nome', email). Existem tres
-- chamadas de signUp no projeto, e so uma manda nome:
--
--   js/auth.js          criarConta({nome, email, senha})  -> manda { nome }
--   js/paciente-data.js cadastrar(email, senha)           -> NAO manda
--   js/equipe-data.js   cadastrar(email, senha)           -> NAO manda
--
-- Logo, nome = e-mail e assinatura de conta nascida no PWA do paciente ou no
-- app do colaborador. E o que se ve nas tres contas acima.
--
-- ===========================================================================
-- ACHADOS DE DIAGNOSTICO — REGISTRADOS, NAO CORRIGIDOS NESTA ETAPA
-- ---------------------------------------------------------------------------
-- 1) SECURITY DEFINER SEM `set search_path`. Mesma classe de achado ja
--    registrada na Etapa 1b para duas outras funcoes. Uma funcao definer sem
--    search_path fixo resolve nomes pelo search_path de quem dispara.
--
-- 2) `authenticated` tem EXECUTE (acl: postgres, authenticated, service_role).
--    Nao e explorável hoje: o proprio Postgres recusa chamar funcao de gatilho
--    fora de gatilho. Ainda assim e grant que nao serve para nada.
--
-- 3) SEM TRATAMENTO DE EXCECAO. O gatilho e AFTER INSERT na mesma transacao do
--    cadastro: se o INSERT em nutricionistas falhar por qualquer motivo, o
--    signUp INTEIRO falha e a conta nao nasce. Hoje nao ha constraint que
--    possa falhar; no dia em que houver, o sintoma sera "nao consigo criar
--    conta" sem nenhuma pista apontando para ca.
--
-- 4) CRIA IDENTIDADE PARA QUEM NAO E NUTRICIONISTA. Cada paciente novo do PWA
--    e cada colaborador novo passa a ter linha em nutricionistas. E isso vai
--    continuar acontecendo enquanto o gatilho existir.
--
-- Corrigir qualquer um dos quatro e trabalho de outra etapa, com decisao
-- explicita. Este arquivo so registra.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A FUNCAO, FIEL AO BANCO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.nutricionistas (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$function$;


-- ---------------------------------------------------------------------------
-- O GATILHO, FIEL AO BANCO
-- ---------------------------------------------------------------------------
-- Em auth.users, e nao em public: criar gatilho nesta tabela exige papel com
-- privilegio sobre o schema auth. E mais um motivo para o arquivo nao ser
-- rodado por reflexo.
--
-- A linha abaixo e a que a conferencia 70 compara com o banco. Ela esta ativa
-- no arquivo de proposito: e `create trigger` sem `if not exists`, entao rodar
-- este bloco num banco que ja o tem falha em vez de duplicar em silencio.
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
