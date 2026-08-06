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
      observacoes: String(r[iObs] || '').trim() || null,
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
    receitaAtivos: Math.round(ativos.reduce((s, r) => s + (r.preco || 0) * 100, 0)) / 100,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('gerador_clientes.mjs')) {
  const entrada = process.argv[2];
  if (!entrada) {
    console.error('Uso: node db/gerador_clientes.mjs caminho/Controle.csv');
    process.exit(1);
  }
  const { dentro, fora } = mapear(lerCsv(readFileSync(resolve(entrada), 'utf8')));

  // Só o RESUMO vai para a tela. Nome e telefone de 144 pessoas não são saída
  // de terminal — o repositório é público e o terminal costuma virar print.
  console.log(JSON.stringify({ ...resumo(dentro), fora }, null, 2));

  // Os dados normalizados ficam num arquivo IGNORADO pelo git. A regra do
  // projeto (ver .gitignore) é a mesma dos outros seeds: o GERADOR é
  // versionado, os DADOS não. Quem tiver a planilha reproduz com um comando.
  const destino = resolve(AQUI, 'comercial_clientes_dados.json');
  writeFileSync(destino, JSON.stringify({ dentro, fora }, null, 2), 'utf8');
  console.log('\nDados normalizados em db/comercial_clientes_dados.json (fora do git).');
}
