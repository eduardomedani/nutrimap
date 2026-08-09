// ═══════════════════════════════════════════════════════════
// HUB DO PACIENTE — registro central dos módulos
// ═══════════════════════════════════════════════════════════
// FONTE ÚNICA de "o que existe no Hub". A navegação, as ações rápidas e o
// Painel 360° leem daqui — nenhum `if (temConsultas)` espalhado pela UI.
//
// Regra: um módulo só aparece quando está REALMENTE funcional. Nada de aba
// cinza "em breve" dentro do prontuário. Enquanto a fundação não existe, o
// módulo fica com disponivel: false e simplesmente não é renderizado.
//
// Para ligar um módulo novo: implemente a fundação (tabela + serviço + UI),
// vire a flag aqui e ele passa a aparecer no Hub, sem tocar em mais nada.

/**
 * Fundações já construídas. Cada flag corresponde a "existe tabela + serviço
 * + tela de verdade", nunca a "a tela está desenhada".
 */
export const FUNDACOES = {
  pacientes:    true,    // cadastro + anamnese
  avaliacoes:   true,    // avaliações físicas
  alimentacao:  true,    // planos alimentares
  treinos:      true,    // prescrição de treino
  calorias:     true,    // cálculo de gasto energético
  timeline:     true,    // paciente_eventos (publicado)

  evolucao:     true,    // gráficos + comparação de avaliações + metas
  metas:        true,    // paciente_metas
  tarefas:      true,    // paciente_tarefas

  // Fases seguintes — sem tabela/serviço hoje, então não aparecem no Hub.
  consultas:    true,    // módulo-base de consultas (Fase 2A)
  // Schema, RPC de materialização e finalização (db/checkin_schema.sql), mais
  // atribuir, gerar e ler respostas na ficha. A regra do topo foi respeitada:
  // a flag só virou quando a aba passou a fazer alguma coisa. O PWA de
  // resposta é a Etapa 3 e não depende dela — lá quem manda é o RLS.
  checkins:     true,    // acompanhamento entre consultas
  // Storage privado + RLS + RPC de visualização (db/paciente_documentos.sql),
  // serviço e aba de verdade. A regra do topo deste arquivo foi respeitada: a
  // flag só virou depois de a tela existir, na Etapa 2. O PWA do paciente
  // (Etapa 3) não depende dela — lá o que manda é o RLS.
  documentos:   true,    // exames, laudos e receitas do prontuário
  exames:       false,   // Fase 4
  fotos:        false,   // Fase 5
  agendamentos: false,   // Fase 6 (próximo retorno depende disto)
  orientacoes:  false,   // Fase 7
};

export const moduloAtivo = (id) => FUNDACOES[id] === true;

/**
 * Abas do Hub, na ordem de leitura clínica.
 *   id        — chave da aba (entra na URL: #ficha/<paciente>/<id>)
 *   fundacao  — qual fundação precisa estar de pé
 *   render    — quem monta o conteúdo (import dinâmico: só carrega ao abrir)
 */
export const MODULOS_HUB = [
  { id: 'visao',        label: 'Visão geral',  icone: 'layout-dashboard', fundacao: 'pacientes' },
  { id: 'timeline',     label: 'Timeline',     icone: 'history',          fundacao: 'timeline' },
  { id: 'anamnese',     label: 'Anamnese',     icone: 'clipboard-list',   fundacao: 'pacientes' },
  { id: 'avaliacoes',   label: 'Avaliações',   icone: 'ruler',            fundacao: 'avaliacoes' },
  { id: 'evolucao',     label: 'Evolução',     icone: 'trending-up',      fundacao: 'evolucao' },
  { id: 'calorias',     label: 'Calorias',     icone: 'flame',            fundacao: 'calorias' },
  { id: 'planejamento', label: 'Alimentação',  icone: 'salad',            fundacao: 'alimentacao' },
  { id: 'treinos',      label: 'Treinos',      icone: 'dumbbell',         fundacao: 'treinos' },
  { id: 'consultas',    label: 'Consultas',    icone: 'stethoscope',      fundacao: 'consultas' },
  { id: 'checkins',     label: 'Check-ins',    icone: 'clipboard-check',  fundacao: 'checkins' },
  { id: 'exames',       label: 'Exames',       icone: 'flask-conical',    fundacao: 'exames' },
  { id: 'fotos',        label: 'Fotos',        icone: 'image',            fundacao: 'fotos' },
  { id: 'documentos',   label: 'Documentos',   icone: 'paperclip',        fundacao: 'documentos' },
  { id: 'orientacoes',  label: 'Orientações',  icone: 'file-pen',         fundacao: 'orientacoes' },
];

/** Só os módulos com fundação de pé — é isto que a navegação renderiza. */
export function modulosDisponiveis() {
  return MODULOS_HUB.filter(m => moduloAtivo(m.fundacao));
}

export function moduloExiste(id) {
  return modulosDisponiveis().some(m => m.id === id);
}

/** Aba pedida na URL, ou a primeira disponível se ela não existir (mais). */
export function abaValida(id) {
  return moduloExiste(id) ? id : 'visao';
}

// ── Compatibilidade com as URLs antigas da ficha ────────────
// #ficha/<id>/dados continua abrindo o Hub na visão geral.
const APELIDOS = { dados: 'visao', dieta: 'planejamento', historico: 'timeline' };
export const normalizarAba = (id) => abaValida(APELIDOS[id] || id || 'visao');
