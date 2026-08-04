// ═══════════════════════════════════════════════════════════
// FOLHA DE PONTO (PDF) — leitura do espelho de ponto
// ═══════════════════════════════════════════════════════════
// Lê o PDF do espelho de ponto e devolve o total de HORAS DIURNAS — o número
// que a folha de pagamento usa. Sem biblioteca: os streams do PDF vêm em
// FlateDecode, e o navegador já sabe inflar isso com DecompressionStream.
//
// POR QUE POR COORDENADA, E NÃO POR ORDEM DE LEITURA:
// o relatório muda de forma conforme quem trabalhou à noite. Quem só faz diurno
// tem 4 colunas (Previstas · Diurnas · Intervalo · Faltas); quem tem hora
// noturna tem 6 (entram Noturnas e Not.Red.). Contar "o primeiro número depois
// de Total:" acerta por acaso nos dois casos hoje, e erra no dia em que o
// gerador imprimir o total de Previstas. Aqui a coluna é encontrada pelo X do
// cabeçalho "Diurnas" e o valor é o que estiver embaixo dela.
//
// Se o layout mudar a ponto de não haver cabeçalho "Diurnas", a leitura FALHA
// com mensagem clara em vez de devolver o número errado — numa folha de
// pagamento, um valor plausível e errado é pior que nenhum valor.

// ───────────────────────────────────────────────────────────
// ENTRADA
// ───────────────────────────────────────────────────────────

/**
 * @param {File|ArrayBuffer|Uint8Array} arquivo
 * @returns {Promise<{nome, cpf, competencia, periodo, minutosDiurnas, minutosNoturnas, colunas}>}
 */
export async function lerPontoPdf(arquivo) {
  const bytes = await paraBytes(arquivo);
  const celulas = await extrairCelulas(bytes);
  if (!celulas.length) throw new Error('ponto_pdf_sem_texto');
  return interpretarGrade(celulas);
}

async function paraBytes(a) {
  if (a instanceof Uint8Array) return a;
  if (a instanceof ArrayBuffer) return new Uint8Array(a);
  if (typeof a?.arrayBuffer === 'function') return new Uint8Array(await a.arrayBuffer());
  throw new Error('ponto_pdf_entrada_invalida');
}

// ───────────────────────────────────────────────────────────
// INTERPRETAÇÃO — pura, recebe as células já extraídas
// ───────────────────────────────────────────────────────────

/**
 * Das células soltas para os dados do espelho.
 * Cada célula é { x, y, texto } em coordenadas da página.
 */
export function interpretarGrade(celulas) {
  const linhas = agruparEmLinhas(celulas);

  const cabecalho = linhas.find(l => l.some(c => /^Diurnas$/i.test(c.texto)));
  if (!cabecalho) throw new Error('ponto_pdf_sem_coluna_diurnas');

  const colDiurnas = cabecalho.find(c => /^Diurnas$/i.test(c.texto));
  const colNoturnas = cabecalho.find(c => /^Noturnas$/i.test(c.texto));

  const linhaTotal = linhas.find(l => l.some(c => /^Total:?$/i.test(c.texto)));
  if (!linhaTotal) throw new Error('ponto_pdf_sem_total');

  const minutosDiurnas = valorNaColuna(linhaTotal, colDiurnas.x);
  if (minutosDiurnas === null) throw new Error('ponto_pdf_total_diurnas_ilegivel');

  const texto = celulas.map(c => c.texto).join('\n');
  const periodo = /(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto);

  return {
    nome: campo(texto, /Colaborador:\s*(.+)/) || campo(texto, /Colaborador\s*\n(.+)/),
    cpf: (campo(texto, /^CPF:?\s*([\d.\-]{11,20})/m) || '').replace(/\D/g, '') || null,
    empregador: campo(texto, /Empregador:\s*(.+)/),
    funcao: campo(texto, /Função:\s*(.+)/),
    periodo: periodo ? { inicio: periodo[1], fim: periodo[2] } : null,
    competencia: periodo ? competenciaDoPeriodo(periodo[1]) : null,
    minutosDiurnas,
    minutosNoturnas: colNoturnas ? valorNaColuna(linhaTotal, colNoturnas.x) : null,
    colunas: cabecalho.map(c => c.texto),
  };
}

/** Textos na mesma altura viram uma linha; dentro dela, ordenados por X. */
function agruparEmLinhas(celulas, tolerancia = 4) {
  const linhas = [];
  for (const c of [...celulas].sort((a, b) => a.y - b.y)) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima[0].y - c.y) <= tolerancia) ultima.push(c);
    else linhas.push([c]);
  }
  return linhas.map(l => l.sort((a, b) => a.x - b.x));
}

/**
 * O valor da linha que cai debaixo de uma coluna. O texto é alinhado à direita
 * na célula, então o X do número e o do cabeçalho não coincidem — vale o mais
 * próximo, dentro de meia largura de coluna.
 */
function valorNaColuna(linha, x, tolerancia = 26) {
  let melhor = null, dist = Infinity;
  for (const c of linha) {
    const d = Math.abs(c.x - x);
    if (d < dist && minutosDeHhmm(c.texto) !== null) { melhor = c; dist = d; }
  }
  return melhor && dist <= tolerancia ? minutosDeHhmm(melhor.texto) : null;
}

function campo(texto, re) {
  const m = re.exec(texto);
  return m ? m[1].trim() : null;
}

/** '01/07/2026' → '2026-07-01'. */
function competenciaDoPeriodo(dataBr) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr);
  return m ? `${m[3]}-${m[2]}-01` : null;
}

/** '48:41' → 2921. Aceita negativo (a coluna de faltas vem assim). */
export function minutosDeHhmm(txt) {
  const m = /^(-?)(\d{1,4}):([0-5]\d)$/.exec(String(txt ?? '').trim());
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

// ───────────────────────────────────────────────────────────
// EXTRAÇÃO — do PDF para as células
// ───────────────────────────────────────────────────────────
// Um bloco BT/ET é uma célula: Tm dá a origem e os Td somam o deslocamento.
// O gerador desenha cada célula duas vezes (uma por cima da outra); como as
// duas caem na mesma coordenada, agrupar por Y resolve sem tratamento extra.

async function extrairCelulas(bytes) {
  const bruto = bytesParaTexto(bytes);

  const objetos = new Map();
  for (const m of bruto.matchAll(/(\d+)\s+0\s+obj\b/g)) objetos.set(Number(m[1]), m.index + m[0].length);

  const stream = async (num) => {
    const ini = objetos.get(num);
    if (ini === undefined) return null;
    const a = bruto.indexOf('stream', ini);
    if (a < 0) return null;
    let b = a + 6;
    if (bytes[b] === 13) b++;
    if (bytes[b] === 10) b++;

    const cabecalho = bruto.slice(ini, a);
    let fim = bruto.indexOf('endstream', b);
    if (fim < 0) return null;

    // O /Length do dicionário é a medida exata do stream. Sem ele sobra a
    // quebra de linha que antecede o "endstream", e o descompressor do
    // navegador recusa o byte a mais ("trailing junk") — o zlib do Node não.
    //
    // Cuidado com a forma "/Length 41 0 R": é uma REFERÊNCIA ao objeto 41, não
    // o número 41. Ler o 41 como tamanho corta o stream em 41 bytes.
    const tamanho = comprimentoDoStream(cabecalho, bruto, objetos);
    if (tamanho !== null) fim = Math.min(fim, b + tamanho);
    else while (fim > b && (bytes[fim - 1] === 10 || bytes[fim - 1] === 13)) fim--;

    const dados = bytes.slice(b, fim);
    if (!cabecalho.includes('FlateDecode')) return bytesParaTexto(dados);
    try { return bytesParaTexto(await inflar(dados)); }
    catch { return null; }
  };

  // ToUnicode: o PDF usa fonte embutida com códigos próprios; sem esta tabela
  // o texto sai como sequência de glifos sem significado.
  const cmaps = new Map();
  for (const [num, ini] of objetos) {
    const corpo = bruto.slice(ini, bruto.indexOf('endobj', ini));
    const mu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(corpo);
    if (!mu) continue;
    const cmap = await stream(Number(mu[1]));
    if (cmap) cmaps.set(num, lerCmap(cmap));
  }

  const celulas = [];
  for (const [, ini] of objetos) {
    const corpo = bruto.slice(ini, bruto.indexOf('endobj', ini));
    if (!/\/Type\s*\/Page\b/.test(corpo)) continue;

    const rRes = /\/Resources\s+(\d+)\s+0\s+R/.exec(corpo);
    const iRes = rRes ? objetos.get(Number(rRes[1])) : null;
    const recursos = iRes != null ? bruto.slice(iRes, bruto.indexOf('endobj', iRes)) : corpo;
    const fontes = new Map();
    for (const m of recursos.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) fontes.set(m[1], Number(m[2]));

    const rCont = /\/Contents\s+(\d+)\s+0\s+R/.exec(corpo);
    if (!rCont) continue;
    const cont = await stream(Number(rCont[1]));
    if (!cont) continue;

    const cm = /([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm/.exec(cont);
    const escala = cm ? Math.abs(Number(cm[1])) || 1 : 1;

    celulas.push(...celulasDoConteudo(cont, fontes, cmaps, escala));
  }
  return celulas;
}

/**
 * O tamanho do stream declarado no dicionário, direto ou por referência.
 *   /Length 6434      → 6434
 *   /Length 41 0 R    → o número que estiver no objeto 41
 * Devolve null quando não dá para resolver.
 */
function comprimentoDoStream(cabecalho, bruto, objetos) {
  const indireto = /\/Length\s+(\d+)\s+0\s+R/.exec(cabecalho);
  if (indireto) {
    const ini = objetos.get(Number(indireto[1]));
    if (ini === undefined) return null;
    const valor = /^\s*(\d+)/.exec(bruto.slice(ini, ini + 40));
    return valor ? Number(valor[1]) : null;
  }
  const direto = /\/Length\s+(\d+)\s*(?:\/|>>)/.exec(cabecalho);
  return direto ? Number(direto[1]) : null;
}

function celulasDoConteudo(cont, fontes, cmaps, escala) {
  const re = /BT|ET|\/(F\d+)\s+[\d.]+\s+Tf|(-?[\d.]+)\s+0\s+0\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|<([0-9A-Fa-f]+)>\s*Tj/g;

  const saida = [];
  let mapa = null, x = 0, y = 0, ox = 0, oy = 0, texto = '', inicioX = null;

  const fechar = () => {
    if (texto.trim()) saida.push({ x: (ox + inicioX) * escala, y: (oy + y) * escala, texto: texto.trim() });
    texto = ''; inicioX = null;
  };

  for (const m of cont.matchAll(re)) {
    const t = m[0];
    if (t === 'BT') { x = y = ox = oy = 0; texto = ''; inicioX = null; continue; }
    if (t === 'ET') { fechar(); continue; }
    if (m[1]) { mapa = cmaps.get(fontes.get(m[1])) || null; continue; }
    if (m[2] !== undefined) { ox = Number(m[4]); oy = Number(m[5]); x = 0; y = 0; continue; }
    if (m[6] !== undefined) {
      const dy = Number(m[7]);
      if (dy !== 0 && texto.trim()) fechar();     // desceu de linha: outra célula
      x += Number(m[6]); y += dy;
      if (inicioX === null) inicioX = x;
      continue;
    }
    if (m[8]) {
      const hex = m[8];
      for (let i = 0; i + 3 < hex.length + 1; i += 4) {
        texto += mapa?.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
      }
      if (inicioX === null) inicioX = x;
    }
  }
  fechar();
  return saida;
}

function lerCmap(cmap) {
  const tabela = new Map();
  const hexTexto = (hex) => {
    let t = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) t += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return t;
  };
  for (const bloco of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([^\]]*)\]|<([0-9A-Fa-f]+)>)/g;
    for (const p of bloco[1].matchAll(re)) {
      const i0 = parseInt(p[1], 16), i1 = parseInt(p[2], 16);
      if (p[3] !== undefined) {
        const destinos = [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(d => hexTexto(d[1]));
        for (let i = i0; i <= i1 && i - i0 < destinos.length; i++) tabela.set(i, destinos[i - i0]);
      } else {
        const base = parseInt(p[4], 16);
        for (let i = i0; i <= i1; i++) tabela.set(i, String.fromCodePoint(base + (i - i0)));
      }
    }
  }
  for (const bloco of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      tabela.set(parseInt(p[1], 16), hexTexto(p[2]));
    }
  }
  return tabela;
}

/** Inflate sem biblioteca. O navegador tem isso desde 2023. */
async function inflar(dados) {
  if (typeof DecompressionStream === 'undefined') throw new Error('ponto_pdf_sem_descompressor');
  for (const formato of ['deflate', 'deflate-raw']) {
    try {
      const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream(formato));
      return new Uint8Array(await new Response(fluxo).arrayBuffer());
    } catch (e) { /* tenta o próximo formato */ }
  }
  throw new Error('ponto_pdf_stream_ilegivel');
}

/** Bytes → string de 1 byte por caractere (latin1 puro, sem reinterpretar). */
function bytesParaTexto(bytes) {
  let s = '';
  const passo = 8192;
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return s;
}

// ───────────────────────────────────────────────────────────
export function traduzirErroPonto(msg) {
  const m = String(msg || '');
  if (m.includes('sem_coluna_diurnas')) {
    return 'Não achei a coluna "Diurnas" neste PDF. Ele é mesmo um espelho de ponto?';
  }
  if (m.includes('sem_total')) return 'Não achei a linha "Total:" neste PDF.';
  if (m.includes('total_diurnas_ilegivel')) return 'A linha "Total:" existe, mas o total de diurnas não está legível.';
  if (m.includes('sem_texto')) return 'Este PDF não tem texto — parece ser digitalizado (imagem).';
  if (m.includes('sem_descompressor')) return 'Este navegador não consegue abrir o PDF. Use Chrome, Edge ou Firefox atualizados.';
  if (m.includes('entrada_invalida')) return 'Arquivo inválido.';
  return 'Não consegui ler este PDF: ' + m;
}
