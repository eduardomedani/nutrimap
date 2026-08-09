// ═══════════════════════════════════════════════════════════
// TIMELINE — catálogo dos tipos de evento
// ═══════════════════════════════════════════════════════════
// Fonte única de verdade sobre COMO cada evento aparece: rótulo, ícone, tom,
// módulo, importância padrão e qual ação contextual ele abre.
//
// A timeline não tem `if` por tipo em lugar nenhum: o componente lê daqui.
// Adicionar um tipo novo = acrescentar uma entrada neste objeto — nada no
// banco (o `tipo` é texto livre) e nada no componente precisa mudar.
//
// Um tipo desconhecido NÃO quebra a tela: cai no fallback de `configDoTipo`.

// Módulos — também são os grupos de filtro da timeline.
export const MODULOS = {
  paciente:    'Paciente',
  consultas:   'Consultas',
  alimentacao: 'Alimentação',
  treinos:     'Treinos',
  avaliacoes:  'Avaliações',
  documentos:  'Exames e documentos',
  financeiro:  'Financeiro',
  checkins:    'Check-ins',
  manual:      'Registros manuais',
};

// Filtros da barra (ordem de exibição). "todos" é o padrão.
export const FILTROS = [
  { id: 'todos',       label: 'Todos',               modulos: null },
  { id: 'consultas',   label: 'Consultas',           modulos: ['consultas'] },
  { id: 'alimentacao', label: 'Alimentação',         modulos: ['alimentacao'] },
  { id: 'treinos',     label: 'Treinos',             modulos: ['treinos'] },
  { id: 'avaliacoes',  label: 'Avaliações',          modulos: ['avaliacoes'] },
  { id: 'documentos',  label: 'Exames e documentos', modulos: ['documentos'] },
  { id: 'financeiro',  label: 'Financeiro',          modulos: ['financeiro'] },
  { id: 'manual',      label: 'Registros manuais',   modulos: ['manual'] },
];

// Ações contextuais: cada uma abre a aba correspondente da ficha do paciente.
// (A navegação do painel é por abas, não por rota própria de cada registro.)
const ACAO = {
  plano:     { label: 'Abrir plano',    aba: 'planejamento', entidade: 'plano' },
  treino:    { label: 'Abrir treino',   aba: 'treinos',      entidade: 'treino' },
  avaliacao: { label: 'Ver avaliação',  aba: 'avaliacoes',   entidade: 'avaliacao' },
  anamnese:  { label: 'Ver anamnese',   aba: 'anamnese',     entidade: null },
  documento: { label: 'Ver documento',  aba: 'documentos',   entidade: 'documento' },
};

// tom: neutro | sucesso | info | alerta | perigo  (só muda cor do ícone/realce)
// importancia: 'alta' ganha fundo sutil; 'normal'/'baixa' ficam leves.
export const TIPOS = {
  // ── Paciente ──────────────────────────────────────────────
  PATIENT_CREATED:  { label: 'Paciente cadastrado', icone: 'user-plus', tom: 'sucesso', modulo: 'paciente', importancia: 'normal' },
  PATIENT_UPDATED:  { label: 'Dados do paciente atualizados', icone: 'user-pen', tom: 'neutro', modulo: 'paciente', importancia: 'baixa' },
  PATIENT_ACCESS_LINK_CREATED: { label: 'Link de acesso gerado', icone: 'link', tom: 'info', modulo: 'paciente', importancia: 'baixa' },

  // ── Consultas (módulo ainda não existe no sistema) ────────
  CONSULTATION_STARTED:   { label: 'Consulta iniciada',   icone: 'play',   tom: 'info',    modulo: 'consultas', importancia: 'normal' },
  CONSULTATION_COMPLETED: { label: 'Consulta finalizada', icone: 'check',  tom: 'sucesso', modulo: 'consultas', importancia: 'alta' },
  CONSULTATION_CANCELLED: { label: 'Consulta cancelada',  icone: 'x',      tom: 'perigo',  modulo: 'consultas', importancia: 'alta' },

  // ── Anamnese ──────────────────────────────────────────────
  ANAMNESIS_CREATED: { label: 'Anamnese respondida', icone: 'clipboard-list', tom: 'sucesso', modulo: 'paciente', importancia: 'alta',   acao: ACAO.anamnese },
  ANAMNESIS_UPDATED: { label: 'Anamnese atualizada', icone: 'clipboard-pen',  tom: 'neutro',  modulo: 'paciente', importancia: 'normal', acao: ACAO.anamnese },

  // ── Plano alimentar ───────────────────────────────────────
  MEAL_PLAN_CREATED:    { label: 'Plano alimentar criado',      icone: 'file-plus',    tom: 'neutro',  modulo: 'alimentacao', importancia: 'normal', acao: ACAO.plano },
  MEAL_PLAN_PUBLISHED:  { label: 'Plano alimentar publicado',   icone: 'utensils',     tom: 'sucesso', modulo: 'alimentacao', importancia: 'alta',   acao: ACAO.plano },
  MEAL_PLAN_UPDATED:    { label: 'Plano alimentar atualizado',  icone: 'file-pen',     tom: 'neutro',  modulo: 'alimentacao', importancia: 'normal', acao: ACAO.plano },
  MEAL_PLAN_ARCHIVED:   { label: 'Plano alimentar desativado',  icone: 'archive',      tom: 'alerta',  modulo: 'alimentacao', importancia: 'normal', acao: ACAO.plano },
  MEAL_PLAN_DUPLICATED: { label: 'Plano alimentar duplicado',   icone: 'copy-plus',    tom: 'neutro',  modulo: 'alimentacao', importancia: 'baixa',  acao: ACAO.plano },

  // ── Treino ────────────────────────────────────────────────
  WORKOUT_CREATED:   { label: 'Treino criado',      icone: 'file-plus', tom: 'neutro',  modulo: 'treinos', importancia: 'normal', acao: ACAO.treino },
  WORKOUT_PUBLISHED: { label: 'Treino publicado',   icone: 'dumbbell',  tom: 'sucesso', modulo: 'treinos', importancia: 'alta',   acao: ACAO.treino },
  WORKOUT_UPDATED:   { label: 'Treino atualizado',  icone: 'file-pen',  tom: 'neutro',  modulo: 'treinos', importancia: 'normal', acao: ACAO.treino },
  WORKOUT_ARCHIVED:  { label: 'Treino desativado',  icone: 'archive',   tom: 'alerta',  modulo: 'treinos', importancia: 'normal', acao: ACAO.treino },

  // ── Avaliações e medidas ──────────────────────────────────
  PHYSICAL_ASSESSMENT_CREATED: { label: 'Avaliação física realizada', icone: 'ruler',        tom: 'sucesso', modulo: 'avaliacoes', importancia: 'alta',   acao: ACAO.avaliacao },
  BODY_WEIGHT_RECORDED:        { label: 'Peso registrado',           icone: 'scale',        tom: 'info',    modulo: 'avaliacoes', importancia: 'normal', acao: ACAO.avaliacao },
  BODY_MEASUREMENTS_RECORDED:  { label: 'Medidas registradas',       icone: 'ruler',        tom: 'info',    modulo: 'avaliacoes', importancia: 'normal', acao: ACAO.avaliacao },
  // Evolução apresentada ao paciente na consulta (Modo Apresentação).
  EVOLUTION_PRESENTED:         { label: 'Evolução apresentada',      icone: 'presentation', tom: 'sucesso', modulo: 'avaliacoes', importancia: 'alta',   acao: ACAO.avaliacao },
  PROGRESS_PHOTOS_ADDED:       { label: 'Fotos de progresso',        icone: 'image',        tom: 'info',    modulo: 'avaliacoes', importancia: 'normal' },

  // ── Exames e documentos ───────────────────────────────────
  LAB_EXAM_ADDED: { label: 'Exame anexado',     icone: 'flask-conical', tom: 'info',   modulo: 'documentos', importancia: 'alta' },
  DOCUMENT_ADDED: { label: 'Documento anexado', icone: 'paperclip',     tom: 'neutro', modulo: 'documentos', importancia: 'normal', acao: ACAO.documento },

  // O evento é a DISPONIBILIZAÇÃO, não o upload: guardar um exame no
  // prontuário não é acontecimento na história do paciente — compartilhá-lo
  // com ele é. Documento privado não gera evento nenhum.
  //
  // Não existe DOCUMENT_VIEWED como tipo próprio, e é de propósito: dois cards
  // consecutivos ("enviado", "visualizado") por arquivo transformariam a
  // timeline num log de sistema. O "visualizado em" é lido do documento na
  // hora de desenhar — ver estadoParaTimeline() em paciente-documentos-eventos.
  DOCUMENT_SHARED: { label: 'Documento compartilhado', icone: 'share-2', tom: 'sucesso', modulo: 'documentos', importancia: 'alta', acao: ACAO.documento },

  // ── Orientações e materiais ───────────────────────────────
  NUTRITION_GUIDANCE_PUBLISHED: { label: 'Orientação nutricional publicada', icone: 'file-pen', tom: 'sucesso', modulo: 'alimentacao', importancia: 'normal' },
  MATERIAL_SENT:                { label: 'Material enviado',                 icone: 'send',     tom: 'neutro',  modulo: 'paciente',    importancia: 'baixa' },

  // ── Check-ins (módulo ainda não existe) ───────────────────
  CHECKIN_SENT:      { label: 'Check-in enviado',    icone: 'send',        tom: 'neutro',  modulo: 'checkins', importancia: 'baixa' },
  CHECKIN_COMPLETED: { label: 'Check-in respondido', icone: 'clipboard-check', tom: 'info', modulo: 'checkins', importancia: 'normal' },
  CHECKIN_REVIEWED:  { label: 'Check-in analisado',  icone: 'eye',         tom: 'sucesso', modulo: 'checkins', importancia: 'normal' },

  // ── Agendamentos (módulo ainda não existe) ────────────────
  APPOINTMENT_CREATED:     { label: 'Agendamento criado',     icone: 'calendar-plus',  tom: 'info',    modulo: 'consultas', importancia: 'normal' },
  APPOINTMENT_RESCHEDULED: { label: 'Agendamento remarcado',  icone: 'calendar-sync',  tom: 'alerta',  modulo: 'consultas', importancia: 'normal' },
  APPOINTMENT_CANCELLED:   { label: 'Agendamento cancelado',  icone: 'calendar-x',     tom: 'perigo',  modulo: 'consultas', importancia: 'alta' },
  APPOINTMENT_COMPLETED:   { label: 'Atendimento realizado',  icone: 'calendar-check', tom: 'sucesso', modulo: 'consultas', importancia: 'alta' },

  // ── Financeiro (módulo ainda não existe) ──────────────────
  PAYMENT_CREATED:   { label: 'Cobrança criada',     icone: 'receipt',       tom: 'neutro',  modulo: 'financeiro', importancia: 'normal' },
  PAYMENT_CONFIRMED: { label: 'Pagamento confirmado', icone: 'circle-check', tom: 'sucesso', modulo: 'financeiro', importancia: 'normal' },
  PAYMENT_OVERDUE:   { label: 'Pagamento vencido',   icone: 'triangle-alert', tom: 'perigo', modulo: 'financeiro', importancia: 'alta' },

  // ── Registro manual do profissional ───────────────────────
  MANUAL_NOTE: { label: 'Registro manual', icone: 'notebook-pen', tom: 'neutro', modulo: 'manual', importancia: 'normal' },
};

// Categorias do registro manual (modal "Adicionar registro").
export const CATEGORIAS_MANUAIS = [
  'Observação clínica',
  'Contato com o paciente',
  'Orientação',
  'Intercorrência',
  'Decisão profissional',
  'Outro',
];

const PADRAO = { label: 'Evento', icone: 'circle-dot', tom: 'neutro', modulo: 'paciente', importancia: 'normal' };

/** Config de um tipo. Tipo desconhecido devolve o padrão (nunca quebra a tela). */
export function configDoTipo(tipo) {
  return TIPOS[tipo] || PADRAO;
}

/** Módulos que um filtro seleciona (null = todos). */
export function modulosDoFiltro(filtroId) {
  return (FILTROS.find(f => f.id === filtroId) || FILTROS[0]).modulos;
}
