-- ===========================================================================
-- Evollo · SEGUNDA CORRECAO DA REVISAO HUMANA — a panturrilha e a rosca
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Remove 2 midias e os vinculos delas.
--
-- NAO apaga arquivo nenhum. Os MP4 continuam em disco e nunca subiram. Os 8
-- orfaos que vivem so no disco nao sao tocados por este script — ele nao
-- conhece o disco, so o banco.
--
-- 100% re-executavel: se as duas ja tiverem saido, nao faz nada e a conferencia
-- do fim confirma.
--
-- ===========================================================================
-- O QUE A SEGUNDA LEITURA DAS 67 LINHAS PEGOU
-- ---------------------------------------------------------------------------
--   Panturrilha sentado na maquina  <- Lever Seated Calf Press
--       CORRECAO. O arquivo e a LEG PRESS: tronco reclinado, joelhos quase
--       estendidos. Conferido quadro a quadro. O cadastro pede a maquina de
--       coxim sobre as coxas, tronco ereto, joelhos a 90 graus.
--
--       A diferenca nao e de enquadramento: joelho fletido enfatiza SOLEO,
--       joelho estendido enfatiza GASTROCNEMIO. Maquina diferente, musculo
--       diferente.
--
--       O destino certo do arquivo antigo existe no catalogo — `Panturrilha no
--       leg press` e `Panturrilha na maquina de leg press` — mas nenhum dos
--       dois e prescrito, entao ele fica sem uso.
--
--   Rosca unilateral em pe na polia  <- Cable Standing Single Arm Preacher Curl
--       MELHORIA. O anterior nao estava errado: em pe, unilateral, na polia —
--       os tres qualificadores do cadastro batiam, e o banco so apoiava o
--       braco. Mas o cadastro nao menciona banco, e existe a versao sem ele,
--       COM par feminino de nome identico. O anterior era so masculino.
--
-- ===========================================================================
-- A GUARDA, E POR QUE ELA E O CORACAO DESTE ARQUIVO
-- ---------------------------------------------------------------------------
-- `delete` por chave e seguro contra nome parcial, mas nao contra a hipotese
-- de que a midia esteja ligada a OUTRA coisa alem do que eu suponho — um
-- vinculo criado depois, ou de outro dono.
--
-- Entao o bloco abaixo primeiro CONFERE que cada uma das duas chaves esta
-- ligada exatamente ao exercicio esperado, e a mais nada. Se encontrar
-- qualquer associacao fora disso, ABORTA sem apagar — e a mensagem diz o que
-- encontrou.
--
-- Apagar de menos se conserta na proxima passada. Apagar de mais significa
-- tirar de um exercicio uma animacao que alguem tinha posto la de proposito.
--
-- Rodar no SQL Editor do Supabase.
-- Para colar, use db/exercicio_midias_correcao_130c_segunda_LIMPO.sql
-- ===========================================================================

do $corrige$
declare
  inesperados text;
  n_vinculos  int;
  n_midias    int;
begin
  -- -------------------------------------------------------------------------
  -- A GUARDA
  -- -------------------------------------------------------------------------
  select string_agg(format('%s -> %s (dono %s)',
                           m.chave, e.nome, coalesce(em.nutri_id::text, 'global')),
                    E'\n     ')
    into inesperados
    from public.exercicio_midias em
    join public.midias m     on m.id = em.midia_id
    join public.exercicios e on e.id = em.exercicio_id
   where m.chave in ('mid_cb8f2ea9', 'mid_11a92417')
     and not (
       (m.chave = 'mid_cb8f2ea9'
          and em.exercicio_id = 'd69e50f2-9800-4bd2-a2c1-ba33b164bc41'::uuid  -- Panturrilha sentado na maquina
          and em.nutri_id is null)
       or
       (m.chave = 'mid_11a92417'
          and em.exercicio_id = '45412168-d0e3-4b3f-b356-6974af1e72e9'::uuid  -- Rosca unilateral em pe na polia
          and em.nutri_id is null)
     );

  if inesperados is not null then
    raise exception E'ABORTADO — associacao inesperada, nada foi apagado:\n     %', inesperados;
  end if;

  -- -------------------------------------------------------------------------
  -- OS VINCULOS PRIMEIRO — `midias` tem `on delete restrict` vindo daqui
  -- -------------------------------------------------------------------------
  delete from public.exercicio_midias em
   using public.midias m
   where m.id = em.midia_id
     and m.chave in ('mid_cb8f2ea9', 'mid_11a92417');
  get diagnostics n_vinculos = row_count;

  delete from public.midias
   where chave in ('mid_cb8f2ea9', 'mid_11a92417');
  get diagnostics n_midias = row_count;

  raise notice 'vinculos removidos: %  midias removidas: %', n_vinculos, n_midias;
end;
$corrige$;


-- ---------------------------------------------------------------------------
-- CONFERENCIA INTERMEDIARIA
-- ---------------------------------------------------------------------------
-- O banco tem HOJE 67 midias, 67 vinculos, 49 exercicios, 68,0 MB. As duas que
-- saem somam 1,9 MB (1,39 + 0,48).
--
-- Esperado DEPOIS desta correcao e ANTES de reexecutar o seed:
--   65 midias · 65 vinculos · 47 exercicios · 66,1 MB · sobraram_das_2 = 0
--
-- 47, e nao 49: os dois exercicios ficam momentaneamente sem animacao, e a
-- reexecucao do seed devolve as versoes corretas — 68 midias, 68 vinculos, 49
-- exercicios, 69,4 MB. Nao pare aqui achando que perdeu dois exercicios; pare
-- so se `sobraram_das_2` nao der zero.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.midias)                                as midias,
  (select count(*) from public.exercicio_midias)                      as vinculos,
  (select count(distinct exercicio_id) from public.exercicio_midias)  as exercicios_distintos,
  (select round(sum(bytes) / 1048576.0, 1) from public.midias)        as mb,
  (select count(*) from public.midias
    where chave in ('mid_cb8f2ea9', 'mid_11a92417'))                  as sobraram_das_2;
