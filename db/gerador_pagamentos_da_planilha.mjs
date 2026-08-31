// ===========================================================================
// Evollo · GERADOR DOS PAGAMENTOS DA PLANILHA
// ---------------------------------------------------------------------------
// Compara a planilha "Pagamentos" (.xlsx) com o RETRATO DO BANCO e escreve:
//
//   db/comercial_pagamentos_da_planilha.sql           (+ _LIMPO)
//   db/comercial_pagamentos_da_planilha_desfazer.sql  (+ _LIMPO)
//   o levantamento no terminal
//
// USO:
//   node db/gerador_pagamentos_da_planilha.mjs "C:/.../Pagamentos.xlsx" \
//        db/retrato_pagamentos.csv [AAAA-MM-DD]
//
// A data de referencia ("hoje") e ARGUMENTO e nao `new Date()`: rodar o gerador
// amanha com a mesma planilha tem que produzir o mesmo SQL, senao nao da para
// revisar o diff. Mesma decisao de db/gerador_atualizacao_pagamentos.mjs.
//
// POR QUE ELE NAO E O gerador_atualizacao_pagamentos.mjs. Aquele compara a
// planilha "Vendas" com os SEEDS do repositorio e casa cada venda pelo NUMERO
// DA LINHA (que virou `origem_linha` no banco). Duas coisas quebram esse
// caminho aqui:
//
//   1. os seeds nao estao mais na maquina — estao no .gitignore, sao dado
//      pessoal, e sem eles nao ha com o que comparar;
//   2. a planilha "Pagamentos" tem 79 linhas e a "Vendas" importada ia ate a
//      2179. As linhas 2..79 desta NAO sao as linhas 2..79 daquela: sao vendas
//      de 2022. Casar por numero aqui aponta para a pessoa errada.
//
// Entao este gerador troca as duas pecas: le o estado REAL do banco
// (db/conferencia/107_pagamentos_da_planilha_estado.sql, exportado em CSV) e
// casa cada pagamento por NOME + DATA + VALOR. Arquivo nao e banco; retrato e.
//
// A COLUNA "Pago" EM BRANCO. Na planilha "Vendas" antiga, branco significava
// recebido (db/gerador_vendas.mjs, `pago: !/^n/i.test(...)`). Aqui a leitura e
// a OPOSTA: a planilha escreve "Sim" explicitamente em 70 linhas e deixa 8 em
// branco — justamente as mais recentes. Branco e "ainda nao conferi", nao
// "recebi". Elas entram como 'pendente'.
//
// Isto e uma DECISAO, e ela e conservadora de proposito: uma receita pendente
// que na verdade foi paga se resolve com um clique em Comercial > cliente >
// registrar pagamento. Uma receita marcada paga que nao foi contamina o caixa
// do mes e so aparece na conciliacao do extrato. Se a leitura certa for a
// outra, troque PAGO_EM_BRANCO abaixo e rode de novo.
//
// O QUE O GERADOR DECIDE SOZINHO, e o que ele recusa:
//
//   renova       -> UM pagamento novo, de valor cheio, com data ja passada,
//                   posterior ao inicio do periodo gravado, no MESMO plano que
//                   o contrato diz. A regra do periodo novo e a de
//                   js/comercial.js (renovar), com a tolerancia da assinatura.
//   NAO renova   -> parcela (abaixo de 70% do contratado), pagamento com data
//                   futura, mais de um pagamento cheio, troca de plano, ou
//                   pagamento que ja tem um parecido no banco a menos de 10
//                   dias. Estes saem na lista de AMBIGUOS, para a tela
//                   resolver com o historico a vista.
//
// Adivinhar nesses casos custaria periodo errado em cliente real, que e pior
// que deixar a linha parada e visivel.
// ===========================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirZip, lerSharedStrings, lerEstilosDeData, lerLinhas, pacoteDe } from './gerador_vendas.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

const XLSX    = process.argv[2];
const RETRATO = process.argv[3] || join(RAIZ, 'db/retrato_pagamentos.csv');
const HOJE    = process.argv[4] || '2026-08-31';

if (!XLSX) {
  console.error('uso: node db/gerador_pagamentos_da_planilha.mjs <planilha.xlsx> [retrato.csv] [AAAA-MM-DD]');
  process.exit(1);
}

/** Branco na coluna "Pago" significa recebido? Ver o cabecalho. */
const PAGO_EM_BRANCO = false;

// ═══════════════════════════════════════════════════════════════
// LEITURA — a planilha
// ═══════════════════════════════════════════════════════════════
const limpa     = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = s => limpa(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const centavos  = n => Math.round(Number(n) * 100);

/** Uma linha por pagamento. `linha` e o numero NA PLANILHA — ele nao vira
 *  origem_linha (ver o cabecalho), mas e o que torna cada decisao rastreavel
 *  ate a celula que a originou, e e por ele que o levantamento fala. */
function lerPlanilha() {
  const zip    = abrirZip(readFileSync(XLSX));
  const shared = lerSharedStrings(zip['xl/sharedStrings.xml']);
  const ehData = lerEstilosDeData(zip['xl/styles.xml']);
  const linhas = lerLinhas(zip['xl/worksheets/sheet1.xml'], shared, ehData);

  const dentro = [], fora = [];
  for (const l of linhas.slice(1)) {
    const c = l.celulas;
    if (!limpa(c[3])) continue;                       // sem nome nao ha pagamento
    const marca = limpa(c[8]);
    const reg = {
      linha:  l.num,
      data:   String(c[0] ?? ''),
      nome:   limpa(c[3]),
      pacote: pacoteDe(c[4]),
      valor:  typeof c[5] === 'number' ? c[5] : null,
      desconto: typeof c[6] === 'number' ? c[6] : 0,
      pago:   marca ? /^s/i.test(marca) : PAGO_EM_BRANCO,
      forma:  limpa(c[9]),
      obs:    limpa(c[10]),
    };
    // Sem data valida nao ha competencia, e competencia e NOT NULL.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reg.data) || reg.valor == null) { fora.push(reg); continue; }
    dentro.push(reg);
  }
  return { dentro, fora };
}

// ═══════════════════════════════════════════════════════════════
// LEITURA — o retrato do banco (saida do 107, exportada em CSV)
// ═══════════════════════════════════════════════════════════════
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

/** O "valor" do retrato e uma frase com campos separados por " | ". Ela e
 *  legivel por gente de proposito — o 107 tambem serve para ler na tela. */
function lerRetrato() {
  const grade = parseCsv(readFileSync(RETRATO, 'utf8').replace(/^\uFEFF/, '')).slice(1);
  const num = s => Number(String(s).replace(/[^\d.]/g, ''));

  const lancamentos = [], assinaturas = [], cobrancas = [];
  let proximaLinha = null, dono = null;

  for (const l of grade) {
    const [, secao, item, valor, resultado] = l;
    if (secao === 'CONTA' && item === 'proprietario') dono = limpa(valor);

    if (secao === 'NUMERACAO' && item === 'vendas') {
      const m = /proxima livre: (\d+)/.exec(resultado || '');
      if (m) proximaLinha = Number(m[1]);
    }

    if (secao === 'JA LANCADO' && /^\d{4}-\d{2}-\d{2} \|/.test(valor || '')) {
      const p = valor.split('|').map(limpa);
      const origem = /^(\w+)\/(.+)$/.exec(p[3] || '');
      lancamentos.push({
        nome:   item,
        data:   p[0],
        valor:  num(p[1]),
        status: p[2],
        origem: origem ? origem[1] : '',
        origemLinha: origem && origem[2] !== '-' ? Number(origem[2]) : null,
        forma:  (p[4] || '').replace(/^forma /, '') === '-' ? '' : (p[4] || '').replace(/^forma /, ''),
        ligada: limpa(resultado) === 'ligada a assinatura',
        usado:  false,
      });
    }

    if (secao === 'ASSINATURAS' && / \| periodo /.test(valor || '')) {
      const p = valor.split('|').map(limpa);
      const per = /periodo (\d{4}-\d{2}-\d{2}) -> (\d{4}-\d{2}-\d{2})/.exec(valor);
      assinaturas.push({
        nome:   item,
        plano:  p[0],
        valor:  num(p[1]),
        inicio: per?.[1] ?? null,
        fim:    per?.[2] ?? null,
        status: p[3],
        duracao:    num(/duracao (\d+)/.exec(valor)?.[1] ?? 30),
        tolerancia: num(/tolerancia (\d+)/.exec(valor)?.[1] ?? 5),
      });
    }

    if (secao === 'COBRANCAS EM ABERTO' && /^vence /.test(valor || '')) {
      const p = valor.split('|').map(limpa);
      cobrancas.push({ nome: item, vencimento: p[0].replace('vence ', ''), valor: num(p[1]) });
    }
  }

  if (!dono)         throw new Error('retrato sem a linha CONTA/proprietario');
  if (!proximaLinha) throw new Error('retrato sem NUMERACAO/vendas — nao sei onde comecar a numerar');
  return { dono, proximaLinha, lancamentos, assinaturas, cobrancas };
}

// ═══════════════════════════════════════════════════════════════
// AS REGRAS DO PERIODO — copia fiel de js/comercial.js
// ---------------------------------------------------------------
// Copia, e nao import, porque js/comercial.js e modulo de navegador e este e um
// utilitario de linha de comando. Mesma decisao (e mesmo codigo) de
// db/gerador_atualizacao_pagamentos.mjs.
// ═══════════════════════════════════════════════════════════════
const DIA = 86400000;
const iso10 = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const comoData = v => {
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const somarDias = (iso, n) => iso10(new Date(comoData(iso).getTime() + n * DIA));
const diasEntre = (a, b) => Math.round((comoData(b).getTime() - comoData(a).getTime()) / DIA);

/** Dentro da tolerancia, a renovacao continua do termino anterior; passando
 *  dela, comeca na data do pagamento. */
function renovar(fimVigente, dataPagamento, duracao, tolerancia = 5) {
  const inicio = diasEntre(fimVigente, dataPagamento) <= tolerancia ? fimVigente : dataPagamento;
  return { inicio, fim: somarDias(inicio, duracao) };
}

// ═══════════════════════════════════════════════════════════════
// FORMA DE PAGAMENTO — o rotulo da planilha nao cabe na coluna
// ---------------------------------------------------------------
// `financeiro_lancamentos.forma_pagamento` tem CHECK com oito valores em
// minuscula (db/financeiro_despesas_etapa1.sql). A planilha escreve o rotulo
// comercial: PIX, DINHEIRO, ASAAS, TON, NEXTFIT.
//
// Os dois primeiros sao forma de pagamento e viram 'pix' e 'dinheiro'. Os
// outros tres NAO sao: ASAAS e gateway, TON e maquininha e NEXTFIT e o sistema
// da academia — cada um cobra por varios meios, e nenhum diz se a venda saiu no
// debito ou no credito. Entao entram como 'outro' e o rotulo original vai para
// a observacao: a coluna fica honesta e o dado da planilha nao se perde.
//
// Mesma regra de db/gerador_atualizacao_pagamentos.mjs, de proposito: duas
// importacoes que classificam a mesma maquininha de dois jeitos tornam o
// relatorio por forma de pagamento inutil.
// ═══════════════════════════════════════════════════════════════
const FORMA = { pix: 'pix', dinheiro: 'dinheiro' };
const formaDaColuna     = b => FORMA[semAcento(b)] ?? (limpa(b) ? 'outro' : null);
const formaNaObservacao = b => (limpa(b) && !FORMA[semAcento(b)] ? `forma: ${limpa(b)}` : '');

/** O rotulo cru da planilha, so quando ele NAO cabe na coluna ('outro'). Vazio
 *  para pix e dinheiro, que a coluna ja descreve por inteiro.
 *
 *  Ele viaja separado do texto pronto porque o SQL precisa PROCURAR o rotulo na
 *  observacao antes de anexar: a importacao de 05/08/2026 ja gravava "ASAAS",
 *  "TON" e "NEXTFIT" crus ali, e anexar sem olhar produzia
 *  "ASAAS · forma: ASAAS". */
const rotuloDaForma = b => (limpa(b) && !FORMA[semAcento(b)] ? limpa(b) : '');

// ═══════════════════════════════════════════════════════════════
// COMPARACAO
// ═══════════════════════════════════════════════════════════════
const { dentro: planilha, fora } = lerPlanilha();
const { dono, proximaLinha, lancamentos, assinaturas, cobrancas } = lerRetrato();

/** Nome + data + valor. E o casamento possivel: a planilha nao guarda id, e o
 *  numero da linha nao serve (ver o cabecalho). Como o 107 confirmou que nao ha
 *  nome repetido no cadastro, a chave e suficiente. */
const chave = r => `${r.data}|${semAcento(r.nome)}|${centavos(r.valor)}`;
const porChave = new Map();
for (const l of lancamentos) {
  if (!porChave.has(chave(l))) porChave.set(chave(l), []);
  porChave.get(chave(l)).push(l);
}

const jaExistem = [];   // a planilha e o banco descrevem o mesmo lancamento
const novas     = [];   // a planilha tem, o banco nao
for (const p of planilha) {
  const par = porChave.get(chave(p))?.find(l => !l.usado);
  if (par) { par.usado = true; jaExistem.push({ p, l: par }); }
  else novas.push(p);
}
const orfaos = lancamentos.filter(l => !l.usado && l.origem === 'vendas');

// ── o que muda nos que ja existem: so a forma de pagamento ──────
// Status nao entra aqui de proposito. Devolver uma receita de 'pago' para
// 'pendente' e a decisao que db/vendas_sem_credito_no_extrato.sql tomou contra
// o EXTRATO, que e prova mais forte que planilha. Se houver divergencia ela e
// listada no levantamento, para ser resolvida a mao.
const formaFaltando = [], statusDivergente = [];
for (const { p, l } of jaExistem) {
  const alvo = formaDaColuna(p.forma);
  if (alvo && !l.forma) formaFaltando.push({ p, l, alvo });
  if (p.pago !== (l.status === 'pago')) statusDivergente.push({ p, l });
}

// ── suspeita de duplicidade ─────────────────────────────────────
// O casamento acima e exato: nome + data + valor. Um pagamento que o banco ja
// tem escrito com OUTRO valor ou em outro dia escapa dele e entra como novo —
// contando o mesmo dinheiro duas vezes.
//
// O caso que motivou esta checagem: a planilha traz R$ 301 no dinheiro em
// 17/08, e o banco tem uma cobranca quitada de R$ 311 no dinheiro no MESMO dia.
// R$ 10 de diferenca nao fazem dois pagamentos.
//
// A linha continua sendo inserida — a planilha e o registro do que aconteceu no
// caixa, e omitir some com dinheiro de verdade. Mas ela sai no levantamento e
// no cabecalho do SQL, para ser conferida antes de rodar.
const parecido = (a, b) => {
  const dif = Math.abs(centavos(a.valor) - centavos(b.valor));
  return dif <= Math.max(centavos(a.valor) * 0.05, 1500);
};
const suspeitas = [];
for (const n of novas) {
  const perto = lancamentos.filter(l =>
    semAcento(l.nome).includes(semAcento(n.nome)) &&
    Math.abs(diasEntre(l.data, n.data)) <= 10 &&
    parecido(n, l));
  if (perto.length) suspeitas.push({ n, perto });
}

// ── numeracao das novas ─────────────────────────────────────────
// Continua de onde a importacao parou. O numero da linha da planilha nao pode
// ser reaproveitado: o 107 mostra 78 ocupadas no intervalo 2..79.
novas.sort((a, b) => (a.data === b.data ? a.linha - b.linha : a.data.localeCompare(b.data)));
novas.forEach((n, i) => { n.origemLinha = proximaLinha + i; });

// ═══════════════════════════════════════════════════════════════
// AS ASSINATURAS
// ═══════════════════════════════════════════════════════════════
const MENSALIDADE = /^(mensal|trimestral|semestral|anual|semanal)/i;
const porAssinatura = new Map(assinaturas.map(a => [semAcento(a.nome), a]));

/** Ja existe no banco um lancamento parecido com este pagamento? Mesmo cliente,
 *  mesmo valor, a menos de 10 dias. Se existe, os dois podem ser o MESMO
 *  dinheiro escrito de dois jeitos — lancar e renovar contaria duas vezes.
 *  Mesma heuristica de db/conferencia/92_cobrancas_que_ja_existem.sql. */
const pareceRepetido = p => lancamentos.find(l =>
  semAcento(l.nome).includes(semAcento(p.nome)) &&
  centavos(l.valor) === centavos(p.valor) &&
  Math.abs(diasEntre(l.data, p.data)) <= 10);

const renovacoes = [], ambiguas = [], semAssinatura = new Map();

// So os pagamentos NOVOS movem assinatura. Os que ja estao no banco ja andaram
// o periodo quando foram lancados — reaproveita-los renovaria de novo, com o
// mesmo dinheiro. E o erro que o `inicio_periodo` atual denuncia: em quase
// todos, ele e posterior ao pagamento que o produziu.
const novasPorCliente = new Map();
for (const n of novas) {
  if (!MENSALIDADE.test(n.pacote)) continue;
  const k = semAcento(n.nome);
  if (!novasPorCliente.has(k)) novasPorCliente.set(k, []);
  novasPorCliente.get(k).push(n);
}
for (const l of novasPorCliente.values()) l.sort((a, b) => a.data.localeCompare(b.data));

for (const [k, lista] of novasPorCliente) {
  const a = porAssinatura.get(k);
  if (!a) { semAssinatura.set(k, lista); continue; }

  const naoPagos = lista.filter(p => !p.pago);
  const pagos    = lista.filter(p => p.pago);
  const futuros  = pagos.filter(p => p.data > HOJE);
  const passados = pagos.filter(p => p.data <= HOJE && p.data > a.inicio);
  const eParcela = p => a.valor > 0 && p.valor < a.valor * 0.7;
  const parcelas = passados.filter(eParcela);
  const cheios   = passados.filter(p => !eParcela(p));
  const trocaDePlano = cheios.filter(p => semAcento(p.pacote) !== semAcento(a.plano));
  const repetido = cheios.map(p => ({ p, l: pareceRepetido(p) })).filter(x => x.l);

  const porque = [];
  if (!pagos.length)          porque.push(`${naoPagos.length} pagamento(s) sem "Pago" na planilha`);
  if (parcelas.length)        porque.push(`${parcelas.length} parcela(s)`);
  if (futuros.length)         porque.push(`${futuros.length} com data futura`);
  if (cheios.length > 1)      porque.push(`${cheios.length} pagamentos cheios`);
  if (!cheios.length && pagos.length && !parcelas.length && !futuros.length)
                              porque.push('nenhum pagamento posterior ao inicio do periodo');
  if (trocaDePlano.length)    porque.push(`plano da planilha (${trocaDePlano[0].pacote}) diferente do contrato (${a.plano})`);
  if (repetido.length)        porque.push(`ja ha lancamento parecido no banco em ${repetido[0].l.data}`);

  if (porque.length) { ambiguas.push({ ...a, lista, porque }); continue; }

  const novo = renovar(a.fim, cheios[0].data, a.duracao, a.tolerancia);
  renovacoes.push({ ...a, pagamento: cheios[0], novoInicio: novo.inicio, novoFim: novo.fim });
}
renovacoes.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
ambiguas.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

// ═══════════════════════════════════════════════════════════════
// O LEVANTAMENTO
// ═══════════════════════════════════════════════════════════════
const real   = n => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const soma   = a => a.reduce((t, r) => t + (r.valor || 0), 0);
const brasil = iso => iso.split('-').reverse().join('/');
const n4     = n => String(n).padStart(4);

console.log(`\nplanilha: ${planilha.length} pagamentos | banco (retrato): ${lancamentos.length} lancamentos na janela | referencia: ${brasil(HOJE)}\n`);
if (fora.length) console.log(`fora (sem data ou sem valor) ..... ${n4(fora.length)}\n`);
console.log(`ja no banco ...................... ${n4(jaExistem.length)}  R$ ${real(soma(jaExistem.map(x => x.p)))}`);
console.log(`  forma de pagamento a preencher . ${n4(formaFaltando.length)}`);
console.log(`  status divergente (a mao) ...... ${n4(statusDivergente.length)}`);
console.log(`a lancar ......................... ${n4(novas.length)}  R$ ${real(soma(novas))}`);
console.log(`  pagos .......................... ${n4(novas.filter(n => n.pago).length)}  R$ ${real(soma(novas.filter(n => n.pago)))}`);
console.log(`  pendentes ...................... ${n4(novas.filter(n => !n.pago).length)}  R$ ${real(soma(novas.filter(n => !n.pago)))}`);
console.log(`  origem_linha ................... ${novas.length ? `${novas[0].origemLinha}..${novas[novas.length - 1].origemLinha}` : '—'}`);
console.log(`no banco sem par na planilha ..... ${n4(orfaos.length)}`);
console.log(`\nassinaturas no retrato: ${assinaturas.length}`);
console.log(`  renovacao limpa ................ ${n4(renovacoes.length)}`);
console.log(`  ambiguas (ficam para a tela) ... ${n4(ambiguas.length)}`);
console.log(`  pagou e nao tem assinatura ..... ${n4(semAssinatura.size)}\n`);

if (renovacoes.length) {
  console.log('RENOVAM:');
  for (const r of renovacoes)
    console.log(`  ${r.nome.padEnd(40)} ${r.inicio} -> ${r.fim}   passa a   ${r.novoInicio} -> ${r.novoFim}  (pagou ${brasil(r.pagamento.data)} R$ ${real(r.pagamento.valor)})`);
  console.log('');
}
if (ambiguas.length) {
  console.log('AMBIGUAS — resolver em Comercial > cliente:');
  for (const a of ambiguas) console.log(`  ${a.nome.padEnd(40)} ${a.plano.padEnd(16)} ${a.porque.join('; ')}`);
  console.log('');
}
if (semAssinatura.size) {
  console.log('PAGOU E NAO TEM ASSINATURA — criar pela tela:');
  for (const lista of semAssinatura.values())
    console.log(`  ${lista[0].nome.padEnd(40)} ${lista.map(p => `${brasil(p.data)} ${p.pacote} R$ ${real(p.valor)}`).join(' | ')}`);
  console.log('');
}
if (suspeitas.length) {
  console.log('SUSPEITA DE DUPLICIDADE — o banco ja tem algo parecido; conferir ANTES de rodar:');
  for (const { n, perto } of suspeitas)
    console.log(`  L${n.linha} ${n.nome.padEnd(40)} ${brasil(n.data)} R$ ${real(n.valor)}  <->  ${perto.map(l => `${brasil(l.data)} R$ ${real(l.valor)} (${l.origem}${l.origemLinha ? '/' + l.origemLinha : ''}, ${l.status})`).join(' | ')}`);
  console.log('');
}
if (statusDivergente.length) {
  console.log('STATUS DIVERGENTE — planilha e banco discordam, resolver a mao:');
  for (const { p, l } of statusDivergente)
    console.log(`  L${p.linha} ${p.nome.padEnd(40)} planilha pago=${p.pago} | banco ${l.status}`);
  console.log('');
}
if (orfaos.length) {
  console.log('NO BANCO E NAO NA PLANILHA:');
  for (const l of orfaos) console.log(`  ${l.origem}/${l.origemLinha} ${l.data} ${l.nome} R$ ${real(l.valor)}`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
// O SQL
// ═══════════════════════════════════════════════════════════════
const q = s => (s == null || s === '' ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

/** Como `q`, mas vazio vira a STRING VAZIA, nunca NULL.
 *
 *  A diferenca custou dado: um `case when r.obs = '' then ...` com r.obs NULL
 *  nao da falso, da NULL — cai no else, e `coalesce(observacoes,'') || ... ||
 *  NULL` apaga a observacao inteira. Onde o SQL COMPARA o valor com '', ele tem
 *  que chegar como ''. */
const txt = s => `'${String(s ?? '').replace(/'/g, "''")}'`;

// Nao ha unaccent no banco (a extensao nao esta instalada), entao a comparacao
// sem acento e feita com translate, igual a db/gerador_atualizacao_pagamentos.mjs.
const SEM_ACENTO_SQL = [
  `translate(trim(%s),`,
  `             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',`,
  `             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')`,
].join('\n       ');

const A = [];
const a = s => A.push(s);

a(`-- ===========================================================================`);
a(`-- Evollo · PAGAMENTOS DA PLANILHA ATE ${brasil(HOJE)}`);
a(`-- ---------------------------------------------------------------------------`);
a(`-- GERADO AUTOMATICAMENTE por db/gerador_pagamentos_da_planilha.mjs a partir`);
a(`-- da planilha "Pagamentos" (.xlsx) e do retrato do banco. NAO EDITE A MAO:`);
a(`-- ajuste a planilha e rode o gerador de novo.`);
a(`--`);
a(`-- CONFIRA ANTES: db/conferencia/107_pagamentos_da_planilha_estado.sql precisa`);
a(`-- ter sido rodado DEPOIS da ultima mexida na tela. Este script foi escrito`);
a(`-- contra o retrato que ele devolveu, e cada comando leva o estado esperado no`);
a(`-- WHERE — se o banco andou, a linha nao e tocada, em vez de sobrescrever o`);
a(`-- que a tela ja fez.`);
a(`--`);
a(`-- O QUE ELE FAZ, nesta ordem:`);
a(`--`);
a(`--   1. preenche forma_pagamento em ${formaFaltando.length} receitas que ja existem e estao`);
a(`--      com a coluna nula`);
a(`--   2. lanca as ${novas.length} receitas que a planilha tem e o banco nao`);
a(`--      (${novas.filter(n => n.pago).length} pagas, ${novas.filter(n => !n.pago).length} pendentes), com origem 'vendas' e origem_linha`);
a(`--      de ${novas.length ? novas[0].origemLinha : '—'} em diante`);
a(`--   3. anda o periodo de ${renovacoes.length} assinaturas e liga o pagamento a elas`);
a(`--`);
a(`-- O QUE ELE NAO FAZ, e por que:`);
a(`--`);
if (novas.some(n => !n.pago)) {
  a(`--   as ${novas.filter(n => !n.pago).length} receitas sem "Pago" na planilha entram como PENDENTE, e nao`);
  a(`--      renovam ninguem. Branco na coluna e "ainda nao conferi", nao "recebi".`);
  a(`--      Se voce confirmar que foram pagas, marque na planilha e rode de novo,`);
  a(`--      ou de baixa em Comercial > cliente.`);
  a(`--`);
}
if (ambiguas.length) {
  a(`--   as ${ambiguas.length} assinaturas ambiguas -> parcela, data futura, mais de um`);
  a(`--      pagamento cheio, troca de plano e pagamento que ja tem parecido no`);
  a(`--      banco nao dizem sozinhos onde o periodo termina. Ficam para a tela,`);
  a(`--      com o historico a vista:`);
  for (const x of ambiguas) a(`--      ${x.nome} — ${x.porque.join('; ')}`);
  a(`--`);
}
if (semAssinatura.size) {
  a(`--   os ${semAssinatura.size} clientes que pagaram e nao tem assinatura -> o gerador sabe`);
  a(`--      QUEM pagou, mas nao com que plano nem por quanto a pessoa fechou.`);
  a(`--      Criar em Comercial > nova assinatura:`);
  for (const lista of semAssinatura.values())
    a(`--      ${lista[0].nome} (${lista.map(p => `${brasil(p.data)} ${p.pacote} R$ ${real(p.valor)}`).join(', ')})`);
  a(`--`);
}
if (suspeitas.length) {
  a(`-- CONFIRA ANTES DE RODAR — ${suspeitas.length} receita(s) que este script vai lancar tem algo`);
  a(`-- PARECIDO ja no banco: mesmo cliente, ate 10 dias de distancia, valor a`);
  a(`-- menos de 5% (ou R$ 15). Podem ser o MESMO dinheiro escrito de dois jeitos.`);
  a(`-- Elas entram assim mesmo, porque a planilha e o registro do caixa e omitir`);
  a(`-- some com dinheiro de verdade — mas confira, e apague a linha do VALUES se`);
  a(`-- for repetida:`);
  for (const { n, perto } of suspeitas)
    a(`--   planilha L${n.linha} ${n.nome} ${brasil(n.data)} R$ ${real(n.valor)}  <->  banco ${perto.map(l => `${brasil(l.data)} R$ ${real(l.valor)} (${l.origem}, ${l.status})`).join(' | ')}`);
  a(`--`);
}
a(`--   a proxima cobranca de cada assinatura renovada -> criar pela tela:`);
a(`--      Comercial > cliente > Criar cobranca do periodo. Assim ninguem ve`);
a(`--      conta a receber que nao conferiu.`);
a(`--`);
a(`--   periodo_inicio / periodo_fim das receitas ligadas -> ficam nulos, como`);
a(`--      em db/gerador_atualizacao_pagamentos.mjs. A receita da planilha e o`);
a(`--      registro do dinheiro; o periodo dela sairia do mesmo lugar de onde ja`);
a(`--      saiu o da assinatura, e gravar os dois multiplica a chance de eles`);
a(`--      discordarem.`);
a(`--`);
a(`-- 100% RE-EXECUTAVEL. As receitas sao identificadas por NOME + DATA + VALOR`);
a(`-- (nao por origem_linha, que foi atribuido agora) e as assinaturas pelo`);
a(`-- periodo esperado: rodar duas vezes nao duplica nem reanda.`);
a(`--`);
a(`-- Desfazer: db/comercial_pagamentos_da_planilha_desfazer.sql`);
a(`-- Para colar no SQL Editor, use db/comercial_pagamentos_da_planilha_LIMPO.sql`);
a(`-- ===========================================================================`);
a(``);
a(`do $pagamentos$`);
a(`declare`);
a(`  v_dono uuid;`);
a(`  v_cat  uuid;`);
a(`  v_pac  uuid;`);
a(`  v_ass  uuid;`);
a(`  v_n    int;`);
a(`  v_forma  int := 0;`);
a(`  v_novas  int := 0;`);
a(`  v_pulos  int := 0;`);
a(`  v_renov  int := 0;`);
a(`  v_ligou  int := 0;`);
a(`  r      record;`);
a(`begin`);
a(`  select o.proprietario_user_id into v_dono`);
a(`    from public.organizacoes o`);
a(`    join public.admins a on a.user_id = o.proprietario_user_id;`);
a(``);
a(`  if v_dono is null then`);
a(`    raise exception 'Nao encontrei a organizacao principal.';`);
a(`  end if;`);
a(``);
a(`  if v_dono <> '${dono}'::uuid then`);
a(`    raise exception 'A conta mudou desde o retrato: esperava ${dono}, achei %.', v_dono;`);
a(`  end if;`);
a(``);

// ── 1) forma de pagamento ────────────────────────────────────────
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 1) FORMA DE PAGAMENTO EM ${formaFaltando.length} RECEITAS QUE JA EXISTEM`);
a(`  -- -----------------------------------------------------------`);
a(`  -- A importacao anterior nao preencheu esta coluna em nenhuma linha. A`);
a(`  -- planilha sabe, e e a unica que sabe.`);
a(`  --`);
a(`  -- So preenche onde esta NULO. Se a tela ja gravou uma forma, ela vale mais`);
a(`  -- que a planilha: alguem olhou o comprovante.`);
a(`  --`);
a(`  -- O ROTULO SO ENTRA NA OBSERVACAO SE AINDA NAO ESTIVER LA. A importacao de`);
a(`  -- 05/08/2026 ja gravava "ASAAS", "TON" e "NEXTFIT" crus em observacoes;`);
a(`  -- anexar sem olhar produzia "ASAAS · forma: ASAAS".`);
a(`  -- ═══════════════════════════════════════════════════════════`);
if (!formaFaltando.length) {
  a(`  -- nenhuma: todas as receitas ja tem forma de pagamento.`);
} else {
  a(`  for r in`);
  a(`    select * from (values`);
  formaFaltando.forEach(({ p, l, alvo }, i) => {
    a(`    (${l.origemLinha}, ${q(p.nome)}, date '${p.data}', ${p.valor.toFixed(2)}, ${q(alvo)}, ${txt(rotuloDaForma(p.forma))})${i === formaFaltando.length - 1 ? '' : ','}`);
  });
  a(`    ) as t(origem_linha, nome, data, valor, forma, rotulo)`);
  a(`  loop`);
  a(`    update public.financeiro_lancamentos`);
  a(`       set forma_pagamento = r.forma,`);
  a(`           observacoes     = case`);
  a(`                               when r.rotulo = '' then observacoes`);
  a(`                               when coalesce(observacoes, '') ilike '%' || r.rotulo || '%' then observacoes`);
  a(`                               else trim(both ' · ' from coalesce(observacoes, '') || ' · forma: ' || r.rotulo)`);
  a(`                             end`);
  a(`     where nutri_id = v_dono`);
  a(`       and origem = 'vendas'`);
  a(`       and origem_linha = r.origem_linha`);
  a(`       and data = r.data`);
  a(`       and valor = r.valor`);
  a(`       and forma_pagamento is null;`);
  a(`    get diagnostics v_n = row_count;`);
  a(`    v_forma := v_forma + v_n;`);
  a(`  end loop;`);
}
a(``);

// ── 2) as receitas novas ─────────────────────────────────────────
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 2) AS ${novas.length} RECEITAS QUE FALTAM`);
a(`  -- -----------------------------------------------------------`);
a(`  -- origem 'vendas', como a importacao anterior. O origem_linha NAO e o`);
a(`  -- numero da linha desta planilha: as linhas 2..79 dela nao sao as 2..79 do`);
a(`  -- banco, e o indice uniq_financeiro_lancamentos_origem recusaria. A`);
a(`  -- numeracao continua de ${proximaLinha}, onde a importacao parou.`);
a(`  --`);
a(`  -- A GUARDA E NOME + DATA + VALOR, e nao origem_linha, justamente porque o`);
a(`  -- numero foi atribuido agora: se este script rodar duas vezes, ou se alguem`);
a(`  -- lancar a mesma receita pela tela no meio do caminho, a segunda passada`);
a(`  -- pula em vez de duplicar.`);
a(`  --`);
a(`  -- PAGO x PENDENTE sai da coluna "Pago" da planilha. Branco entra como`);
a(`  -- pendente: e "ainda nao conferi", nao "recebi".`);
a(`  --`);
a(`  -- FORMA DE PAGAMENTO: PIX e DINHEIRO viram 'pix' e 'dinheiro'; ASAAS, TON e`);
a(`  -- NEXTFIT nao sao forma de pagamento — sao gateway, maquininha e sistema.`);
a(`  -- Entram como 'outro', com o rotulo guardado na observacao.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
if (!novas.length) {
  a(`  -- nenhuma: a planilha nao tem nada que o banco ja nao tenha.`);
} else {
  a(`  for r in`);
  a(`    select * from (values`);
  novas.forEach((n, i) => {
    const obs = [n.obs, formaNaObservacao(n.forma)].filter(Boolean).join(' · ');
    a(`    (${n.origemLinha}, date '${n.data}', ${q(n.nome)}, ${n.valor.toFixed(2)}, ${q(n.pacote)}, ${q(formaDaColuna(n.forma))}, ${q(obs)}, ${n.pago}, ${n.linha})${i === novas.length - 1 ? '' : ','}`);
  });
  a(`    ) as t(origem_linha, data, nome, valor, pacote, forma, obs, pago, linha_planilha)`);
  a(`  loop`);
  a(`    if exists (select 1 from public.financeiro_lancamentos`);
  a(`                where nutri_id = v_dono`);
  a(`                  and tipo = 'receita'`);
  a(`                  and data = r.data`);
  a(`                  and valor = r.valor`);
  a(`                  and lower(trim(descricao)) = lower(trim(r.nome))) then`);
  a(`      v_pulos := v_pulos + 1;`);
  a(`      continue;`);
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
  a(`    -- O paciente e vinculado quando existe, mesmo sem assinatura: e o que`);
  a(`    -- faz a receita aparecer na ficha da pessoa. Sem acento na busca — a`);
  a(`    -- planilha e o cadastro discordam no acento de varios nomes, e comparar`);
  a(`    -- cru criaria um segundo cadastro da mesma pessoa.`);
  a(`    select id into v_pac from public.pacientes`);
  a(`     where nutri_id = v_dono`);
  a(`       and lower(${SEM_ACENTO_SQL.replace('%s', 'nome')})`);
  a(`         = lower(${SEM_ACENTO_SQL.replace('%s', 'r.nome')})`);
  a(`     limit 1;`);
  a(``);
  a(`    insert into public.financeiro_lancamentos`);
  a(`      (nutri_id, tipo, data, competencia, descricao, valor, pago, status, pago_em,`);
  a(`       forma_pagamento, categoria_id, paciente_id, observacoes, origem, origem_linha)`);
  a(`    values`);
  a(`      (v_dono, 'receita', r.data, date_trunc('month', r.data)::date, r.nome,`);
  a(`       r.valor, r.pago, case when r.pago then 'pago' else 'pendente' end,`);
  a(`       case when r.pago then r.data else null end,`);
  a(`       r.forma, v_cat, v_pac, nullif(r.obs, ''), 'vendas', r.origem_linha);`);
  a(``);
  a(`    v_novas := v_novas + 1;`);
  a(`  end loop;`);
}
a(``);

// ── 3) as renovações ─────────────────────────────────────────────
a(`  -- ═══════════════════════════════════════════════════════════`);
a(`  -- 3) AS ${renovacoes.length} ASSINATURAS QUE ANDAM`);
a(`  -- -----------------------------------------------------------`);
a(`  -- Cada uma tem UM pagamento novo, de valor cheio, ja ocorrido, posterior ao`);
a(`  -- inicio do periodo gravado, no mesmo plano do contrato. O periodo novo sai`);
a(`  -- da mesma regra da tela (js/comercial.js, renovar): dentro da tolerancia a`);
a(`  -- renovacao continua do termino anterior; passando dela, comeca na data do`);
a(`  -- pagamento.`);
a(`  --`);
a(`  -- So pagamento NOVO renova. Os que ja estavam no banco andaram o periodo`);
a(`  -- quando foram lancados; reaproveita-los renovaria de novo com o mesmo`);
a(`  -- dinheiro.`);
a(`  --`);
a(`  -- O WHERE exige o periodo VELHO. Se alguem ja renovou pela tela, a linha nao`);
a(`  -- casa e fica como esta — este script nunca desanda o que a tela ja fez.`);
a(`  -- ═══════════════════════════════════════════════════════════`);
if (!renovacoes.length) {
  a(`  -- nenhuma renovacao limpa nesta rodada.`);
} else {
  a(`  for r in`);
  a(`    select * from (values`);
  renovacoes.forEach((x, i) => {
    a(`    (${q(x.nome)}, date '${x.inicio}', date '${x.fim}', date '${x.novoInicio}', date '${x.novoFim}', date '${x.pagamento.data}', ${x.pagamento.valor.toFixed(2)})${i === renovacoes.length - 1 ? '' : ','}`);
  });
  a(`    ) as t(nome, de_inicio, de_fim, para_inicio, para_fim, data_pag, valor_pag)`);
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
  a(`    -- Sem o periodo velho no lugar, o pagamento tambem nao e religado: os`);
  a(`    -- dois descrevem o mesmo fato, e separa-los criaria meia verdade.`);
  a(`    if v_n = 1 then`);
  a(`      update public.financeiro_lancamentos`);
  a(`         set assinatura_id = v_ass,`);
  a(`             paciente_id   = coalesce(paciente_id, v_pac),`);
  a(`             vencimento    = coalesce(vencimento, r.de_fim)`);
  a(`       where nutri_id = v_dono`);
  a(`         and tipo = 'receita'`);
  a(`         and data = r.data_pag`);
  a(`         and valor = r.valor_pag`);
  a(`         and lower(trim(descricao)) = lower(trim(r.nome))`);
  a(`         and assinatura_id is null;`);
  a(`      get diagnostics v_n = row_count;`);
  a(`      v_ligou := v_ligou + v_n;`);
  a(`    end if;`);
  a(`  end loop;`);
}
a(``);
a(`  raise notice 'forma preenchida: % | receitas lancadas: % | ja existiam (puladas): % | assinaturas renovadas: % | pagamentos ligados: %',`);
a(`    v_forma, v_novas, v_pulos, v_renov, v_ligou;`);
a(`end $pagamentos$;`);
a(``);
a(``);
a(`-- ===========================================================================`);
a(`-- Conferencia. Esperado depois de rodar uma vez:`);
a(`--`);
a(`--   receitas de vendas ................ ${lancamentos.filter(l => l.origem === 'vendas').length ? '' : ''}mais ${novas.length} do que antes`);
a(`--   ultima linha importada ............ ${novas.length ? novas[novas.length - 1].origemLinha : proximaLinha - 1}`);
a(`--   receitas pendentes novas .......... ${novas.filter(n => !n.pago).length}`);
a(`--   assinaturas renovadas ............. ${renovacoes.length}`);
a(`-- ===========================================================================`);
a(`select`);
a(`  (select count(*) from public.financeiro_lancamentos where origem = 'vendas')           as receitas_vendas,`);
a(`  (select max(origem_linha) from public.financeiro_lancamentos where origem = 'vendas')  as ultima_linha,`);
a(`  (select count(*) from public.financeiro_lancamentos`);
a(`    where tipo = 'receita' and status = 'pendente')                                      as receitas_pendentes,`);
a(`  (select count(*) from public.comercial_assinaturas)                                    as assinaturas,`);
a(`  (select count(*) from public.comercial_assinaturas`);
a(`    where status = 'ativa' and fim_periodo < current_date)                               as vencidas_hoje;`);

// ── o script de desfazer ─────────────────────────────────────────
const D = [];
const d = s => D.push(s);

d(`-- ===========================================================================`);
d(`-- DESFAZER db/comercial_pagamentos_da_planilha.sql`);
d(`-- ---------------------------------------------------------------------------`);
d(`-- GERADO AUTOMATICAMENTE por db/gerador_pagamentos_da_planilha.mjs, junto com`);
d(`-- o script que ele desfaz. Devolve o banco ao estado do retrato.`);
d(`--`);
d(`-- O QUE ELE NAO DESFAZ, de proposito:`);
d(`--`);
d(`--   as categorias de receita criadas -> uma linha de catalogo sem uso nao e`);
d(`--      sujeira que valha o risco de apagar.`);
d(`--`);
d(`-- Cada passo leva o estado esperado no WHERE: se voce ja mexeu na tela depois`);
d(`-- de rodar a atualizacao, a linha nao casa e este script deixa ela em paz.`);
d(`-- Para colar no SQL Editor, use db/comercial_pagamentos_da_planilha_desfazer_LIMPO.sql`);
d(`-- ===========================================================================`);
d(``);
d(`do $desfaz$`);
d(`declare`);
d(`  v_dono uuid;`);
d(`  v_n    int;`);
d(`  v_apagadas int := 0;`);
d(`  v_forma    int := 0;`);
d(`  v_voltou   int := 0;`);
d(`  r      record;`);
d(`begin`);
d(`  select o.proprietario_user_id into v_dono`);
d(`    from public.organizacoes o`);
d(`    join public.admins a on a.user_id = o.proprietario_user_id;`);
d(``);
d(`  if v_dono is null then`);
d(`    raise exception 'Nao encontrei a organizacao principal.';`);
d(`  end if;`);
d(``);
d(`  -- ── 3) as assinaturas voltam ao periodo do retrato ──────────`);
if (!renovacoes.length) {
  d(`  -- nenhuma assinatura foi renovada.`);
} else {
  d(`  for r in`);
  d(`    select * from (values`);
  renovacoes.forEach((x, i) => {
    d(`    (${q(x.nome)}, date '${x.inicio}', date '${x.fim}', date '${x.novoInicio}', date '${x.novoFim}', date '${x.pagamento.data}', ${x.pagamento.valor.toFixed(2)}, ${q(x.status)})${i === renovacoes.length - 1 ? '' : ','}`);
  });
  d(`    ) as t(nome, de_inicio, de_fim, para_inicio, para_fim, data_pag, valor_pag, status_antes)`);
  d(`  loop`);
  d(`    update public.financeiro_lancamentos l`);
  d(`       set assinatura_id = null,`);
  d(`           vencimento    = null`);
  d(`      from public.comercial_assinaturas a`);
  d(`      join public.pacientes p on p.id = a.paciente_id`);
  d(`     where l.assinatura_id = a.id`);
  d(`       and l.nutri_id = v_dono`);
  d(`       and l.data = r.data_pag`);
  d(`       and l.valor = r.valor_pag`);
  d(`       and lower(trim(l.descricao)) = lower(trim(r.nome))`);
  d(`       and lower(trim(p.nome)) = lower(trim(r.nome));`);
  d(``);
  d(`    update public.comercial_assinaturas a`);
  d(`       set inicio_periodo = r.de_inicio,`);
  d(`           fim_periodo    = r.de_fim,`);
  d(`           status         = r.status_antes`);
  d(`      from public.pacientes p`);
  d(`     where p.id = a.paciente_id`);
  d(`       and a.nutri_id = v_dono`);
  d(`       and lower(trim(p.nome)) = lower(trim(r.nome))`);
  d(`       and a.inicio_periodo = r.para_inicio`);
  d(`       and a.fim_periodo    = r.para_fim;`);
  d(`    get diagnostics v_n = row_count;`);
  d(`    v_voltou := v_voltou + v_n;`);
  d(`  end loop;`);
}
d(``);
d(`  -- ── 2) as receitas lancadas somem ───────────────────────────`);
d(`  -- Identificadas pelo origem_linha que ESTE script atribuiu, e so as que`);
d(`  -- continuam com a data e o valor que ele gravou. Se alguem editou o valor`);
d(`  -- pela tela, a linha nao casa e nao e apagada.`);
if (!novas.length) {
  d(`  -- nenhuma receita foi lancada.`);
} else {
  d(`  for r in`);
  d(`    select * from (values`);
  novas.forEach((n, i) => {
    d(`    (${n.origemLinha}, date '${n.data}', ${n.valor.toFixed(2)}, ${q(n.nome)})${i === novas.length - 1 ? '' : ','}`);
  });
  d(`    ) as t(origem_linha, data, valor, nome)`);
  d(`  loop`);
  d(`    delete from public.financeiro_lancamentos`);
  d(`     where nutri_id = v_dono`);
  d(`       and origem = 'vendas'`);
  d(`       and origem_linha = r.origem_linha`);
  d(`       and data = r.data`);
  d(`       and valor = r.valor`);
  d(`       and lower(trim(descricao)) = lower(trim(r.nome));`);
  d(`    get diagnostics v_n = row_count;`);
  d(`    v_apagadas := v_apagadas + v_n;`);
  d(`  end loop;`);
}
d(``);
d(`  -- ── 1) a forma de pagamento volta a ser nula ────────────────`);
if (!formaFaltando.length) {
  d(`  -- nenhuma forma foi preenchida.`);
} else {
  d(`  for r in`);
  d(`    select * from (values`);
  formaFaltando.forEach(({ p, l, alvo }, i) => {
    d(`    (${l.origemLinha}, date '${p.data}', ${p.valor.toFixed(2)}, ${q(alvo)}, ${txt(rotuloDaForma(p.forma))})${i === formaFaltando.length - 1 ? '' : ','}`);
  });
  d(`    ) as t(origem_linha, data, valor, forma, rotulo)`);
  d(`  loop`);
  d(`    -- So tira o que o script POS. Onde o rotulo ja estava na observacao,`);
  d(`    -- ele nao foi anexado, e nao ha o que remover.`);
  d(`    update public.financeiro_lancamentos`);
  d(`       set forma_pagamento = null,`);
  d(`           observacoes     = case`);
  d(`                               when r.rotulo = '' then observacoes`);
  d(`                               else nullif(trim(both ' · ' from`);
  d(`                                      replace(coalesce(observacoes, ''), ' · forma: ' || r.rotulo, '')), '')`);
  d(`                             end`);
  d(`     where nutri_id = v_dono`);
  d(`       and origem = 'vendas'`);
  d(`       and origem_linha = r.origem_linha`);
  d(`       and data = r.data`);
  d(`       and valor = r.valor`);
  d(`       and forma_pagamento = r.forma;`);
  d(`    get diagnostics v_n = row_count;`);
  d(`    v_forma := v_forma + v_n;`);
  d(`  end loop;`);
}
d(``);
d(`  raise notice 'receitas apagadas: % | formas limpas: % | assinaturas devolvidas: %',`);
d(`    v_apagadas, v_forma, v_voltou;`);
d(`end $desfaz$;`);

// ── escrita, com as versões LIMPO para colar no SQL Editor ───────
// O "--" se perde no paste do SQL Editor e vira comando solto.
const semComentario = txt => txt
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/^\n+/, '');

for (const [nome, linhas] of [
  ['comercial_pagamentos_da_planilha', A],
  ['comercial_pagamentos_da_planilha_desfazer', D],
]) {
  const txt = linhas.join('\n') + '\n';
  writeFileSync(join(RAIZ, `db/${nome}.sql`), txt, 'utf8');
  writeFileSync(join(RAIZ, `db/${nome}_LIMPO.sql`), semComentario(txt), 'utf8');
  console.log(`escrito: db/${nome}.sql (+ _LIMPO)`);
}
