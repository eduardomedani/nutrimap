-- ===========================================================================
-- BASELINE DE FUNCOES JA EXISTENTES NO SUPABASE
-- NAO E MIGRATION. NAO EXECUTE ESTE ARQUIVO CEGAMENTE.
-- ---------------------------------------------------------------------------
-- As seis RPCs que o front chama e que nunca estiveram no repositorio.
-- Retrato de 11/08/2026, extraido por db/conferencia/68_legacy_rpcs.sql com
-- pg_get_functiondef — os corpos abaixo sao o texto REAL do banco, incluindo
-- os comentarios originais. Nada foi reescrito, indentado ou "melhorado".
--
-- ===========================================================================
-- CINCO DAS SEIS ESTAO ABERTAS PARA `anon`
-- ---------------------------------------------------------------------------
-- Sao exatamente as 5 que sobraram do hardening de execute publico
-- (db/hardening_execute_publico.sql, 07/08/2026, que levou 46 funcoes abertas
-- para anon a 5). Este arquivo e o primeiro lugar do repositorio onde da para
-- ver QUAIS sao e POR QUE continuam assim.
--
--   validar_codigo_convite          anon   cadastro de profissional
--   registrar_uso_codigo            anon   cadastro de profissional
--   rpc_buscar_paciente_por_codigo  anon   anamnese por link publico
--   rpc_marcar_completo             anon   anamnese por link publico
--   rpc_salvar_respostas            anon   anamnese por link publico
--   gerar_codigo_paciente           NAO    so authenticated
--
-- As tres da anamnese precisam de anon porque anamnese.html nao tem login:
-- nao ha nenhuma chamada de autenticacao na pagina. O CODIGO DE 6 CARACTERES
-- E A CREDENCIAL — quem o conhece le o nome do paciente, marca o questionario
-- como completo e sobrescreve as respostas clinicas. E o desenho do fluxo,
-- nao um defeito; mas e a superficie publica inteira do sistema.
--
-- ===========================================================================
-- NENHUMA DAS SEIS USA auth.uid()
-- ---------------------------------------------------------------------------
-- Todas se orientam por `codigo`. Consequencia para a Etapa 2: nenhuma delas
-- precisa virar organizacao_do_auth(). As duas que tocam propriedade sao
-- casos isolados, anotados em cada uma abaixo.
-- ===========================================================================


-- ===========================================================================
-- 1) validar_codigo_convite(text) -> json
-- ---------------------------------------------------------------------------
-- PAPEL        : AUTENTICACAO (cadastro de profissional novo)
-- CHAMADA POR  : js/auth.js:40 -> index.html (cadastro), admin.html
-- LE           : public.codigos_convite
-- ESCREVE      : nada. O consumo acontece em registrar_uso_codigo.
-- auth.uid()   : nao usa
-- ACL          : postgres, authenticated, service_role, ANON
-- MULTIUSUARIO : sem impacto. Cadastra organizacao nova, nao usuario interno.
--
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- SECURITY DEFINER **sem** `set search_path`. E a forma classica de escalada
-- de privilegio. Mitigado hoje porque as referencias sao qualificadas
-- (public.codigos_convite), mas e lacuna real — o hardening de search_path
-- cobriu as funcoes versionadas, e esta nao estava em db/.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.validar_codigo_convite(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  cod_record RECORD;
  resultado JSON;
BEGIN
  -- Busca o código (case insensitive)
  SELECT * INTO cod_record
  FROM public.codigos_convite
  WHERE UPPER(codigo) = UPPER(p_codigo)
    AND ativo = TRUE
  LIMIT 1;

  -- Não existe ou inativo
  IF cod_record IS NULL THEN
    RETURN json_build_object('valido', false, 'erro', 'Código inválido ou desativado');
  END IF;

  -- Expirado?
  IF cod_record.expira_em IS NOT NULL AND cod_record.expira_em < NOW() THEN
    RETURN json_build_object('valido', false, 'erro', 'Código expirado');
  END IF;

  -- Esgotou usos?
  IF cod_record.usos_atuais >= cod_record.usos_maximo THEN
    RETURN json_build_object('valido', false, 'erro', 'Este código já atingiu o limite de usos');
  END IF;

  -- Tudo OK → retorna válido (o consumo acontece depois, ao registrar uso)
  RETURN json_build_object(
    'valido', true,
    'codigo_id', cod_record.id,
    'descricao', cod_record.descricao
  );
END;
$function$;


-- ===========================================================================
-- 2) registrar_uso_codigo(text, uuid, text) -> json
-- ---------------------------------------------------------------------------
-- PAPEL        : AUTENTICACAO (consome o codigo apos o cadastro dar certo)
-- CHAMADA POR  : js/auth.js:47 -> index.html (cadastro), admin.html
-- LE           : public.codigos_convite (FOR UPDATE)
-- ESCREVE      : public.codigos_convite (usos_atuais), public.codigos_uso
-- auth.uid()   : NAO USA — recebe p_nutri_id por PARAMETRO
-- ACL          : postgres, authenticated, service_role, ANON
-- MULTIUSUARIO : e a unica das seis que grava propriedade. Ao virar
--                organizacao, codigos_uso.nutri_id passa a ser a organizacao
--                criada. O dono deveria vir de auth.uid(), nao do parametro.
--
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- (a) recebe o dono por parametro e esta aberta para anon: da para chamar em
--     laco com qualquer nutri_id e queimar `usos_atuais` de codigo valido.
-- (b) SECURITY DEFINER **sem** `set search_path`, igual a validar_codigo_convite.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.registrar_uso_codigo(p_codigo text, p_nutri_id uuid, p_email text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  cod_record RECORD;
BEGIN
  -- Re-valida atomicamente
  SELECT * INTO cod_record
  FROM public.codigos_convite
  WHERE UPPER(codigo) = UPPER(p_codigo)
    AND ativo = TRUE
    AND usos_atuais < usos_maximo
    AND (expira_em IS NULL OR expira_em > NOW())
  FOR UPDATE;

  IF cod_record IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Código não pode ser usado');
  END IF;

  -- Incrementa
  UPDATE public.codigos_convite
  SET usos_atuais = usos_atuais + 1
  WHERE id = cod_record.id;

  -- Registra log
  INSERT INTO public.codigos_uso (codigo_id, nutri_id, email)
  VALUES (cod_record.id, p_nutri_id, p_email);

  RETURN json_build_object('ok', true);
END;
$function$;


-- ===========================================================================
-- 3) rpc_buscar_paciente_por_codigo(text) -> table(id, nome, status)
-- ---------------------------------------------------------------------------
-- PAPEL        : CODIGO DE ACESSO (abre a anamnese pelo link publico)
-- CHAMADA POR  : js/pacientes.js -> anamnese.html (anonimo) e index.html
-- LE           : public.pacientes
-- ESCREVE      : nada
-- auth.uid()   : nao usa
-- ACL          : postgres, authenticated, service_role, ANON
-- MULTIUSUARIO : sem impacto. O fluxo e anonimo e continua anonimo.
--
-- Devolve so id, nome e status — nao expoe telefone, email nem endereco.
-- Foi escolha deliberada de quem escreveu: e o minimo para a tela abrir.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.rpc_buscar_paciente_por_codigo(p_codigo text)
 RETURNS TABLE(id uuid, nome text, status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, nome, status
  FROM public.pacientes
  WHERE codigo = p_codigo
  LIMIT 1;
$function$;


-- ===========================================================================
-- 4) rpc_marcar_completo(text) -> void
-- ---------------------------------------------------------------------------
-- PAPEL        : ANAMNESE (fecha o questionario)
-- CHAMADA POR  : js/pacientes.js -> anamnese.html (anonimo) e index.html
-- LE           : public.pacientes
-- ESCREVE      : public.pacientes (status, completado_em)
-- auth.uid()   : nao usa
-- ACL          : postgres, authenticated, service_role, ANON
-- MULTIUSUARIO : sem impacto.
--
-- E aqui que nasce o valor 'completo' de pacientes.status — a coluna nao tem
-- CHECK, entao esta funcao e o unico lugar que define o vocabulario.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.rpc_marcar_completo(p_codigo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pacientes
     SET status = 'completo', completado_em = NOW()
   WHERE codigo = p_codigo;
END;
$function$;


-- ===========================================================================
-- 5) rpc_salvar_respostas(text, jsonb) -> void
-- ---------------------------------------------------------------------------
-- PAPEL        : ANAMNESE (grava o questionario, modulo a modulo)
-- CHAMADA POR  : js/respostas.js -> anamnese.html (anonimo)
-- LE           : public.pacientes
-- ESCREVE      : public.respostas (upsert manual por paciente_id + modulo)
-- auth.uid()   : nao usa
-- ACL          : postgres, authenticated, service_role, ANON
-- MULTIUSUARIO : sem impacto.
--
-- E o caminho de escrita REAL das respostas clinicas — a policy
-- "Nutri ve respostas dos seus pacientes" nao participa, porque DEFINER passa
-- por cima da RLS. Quem conhece o codigo sobrescreve a anamnese.
--
-- O upsert e feito a mao (UPDATE, GET DIAGNOSTICS, INSERT se zero linhas) em
-- vez de ON CONFLICT, apesar de existir a unique (paciente_id, modulo). Sob
-- concorrencia real isso pode dar unique violation; com um paciente por vez
-- preenchendo o proprio questionario, nunca deu.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.rpc_salvar_respostas(p_codigo text, p_modulos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paciente_id UUID;
  v_modulo TEXT;
  v_dados JSONB;
  v_rows INT;
BEGIN
  SELECT id INTO v_paciente_id
  FROM public.pacientes WHERE codigo = p_codigo LIMIT 1;

  IF v_paciente_id IS NULL THEN
    RAISE EXCEPTION 'Código de paciente inválido: %', p_codigo;
  END IF;

  FOR v_modulo, v_dados IN SELECT * FROM jsonb_each(p_modulos)
  LOOP
    UPDATE public.respostas
       SET dados = v_dados, salvo_em = NOW()
     WHERE paciente_id = v_paciente_id AND modulo = v_modulo;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
      INSERT INTO public.respostas (paciente_id, modulo, dados, salvo_em)
      VALUES (v_paciente_id, v_modulo, v_dados, NOW());
    END IF;
  END LOOP;
END;
$function$;


-- ===========================================================================
-- 6) gerar_codigo_paciente() -> text
-- ---------------------------------------------------------------------------
-- PAPEL        : CODIGO DE ACESSO (gera o codigo de 6 caracteres do paciente)
-- CHAMADA POR  : js/pacientes.js -> index.html (painel, autenticado)
-- LE           : public.pacientes
-- ESCREVE      : nada
-- auth.uid()   : nao usa DIRETO — mas depende dele pela RLS, ver abaixo
-- ACL          : postgres, authenticated, service_role  (NAO tem anon)
-- MULTIUSUARIO : **QUEBRA**. E o primeiro bug real de tenancy do sistema.
--
-- ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA:
-- e SECURITY INVOKER, entao roda com a RLS de quem chama. O teste de unicidade
--
--   IF NOT EXISTS (SELECT 1 FROM public.pacientes p WHERE p.codigo = ...)
--
-- so enxerga OS PROPRIOS pacientes. Mas pacientes_codigo_key e UNIQUE GLOBAL.
-- Com uma organizacao so, nunca colide. Com duas, a funcao devolve codigo que
-- ja existe na outra organizacao e o INSERT falha com unique violation — sem
-- que a mensagem diga por que, porque a linha conflitante e invisivel para
-- quem chamou.
--
-- Correcao (Etapa 4, nao agora): virar SECURITY DEFINER com search_path fixo,
-- para o teste de unicidade enxergar a tabela inteira. O codigo continua
-- global; quem gera e que precisa enxergar global.
--
-- Tambem SEM `set search_path`, como as duas de convite.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.gerar_codigo_paciente()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  alfabeto TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  novo_codigo TEXT;
  i INT;
  tentativas INT := 0;
BEGIN
  LOOP
    novo_codigo := '';
    FOR i IN 1..6 LOOP
      novo_codigo := novo_codigo || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
    END LOOP;

    -- Verifica se já existe (referência explícita à tabela)
    IF NOT EXISTS (SELECT 1 FROM public.pacientes p WHERE p.codigo = novo_codigo) THEN
      RETURN novo_codigo;
    END IF;

    tentativas := tentativas + 1;
    IF tentativas > 20 THEN
      RAISE EXCEPTION 'Não foi possível gerar código único';
    END IF;
  END LOOP;
END;
$function$;
