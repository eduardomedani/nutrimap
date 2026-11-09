// ═══════════════════════════════════════════════════════════
// BASE EVOLLO → BIBLIOTECA DE EXERCÍCIOS
// ═══════════════════════════════════════════════════════════
// Cada exercício da base (evollo_base_treinos.json, ids PE01, CO13…) aponta
// para um exercício da biblioteca (tabela `exercicios`) PELO NOME EXATO — é o
// exercício da biblioteca que vai para o treino do aluno (com vídeo/animação).
//
// Curado à mão em 09/11/2026 contra a biblioteca real (746 exercícios):
//   · 40 com nome idêntico;
//   · os demais com o equivalente de nome diferente (a busca automática
//     errava alguns: "Rosca na polia baixa" casava com "Crossover na polia
//     baixa");
//   · `criar`: 16 que NÃO existiam na biblioteca e foram cadastrados nela
//     (decisão do Eduardo: manter a base fiel). Grupo/equipamento seguem a
//     convenção da biblioteca, e o nome é o que o filtro do inventário lê
//     (js/academia-compat.js) — mudar o nome muda o que o filtro exige.

export const MAPA = {
  PE01: 'Supino reto com barra',
  PE02: 'Supino reto com halteres',
  PE03: 'Supino na máquina articulada',
  PE04: 'Supino inclinado com barra',
  PE05: 'Supino inclinado com halteres',
  PE06: 'Supino inclinado na máquina articulada',
  PE07: 'Supino declinado com barra',
  PE08: 'Flexão de braços',
  PE09: 'Paralelas (foco no peito)',
  PE10: 'Crucifixo com halteres',
  PE11: 'Crucifixo inclinado com halteres',
  PE12: 'Crucifixo na máquina (voador)',
  PE13: 'Crossover na polia',
  PE14: 'Crossover na polia baixa',
  PE15: 'Pullover com halter braços estendidos',
  CO01: 'Puxada aberta',
  CO02: 'Puxada com barra V',
  CO03: 'Puxada pegada supinada na polia',
  CO04: 'Barra fixa (pegada pronada)',
  CO05: 'Barra fixa (pegada supinada)',
  CO06: 'Barra fixa com peso',
  CO07: { criar: { nome: 'Barra fixa no graviton', grupo_muscular: 'Dorsais', equipamento: 'Máquina' } },
  CO08: 'Remada curvada com barra',
  CO09: 'Remada curvada pegada supinada',
  CO10: 'Remada sentado na polia (remada baixa)',
  CO11: 'Remada unilateral com halter (serrote)',
  CO12: 'Remada isolateral na máquina articulada',
  CO13: 'Remada T deitado',
  CO14: { criar: { nome: 'Remada Pendlay', grupo_muscular: 'Costas', equipamento: 'Barra' } },
  CO15: 'Pulldown com braços estendidos (polia)',
  CO16: 'Pulldown com braços estendidos na corda',
  OM01: 'Desenvolvimento com halteres',
  OM02: 'Desenvolvimento na máquina articulada',
  OM03: 'Desenvolvimento militar em pé',
  OM04: 'Desenvolvimento Arnold com halteres',
  OM05: { criar: { nome: 'Push press com barra', grupo_muscular: 'Ombros', equipamento: 'Barra' } },
  OM06: 'Remada alta com barra',
  OM07: 'Elevação lateral',
  OM08: 'Elevação de deltoide em pé na polia baixa',
  OM09: { criar: { nome: 'Elevação lateral na máquina', grupo_muscular: 'Ombros', equipamento: 'Máquina' } },
  OM10: 'Elevação frontal com halteres',
  OM11: 'Elevação frontal com anilha',
  OP01: 'Crucifixo invertido na máquina',
  OP02: 'Crucifixo invertido',
  OP03: 'Face pull na polia',
  OP04: 'Crucifixo invertido na polia',
  TR01: 'Encolhimento com halteres',
  TR02: 'Encolhimento com barra',
  TR03: { criar: { nome: 'Encolhimento no Smith', grupo_muscular: 'Trapézio', equipamento: 'Máquina' } },
  BI01: 'Rosca direta com barra',
  BI02: 'Rosca direta na barra W',
  BI03: 'Rosca alternada com halteres',
  BI04: 'Rosca martelo',
  BI05: 'Rosca Scott na máquina',
  BI06: 'Rosca Scott com barra',
  BI07: 'Rosca concentrada',
  BI08: 'Rosca inclinada com halteres',
  BI09: 'Rosca em pé na polia',
  BI10: { criar: { nome: 'Rosca 21', grupo_muscular: 'Bíceps', equipamento: 'Barra' } },
  BI11: 'Rosca spider',
  TC01: 'Tríceps pulley (polia)',
  TC02: 'Tríceps pulley com corda',
  TC03: 'Tríceps testa na barra W',
  TC04: 'Extensão de tríceps em pé com halteres',
  TC05: { criar: { nome: 'Tríceps coice na polia', grupo_muscular: 'Tríceps', equipamento: 'Cabo / polia' } },
  TC06: 'Supino fechado com barra',
  TC07: 'Paralelas (foco no tríceps)',
  TC08: 'Mergulho no banco (tríceps)',
  TC09: 'Tríceps francês na polia',
  TC10: 'Extensão de tríceps na máquina',
  QU01: 'Agachamento com barra',
  QU02: 'Agachamento no Smith',
  QU03: 'Agachamento frontal com barra',
  QU04: 'Agachamento goblet',
  QU05: 'Leg press',
  QU06: 'Agachamento hack na máquina',
  QU07: 'Afundo com halteres',
  QU08: { criar: { nome: 'Agachamento búlgaro com halteres', grupo_muscular: 'Quadríceps', equipamento: 'Halter' } },
  QU09: { criar: { nome: 'Passada com halteres (avanço caminhando)', grupo_muscular: 'Quadríceps', equipamento: 'Halter' } },
  QU10: 'Cadeira extensora',
  QU11: { criar: { nome: 'Sissy squat', grupo_muscular: 'Quadríceps', equipamento: 'Livre / peso corporal' } },
  PO01: 'Stiff com barra (pernas estendidas)',
  PO02: 'Stiff com halteres (pernas estendidas)',
  PO03: 'Levantamento terra romeno',
  PO04: 'Levantamento terra com barra',
  PO05: 'Bom dia com barra',
  PO06: 'Mesa flexora',
  PO07: 'Cadeira flexora',
  PO08: 'Flexão de perna em pé (máquina)',
  PO09: { criar: { nome: 'Flexão nórdica', grupo_muscular: 'Posterior de coxa', equipamento: 'Livre / peso corporal' } },
  GL01: 'Elevação pélvica com barra',
  GL02: { criar: { nome: 'Elevação pélvica na máquina', grupo_muscular: 'Glúteos', equipamento: 'Máquina' } },
  GL03: 'Agachamento plié com halter',
  GL04: 'Subida no banco com halteres',
  GL05: 'Levantamento terra sumô',
  GL06: 'Coice de glúteos unilateral na polia',
  GL07: { criar: { nome: 'Glúteo 4 apoios na máquina', grupo_muscular: 'Glúteos', equipamento: 'Máquina' } },
  GL08: 'Cadeira abdutora',
  GL09: 'Ponte de glúteos unilateral',
  GL10: { criar: { nome: 'Abdução de quadril na polia em pé', grupo_muscular: 'Abdutores', equipamento: 'Cabo / polia' } },
  PA01: 'Panturrilha em pé na máquina',
  PA02: 'Panturrilha sentado na máquina',
  PA03: 'Panturrilha no leg press',
  PA04: 'Panturrilha em pé com halteres',
  AB01: 'Prancha',
  AB02: 'Abdominal (crunch)',
  AB03: 'Elevação de pernas deitado no banco reto',
  AB04: 'Elevação de pernas suspenso',
  AB05: 'Abdominal na polia',
  AB06: 'Prancha lateral',
  AB07: { criar: { nome: 'Abdominal remador', grupo_muscular: 'Abdômen', equipamento: 'Livre / peso corporal' } },
  AB08: 'Roda abdominal',
  AB09: 'Pallof press',
  AB10: 'Abdominal bicicleta',
  CARDIO: { criar: { nome: 'Cardio moderado (esteira, bike ou elíptico)', grupo_muscular: 'Cardio', equipamento: 'Outro' } },
};

/** Nome na biblioteca de um id da base (string ou o `criar.nome`). */
export const nomeNaBiblioteca = id => {
  const v = MAPA[id];
  return typeof v === 'string' ? v : v?.criar?.nome || null;
};

/** Os exercícios que precisam existir na biblioteca e não existiam. */
export const A_CRIAR = Object.entries(MAPA).filter(([, v]) => typeof v === 'object').map(([id, v]) => ({ id, ...v.criar }));
