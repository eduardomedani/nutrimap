-- ===========================================================================
-- Evollo · DESFAZER — nome do paciente vindo do questionario
-- ---------------------------------------------------------------------------
-- Remove o gatilho. Volta ao estado em que um paciente cadastrado so pelo
-- codigo permanece sem nome, mesmo depois de responder o questionario inteiro.
--
-- O QUE ISTO **NAO** DESFAZ: os nomes ja preenchidos. Eles ficam, e ficam de
-- proposito — sao o nome que a propria pessoa escreveu no questionario, e
-- apaga-los devolveria pacientes reais ao estado de "(SEM NOME)". Se algum
-- nome especifico estiver errado, corrija aquele registro pela tela.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

drop trigger if exists trg_paciente_nome_do_questionario on public.respostas;
drop function if exists public.fn_paciente_nome_do_questionario();


-- Conferencia: devolve 0.
select count(*) as gatilho
from pg_trigger
where tgname = 'trg_paciente_nome_do_questionario';
