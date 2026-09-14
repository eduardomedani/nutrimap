// ═══════════════════════════════════════════════════════════
// MONTAR O www/ — o pacote que a casca Android carrega
// ═══════════════════════════════════════════════════════════
// Gera `nativo/www/` a partir de CÓPIAS dos arquivos do site. Nada aqui edita
// o repositório publicado: `app.html` e `js/supabase.js` continuam byte a byte
// como estão na Vercel. É essa a regra que permite mexer no app nativo sem
// arriscar produção.
//
// O QUE ELE RESOLVE, e é o motivo de existir: hoje o app baixa três coisas da
// internet para abrir — supabase-js (esm.sh), lucide (unpkg, em `@latest`) e a
// fonte Inter (Google Fonts). Num navegador o service worker disfarça; dentro
// de um app instalado, sem rede isso é a diferença entre abrir e não abrir. As
// três entram no pacote, e o `www/` não pode conter NENHUMA URL externa — o
// próprio script confere isso no fim e falha se encontrar.
//
// O grafo de módulos é DESCOBERTO, não listado: começa em js/paciente-ui.js e
// segue os imports. Uma lista escrita à mão envelheceria no primeiro módulo
// novo, e o sintoma seria uma tela branca no aparelho.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const AQUI = dirname(fileURLToPath(import.meta.url));
const NATIVO = dirname(AQUI);
const RAIZ = dirname(NATIVO);
const WWW = join(NATIVO, 'www');
const MOD = join(NATIVO, 'node_modules');

const ler = (p) => readFileSync(p, 'utf8');
const gravar = (p, txt) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt, 'utf8'); };
const copiar = (de, para) => { mkdirSync(dirname(para), { recursive: true }); cpSync(de, para, { recursive: true }); };

// ── 1. pasta limpa ─────────────────────────────────────────
// Refeita do zero: sobra de uma execução anterior é justamente o arquivo que
// ninguém lembra de conferir.
if (existsSync(WWW)) rmSync(WWW, { recursive: true });
mkdirSync(WWW, { recursive: true });

// ── 2. o grafo de módulos do app do aluno ──────────────────
const IMPORTA = /(?:from|import)\s*\(?\s*['"](\.\/[a-z0-9._-]+\.js)['"]/gi;

function grafo(entrada) {
  const vistos = new Set();
  const fila = [entrada];
  while (fila.length) {
    const arq = fila.pop();
    if (vistos.has(arq)) continue;
    vistos.add(arq);
    const txt = ler(join(RAIZ, 'js', arq));
    for (const [, rel] of txt.matchAll(IMPORTA)) fila.push(rel.replace('./', ''));
  }
  return [...vistos].sort();
}

const modulos = grafo('paciente-ui.js');

// ── 3. os módulos, com o supabase apontando para o pacote local ──
for (const m of modulos) {
  let txt = ler(join(RAIZ, 'js', m));
  if (m === 'supabase.js') {
    const antes = txt;
    txt = txt.replace(
      "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
      "import { createClient } from '../vendor/supabase.js';   // vendorado — ver nativo/scripts/montar-web.mjs",
    );
    if (txt === antes) throw new Error('supabase.js mudou de forma: o import do esm.sh não casou');
  }
  gravar(join(WWW, 'js', m), txt);
}

// ── 4. o HTML, com as três dependências externas trocadas ──
let html = ler(join(RAIZ, 'app.html'));

const trocas = [
  // lucide: sai o unpkg (@latest, que muda sozinho), entra o UMD local
  [/<script src="https:\/\/unpkg\.com\/lucide@latest"><\/script>/,
   '<script src="vendor/lucide.js"></script>'],
  // fonte: saem os dois preconnect e a folha do Google, entra a folha local
  [/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*\n\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*\n\s*<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/,
   '<link rel="stylesheet" href="vendor/inter.css">'],
  // manifest e service worker: não existem na casca nativa. O SW chegaria a
  // registrar em https://localhost e passaria a servir versão cacheada por
  // baixo do app — um segundo canal de atualização que ninguém pediu.
  [/<link rel="manifest" href="manifest\.webmanifest">\n/, ''],
  [/\s*if \('serviceWorker' in navigator\) \{[\s\S]*?\n    \}\n/,
   '\n    // Service worker fora: na casca nativa os arquivos já são locais.\n'],
];

for (const [de, para] of trocas) {
  const antes = html;
  html = html.replace(de, para);
  if (html === antes) throw new Error(`troca no HTML não casou: ${de}`);
}
gravar(join(WWW, 'index.html'), html);

// ── 5. css e o que ele referencia ──────────────────────────
// SÓ as folhas que o app.html declara, e o que elas importarem. Copiar a pasta
// `css/` inteira levava junto o CSS do painel (financeiro, comercial…): peso
// morto no pacote e código de outra aplicação dentro do app do aluno.
const folhas = [...html.matchAll(/<link rel="stylesheet" href="(css\/[a-z0-9.-]+\.css)">/gi)].map((m) => m[1]);
if (!folhas.length) throw new Error('nenhuma folha de estilo encontrada no app.html');

const filaCss = [...folhas];
const cssCopiados = new Set();
while (filaCss.length) {
  const rel = filaCss.pop();
  if (cssCopiados.has(rel)) continue;
  const de = join(RAIZ, rel);
  if (!existsSync(de)) throw new Error(`o app.html referencia ${rel}, que não existe`);
  cssCopiados.add(rel);
  copiar(de, join(WWW, rel));
  // @import dentro da folha entra na fila — uma folha que importa outra não
  // pode ficar pela metade no pacote.
  for (const [, imp] of ler(de).matchAll(/@import\s+(?:url\()?['"]([^'")]+\.css)['"]/gi)) {
    filaCss.push(join(dirname(rel), imp).replace(/\\/g, '/'));
  }
}

// Ícones e imagens citados pelo HTML ou pelo CSS, se existirem no repositório.
const citados = new Set();
const textos = [html, ...[...cssCopiados].map((rel) => ler(join(WWW, rel)))];
for (const txt of textos) {
  for (const [, ref] of txt.matchAll(/(?:href|src)="([a-z0-9][^":?#]*\.(?:png|svg|ico|jpg|webp))"/gi)) citados.add(ref);
  for (const [, ref] of txt.matchAll(/url\(['"]?((?!data:|https?:)[^)'"]+\.(?:png|svg|woff2?|jpg|webp))['"]?\)/gi)) citados.add(ref);
}
for (const ref of citados) {
  const de = join(RAIZ, ref);
  if (existsSync(de)) copiar(de, join(WWW, ref));
}

// ── 6. vendor: supabase (bundle), lucide (umd), Inter (woff2) ──
await build({
  stdin: {
    contents: "export { createClient } from '@supabase/supabase-js';",
    resolveDir: NATIVO,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: join(WWW, 'vendor', 'supabase.js'),
});

copiar(join(MOD, 'lucide', 'dist', 'umd', 'lucide.min.js'), join(WWW, 'vendor', 'lucide.js'));

// A Inter, só nos pesos que o CSS usa. Puxar a família inteira levaria dezenas
// de arquivos que ninguém pede.
const PESOS = ['400', '500', '600', '700', '800'];
const fonteCss = PESOS.map((p) => {
  const arq = `inter-latin-${p}-normal.woff2`;
  copiar(join(MOD, '@fontsource', 'inter', 'files', arq), join(WWW, 'vendor', 'fontes', arq));
  return `@font-face{font-family:'Inter';font-style:normal;font-weight:${p};font-display:swap;` +
         `src:url('fontes/${arq}') format('woff2');}`;
}).join('\n');
gravar(join(WWW, 'vendor', 'inter.css'), fonteCss + '\n');

// ── 7. a guarda: nada é BAIXADO para o app abrir ───────────
// É esta conferência que separa "vendorado" de "achei que estava vendorado".
//
// A primeira versão procurava qualquer `https://` em qualquer arquivo e acusou
// oito coisas que não são dependência nenhuma: o namespace de SVG
// (`www.w3.org`) dentro do lucide, o link do WhatsApp que o usuário TOCA, e
// endereços dentro de mensagens de erro do bundle do Supabase. Procurar texto
// não responde à pergunta. O que importa é o que a PÁGINA CARREGA:
//
//   HTML   src= / href=            apontando para fora
//   CSS    url(...) e @import      apontando para fora
//   JS     import ... from 'http'  e import('http')
//
// O endereço do Supabase não entra nesta conta: ele é o backend, chamado por
// fetch em tempo de uso, e não algo que a página baixa para abrir.
function arquivos(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

const CARREGAMENTO = [
  [/\.html?$/i, /(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi],
  [/\.css$/i,   /(?:url\(\s*["']?|@import\s+(?:url\(\s*)?["'])https?:\/\/[^"')]+/gi],
  [/\.js$/i,    /(?:from|import)\s*\(?\s*["']https?:\/\/[^"']+/gi],
];

const achados = [];
for (const p of arquivos(WWW)) {
  for (const [ext, padrao] of CARREGAMENTO) {
    if (!ext.test(p)) continue;
    for (const [trecho] of ler(p).matchAll(padrao)) {
      achados.push(`${relative(WWW, p)}: ${trecho.trim().slice(0, 90)}`);
    }
  }
}

const nArquivos = arquivos(WWW).length;
const mb = (arquivos(WWW).reduce((s, p) => s + statSync(p).size, 0) / 1048576).toFixed(2);

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  www/ montado                                        ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`  módulos do aluno ....... ${modulos.length}`);
console.log(`  arquivos no pacote ..... ${nArquivos}`);
console.log(`  tamanho ................ ${mb} MB`);
console.log(`  URLs externas .......... ${achados.length}`);
for (const a of achados) console.log(`     ✕ ${a}`);

if (achados.length) {
  console.error('\n  ✕ o pacote ainda depende da internet para abrir — corrija antes de sincronizar');
  process.exit(1);
}
console.log('\n  ✓ nenhuma dependência externa de carregamento');
