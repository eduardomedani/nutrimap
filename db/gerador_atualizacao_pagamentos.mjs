// ===========================================================================
// Evollo · GERADOR DA ATUALIZAÇÃO DE PAGAMENTOS
// ---------------------------------------------------------------------------
// Compara a planilha "Vendas" exportada em CSV com o que os seeds do
// repositório já mandaram para o banco, e escreve três coisas:
//
//   db/comercial_atualizar_pagamentos.sql           (+ _LIMPO)
//   db/comercial_atualizar_pagamentos_desfazer.sql  (+ _LIMPO)
//   o levantamento no terminal
//
// USO:
//   node db/gerador_atualizacao_pagamentos.mjs "C:/.../Vendas.csv" [AAAA-MM-DD]
//
// A segunda opção é a data de referência ("hoje"). Ela é ARGUMENTO e não
// `new Date()` de propósito: rodar o gerador amanhã com a mesma planilha tem
// que produzir o mesmo SQL, senão não dá para revisar o diff.
//
// POR QUE ELE COMPARA COM O SEED E NÃO COM O BANCO. Este projeto roda com a
// anon-key e RLS; não há credencial de serviço no repositório, e não vai haver.
// Então o gerador lê `db/financeiro_vendas_seed.sql` — o que a importação de
// 05/08/2026 mandou — e db/comercial_clientes_seed.sql, e assume que o banco
// ainda está assim. Quem confirma isso é db/conferencia/91_comercial_estado_antes.sql,
// e cada UPDATE gerado carrega o estado esperado no WHERE. Se o banco andou, a
// linha não casa e nada é sobrescrito.
//
// O QUE O GERADOR DECIDE SOZINHO, e o que ele recusa:
//
//   renova           -> UM pagamento de valor cheio, com data já passada,
//                       posterior ao início do período gravado. A regra do
//                       período novo é a de js/comercial.js (renovar).
//   NÃO renova       -> parcela (valor abaixo de 70% do contratado, típico do
//                       trimestral dividido em três) e pagamento com data
//                       futura (parcela de cartão). Estes saem na lista de
//                       AMBÍGUOS, para a tela resolver com o histórico à vista.
//
// Adivinhar nesses dois casos custaria período errado em cliente real, que é
// pior que deixar a linha parada e visível.
// ===========================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

const CSV  = process.argv[2];
const HOJE = process.argv[3] || '2026-08-13';

if (!CSV) {
  console.error('uso: node db/gerador_atualizacao_pagamentos.mjs <caminho do CSV> [AAAA-MM-DD]');
  process.exit(1);
}

// ── as 15 receitas que a conciliação de 07/08/2026 devolveu para pendente ──
// Sem esta lista o gerador leria "banco diz pago, planilha diz pago" onde o
// banco na verdade já tinha voltado para pendente, e proporia o contrário do
// que db/vendas_sem_credito_no_extrato.sql decidiu.
const CONCILIADAS_PENDENTE = new Set([1019, 1031, 1042, 1043, 1065, 1088, 1232,
                                      1443, 1601, 1602, 1603, 1604, 1605, 1921, 1922]);

// ═══════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════

/** CSV do Google Sheets: campo entre aspas pode conter vírgula E quebra de
 *  linha — a planilha tem um nome de cliente com \n no meio. */
function parseCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const limpa = s => String(s || '').replace(/\s+/g, ' ').trim();
const semAcento = s => limpa(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function moeda(v) {
  const s = String(v ?? '').replace(/R\$/g, '').replace(/[\s\u00a0]/g, '').replace(/\./g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dataIso(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : null;
}

/** Uma linha por venda. `linha` é o número da linha NA PLANILHA (cabeçalho = 1),
 *  que é o que vira `origem_linha` no banco e o que torna tudo rastreável. */
function lerPlanilha() {
  const grade = parseCsv(readFileSync(CSV, 'utf8').replace(/^\uFEFF/, ''));
  return grade.slice(1)
    .filter(l => l.some(c => String(c).trim() !== ''))
    .map((l, i) => ({
      linha: i + 2,
      data: dataIso(l[0]),
      dataBruta: limpa(l[0]),
      nome: limpa(l[3]),
      pacote: limpa(l[4]),
      valor: moeda(l[5]),
      pago: limpa(l[8]).toLowerCase() === 'sim',
      pagoBruto: limpa(l[8]),
      forma: limpa(l[9]),
      obs: limpa(l[10]),
    }));
}

/** O que a importação de 05/08 mandou para o banco, lido do próprio seed. */
function lerSeedVendas() {
  const sql = readFileSync(join(RAIZ, 'db/financeiro_vendas_seed.sql'), 'utf8');
  const marca = /^\s*\(\d+, date '\d{4}-\d{2}-\d{2}',/gm;
  const pos = [];
  let m;
  while ((m = marca.exec(sql))) pos.push(m.index);
  const fim = sql.indexOf(') as v(linha', pos[pos.length - 1]);
  // `null::numeric` é como o gerador de vendas escreve valor ausente.
  const campo = /^\((\d+), date '(\d{4}-\d{2}-\d{2})', (NULL|'(?:[^']|'')*'), ([\d.]+|null::numeric|NULL), (true|false), (NULL|'(?:[^']|'')*'), (NULL|'(?:[^']|'')*')\)/;
  const txt = s => (s === 'NULL' ? '' : s.slice(1, -1).replace(/''/g, "'"));
  const out = [];
  for (let i = 0; i < pos.length; i++) {
    const bruto = sql.slice(pos[i], i + 1 < pos.length ? pos[i + 1] : fim).trim();
    const g = campo.exec(bruto);
    if (!g) throw new Error('linha do seed de vendas não reconhecida: ' + bruto.slice(0, 120));
    out.push({
      linha: Number(g[1]),
      data: g[2],
      nome: limpa(txt(g[3])),
      valor: /^[\d.]+$/.test(g[4]) ? Number(g[4]) : null,
      pago: g[5] === 'true',
      pacote: limpa(txt(g[6])),
    });
  }
  return out;
}

/** As assinaturas que db/comercial_clientes_seed.sql criou. */
function lerSeedClientes() {
  const sql = readFileSync(join(RAIZ, 'db/comercial_clientes_seed.sql'), 'utf8');
  const re = /^\s*\('((?:[^']|'')*)', (null|'[^']*'), '([^']*)', '(\w+)', '(\d{4}-\d{2}-\d{2})'::date, '(\d{4}-\d{2}-\d{2})'::date, ([\d.]+), '(\w+)', (null|'(?:[^']|'')*')\),?\s*$/gm;
  const out = [];
  let m;
  while ((m = re.exec(sql))) out.push({
    nome: m[1].replace(/''/g, "'"),
    plano: m[3], status: m[4],
    inicio: m[5], fim: m[6], valor: Number(m[7]),
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════
// AS REGRAS DO PERÍODO — cópia fiel de js/comercial.js
// ---------------------------------------------------------------
// Cópia, e não import, porque js/comercial.js é módulo de navegador e este é um
// utilitário de linha de comando. Se as duas divergirem, o teste
// test/vendas.test.mjs é o lugar de prender isso.
// ═══════════════════════════════════════════════════════════════
const DIA = 86400000;
const iso10 = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const comoData = v => {
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const somarDias = (iso, n) => iso10(new Date(comoData(iso).getTime() + n * DIA));
const diasEntre = (a, b) => Math.round((comoData(b).getTime() - comoData(a).getTime()) / DIA);

/** Dentro da tolerância, a renovação continua do término anterior; passando
 *  dela, começa na data do pagamento. */
function renovar(fimVigente, dataPagamento, duracao, tolerancia = 5) {
  const inicio = diasEntre(fimVigente, dataPagamento) <= tolerancia ? fimVigente : dataPagamento;
  return { inicio, fim: somarDias(inicio, duracao) };
}

const DURACAO = {
  'Diária': 1, 'Semanal': 7,
  'Mensal - 3x': 30, 'Mensal - 5x': 30,
  'Trimestral - 3x': 90, 'Trimestral - 5x': 90,
};

// ═══════════════════════════════════════════════════════════════
// FORMA DE PAGAMENTO — o rótulo da planilha não cabe na coluna
// ---------------------------------------------------------------
// `financeiro_lancamentos.forma_pagamento` tem CHECK com oito valores em
// minúscula (db/financeiro_despesas_etapa1.sql). A planilha escreve o rótulo
// comercial: PIX, DINHEIRO, ASAAS, TON, NEXTFIT.
//
// Os dois primeiros são forma de pagamento e viram 'pix' e 'dinheiro'. Os
// outros três NÃO são: ASAAS é gateway, TON é maquininha e NEXTFIT é o sistema
// da academia — cada um cobra por vários meios, e nenhum diz se a venda saiu no
// débito ou no crédito. Chutar 'credito' porque "maquininha costuma ser
// crédito" gravaria no banco uma informação que ninguém apurou.
//
// Então eles entram como 'outro' e o rótulo original vai para a observação: a
// coluna fica honesta e o dado da planilha não se perde.
//
// A importação anterior não preenchia esta coluna em nenhuma linha. As 2.177
// receitas antigas seguem com forma_pagamento nulo — só as novas têm.
const FORMA = {
  'pix': 'pix',
  'dinheiro': 'dinheiro',
};
const formaDaColuna = bruto => FORMA[semAcento(bruto)] ?? (limpa(bruto) ? 'outro' : null);
const formaNaObservacao = bruto => (limpa(bruto) && !FORMA[semAcento(bruto)] ? `forma: ${limpa(bruto)}` : '');

// ═══════════════════════════════════════════════════════════════
// COMPARAÇÃO
// ═══════════════════════════════════════════════════════════════
const planilha = lerPlanilha();
const seedVendas = lerSeedVendas();
const assinaturas = lerSeedClientes();
const porLinhaSeed = new Map(seedVendas.map(r => [r.linha, r]));

const mesmoValor = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005);

const novas = [];       // a planilha tem, o banco não
const paraPendente = []; // o banco tem como recebida, a planilha marca "Não"
const paraPago = [];     // o banco tem como pendente, a planilha marca "Sim"

for (const r of planilha) {
  const s = porLinhaSeed.get(r.linha);
  if (!s || !mesmoValor(s.valor, r.valor) || s.data !== r.data) {
    if (r.valor != null && r.data) novas.push(r);
    continue;
  }
  const pagoNoBanco = s.pago && !CONCILIADAS_PENDENTE.has(s.linha);
  if (pagoNoBanco && !r.pago) paraPendente.push(r);
  else if (!pagoNoBanco && r.pago) paraPago.push(r);
}
novas.sort((a, b) => a.linha - b.linha);
paraPendente.sort((a, b) => a.linha - b.linha);

// ── as assinaturas ───────────────────────────────────────────────
const MENSALIDADE = /^(mensal|trimestral|semestral|anual|semanal)/i;
const pagamentosPorCliente = new Map();
for (const r of planilha) {
  if (!r.data || !r.pago || !MENSALIDADE.test(r.pacote)) continue;
  const k = semAcento(r.nome);
  if (!pagamentosPorCliente.has(k)) pagamentosPorCliente.set(k, []);
  pagamentosPorCliente.get(k).push(r);
}
for (const l of pagamentosPorCliente.values()) l.sort((a, b) => a.data.localeCompare(b.data));

const renovacoes = [], ambiguas = [], paradas = [];

for (const a of assinaturas) {
  const lista = pagamentosPorCliente.get(semAcento(a.nome)) || [];
  const depois = lista.filter(p => p.data > a.inicio);
  if (!depois.length) {
    paradas.push({ ...a, ultimo: lista.length ? lista[lista.length - 1].data : null });
    continue;
  }

  const futuros = depois.filter(p => p.data > HOJE);
  const passados = depois.filter(p => p.data <= HOJE);
  const eParcela = p => a.valor > 0 && p.valor != null && p.valor < a.valor * 0.7;
  const parcelas = passados.filter(eParcela);
  const cheios = passados.filter(p => !eParcela(p));

  if (!passados.length || parcelas.length || futuros.length || cheios.length > 1) {
    ambiguas.push({ ...a, passados, futuros, parcelas, cheios });
    continue;
  }

  const dur = DURACAO[a.plano] ?? 30;
  const novo = renovar(a.fim, cheios[0].data, dur);
  renovacoes.push({ ...a, pagamento: cheios[0], novoInicio: novo.inicio, novoFim: novo.fim });
}
renovacoes.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

/**
 * Para cada linha de pagamento que renova alguém: o vencimento que a cobrança
 * DESSE período teria, que é o término do período vigente.
 *
 * Serve para o passo 1 perguntar, antes de inserir, "já existe cobrança em
 * aberto para este período?". Se existe, a venda da planilha e a cobrança são
 * a MESMA receita — lançar as duas conta o dinheiro duas vezes e ainda deixa
 * um pendente fantasma no contas a receber.
 */
const cobrancaDaLinha = new Map(renovacoes.map(x => [x.pagamento.linha, x.fim]));

// ── quem pagou e não tem assinatura ──────────────────────────────
// Lista revisada À MÃO, em db/comercial_clientes_novos.json (não versionado —
// nome de pessoa física, mesma regra dos outros seeds; veja o .gitignore).
//
// Ela não é derivada, e não deveria ser: o gerador sabe dizer QUEM pagou sem
// ter assinatura, mas não sabe com que plano nem por quanto a pessoa fechou —
// quem paga R$ 200 e R$ 192 no mesmo mês pode ter um mensal partido em dois ou
// um plano de R$ 200. Adivinhar isso grava valor contratado errado num
// contrato real. Sem o arquivo, o passo 4 simplesmente não sai.
//
// Formato: [{ "nome": "...", "plano": "Mensal - 5x", "valor": 385,
//             "inicio": "2026-07-06" }]
let SEM_ASSINATURA = [];
try {
  SEM_ASSINATURA = JSON.parse(readFileSync(join(RAIZ, 'db/comercial_clientes_novos.json'), 'utf8'));
} catch {
  console.log('sem db/comercial_clientes_novos.json — o passo 4 (criar assinatura) fica de fora.\n');
}
for (const n of SEM_ASSINATURA) {
  n.fim = somarDias(n.inicio, DURACAO[n.plano] ?? 30);
  const meus = planilha.filter(r => semAcento(r.nome) === semAcento(n.nome) && r.data === n.inicio && r.pago);
  n.linha = meus.length ? meus[meus.length - 1].linha : null;
}

// ═══════════════════════════════════════════════════════════════
// O LEVANTAMENTO
// ═══════════════════════════════════════════════════════════════
const real = n => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const soma = a => a.reduce((t, r) => t + (r.valor || 0), 0);
const brasil = iso => iso.split('-').reverse().join('/');

console.log(`\nplanilha: ${planilha.length} vendas | banco (seed): ${seedVendas.length} | referência: ${brasil(HOJE)}\n`);
console.log(`vendas que faltam lançar ......... ${String(novas.length).padStart(4)}  R$ ${real(soma(novas))}`);
console.log(`banco pago  -> planilha "Não" .... ${String(paraPendente.length).padStart(4)}  R$ ${real(soma(paraPendente))}`);
console.log(`banco pend. -> planilha "Sim" .... ${String(paraPago.length).padStart(4)}  R$ ${real(soma(paraPago))}`);
console.log(`\nassinaturas: ${assinaturas.length}`);
console.log(`  renovação limpa ................ ${String(renovacoes.length).padStart(4)}`);
console.log(`  ambíguas (ficam para a tela) ... ${String(ambiguas.length).padStart(4)}`);
console.log(`  sem pagamento novo ............. ${String(paradas.length).padStart(4)}  (${paradas.filter(a => diasEntre(HOJE, a.fim) < 0).length} vencidas hoje)`);
console.log(`  a criar ........................ ${String(SEM_ASSINATURA.length).padStart(4)}\n`);

if (ambiguas.length) {
  console.log('AMBÍGUAS — resolver em Comercial > cliente:');
  for (const a of ambiguas) {
    const por = [];
    if (a.parcelas.length) por.push(`${a.parcelas.length} parcela(s)`);
    if (a.futuros.length) por.push(`${a.futuros.length} com data futura`);
    if (a.cheios.length > 1) por.push(`${a.cheios.length} pagamentos cheios`);
    console.log(`  ${a.nome.padEnd(46)} ${a.plano.padEnd(16)} ${por.join(', ')}`);
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// O SQL
// ═══════════════════════════════════════════════════════════════
const q = s => (s == null || s === '' ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const SEM_ACENTO_SQL = [
  `translate(trim(%s),`,
  `             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',`,
  `             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')`,
].join('\n       ');

const emBloco = (nums, ind) => {
  const out = [];
  for (let i = 0; i < nums.length; i += 12) out.push(nums.slice(i, i + 12).join(', '));
  return out.map((l, i) => `${ind}${l}${i === out.length - 1 ? '' : ','}`).join('\n');
};

const OBSERVACAO = `a planilha marca Pago = Nao (revisao de ${brasil(HOJE)})`;

// ── o script de atualização ──────────────────────────────────────
const A = [];
const a = s => A.push(s);

a(`-- ===========================================================================`);
a(`-- Evollo · COMERCIAL — ATUALIZACAO DOS PAGAMENTOS ATE ${brasil(HOJE)}`);
a(`-- ---------------------------------------------------------------------------`);
a(`-- GERADO AUTOMATICAMENTE por db/gerador_atualizacao_pagamentos.mjs a partir`);
a(`-- da planilha "Vendas" exportada em CSV. NAO EDITE A MAO: ajuste a planilha`);
a(`-- e rode o gerador de novo.`);
a(`--`);
a(`-- CONFIRA ANTES: db/conferencia/91_comercial_estado_antes.sql tem que dizer`);
a(`-- "BANCO IGUAL AOS SEEDS". Este script foi escrito contra o estado que os`);
a(`-- seeds descrevem, e cada update leva o estado esperado no WHERE — se o banco`);
a(`-- andou, a linha simplesmente nao e tocada, em vez de sobrescrever o certo.`);
a(`--`);
a(`-- O QUE ELE FAZ, nesta ordem:`);
a(`--`);
a(`--   1. lanca as ${novas.length} vendas que a planilha tem e o banco nao — MENOS as que`);
a(`--      correspondem a uma cobranca ja aberta na tela, que sao quitadas no`);
a(`--      passo 3 em vez de viram receita nova`);
a(`--   2. devolve para pendente as ${paraPendente.length} receitas que o banco tem como`);
a(`--      recebidas e a planilha agora marca "Nao"`);
a(`--   3. anda o periodo de ${renovacoes.length} assinaturas e liga o pagamento a elas`);
a(`--   4. cria assinatura para ${SEM_ASSINATURA.length} clientes que pagaram e nao estavam no Comercial`);
a(`--`);
a(`-- O QUE ELE NAO FAZ, e por que:`);
a(`--`);
a(`--   as ${ambiguas.length} assinaturas ambiguas -> trimestral cobrado em parcelas mensais e`);
a(`--      pagamento de cartao com data futura nao dizem sozinhos onde o periodo`);
a(`--      termina. Ficam para a tela, com o historico a vista:`);
for (const x of ambiguas) a(`--      ${x.nome}`);
a(`--`);
a(`--   as ${paraPago.length} receitas que a conciliacao contra o extrato devolveu para`);
a(`--      pendente e a planilha agora marca "Sim" -> nenhum credito compativel`);
a(`--      apareceu em 42 arquivos OFX. Extrato e prova mais forte que planilha, e`);
a(`--      desfazer aquela conciliacao no automatico apagaria o unico registro de`);
a(`--      que ela aconteceu. Ver db/vendas_sem_credito_no_extrato.sql.`);
a(`--`);
a(`--   a proxima cobranca de cada assinatura renovada -> o seed do Comercial`);
a(`--      deliberadamente nao criou nenhuma, para ninguem ver conta a receber que`);
a(`--      nao conferiu. Crie pela tela: Comercial > cliente > Criar cobranca do`);
a(`--      periodo.`);
a(`--`);
a(`-- 100% RE-EXECUTAVEL. As vendas sao identificadas por origem_linha e as`);
a(`-- assinaturas pelo periodo esperado: rodar duas vezes nao duplica nem reanda.`);
a(`--`);
a(`-- Desfazer: db/comercial_atualizar_pagamentos_desfazer.sql`);
a(`-- Para colar no SQL Editor, use db/comercial_atualizar_pagamentos_LIMPO.sql`);
a(`-- ===========================================================================`);
a(``);
a(`do $atualiza$`);
a(`declare`);
a(`  v_dono   uuid;`);
a(`  v_plano  uuid;`);
a(`  v_pac    uuid;`);
a(`  v_ass    uuid;`);
a(`  v_cat    uuid;`);
a(`  v_cob    uuid;`);
a(`  v_n      int;`);
a(`  -- As linhas da planilha que NAO viram lancamento novo porque ja existe uma`);
a(`  -- cobranca em aberto para o mesmo periodo. Ver o passo 1.`);
a(`  v_resolvidas int[] := '{}';`);
a(`  v_quitadas   int   := 0;`);
a(`  v_vendas int := 0;`);
a(`  v_pend   int := 0;`);
a(`  v_renov  int := 0;`);
a(`  v_novas  int := 0;`);
a(`  r        record;`);
a(`begin`);
a(`  select o.proprietario_user_id into v_dono`);
a(`    from public.organizacoes o`);
a(`    join public.admins a on a.user_id = o.proprietario_user_id;`);
a(``);
a(`  if v_dono is null then`);
a(`    raise exception 'Nao encontrei a organizacao principal.';`);
a(`  end if;`);
a(``);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 1) AS ${novas.length} VENDAS QUE FALTAM`);
a(`  -- -----------------------------------------------------------`);
a(`  -- Mesmo formato do import anterior: origem 'vendas' e origem_linha com o`);
a(`  -- numero da linha na planilha. E o origem_linha que torna isto re-executavel`);
a(`  -- e que deixa qualquer linha rastreavel ate a celula que a originou.`);
a(`  --`);
a(`  -- Pagamento com data futura e parcela de cartao, e entra com a data que a`);
a(`  -- planilha da — igual as parcelas que ja estavam no import anterior.`);
a(`  --`);
a(`  -- FORMA DE PAGAMENTO: a coluna do banco tem CHECK com oito valores em`);
a(`  -- minuscula. PIX e DINHEIRO viram 'pix' e 'dinheiro'; ASAAS, TON e NEXTFIT`);
a(`  -- nao sao forma de pagamento — sao gateway, maquininha e sistema, e cada um`);
a(`  -- cobra por varios meios. Entram como 'outro', com o rotulo da planilha`);
a(`  -- guardado na observacao, em vez de virar um 'credito' que ninguem apurou.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  for r in`);
a(`    select * from (values`);
novas.forEach((v, i) => {
  const obs = [v.obs, formaNaObservacao(v.forma)].filter(Boolean).join(' · ');
  const venc = cobrancaDaLinha.get(v.linha);
  a(`    (${v.linha}, date '${v.data}', ${q(v.nome)}, ${v.valor.toFixed(2)}, ${q(v.pacote)}, ${q(formaDaColuna(v.forma))}, ${q(obs)}, ${venc ? `date '${venc}'` : 'null'})${i === novas.length - 1 ? '' : ','}`);
});
a(`    ) as t(linha, data, nome, valor, pacote, forma, obs, venc_cobranca)`);
a(`  loop`);
a(`    if exists (select 1 from public.financeiro_lancamentos`);
a(`                where nutri_id = v_dono and origem = 'vendas' and origem_linha = r.linha) then`);
a(`      continue;`);
a(`    end if;`);
a(``);
a(`    -- JA EXISTE COBRANCA EM ABERTO PARA ESTE PERIODO?`);
a(`    --`);
a(`    -- Se existe, esta venda da planilha e a MESMA receita que ela: inserir as`);
a(`    -- duas contaria o dinheiro duas vezes e deixaria um pendente fantasma no`);
a(`    -- contas a receber. A linha e anotada em v_resolvidas e o passo 3 QUITA a`);
a(`    -- cobranca que ja existe, em vez de criar outra ao lado.`);
a(`    --`);
a(`    -- A coluna venc_cobranca so vem preenchida nas linhas que renovam alguem;`);
a(`    -- nas outras nao ha periodo com que colidir.`);
a(`    if r.venc_cobranca is not null then`);
a(`      select l.id into v_cob`);
a(`        from public.financeiro_lancamentos l`);
a(`        join public.comercial_assinaturas a on a.id = l.assinatura_id`);
a(`        join public.pacientes p             on p.id = a.paciente_id`);
a(`       where l.nutri_id = v_dono`);
a(`         and l.status = 'pendente'`);
a(`         and l.vencimento = r.venc_cobranca`);
a(`         and lower(trim(p.nome)) = lower(trim(r.nome))`);
a(`       limit 1;`);
a(``);
a(`      if v_cob is not null then`);
a(`        v_resolvidas := v_resolvidas || r.linha;`);
a(`        continue;`);
a(`      end if;`);
a(`    end if;`);
a(``);
a(`    -- A categoria e o "Pacote" da planilha, como no import anterior. Grafia`);
a(`    -- nova cria categoria nova: fundir e decisao de quem le o balanco, e a`);
a(`    -- tela do Financeiro tem o botao para isso.`);
a(`    v_cat := null;`);
a(`    if coalesce(r.pacote, '') <> '' then`);
a(`      select id into v_cat from public.financeiro_categorias`);
a(`       where nutri_id = v_dono and tipo = 'receita' and lower(nome) = lower(r.pacote)`);
a(`       limit 1;`);
a(`      if v_cat is null then`);
a(`        insert into public.financeiro_categorias (nutri_id, nome, tipo, ordem)`);
a(`        values (v_dono, r.pacote, 'receita', 99)`);
a(`        returning id into v_cat;`);
a(`      end if;`);
a(`    end if;`);
a(``);
a(`    insert into public.financeiro_lancamentos`);
a(`      (nutri_id, tipo, data, competencia, descricao, valor, pago, status, pago_em,`);
a(`       forma_pagamento, categoria_id, observacoes, origem, origem_linha)`);
a(`    values`);
a(`      (v_dono, 'receita', r.data, date_trunc('month', r.data)::date, r.nome,`);
a(`       r.valor, true, 'pago', r.data,`);
a(`       nullif(r.forma, ''), v_cat, nullif(r.obs, ''), 'vendas', r.linha);`);
a(``);
a(`    v_vendas := v_vendas + 1;`);
a(`  end loop;`);
a(``);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 2) AS ${paraPendente.length} QUE VOLTAM PARA PENDENTE`);
a(`  -- -----------------------------------------------------------`);
a(`  -- O import leu "coluna Pago em branco" como recebido. A coluna foi`);
a(`  -- preenchida depois, e nestas ${paraPendente.length} a resposta e "Nao".`);
a(`  --`);
a(`  -- PENDENTE, NAO CANCELADO: a divida pode ter sido paga em dinheiro sem`);
a(`  -- registro, perdoada ou esquecida. 'pendente' diz "esta em aberto ate alguem`);
a(`  -- conferir", que e o que se sabe. Mesma regra da conciliacao de 07/08/2026.`);
a(`  --`);
a(`  -- O predicado e origem_linha, nunca campo derivado — em 05/08/2026 um`);
a(`  -- predicado escrito sobre observacoes marcou 82 receitas erradas.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  update public.financeiro_lancamentos`);
a(`     set status      = 'pendente',`);
a(`         pago        = false,`);
a(`         pago_em     = null,`);
a(`         observacoes = trim(both ' · ' from`);
a(`                         coalesce(observacoes, '') || ' · ${OBSERVACAO}')`);
a(`   where nutri_id = v_dono`);
a(`     and origem = 'vendas'`);
a(`     and status = 'pago'`);
a(`     and origem_linha in (`);
a(emBloco(paraPendente.map(r => r.linha), '           '));
a(`         );`);
a(`  get diagnostics v_pend = row_count;`);
a(``);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 3) AS ${renovacoes.length} ASSINATURAS QUE ANDAM`);
a(`  -- -----------------------------------------------------------`);
a(`  -- Cada uma tem UM pagamento de valor cheio, ja ocorrido, posterior ao inicio`);
a(`  -- do periodo gravado. O periodo novo sai da mesma regra da tela`);
a(`  -- (js/comercial.js, renovar): dentro da tolerancia de 5 dias a renovacao`);
a(`  -- continua do termino anterior; passando dela, comeca na data do pagamento.`);
a(`  --`);
a(`  -- O WHERE exige o periodo VELHO. Se alguem ja renovou pela tela, a linha nao`);
a(`  -- casa e fica como esta — este script nunca desanda o que a tela ja fez.`);
a(`  --`);
a(`  -- O pagamento tambem passa a APONTAR para a assinatura, com vencimento no`);
a(`  -- termino do periodo que ele quitou. E assim que o modulo liga caixa e`);
a(`  -- contrato: uma linha so, os dois papeis.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  for r in`);
a(`    select * from (values`);
renovacoes.forEach((x, i) => {
  a(`    (${q(x.nome)}, date '${x.inicio}', date '${x.fim}', date '${x.novoInicio}', date '${x.novoFim}', ${x.pagamento.linha}, date '${x.pagamento.data}', ${(x.pagamento.valor ?? 0).toFixed(2)}, ${q(formaDaColuna(x.pagamento.forma))})${i === renovacoes.length - 1 ? '' : ','}`);
});
a(`    ) as t(nome, de_inicio, de_fim, para_inicio, para_fim, linha, data_pag, valor_pag, forma_pag)`);
a(`  loop`);
a(`    select a.id, a.paciente_id into v_ass, v_pac`);
a(`      from public.comercial_assinaturas a`);
a(`      join public.pacientes p on p.id = a.paciente_id`);
a(`     where a.nutri_id = v_dono`);
a(`       and lower(trim(p.nome)) = lower(trim(r.nome))`);
a(`       and a.status in ('ativa', 'aguardando_inicio', 'pausada')`);
a(`     limit 1;`);
a(``);
a(`    if v_ass is null then`);
a(`      raise notice 'sem assinatura viva para %', r.nome;`);
a(`      continue;`);
a(`    end if;`);
a(``);
a(`    update public.comercial_assinaturas`);
a(`       set inicio_periodo = r.para_inicio,`);
a(`           fim_periodo    = r.para_fim,`);
a(`           status         = 'ativa'`);
a(`     where id = v_ass`);
a(`       and nutri_id = v_dono`);
a(`       and inicio_periodo = r.de_inicio`);
a(`       and fim_periodo    = r.de_fim;`);
a(`    get diagnostics v_n = row_count;`);
a(`    v_renov := v_renov + v_n;`);
a(``);
a(`    -- Sem o periodo velho no lugar, o pagamento tambem nao e religado: os dois`);
a(`    -- descrevem o mesmo fato, e separa-los criaria meia verdade.`);
a(`    if v_n = 1 then`);
a(`      if r.linha = any(v_resolvidas) then`);
a(`        -- JA HAVIA COBRANCA para este periodo (o passo 1 achou e nao inseriu a`);
a(`        -- venda). Ela e quitada com a data, o valor e a forma que a planilha`);
a(`        -- registra — que e exatamente o que a tela faria em`);
a(`        -- registrarPagamento(). Uma receita so, no lugar onde ela ja estava.`);
a(`        update public.financeiro_lancamentos`);
a(`           set status          = 'pago',`);
a(`               pago            = true,`);
a(`               pago_em         = r.data_pag,`);
a(`               valor_pago      = r.valor_pag,`);
a(`               forma_pagamento = coalesce(forma_pagamento, r.forma_pag),`);
a(`               observacoes     = trim(both ' · ' from`);
a(`                                   coalesce(observacoes, '') ||`);
a(`                                   ' · quitada pela planilha de vendas, linha ' || r.linha)`);
a(`         where nutri_id = v_dono`);
a(`           and assinatura_id = v_ass`);
a(`           and vencimento = r.de_fim`);
a(`           and status = 'pendente';`);
a(`        get diagnostics v_n = row_count;`);
a(`        v_quitadas := v_quitadas + v_n;`);
a(`      else`);
a(`        update public.financeiro_lancamentos`);
a(`           set assinatura_id = v_ass,`);
a(`               paciente_id   = coalesce(paciente_id, v_pac),`);
a(`               vencimento    = coalesce(vencimento, r.de_fim)`);
a(`         where nutri_id = v_dono`);
a(`           and origem = 'vendas'`);
a(`           and origem_linha = r.linha`);
a(`           and assinatura_id is null;`);
a(`      end if;`);
a(`    end if;`);
a(`  end loop;`);
a(``);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 4) OS ${SEM_ASSINATURA.length} CLIENTES QUE PAGARAM E NAO ESTAVAM NO COMERCIAL`);
a(`  -- -----------------------------------------------------------`);
a(`  -- O periodo comeca na data do ULTIMO pagamento de mensalidade da planilha.`);
a(`  -- Quem esta atrasado entra atrasado: e o que a planilha mostra, e inventar`);
a(`  -- um periodo em dia esconderia justamente o que precisa aparecer.`);
a(`  --`);
a(`  -- O plano e o valor de cada um vem de db/comercial_clientes_novos.json,`);
a(`  -- revisado a mao: quem paga a mensalidade partida em dois lancamentos entra`);
a(`  -- com o valor cheio, nao com a ultima parcela. Confira na tela.`);
a(`  --`);
a(`  -- O plano 'Semanal' nao existia no Comercial e e criado aqui, com 7 dias.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  if not exists (select 1 from public.comercial_planos`);
a(`                  where nutri_id = v_dono and lower(trim(nome)) = 'semanal') then`);
a(`    insert into public.comercial_planos`);
a(`      (nutri_id, nome, duracao_valor, duracao_unidade, tolerancia_dias, ativo, ordem)`);
a(`    values (v_dono, 'Semanal', 7, 'dia', 5, true, 6);`);
a(`  end if;`);
a(``);
a(`  for r in`);
a(`    select * from (values`);
SEM_ASSINATURA.forEach((n, i) => {
  a(`    (${q(n.nome)}, ${q(n.plano)}, ${n.valor.toFixed(2)}, date '${n.inicio}', date '${n.fim}', ${n.linha ?? 'null'})${i === SEM_ASSINATURA.length - 1 ? '' : ','}`);
});
a(`    ) as t(nome, plano, valor, inicio, fim, linha)`);
a(`  loop`);
a(`    select id into v_plano from public.comercial_planos`);
a(`     where nutri_id = v_dono and lower(trim(nome)) = lower(trim(r.plano)) limit 1;`);
a(``);
a(`    -- SEM ACENTO na busca do paciente. A planilha e o cadastro discordam no`);
a(`    -- acento de varios nomes, e comparar cru criaria um SEGUNDO cadastro da`);
a(`    -- mesma pessoa — o erro mais caro que este passo pode cometer.`);
a(`    select id into v_pac from public.pacientes`);
a(`     where nutri_id = v_dono`);
a(`       and lower(${SEM_ACENTO_SQL.replace('%s', 'nome')})`);
a(`         = lower(${SEM_ACENTO_SQL.replace('%s', 'r.nome')})`);
a(`     limit 1;`);
a(``);
a(`    if v_pac is null then`);
a(`      insert into public.pacientes (codigo, nutri_id, nome, status)`);
a(`      values (public.gerar_codigo_paciente(), v_dono, r.nome, 'ativo')`);
a(`      returning id into v_pac;`);
a(`    end if;`);
a(``);
a(`    if exists (select 1 from public.comercial_assinaturas`);
a(`                where paciente_id = v_pac`);
a(`                  and status in ('ativa', 'aguardando_inicio', 'pausada')) then`);
a(`      continue;`);
a(`    end if;`);
a(``);
a(`    insert into public.comercial_assinaturas`);
a(`      (nutri_id, paciente_id, plano_id, valor_contratado,`);
a(`       data_inicio_original, inicio_periodo, fim_periodo, status, renovacao_automatica)`);
a(`    values`);
a(`      (v_dono, v_pac, v_plano, r.valor, r.inicio, r.inicio, r.fim, 'ativa', true)`);
a(`    returning id into v_ass;`);
a(``);
a(`    v_novas := v_novas + 1;`);
a(``);
a(`    -- Vencimento no INICIO do periodo, nao no fim: nao havia cobranca anterior`);
a(`    -- para este cliente, entao o que se sabe e que o valor era devido no dia em`);
a(`    -- que o periodo comecou — e foi pago nesse dia.`);
a(`    if r.linha is not null then`);
a(`      update public.financeiro_lancamentos`);
a(`         set assinatura_id = v_ass,`);
a(`             paciente_id   = coalesce(paciente_id, v_pac),`);
a(`             vencimento    = coalesce(vencimento, r.inicio)`);
a(`       where nutri_id = v_dono`);
a(`         and origem = 'vendas'`);
a(`         and origem_linha = r.linha`);
a(`         and assinatura_id is null;`);
a(`    end if;`);
a(`  end loop;`);
a(``);
a(`  raise notice 'vendas lancadas: % | cobrancas que ja existiam e foram quitadas: % | devolvidas para pendente: % | assinaturas renovadas: % | assinaturas criadas: %',`);
a(`    v_vendas, v_quitadas, v_pend, v_renov, v_novas;`);
a(`end $atualiza$;`);
a(``);
a(``);
a(`-- ===========================================================================`);
a(`-- Conferencia. Esperado depois de rodar uma vez:`);
a(`--`);
a(`--   receitas de vendas ................ ate ${seedVendas.length + novas.length}`);
a(`--       ${seedVendas.length} que ja existiam + ${novas.length} novas, MENOS uma para cada cobranca que`);
a(`--       ja estava aberta na tela e foi quitada no lugar. O numero exato sai no`);
a(`--       RAISE NOTICE: "vendas lancadas" + "cobrancas que ja existiam".`);
a(`--   ultima linha importada ............ ${Math.max(...novas.map(r => r.linha), ...seedVendas.map(r => r.linha))}`);
a(`--   vendas pendentes .................. ${15 + paraPendente.length}`);
a(`--   assinaturas ....................... ${assinaturas.length + SEM_ASSINATURA.length}`);
a(`--   pagamentos ligados a assinatura ... ${renovacoes.length + SEM_ASSINATURA.filter(n => n.linha).length} mais as que ja estavam ligadas`);
a(`-- ===========================================================================`);
a(`select`);
a(`  (select count(*) from public.financeiro_lancamentos where origem = 'vendas')            as receitas_vendas,`);
a(`  (select max(origem_linha) from public.financeiro_lancamentos where origem = 'vendas')   as ultima_linha,`);
a(`  (select count(*) from public.financeiro_lancamentos`);
a(`    where origem = 'vendas' and status = 'pendente')                                      as vendas_pendentes,`);
a(`  (select count(*) from public.comercial_assinaturas)                                     as assinaturas,`);
a(`  (select count(*) from public.financeiro_lancamentos where assinatura_id is not null)    as pagamentos_ligados,`);
a(`  (select count(*) from public.comercial_assinaturas`);
a(`    where status = 'ativa' and fim_periodo < current_date)                                as vencidas_hoje;`);

// ── o script de desfazer ─────────────────────────────────────────
const D = [];
const d = s => D.push(s);

d(`-- ===========================================================================`);
d(`-- DESFAZER db/comercial_atualizar_pagamentos.sql`);
d(`-- ---------------------------------------------------------------------------`);
d(`-- GERADO AUTOMATICAMENTE por db/gerador_atualizacao_pagamentos.mjs, junto com`);
d(`-- o script que ele desfaz. Devolve o banco ao estado de antes.`);
d(`--`);
d(`-- O QUE ELE NAO DESFAZ, de proposito:`);
d(`--`);
d(`--   os pacientes criados no passo 4 -> apagar um paciente leva junto tudo o`);
d(`--      que estiver pendurado nele. As assinaturas saem; o cadastro fica, sem`);
d(`--      vinculo comercial, e nao atrapalha nada.`);
d(`--`);
d(`--   o plano 'Semanal' e as categorias de receita criadas -> uma linha de`);
d(`--      catalogo sem uso nao e sujeira que valha o risco de apagar.`);
d(`--`);
d(`-- Cada passo leva o estado esperado no WHERE: se voce ja mexeu na tela depois`);
d(`-- de rodar a atualizacao, a linha nao casa e este script deixa ela em paz.`);
d(`-- Para colar no SQL Editor, use db/comercial_atualizar_pagamentos_desfazer_LIMPO.sql`);
d(`-- ===========================================================================`);
d(``);
d(`do $desfaz$`);
d(`declare`);
d(`  v_dono uuid;`);
d(`  v_ass  uuid;`);
d(`  v_n    int;`);
d(`  v_1 int := 0; v_2 int := 0; v_3 int := 0; v_4 int := 0;`);
d(`  r      record;`);
d(`begin`);
d(`  select o.proprietario_user_id into v_dono`);
d(`    from public.organizacoes o`);
d(`    join public.admins a on a.user_id = o.proprietario_user_id;`);
d(``);
d(`  -- ═══ 4') as ${SEM_ASSINATURA.length} assinaturas criadas ═══`);
d(`  -- Primeiro: apagar a assinatura zera o assinatura_id do pagamento sozinho`);
d(`  -- (on delete set null), e assim o passo 1' encontra a linha limpa.`);
d(`  for r in`);
d(`    select * from (values`);
SEM_ASSINATURA.forEach((n, i) => d(`    (${q(n.nome)})${i === SEM_ASSINATURA.length - 1 ? '' : ','}`));
d(`    ) as t(nome)`);
d(`  loop`);
d(`    delete from public.comercial_assinaturas a`);
d(`     using public.pacientes p`);
d(`     where p.id = a.paciente_id`);
d(`       and a.nutri_id = v_dono`);
d(`       and lower(${SEM_ACENTO_SQL.replace('%s', 'p.nome')})`);
d(`         = lower(${SEM_ACENTO_SQL.replace('%s', 'r.nome')});`);
d(`    get diagnostics v_n = row_count;`);
d(`    v_4 := v_4 + v_n;`);
d(`  end loop;`);
d(``);
d(`  -- ═══ 3') as ${renovacoes.length} assinaturas que andaram ═══`);
d(`  for r in`);
d(`    select * from (values`);
renovacoes.forEach((x, i) => {
  d(`    (${q(x.nome)}, date '${x.inicio}', date '${x.fim}', date '${x.novoInicio}', date '${x.novoFim}', ${x.pagamento.linha})${i === renovacoes.length - 1 ? '' : ','}`);
});
d(`    ) as t(nome, de_inicio, de_fim, para_inicio, para_fim, linha)`);
d(`  loop`);
d(`    select a.id into v_ass`);
d(`      from public.comercial_assinaturas a`);
d(`      join public.pacientes p on p.id = a.paciente_id`);
d(`     where a.nutri_id = v_dono`);
d(`       and lower(trim(p.nome)) = lower(trim(r.nome))`);
d(`       and a.inicio_periodo = r.para_inicio`);
d(`       and a.fim_periodo    = r.para_fim`);
d(`     limit 1;`);
d(``);
d(`    if v_ass is null then continue; end if;`);
d(``);
d(`    update public.financeiro_lancamentos`);
d(`       set assinatura_id = null,`);
d(`           vencimento    = null`);
d(`     where nutri_id = v_dono`);
d(`       and origem = 'vendas'`);
d(`       and origem_linha = r.linha`);
d(`       and assinatura_id = v_ass;`);
d(``);
d(`    -- A cobranca que ja existia e foi QUITADA pela atualizacao volta a`);
d(`    -- pendente. O predicado e a marca que a propria atualizacao escreveu na`);
d(`    -- observacao: sem ela, este update alcancaria uma cobranca que voce`);
d(`    -- quitou na tela depois, e desfaria trabalho que nao e dele.`);
d(`    update public.financeiro_lancamentos`);
d(`       set status          = 'pendente',`);
d(`           pago            = false,`);
d(`           pago_em         = null,`);
d(`           valor_pago      = null,`);
d(`           observacoes     = nullif(trim(both ' · ' from`);
d(`                               regexp_replace(coalesce(observacoes, ''),`);
d(`                                 ' · quitada pela planilha de vendas, linha [0-9]+', '')), '')`);
d(`     where nutri_id = v_dono`);
d(`       and assinatura_id = v_ass`);
d(`       and vencimento = r.de_fim`);
d(`       and status = 'pago'`);
d(`       and observacoes like '%quitada pela planilha de vendas, linha %';`);
d(``);
d(`    update public.comercial_assinaturas`);
d(`       set inicio_periodo = r.de_inicio,`);
d(`           fim_periodo    = r.de_fim`);
d(`     where id = v_ass;`);
d(`    get diagnostics v_n = row_count;`);
d(`    v_3 := v_3 + v_n;`);
d(`  end loop;`);
d(``);
d(`  -- ═══ 2') as ${paraPendente.length} que voltaram para pendente ═══`);
d(`  -- Volta para 'pago' com pago_em = data, que e exatamente o que o import`);
d(`  -- tinha gravado. A observacao acrescentada pela atualizacao sai junto.`);
d(`  update public.financeiro_lancamentos`);
d(`     set status      = 'pago',`);
d(`         pago        = true,`);
d(`         pago_em     = data,`);
d(`         observacoes = nullif(trim(both ' · ' from`);
d(`                         replace(coalesce(observacoes, ''), ' · ${OBSERVACAO}', '')), '')`);
d(`   where nutri_id = v_dono`);
d(`     and origem = 'vendas'`);
d(`     and status = 'pendente'`);
d(`     and origem_linha in (`);
d(emBloco(paraPendente.map(r => r.linha), '           '));
d(`         );`);
d(`  get diagnostics v_2 = row_count;`);
d(``);
d(`  -- ═══ 1') as ${novas.length} vendas lancadas ═══`);
d(`  delete from public.financeiro_lancamentos`);
d(`   where nutri_id = v_dono`);
d(`     and origem = 'vendas'`);
d(`     and origem_linha in (`);
d(emBloco(novas.map(r => r.linha), '           '));
d(`         );`);
d(`  get diagnostics v_1 = row_count;`);
d(``);
d(`  raise notice 'vendas apagadas: % | devolvidas para pago: % | assinaturas recuadas: % | assinaturas removidas: %',`);
d(`    v_1, v_2, v_3, v_4;`);
d(`end $desfaz$;`);
d(``);
d(``);
d(`-- ===========================================================================`);
d(`-- Conferencia. Esperado: o retrato de antes da atualizacao.`);
d(`--   receitas de vendas ......... ${seedVendas.length}`);
d(`--   vendas pendentes ...........   15`);
d(`--   assinaturas ................ ${assinaturas.length}`);
d(`--   pagamentos ligados .........    0`);
d(`-- ===========================================================================`);
d(`select`);
d(`  (select count(*) from public.financeiro_lancamentos where origem = 'vendas')            as receitas_vendas,`);
d(`  (select max(origem_linha) from public.financeiro_lancamentos where origem = 'vendas')   as ultima_linha,`);
d(`  (select count(*) from public.financeiro_lancamentos`);
d(`    where origem = 'vendas' and status = 'pendente')                                      as vendas_pendentes,`);
d(`  (select count(*) from public.comercial_assinaturas)                                     as assinaturas,`);
d(`  (select count(*) from public.financeiro_lancamentos where assinatura_id is not null)    as pagamentos_ligados;`);

// ── escrita, com as versões LIMPO para colar no SQL Editor ───────
// O "--" se perde no paste do SQL Editor e vira comando solto.
const semComentario = txt => txt
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/^\n+/, '');

for (const [nome, linhas] of [
  ['comercial_atualizar_pagamentos', A],
  ['comercial_atualizar_pagamentos_desfazer', D],
]) {
  const txt = linhas.join('\n') + '\n';
  writeFileSync(join(RAIZ, `db/${nome}.sql`), txt, 'utf8');
  writeFileSync(join(RAIZ, `db/${nome}_LIMPO.sql`), semComentario(txt), 'utf8');
  console.log(`escrito: db/${nome}.sql (+ _LIMPO)`);
}
