// ═══════════════════════════════════════════════════════════
// CONCILIAÇÃO — as vendas duvidosas contra o extrato bancário
// ═══════════════════════════════════════════════════════════
// Uso:  node db/conciliar_vendas_duvidosas.mjs "pasta/dos/Extratos"
//
// Lê db/vendas_duvidosas.csv (gerado por db/gerador_vendas_duvidosas.mjs) e
// procura, nos arquivos OFX do banco, um CRÉDITO do mesmo valor perto da data.
//
// O QUE UM ACHADO PROVA, E O QUE NÃO PROVA:
//
//   sem crédito compatível  -> evidência FORTE de que o dinheiro não entrou.
//                              Nenhum crédito daquele valor, em nenhum dia
//                              próximo, em nenhuma das contas.
//   com crédito compatível  -> evidência FRACA de que entrou. Mensalidade de
//                              R$ 270 é valor comum: o crédito encontrado pode
//                              ser de outro cliente. Serve para PRIORIZAR o que
//                              conferir à mão, não para dar baixa.
//
// Por isso a saída separa os dois grupos em vez de dizer "conferido".
//
// A janela é de ±7 dias porque a data da planilha é a da VENDA, e o dinheiro
// cai depois — no Pix quase junto, no boleto e no cartão dias depois.
//
// A saída não é versionada: traz nome de cliente. Ver .gitignore.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const JANELA_DIAS = 7;

/** Toda transação de um OFX, como { data, valor, memo }. */
export function lerOfx(texto) {
  const saida = [];
  for (const m of String(texto).matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g)) {
    const bloco = m[1];
    const pega = tag => {
      const r = new RegExp('<' + tag + '>([^<\\r\\n]*)').exec(bloco);
      return r ? r[1].trim() : '';
    };
    const dt = pega('DTPOSTED').slice(0, 8);
    const valor = Number(pega('TRNAMT'));
    if (!/^\d{8}$/.test(dt) || !Number.isFinite(valor)) continue;
    saida.push({
      data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      valor,
      memo: (pega('MEMO') || pega('NAME')).slice(0, 60),
    });
  }
  return saida;
}

export function diasEntre(a, b) {
  const d = (s) => new Date(s + 'T00:00:00').getTime();
  return Math.round(Math.abs(d(a) - d(b)) / 86400000);
}

/** Créditos compatíveis: mesmo valor (ao centavo) e dentro da janela. */
export function candidatos(linha, transacoes, janela = JANELA_DIAS) {
  const alvo = Math.round(linha.valor * 100);
  return transacoes.filter(t =>
    t.valor > 0 &&
    Math.round(t.valor * 100) === alvo &&
    diasEntre(t.data, linha.data) <= janela
  );
}

function todosOsOfx(pasta) {
  const arquivos = [];
  const andar = p => {
    for (const nome of readdirSync(p)) {
      const cheio = join(p, nome);
      if (statSync(cheio).isDirectory()) andar(cheio);
      else if (/\.ofx$/i.test(nome)) arquivos.push(cheio);
    }
  };
  andar(pasta);
  return arquivos;
}

if (process.argv[1] && process.argv[1].endsWith('conciliar_vendas_duvidosas.mjs')) {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error('Uso: node db/conciliar_vendas_duvidosas.mjs "pasta/dos/Extratos"');
    process.exit(1);
  }

  const csv = readFileSync(resolve(AQUI, 'vendas_duvidosas.csv'), 'utf8').trim().split('\n').slice(1);
  const linhas = csv.map(l => {
    // linha_da_planilha,data,"nome",pacote,valor,conferido
    const m = l.match(/^(\d+),([\d-]*),"([^"]*)",([^,]*),([\d.,]*),/);
    if (!m) return null;
    return {
      linha: +m[1],
      data: m[2],
      nome: m[3],
      pacote: m[4],
      valor: Number(m[5].replace(/\./g, '').replace(',', '.')),
    };
  }).filter(Boolean);

  const arquivos = todosOsOfx(pasta);
  const transacoes = [];
  for (const a of arquivos) {
    try { transacoes.push(...lerOfx(readFileSync(a, 'latin1'))); }
    catch (e) { console.error('  nao consegui ler', a, '-', e.message); }
  }

  const creditos = transacoes.filter(t => t.valor > 0);
  const datas = creditos.map(t => t.data).sort();
  console.log(arquivos.length + ' arquivos OFX, ' + transacoes.length + ' transações, '
    + creditos.length + ' créditos');
  console.log('cobertura: ' + (datas[0] || '?') + ' a ' + (datas[datas.length - 1] || '?'));

  // Cobertura é por MÊS, não pelo intervalo entre o primeiro e o último
  // crédito. A pasta tem buracos — 2024 só vai até maio —, e uma linha caída
  // num mês ausente apareceria como "sem crédito" quando o certo é "sem
  // extrato". A diferença importa: um diz que o dinheiro não entrou, o outro
  // diz que não dá para saber.
  const meses = new Set(creditos.map(t => t.data.slice(0, 7)));
  const cobre = d => !!d && meses.has(d.slice(0, 7));
  console.log('meses com extrato: ' + [...meses].sort().join(', '));

  const semExtrato = linhas.filter(l => !cobre(l.data));
  const noPeriodo = linhas.filter(l => cobre(l.data));
  const achadas = noPeriodo.filter(l => candidatos(l, creditos).length > 0);
  const naoAchadas = noPeriodo.filter(l => candidatos(l, creditos).length === 0);

  const brl = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soma = l => Math.round(l.reduce((s, r) => s + r.valor * 100, 0)) / 100;

  console.log('\n=== RESULTADO ===');
  console.log('fora do período dos extratos: ' + semExtrato.length + ' — R$ ' + brl(soma(semExtrato)));
  console.log('com crédito compatível:       ' + achadas.length + ' — R$ ' + brl(soma(achadas))
    + '   (plausível; confira à mão)');
  console.log('SEM crédito compatível:       ' + naoAchadas.length + ' — R$ ' + brl(soma(naoAchadas))
    + '   (provavelmente não entrou)');

  const linhasCsv = ['linha_da_planilha,data,nome,pacote,valor,situacao,creditos_no_extrato'];
  for (const l of linhas) {
    const c = cobre(l.data) ? candidatos(l, creditos) : null;
    const situacao = c === null ? 'fora do periodo dos extratos'
      : c.length ? 'credito compativel encontrado' : 'SEM credito compativel';
    linhasCsv.push([
      l.linha, l.data, '"' + l.nome.split('"').join('""') + '"', l.pacote,
      l.valor.toFixed(2).replace('.', ','), situacao,
      '"' + (c || []).map(x => x.data + ' ' + x.memo).join(' | ').split('"').join('""') + '"',
    ].join(','));
  }
  writeFileSync(resolve(AQUI, 'vendas_conciliadas.csv'), linhasCsv.join('\n') + '\n', 'utf8');
  console.log('\nDetalhe em db/vendas_conciliadas.csv (fora do git).');
}
