// ═══════════════════════════════════════════════════════════
// ETAPA 4C · FASE 1 — Equipe/Folha deixa de supor nutri_id = auth.uid()
// ═══════════════════════════════════════════════════════════
// O incidente que originou esta etapa, em 02/09/2026: uma conta de RH com
// `equipe.folha` concedido abriu a Folha de pagamento, não viu a folha que o
// proprietário tinha aberto, e o sistema CRIOU UMA SEGUNDA folha do mesmo mês
// no nome dela — vazia, invisível para os dois lados.
//
// São dois defeitos empilhados, e os dois têm teste aqui:
//
//   TENANCY  o dono vinha de `initEquipeUI(sessao.user.id)` e descia por seis
//            arquivos até o insert. Para quem não é o proprietário, o uuid
//            estava errado desde a origem.
//
//   LEITURA  `abrirFolha` lia "zero linhas" como "não existe" e criava.
//            Zero linhas também é o que o RLS devolve quando a folha existe e
//            você não pode vê-la. Ausência e invisibilidade são coisas
//            diferentes, e confundi-las foi o que duplicou a folha.
//
// Como na 4B, pessoa e organização têm UUIDs DIFERENTES no dublê. Com os dois
// iguais — o caso do proprietário — todo teste deste arquivo passaria com o
// código errado, que foi exatamente o que deixou o bug chegar em produção.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { sb, rpc, tabela, limpar, chamadas } from './duble-supabase.mjs';
import { limparOrganizacao } from '../js/organizacao.js';
import { criarFolha, abrirFolha, adicionarItem, adicionarAdicional } from '../js/folha.js';
import { criarFuncionario } from '../js/funcionarios.js';
import { guardarPendente } from '../js/documentos.js';

const ler = f => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');

const USUARIO = 'nutri-teste';                    // o que o dublê devolve em auth.getUser()
const ORGANIZACAO = 'org-4c-distinta-do-usuario'; // DIFERENTE, e é esse o ponto

function preparar() {
  limpar();
  limparOrganizacao();
  rpc('organizacao_do_auth', () => ORGANIZACAO);
  tabela('folhas', []);
  tabela('folha_itens', []);
  tabela('folha_adicionais', []);
  tabela('funcionarios', []);
  tabela('colaborador_documentos', []);
  tabela('documentos_pendentes', []);
}

const ultima = nome => [...chamadas].reverse().find(c => c.tabela === nome);
const ultimoInsert = () => [...chamadas].reverse().find(c => c.operacao === 'insert');
const filtroDe = (reg, coluna) =>
  (reg?.filtros || []).find(f => f.tipo === 'eq' && f.coluna === coluna)?.valor;

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · pessoa e organização são diferentes', () => {
  teste('o dublê separa os dois uuid', async () => {
    preparar();
    const { data: { user } } = await sb.auth.getUser();
    igual(user.id, USUARIO);
    ok(USUARIO !== ORGANIZACAO,
       'com os dois iguais, todo teste deste arquivo passa com o código errado');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · abrirFolha não cria mais às cegas', () => {
  // O teste do incidente. É o mais importante do arquivo.
  teste('sem folha visível e sem pedir para criar, ESTOURA em vez de duplicar', async () => {
    preparar();
    let erro = null;
    try { await abrirFolha('2026-09-01', []); } catch (e) { erro = e; }
    ok(erro, 'tem que falhar — zero linhas pode ser RLS escondendo, não ausência');
    igual(erro.message, 'folha_nao_encontrada');
    ok(!chamadas.some(c => c.tabela === 'folhas' && c.operacao === 'insert'),
       'CRIOU UMA FOLHA — é exatamente o bug que gerou a fantasma de 02/09/2026');
  });

  teste('com criar: true, aí sim cria', async () => {
    preparar();
    await abrirFolha('2026-09-01', [], { criar: true });
    const ins = chamadas.find(c => c.tabela === 'folhas' && c.operacao === 'insert');
    ok(ins, 'o botão de abrir o mês tem que continuar funcionando');
  });

  teste('folha visível é usada, não recriada', async () => {
    preparar();
    tabela('folhas', [{ id: 'f1', competencia: '2026-09-01', status: 'rascunho' }]);
    const r = await abrirFolha('2026-09-01', []);
    igual(r.folha.id, 'f1');
    ok(!chamadas.some(c => c.tabela === 'folhas' && c.operacao === 'insert'));
  });

  teste('só a tela de folha pede para criar', () => {
    // Se outra chamada passar `criar: true`, o caminho da duplicação volta.
    const ui = ler('folha-ui.js');
    igual((ui.match(/criar:\s*true/g) || []).length, 1);
    contem(ui, 'abrirFolha(competencia, _equipe, { criar: true })');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · os INSERTs não escolhem o dono', () => {
  const SEM_DONO = [
    ['criarFolha',        () => criarFolha('2026-09-01'),                          'folhas'],
    ['adicionarItem',     () => adicionarItem('f1', { id: 'x', valor_hora: 10 }),  'folha_itens'],
    ['adicionarAdicional', () => adicionarAdicional('i1', { descricao: 'b', valor: 1 }), 'folha_adicionais'],
    ['criarFuncionario',  () => criarFuncionario({ nome: 'Fulano' }),              'funcionarios'],
  ];

  for (const [nome, chamar, alvo] of SEM_DONO) {
    teste(`${nome} não injeta nutri_id`, async () => {
      preparar();
      await chamar();
      const payload = ultima(alvo)?.payload || {};
      const linhas = Array.isArray(payload) ? payload : [payload];
      for (const l of linhas) {
        ok(!('nutri_id' in l), `${nome} mandou nutri_id: ${JSON.stringify(l)}`);
      }
    });
  }

  teste('as linhas que abrirFolha lança também não trazem dono', async () => {
    preparar();
    tabela('folhas', [{ id: 'f1', competencia: '2026-09-01', status: 'rascunho' }]);
    await abrirFolha('2026-09-01', [{ id: 'func1', salario_fixo: 2000 }]);
    const ins = [...chamadas].reverse().find(c => c.tabela === 'folha_itens' && c.operacao === 'insert');
    ok(ins, 'era para ter lançado a linha do funcionário que faltava');
    for (const l of ins.payload) ok(!('nutri_id' in l), JSON.stringify(l));
  });

  teste('as quatro assinaturas perderam o parâmetro de dono', () => {
    const folha = ler('folha.js');
    contem(folha, 'export async function criarFolha(competencia)');
    contem(folha, 'export async function adicionarItem(folhaId, funcionario)');
    contem(folha, 'export async function adicionarAdicional(itemId, {');
    contem(ler('funcionarios.js'), 'export async function criarFuncionario(dados)');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · o caminho no Storage é o da organização', () => {
  // A policy do bucket confere o PRIMEIRO pedaço do caminho contra o dono
  // (`(storage.foldername(name))[1] = auth.uid()::text`). Se o frontend montar
  // o caminho com o uuid da pessoa, o arquivo vai para uma pasta que ninguém
  // mais da organização enxerga — a mesma fantasma da folha, com arquivo.
  teste('guardarPendente sobe para a pasta da organização', async () => {
    preparar();
    await guardarPendente({
      competencia: '2026-09-01',
      conteudo: new Blob(['x'], { type: 'application/pdf' }),
      nomeArquivo: 'ponto.pdf',
    });
    const up = [...chamadas].reverse().find(c => c.operacao === 'upload');
    ok(up, 'nada subiu');
    igual(String(up.payload).split('/')[0], ORGANIZACAO);
    ok(!String(up.payload).startsWith(USUARIO),
       'o arquivo foi para a pasta da PESSOA — invisível para a organização');
  });

  teste('a linha do pendente também nasce sem dono escolhido pela tela', async () => {
    preparar();
    await guardarPendente({
      competencia: '2026-09-01',
      conteudo: new Blob(['x'], { type: 'application/pdf' }),
      nomeArquivo: 'ponto.pdf',
    });
    const payload = ultima('documentos_pendentes')?.payload || {};
    igual(payload.nutri_id, ORGANIZACAO);
  });

  teste('os construtores de caminho continuam PUROS', () => {
    // Eles recebem o dono e devolvem string. Torná-los async só para buscar a
    // organização transformaria um teste de string num teste de rede — e
    // `vincularPendente` precisa passar o dono da LINHA, não o da sessão.
    const doc = ler('documentos.js');
    contem(doc, 'export function caminhoDoDocumento({ nutriId, colaboradorId');
    contem(doc, 'export function caminhoPendente({ nutriId, competencia, arquivo })');
    contem(doc, 'nutriId: pendente.nutri_id');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · o encanamento morreu', () => {
  const DO_MODULO = [
    'folha.js', 'folha-ui.js', 'funcionarios.js', 'funcionarios-ui.js',
    'ponto-ui.js', 'documentos-central.js', 'equipe-admin-ui.js', 'resumo-ui.js',
    'contracheque-arquivo.js',
  ];

  teste('nenhum arquivo do módulo guarda _nutriId', () => {
    for (const f of DO_MODULO) naoContem(ler(f), '_nutriId', `${f} ainda encana o dono`);
  });

  teste('as entradas das telas não recebem mais dono', () => {
    contem(ler('equipe-admin-ui.js'), "export async function initEquipeUI(secao = 'resumo')");
    contem(ler('folha-ui.js'), 'export async function initFolhaUI(containerId, opcoes = {})');
    contem(ler('ponto-ui.js'), 'export async function initPontoUI(containerId, opcoes = {})');
    contem(ler('documentos-central.js'), 'export async function initDocumentosCentralUI(containerId)');
    contem(ler('resumo-ui.js'), 'export async function initResumoUI(containerId)');
  });

  teste('index.html não passa mais a sessão para a Equipe', () => {
    const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    contem(idx, "await initEquipeUI(secao || 'resumo')");
    naoContem(idx, 'initEquipeUI(sessao');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · as leituras continuam a cargo do RLS', () => {
  teste('buscarFolhaPorCompetencia não filtra nutri_id no cliente', async () => {
    preparar();
    tabela('folhas', [{ id: 'f1', competencia: '2026-09-01', status: 'rascunho' }]);
    await abrirFolha('2026-09-01', []);
    const leitura = chamadas.find(c => c.tabela === 'folhas' && c.operacao === 'select');
    igual(filtroDe(leitura, 'nutri_id'), undefined,
      'compensar RLS no frontend é segurança que o DevTools desliga');
  });

  teste('o módulo não passou a se autorizar por permissão nenhuma', () => {
    // Quem decide é a policy, na Fase 2. Frontend checando permissão daria uma
    // falsa sensação de trava e divergiria do banco no primeiro ajuste.
    for (const f of ['folha.js', 'funcionarios.js', 'documentos.js']) {
      naoContem(ler(f), 'tem_permissao');
      naoContem(ler(f), 'equipe.folha');
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 1 · a Fase 2 ainda não aconteceu', () => {
  teste('nenhum arquivo da Fase 1 escreve SQL', () => {
    for (const f of ['folha.js', 'funcionarios.js', 'documentos.js', 'equipe-admin-ui.js']) {
      naoContem(ler(f), 'create policy');
      naoContem(ler(f), 'alter table');
    }
  });

  teste('a RLS do módulo continua em auth.uid()', () => {
    // Enquanto isto for verdade, a conta de RH vê a tela e não vê o dado. A
    // Fase 1 sozinha não resolve o incidente — ela só para de piorá-lo.
    const schema = readFileSync(new URL('../db/folha_schema.sql', import.meta.url), 'utf8');
    contem(schema, 'nutri_id = auth.uid()');
    naoContem(schema, 'organizacao_do_auth');
  });
});
