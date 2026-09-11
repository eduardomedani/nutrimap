-- ===========================================================================
-- 126b · CADA NOME EXISTE UMA VEZ SO?
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le. UMA consulta so.
--
-- A guarda espelhada da 126a. La se pergunta "este id tem este nome?"; aqui,
-- "este nome pertence a exatamente um id?".
--
-- As duas juntas fecham o cerco: a primeira pega UUID trocado, a segunda pega
-- nome ambiguo — dois exercicios homonimos em que o vinculo escolheria um dos
-- dois sem criterio.
--
-- RESULTADO ESPERADO: NENHUMA LINHA.
-- ===========================================================================
with esperado(exercicio_id, nome) as (values
  ('a981ea9f-8fc5-4651-836d-612e436031ea'::uuid, 'Afundo caminhando livre'),
  ('415d29f0-d14b-48a0-b369-82cecb0f9f15'::uuid, 'Barra fixa (pegada pronada)'),
  ('659d8da0-604c-4f79-b785-a831cb76fbf2'::uuid, 'Cadeira adutora'),
  ('d27f8e5c-1808-402a-a196-1f05f5a45d20'::uuid, 'Cadeira extensora unilateral'),
  ('2175d07d-e372-4335-9c8b-4f99b4e16002'::uuid, 'Cadeira flexora'),
  ('299c08b8-1da5-48a9-9c9e-48c2f17af18e'::uuid, 'Crossover na polia'),
  ('6b93604d-4286-429f-9e36-863159d8aeb8'::uuid, 'Crucifixo invertido'),
  ('ca7ac1bd-8cb2-4393-b0a7-6b993a7c0f6e'::uuid, 'Crucifixo invertido na polia'),
  ('f1be6bdc-5c8e-4cf3-8e05-bf394c3f6097'::uuid, 'Crucifixo no banco reto na polia'),
  ('4e4d479a-2111-48d7-9279-b0162bcde301'::uuid, 'Desenvolvimento com halteres'),
  ('b192f6ec-f363-426d-b580-69c41325452e'::uuid, 'Desenvolvimento militar na máquina'),
  ('6a472116-0ca3-47eb-904b-aefd54744706'::uuid, 'Desenvolvimento na máquina articulada'),
  ('d5101a0c-96a0-4be7-8d41-e0300a48d601'::uuid, 'Elevação frontal na polia'),
  ('4d0a863f-f24e-44a3-9ac9-89cec9bae769'::uuid, 'Elevação lateral unilateral'),
  ('c9def201-d2a1-493e-9a18-2db92853ec24'::uuid, 'Encolhimento com halteres'),
  ('aee5bfa1-cbcc-4b25-8c82-f4fd9e9be46a'::uuid, 'Extensão de tríceps na máquina'),
  ('1e97482b-1b23-4ea9-a694-8ff63c351ceb'::uuid, 'Extensão de tríceps unilateral em pé na polia baixa'),
  ('8c2689d9-5bad-4cc4-b899-085154551dd5'::uuid, 'Extensão de tríceps unilateral na polia'),
  ('a035c5e1-a490-4359-ac8a-ed4d0210c479'::uuid, 'Face pull na polia'),
  ('af5ed771-57ff-4da5-887f-a08adf5dca18'::uuid, 'Leg press'),
  ('d69e50f2-9800-4bd2-a2c1-ba33b164bc41'::uuid, 'Panturrilha sentado na máquina'),
  ('7dc456d0-d4a0-4eb1-bcee-4cbec8a9f0fa'::uuid, 'Pulldown com braços estendidos (polia)'),
  ('887934a7-feee-4488-856d-4a18b28bb7b0'::uuid, 'Pulldown com braços estendidos na corda'),
  ('7568acc2-c139-4fd4-bad0-47aa3be61849'::uuid, 'Pullover com halter braços estendidos'),
  ('6117b8ba-28c2-4261-971b-9a53dacad21b'::uuid, 'Puxada aberta'),
  ('30406979-1cfe-406d-b75d-17fbe32ba73b'::uuid, 'Puxada frontal fechada'),
  ('55080c43-c83e-4255-9f08-43ee45e233a2'::uuid, 'Puxada pegada supinada na polia'),
  ('fdbfd9bc-59f3-4c3f-9634-2dd60e53b6a3'::uuid, 'Puxada unilateral'),
  ('691c1b8c-bf23-4bec-bb06-eb7a59bb3483'::uuid, 'Remada alta na máquina articulada'),
  ('8f86e729-4e5f-45e8-bc3c-ee358d8ff3e6'::uuid, 'Remada alta na polia'),
  ('1a3015e9-850d-4104-ade4-9f2cef109830'::uuid, 'Remada curvada com as duas mãos na barra (long bar)'),
  ('03b2ee7c-c7b9-46da-b299-03f71eb2ee48'::uuid, 'Remada isolateral na máquina articulada'),
  ('98c7ac47-4540-48b0-a77d-bd1f5038d125'::uuid, 'Remada sentado na polia (remada baixa)'),
  ('76ef7bcd-8933-480d-bf00-bc9d777f4f24'::uuid, 'Remada T deitado'),
  ('9e4c8cb9-aaa2-4826-83c9-e7a3b55854b8'::uuid, 'Remada unilateral sentado na polia'),
  ('baa0e367-2fab-419b-ae67-55790039b27c'::uuid, 'Rosca alternada inclinada com halteres'),
  ('21876dce-4235-4f6e-990f-88485ae1efc2'::uuid, 'Rosca concentrada'),
  ('78d17f3b-7e44-41da-894b-993b2b125e6d'::uuid, 'Rosca direta no banco inclinado'),
  ('822da69a-c83d-446b-8488-5182d8bc382a'::uuid, 'Rosca inclinada com halteres'),
  ('1a05b7f4-071e-4cf4-a37f-449016770f56'::uuid, 'Rosca Scott com barra'),
  ('73aa6060-3f99-4d1b-b1ff-27ffaa41d01c'::uuid, 'Rosca Scott na máquina'),
  ('10df5f98-3717-4156-a98c-dd92f75d114d'::uuid, 'Rosca Scott unilateral com halter'),
  ('45412168-d0e3-4b3f-b356-6974af1e72e9'::uuid, 'Rosca unilateral em pé na polia'),
  ('0abf18cd-e661-4a31-8dbf-ea7b671f01e1'::uuid, 'Stiff com barra (pernas estendidas)'),
  ('274c8bdc-6c37-4f0d-86bd-e9e78463a3db'::uuid, 'Supino inclinado com halteres'),
  ('9a9486d9-ca7c-4df7-a4db-5f450e75854f'::uuid, 'Supino na máquina'),
  ('31f65bd6-7b40-4bb0-95ec-13be58756b5e'::uuid, 'Supino na máquina articulada'),
  ('2f8774a0-2b65-4690-aeb5-b076c27ed2aa'::uuid, 'Tríceps coice com halter'),
  ('ec7cd5e9-eec5-40f7-84d4-5cbecf2d1bb7'::uuid, 'Tríceps francês na polia'),
  ('97661a00-b1a9-4c94-9fab-914492f530ac'::uuid, 'Tríceps francês no cross'),
  ('d53b8eb7-8d34-4518-aa9a-8f11adb16f4f'::uuid, 'Tríceps pulley com barra V'),
  ('ea69001d-daaa-47c6-b97a-0af126ca8add'::uuid, 'Tríceps pulley com corda')
)
select e.nome, count(x.id) as quantos_no_banco,
       string_agg(x.id::text, ', ') as ids
from esperado e
left join public.exercicios x on x.nome = e.nome
group by e.nome
having count(x.id) <> 1;
