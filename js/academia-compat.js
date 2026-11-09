// ═══════════════════════════════════════════════════════════
// O QUE CABE NA ACADEMIA — exercício × inventário
// ═══════════════════════════════════════════════════════════
// Puro (sem DOM, sem banco): usado pelo filtro "Minha academia" da biblioteca
// e pelo gerador de treinos, que só manda para a IA o que cabe.
//
// O MODELO
//   · Cada item do inventário FORNECE recursos ('halter', 'polia', 'leg_press'…).
//     Vêm de `item.recursos` se o profissional marcou; senão são inferidos do
//     nome — assim item cadastrado à mão ("Cross over") já funciona.
//   · Cada exercício EXIGE recursos, como alternativas: [['halter','banco'],
//     ['halter']] = "halter com banco OU só halter". [[]] = não exige nada.
//   · Cabe se ALGUMA alternativa tiver todos os recursos disponíveis.
//
// A biblioteca não diz o aparelho (o campo `equipamento` é genérico: "Barra",
// "Máquina", "Outro"). Por isso as regras leem o NOME. Na dúvida, a regra é
// conservadora — exigir algo que pode faltar é melhor que prescrever o que não
// existe. Exercício de aparelho que não tem regra exige 'nao_mapeado', que
// nenhum item fornece: fica só em "Todos".

/** Recursos com rótulo — a lista que a tela "Minha academia" oferece. */
export const RECURSOS = {
  halter: 'Halteres', banco: 'Banco móvel', kettlebell: 'Kettlebell', anilha: 'Anilhas avulsas',
  barra_carga: 'Barra longa + anilhas', rack: 'Rack / suporte', smith: 'Smith / guiado',
  barra_w: 'Barra W', barra_h: 'Barra H', barra_curta: 'Barra reta curta',
  polia: 'Polia / cabo', polia_alta: 'Puxada alta (pulley)', remada_baixa: 'Remada baixa (cabo)',
  cross: 'Cross over (2 polias)', corda: 'Puxador corda', triangulo: 'Triângulo / barra V',
  puxador_barra: 'Barra/pegador de puxada', tornozeleira: 'Tornozeleira (cabo)',
  extensora: 'Cadeira extensora', flexora: 'Cadeira/mesa flexora', flexora_em_pe: 'Flexora em pé',
  leg_press: 'Leg press', hack: 'Hack squat', pendulo: 'Agachamento pêndulo', agach_sumo: 'Agachamento sumô (máquina)',
  gluteo_maquina: 'Elevação pélvica (máquina)', adutora_abdutora: 'Adutora / abdutora',
  banco_romano: 'Banco romano', voador: 'Voador (peito / inverso)', desenvolvimento_maquina: 'Desenvolvimento (máquina)',
  supino_maquina: 'Supino reto (máquina)', supino_inclinado_maquina: 'Supino inclinado (máquina)',
  supino_declinado_maquina: 'Supino declinado (máquina)', remada_maquina: 'Remada apoiada (máquina)',
  elevacao_lateral_maquina: 'Elevação de ombro (máquina)', panturrilha_maquina: 'Panturrilha (máquina)',
  triceps_maquina: 'Tríceps (máquina)', rosca_maquina: 'Rosca (máquina)', abdominal_maquina: 'Abdominal (máquina)',
  scott: 'Banco Scott', step: 'Step / caixote baixo', espaldar: 'Espaldar', colchonete: 'Colchonete',
  barra_fixa: 'Barra fixa', paralelas: 'Paralelas', fitas: 'Fitas de suspensão', elastico: 'Elástico',
  bola_suica: 'Bola suíça', rolo: 'Rolo de espuma', medicine_ball: 'Medicine ball',
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ───────────────────────────────────────────────────────────
// ITEM → recursos que ele fornece (inferidos do nome)
// ───────────────────────────────────────────────────────────
const INFERE_ITEM = [
  [/halter/, ['halter']],
  [/colchonete|tatame/, ['colchonete']],
  [/\bstep|caixote/, ['step']],
  [/barra w\b/, ['barra_w']],
  [/barra h\b/, ['barra_h']],
  [/barra reta curta/, ['barra_curta']],
  [/espaldar/, ['espaldar']],
  [/polia unilateral/, ['polia']],
  [/scott/, ['scott']],
  [/extensora/, ['extensora']],
  [/flexora em pe/, ['flexora_em_pe']],
  [/flexora/, ['flexora']],
  [/banco romano|lombar/, ['banco_romano']],
  [/sumo/, ['agach_sumo']],
  [/hack/, ['hack']],
  [/pendulo/, ['pendulo']],
  [/leg press/, ['leg_press']],
  [/elevacao pelvica|gluteo/, ['gluteo_maquina']],
  [/adutora|abdutora/, ['adutora_abdutora']],
  [/cross ?over/, ['cross', 'polia']],
  [/smith|guiad/, ['smith']],
  [/elevacao de ombro|elevacao lateral/, ['elevacao_lateral_maquina']],
  [/voador|peck|fly/, ['voador']],
  [/maquina de desenvolvimento|desenvolvimento/, ['desenvolvimento_maquina']],
  [/supino articulado 45|supino.*inclinado/, ['supino_inclinado_maquina']],
  [/supino.*declinado/, ['supino_declinado_maquina']],
  [/supino (articulado )?reto|supino na maquina/, ['supino_maquina']],
  [/cavalinho|remada.*(articulad|apoio|trajetoria)/, ['remada_maquina']],
  [/pulley|puxada/, ['polia_alta', 'polia']],
  [/remada baixa/, ['remada_baixa', 'polia']],
  [/panturrilha/, ['panturrilha_maquina']],
  [/barra longa de carga|barra olimpica|anilha/, ['barra_carga', 'anilha']],
  [/\brack\b|suporte de agachamento/, ['rack']],
  [/banco movel|banco (reto|inclinado|ajustavel)/, ['banco']],
  [/triangulo|barra v\b/, ['triangulo']],
  [/\bcorda\b/, ['corda']],
  [/tornozeleira/, ['tornozeleira']],
  [/kettlebell/, ['kettlebell']],
  [/elastico|miniband|superband/, ['elastico']],
  [/bola suica/, ['bola_suica']],
  [/rolo/, ['rolo']],
  [/medicine/, ['medicine_ball']],
  [/barra fixa/, ['barra_fixa']],
  [/paralela/, ['paralelas']],
  [/\btrx\b|fita/, ['fitas']],
];

/** Recursos que um item do inventário fornece. `item.recursos` manda, se existir. */
export function recursosDoItem(item) {
  if (Array.isArray(item?.recursos)) return item.recursos.filter(r => r in RECURSOS);
  const n = norm(item?.nome);
  if (item?.tipo === 'puxador') {
    if (/triangulo|barra v\b/.test(n)) return ['triangulo'];
    if (/\bcorda\b/.test(n)) return ['corda'];
    if (/tornozeleira/.test(n)) return ['tornozeleira'];
    return ['puxador_barra'];   // MAPFIT, articulados, barras de puxada
  }
  const out = new Set();
  for (const [re, rs] of INFERE_ITEM) if (re.test(n)) rs.forEach(r => out.add(r));
  return [...out];
}

/** Conjunto de recursos DISPONÍVEIS no inventário (null se não houver inventário ativo). */
export function recursosDisponiveis(inv) {
  if (!inv || !inv.ativo) return null;
  const disp = (inv.itens || []).filter(i => i && i.situacao === 'disponivel');
  if (!disp.length) return null;
  const s = new Set();
  disp.forEach(i => recursosDoItem(i).forEach(r => s.add(r)));
  return s;
}

// ───────────────────────────────────────────────────────────
// EXERCÍCIO → recursos exigidos (alternativas)
// ───────────────────────────────────────────────────────────
const NADA = [[]];
const IMPOSSIVEL = [['nao_mapeado']];

// Variação de exercício com barra que pede material que o inventário não
// descreve (correntes, caixote, board, landmine…). Fica de fora.
const MATERIAL_ESPECIAL = /corrente|caixote|board|pinos|landmine|jammer|cambered|hexagonal|treno|bosu|roda abdominal|enrolador|cinta|plataforma/;

const BANCO_NO_NOME = /\bbanco\b|inclinad|declinad|deitado|supino|crucifixo|pullover|sentado|tate press|testa|spider/;

function exigeBancoHalter(n) {
  // Chão substitui o banco no supino/crucifixo "no solo".
  if (/no solo/.test(n)) return [['halter']];
  if (/scott/.test(n)) return [['halter', 'scott']];
  if (/subida no banco/.test(n)) return [['halter', 'step'], ['halter', 'banco']];
  if (/\bbanco\b/.test(n)) return [['halter', 'banco']];   // "em pé ... no banco inclinado" ainda usa banco
  if (/em pe/.test(n)) return [['halter']];
  return BANCO_NO_NOME.test(n) ? [['halter', 'banco']] : [['halter']];
}

function exigeBarra(n, equip) {
  if (MATERIAL_ESPECIAL.test(n) || /elastico/.test(n) && /barra/.test(equip)) return IMPOSSIVEL;
  if (/smith/.test(n)) return exigeSmith(n);
  const banco = BANCO_NO_NOME.test(n) && !/em pe|no solo/.test(n);
  const com = alts => alts.map(a => banco ? [...a, 'banco'] : a);
  const leves = [['barra_w'], ['barra_curta'], ['barra_carga']];
  // Braço e punho: as barras curtas da academia servem.
  if (/scott/.test(n)) return [['barra_w', 'scott'], ['barra_curta', 'scott']];
  // Barra W é barra de braço: não sai de suporte, não pede rack.
  if (/barra w/.test(n) || equip === 'barra w') return com([['barra_w']]);
  if (/rosca|punho|triceps|jm press|elevacao frontal|remada alta|rotac/.test(n)) return com(leves);
  if (/no solo/.test(n)) return [['barra_carga']];
  // Agachamento, supino, desenvolvimento em pé e afins partem do suporte.
  if (/agachamento|supino|desenvolvimento|bom dia|rack pull|squat jerk|afundo/.test(n)) {
    return com([['barra_carga', 'rack']]);
  }
  return com([['barra_carga']]);
}

function exigeSmith(n) {
  if (/supino|elevacao de quadril|inclinad|declinad/.test(n)) return [['smith', 'banco']];
  return [['smith']];
}

function exigePolia(n) {
  if (/bosu/.test(n)) return IMPOSSIVEL;
  if (/coice|aducao de quadril|abducao de quadril|abdominal invertido/.test(n)) return [['polia', 'tornozeleira']];
  if (/corda|face pull|pull through/.test(n)) return [['polia', 'corda']];
  if (/barra v|triangulo|neutra fechada/.test(n)) {
    return /puxada|pulldown/.test(n) ? [['polia_alta', 'triangulo']] : [['polia', 'triangulo']];
  }
  if (/puxada|pulldown/.test(n)) {
    return /unilateral/.test(n) ? [['polia_alta']] : [['polia_alta', 'puxador_barra']];
  }
  if (/remada sentado|remada baixa/.test(n)) return [['remada_baixa', 'triangulo'], ['remada_baixa', 'puxador_barra']];
  if (/crossover|crucifixo|cruz de ferro|supino|desenvolvimento na polia|desenvolvimento sentado|desenvolvimento alternado/.test(n)) {
    return [['cross']];
  }
  if (/scott/.test(n)) return [['polia', 'scott', 'puxador_barra']];
  if (/unilateral|pallof|wood chop|judo|rotacao|elevacao|lateral|diagonal/.test(n)) return [['polia']];
  // Tríceps pulley, rosca na polia, terra/encolhimento na polia: pedem barra.
  return [['polia', 'puxador_barra']];
}

function exigeMaquina(n) {
  if (/smith/.test(n)) return exigeSmith(n);
  if (/panturrilha.*leg press|leg press/.test(n)) return [['leg_press']];
  if (/hack/.test(n)) return [['hack']];
  if (/cadeira extensora/.test(n)) return [['extensora']];
  if (/cadeira flexora|mesa flexora/.test(n)) return [['flexora']];
  if (/flexao de perna em pe/.test(n)) return [['flexora_em_pe']];
  if (/abdutora|adutora/.test(n)) return [['adutora_abdutora']];
  if (/voador|crucifixo/.test(n)) return [['voador']];   // inclui o inverso
  if (/desenvolvimento/.test(n)) return [['desenvolvimento_maquina']];
  if (/supino inclinado/.test(n)) return [['supino_inclinado_maquina']];
  if (/supino declinado/.test(n)) return [['supino_declinado_maquina']];
  if (/supino/.test(n)) return [['supino_maquina']];
  if (/remada (isolateral|t deitado)/.test(n)) return [['remada_maquina']];
  if (/panturrilha/.test(n)) return [['panturrilha_maquina']];
  if (/triceps|mergulho/.test(n)) return [['triceps_maquina']];
  if (/rosca/.test(n)) return [['rosca_maquina']];
  if (/abdominal/.test(n)) return [['abdominal_maquina']];
  return IMPOSSIVEL;
}

function exigeOutro(n) {
  if (MATERIAL_ESPECIAL.test(n)) return IMPOSSIVEL;
  if (/barra fixa|muscle up|suspensao com uma mao|puxada rocky|london bridges/.test(n)) {
    return /elastico/.test(n) ? [['barra_fixa', 'elastico']] : [['barra_fixa']];
  }
  if (/paralelas/.test(n)) return [['paralelas']];
  if (/fitas/.test(n)) return [['fitas']];
  if (/anilha|svend|otis/.test(n)) return [['anilha']];
  if (/hiperextensao lombar/.test(n)) return [['banco_romano']];
  if (/agachamento com peso/.test(n)) return [['halter'], ['kettlebell']];
  if (/caixote alto/.test(n)) return [['step'], ['banco']];
  if (/elastico/.test(n)) return [['elastico']];
  if (/alongamento|liberacao|prancha de equilibrio/.test(n)) return NADA;
  return IMPOSSIVEL;
}

function exigeLivre(n) {
  if (/bola suica/.test(n)) return [['bola_suica']];
  if (/barra fixa|suspens|pike/.test(n)) {
    return /elevacao de pernas/.test(n) ? [['barra_fixa'], ['espaldar']] : [['barra_fixa']];
  }
  if (/paralelas/.test(n)) return [['paralelas']];
  if (/remada invertida/.test(n)) return [['smith'], ['barra_fixa']];
  if (/apoiada em halter/.test(n)) return [['halter']];
  if (/glute-ham raise natural/.test(n)) return [['banco_romano']];
  if (/\bstep\b/.test(n)) return [['step']];
  if (/pes elevados|declinad/.test(n)) return [['step'], ['banco']];
  if (/banco reto|no banco/.test(n)) return [['banco']];
  return NADA;
}

/** Alternativas de recursos que o exercício exige. */
export function requisitosDoExercicio(ex) {
  const n = norm(ex?.nome);
  const equip = norm(ex?.equipamento);
  const partes = equip.split(',').map(s => s.trim()).filter(Boolean);
  const tem = p => partes.includes(p);

  if (/goblet/.test(n)) return [['kettlebell'], ['halter']];
  if (/smith/.test(n)) return exigeSmith(n);

  if (tem('maquina')) return exigeMaquina(n);
  if (tem('cabo / polia')) return exigePolia(n);
  if (tem('barra') || tem('barra w')) {
    const base = exigeBarra(n, tem('barra w') ? 'barra w' : 'barra');
    return tem('banco') ? base.map(a => a.includes('banco') ? a : [...a, 'banco']) : base;
  }
  if (tem('halter')) {
    const base = exigeBancoHalter(n);
    return tem('banco') ? base.map(a => a.includes('banco') ? a : [...a, 'banco']) : base;
  }
  if (tem('elastico')) return tem('banco') ? [['elastico', 'banco']] : [['elastico']];
  if (tem('banco')) {
    if (/rosca scott/.test(n)) return [['scott', 'halter']];
    if (/rosca/.test(n)) return [['banco', 'halter']];
    return [['banco']];
  }
  if (tem('kettlebell')) return [['kettlebell']];
  if (tem('bola suica')) return [['bola_suica']];
  if (tem('rolo de espuma')) return [['rolo']];
  if (tem('medicine ball')) return [['medicine_ball']];
  if (tem('outro')) return exigeOutro(n);
  if (tem('livre / peso corporal') || !partes.length) return exigeLivre(n);
  return IMPOSSIVEL;
}

/** O exercício cabe na academia? `disponiveis` = Set de recursosDisponiveis(). */
export function cabeNaAcademia(ex, disponiveis) {
  if (!disponiveis) return true;   // sem inventário: tudo vale
  return requisitosDoExercicio(ex).some(alt => alt.every(r => disponiveis.has(r)));
}
