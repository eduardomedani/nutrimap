-- Documentos do paciente · o teste que so a sessao real responde.
--
-- As consultas acima conferem ESTRUTURA. Esta confere COMPORTAMENTO, e por
-- isso precisa rodar autenticado como cada papel — no SQL Editor, rodando
-- como dono do projeto, paciente_do_auth() e nulo e tudo volta vazio. Isso
-- nao e falha: e a prova de que o filtro depende da sessao, e nao de um
-- parametro que a tela manda.
--
-- COMO RODAR DE VERDADE: pelo app, com a anon-key, logado como cada conta.
-- O roteiro manual da Etapa 1 traz o passo a passo.

-- ---------------------------------------------------------------------------
-- A) Panorama para o profissional (roda como nutri)
-- ---------------------------------------------------------------------------
select
  count(*)                                                          as meus_documentos,
  count(*) filter (where visivel_paciente)                          as disponibilizados,
  count(*) filter (where not visivel_paciente and arquivado_em is null) as privados,
  count(*) filter (where arquivado_em is not null)                  as arquivados,
  count(*) filter (where visivel_paciente and not visualizado_pelo_paciente
                     and arquivado_em is null)                      as nao_lidos
  from public.paciente_documentos;

-- ---------------------------------------------------------------------------
-- B) O que o paciente logado enxerga (roda como paciente, pelo app)
-- ---------------------------------------------------------------------------
-- Esperado: SO documentos dele, SO visiveis, SO nao arquivados. Se aparecer
-- qualquer linha com visivel_paciente = false, a policy pd_paciente_select
-- esta furada.
select id, titulo, tipo, visivel_paciente, arquivado_em, visualizado_pelo_paciente
  from public.paciente_documentos
 order by disponibilizado_em desc nulls last;

-- ---------------------------------------------------------------------------
-- C) Nenhuma linha visivel que nao devia estar
-- ---------------------------------------------------------------------------
-- Rodando como paciente, os tres numeros tem que ser 0. Qualquer um acima de
-- zero e vazamento: sao linhas que o RLS deixou passar e nao deveria.
select
  count(*) filter (where not visivel_paciente)                      as vazou_privado,
  count(*) filter (where arquivado_em is not null)                  as vazou_arquivado,
  count(*) filter (where paciente_id is distinct from public.paciente_do_auth())
                                                                    as vazou_de_outro
  from public.paciente_documentos;

-- ---------------------------------------------------------------------------
-- D) Documentos sem dono coerente (roda como nutri)
-- ---------------------------------------------------------------------------
-- Esperado: 0. Documento cujo paciente pertence a OUTRO profissional so
-- existiria se a policy de insert tivesse sido criada sem o exists().
select count(*) as documento_de_paciente_alheio
  from public.paciente_documentos d
  join public.pacientes p on p.id = d.paciente_id
 where p.nutri_id is distinct from d.nutri_id;

-- ---------------------------------------------------------------------------
-- E) Coerencia entre permissao e carimbo (roda como nutri)
-- ---------------------------------------------------------------------------
-- Esperado: 0 nos dois. Os CHECKs ja impedem, mas dado antigo migrado nao
-- passa por CHECK — esta consulta e o que pega isso.
select
  count(*) filter (where visivel_paciente and disponibilizado_em is null) as visivel_sem_data,
  count(*) filter (where visivel_paciente and arquivado_em is not null)   as visivel_e_arquivado
  from public.paciente_documentos;
