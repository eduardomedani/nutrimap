// ═══════════════════════════════════════════════════════════
// PLANILHA — ler .xlsx dentro do navegador
// ═══════════════════════════════════════════════════════════
// Mesma lógica de `db/gerador_vendas.mjs`, que só roda no Node. Aqui não há
// `Buffer` nem `zlib`: o descompactador é `DecompressionStream('deflate-raw')`,
// nativo do Chrome desde 2022, e a leitura é assíncrona por causa dele.
//
// POR QUE NÃO UMA BIBLIOTECA. O projeto é ESM sem build, e a CSP não deixa
// carregar script de fora. Uma SheetJS inline seriam centenas de KB baixados
// por todo mundo que abre o Comercial — para uma tela que talvez seja usada
// uma vez por mês. O que este arquivo faz cabe em duzentas linhas.
//
// OS DOIS BUGS QUE JÁ CUSTARAM CARO ESTÃO CORRIGIDOS AQUI TAMBÉM, e é por isso
// que este arquivo é uma porta e não uma reescrita:
//
//   [Red]  em `formatCode` fazia o "d" de "Red" marcar a coluna como data, e
//          toda moeda com negativo em vermelho virava data.
//   <c/>   célula vazia COM estilo é autofechada. Sem a alternativa no regex,
//          o `</c>` casado era o da próxima célula preenchida e o valor dela
//          ia parar na coluna errada — deslocando a linha em silêncio.

function desescapar(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const u16 = (dv, p) => dv.getUint16(p, true);
const u32 = (dv, p) => dv.getUint32(p, true);

async function inflarBruto(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/**
 * O .xlsx é um zip. Devolve { 'xl/worksheets/sheet1.xml': '<xml…>', … }.
 *
 * Lê pelo DIRETÓRIO CENTRAL, no fim do arquivo, e não varrendo os cabeçalhos
 * locais do começo — é o único jeito de saber o tamanho comprimido antes de
 * descomprimir quando o gerador usa "data descriptor" (o Excel usa).
 */
export async function abrirZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const td = new TextDecoder('utf-8');

  // A assinatura 0x06054b50 mora nos últimos 64KB. De trás para frente acha o
  // certo mesmo quando o arquivo tem comentário no fim.
  let fim = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (u32(dv, i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('arquivo_nao_e_xlsx');

  const total = u16(dv, fim + 10);
  let p = u32(dv, fim + 16);
  const saida = {};

  for (let n = 0; n < total; n++) {
    if (u32(dv, p) !== 0x02014b50) break;
    const metodo    = u16(dv, p + 10);
    const compTam   = u32(dv, p + 20);
    const nomeTam   = u16(dv, p + 28);
    const extraTam  = u16(dv, p + 30);
    const comentTam = u16(dv, p + 32);
    const offset    = u32(dv, p + 42);
    const nome      = td.decode(bytes.subarray(p + 46, p + 46 + nomeTam));

    // O cabeçalho LOCAL repete nome e extra com tamanhos próprios. Usar os do
    // diretório central aqui erra o início dos dados nos arquivos do Excel,
    // que costuma pôr o campo extra só num dos dois.
    const lNomeTam  = u16(dv, offset + 26);
    const lExtraTam = u16(dv, offset + 28);
    const ini = offset + 30 + lNomeTam + lExtraTam;
    const bruto = bytes.subarray(ini, ini + compTam);

    saida[nome] = td.decode(metodo === 0 ? bruto : await inflarBruto(bruto));
    p += 46 + nomeTam + extraTam + comentTam;
  }
  return saida;
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
    // Fora tudo o que NÃO é código de data:
    //   "dias"\ 0     texto literal entre aspas
    //   [Red]         cor e locale — o "d" daqui já transformou toda moeda com
    //                 negativo em vermelho numa coluna de datas
    //   \d            caractere escapado com barra é literal, não código
    const codigo = desescapar(m[2])
      .replace(/"[^"]*"/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\\./g, '');
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
 * O epoch é 30/12/1899, não 01/01/1900, por causa do bug do ano bissexto de
 * 1900 que a Microsoft manteve para compatibilidade com o Lotus 1-2-3. Usar a
 * data "certa" erra todas as datas em um dia.
 */
export function serialParaISO(n) {
  const num = Number(n);
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
  const p = x => String(x).padStart(2, '0');
  const dia = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  // A parte fracionária é a HORA, e no relatório de presenças ela é o dado que
  // diz qual estagiário estava na sala. Descartá-la perderia metade da
  // informação de cada linha.
  const frac = num - Math.floor(num);
  if (frac <= 0) return dia;
  const min = Math.round(frac * 1440);
  return `${dia} ${p(Math.floor(min / 60) % 24)}:${p(min % 60)}`;
}

const colDe = ref => {
  const letras = /^([A-Z]+)/.exec(ref)?.[1] || 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

export function lerLinhas(sheetXml, shared = [], ehData = []) {
  const linhas = [];
  for (const mr of (sheetXml || '').matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = [];
    // A alternativa `\/>` trata a célula VAZIA COM ESTILO, que o Excel escreve
    // autofechada: <c r="G2" s="6"/>.
    for (const mc of mr[2].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs  = mc[1];
      const corpo  = mc[2] ?? '';
      const ref    = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] || '';
      const tipo   = /t="([^"]+)"/.exec(attrs)?.[1] || 'n';
      const estilo = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);

      const mv  = /<v>([\s\S]*?)<\/v>/.exec(corpo);
      const mis = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(corpo);

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

/**
 * O caminho curto: arquivo → linhas da primeira aba.
 *
 * Aceita o prefixo `x:` nas tags, que o gerador do espelho de ponto usa e o do
 * relatório de presenças não. Normalizar aqui é uma linha; duas famílias de
 * regex seriam duas para manter.
 */
export async function lerPrimeiraAba(file) {
  const zip = await abrirZip(new Uint8Array(await file.arrayBuffer()));
  const semPrefixo = s => (s || '').replace(/<x:/g, '<').replace(/<\/x:/g, '</');

  const nomeAba = Object.keys(zip)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!nomeAba) throw new Error('planilha_sem_aba');

  const shared = lerSharedStrings(semPrefixo(zip['xl/sharedStrings.xml']));
  const ehData = lerEstilosDeData(semPrefixo(zip['xl/styles.xml']));
  return lerLinhas(semPrefixo(zip[nomeAba]), shared, ehData);
}
