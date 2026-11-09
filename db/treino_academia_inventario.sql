-- ===========================================================================
-- Evollo · INVENTÁRIO DA ACADEMIA — o que o gerador de treinos pode usar
-- ---------------------------------------------------------------------------
-- ESTE SCRIPT ESCREVE: cria a tabela, as policies e carrega o inventário da
-- academia do Eduardo. Desfazer: db/treino_academia_inventario_desfazer.sql
--
-- 100% re-executável. A carga usa `on conflict do nothing`: rodar de novo NÃO
-- sobrescreve o que já foi editado pela tela "Minha academia".
--
-- ===========================================================================
-- POR QUE EXISTE
-- ---------------------------------------------------------------------------
-- O gerador (api/gerar-treino.js) escolhia da biblioteca de 746 exercícios sem
-- saber o que existe na academia. Prescrevia agachamento com barra livre numa
-- academia que não tem rack confirmado.
--
-- POR CONTA, NÃO FIXO NO CÓDIGO: o sistema é multiempresa. Inventário fixo no
-- código faria toda organização receber treinos limitados a ESTA academia.
-- Quem não tem linha aqui segue com o gerador de antes, sem restrição.
--
-- ===========================================================================
-- FORMATO DE CADA ITEM (itens é um array jsonb)
-- ---------------------------------------------------------------------------
--   id          'EQ01'... (estação) ou 'PG01'... (puxador) — é o que a IA
--               devolve em equipamento_id / acessorio_id e o servidor valida
--   tipo        'equipamento' | 'puxador'
--   nome, categoria, grupos, exercicios, obs   — texto livre, vai para a IA
--   situacao    'disponivel'   entra no gerador
--               'pendente'     a confirmar: a IA trata como INEXISTENTE
--               'indisponivel' quebrado / emprestado: idem
--
-- ORIGEM DA CARGA: Desktop/inventario_academia_com_criterios_agachamentos.pdf
--   · EQ01–EQ32 e PG01–PG12 como estão no PDF.
--   · EQ33–EQ35 NÃO estão no PDF como equipamento: são os "campos pendentes"
--     da seção 4 (barra de carga + anilhas, rack, bancos móveis). Entram como
--     'pendente' para que a confirmação seja um clique na tela.
--   · A coluna "aplicação" dos puxadores saiu CORTADA no PDF ("Puxada a...").
--     O texto em `exercicios` dos PG foi reconstruído pelo tipo de pegada e
--     está marcado em `obs` para conferir.
--
-- Rodar no SQL Editor do Supabase. Para colar, use o _LIMPO.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) TABELA — uma linha por nutri
-- ---------------------------------------------------------------------------
create table if not exists public.academia_inventario (
  nutri_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ativo         boolean not null default true,
  itens         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  criado_em     timestamptz not null default now(),
  constraint academia_inventario_itens_array check (jsonb_typeof(itens) = 'array')
);

alter table public.academia_inventario enable row level security;


-- ---------------------------------------------------------------------------
-- 2) POLICIES — uma por comando, só o próprio dono (sem linha global)
-- ---------------------------------------------------------------------------
drop policy if exists academia_inventario_select on public.academia_inventario;
create policy academia_inventario_select on public.academia_inventario
  for select using (nutri_id = auth.uid());

drop policy if exists academia_inventario_insert on public.academia_inventario;
create policy academia_inventario_insert on public.academia_inventario
  for insert with check (nutri_id = auth.uid());

drop policy if exists academia_inventario_update on public.academia_inventario;
create policy academia_inventario_update on public.academia_inventario
  for update using (nutri_id = auth.uid()) with check (nutri_id = auth.uid());

drop policy if exists academia_inventario_delete on public.academia_inventario;
create policy academia_inventario_delete on public.academia_inventario
  for delete using (nutri_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 3) CARGA — a academia do Eduardo
-- ---------------------------------------------------------------------------
with item (ordem, id, tipo, nome, categoria, grupos, exercicios, obs, situacao) as (values
  ( 1, 'EQ01', 'equipamento', 'Par de halteres de 1 a 40', 'Pesos livres', 'Peito, costas, ombros, braços, pernas', 'Supino com halteres; remada unilateral; desenvolvimento; rosca; agachamento goblet/livre com halter', 'Confirmar se 1 a 40 é kg e quais incrementos. Supino e remada apoiada com halter dependem de banco (EQ35).', 'disponivel'),
  ( 2, 'EQ02', 'equipamento', 'Espaldar', 'Mobilidade / apoio', 'Corpo inteiro', 'Alongamentos; mobilidade; exercícios assistidos', 'Não presumir acessórios de suspensão.', 'disponivel'),
  ( 3, 'EQ03', 'equipamento', 'Colchonete de alongamento', 'Solo', 'Core e mobilidade', 'Prancha; abdominal; alongamentos', '', 'disponivel'),
  ( 4, 'EQ04', 'equipamento', 'Steps', 'Acessório funcional', 'Quadríceps, glúteos, panturrilhas', 'Step-up; subida lateral; apoio', 'Verificar estabilidade e altura.', 'disponivel'),
  ( 5, 'EQ05', 'equipamento', 'Barra W', 'Peso livre', 'Bíceps, tríceps', 'Rosca W; tríceps testa', 'Carga depende de anilhas disponíveis.', 'disponivel'),
  ( 6, 'EQ06', 'equipamento', 'Barra H', 'Peso livre', 'Bíceps, tríceps', 'Rosca martelo com barra H; tríceps', 'Confirmar padrão exato da barra.', 'disponivel'),
  ( 7, 'EQ07', 'equipamento', 'Barra reta curta', 'Peso livre', 'Braços, ombros', 'Rosca direta; elevação frontal', '', 'disponivel'),
  ( 8, 'EQ08', 'equipamento', 'Barra reta longa para alongamento', 'Mobilidade', 'Ombros, tronco', 'Mobilidade de ombros; alongamento', 'NÃO é barra de levantamento de carga.', 'disponivel'),
  ( 9, 'EQ09', 'equipamento', 'Polia unilateral', 'Cabo / polia', 'Costas, ombros, braços, glúteos', 'Remada unilateral; elevação lateral; tríceps; rosca', 'Altura e acessórios dependem da estação.', 'disponivel'),
  (10, 'EQ10', 'equipamento', 'Banco Scott', 'Banco de apoio', 'Bíceps', 'Rosca Scott', 'Requer barra ou halteres.', 'disponivel'),
  (11, 'EQ11', 'equipamento', 'Cadeira extensora unilateral', 'Máquina', 'Quadríceps', 'Extensão unilateral de joelho', '', 'disponivel'),
  (12, 'EQ12', 'equipamento', 'Cadeira extensora', 'Máquina', 'Quadríceps', 'Extensão bilateral de joelho', '', 'disponivel'),
  (13, 'EQ13', 'equipamento', 'Cadeira flexora', 'Máquina', 'Posteriores de coxa', 'Flexão de joelho sentada', 'Confirmar posição sentada do modelo.', 'disponivel'),
  (14, 'EQ14', 'equipamento', 'Banco romano', 'Banco / apoio', 'Lombar, glúteos, posteriores', 'Extensão de tronco; extensão de quadril', 'Confirmar configuração do banco.', 'disponivel'),
  (15, 'EQ15', 'equipamento', 'Máquina agachamento sumô', 'Máquina', 'Glúteos, adutores, quadríceps', 'Agachamento sumô', '', 'disponivel'),
  (16, 'EQ16', 'equipamento', 'Hack squat', 'Máquina', 'Quadríceps, glúteos', 'Agachamento nas duas orientações disponíveis (frente/costas)', 'A orientação invertida não isola posteriores.', 'disponivel'),
  (17, 'EQ17', 'equipamento', 'Agachamento pêndulo', 'Máquina', 'Quadríceps, glúteos', 'Agachamento pêndulo', '', 'disponivel'),
  (18, 'EQ18', 'equipamento', 'Leg press 45°', 'Máquina', 'Quadríceps, glúteos, adutores', 'Leg press 45°; variação de posição dos pés', 'Posição dos pés não isola músculos.', 'disponivel'),
  (19, 'EQ19', 'equipamento', 'Elevação pélvica 2D', 'Máquina', 'Glúteo máximo', 'Elevação pélvica', 'Confirmar significado funcional de 2D.', 'disponivel'),
  (20, 'EQ20', 'equipamento', 'Adutora e abdutora', 'Máquina combinada', 'Adutores, abdutores de quadril', 'Adução de quadril; abdução de quadril', 'Dois movimentos na mesma máquina.', 'disponivel'),
  (21, 'EQ21', 'equipamento', 'Mesa flexora unilateral', 'Máquina', 'Posteriores de coxa', 'Flexão unilateral de joelho deitado', '', 'disponivel'),
  (22, 'EQ22', 'equipamento', 'Cross over', 'Cabos / polias', 'Peito, costas, ombros, braços, core', 'Crucifixo no cabo; remada; puxada; tríceps; rosca; face pull', 'Depende da altura regulável das polias e dos puxadores.', 'disponivel'),
  (23, 'EQ23', 'equipamento', 'Gaiola de agachamento guiado (Smith)', 'Máquina guiada', 'Pernas, peito, ombros', 'Agachamento guiado; supino guiado; desenvolvimento guiado', 'Supino é feito nesta estação; confirmar banco disponível e travas.', 'disponivel'),
  (24, 'EQ24', 'equipamento', 'Máquina de elevação de ombro', 'Máquina', 'Deltoide lateral, deltoide anterior', 'Elevação aberta; elevação a 90 graus', 'Confirmar trajetória e ajustes.', 'disponivel'),
  (25, 'EQ25', 'equipamento', 'Máquina voador', 'Máquina combinada', 'Peitoral, deltoide posterior, romboides', 'Voador peitoral; voador inverso', 'Alternar regulagem para peito/costas.', 'disponivel'),
  (26, 'EQ26', 'equipamento', 'Máquina de desenvolvimento', 'Máquina', 'Deltoides, tríceps', 'Desenvolvimento pegada neutra; desenvolvimento pegada pronada', 'Duas pegadas disponíveis.', 'disponivel'),
  (27, 'EQ27', 'equipamento', 'Supino articulado reto', 'Máquina', 'Peitoral, tríceps, deltoide anterior', 'Supino reto articulado', '', 'disponivel'),
  (28, 'EQ28', 'equipamento', 'Supino articulado 45°', 'Máquina', 'Peitoral (ênfase clavicular), tríceps, deltoide anterior', 'Supino inclinado articulado', '', 'disponivel'),
  (29, 'EQ29', 'equipamento', 'Remada cavalinho com apoio', 'Máquina', 'Grande dorsal, romboides, trapézio, deltoide posterior', 'Remada com apoio e variações de pegada', 'Verificar encaixe de cada puxador.', 'disponivel'),
  (30, 'EQ30', 'equipamento', 'Máquina pulley', 'Polia alta', 'Grande dorsal, redondo maior, bíceps', 'Puxada alta pronada; puxada neutra; puxada supinada', 'Varia conforme puxador instalado.', 'disponivel'),
  (31, 'EQ31', 'equipamento', 'Remada baixa KIKOS', 'Máquina / cabo baixo', 'Grande dorsal, romboides, trapézio médio, bíceps', 'Remada baixa com triângulo; remada com puxador neutro', 'Cabo baixo; puxada em direção ao abdômen.', 'disponivel'),
  (32, 'EQ32', 'equipamento', 'Remada trajetória alta Conexão Fitness', 'Máquina de remada', 'Trapézio médio, romboides, deltoide posterior, grande dorsal', 'Remada com trajetória alta; cotovelos abertos ou próximos', 'Ênfase depende da linha de puxada; não isola trapézio inferior.', 'disponivel'),
  (33, 'EQ33', 'equipamento', 'Barra longa de carga + anilhas', 'Peso livre', 'Corpo inteiro', 'Agachamento livre; supino com barra; levantamento terra; remada curvada', 'Não consta no inventário — confirmar antes de liberar.', 'pendente'),
  (34, 'EQ34', 'equipamento', 'Rack / suporte de agachamento', 'Suporte', 'Pernas, peito', 'Agachamento livre; supino livre (com EQ33 e banco)', 'Não consta no inventário — confirmar antes de liberar.', 'pendente'),
  (35, 'EQ35', 'equipamento', 'Banco móvel (reto / inclinado)', 'Banco', 'Peito, costas, ombros', 'Supino com halteres; remada apoiada; desenvolvimento sentado', 'Não consta no inventário — confirmar antes de liberar.', 'pendente'),

  (36, 'PG01', 'puxador', 'MAPFIT extra largo', 'Puxador', 'Neutra / paralela, larga', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir em quais estações encaixa.', 'disponivel'),
  (37, 'PG02', 'puxador', 'MAPFIT largo', 'Puxador', 'Neutra / paralela, larga', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (38, 'PG03', 'puxador', 'MAPFIT médio', 'Puxador', 'Neutra / paralela, média', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (39, 'PG04', 'puxador', 'MAPFIT fechado', 'Puxador', 'Neutra / paralela, fechada', 'Puxada / remada fechada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (40, 'PG05', 'puxador', 'MAPFIT neutro médio compacto', 'Puxador', 'Neutra / paralela, média', 'Puxada / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (41, 'PG06', 'puxador', 'Verde articulado largo', 'Puxador', 'Ajustável, largura grande', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (42, 'PG07', 'puxador', 'Verde articulado médio', 'Puxador', 'Ajustável, largura média', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (43, 'PG08', 'puxador', 'Verde articulado multifuncional', 'Puxador', 'Variável / articulada', 'Puxada alta / remada', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (44, 'PG09', 'puxador', 'Triângulo metálico fechado', 'Puxador', 'Neutra, fechada', 'Remada baixa; puxada fechada', '', 'disponivel'),
  (45, 'PG10', 'puxador', 'Barra metálica curta reta', 'Puxador', 'Pronada / supinada', 'Rosca no cabo; tríceps no cabo', 'Aplicação cortada no PDF — conferir.', 'disponivel'),
  (46, 'PG11', 'puxador', 'Puxador metálico curvo', 'Puxador', 'Variável', 'Puxada / tríceps no cabo', 'Identificação parcial no PDF — conferir.', 'disponivel'),
  (47, 'PG12', 'puxador', 'Barra longa angular', 'Puxador', 'Pronada, larguras variáveis', 'Puxada alta pronada', 'Aplicação cortada no PDF — conferir.', 'disponivel')
)
insert into public.academia_inventario (nutri_id, ativo, itens)
select u.id, true,
       (select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'tipo', i.tipo, 'nome', i.nome, 'categoria', i.categoria,
                 'grupos', i.grupos, 'exercicios', i.exercicios, 'obs', i.obs,
                 'situacao', i.situacao) order by i.ordem)
          from item i)
from auth.users u
where lower(u.email) = lower('eduardomedani@gmail.com')
on conflict (nutri_id) do nothing;


-- ---------------------------------------------------------------------------
-- 4) CONFERÊNCIA
-- ---------------------------------------------------------------------------
-- Esperado: 1 linha, 47 itens (35 equipamentos + 12 puxadores), 3 pendentes,
-- e quatro policies (select/insert/update/delete).
-- ---------------------------------------------------------------------------
select u.email,
       a.ativo,
       jsonb_array_length(a.itens)                                                        as itens,
       (select count(*) from jsonb_array_elements(a.itens) e where e->>'tipo' = 'equipamento') as equipamentos,
       (select count(*) from jsonb_array_elements(a.itens) e where e->>'tipo' = 'puxador')     as puxadores,
       (select count(*) from jsonb_array_elements(a.itens) e where e->>'situacao' = 'pendente') as pendentes,
       (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
         where c.relname = 'academia_inventario')                                         as policies
from public.academia_inventario a
join auth.users u on u.id = a.nutri_id;
