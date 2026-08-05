// ═══════════════════════════════════════════════════════════
// GERADOR — planilha de vendas (.xlsx)  ->  db/financeiro_vendas_seed.sql
// ═══════════════════════════════════════════════════════════
// Uso:  node db/gerador_vendas.mjs [caminho/do/Vendas.xlsx]
//
// Lê o .xlsx direto, sem dependência: um .xlsx é um ZIP de XML, e o projeto não
// tem node_modules. São ~120 linhas de leitor contra uma árvore de pacotes que
// precisaria ser mantida — e a planilha usa três recursos do formato, não os
// trezentos.
//
// O QUE VIRA O QUÊ:
//   Valor              -> valor do lançamento (é o dinheiro que entrou)
//   Data               -> data e competência
//   Nome               -> descrição (quem pagou)
//   Pacote             -> CATEGORIA de receita, com a grafia da planilha
//   Forma de Pagamento -> observações
//
// DESCONTO E "% DESCONTO" SÃO IGNORADOS DE PROPÓSITO. As duas colunas estão
// inconsistentes: em 1.627 linhas "DESCONTO" vale 13 seja qual for o pacote ou
// o valor, em outras guarda reais (165,00) e em outras uma taxa (0,06). Nenhuma
// delas é caixa — o caixa é a coluna Valor, e é só ela que este import lê.
//
// Nada é adivinhado: pacote em branco vira lançamento SEM CATEGORIA, valor em
// branco vira lançamento SEM VALOR, e ambos aparecem como pendência na tela.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(AQUI, 'financeiro_vendas_seed.sql');
const PADRAO = 'C:/Users/eduar/Desktop/Vendas.xlsx';

// ───────────────────────────────────────────────────────────
// ZIP — só o necessário para tirar três arquivos de dentro
// ───────────────────────────────────────────────────────────

/** Mapa nome -> conteúdo (utf8) das entradas do zip. */
export function abrirZip(buf) {
  // O fim do diretório central tem assinatura 0x06054b50 e mora nos últimos
  // 64KB. Varrer de trás para frente acha o certo mesmo com comentário no fim.
  let fim = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Nao parece um .xlsx (diretorio central do zip nao encontrado)');

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);

  const saida = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo    = buf.readUInt16LE(p + 10);
    const compTam   = buf.readUInt32LE(p + 20);
    const nomeTam   = buf.readUInt16LE(p + 28);
    const extraTam  = buf.readUInt16LE(p + 30);
    const comentTam = buf.readUInt16LE(p + 32);
    const offset    = buf.readUInt32LE(p + 42);
    const nome      = buf.toString('utf8', p + 46, p + 46 + nomeTam);

    // O cabeçalho local repete nome e extra com tamanhos PRÓPRIOS — usar os do
    // diretório central aqui erra o início dos dados em arquivos gerados pelo
    // Excel, que costuma pôr extra só num dos dois.
    const lNomeTam  = buf.readUInt16LE(offset + 26);
    const lExtraTam = buf.readUInt16LE(offset + 28);
    const ini = offset + 30 + lNomeTam + lExtraTam;
    const bruto = buf.subarray(ini, ini + compTam);

    saida[nome] = (metodo === 0 ? bruto : inflateRawSync(bruto)).toString('utf8');
    p += 46 + nomeTam + extraTam + comentTam;
  }
  return saida;
}

// ───────────────────────────────────────────────────────────
// XLSX — sharedStrings, estilos de data, células
// ───────────────────────────────────────────────────────────
function desescapar(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&');
}

export function lerSharedStrings(xml) {
  const out = [];
  for (const m of (xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let texto = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) texto += t[1];
    out.push(desescapar(texto));
  }
  return out;
}

// Data em xlsx é um número de série; só o FORMATO diz que aquilo é uma data.
const DATA_EMBUTIDOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export function lerEstilosDeData(xml) {
  const custom = new Set();
  for (const m of (xml || '').matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const codigo = desescapar(m[2]).replace(/"[^"]*"/g, '');   // fora o texto literal
    if (/[dmy]/i.test(codigo)) custom.add(Number(m[1]));
  }
  const bloco = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml || '');
  const ehData = [];
  if (bloco) {
    for (const xf of bloco[1].matchAll(/<xf[^>]*numFmtId="(\d+)"[^>]*\/?>/g)) {
      const id = Number(xf[1]);
      ehData.push(DATA_EMBUTIDOS.has(id) || custom.has(id));
    }
  }
  return ehData;
}

/**
 * Serial do Excel → 'YYYY-MM-DD'.
 *
 * O epoch é 30/12/1899, e não 01/01/1900, por causa do bug do ano bissexto de
 * 1900 que a Microsoft manteve para compatibilidade com o Lotus 1-2-3. Usar a
 * data "certa" erra todas as datas em um dia.
 */
export function serialParaISO(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n) * 86400000));
  const p = x => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const colDe = ref => {
  const letras = /^([A-Z]+)/.exec(ref)?.[1] || 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

export function lerLinhas(sheetXml, shared, ehData) {
  const linhas = [];
  for (const mr of (sheetXml || '').matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = [];
    for (const mc of mr[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs  = mc[1];
      const ref    = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] || '';
      const tipo   = /t="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const estilo = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);

      const mv  = /<v>([\s\S]*?)<\/v>/.exec(mc[2]);
      const mis = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(mc[2]);

      let valor = null;
      if (tipo === 's' && mv) valor = shared[Number(mv[1])] ?? '';
      else if (tipo === 'inlineStr' && mis) valor = desescapar(mis[1]);
      else if (mv) {
        const b = desescapar(mv[1]);
        if (tipo === 'str' || tipo === 'e') valor = b;
        else if (estilo >= 0 && ehData[estilo] && b !== '') valor = serialParaISO(b);
        else valor = Number(b);
      }
      celulas[colDe(ref)] = valor;
    }
    linhas.push({ num: Number(mr[1]), celulas });
  }
  return linhas;
}

// ───────────────────────────────────────────────────────────
// A PLANILHA DE VENDAS
// ───────────────────────────────────────────────────────────
const vazio = v => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/**
 * Grafias do MESMO plano que a planilha escreve de dois jeitos.
 *
 * A correção mora AQUI, e não só no banco, porque o gerador lê a planilha crua:
 * arrumar as categorias pelo app e reimportar depois traria "Trimestral - 5x"
 * de volta, e ninguém desconfiaria — a categoria certa continuaria existindo,
 * só que com metade das vendas.
 *
 * A forma correta é a SEM hífen, definida pelo Eduardo em 05/08/2026. Só entra
 * aqui variação comprovadamente do mesmo plano; nome parecido não basta.
 */
const GRAFIAS = {
  'trimestral - 5x': 'Trimestral 5x',
  'trimestral - 3x': 'Trimestral 3x',
};

/** Pacote só é categoria se for TEXTO. Onde a célula traz um número, a coluna
 *  escorregou (há linhas com "13" no lugar do pacote) — e um número não é o
 *  nome de um plano. Vira "sem categoria", que é o que de fato se sabe. */
export function pacoteDe(v) {
  if (typeof v !== 'string' || !v.trim()) return '';
  const limpo = v.trim();
  return GRAFIAS[limpo.toLowerCase()] || limpo;
}

export function lerVendas(linhas) {
  const dentro = [], fora = [];

  for (const l of linhas.slice(1)) {
    const c = l.celulas;
    if (c.every(vazio)) continue;

    const data = String(c[0] ?? '');
    const registro = {
      linha: l.num,
      data,
      nome: typeof c[3] === 'string' ? c[3].trim() : '',
      pacote: pacoteDe(c[4]),
      valor: typeof c[5] === 'number' ? c[5] : null,
      pago: !/^n/i.test(String(c[8] ?? '')),     // em branco = recebido
      forma: typeof c[9] === 'string' ? c[9].trim() : '',
      obs: typeof c[10] === 'string' ? c[10].trim() : '',
    };

    // Sem data válida não há competência, e competência é NOT NULL. A linha
    // fica de fora e e listada — inventar a data pelo vizinho seria decidir o
    // mês de uma venda no chute.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registro.data)) { fora.push(registro); continue; }
    dentro.push(registro);
  }
  return { dentro, fora };
}

const aspas = s => `'${String(s).replace(/'/g, "''")}'`;
const brl = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Soma em centavos inteiros. Em float, as 2.177 vendas dão R$ 593.781,26 e o
 *  Postgres, somando `numeric` exato, dá R$ 593.781,27. O total no comentário
 *  de conferência TEM que bater com o que o banco devolve — um esperado que
 *  erra por um centavo ensina quem confere a ignorar divergência. */
export const soma = a => a.reduce((s, r) => s + Math.round((r.valor || 0) * 100), 0) / 100;

export function montarSql(linhas) {
  const { dentro, fora } = lerVendas(linhas);
  const categorias = [...new Set(dentro.map(r => r.pacote).filter(Boolean))].sort();
  const semValor = dentro.filter(r => r.valor === null);
  const semCategoria = dentro.filter(r => !r.pacote);
  const datas = dentro.map(r => r.data).sort();

  const observacao = r => [r.forma, r.obs].filter(Boolean).join(' · ');

  return `-- ===========================================================================
-- Evollo · Financeiro da empresa — VENDAS IMPORTADAS DA PLANILHA
-- ---------------------------------------------------------------------------
-- GERADO AUTOMATICAMENTE por db/gerador_vendas.mjs a partir de "Vendas.xlsx".
-- NAO EDITE A MAO: ajuste a planilha e rode o gerador de novo.
--
-- ${dentro.length} receitas, de ${datas[0]} a ${datas[datas.length - 1]}.
-- Total: R$ ${brl(soma(dentro))}.
--
-- Os ${categorias.length} pacotes viram CATEGORIAS DE RECEITA com a grafia da planilha. Grafias
-- diferentes do mesmo plano ("Trimestral 5x" e "Trimestral - 5x") chegam
-- separadas de proposito: unificar e decisao de quem le o balanco, e a tela tem
-- o botao Fundir para isso.
--
-- AS COLUNAS "DESCONTO" E "% DESCONTO" NAO FORAM IMPORTADAS. Elas estao
-- inconsistentes: em 1.627 linhas "DESCONTO" vale 13 seja qual for o pacote ou
-- o valor, em outras guarda reais e em outras uma taxa. Nenhuma delas e caixa —
-- o caixa e a coluna Valor.
--
-- ${semCategoria.length} linhas entram SEM CATEGORIA e ${semValor.length} SEM VALOR, como estao na planilha.
${fora.length ? `--
-- ${fora.length} LINHA(S) FICARAM DE FORA por nao ter data valida:
${fora.map(r => `--   linha ${r.linha}: ${r.nome} — ${r.pacote || 'sem pacote'} — ${r.valor === null ? 'sem valor' : 'R$ ' + brl(r.valor)}`).join('\n')}
--   Lance-as pela tela (Financeiro > Receitas > Nova receita) com a data certa.` : ''}
--
-- Requer db/financeiro_lancamentos.sql. 100% re-executavel: apaga e recria
-- APENAS os lancamentos de origem 'vendas'. Custos ('planilha') e o que for
-- lancado a mao ('manual') nao sao tocados.
-- Rodar no SQL Editor do Supabase.
-- ===========================================================================

-- Marca propria para esta importacao. Sem isto, o seed de custos — que apaga
-- origem = 'planilha' antes de recriar — levaria as vendas junto.
alter table public.financeiro_lancamentos drop constraint if exists financeiro_lancamentos_origem_check;
alter table public.financeiro_lancamentos add  constraint financeiro_lancamentos_origem_check
  check (origem in ('manual', 'planilha', 'vendas'));

do $vendas$
declare
  v_nutri  uuid;
  v_donos  integer;
  v_linhas integer;
  v_total  numeric;
begin
  select count(distinct nutri_id) into v_donos from public.folhas;

  if auth.uid() is not null then
    v_nutri := auth.uid();
  elsif v_donos = 1 then
    select distinct nutri_id into v_nutri from public.folhas;
  else
    select id into v_nutri from auth.users
     where lower(email) = lower('eduardomedani@natalinossalgados.com.br') limit 1;
  end if;

  if v_nutri is null then
    raise exception 'Nao encontrei o dono das linhas. Rode logado, ou ajuste o e-mail no gerador.';
  end if;

  insert into public.financeiro_categorias (nutri_id, nome, tipo, ordem)
  select v_nutri, x.nome, 'receita', x.ordem
    from (values
${categorias.map((nome, i) => `      (${aspas(nome)}, ${i + 1})`).join(',\n')}
         ) as x(nome, ordem)
   where not exists (
     select 1 from public.financeiro_categorias c
      where c.nutri_id = v_nutri and c.tipo = 'receita' and lower(c.nome) = lower(x.nome)
   );

  delete from public.financeiro_lancamentos
   where nutri_id = v_nutri and origem = 'vendas';

  -- STATUS VAI EXPLICITO. A coluna tem default 'pendente' e um trigger que
  -- sincroniza pago <-> status: omiti-la aqui faria o default vencer, o trigger
  -- concluir pago = false e as receitas todas virarem pendentes na reimportacao,
  -- sem erro nenhum na tela.
  insert into public.financeiro_lancamentos
    (nutri_id, tipo, data, competencia, descricao, valor, pago, status, pago_em,
     categoria_id, observacoes, origem, origem_linha)
  select
    v_nutri, 'receita', v.data, date_trunc('month', v.data)::date, v.descricao,
    v.valor, v.pago,
    case when v.pago then 'pago' else 'pendente' end,
    case when v.pago then v.data else null end,
    c.id, nullif(v.observacoes, ''), 'vendas', v.linha
  from (values
${dentro.map(r => `    (${r.linha}, date '${r.data}', ${aspas(r.nome || 'Venda')}, ` +
      `${r.valor === null ? 'null::numeric' : r.valor.toFixed(2)}, ${r.pago}, ` +
      `${aspas(r.pacote)}, ${aspas(observacao(r))})`).join(',\n')}
       ) as v(linha, data, descricao, valor, pago, pacote, observacoes)
  left join public.financeiro_categorias c
    on c.nutri_id = v_nutri and c.tipo = 'receita'
   and v.pacote <> '' and lower(c.nome) = lower(v.pacote);

  select count(*), coalesce(sum(valor), 0) into v_linhas, v_total
    from public.financeiro_lancamentos
   where nutri_id = v_nutri and origem = 'vendas';

  raise notice 'Importadas % receitas, total R$ %', v_linhas, v_total;
end $vendas$;


-- ===========================================================================
-- Conferencia. Esperado: ${dentro.length} receitas, ${brl(soma(dentro))}, ${semCategoria.length} sem categoria, ${semValor.length} sem valor.
-- ===========================================================================
select
  count(*)                                     as receitas,
  sum(valor)                                   as total,
  count(*) filter (where categoria_id is null) as sem_categoria,
  count(*) filter (where valor is null)        as sem_valor,
  min(competencia)                             as primeiro_mes,
  max(competencia)                             as ultimo_mes
from public.financeiro_lancamentos
where origem = 'vendas';
`;
}

// ───────────────────────────────────────────────────────────
const comoScript = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (comoScript) {
  const zip = abrirZip(readFileSync(process.argv[2] || PADRAO));
  const shared = lerSharedStrings(zip['xl/sharedStrings.xml']);
  const ehData = lerEstilosDeData(zip['xl/styles.xml']);
  const linhas = lerLinhas(zip['xl/worksheets/sheet1.xml'], shared, ehData);

  const { dentro, fora } = lerVendas(linhas);
  writeFileSync(DESTINO, montarSql(linhas), 'utf8');

  console.log(`  ok — ${DESTINO}`);
  console.log(`  ${dentro.length} receitas, R$ ${brl(soma(dentro))}`);
  console.log(`  ${[...new Set(dentro.map(r => r.pacote).filter(Boolean))].length} categorias de receita`);
  console.log(`  ${dentro.filter(r => !r.pacote).length} sem categoria, ${dentro.filter(r => r.valor === null).length} sem valor`);
  if (fora.length) console.log(`  FORA (sem data valida): ${fora.map(r => 'linha ' + r.linha).join(', ')}`);
}
