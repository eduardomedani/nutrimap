// ═══════════════════════════════════════════════════════════
// SERVIÇOS CONTRATADOS — Alimentação, Treino, Academia
// ═══════════════════════════════════════════════════════════
// Fonte única da regra, usada pelo app do aluno e pela ficha no painel.
// Coluna `pacientes.servicos` (db/paciente_servicos.sql), marcada à mão.
//
// NULL (ou ausente, antes da migração) = "não definido": tudo liberado, como
// era antes. Lista vazia = nada contratado.

export const SERVICOS = [
  { id: 'alimentacao', rotulo: 'Alimentação', icone: 'salad',         ajuda: 'Plano alimentar e a aba Dieta no app' },
  { id: 'treino',      rotulo: 'Treino',      icone: 'dumbbell',      ajuda: 'Treinos e a aba Treino no app' },
  { id: 'academia',    rotulo: 'Academia',    icone: 'calendar-days', ajuda: 'Agenda de aulas e o plano da academia no app' },
];
const IDS = SERVICOS.map(s => s.id);

/** O cliente tem o serviço? Sem definição (null), tudo vale. */
export function contratou(servicos, id) {
  if (!Array.isArray(servicos)) return true;
  return servicos.includes(id);
}

/** Lista limpa, sem repetição e na ordem oficial — o que vai para o banco. */
export function normalizarServicos(lista) {
  const s = new Set(Array.isArray(lista) ? lista : []);
  return IDS.filter(id => s.has(id));
}

/** Rótulo curto para a ficha ("Alimentação + Treino", "Não definido"…). */
export function rotuloServicos(servicos) {
  if (!Array.isArray(servicos)) return 'Não definido';
  const nomes = SERVICOS.filter(s => servicos.includes(s.id)).map(s => s.rotulo);
  return nomes.length ? nomes.join(' + ') : 'Nenhum serviço';
}
