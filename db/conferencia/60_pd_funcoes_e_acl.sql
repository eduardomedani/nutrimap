-- Documentos do paciente · as funcoes existem, sao definer e PUBLIC nao executa.
--
-- O hardening de 07/08 (db/hardening_execute_publico.sql) tirou EXECUTE de
-- PUBLIC nas 77 funcoes do schema. Funcao nova nasce com esse grant de volta,
-- por default do Postgres — esta consulta e o que pega o esquecimento.
--
-- Esperado: as 4 funcoes, security_definer = true nas tres primeiras,
-- publico_executa = false em TODAS.
select
  p.proname                                          as funcao,
  p.prosecdef                                        as security_definer,
  p.provolatile                                      as volatilidade,
  coalesce(has_function_privilege('public',  p.oid, 'EXECUTE'), false) as publico_executa,
  coalesce(has_function_privilege('anon',    p.oid, 'EXECUTE'), false) as anon_executa,
  coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as autenticado_executa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'documento_do_paciente_e_meu',
     'marcar_documento_paciente_visualizado',
     'registrar_auditoria_documento_paciente',
     'tocar_paciente_documento')
 order by p.proname;

-- search_path fixo: sem isto, um schema no caminho do chamador poderia
-- sequestrar as tabelas que a funcao definer le.
select p.proname, p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('documento_do_paciente_e_meu',
                     'marcar_documento_paciente_visualizado');
