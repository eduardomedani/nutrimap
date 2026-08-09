// ═══════════════════════════════════════════════════════════
// CHECK-INS — as regras do domínio
// ═══════════════════════════════════════════════════════════
// Funções puras: recebem dado, devolvem dado. Nada de rede, nada de DOM — é o
// que deixa o cálculo de frequência testável sem banco e sem navegador.
//
// O QUE NÃO MORA AQUI: a validação que PROTEGE. Esta camada valida para dar
// erro cedo e em português; quem impede de verdade é a RPC `finalizar_checkin`,
// que roda no banco contra o snapshot. Se a única validação fosse esta, bastaria
// um POST direto na API para gravar resposta de qualquer tipo.

const DIA_MS = 86400000;

export const TIPOS = {
  escala:           { rotulo: 'Escala',            valor: 'number' },
  multipla_escolha: { rotulo: 'Múltipla escolha',  valor: 'string' },
  sim_nao:          { rotulo: 'Sim ou não',        valor: 'boolean' },
  numero:           { rotulo: 'Número',            valor: 'number' },
  texto_curto:      { rotulo: 'Texto curto',       valor: 'string' },
  texto_longo:      { rotulo: 'Texto longo',       valor: 'string' },
};

export const FREQUENCIAS = {
  semanal:   { rotulo: 'Semanal',    dias: 7,  exige: 'dia_semana' },
  // 14 DIAS, não "duas vezes por mês". A segunda leitura faria a data pular
  // quando o mês tem cinco semanas, e ninguém saberia dizer por quê.
  quinzenal: { rotulo: 'Quinzenal',  dias: 14, exige: 'dia_semana' },
  mensal:    { rotulo: 'Mensal',     dias: null, exige: 'dia_mes' },
  manual:    { rotulo: 'Manual',     dias: null, exige: null },
};

export const STATUS_OCORRENCIA = {
  agendado:   'Agendado',
  disponivel: 'Disponível',
  respondido: 'Respondido',
  cancelado:  'Cancelado',
};

// ───────────────────────────────────────────────────────────
// DATAS
// ───────────────────────────────────────────────────────────

/** YYYY-MM-DD no fuso LOCAL. `toISOString()` converteria para UTC e, a leste
 *  de Greenwich, a meia-noite local viraria o dia anterior. */
export function iso10(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function comoData(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/** Último dia do mês — 28, 29, 30 ou 31. */
export function ultimoDiaDoMes(ano, mes /* 1..12 */) {
  return new Date(ano, mes, 0).getDate();
}

/**
 * A próxima ocorrência de uma atribuição.
 *
 *   semanal   — o próximo `dia_semana` depois de `a partir de`, +7 se cair nele
 *   quinzenal — o mesmo, mas o passo é 14 dias
 *   mensal    — o `dia_mes` do mês seguinte, com a regra do 29/30/31 abaixo
 *   manual    — null: quem materializa é o profissional, quando decidir
 *
 * REGRA DO 29/30/31: dia maior que o último do mês vira o ÚLTIMO dia daquele
 * mês. Dia 31 em fevereiro é 28 (ou 29), em abril é 30. A alternativa seria
 * pular o mês — e um check-in mensal que some em fevereiro é um check-in que o
 * paciente aprende a não esperar.
 *
 * @returns {string|null} YYYY-MM-DD
 */
export function calcularProximaOcorrencia({ frequencia, dia_semana, dia_mes }, apartirDe) {
  const base = comoData(apartirDe) || new Date();
  const f = FREQUENCIAS[frequencia];
  if (!f || frequencia === 'manual') return null;

  if (frequencia === 'semanal' || frequencia === 'quinzenal') {
    if (dia_semana === null || dia_semana === undefined) return null;
    const alvo = Number(dia_semana);
    if (!(alvo >= 0 && alvo <= 6)) return null;
    // Quantos dias até o próximo `alvo`. Cair hoje significa "o da semana que
    // vem": a ocorrência de hoje é a que está sendo fechada agora.
    let delta = (alvo - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    // Quinzenal: chega no dia da semana certo e anda mais uma semana.
    if (frequencia === 'quinzenal') delta += 7;
    return iso10(new Date(base.getTime() + delta * DIA_MS));
  }

  // mensal
  const dia = Number(dia_mes);
  if (!(dia >= 1 && dia <= 31)) return null;
  let ano = base.getFullYear();
  let mes = base.getMonth() + 1;          // 1..12
  const diaNesteMes = Math.min(dia, ultimoDiaDoMes(ano, mes));
  // Já passou (ou é hoje) neste mês: vai para o mês seguinte.
  if (diaNesteMes <= base.getDate()) {
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  const diaFinal = Math.min(dia, ultimoDiaDoMes(ano, mes));
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

/**
 * O período de referência de uma ocorrência — a chave natural de "já
 * materializei este?". É a própria data prevista; o unique parcial no banco
 * faz o resto.
 */
export const periodoDaOcorrencia = (dataPrevista) => String(dataPrevista || '').slice(0, 10) || null;

// ───────────────────────────────────────────────────────────
// SITUAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * "Atrasado" NÃO é status gravado — é conta de data sobre um `disponivel`.
 *
 * Gravar atraso exigiria alguém passando para virar o estado, e no dia em que
 * esse alguém falhasse a tela diria "no prazo" sobre coisa vencida.
 */
export function situacaoDaOcorrencia(oc, agora = new Date()) {
  if (!oc) return null;
  if (oc.status === 'respondido') return 'respondido';
  if (oc.status === 'cancelado') return 'cancelado';
  if (oc.status === 'agendado') return 'agendado';
  if (oc.prazo_em && new Date(oc.prazo_em) < agora) return 'atrasado';
  return 'disponivel';
}

export const SITUACAO_ROTULO = {
  agendado:   'Agendado',
  disponivel: 'Disponível',
  atrasado:   'Atrasado',
  respondido: 'Respondido',
  cancelado:  'Cancelado',
};

/** Dias de atraso, para a tela poder dizer "há 3 dias". */
export function diasDeAtraso(oc, agora = new Date()) {
  if (situacaoDaOcorrencia(oc, agora) !== 'atrasado') return 0;
  return Math.floor((agora.getTime() - new Date(oc.prazo_em).getTime()) / DIA_MS);
}

// ───────────────────────────────────────────────────────────
// VALIDAÇÃO
// ───────────────────────────────────────────────────────────

/**
 * A configuração de uma pergunta faz sentido para o tipo dela?
 *
 * O banco só garante que é um objeto JSON — um CHECK que cobrisse todas as
 * combinações viraria expressão ilegível que ninguém mais mexe. A coerência
 * mora aqui e na RPC.
 */
export function validarConfiguracao(tipo, configuracao = {}) {
  const c = configuracao || {};
  const erros = [];

  if (!TIPOS[tipo]) return { ok: false, erros: ['Tipo de pergunta desconhecido.'] };

  if (tipo === 'escala') {
    const min = Number(c.min), max = Number(c.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) erros.push('A escala precisa de mínimo e máximo.');
    else if (min >= max) erros.push('O mínimo da escala tem que ser menor que o máximo.');
  }

  if (tipo === 'multipla_escolha') {
    if (!Array.isArray(c.opcoes) || !c.opcoes.length) erros.push('Informe ao menos uma opção.');
    else if (c.opcoes.some(o => typeof o !== 'string' || !o.trim())) erros.push('Toda opção precisa ser um texto.');
    else if (new Set(c.opcoes).size !== c.opcoes.length) erros.push('Há opções repetidas.');
  }

  if (tipo === 'numero') {
    const { min, max } = c;
    if (min !== undefined && !Number.isFinite(Number(min))) erros.push('O mínimo precisa ser um número.');
    if (max !== undefined && !Number.isFinite(Number(max))) erros.push('O máximo precisa ser um número.');
    if (min !== undefined && max !== undefined && Number(min) >= Number(max)) {
      erros.push('O mínimo tem que ser menor que o máximo.');
    }
  }

  return { ok: !erros.length, erros };
}

/** A atribuição tem os campos que a frequência exige? Espelha o CHECK do banco. */
export function validarAtribuicao({ frequencia, dia_semana, dia_mes } = {}) {
  const f = FREQUENCIAS[frequencia];
  if (!f) return { ok: false, erros: ['Frequência desconhecida.'] };
  const erros = [];
  const temSemana = dia_semana !== null && dia_semana !== undefined;
  const temMes = dia_mes !== null && dia_mes !== undefined;

  if (f.exige === 'dia_semana') {
    if (!temSemana) erros.push('Escolha o dia da semana.');
    if (temMes) erros.push('Frequência por semana não usa dia do mês.');
  }
  if (f.exige === 'dia_mes') {
    if (!temMes) erros.push('Escolha o dia do mês.');
    if (temSemana) erros.push('Frequência mensal não usa dia da semana.');
  }
  if (f.exige === null && (temSemana || temMes)) {
    erros.push('Frequência manual não tem dia fixo.');
  }
  return { ok: !erros.length, erros };
}

/**
 * A resposta serve para a pergunta do SNAPSHOT?
 *
 * Espelha a validação da RPC, para a tela avisar antes de ir à rede. Quem
 * decide de verdade continua sendo o banco.
 */
export function validarResposta(pergunta, valor) {
  const { tipo, configuracao = {}, obrigatoria } = pergunta || {};
  const vazio = valor === null || valor === undefined || valor === '';

  if (vazio) return obrigatoria ? { ok: false, erro: 'Esta pergunta é obrigatória.' } : { ok: true };
  if (!TIPOS[tipo]) return { ok: false, erro: 'Tipo de pergunta desconhecido.' };

  const esperado = TIPOS[tipo].valor;
  if (esperado === 'number' && typeof valor !== 'number') return { ok: false, erro: 'Informe um número.' };
  if (esperado === 'boolean' && typeof valor !== 'boolean') return { ok: false, erro: 'Responda sim ou não.' };
  if (esperado === 'string' && typeof valor !== 'string') return { ok: false, erro: 'Informe um texto.' };

  if (tipo === 'escala' || tipo === 'numero') {
    const { min, max } = configuracao || {};
    if (min !== undefined && valor < Number(min)) return { ok: false, erro: `O mínimo é ${min}.` };
    if (max !== undefined && valor > Number(max)) return { ok: false, erro: `O máximo é ${max}.` };
  }
  if (tipo === 'multipla_escolha') {
    const opcoes = configuracao?.opcoes || [];
    if (!opcoes.includes(valor)) return { ok: false, erro: 'Escolha uma das opções.' };
  }
  return { ok: true };
}

/** Valida o conjunto contra o snapshot inteiro. Devolve `{ ok, erros: {id: msg} }`. */
export function validarRespostas(snapshot, respostas = {}) {
  const erros = {};
  for (const p of snapshot?.perguntas || []) {
    const r = validarResposta(p, respostas[p.id]);
    if (!r.ok) erros[p.id] = r.erro;
  }
  return { ok: !Object.keys(erros).length, erros };
}

// ───────────────────────────────────────────────────────────
// SNAPSHOT
// ───────────────────────────────────────────────────────────

/**
 * O snapshot que a materialização grava. Existe aqui para o teste poder
 * conferir o formato sem banco — quem monta em produção é a função SQL, que é
 * quem tem a transação.
 *
 * SÓ PERGUNTAS ATIVAS. Desativar uma pergunta tira ela dos check-ins novos sem
 * tocar nos antigos, que carregam o próprio snapshot.
 */
export function montarSnapshot(modelo, perguntas = []) {
  return {
    modelo: { id: modelo?.id, nome: modelo?.nome, descricao: modelo?.descricao ?? null },
    perguntas: (perguntas || [])
      .filter(p => p.ativo !== false)
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map(p => ({
        id: p.id,
        texto: p.texto,
        tipo: p.tipo,
        obrigatoria: !!p.obrigatoria,
        ordem: p.ordem ?? 0,
        unidade: p.unidade ?? null,
        configuracao: p.configuracao || {},
      })),
  };
}

/** Erro do banco não é frase de gente. */
export function traduzirErroCheckin(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('checkin_ja_finalizado'))       return 'Este check-in já foi respondido.';
  if (m.includes('checkin_indisponivel'))        return 'Este check-in não está disponível.';
  if (m.includes('checkin_nao_encontrado'))      return 'Check-in não encontrado.';
  if (m.includes('checkin_sem_paciente'))        return 'Sua conta não está vinculada a um paciente.';
  if (m.includes('checkin_obrigatoria_faltando'))return 'Responda todas as perguntas obrigatórias.';
  if (m.includes('checkin_fora_do_intervalo'))   return 'Há uma resposta fora do intervalo permitido.';
  if (m.includes('checkin_opcao_invalida'))      return 'Há uma opção que não existe mais.';
  if (m.includes('checkin_tipo_invalido') ||
      m.includes('checkin_payload_invalido'))    return 'Há uma resposta em formato inesperado.';
  if (m.includes('checkin_modelo_arquivado'))    return 'Este modelo está arquivado.';
  if (m.includes('checkin_modelo_sem_perguntas'))return 'O modelo não tem perguntas ativas.';
  if (m.includes('checkin_atribuicao_inativa'))  return 'Esta atribuição está desativada.';
  if (m.includes('row-level security'))          return 'Sem permissão para este check-in.';
  if (m.includes('failed to fetch') ||
      m.includes('networkerror'))                return 'Sem conexão. Tente novamente.';
  return 'Não foi possível concluir. Tente novamente.';
}
