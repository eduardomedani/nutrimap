// ═══════════════════════════════════════════════════════════
// ETAPA 4B · FASE 1 — o frontend deixa de supor nutri_id = auth.uid()
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é o Comercial abrir POVOADO para quem não é o
// proprietário. Antes da Fase 1, `comercial-data.js` pedia
// `nutri_id = <uuid da pessoa logada>`: para a Recepção nenhuma linha tinha
// esse uuid, e a tela abria vazia SEM ERRO NENHUM.
//
// ═══════════════════════════════════════════════════════════
// POR QUE OS DOIS UUID SÃO DIFERENTES AQUI, E TÊM QUE CONTINUAR SENDO
// -----------------------------------------------------------
// Para o proprietário, `auth.uid()` e a organização são O MESMO uuid. Um teste
// escrito com os dois iguais PASSA COM O CÓDIGO ERRADO — foi exatamente essa
// coincidência que deixou o bug invisível em produção até a primeira conta de
// Recepção receber acesso.
//
// Então o dublê responde `auth.getUser()` com USUARIO e a RPC
// `organizacao_do_auth` com ORGANIZACAO, que são deliberadamente distintos. O
// primeiro teste do arquivo falha se alguém aproximar os dois.
// ═══════════════════════════════════════════════════════════

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { sb, rpc, tabela, limpar, chamadas } from './duble-supabase.mjs';
import { limparOrganizacao } from '../js/organizacao.js';
import {
  listarAssinaturas, assinaturaDoPaciente, criarAssinatura, salvarAssinatura,
  cobrancasDaAssinatura, receitasDeClientes, criarCobranca, editarCobranca,
  pacientesSemAssinatura, assinaturasComCobrancaAberta, categoriasDeReceita,
} from '../js/comercial-data.js';
import { criarPaciente, listarPacientes, excluirPaciente } from '../js/pacientes.js';
import {
  criarDespesa, criarLancamento, criarCategoria, criarCentroCusto, listarLancamentos,
} from '../js/financeiro.js';

const ler = f => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
const COMERCIAL_JS = ler('comercial-data.js');
const PACIENTES_JS = ler('pacientes.js');
const FINANCEIRO_JS = ler('financeiro.js');

/** O uuid que o dublê devolve em `auth.getUser()`. */
const USUARIO = 'nutri-teste';
/** O uuid da organização — DIFERENTE, e é esse o ponto. */
const ORGANIZACAO = 'org-4b-distinta-do-usuario';

/** Zera o dublê e o cache de `organizacaoAtual()`, que guarda o valor por
 *  sessão — sem isto o segundo teste leria a organização do primeiro. */
function preparar() {
  limpar();
  limparOrganizacao();
  rpc('organizacao_do_auth', () => ORGANIZACAO);
  rpc('gerar_codigo_paciente', () => 'ABC123');
  rpc('comercial_criar_cobranca_do_periodo', () => ({ cobranca: {}, assinatura: {}, programou: false }));
  tabela('comercial_assinaturas', []);
  tabela('financeiro_lancamentos', []);
  tabela('financeiro_categorias', []);
  tabela('pacientes', []);
}

/** O último acesso registrado a uma tabela. */
const ultima = nome => [...chamadas].reverse().find(c => c.tabela === nome);

/** O valor com que uma coluna foi filtrada, ou undefined se não foi. */
function filtroDe(registro, coluna) {
  return (registro?.filtros || []).find(f => f.tipo === 'eq' && f.coluna === coluna)?.valor;
}

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o dublê separa pessoa de organização', () => {
  teste('usuário autenticado e organização têm UUIDs diferentes', async () => {
    preparar();
    const { data: { user } } = await sb.auth.getUser();
    igual(user.id, USUARIO);
    ok(USUARIO !== ORGANIZACAO,
       'se os dois uuid forem iguais, TODO teste deste arquivo passa com o código errado');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o Comercial resolve pela organização', () => {
  // Cada leitura do módulo tem que filtrar pela ORGANIZAÇÃO. Filtrar pelo
  // usuário é o bug que deixou a tela da Recepção vazia.
  const LEITURAS = [
    ['listarAssinaturas',          () => listarAssinaturas(),                'comercial_assinaturas'],
    ['assinaturaDoPaciente',       () => assinaturaDoPaciente('p1'),         'comercial_assinaturas'],
    ['cobrancasDaAssinatura',      () => cobrancasDaAssinatura('a1'),        'financeiro_lancamentos'],
    ['receitasDeClientes',         () => receitasDeClientes({}),             'financeiro_lancamentos'],
    ['assinaturasComCobrancaAberta', () => assinaturasComCobrancaAberta(),   'comercial_assinaturas'],
    ['categoriasDeReceita',        () => categoriasDeReceita(),              'financeiro_categorias'],
  ];

  for (const [nome, chamar, tabelaAlvo] of LEITURAS) {
    teste(`${nome} filtra pela organização, não pelo usuário`, async () => {
      preparar();
      await chamar();
      const reg = ultima(tabelaAlvo);
      ok(reg, `${nome} não tocou em ${tabelaAlvo}`);
      igual(filtroDe(reg, 'nutri_id'), ORGANIZACAO);
      ok(filtroDe(reg, 'nutri_id') !== USUARIO,
         `${nome} filtrou pelo uuid da PESSOA — é o bug da Etapa 4B`);
    });
  }

  teste('pacientesSemAssinatura pede as duas tabelas pela organização', async () => {
    preparar();
    await pacientesSemAssinatura();
    for (const t of ['pacientes', 'comercial_assinaturas']) {
      igual(filtroDe(ultima(t), 'nutri_id'), ORGANIZACAO);
    }
  });

  teste('as escritas com WHERE também usam a organização', async () => {
    preparar();
    await salvarAssinatura('a1', { valor_contratado: 10 });
    igual(filtroDe(ultima('comercial_assinaturas'), 'nutri_id'), ORGANIZACAO);

    preparar();
    await editarCobranca('c1', { valor: 10 });
    igual(filtroDe(ultima('financeiro_lancamentos'), 'nutri_id'), ORGANIZACAO);
  });

  teste('nenhuma função do módulo lê auth.getUser()', () => {
    // `auth.getUser()` no Comercial é a suposição inteira em uma linha: quem o
    // chama está prestes a usar o uuid da pessoa como dono do dado.
    naoContem(COMERCIAL_JS, 'auth.getUser',
      'o dono do dado é a organização — resolver pela sessão traz o uuid errado');
    naoContem(COMERCIAL_JS, 'nutriId');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · os INSERTs não escolhem o dono', () => {
  teste('criarAssinatura não injeta nutri_id', async () => {
    preparar();
    await criarAssinatura({ paciente_id: 'p1', plano_id: 'pl1' });
    const payload = ultima('comercial_assinaturas')?.payload || {};
    ok(!('nutri_id' in payload),
       `criarAssinatura mandou nutri_id: ${JSON.stringify(payload)}`);
  });

  teste('criarCobranca não injeta nutri_id', async () => {
    preparar();
    await criarCobranca({
      assinatura: { id: 'a1', paciente_id: 'p1', inicio_periodo: '2026-08-01', fim_periodo: '2026-08-31' },
      vencimento: '2026-08-31', valor: 330,
    });
    const payload = ultima('financeiro_lancamentos')?.payload || {};
    ok(!('nutri_id' in payload),
       `criarCobranca mandou nutri_id: ${JSON.stringify(payload)}`);
  });

  teste('as escritas do Financeiro não injetam nutri_id', async () => {
    for (const chamar of [
      () => criarDespesa({ descricao: 'x', valor: 1 }),
      () => criarLancamento({ data: '2026-08-01', descricao: 'x', valor: 1 }),
      () => criarCategoria({ nome: 'x' }),
    ]) {
      preparar();
      await chamar();
      const reg = [...chamadas].reverse().find(c => c.operacao === 'insert');
      ok(!('nutri_id' in (reg?.payload || {})),
         `insert mandou nutri_id: ${JSON.stringify(reg?.payload)}`);
    }

    preparar();
    await criarCentroCusto('x');
    ok(!('nutri_id' in (ultima('financeiro_centros_custo')?.payload || {})));
  });

  teste('as quatro funções de escrita do Financeiro não recebem mais dono', () => {
    // Receber o dono por PARÂMETRO é dar a uma tela o poder de escolher de quem
    // é a linha — por engano ou por request adulterado.
    for (const assinatura of [
      'export async function criarLancamento(dados)',
      'export async function criarDespesa(campos)',
      'export async function criarCentroCusto(nome)',
      'export async function criarCategoria({ nome',
    ]) {
      contem(FINANCEIRO_JS, assinatura);
    }
  });

  teste('criarPaciente não injeta nutri_id', async () => {
    // ESTE TESTE MUDOU DUAS VEZES, e a história é a explicação.
    //
    // Antes da 4B, `criarPaciente` mandava `user.id` — o uuid da PESSOA. Um
    // insert de quem não fosse o dono criava, em silêncio, um paciente que o
    // resto da organização não enxergava.
    //
    // Na Fase 1 ele passou a mandar a ORGANIZAÇÃO, e o campo continuou sendo
    // enviado porque `pacientes.nutri_id` era `not null` SEM DEFAULT: parar de
    // mandar teria quebrado o cadastro na hora.
    //
    // Depois da Fase 2 a coluna ganhou `default organizacao_do_auth()`, e agora
    // o campo não vai — quem determina o tenant é o banco, que é o padrão da
    // Etapa 4 desde o piloto em `criarPlano`.
    preparar();
    await criarPaciente({ nome: 'Fulano' });
    const payload = ultima('pacientes')?.payload || {};
    ok(!('nutri_id' in payload),
       `criarPaciente mandou nutri_id: ${JSON.stringify(payload)}`);
    igual(payload.codigo, 'ABC123', 'o resto do payload continua indo');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · as leituras continuam a cargo do RLS', () => {
  teste('o Financeiro não filtra nutri_id no cliente', async () => {
    // Este módulo sempre dependeu do RLS para isolar, e isso é o desenho certo:
    // a Fase 2 troca a policy sem tocar nesta camada. Acrescentar filtro aqui
    // seria compensar RLS no frontend — segurança que o DevTools desliga.
    preparar();
    await listarLancamentos({});
    igual(filtroDe(ultima('financeiro_lancamentos'), 'nutri_id'), undefined);
  });

  teste('listarPacientes não filtra nutri_id no cliente', async () => {
    preparar();
    await listarPacientes();
    igual(filtroDe(ultima('pacientes'), 'nutri_id'), undefined);
  });

  teste('o Comercial mantém o filtro explícito — e isso NÃO é compensar RLS', () => {
    // A conta do proprietário é nutri E paciente ao mesmo tempo, e as policies
    // do projeto são OR'd: sem o filtro explícito a consulta devolveria dado de
    // mais. O filtro é a primeira camada; o RLS é a segunda. A Fase 1 mudou o
    // VALOR filtrado, não o desenho.
    contem(COMERCIAL_JS, ".eq('nutri_id', id)");
    contem(COMERCIAL_JS, 'await organizacaoAtual()');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o Comercial não ganha o fluxo de caixa', () => {
  teste('receitasDeClientes só olha cobrança de assinatura', async () => {
    // É o recorte que a Fase 2 vai transformar em policy: cobrança ligada a
    // assinatura abre para `comercial.visualizar`; o resto continua do
    // Financeiro. Se esta leitura passasse a trazer lançamento solto, a policy
    // nasceria vazando caixa.
    preparar();
    await receitasDeClientes({});
    const reg = ultima('financeiro_lancamentos');
    ok((reg.filtros || []).some(f => f.tipo === 'not-null' && f.coluna === 'assinatura_id'),
       'receitasDeClientes precisa exigir assinatura_id não nulo');
    igual(filtroDe(reg, 'tipo'), 'receita');
  });

  teste('lançamento comum do Financeiro não nasce ligado a assinatura', async () => {
    preparar();
    await criarDespesa({ descricao: 'Aluguel', valor: 100 });
    const payload = ultima('financeiro_lancamentos')?.payload || {};
    ok(!payload.assinatura_id,
       'despesa com assinatura_id entraria no recorte que a Fase 2 abre para o Comercial');
  });

  teste('o Financeiro não passa a se autorizar por permissão do Comercial', () => {
    naoContem(FINANCEIRO_JS, 'comercial.visualizar');
    naoContem(FINANCEIRO_JS, 'comercial.editar');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o clínico não abre junto', () => {
  // `clientes.visualizar` dá o CADASTRO. Prontuário, anamnese, avaliação, plano
  // alimentar e documento são outras chaves — é o §25 da Etapa 1. Nenhum módulo
  // clínico pode passar a se autorizar pela chave de cadastro.
  // `documentos.js` NÃO entra nesta lista, apesar do nome. Ele é o repositório
  // de documentos do COLABORADOR — folha de ponto, contracheque, bucket
  // 'colaborador-documentos'. O clínico é `paciente-documentos.js`.
  //
  // A primeira versão desta lista confundiu os dois, e o erro só apareceu na
  // Etapa 4C, quando `documentos.js` legitimamente passou a resolver pelo
  // tenant e o teste acusou "módulo clínico migrado". O teste estava certo em
  // disparar; a lista é que estava errada.
  const CLINICOS = [
    'avaliacoes.js', 'dieta.js', 'treinos.js',
    'paciente-documentos.js', 'ficha.js',
  ];

  teste('nenhum módulo clínico se autoriza por clientes.visualizar', () => {
    for (const f of CLINICOS) {
      let fonte;
      try { fonte = ler(f); } catch { continue; }
      naoContem(fonte, 'clientes.visualizar',
        `${f} não pode usar a chave de cadastro como autorização clínica`);
    }
  });

  teste('a Fase 1 não tocou em nenhum módulo clínico', () => {
    // Se um deles tivesse ganhado organizacaoAtual(), o dado clínico passaria a
    // ser resolvido pelo tenant — e a Fase 2 abriria prontuário junto com
    // cadastro, sem ninguém ter decidido isso.
    for (const f of CLINICOS) {
      let fonte;
      try { fonte = ler(f); } catch { continue; }
      naoContem(fonte, 'organizacaoAtual',
        `${f} passou a resolver pelo tenant — decisão que a Fase 1 não tem`);
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · excluir paciente continua fora do alcance', () => {
  teste('excluirPaciente não ganhou filtro de organização', async () => {
    // A exclusão continua 100% a cargo do RLS, cuja policy de DELETE segue em
    // `auth.uid() = nutri_id` — ou seja, só o proprietário. Acrescentar um
    // filtro por organização aqui daria à Recepção uma exclusão que a Fase 2
    // teria de tirar de volta.
    preparar();
    await excluirPaciente('p1');
    const reg = ultima('pacientes');
    igual(reg.operacao, 'delete');
    igual(filtroDe(reg, 'nutri_id'), undefined);
    igual(filtroDe(reg, 'id'), 'p1');
  });

  teste('o Comercial não apaga paciente', () => {
    naoContem(COMERCIAL_JS, "from('pacientes').delete");
    naoContem(COMERCIAL_JS, '.delete()');
  });

  teste('pacientes.js não passou a resolver exclusão pela organização', () => {
    const corpo = PACIENTES_JS.slice(PACIENTES_JS.indexOf('export async function excluirPaciente'));
    const fim = corpo.indexOf('\n}');
    naoContem(corpo.slice(0, fim), 'organizacaoAtual');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o proprietário continua compatível', () => {
  teste('com organização = auth.uid(), tudo funciona como antes', async () => {
    // O caso real de hoje: para o proprietário os dois uuid coincidem, e a
    // policy antiga (`nutri_id = auth.uid()`) tem que continuar aceitando o que
    // o frontend novo pede. É isto que garante que a Fase 1 pode ir para
    // produção ANTES da Fase 2, sem janela de quebra.
    limpar();
    limparOrganizacao();
    rpc('organizacao_do_auth', () => USUARIO);
    tabela('comercial_assinaturas', [{ id: 'a1', nutri_id: USUARIO, status: 'ativa' }]);

    const lista = await listarAssinaturas();
    igual(filtroDe(ultima('comercial_assinaturas'), 'nutri_id'), USUARIO);
    igual(lista.length, 1);
  });

  teste('sem organização, a chamada falha em vez de devolver dado de outro', async () => {
    limpar();
    limparOrganizacao();
    rpc('organizacao_do_auth', () => null);
    let erro = null;
    try { await listarAssinaturas(); } catch (e) { erro = e; }
    ok(erro, 'sem vínculo a leitura tem que falhar, não devolver lista vazia silenciosa');
    igual(erro.message, 'sem_organizacao');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 1 · o que a Fase 1 não faz', () => {
  teste('a Fase 1 não contém SQL — ela é só frontend', () => {
    // Este teste JÁ EXIGIU que db/multiusuario_etapa4b_rls.sql não existisse.
    // Exigir isso deixou de fazer sentido quando a Fase 2 foi escrita: os dois
    // arquivos convivem no repositório e são aplicados em ordem, não ao mesmo
    // tempo. O que continua valendo é que nenhum arquivo da Fase 1 escreve SQL.
    for (const f of ['comercial-data.js', 'pacientes.js', 'financeiro.js']) {
      const fonte = ler(f);
      naoContem(fonte, 'create policy');
      naoContem(fonte, 'alter table');
    }
  });

  teste('o default de pacientes.nutri_id vem da 4B, não do baseline', () => {
    // O baseline continua descrevendo a coluna SEM default — ele é o retrato do
    // que existia antes, e não se reescreve história. Quem põe o default é a
    // Fase 2, e é dela que `criarPaciente` depende para poder omitir o campo.
    const baseline = readFileSync(new URL('../db/pacientes_legacy_baseline.sql', import.meta.url), 'utf8');
    const coluna = /nutri_id\s+uuid\s+not null([^,]*)/.exec(baseline);
    ok(coluna, 'não achei a coluna nutri_id no baseline de pacientes');
    ok(!/default/i.test(coluna[1]), 'o baseline não deve ganhar default retroativo');

    const rls = readFileSync(new URL('../db/multiusuario_etapa4b_rls.sql', import.meta.url), 'utf8');
    contem(rls, 'alter table public.pacientes\n  alter column nutri_id set default public.organizacao_do_auth();');
    naoContem(PACIENTES_JS, 'nutri_id:');
  });
});
