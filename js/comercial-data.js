// ═══════════════════════════════════════════════════════════
// COMERCIAL — camada de dados
// ═══════════════════════════════════════════════════════════
// Tudo com a anon-key + RLS. As regras não moram aqui: este arquivo busca e
// grava, js/comercial.js decide.
//
// O DONO É A ORGANIZAÇÃO, NÃO A PESSOA — Etapa 4B, Fase 1. Todas as funções
// resolvem o tenant por `organizacaoAtual()`. Antes disto era `auth.uid()`, e
// era essa suposição que deixava a tela do Comercial VAZIA para quem não fosse
// o proprietário: a consulta pedia `nutri_id = <uuid da pessoa>` e nenhuma
// linha tinha esse uuid.
//
// A FASE 1 VEM ANTES DA RLS, e a ordem não é preferência. Com a policy nova e o
// frontend antigo, a tela abriria vazia sem erro — e o proprietário não
// perceberia, porque para ele os dois uuid coincidem. Na ordem certa não há
// janela de quebra: o frontend pede a organização, que para o proprietário é o
// mesmo uuid de sempre, e a policy antiga (`nutri_id = auth.uid()`) aceita.
//
// FILTRO EXPLÍCITO, sempre. A conta do proprietário é nutri E paciente ao mesmo
// tempo, e as policies do projeto são OR'd — uma consulta que dependesse só do
// RLS para isolar devolveria dado de mais. O RLS é a segunda camada, não a
// primeira. Por isso o `.eq('nutri_id', ...)` continua em todas as leituras: o
// que mudou foi o VALOR filtrado, não o desenho.

import { sb } from './supabase.js';
import { organizacaoAtual } from './organizacao.js';
// `renovar` e `PLANO_PADRAO` SAÍRAM daqui na Migration B. A regra do período
// passou a viver dentro de `comercial_registrar_pagamento` no banco, e manter
// o import vivo aqui deixaria à mão a segunda lógica capaz de avançar o
// período — que é exatamente o que "um pagamento = uma renovação" proíbe.
// Elas seguem em js/comercial.js, usadas pela prévia da tela.
import { competenciaDaCobranca } from './comercial.js';

// ── PLANOS ────────────────────────────────────────────────────
// MIGRADO NA ETAPA 4A. As policies de `comercial_planos` já exigem
// `organizacao_do_auth()` + `tem_permissao()`; ver
// db/multiusuario_comercial_planos_rls.sql.

export async function listarPlanos({ incluirInativos = false } = {}) {
  const org = await organizacaoAtual();
  let q = sb.from('comercial_planos').select('*').eq('nutri_id', org);
  if (!incluirInativos) q = q.eq('ativo', true);
  const { data, error } = await q.order('ordem').order('nome');
  if (error) throw error;
  return data || [];
}

/**
 * O INSERT NÃO MANDA `nutri_id`, e isso é a decisão, não um esquecimento.
 *
 * Quem determina o tenant é o banco, pelo `default organizacao_do_auth()` da
 * coluna. O frontend manda dado de negócio e mais nada — assim não existe
 * caminho em que uma tela escolha o dono de um registro, nem por engano nem
 * por request adulterado.
 *
 * O `nutri_id` sai do payload mesmo se vier em `dados`: quem chama não tem o
 * que dizer sobre isso, e deixar passar em silêncio devolveria ao frontend
 * justamente a autoridade que esta mudança tira dele. O `with check` da policy
 * recusaria de qualquer forma — isto é a primeira porta, não a única.
 */
export async function criarPlano(dados) {
  const { nutri_id: _naoUsado, ...negocio } = dados || {};
  const { data, error } = await sb
    .from('comercial_planos')
    .insert(negocio)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function salvarPlano(planoId, dados) {
  const org = await organizacaoAtual();
  // `nutri_id` fora do update de propósito: mudar o dono de um plano não é uma
  // edição, é um erro.
  const { nutri_id, id: _ignorado, ...limpo } = dados;
  const { data, error } = await sb
    .from('comercial_planos')
    .update(limpo)
    .eq('id', planoId)
    .eq('nutri_id', org)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── ASSINATURAS ───────────────────────────────────────────────

/** As assinaturas com o nome do cliente e o plano juntos — uma consulta só.
 *  Uma por linha da tela; buscar o paciente separado seria N+1.
 *
 *  `!plano_id` NÃO É ENFEITE. Desde a Migration A, `comercial_assinaturas` tem
 *  DUAS chaves estrangeiras para `comercial_planos` — `plano_id`, o plano
 *  vigente, e `proximo_plano_id`, o programado. Com duas, o PostgREST não sabe
 *  qual seguir e recusa a consulta inteira (PGRST201), o que derrubava a tela
 *  do Comercial no carregamento. A dica diz qual chave usar.
 *
 *  Vale para os cinco embeds de `comercial_planos` deste arquivo, e vai valer
 *  para qualquer um novo. Há teste que falha se um deles vier sem a dica. */
export async function listarAssinaturas({ incluirCanceladas = true } = {}) {
  const id = await organizacaoAtual();
  let q = sb
    .from('comercial_assinaturas')
    .select('*, paciente:pacientes(id, nome, telefone, status), plano:comercial_planos!plano_id(*)')
    .eq('nutri_id', id);
  if (!incluirCanceladas) q = q.neq('status', 'cancelada');
  const { data, error } = await q.order('fim_periodo');
  if (error) throw error;
  return data || [];
}

export async function assinaturaDoPaciente(pacienteId) {
  const id = await organizacaoAtual();
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos!plano_id(*)')
    .eq('nutri_id', id)
    .eq('paciente_id', pacienteId)
    .in('status', ['ativa', 'aguardando_inicio', 'pausada'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** O INSERT NÃO MANDA `nutri_id` — quem determina o tenant é o banco, pelo
 *  default da coluna. Mesma decisão de `criarPlano` na Etapa 4A: o frontend
 *  manda dado de negócio e mais nada, então não existe caminho em que uma tela
 *  escolha o dono de um registro, nem por engano nem por request adulterado. */
export async function criarAssinatura(dados) {
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .insert({ ...dados })
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos!plano_id(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function salvarAssinatura(assinaturaId, dados) {
  const id = await organizacaoAtual();
  const { nutri_id, id: _i, paciente, plano, ...limpo } = dados;
  const { data, error } = await sb
    .from('comercial_assinaturas')
    .update(limpo)
    .eq('id', assinaturaId)
    .eq('nutri_id', id)
    .select('*, paciente:pacientes(id, nome, telefone), plano:comercial_planos!plano_id(*)')
    .single();
  if (error) throw error;
  return data;
}

// ── COBRANÇAS (que são lançamentos) ───────────────────────────

/** O histórico de uma assinatura: toda cobrança, paga ou não, mais nova
 *  primeiro. É daqui que saem recorrência, inadimplência e ticket médio. */
export async function cobrancasDaAssinatura(assinaturaId) {
  const id = await organizacaoAtual();
  const { data, error } = await sb
    .from('financeiro_lancamentos')
    .select('*')
    .eq('nutri_id', id)
    .eq('assinatura_id', assinaturaId)
    .order('vencimento', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** As receitas de clientes do período — alimenta os indicadores da visão geral. */
export async function receitasDeClientes({ de, ate } = {}) {
  const id = await organizacaoAtual();
  let q = sb
    .from('financeiro_lancamentos')
    .select('id, tipo, valor, valor_pago, status, vencimento, pago_em, competencia, paciente_id, assinatura_id')
    .eq('nutri_id', id)
    .eq('tipo', 'receita')
    .not('assinatura_id', 'is', null);
  if (de) q = q.gte('vencimento', de);
  if (ate) q = q.lte('vencimento', ate);
  const { data, error } = await q.order('vencimento', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Cria a cobrança de um período — um lançamento de receita PENDENTE.
 *
 * Não existe "criar cobrança" separado de "criar lançamento": é a mesma coisa.
 *
 * O QUE IDENTIFICA A COBRANÇA é `(assinatura_id, periodo_fim)`, e não o
 * vencimento. O índice se chamava `uq_comercial_cobranca_periodo` porque
 * vencimento ERA o fim do período; quando a cobrança manual passou a vencer em
 * `criação + 30 dias`, ele começou a errar dos dois lados — deixava passar
 * duas cobranças do mesmo período e rejeitava duas de períodos diferentes
 * criadas no mesmo dia. Hoje é `uq_comercial_cobranca_do_periodo`, e chamar
 * isto duas vezes para o mesmo período falha no banco em vez de dobrar o que o
 * cliente deve.
 *
 * O período vem da assinatura, nunca de parâmetro: quem cria a cobrança não
 * escolhe o que ela cobre.
 */
export async function criarCobranca({ assinatura, vencimento, valor, descricao, categoriaId = null }) {
  const periodoInicio = assinatura?.inicio_periodo || null;
  const periodoFim = assinatura?.fim_periodo || null;

  // A CATEGORIA SAI DO PLANO, e quem resolve é o banco — a mesma
  // `comercial_categoria_do_plano` que as duas RPCs usam. Repetir a busca aqui
  // em JS criaria uma segunda regra para o mesmo assunto, e bastaria uma
  // divergência de maiúscula para nascer uma "Mensal - 5x" paralela, rachando
  // o total do relatório em duas.
  //
  // Falhar aqui NÃO derruba a cobrança: categoria é classificação, não
  // dinheiro. Uma receita sem categoria se conserta na tela; uma cobrança que
  // não nasceu deixa o cliente sem o que pagar.
  let categoria = categoriaId;
  if (!categoria && assinatura?.plano_id) {
    const { data: cat } = await sb.rpc('comercial_categoria_do_plano', {
      p_nutri: assinatura.nutri_id ?? null,
      p_plano: assinatura.plano_id,
    });
    categoria = cat || null;
  }

  const { data, error } = await sb
    .from('financeiro_lancamentos')
    .insert({
      // Sem `nutri_id`: o dono sai do default da coluna, como em criarAssinatura.
      tipo: 'receita',
      status: 'pendente',
      data: vencimento,
      vencimento,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      // Do INÍCIO do período, não do vencimento nem do fim. Ver
      // competenciaDaCobranca() — a escolha saiu da conferência 103.
      competencia: competenciaDaCobranca(periodoInicio),
      // O NOME DO CLIENTE, SEM O PLANO NA FRENTE. O plano agora mora na
      // categoria; repeti-lo aqui empurrava o nome — que é o que se procura na
      // lista — para depois de um prefixo de tamanho variável. E era esse
      // prefixo que fazia a guarda anti-duplicata da importação errar, porque
      // ela compara `descricao = nome`.
      descricao: descricao || (assinatura?.paciente?.nome || '').trim() || 'Cobrança de assinatura',
      valor,
      categoria_id: categoria,
      paciente_id: assinatura.paciente_id,
      assinatura_id: assinatura.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * A cobrança do período E a renovação programada, numa transação só.
 *
 * MIGRATION A. Esta é a porta nova de "Criar cobrança do período" — a de cima
 * (`criarCobranca`) continua servindo o fluxo de "Nova assinatura", que cria a
 * primeira cobrança de um contrato que acabou de nascer e não tem futuro a
 * programar.
 *
 * POR QUE RPC E NÃO TRÊS CHAMADAS. São três tabelas: o lançamento, a intenção
 * na assinatura e a trilha de auditoria. Sequenciais pelo PostgREST, uma falha
 * no meio deixaria a assinatura com um plano futuro que nenhuma cobrança
 * programou, ou uma cobrança sem a troca que a justificou. Aqui as três caem
 * juntas ou nenhuma cai.
 *
 * NÃO MANDA `nutri_id` NEM `assinatura` INTEIRA. O dono sai de
 * `organizacao_do_auth()` dentro da função, e o resto o banco busca pelo id.
 * O frontend manda decisão de negócio e mais nada.
 *
 * `proximoPlanoId` e `proximoValor` são a INTENÇÃO, não o contrato de hoje: o
 * banco só os grava se diferirem do que está vigente.
 *
 * @returns {{cobranca, assinatura, programou: boolean}}
 */
export async function criarCobrancaDoPeriodo({
  assinaturaId, vencimento, valor,
  categoriaId = null, observacoes = null,
  proximoPlanoId = null, proximoValor = null,
}) {
  const { data, error } = await sb.rpc('comercial_criar_cobranca_do_periodo', {
    p_assinatura_id: assinaturaId,
    p_vencimento: vencimento,
    p_valor: valor,
    p_categoria_id: categoriaId,
    p_observacoes: observacoes,
    p_proximo_plano_id: proximoPlanoId,
    p_proximo_valor: proximoValor,
  });
  if (error) throw error;
  return data;
}

/**
 * Tira a cobrança de cena — CANCELANDO, não apagando.
 *
 * Por que não `delete`: a cobrança É um lançamento de receita. Apagar a linha
 * sumiria com o registro de que ela existiu, e um contas-a-receber que some
 * sem rastro é o tipo de buraco que só aparece no fechamento do mês.
 *
 * Cancelar já era o desenho do módulo, não uma escolha nova: o índice
 * `uq_comercial_cobranca_periodo` é PARCIAL (`status <> 'cancelado'`), e o
 * comentário dele diz o motivo — "um lançamento cancelado é justamente o que
 * se refaz". Ou seja, cancelar libera o período para a cobrança certa entrar
 * no lugar, com o valor ou o vencimento corrigidos.
 *
 * `eq('status', 'pendente')` é a trava, e ela é do BANCO: cobrança paga não
 * casa com nenhuma linha e a função devolve null. Não dá para cancelar um
 * período já recebido por dois cliques rápidos ou por duas abas — o mesmo
 * motivo pelo qual o botão some da tela quando ela está paga.
 *
 * @returns {object|null} a cobrança cancelada, ou null se ela não estava
 *                        pendente (já paga, já cancelada, ou não é sua).
 */
export async function cancelarCobranca(cobrancaId) {
  // MIGRATION A: virou RPC porque cancelar a cobrança que PROGRAMOU uma troca
  // de plano tem que limpar a troca na MESMA transação. Deixar a intenção viva
  // faria a próxima cobrança — criada por outro caminho — mudar o plano do
  // cliente sem ninguém ter pedido.
  //
  // A trava de "só pendente" continua sendo do BANCO, agora dentro da função:
  // cobrança paga devolve `cancelou: false` e a tela avisa. Não dá para
  // cancelar um período já recebido por dois cliques rápidos ou por duas abas.
  const { data, error } = await sb.rpc('comercial_cancelar_cobranca', {
    p_lancamento_id: cobrancaId,
  });
  if (error) throw error;
  // A forma de retorno de antes era `null` quando não dava para cancelar, e
  // quem chama depende disso para mostrar MSG.naoPendente.
  if (!data?.cancelou) return null;
  return data.cobranca || null;
}

/**
 * O mesmo cancelamento, mas contando o que aconteceu com a renovação.
 *
 * `cancelarCobranca` devolve só a cobrança para não quebrar quem já a usava.
 * Esta devolve o envelope inteiro — é o que a tela precisa para dizer "a troca
 * de plano programada também foi cancelada".
 */
export async function cancelarCobrancaDetalhado(cobrancaId) {
  const { data, error } = await sb.rpc('comercial_cancelar_cobranca', {
    p_lancamento_id: cobrancaId,
  });
  if (error) throw error;
  return data || { cancelou: false };
}

/**
 * Corrige valor, vencimento ou observação de uma cobrança em aberto.
 *
 * ATUALIZA O MESMO LANÇAMENTO. Cancelar-e-recriar para trocar um vencimento
 * deixaria duas linhas onde há uma cobrança só, e a auditoria contaria uma
 * história que não aconteceu ("cancelada" + "criada" no lugar de "editada").
 *
 * O que NÃO se edita por aqui, e por quê:
 *   . cliente e assinatura — mudar o dono de uma cobrança não é correção, é
 *     outra cobrança;
 *   . competência e período — é o mesmo motivo. A competência sai do
 *     `periodo_fim`, e o período é o que a cobrança cobre: corrigir a data em
 *     que o cliente paga não muda o mês que ele está pagando. Antes ela era
 *     recalculada junto com o vencimento, e isso estava certo enquanto as duas
 *     datas eram a mesma coisa — hoje faria a receita mudar de mês a cada
 *     prorrogação;
 *   . qualquer coisa numa cobrança paga — `eq('status','pendente')` barra.
 *
 * O índice `uq_comercial_cobranca_do_periodo` é por período, então prorrogar
 * um vencimento não esbarra mais nele — e não deve mesmo: continua sendo uma
 * cobrança só, do mesmo período.
 *
 * @returns {object|null} a cobrança atualizada, ou null se não estava pendente.
 */
export async function editarCobranca(cobrancaId, { valor, vencimento, observacoes } = {}) {
  const id = await organizacaoAtual();
  const patch = {};
  if (valor !== undefined) patch.valor = valor;
  if (vencimento !== undefined) {
    patch.vencimento = vencimento;
    // `data` acompanha o vencimento: é o dia do movimento previsto.
    //
    // `competencia` NÃO acompanha mais. Ela é o mês do período cobrado, e o
    // período não muda porque alguém prorrogou o prazo de pagamento. Recalcular
    // aqui é o que jogava a receita de julho para setembro.
    patch.data = vencimento;
  }
  if (observacoes !== undefined) patch.observacoes = observacoes;
  if (!Object.keys(patch).length) return null;

  const { data, error } = await sb
    .from('financeiro_lancamentos')
    .update(patch)
    .eq('id', cobrancaId)
    .eq('nutri_id', id)
    .eq('status', 'pendente')
    .not('assinatura_id', 'is', null)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * O CORAÇÃO DO MÓDULO: registra o pagamento e renova o período.
 *
 * UMA CHAMADA, UMA TRANSAÇÃO — desde a Migration B (13/08/2026,
 * db/comercial_pagamento_transacional.sql). O lançamento vira `pago`, a
 * assinatura anda para o próximo período, a renovação programada é consumida
 * e a cobrança seguinte nasce pendente: as quatro escritas caem juntas ou
 * nenhuma cai.
 *
 * O QUE ISTO SUBSTITUIU. Até aqui eram três chamadas sequenciais pelo
 * PostgREST, com a ordem escolhida para falhar de forma conservadora. Mas
 * conservador não é íntegro: uma falha entre a 1ª e a 2ª deixava o dinheiro
 * registrado com o período velho, e o cliente aparecia vencido tendo pago.
 * Com a renovação programada seriam quatro escritas, e uma falha no meio
 * podia deixar uma troca de plano pendurada depois de o pagamento dela ter
 * entrado.
 *
 * O PERÍODO SÓ AVANÇA LÁ DENTRO. Não existe segundo lugar no sistema que
 * chame a regra de renovação — e é isso que garante UM PAGAMENTO = UMA
 * RENOVAÇÃO. A trava é do banco (`status = 'pendente'` no update), então dois
 * cliques, duas abas ou um retry de rede não renovam duas vezes.
 *
 * `assinatura` CONTINUA NA ASSINATURA DA FUNÇÃO e não é usada. Quem resolve a
 * assinatura agora é o banco, pelo `assinatura_id` do próprio lançamento —
 * confiar na cópia que a tela carregou seria confiar num `fim_periodo` velho,
 * que é justamente o que decide o período novo. O parâmetro fica para não
 * quebrar os dois chamadores; ignorá-lo é a correção, não um esquecimento.
 *
 * `pagou: false` é a cobrança que já não estava pendente. Vira exceção para
 * quem chama continuar tratando erro num lugar só — `traduzirErroCobranca`
 * mapeia para a mesma frase de sempre.
 */
export async function registrarPagamento({
  lancamentoId, assinatura: _resolvidaNoBanco, pagoEm, valorPago, formaPagamento, criarProxima = true,
}) {
  const { data, error } = await sb.rpc('comercial_registrar_pagamento', {
    p_lancamento_id: lancamentoId,
    p_pago_em: pagoEm,
    p_valor_pago: valorPago,
    p_forma_pagamento: formaPagamento || null,
    p_criar_proxima: criarProxima,
  });
  if (error) throw error;
  if (!data?.pagou) throw new Error('cobranca nao_pendente');
  return { lancamento: data.lancamento, assinatura: data.assinatura, proxima: data.proxima };
}

// ── CLIENTES SEM ASSINATURA ───────────────────────────────────

/** Pacientes que ainda não têm vínculo comercial — os candidatos a virar
 *  cliente. Sem isto, cadastrar uma assinatura exigiria decorar quem falta. */
export async function pacientesSemAssinatura() {
  const id = await organizacaoAtual();
  const [{ data: pacientes, error: e1 }, { data: assinaturas, error: e2 }] = await Promise.all([
    sb.from('pacientes').select('id, nome, telefone').eq('nutri_id', id).order('nome'),
    sb.from('comercial_assinaturas').select('paciente_id').eq('nutri_id', id)
      .in('status', ['ativa', 'aguardando_inicio', 'pausada']),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const comContrato = new Set((assinaturas || []).map(a => a.paciente_id));
  return (pacientes || []).filter(p => !comContrato.has(p.id));
}

/**
 * Assinaturas que têm ao menos uma cobrança em aberto, com as cobranças junto.
 *
 * É o que o formulário de receita do Financeiro precisa para oferecer "este
 * pagamento quita qual cobrança". Duas consultas, não uma por cliente.
 */
export async function assinaturasComCobrancaAberta() {
  const id = await organizacaoAtual();
  const [{ data: assinaturas, error: e1 }, { data: abertas, error: e2 }] = await Promise.all([
    sb.from('comercial_assinaturas')
      .select('*, paciente:pacientes(id, nome), plano:comercial_planos!plano_id(*)')
      .eq('nutri_id', id)
      .in('status', ['ativa', 'aguardando_inicio', 'pausada']),
    sb.from('financeiro_lancamentos')
      .select('id, descricao, valor, vencimento, competencia, categoria_id, assinatura_id, status')
      .eq('nutri_id', id)
      .eq('tipo', 'receita')
      .eq('status', 'pendente')
      .not('assinatura_id', 'is', null)
      .order('vencimento'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const porAssinatura = new Map();
  for (const c of abertas || []) {
    const lista = porAssinatura.get(c.assinatura_id) || [];
    lista.push(c);
    porAssinatura.set(c.assinatura_id, lista);
  }

  return (assinaturas || [])
    .map(a => ({ ...a, cobrancas: porAssinatura.get(a.id) || [] }))
    .filter(a => a.cobrancas.length)
    .sort((x, y) => String(x.paciente?.nome || '').localeCompare(String(y.paciente?.nome || ''), 'pt-BR'));
}

/** Categorias de receita — o "Pacote" da planilha já virou categoria no
 *  import de vendas, então elas provavelmente já existem. */
export async function categoriasDeReceita() {
  const id = await organizacaoAtual();
  const { data, error } = await sb
    .from('financeiro_categorias')
    .select('id, nome, ativo')
    .eq('nutri_id', id)
    .eq('tipo', 'receita')
    .eq('ativo', true)
    .order('ordem').order('nome');
  if (error) throw error;
  return data || [];
}
