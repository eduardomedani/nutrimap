-- ===========================================================================
-- 131 · O QUE O CADASTRO DIZ SOBRE OS TRES CORRIGIDOS
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- POR QUE. A revisao humana do 130c derrubou tres vinculos. Dois ja tem
-- destino decidido; "Mergulho na maquina" depende de saber QUAL maquina o
-- cadastro representa — gravitron, sentada ou de placas — e essa informacao,
-- se existir, esta em `observacoes`, que nenhuma consulta anterior leu.
--
-- A ultima coluna diz quantos exercicios do catalogo tem `observacoes`
-- preenchida. Se der 0, o campo nunca foi usado e nao ha evidencia a extrair:
-- a resposta tem que vir do Eduardo, olhando a sala.
-- ===========================================================================
select e.nome,
       e.grupo_muscular,
       e.equipamento,
       coalesce(nullif(e.observacoes, ''), '(vazio)')          as observacoes,
       (select count(*) from public.exercicios x
         where x.observacoes is not null and x.observacoes <> '') as catalogo_com_observacoes
from public.exercicios e
where e.id in ('2e8e5c9e-3248-40a2-8684-dc66af218581'::uuid,   -- Mergulho na maquina
               '691c1b8c-bf23-4bec-bb06-eb7a59bb3483'::uuid,   -- Remada alta na maquina articulada
               'a68fdcc9-6b02-4c93-8d9f-83ba4b7d12ce'::uuid)   -- Elevacao lateral sentado na polia
order by e.nome;
