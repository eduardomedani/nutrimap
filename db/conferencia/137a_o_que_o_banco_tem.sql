-- ===========================================================================
-- 137a · O QUE O BANCO TEM, E DE QUAL SEED VEIO
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- SO RODE SE A 137 DISSER `tabela_midias = true`. Sem a tabela, esta consulta
-- estoura — e o erro nao acrescenta nada ao que a 137 ja respondeu.
--
-- ---------------------------------------------------------------------------
-- A PERGUNTA QUE ESTE ARQUIVO EXISTE PARA RESPONDER
-- ---------------------------------------------------------------------------
-- Nao e "quantas midias ha". E "o banco tem o seed ANTIGO ou o CORRIGIDO".
--
-- O seed nasceu com 74 midias. A revisao humana do 130c derrubou 6, em duas
-- passadas: 4 na primeira (retro na polia, dois mergulhos, remada alta no
-- smith) e 2 na segunda (a panturrilha que era leg press, a rosca que ganhou
-- versao melhor). O arquivo db/exercicio_midias_seed.sql que esta no
-- repositorio HOJE ja nasce sem as seis — foi regerado depois das correcoes.
--
-- Conferido no repositorio: as 6 chaves aparecem 0 vez no seed atual.
--
-- Entao `chaves_derrubadas` separa dois mundos:
--
--   0  -> o banco tem o seed corrigido (ou nunca teve as seis).
--         As duas correcoes NAO precisam rodar. Rodar nao faria mal — as duas
--         sao re-executaveis e nao acham nada — mas nao ha o que corrigir.
--
--   >0 -> o banco tem o seed ANTIGO. Rode, nesta ordem:
--           db/exercicio_midias_correcao_130c.sql
--           db/exercicio_midias_correcao_130c_segunda.sql
--         e depois reexecute db/exercicio_midias_seed.sql, que e idempotente.
--
-- ---------------------------------------------------------------------------
-- OS NUMEROS ESPERADOS, COM O SEED ATUAL INTEIRO APLICADO
-- ---------------------------------------------------------------------------
--   midias 68 · globais 68 · vinculos 68 · exercicios 49 · 69,4 MB
--   chaves_derrubadas 0 · midias_fora_do_bucket 0
--
-- 49 exercicios, e nao 54: tres compartilhamentos ficaram pendentes de decisao
-- e dois aprovados ficaram sem match. Esta registrado na 130a e na 130f.
--
-- `midias_fora_do_bucket` conta linha apontando para bucket que nao e o nosso.
-- Tem que ser 0: nada no acervo mora fora de 'exercicio-midias', e uma linha
-- assim seria assinada contra um bucket onde o arquivo nao esta.
-- ===========================================================================
select (select count(*) from public.midias)                                  as midias,
       (select count(*) from public.midias where nutri_id is null)           as midias_globais,
       (select count(*) from public.exercicio_midias)                        as vinculos,
       (select count(*) from public.exercicio_midias where nutri_id is null) as vinculos_globais,
       (select count(distinct exercicio_id) from public.exercicio_midias)    as exercicios_distintos,
       (select round(sum(bytes) / 1048576.0, 1) from public.midias)          as mb,
       (select count(*) from public.midias
         where chave in ('mid_3ab551ae', 'mid_f67760c9', 'mid_ea38a491',
                         'mid_0abd9b3d', 'mid_cb8f2ea9', 'mid_11a92417'))    as chaves_derrubadas,
       (select count(*) from public.midias
         where bucket is distinct from 'exercicio-midias')                   as midias_fora_do_bucket;
