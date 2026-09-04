// ═══════════════════════════════════════════════════════════
// PLANILHA — ler .xlsx no navegador
// ═══════════════════════════════════════════════════════════
// A parte perigosa é o ZIP, não o XML. Um offset errado não estoura: ele lê
// bytes de outro arquivo e devolve texto que quase parece certo — ou uma
// planilha vazia, que a tela mostra como "nenhuma presença encontrada".
//
// Por isso o teste monta um .xlsx DE VERDADE em memória, com o mesmo formato
// que o Excel escreve, e lê de volta. Sem isso, uma mutação que trocasse os
// tamanhos do cabeçalho local pelos do diretório central passava batida — e é
// exatamente o bug que o leitor do Node já teve.
//
// O zip é montado com método 0 (stored, sem compressão) porque o que está sob
// teste são os OFFSETS, não o deflate. E stored é formato válido: o Excel usa
// para arquivos pequenos.

import { grupo, teste, ok, igual } from './runner.mjs';
import { abrirZip, lerSharedStrings, lerEstilosDeData, lerLinhas, serialParaISO } from '../js/planilha.js';

// ── um .xlsx mínimo, montado à mão ────────────────────────────────────────
function crc32(bytes) {
  let c, tabela = crc32.t;
  if (!tabela) {
    tabela = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
  }
  c = -1;
  for (const b of bytes) c = tabela[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function montarZip(arquivos) {
  const te = new TextEncoder();
  const partes = [], centrais = [];
  let offset = 0;

  for (const [nome, texto] of Object.entries(arquivos)) {
    const dados = te.encode(texto);
    const nb = te.encode(nome);
    const crc = crc32(dados);

    // Cabeçalho LOCAL — com um campo `extra` de 4 bytes, que é justamente o que
    // separa os tamanhos locais dos do diretório central. Sem ele a mutação que
    // troca um pelo outro passaria despercebida.
    const extraLocal = new Uint8Array([0x55, 0x54, 0x00, 0x00]);
    const local = new Uint8Array(30 + nb.length + extraLocal.length + dados.length);
    const dvL = new DataView(local.buffer);
    dvL.setUint32(0, 0x04034b50, true);
    dvL.setUint16(4, 20, true);
    dvL.setUint16(8, 0, true);            // método 0 = stored
    dvL.setUint32(14, crc, true);
    dvL.setUint32(18, dados.length, true);
    dvL.setUint32(22, dados.length, true);
    dvL.setUint16(26, nb.length, true);
    dvL.setUint16(28, extraLocal.length, true);
    local.set(nb, 30);
    local.set(extraLocal, 30 + nb.length);
    local.set(dados, 30 + nb.length + extraLocal.length);

    // Cabeçalho CENTRAL — SEM o campo extra, de propósito.
    const central = new Uint8Array(46 + nb.length);
    const dvC = new DataView(central.buffer);
    dvC.setUint32(0, 0x02014b50, true);
    dvC.setUint16(10, 0, true);
    dvC.setUint32(16, crc, true);
    dvC.setUint32(20, dados.length, true);
    dvC.setUint32(24, dados.length, true);
    dvC.setUint16(28, nb.length, true);
    dvC.setUint16(30, 0, true);
    dvC.setUint32(42, offset, true);
    central.set(nb, 46);

    partes.push(local);
    centrais.push(central);
    offset += local.length;
  }

  const inicioCentral = offset;
  const tamCentral = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const dvF = new DataView(fim.buffer);
  dvF.setUint32(0, 0x06054b50, true);
  dvF.setUint16(8, centrais.length, true);
  dvF.setUint16(10, centrais.length, true);
  dvF.setUint32(12, tamCentral, true);
  dvF.setUint32(16, inicioCentral, true);

  const total = [...partes, ...centrais, fim];
  const saida = new Uint8Array(total.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const parte of total) { saida.set(parte, p); p += parte.length; }
  return saida;
}

const SHARED = `<?xml version="1.0"?><sst>
  <si><t>Cliente</t></si><si><t>Tipo</t></si><si><t>Data</t></si>
  <si><t>Ana Paula</t></si><si><t>Acesso</t></si>
</sst>`;

const STYLES = `<styleSheet>
  <numFmts><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>
           <numFmt numFmtId="166" formatCode="[Red]#,##0.00"/></numFmts>
  <cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs>
</styleSheet>`;

const SHEET = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="0"/><c r="C2" t="s"><v>4</v></c></row>
  <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="2"><v>-1250.5</v></c><c r="C3" s="1"><v>46265.75</v></c></row>
</sheetData></worksheet>`;

grupo('planilha · o zip', () => {
  const bytes = montarZip({
    'xl/sharedStrings.xml': SHARED,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': SHEET,
  });

  teste('lê os três arquivos de volta, inteiros', async () => {
    // Offset errado não estoura: devolve bytes de outro arquivo. O teste
    // compara o texto inteiro, não só o começo.
    const zip = await abrirZip(bytes);
    igual(Object.keys(zip).sort().join(','),
      'xl/sharedStrings.xml,xl/styles.xml,xl/worksheets/sheet1.xml');
    igual(zip['xl/worksheets/sheet1.xml'], SHEET, 'o conteúdo tem que voltar byte a byte');
    igual(zip['xl/sharedStrings.xml'], SHARED);
  });

  teste('usa os tamanhos do cabeçalho LOCAL, não os do central', async () => {
    // O zip acima tem `extra` de 4 bytes só no local. Usar o tamanho do
    // central (zero) deslocaria a leitura em 4 bytes e o XML viria truncado
    // pela frente — que é o bug que o leitor do Node já teve.
    const zip = await abrirZip(bytes);
    ok(zip['xl/styles.xml'].startsWith('<styleSheet>'),
      'começou no lugar errado: ' + zip['xl/styles.xml'].slice(0, 20));
  });

  teste('arquivo que não é zip dá erro nomeado', async () => {
    let erro = null;
    try { await abrirZip(new TextEncoder().encode('isto é um pdf, não um xlsx')); }
    catch (e) { erro = e; }
    ok(erro, 'tem que estourar');
    igual(erro.message, 'arquivo_nao_e_xlsx');
  });
});

grupo('planilha · as células', () => {
  teste('célula vazia AUTOFECHADA não rouba o valor da seguinte', () => {
    // <c r="B2" s="0"/> — sem a alternativa no regex, o </c> casado era o da
    // próxima célula preenchida e o valor dela ia parar na coluna errada,
    // deslocando a linha inteira em silêncio.
    const linhas = lerLinhas(SHEET, lerSharedStrings(SHARED), lerEstilosDeData(STYLES));
    igual(linhas[1].celulas[0], 'Ana Paula');
    igual(linhas[1].celulas[1], null, 'a vazia continua vazia');
    igual(linhas[1].celulas[2], 'Acesso', 'e a seguinte mantém o valor dela');
  });

  teste('[Red] não transforma moeda em data', () => {
    // O "d" de "Red" casava com /[dmy]/ e marcava o formato como data — toda
    // moeda com negativo em vermelho virava uma coluna de datas.
    const ehData = lerEstilosDeData(STYLES);
    igual(ehData[2], false, 'o estilo do [Red] não pode ser data');
    igual(ehData[1], true, 'e o dd/mm/yyyy tem que ser');
    const linhas = lerLinhas(SHEET, lerSharedStrings(SHARED), ehData);
    igual(linhas[2].celulas[1], -1250.5, 'o valor tem que continuar número');
  });

  teste('a hora sobrevive ao serial', () => {
    // A parte fracionária diz qual estagiário estava na sala. Descartá-la
    // perderia metade da informação de cada presença.
    igual(serialParaISO(46265), '2026-08-31');
    igual(serialParaISO(46265.75), '2026-08-31 18:00');
    const linhas = lerLinhas(SHEET, lerSharedStrings(SHARED), lerEstilosDeData(STYLES));
    igual(linhas[2].celulas[2], '2026-08-31 18:00');
  });

  teste('o epoch é 30/12/1899, e é o que faz as datas modernas baterem', () => {
    // O Excel conta 1900 como bissexto — bug que a Microsoft manteve por
    // compatibilidade com o Lotus 1-2-3. O offset de 30/12/1899 absorve o dia
    // fantasma, e por isso vale de 01/03/1900 em diante; antes disso ele erra
    // em um dia, e ninguém se importa. Datas de negócio estão todas depois.
    igual(serialParaISO(46265), '2026-08-31');
    igual(serialParaISO(46266), '2026-09-01', 'um dia adiante é um dia adiante');
    igual(serialParaISO(45658), '2025-01-01');
    // Um epoch de 31/12/1899 (o "certo") jogaria tudo um dia para frente.
    ok(serialParaISO(46265) !== '2026-09-01');
  });
});
