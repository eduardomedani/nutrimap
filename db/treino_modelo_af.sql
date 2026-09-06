-- ===========================================================================
-- Evollo · MODELO NA BIBLIOTECA — divisao A-F (peito/costas/perna/ombro/bracos)
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE. Cria UM modelo novo na biblioteca de treinos.
-- Nao altera nada que ja existe. Desfazer: apague o treino pela tela.
--
-- E MODELO, NAO PRESCRICAO: `paciente_id` fica nulo. Ele aparece em
-- Treinos > Biblioteca, e de la voce aplica em quantos alunos quiser.
--
-- Os 40 exercicios foram casados um a um contra o SEU catalogo de 746 pelo
-- nome — 40 de 40 bateram exato. Nenhum exercicio novo e criado aqui; o script
-- so referencia os que ja existem, pelo id.
--
-- SE RODAR DUAS VEZES, cria dois modelos iguais. Nao ha guarda de duplicata de
-- proposito: o nome do treino e livre e um segundo modelo com o mesmo nome e
-- decisao legitima de quem esta montando variacoes.
--
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $treino$
declare
  v_org    uuid;
  v_treino uuid;
  v_faltou int;
begin
  select o.id into v_org
    from public.organizacoes o
    join public.admins a on a.user_id = o.proprietario_user_id;

  if v_org is null then
    raise exception 'organizacao nao encontrada — nada foi criado';
  end if;

  insert into public.treinos (nutri_id, paciente_id, nome, divisao, ativo)
  values (v_org, null, 'Divisao A-F · Peito/Costas/Perna/Ombro/Bracos', 'ABCDEF', true)
  returning id into v_treino;

  -- Os itens vem de uma lista literal: id do exercicio, dia, ordem e a
  -- prescricao. O `join` contra `exercicios` e a rede de seguranca — se algum
  -- id nao existir mais na base, aquela linha simplesmente nao entra, e a
  -- conferencia no fim acusa a diferenca em vez de o treino nascer torto em
  -- silencio.
  insert into public.treino_exercicios
    (nutri_id, treino_id, exercicio_id, dia, ordem, series, repeticoes,
     descanso, rir, metodo, observacao)
  select v_org, v_treino, e.id, t.dia, t.ordem, t.series, t.reps,
         t.descanso, t.rir, t.metodo, t.obs
    from (values
      ('274c8bdc-6c37-4f0d-86bd-e9e78463a3db', 'A', 0, 3, '6-10', '2-3 min', '2-1', null, 'Prioridade do treino. Banco a 20-30°.'),
      ('9a9486d9-ca7c-4df7-a4db-5f450e75854f', 'A', 1, 3, '8-12', '2 min', '1-2', null, 'Controle a fase excêntrica e deixe o peitoral alongar.'),
      ('f1be6bdc-5c8e-4cf3-8e05-bf394c3f6097', 'A', 2, 3, '10-15', '90 s', '1', null, 'Amplitude grande, sem virar supino.'),
      ('9eaf9182-9dae-40f9-b248-00a89b416c12', 'A', 3, 2, '12-15', null, null, 'Drop-set', 'Drop-set na última série.'),
      ('1e97482b-1b23-4ea9-a694-8ff63c351ceb', 'A', 4, 3, '8-12', null, null, null, 'Ótima posição para o tríceps alongado.'),
      ('ea69001d-daaa-47c6-b97a-0af126ca8add', 'A', 5, 3, '10-15', null, null, 'Rest-pause', 'Rest-pause na última: 12 reps, 15-20 s, reps adicionais.'),
      ('aee5bfa1-cbcc-4b25-8c82-f4fd9e9be46a', 'A', 6, 2, '8-12', null, null, null, null),
      ('6117b8ba-28c2-4261-971b-9a53dacad21b', 'B', 0, 3, '6-10', '2 min', '1-2', null, null),
      ('30406979-1cfe-406d-b75d-17fbe32ba73b', 'B', 1, 3, '8-12', null, null, null, 'Alongamento completo do dorsal.'),
      ('fdbfd9bc-59f3-4c3f-9634-2dd60e53b6a3', 'B', 2, 3, '10-15', null, null, null, 'Leve o cotovelo em direção ao quadril.'),
      ('887934a7-feee-4488-856d-4a18b28bb7b0', 'B', 3, 2, '12-15', null, null, null, 'Última série próxima da falha.'),
      ('73aa6060-3f99-4d1b-b1ff-27ffaa41d01c', 'B', 4, 3, '6-10', null, null, null, null),
      ('822da69a-c83d-446b-8488-5182d8bc382a', 'B', 5, 3, '8-12', null, null, null, 'Grande estímulo em posição alongada.'),
      ('2779f3ad-6468-4779-bc7b-2e2eb18a89a8', 'B', 6, 2, '10-15', null, null, 'Drop-set', 'Drop-set opcional na última série.'),
      ('afad1b7b-114d-4715-98b0-f5f656c709b3', 'C', 0, 3, '6-10', '3 min', '2-1', null, null),
      ('af5ed771-57ff-4da5-887f-a08adf5dca18', 'C', 1, 3, '10-15', '2-3 min', null, null, 'Amplitude máxima que você mantenha com controle.'),
      ('f246af8e-53d8-4896-a5e5-305b99f87405', 'C', 2, 2, '10-15', null, null, 'Drop-set', 'Última: 10-15 reps, reduz 25-30%, vai até perto da falha.'),
      ('0abf18cd-e661-4a31-8dbf-ea7b671f01e1', 'C', 3, 3, '6-10', '2-3 min', null, null, 'Foco no alongamento dos posteriores.'),
      ('da0d54bf-d6a4-4408-948b-9f6c05e21526', 'C', 4, 3, '8-12', null, null, null, null),
      ('2175d07d-e372-4335-9c8b-4f99b4e16002', 'C', 5, 2, '12-15', null, null, null, null),
      ('503b381d-c375-42b5-b0e6-cda4ddca905c', 'C', 6, 3, '8-12', null, null, null, 'Pausa de ~1 s na posição alongada.'),
      ('d69e50f2-9800-4bd2-a2c1-ba33b164bc41', 'C', 7, 2, '12-20', null, null, null, null),
      ('b192f6ec-f363-426d-b580-69c41325452e', 'D', 0, 3, '6-10', '2-3 min', '1-2', null, null),
      ('a68fdcc9-6b02-4c93-8d9f-83ba4b7d12ce', 'D', 1, 3, '10-15', null, null, null, null),
      ('53e651c0-38e6-40f1-aa46-4d157f4f8df5', 'D', 2, 3, '12-20', null, null, 'Drop-set', 'Drop-set na última série.'),
      ('c636ef15-e751-4319-9bfd-d59b07787d7e', 'D', 3, 3, '10-15', null, null, null, null),
      ('ca7ac1bd-8cb2-4393-b0a7-6b993a7c0f6e', 'D', 4, 2, '12-20', null, null, null, null),
      ('b58eb4fa-e673-442e-97d4-08e20351f5dc', 'D', 5, 2, '15-25', null, null, null, 'Carga moderada, finalizador.'),
      ('b0c51759-70cd-45df-ab0e-4ae53e0583be', 'E', 0, 3, '6-10', null, null, null, 'Progressão de carga.'),
      ('45412168-d0e3-4b3f-b356-6974af1e72e9', 'E', 1, 3, '10-15', null, null, null, 'Braço atrás do tronco, posição alongada.'),
      ('10df5f98-3717-4156-a98c-dd92f75d114d', 'E', 2, 2, '10-15', null, null, 'Rest-pause', 'Rest-pause na última série.'),
      ('ec7cd5e9-eec5-40f7-84d4-5cbecf2d1bb7', 'E', 3, 3, '8-12', null, null, null, null),
      ('d53b8eb7-8d34-4518-aa9a-8f11adb16f4f', 'E', 4, 3, '8-12', null, null, null, null),
      ('8c2689d9-5bad-4cc4-b899-085154551dd5', 'E', 5, 2, '12-15', null, null, 'Drop-set', 'Drop-set na última série.'),
      ('76ef7bcd-8933-480d-bf00-bc9d777f4f24', 'F', 0, 3, '6-10', '2-3 min', '1-2', null, 'Principal exercício do treino.'),
      ('03b2ee7c-c7b9-46da-b299-03f71eb2ee48', 'F', 1, 3, '8-12', null, null, null, 'Segure ~1 s na contração.'),
      ('e85cdcbc-54e3-4516-b946-e7e73ee950f3', 'F', 2, 3, '8-12', null, null, null, null),
      ('9e4c8cb9-aaa2-4826-83c9-e7a3b55854b8', 'F', 3, 3, '10-15', null, null, null, 'Grande amplitude.'),
      ('691c1b8c-bf23-4bec-bb06-eb7a59bb3483', 'F', 4, 2, '10-15', null, null, null, 'Cotovelos mais abertos: mais região superior das costas e deltoide posterior.'),
      ('7568acc2-c139-4fd4-bad0-47aa3be61849', 'F', 5, 2, '12-15', null, null, null, 'Finalizador.')
    ) as t(exercicio_id, dia, ordem, series, reps, descanso, rir, metodo, obs)
    join public.exercicios e on e.id = t.exercicio_id::uuid;

  select 40 - count(*) into v_faltou
    from public.treino_exercicios where treino_id = v_treino;

  raise notice 'modelo criado: %', v_treino;
  raise notice 'exercicios inseridos: % (de 40)', 40 - v_faltou;
  if v_faltou > 0 then
    raise warning '% exercicio(s) nao entraram — id ausente no catalogo', v_faltou;
  end if;
end $treino$;


-- ===========================================================================
-- CONFERENCIA. Esperado: 6 dias, 40 itens, com a contagem por dia batendo o
-- plano — A 7, B 7, C 8, D 6, E 6, F 6.
-- ===========================================================================
select t.nome, i.dia, count(*) as exercicios
  from public.treinos t
  join public.treino_exercicios i on i.treino_id = t.id
 where t.paciente_id is null
   and t.nome = 'Divisao A-F · Peito/Costas/Perna/Ombro/Bracos'
 group by t.nome, i.dia
 order by i.dia;
