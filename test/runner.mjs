// ═══════════════════════════════════════════════════════════
// Runner de testes — sem dependência, como o resto do projeto
// ═══════════════════════════════════════════════════════════
// Os arquivos .test.mjs registram com `teste()`; test/run.mjs importa todos e
// chama `rodar()`. Falha imprime o que esperava, o que veio e de onde.

const _testes = [];
let _grupo = '';

export function grupo(nome, fn) {
  const anterior = _grupo;
  _grupo = nome;
  fn();
  _grupo = anterior;
}

export function teste(nome, fn) {
  _testes.push({ grupo: _grupo, nome, fn });
}

// ── Asserções ───────────────────────────────────────────────
class FalhaTeste extends Error {}

export function ok(cond, msg = 'esperava verdadeiro') {
  if (!cond) throw new FalhaTeste(msg);
}

export function igual(recebido, esperado, msg = '') {
  const a = JSON.stringify(recebido), b = JSON.stringify(esperado);
  if (a !== b) throw new FalhaTeste(`${msg}\n      esperado: ${b}\n      recebido: ${a}`);
}

/** Comparação de número com tolerância — macro é ponto flutuante. */
export function perto(recebido, esperado, tolerancia = 1e-9, msg = '') {
  const d = Math.abs(Number(recebido) - Number(esperado));
  if (!(d <= tolerancia)) {
    throw new FalhaTeste(`${msg}\n      esperado: ${esperado} (±${tolerancia})\n      recebido: ${recebido}`);
  }
}

export function contem(texto, trecho, msg = '') {
  if (!String(texto).includes(trecho)) {
    throw new FalhaTeste(`${msg}\n      não encontrou: ${JSON.stringify(trecho)}\n      em: ${String(texto).slice(0, 220)}...`);
  }
}

export function naoContem(texto, trecho, msg = '') {
  if (String(texto).includes(trecho)) {
    throw new FalhaTeste(`${msg}\n      não devia conter: ${JSON.stringify(trecho)}`);
  }
}

export async function lanca(fn, msg = 'esperava que lançasse') {
  try { await fn(); } catch (e) { return e; }
  throw new FalhaTeste(msg);
}

// ── Execução ────────────────────────────────────────────────
export async function rodar() {
  const inicio = Date.now();
  let passou = 0;
  const falhas = [];
  let grupoAtual = null;

  for (const t of _testes) {
    if (t.grupo !== grupoAtual) {
      grupoAtual = t.grupo;
      console.log(`\n  ${grupoAtual}`);
    }
    try {
      await t.fn();
      passou++;
      console.log(`    ok   ${t.nome}`);
    } catch (e) {
      falhas.push({ ...t, erro: e });
      console.log(`    FALHOU  ${t.nome}`);
    }
  }

  const ms = Date.now() - inicio;
  console.log('');
  if (falhas.length) {
    console.log('  ─────────────────────────────────────────────');
    for (const f of falhas) {
      console.log(`\n  FALHOU: ${f.grupo} › ${f.nome}`);
      console.log(`    ${f.erro.message}`);
      if (!(f.erro instanceof FalhaTeste)) console.log(`    ${f.erro.stack?.split('\n')[1]?.trim() || ''}`);
    }
    console.log(`\n  ${passou} passaram, ${falhas.length} falharam  (${ms} ms)\n`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ${passou} testes passaram (${ms} ms)\n`);
  return true;
}
