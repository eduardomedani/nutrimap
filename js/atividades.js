// ═══════════════════════════════════════════════════════════
// ATIVIDADE FÍSICA — tabela de METs e gasto por sessão
// ═══════════════════════════════════════════════════════════
// Função pura: sem DOM, sem rede. Mesmo padrão de calorias-calc.js.
//
// MODELO ADITIVO. Alternativa ao fator de atividade (calorias-calc.js:FATORES),
// que é uma classificação única da rotina inteira e não decompõe por atividade.
// Aqui cada atividade entra separada e o gasto é somado ao GET.
//
// Os dois NÃO se combinam: o fator multiplicador já embute o exercício, então
// quando este modelo está ligado o fator volta a 1,2 (só rotina, sem treino),
// senão o mesmo gasto é contado duas vezes.
//
// Fórmula clássica do MET (Compendium of Physical Activities):
//   kcal/min = MET × 3,5 × peso(kg) / 200
// O 3,5 é o consumo de O₂ em repouso (ml/kg/min) e o 200 converte litros de
// O₂ em kcal. Vale como estimativa populacional, não medida individual.
//
// ATIVIDADE × INTENSIDADE: onde a referência dá uma faixa (CrossFit 8–12,
// elíptico 5–8...), os extremos viram Leve/Intenso e o meio vira Moderado —
// nenhum valor foi inventado fora da faixa informada.

const MET_ML_O2 = 3.5;
const DIV_KCAL = 200;

/** Rótulo usado quando a atividade tem um único MET de referência. */
const UNICA = 'Padrão';

export const ATIVIDADES = [
  { nome: 'Caminhada', intensidades: [
    { label: 'Lenta', met: 2.8 }, { label: 'Moderada', met: 3.5 },
    { label: 'Rápida', met: 4.3 }, { label: 'Muito rápida', met: 5.0 },
    { label: 'Em subida', met: 7.0 },
  ]},
  { nome: 'Corrida', intensidades: [
    { label: '8 km/h', met: 8.3 }, { label: '9,7 km/h', met: 9.8 },
    { label: '11 km/h', met: 11.0 }, { label: '13 km/h', met: 12.8 },
    { label: 'Sprint', met: 15.0 },
  ]},

  { nome: 'Musculação', intensidades: [
    { label: 'Leve', met: 3.5 }, { label: 'Moderada', met: 5.0 },
    { label: 'Intensa', met: 6.0 }, { label: 'Circuito', met: 8.0 },
  ]},
  { nome: 'Elíptico', intensidades: [
    { label: 'Leve', met: 5.0 }, { label: 'Moderado', met: 6.5 }, { label: 'Intenso', met: 8.0 },
  ]},
  { nome: 'Escada (subir)', intensidades: [
    { label: 'Moderada', met: 8.0 }, { label: 'Intensa', met: 9.0 },
  ]},
  { nome: 'Remo ergômetro', intensidades: [
    { label: 'Leve', met: 7.0 }, { label: 'Intenso', met: 12.0 },
  ]},
  { nome: 'Jump Fitness', intensidades: [{ label: UNICA, met: 8.8 }] },
  { nome: 'Spinning', intensidades: [
    { label: 'Leve', met: 8.5 }, { label: 'Moderado', met: 9.5 }, { label: 'Intenso', met: 10.5 },
  ]},
  { nome: 'CrossFit', intensidades: [
    { label: 'Leve', met: 8.0 }, { label: 'Moderado', met: 10.0 }, { label: 'Intenso', met: 12.0 },
  ]},
  { nome: 'HIIT', intensidades: [
    { label: 'Leve', met: 8.0 }, { label: 'Moderado', met: 10.0 }, { label: 'Intenso', met: 12.0 },
  ]},
  { nome: 'Funcional', intensidades: [
    { label: 'Leve', met: 6.0 }, { label: 'Moderado', met: 7.0 }, { label: 'Intenso', met: 8.0 },
  ]},

  { nome: 'Bicicleta', intensidades: [
    { label: 'Leve', met: 4.0 }, { label: 'Moderada', met: 6.8 }, { label: 'Intensa', met: 10.0 },
  ]},
  { nome: 'Bicicleta ergométrica', intensidades: [
    { label: 'Leve', met: 5.5 }, { label: 'Vigorosa', met: 8.8 },
  ]},

  { nome: 'Futebol', intensidades: [
    { label: 'Recreativo', met: 7.0 }, { label: 'Competitivo', met: 10.0 },
  ]},
  { nome: 'Futsal', intensidades: [{ label: UNICA, met: 8.0 }] },
  { nome: 'Basquete', intensidades: [
    { label: 'Recreativo', met: 6.0 }, { label: 'Competitivo', met: 8.0 },
  ]},
  { nome: 'Vôlei', intensidades: [
    { label: 'Recreativo', met: 3.0 }, { label: 'Competitivo', met: 6.0 },
    { label: 'De praia', met: 8.0 },
  ]},
  { nome: 'Tênis', intensidades: [
    { label: 'Em dupla', met: 4.5 }, { label: 'Simples', met: 8.0 },
  ]},
  { nome: 'Beach Tennis', intensidades: [{ label: UNICA, met: 7.3 }] },
  { nome: 'Padel', intensidades: [{ label: UNICA, met: 7.0 }] },

  { nome: 'Natação', intensidades: [
    { label: 'Recreativa', met: 6.0 }, { label: 'Vigorosa', met: 9.0 },
  ]},
  { nome: 'Hidroginástica', intensidades: [{ label: UNICA, met: 5.5 }] },
  { nome: 'Polo aquático', intensidades: [{ label: UNICA, met: 10.0 }] },
  { nome: 'Stand Up Paddle', intensidades: [{ label: UNICA, met: 6.0 }] },
  { nome: 'Caiaque', intensidades: [{ label: UNICA, met: 5.0 }] },
  { nome: 'Surfe', intensidades: [
    { label: 'Leve', met: 3.0 }, { label: 'Moderado', met: 4.0 }, { label: 'Intenso', met: 5.0 },
  ]},

  { nome: 'Pilates', intensidades: [{ label: UNICA, met: 3.0 }] },
  { nome: 'Yoga', intensidades: [
    { label: 'Hatha', met: 2.5 }, { label: 'Power Yoga', met: 4.0 },
  ]},
  { nome: 'Alongamento', intensidades: [{ label: UNICA, met: 2.3 }] },

  { nome: 'Dança de salão', intensidades: [{ label: UNICA, met: 4.5 }] },
  { nome: 'Zumba', intensidades: [{ label: UNICA, met: 7.5 }] },
  { nome: 'Ballet', intensidades: [{ label: UNICA, met: 6.0 }] },

  { nome: 'Judô', intensidades: [{ label: UNICA, met: 10.3 }] },
  { nome: 'Jiu-Jitsu', intensidades: [{ label: UNICA, met: 10.0 }] },
  { nome: 'Karatê', intensidades: [{ label: UNICA, met: 10.3 }] },
  { nome: 'Taekwondo', intensidades: [{ label: UNICA, met: 10.3 }] },
  { nome: 'Boxe', intensidades: [
    { label: 'Treino', met: 7.8 }, { label: 'Sparring', met: 12.8 },
  ]},

  { nome: 'Patinação', intensidades: [{ label: UNICA, met: 7.5 }] },
  { nome: 'Skate', intensidades: [{ label: UNICA, met: 5.0 }] },
  { nome: 'Escalada', intensidades: [{ label: UNICA, met: 8.0 }] },
];

// Lista plana em ordem alfabética pt-BR (localeCompare cuida dos acentos:
// sem ele, 'Elíptico' e 'Vôlei' cairiam fora de lugar).
export const ATIVIDADES_ORDENADAS = [...ATIVIDADES].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

export function atividadePorNome(nome) {
  return ATIVIDADES.find(a => a.nome === nome) || null;
}

/** MET de uma combinação atividade+intensidade. Cai na 1ª intensidade se sumir. */
export function metDe(nome, intensidade) {
  const at = atividadePorNome(nome);
  if (!at) return 0;
  const i = at.intensidades.find(x => x.label === intensidade) || at.intensidades[0];
  return i?.met || 0;
}

/** kcal por minuto de atividade. */
export function kcalPorMinuto(met, pesoKg) {
  return (Number(met) || 0) * MET_ML_O2 * (Number(pesoKg) || 0) / DIV_KCAL;
}

/** kcal de uma sessão. */
export function kcalSessao(met, pesoKg, minutos) {
  return kcalPorMinuto(met, pesoKg) * (Number(minutos) || 0);
}

/**
 * Média DIÁRIA do conjunto — o gasto semanal diluído em 7 dias. Diluir é uma
 * escolha: mantém uma meta calórica única, em vez de uma meta por dia de
 * treino. Se um dia o nutri quiser ciclar por dia, é aqui que a conta muda.
 *
 * @param {Array} atividades [{ nome, intensidade, minutos, vezesSemana }]
 * @param {number} pesoKg
 * @returns {{ porAtividade: Array, kcalSemana: number, kcalDia: number }}
 */
export function gastoDeAtividades(atividades, pesoKg) {
  const porAtividade = (atividades || []).map(a => {
    const met = metDe(a.nome, a.intensidade);
    const sessao = kcalSessao(met, pesoKg, a.minutos);
    return { ...a, met, kcalSessao: sessao, kcalSemana: sessao * (Number(a.vezesSemana) || 0) };
  });
  const kcalSemana = porAtividade.reduce((s, a) => s + a.kcalSemana, 0);
  return { porAtividade, kcalSemana, kcalDia: kcalSemana / 7 };
}
