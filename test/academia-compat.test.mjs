// ═══════════════════════════════════════════════════════════
// O QUE CABE NA ACADEMIA — regras de exercício × inventário
// ═══════════════════════════════════════════════════════════
// Os nomes abaixo são da biblioteca real (746 exercícios). O erro que estes
// testes pegam é o filtro "Minha academia" mostrar o que a academia não tem —
// agachamento com barra sem rack, supino com halter sem banco, tríceps na
// corda sem corda — ou esconder o que ela tem.

import { grupo, teste, ok, igual } from './runner.mjs';
import { recursosDoItem, recursosDisponiveis, requisitosDoExercicio, cabeNaAcademia } from '../js/academia-compat.js';

// Inventário do PDF, como está no banco (resumido aos nomes que importam).
const ITENS = [
  ['EQ01', 'Par de halteres de 1 a 40'], ['EQ03', 'Colchonete de alongamento'], ['EQ04', 'Steps'],
  ['EQ05', 'Barra W'], ['EQ07', 'Barra reta curta'], ['EQ09', 'Polia unilateral'], ['EQ10', 'Banco Scott'],
  ['EQ12', 'Cadeira extensora'], ['EQ13', 'Cadeira flexora'], ['EQ14', 'Banco romano'], ['EQ16', 'Hack squat'],
  ['EQ18', 'Leg press 45°'], ['EQ20', 'Adutora e abdutora'], ['EQ22', 'Cross over'],
  ['EQ23', 'Gaiola de agachamento guiado (Smith)'], ['EQ25', 'Máquina voador'], ['EQ26', 'Máquina de desenvolvimento'],
  ['EQ27', 'Supino articulado reto'], ['EQ28', 'Supino articulado 45°'], ['EQ29', 'Remada cavalinho com apoio'],
  ['EQ30', 'Máquina pulley'], ['EQ31', 'Remada baixa KIKOS'],
].map(([id, nome]) => ({ id, nome, tipo: 'equipamento', situacao: 'disponivel' }))
  .concat([
    { id: 'EQ33', nome: 'Barra longa de carga + anilhas', tipo: 'equipamento', situacao: 'pendente' },
    { id: 'EQ34', nome: 'Rack / suporte de agachamento', tipo: 'equipamento', situacao: 'pendente' },
    { id: 'EQ35', nome: 'Banco móvel (reto / inclinado)', tipo: 'equipamento', situacao: 'pendente' },
    { id: 'PG03', nome: 'MAPFIT médio', tipo: 'puxador', situacao: 'disponivel' },
    { id: 'PG09', nome: 'Triângulo metálico fechado', tipo: 'puxador', situacao: 'disponivel' },
  ]);

const INV = { ativo: true, itens: ITENS };
const disp = recursosDisponiveis(INV);
const cabe = (nome, equipamento) => cabeNaAcademia({ nome, equipamento }, disp);

grupo('academia · o que o filtro mostra', () => {
  teste('máquinas e polias que existem aparecem', () => {
    for (const [n, e] of [
      ['Leg press', 'Máquina'], ['Agachamento hack na máquina', 'Máquina'], ['Cadeira extensora', 'Máquina'],
      ['Crucifixo na máquina (voador)', 'Máquina'], ['Crucifixo invertido na máquina', 'Máquina'],
      ['Supino inclinado na máquina articulada', 'Máquina'], ['Remada T deitado', 'Máquina'],
      ['Agachamento no Smith', 'Máquina'], ['Puxada aberta', 'Cabo / polia'], ['Puxada com barra V', 'Cabo / polia'],
      ['Remada sentado na polia (remada baixa)', 'Cabo / polia'], ['Crossover na polia', 'Cabo / polia'],
      ['Tríceps pulley (polia)', 'Cabo / polia'], ['Hiperextensão lombar', 'Outro'],
    ]) ok(cabe(n, e), `${n} deveria caber`);
  });

  teste('peso livre: halteres e barras curtas servem para braço', () => {
    ok(cabe('Rosca martelo', 'Halter'));
    ok(cabe('Rosca direta com barra', 'Barra'), 'barra reta curta / W fazem rosca direta');
    ok(cabe('Rosca Scott com barra', 'Barra'));
    ok(cabe('Agachamento goblet', 'Kettlebell'), 'goblet com halter, como diz o PDF');
    ok(cabe('Supino no solo com halteres', 'Halter'), 'no chão não precisa de banco');
  });

  teste('O PENDENTE FICA DE FORA: barra de carga, rack e banco', () => {
    ok(!cabe('Agachamento com barra', 'Barra'));
    ok(!cabe('Levantamento terra com barra', 'Barra'));
    ok(!cabe('Supino reto com halteres', 'Halter, Banco'));
    ok(!cabe('Supino inclinado com halteres', 'Halter'));
    ok(!cabe('Supino no Smith', 'Máquina'), 'Smith deitado precisa de banco');
    ok(!cabe('Supino fechado na barra W', 'Barra W'), 'barra W, mas deitado no banco');
  });

  teste('acessório ausente esconde o exercício', () => {
    ok(!cabe('Tríceps pulley com corda', 'Cabo / polia'), 'sem corda no inventário');
    ok(!cabe('Face pull na polia', 'Cabo / polia'));
    ok(!cabe('Coice de glúteos unilateral na polia', 'Cabo / polia'), 'sem tornozeleira');
  });

  teste('o que a academia não tem não aparece', () => {
    for (const [n, e] of [
      ['Barra fixa (pegada pronada)', 'Livre / peso corporal'], ['Paralelas (foco no tríceps)', 'Outro'],
      ['Swing unilateral com kettlebell', 'Kettlebell'], ['Abdominal na bola suíça', 'Bola suíça'],
      ['Agachamento no caixote', 'Barra'], ['Corda naval', 'Outro'], ['Panturrilha em pé na máquina', 'Máquina'],
      ['Abdominal com pernas na bola suíça', 'Livre / peso corporal'],
    ]) ok(!cabe(n, e), `${n} não deveria caber`);
  });

  teste('peso corporal não exige nada', () => {
    ok(cabe('Prancha', 'Livre / peso corporal'));
    ok(cabe('Flexão de braços', 'Livre / peso corporal'));
    igual(requisitosDoExercicio({ nome: 'Prancha', equipamento: 'Livre / peso corporal' }), [[]]);
  });

  teste('CONFIRMAR O BANCO LIBERA O SUPINO COM HALTERES', () => {
    // É a promessa da tela: mudar a situação muda o filtro, sem cadastro extra.
    const comBanco = { ativo: true, itens: ITENS.map(i => i.id === 'EQ35' ? { ...i, situacao: 'disponivel' } : i) };
    ok(cabeNaAcademia({ nome: 'Supino reto com halteres', equipamento: 'Halter, Banco' }, recursosDisponiveis(comBanco)));
  });

  teste('aparelho sem regra fica só em "Todos"', () => {
    ok(!cabe('Glute-ham raise', 'Máquina'));
    ok(!cabe('Exercício inventado', 'Outro'));
  });
});

grupo('academia · o que cada item fornece', () => {
  teste('inferido do nome', () => {
    igual(recursosDoItem({ nome: 'Máquina pulley', tipo: 'equipamento' }).sort(), ['polia', 'polia_alta']);
    igual(recursosDoItem({ nome: 'Supino articulado 45°', tipo: 'equipamento' }), ['supino_inclinado_maquina']);
    igual(recursosDoItem({ nome: 'Supino articulado reto', tipo: 'equipamento' }), ['supino_maquina']);
    igual(recursosDoItem({ nome: 'Triângulo metálico fechado', tipo: 'puxador' }), ['triangulo']);
    igual(recursosDoItem({ nome: 'Corda de tríceps', tipo: 'puxador' }), ['corda']);
    igual(recursosDoItem({ nome: 'Barra reta longa para alongamento', tipo: 'equipamento' }), []);
  });

  teste('o marcado à mão manda', () => {
    igual(recursosDoItem({ nome: 'Coisa nova', recursos: ['banco', 'invalido'] }), ['banco']);
  });

  teste('sem inventário, ou desligado, tudo cabe', () => {
    igual(recursosDisponiveis(null), null);
    igual(recursosDisponiveis({ ativo: false, itens: ITENS }), null);
    ok(cabeNaAcademia({ nome: 'Agachamento com barra', equipamento: 'Barra' }, null));
  });
});
