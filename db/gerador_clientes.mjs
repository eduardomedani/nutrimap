// ═══════════════════════════════════════════════════════════
// GERADOR — "Controle de Pacientes" (CSV)  ->  assinaturas comerciais
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerador_clientes.mjs caminho/Controle.csv
//
// Exporte a aba "Controle de Pacientes" da planilha da GoUp como CSV
// (Arquivo > Fazer download > CSV) e aponte para ele.
//
// O QUE VIRA O QUÊ:
//   Paciente        -> pacientes.nome        (cria se não existir)
//   Contato         -> pacientes.telefone    (só dígitos, com 55 na frente)
//   Pacote          -> comercial_planos      (por nome)
//   Preço           -> assinatura.valor_contratado
//   Data de início  -> assinatura.inicio_periodo
//   Data de término -> CONFERIDO contra a duração do plano, não copiado
//   Horário         -> assinatura.horario
//   Status          -> assinatura.status
//   Observações     -> assinatura.observacoes
//
// O QUE NÃO É IMPORTADO, E POR QUÊ:
//
//   Dias Vencidos    é conta (hoje − término), não dado. Guardar seria criar
//                    um número que já nasce velho.
//   Mês / Ano        derivam da data de término.
//   Status Pagamento 141 das 144 linhas dizem "Concluído". Uma coluna que diz
//                    a mesma coisa para todo mundo não informa nada, e quem
//                    carrega a informação de verdade é o Status + o término.
//   CONTATO Z-API    é o mesmo telefone noutro formato.
//   MENSAGEM/DISPARO são a automação antiga (término − 3 dias). A Etapa 3 do
//                    módulo vai gerar isso a partir de regras, não copiar.
//
// A PERDA QUE NÃO DÁ PARA EVITAR: a planilha guarda UMA linha por cliente e a
// SOBRESCREVE a cada renovação. Não há histórico de pagamentos por cliente
// nessa aba — então `data_inicio_original` recebe a mesma data do período
// vigente. "Cliente desde" vai estar errado para quem já renovou, e só o
// tempo de uso do Evollo vai corrigir isso. Está dito no SQL gerado.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ── Duração de cada pacote, conferida contra a planilha (137/137) ──────────
export const PLANOS = {
  'Mensal - 3x':     { duracao_valor: 30, duracao_unidade: 'dia', frequencia_semanal: 3 },
  'Mensal - 5x':     { duracao_valor: 30, duracao_unidade: 'dia', frequencia_semanal: 5 },
  'Trimestral - 3x': { duracao_valor: 90, duracao_unidade: 'dia', frequencia_semanal: 3 },
  'Trimestral - 5x': { duracao_valor: 90, duracao_unidade: 'dia', frequencia_semanal: 5 },
  'Diária':          { duracao_valor: 1,  duracao_unidade: 'dia', frequencia_semanal: null },
};

/**
 * O status da planilha vira o status da assinatura.
 *
 * "Vencida" NÃO vira um status: no modelo novo, vencido é a conta entre
 * `fim_periodo` e hoje. Uma assinatura ativa com término no passado JÁ aparece
 * como vencida na tela — gravar o estado além de calculá-lo criaria duas
 * verdades que envelhecem em ritmos diferentes.
 */
export const STATUS = {
  'Ativo':     'ativa',
  'Vencida':   'ativa',
  'Pausado':   'pausada',
  'Cancelado': 'cancelada',
  'Diarista':  'ativa',
};

// ── Leitura de CSV ────────────────────────────────────────────────────────

/** CSV com aspas, vírgula dentro de campo e quebra de linha dentro de aspas. */
export function lerCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], dentro = false;
  const t = String(texto).replace(/\r\n?/g, '\n');

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentro) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else dentro = false;
      } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// ── Normalização ──────────────────────────────────────────────────────────

/** "03/08/2026" e "3/8/2026" -> "2026-08-03". A planilha usa os dois: 130
 *  linhas no primeiro formato e 14 no segundo. */
export function dataIso(bruto) {
  const m = String(bruto || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mes, a] = m;
  const iso = `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const teste = new Date(iso + 'T00:00:00');
  return isNaN(teste.getTime()) ? null : iso;
}

/** "R$ 330,00" -> 330. Devolve null quando não dá para ler um número. */
export function preco(bruto) {
  const t = String(bruto || '').replace(/R\$|\s| /g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A coluna OBSERVAÇÕES da planilha guarda DUAS coisas misturadas.
 *
 * Em 56 das 57 linhas preenchidas ela tem um código de disparo — "OK03",
 * "OK01" — que é registro da automação de mensagem, não anotação sobre o
 * cliente. Só uma linha traz texto de gente ("Retorna mes 4 ou 5").
 *
 * Importar os códigos encheria o campo de observação comercial (§28) de lixo,
 * e faria 56 clientes exibirem o marcador de "tem anotação" sem ter nenhuma.
 * Os códigos serão reconstruídos pela Etapa 3 a partir de regras — copiá-los
 * agora seria congelar o estado de um disparo que já aconteceu.
 */
export function observacaoUtil(bruto) {
  const t = String(bruto || '').trim();
  if (!t) return null;
  return /^(ok|vence|vencida|enviado)\s*\d*$/i.test(t) ? null : t;
}

/** Só dígitos, com o 55 do Brasil quando faltar. */
export function telefone(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

export function somarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Mapeamento ────────────────────────────────────────────────────────────

/**
 * Lê as linhas do CSV e separa o que entra do que não entra.
 *
 * Nada é adivinhado: linha sem nome, sem data ou com pacote desconhecido fica
 * DE FORA e é listada no SQL, para ser lançada à mão. Importar com valor
 * inventado é pior que não importar.
 */
export function mapear(linhas) {
  const cab = (linhas[0] || []).map(s => String(s).trim());
  const col = nome => cab.indexOf(nome);
  const iNome = col('Paciente'), iStatus = col('Status'), iPacote = col('Pacote');
  const iInicio = col('Data de início'), iFim = col('Data de término');
  const iPreco = col('Preço'), iHorario = col('Horário');
  const iContato = col('CONTATO'), iObs = col('OBSERVAÇÕES');

  if (iNome < 0 || iInicio < 0 || iPacote < 0) {
    throw new Error('CSV não parece ser a aba "Controle de Pacientes": faltam Paciente, Data de início ou Pacote.');
  }

  const dentro = [], fora = [];

  for (let n = 1; n < linhas.length; n++) {
    const r = linhas[n];
    if (!r || !r.some(c => String(c).trim())) continue;

    const nome = String(r[iNome] || '').trim();
    const pacote = String(r[iPacote] || '').trim();
    const inicio = dataIso(r[iInicio]);
    const statusPlanilha = String(r[iStatus] || '').trim();

    const motivo =
      !nome ? 'sem nome' :
      !inicio ? 'data de início ilegível' :
      !PLANOS[pacote] ? `pacote desconhecido (${pacote || 'em branco'})` :
      !STATUS[statusPlanilha] ? `status desconhecido (${statusPlanilha || 'em branco'})` : null;

    if (motivo) { fora.push({ linha: n + 1, nome: nome || '(sem nome)', motivo }); continue; }

    const plano = PLANOS[pacote];
    const fimCalculado = somarDias(inicio, plano.duracao_valor);
    const fimPlanilha = dataIso(r[iFim]);

    dentro.push({
      linha: n + 1,
      nome,
      telefone: telefone(r[iContato]),
      pacote,
      status: STATUS[statusPlanilha],
      statusPlanilha,
      inicio,
      fim: fimCalculado,
      // Divergência entre o que a planilha diz e o que a duração do plano
      // produz. Nenhuma apareceu nas 137 linhas conferidas, mas se aparecer é
      // sinal de edição manual — e vai listada no SQL em vez de sumir.
      divergeDaPlanilha: !!fimPlanilha && fimPlanilha !== fimCalculado,
      fimPlanilha,
      preco: preco(r[iPreco]),
      horario: String(r[iHorario] || '').trim() || null,
      observacoes: observacaoUtil(r[iObs]),
    });
  }

  return { dentro, fora };
}

/** Resumo para quem confere antes de rodar. */
export function resumo(dentro) {
  const por = chave => dentro.reduce((m, r) => (m[chave(r)] = (m[chave(r)] || 0) + 1, m), {});
  const ativos = dentro.filter(r => r.status === 'ativa');
  return {
    total: dentro.length,
    nomesDistintos: new Set(dentro.map(r => r.nome)).size,
    porStatus: por(r => r.statusPlanilha),
    porPacote: por(r => r.pacote),
    ativos: ativos.length,
    semTelefone: dentro.filter(r => !r.telefone).length,
    semPreco: dentro.filter(r => r.preco == null).length,
    divergentes: dentro.filter(r => r.divergeDaPlanilha).length,
    comObservacao: dentro.filter(r => r.observacoes).length,
    receitaAtivos: Math.round(ativos.reduce((s, r) => s + (r.preco || 0) * 100, 0)) / 100,
  };
}

// ── EMISSÃO DE SQL ────────────────────────────────────────────────────────

/** Texto para literal SQL: aspas simples dobram. Nomes têm apóstrofo
 *  ("Vitór D'Angelo") e um só quebraria o script inteiro. */
export function lit(v) {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).split("'").join("''")}'`;
}

export function num(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'null' : String(Number(v));
}

/** 32468 -> "32.468,00". Sem `toLocaleString`, que traz espaço não separável e
 *  suja um comentário de SQL. */
export function brl(v) {
  const [i, d] = Number(v || 0).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}

/**
 * O SQL da importação.
 *
 * É um bloco `do $$ ... $$` só, porque os quatro passos precisam valer juntos:
 * plano sem assinatura não serve, e assinatura sem paciente não existe.
 *
 * RE-EXECUTÁVEL. Paciente é procurado pelo nome antes de ser criado, e
 * assinatura só nasce para quem ainda não tem uma viva — o índice único
 * `uq_comercial_assinatura_ativa` é a rede embaixo disso. Rodar duas vezes não
 * duplica ninguém.
 */
export function montarSql(dentro, fora, { todos = false } = {}) {
  const linhas = todos ? dentro : dentro.filter(r => r.status !== 'cancelada');
  const planos = [...new Set(linhas.map(r => r.pacote))].sort();
  const ativos = linhas.filter(r => r.status === 'ativa');
  const receita = Math.round(ativos.reduce((s, r) => s + (r.preco || 0) * 100, 0)) / 100;
  const semTelefone = linhas.filter(r => !r.telefone).length;
  const semPreco = linhas.filter(r => r.preco == null).length;

  const valoresPlanos = planos.map(nome => {
    const p = PLANOS[nome];
    return `    (${lit(nome)}, ${p.duracao_valor}, 'dia', ${p.frequencia_semanal ?? 'null'})`;
  }).join(',\n');

  const valoresClientes = linhas.map(r =>
    `    (${lit(r.nome)}, ${lit(r.telefone)}, ${lit(r.pacote)}, ${lit(r.status)}, ` +
    `${lit(r.inicio)}::date, ${lit(r.fim)}::date, ${num(r.preco)}, ${lit(r.horario)}, ${lit(r.observacoes)})`
  ).join(',\n');

  return `-- ===========================================================================
-- Evollo · COMERCIAL — CLIENTES IMPORTADOS DA PLANILHA DA GOUP
-- ---------------------------------------------------------------------------
-- GERADO AUTOMATICAMENTE por db/gerador_clientes.mjs a partir da aba
-- "Controle de Pacientes". NAO EDITE A MAO: ajuste a planilha e rode de novo.
--
-- ${linhas.length} clientes${todos ? ' (TODOS, inclusive cancelados)' : ' com vinculo vivo (cancelados ficaram de fora)'}.
-- ${ativos.length} com assinatura ativa, somando R$ ${brl(receita)} de valor contratado.
-- ${planos.length} planos: ${planos.join(', ')}.
--
-- O QUE ESTE SCRIPT FAZ, nesta ordem:
--   1. descobre o nutri dono (unico no projeto; para se houver mais de um)
--   2. cria os planos que faltarem, pelo nome
--   3. cria os pacientes que faltarem, procurando pelo NOME antes
--   4. cria a assinatura de quem ainda nao tem uma viva
--
-- RE-EXECUTAVEL. Rodar duas vezes nao duplica ninguem: cada passo procura
-- antes de criar, e o indice uq_comercial_assinatura_ativa e a rede embaixo.
--
-- O QUE NAO VEM DA PLANILHA, e por que:
--   dias vencidos    e conta (hoje - termino), nao dado
--   mes / ano        derivam da data de termino
--   status pagamento 141 das 144 linhas dizem "Concluido": nao informa nada
--   contato z-api    e o mesmo telefone noutro formato
--
-- A PERDA QUE NAO DA PARA EVITAR: a planilha guarda UMA linha por cliente e a
-- sobrescreve a cada renovacao. Nao ha historico de pagamento por cliente ali.
-- Por isso \`data_inicio_original\` recebe a MESMA data do periodo vigente:
-- "cliente desde" vai estar errado para quem ja renovou, e so o uso do Evollo
-- daqui para frente corrige. Nenhuma cobranca passada e criada — inventar
-- pagamento que nao se pode comprovar seria pior que nao ter o historico.
--
-- NENHUMA COBRANCA E CRIADA, nem a do periodo atual. Crie-as pela tela
-- (Comercial > cliente > Criar cobranca do periodo) ou deixe que a primeira
-- renovacao gere. Assim voce ve o valor antes de ele virar conta a receber.
--
-- ${semTelefone} cliente(s) sem telefone e ${semPreco} sem preco entram como estao na planilha.
${fora.length ? `--
-- ${fora.length} LINHA(S) FICARAM DE FORA:
${fora.map(f => `--   linha ${f.linha}: ${f.nome} — ${f.motivo}`).join('\n')}` : '--\n-- Nenhuma linha ficou de fora.'}
--
-- Requer db/comercial_etapa1_vinculo.sql e db/comercial_etapa2_planos.sql.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

do $$
declare
  v_nutri   uuid;
  v_quantos int;
  v_plano   uuid;
  v_pac     uuid;
  v_novos_p int := 0;
  v_novos_a int := 0;
  r         record;
begin
  select count(distinct nutri_id) into v_quantos from public.pacientes;
  if v_quantos = 0 then
    raise exception 'Nenhum paciente no projeto: nao da para descobrir o nutri dono.';
  elsif v_quantos > 1 then
    raise exception 'Ha % nutris no projeto. Edite este script e fixe o nutri_id.', v_quantos;
  end if;
  select distinct nutri_id into v_nutri from public.pacientes;

  for r in
    select * from (values
${valoresPlanos}
    ) as t(nome, duracao, unidade, freq)
  loop
    if not exists (select 1 from public.comercial_planos
                    where nutri_id = v_nutri and lower(trim(nome)) = lower(trim(r.nome))) then
      insert into public.comercial_planos
        (nutri_id, nome, duracao_valor, duracao_unidade, frequencia_semanal, tolerancia_dias, ativo)
      values (v_nutri, r.nome, r.duracao, r.unidade, r.freq, 5, true);
    end if;
  end loop;

  for r in
    select * from (values
${valoresClientes}
    ) as t(nome, telefone, pacote, situacao, inicio, fim, preco, horario, obs)
  loop
    select id into v_plano from public.comercial_planos
     where nutri_id = v_nutri and lower(trim(nome)) = lower(trim(r.pacote)) limit 1;

    select id into v_pac from public.pacientes
     where nutri_id = v_nutri and lower(trim(nome)) = lower(trim(r.nome)) limit 1;

    if v_pac is null then
      insert into public.pacientes (codigo, nutri_id, nome, telefone, status)
      values (public.gerar_codigo_paciente(), v_nutri, r.nome, r.telefone, 'ativo')
      returning id into v_pac;
      v_novos_p := v_novos_p + 1;
    elsif r.telefone is not null then
      update public.pacientes set telefone = coalesce(telefone, r.telefone) where id = v_pac;
    end if;

    if not exists (select 1 from public.comercial_assinaturas
                    where paciente_id = v_pac and status in ('ativa', 'aguardando_inicio', 'pausada')) then
      insert into public.comercial_assinaturas
        (nutri_id, paciente_id, plano_id, valor_contratado,
         data_inicio_original, inicio_periodo, fim_periodo, horario, status,
         renovacao_automatica, observacoes)
      values
        (v_nutri, v_pac, v_plano, r.preco,
         r.inicio, r.inicio, r.fim, r.horario, r.situacao,
         true, r.obs);
      v_novos_a := v_novos_a + 1;
    end if;
  end loop;

  raise notice 'Pacientes criados: %. Assinaturas criadas: %.', v_novos_p, v_novos_a;
end $$;


-- ===========================================================================
-- Conferencia
-- ===========================================================================
select
  (select count(*) from public.comercial_planos)                                as planos,
  (select count(*) from public.comercial_assinaturas)                           as assinaturas,
  (select count(*) from public.comercial_assinaturas where status = 'ativa')    as ativas,
  (select count(*) from public.pacientes)                                       as pacientes,
  (select count(*) from public.comercial_assinaturas where fim_periodo < current_date
     and status = 'ativa')                                                      as vencidas_hoje;
`;
}

// ── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('gerador_clientes.mjs')) {
  const args = process.argv.slice(2);
  const todos = args.includes('--todos');
  const entrada = args.find(a => !a.startsWith('--'));
  if (!entrada) {
    console.error('Uso: node db/gerador_clientes.mjs caminho/Controle.csv [--todos]');
    console.error('  --todos  importa também os cancelados (padrão: só vínculo vivo)');
    process.exit(1);
  }
  const { dentro, fora } = mapear(lerCsv(readFileSync(resolve(entrada), 'utf8')));

  // Só o RESUMO vai para a tela. Nome e telefone de 144 pessoas não são saída
  // de terminal — o repositório é público e o terminal costuma virar print.
  console.log(JSON.stringify({ ...resumo(dentro), fora, incluiCancelados: todos }, null, 2));

  // Os dois arquivos ficam IGNORADOS pelo git. A regra do projeto (ver
  // .gitignore) é a mesma dos outros seeds: o GERADOR é versionado, os DADOS
  // não. Quem tiver a planilha reproduz com um comando.
  writeFileSync(resolve(AQUI, 'comercial_clientes_dados.json'),
    JSON.stringify({ dentro, fora }, null, 2), 'utf8');
  writeFileSync(resolve(AQUI, 'comercial_clientes_seed.sql'),
    montarSql(dentro, fora, { todos }), 'utf8');
  console.log('\nGerados (fora do git):');
  console.log('  db/comercial_clientes_dados.json');
  console.log('  db/comercial_clientes_seed.sql');
}
