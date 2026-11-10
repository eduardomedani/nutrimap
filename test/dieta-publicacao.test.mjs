// ═══════════════════════════════════════════════════════════
// Dieta — nada é publicado sem ação explícita do profissional
// ═══════════════════════════════════════════════════════════
// `ativo` = visível no app do paciente (policy planos_paciente_read). Antes
// desta correção, cinco caminhos publicavam sozinhos: gerar plano, salvar metas
// sem plano, usar modelo, criar pelo formulário (seletor vinha em "Ativo") e
// editar um plano já publicado (mudava ao vivo). Estes testes travam os cinco.
//
// LIMITE: isto testa o FRONT. O banco ainda aceita UPDATE direto em `ativo`
// pela API (policy planos_owner). O controle no servidor depende da migration.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grupo, teste, ok, igual } from './runner.mjs';
import { tabela, limpar, chamadas, rpc } from './duble-supabase.mjs';

// Antes da migration a RPC não existe: o PostgREST responde PGRST202.
const semRpcNoBanco = () => {
  for (const n of ['rpc_dieta_publicar', 'rpc_dieta_retirar']) {
    rpc(n, () => { throw new Error(`Could not find the function public.${n}(p_plano_id) in the schema cache`); });
  }
};
import {
  criarPlano, prescreverModeloParaPaciente, publicarVersao, criarNovaVersao,
  gerarPlanoParaPaciente, retirarDoApp, ehRpcAusente, PUBLICACAO,
} from '../js/dieta.js';
import { planoDasMetas } from '../js/calorias-ui.js';
import { planoPublicado } from '../js/dieta-ui.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (f) => readFileSync(resolve(RAIZ, f), 'utf8');

const inserts = (t) => chamadas.filter(c => c.tabela === t && c.operacao === 'insert');
const updates = (t) => chamadas.filter(c => c.tabela === t && c.operacao === 'update');
const idDoFiltro = (c) => c.filtros.find(f => f.coluna === 'id')?.valor;

// ── Corpo de cada função de um arquivo, pelo nome ─────────────
function corpos(src) {
  const re = /(?:^|\n)(?:export )?(?:async )?function (\w+)\s*\([^)]*\)\s*\{/g;
  const marcas = [];
  let m;
  while ((m = re.exec(src))) marcas.push({ nome: m[1], ini: m.index });
  return marcas.map((x, i) => ({ nome: x.nome, corpo: src.slice(x.ini, marcas[i + 1]?.ini ?? src.length) }));
}

// ═══════════════════════════════════════════════════════════
grupo('dieta · publicação · camada de dados', () => {
  teste('plano de paciente nasce fora do app, mesmo se pedirem ativo', async () => {
    limpar();
    await criarPlano('n1', { nome: 'X', paciente_id: 'p1', ativo: true });
    igual(inserts('planos_alimentares')[0].payload.ativo, false);
  });

  teste('plano de paciente sem `ativo` não herda o default true da coluna', async () => {
    limpar();
    await criarPlano('n1', { nome: 'X', paciente_id: 'p1' });
    igual(inserts('planos_alimentares')[0].payload.ativo, false);
  });

  teste('modelo da biblioteca não é afetado (não tem app)', async () => {
    limpar();
    await criarPlano('n1', { nome: 'Modelo', ativo: true });
    igual(inserts('planos_alimentares')[0].payload.ativo, true);
  });

  teste('gerador cria rascunho e não mexe em nenhum outro plano', async () => {
    limpar();
    tabela('foods', [{ id: 'f1', nome: 'Arroz, tipo 1, cozido', calorias: 128, proteina: 2.5, carboidrato: 28, gordura: 0.2, nutri_id: null }]);
    await gerarPlanoParaPaciente('n1', { pacienteId: 'p1', metas: { kcal: 1800, prot: 120, carb: 200, gord: 60 } });
    igual(inserts('planos_alimentares')[0].payload.ativo, false);
    igual(updates('planos_alimentares').length, 0, 'nenhum plano pode ser ativado ou desativado');
  });

  teste('usar modelo cria rascunho; não existe opção de nascer publicado', async () => {
    limpar();
    tabela('planos_alimentares', [{ id: 'm1', nutri_id: 'n1', paciente_id: null, nome: 'Modelo', ativo: true }]);
    tabela('plano_refeicoes', []);
    await prescreverModeloParaPaciente('m1', 'p1', { ativo: true });
    const ins = inserts('planos_alimentares');
    igual(ins.length, 1);
    igual(ins[0].payload.ativo, false);
    igual(ins[0].payload.paciente_id, 'p1');
  });

  teste('a cópia leva as refeições alternativas: principal antes, com instrução', async () => {
    limpar();
    tabela('planos_alimentares', [{ id: 'm1', nutri_id: 'n1', paciente_id: null, nome: 'Modelo' }]);
    tabela('plano_refeicoes', [
      { id: 'alt', plano_id: 'm1', nome: 'Vitamina', ordem: 2, substitui_refeicao_id: 'cafe', instrucao: 'Fora de casa', itens: [] },
      { id: 'cafe', plano_id: 'm1', nome: 'Café', ordem: 1, substitui_refeicao_id: null, itens: [] },
    ]);
    await prescreverModeloParaPaciente('m1', 'p1');
    const refs = inserts('plano_refeicoes').map(c => c.payload);
    igual(refs.map(r => r.nome), ['Café', 'Vitamina'], 'a principal é criada primeiro');
    igual(refs[1].instrucao, 'Fora de casa');
  });

  teste('nova versão é rascunho do MESMO paciente; a publicada não é tocada', async () => {
    limpar();
    tabela('planos_alimentares', [{ id: 'v1', nutri_id: 'n1', paciente_id: 'p1', nome: 'Plano', ativo: true }]);
    tabela('plano_refeicoes', []);
    await criarNovaVersao('v1');
    const ins = inserts('planos_alimentares')[0].payload;
    igual([ins.paciente_id, ins.ativo], ['p1', false]);
    igual(updates('planos_alimentares').length, 0);
  });

  teste('publicar: a nova entra ANTES de a anterior sair (o app nunca fica vazio)', async () => {
    limpar();
    semRpcNoBanco();
    tabela('planos_alimentares', [
      { id: 'novo', paciente_id: 'p1', ativo: false, nome: 'v2' },
      { id: 'velho', paciente_id: 'p1', ativo: true, nome: 'v1' },
      { id: 'outro', paciente_id: 'p2', ativo: true, nome: 'de outro paciente' },
    ]);
    tabela('plano_refeicoes', [{ id: 'r1', plano_id: 'novo', itens: [{ id: 'i1' }] }]);
    await publicarVersao('novo');
    const ups = updates('planos_alimentares').map(c => [idDoFiltro(c), c.payload.ativo]);
    igual(ups, [['novo', true], ['velho', false]]);
  });

  teste('plano sem nenhum alimento não é publicado', async () => {
    limpar();
    tabela('planos_alimentares', [{ id: 'vazio', paciente_id: 'p1', ativo: false }]);
    tabela('plano_refeicoes', [{ id: 'r1', plano_id: 'vazio', itens: [] }]);
    let erro = null;
    try { await publicarVersao('vazio'); } catch (e) { erro = e; }
    ok(erro, 'deveria recusar');
    igual(updates('planos_alimentares').length, 0);
  });

  teste('modelo da biblioteca não é publicado para paciente', async () => {
    limpar();
    tabela('planos_alimentares', [{ id: 'm1', paciente_id: null, ativo: true }]);
    let erro = null;
    try { await publicarVersao('m1'); } catch (e) { erro = e; }
    ok(erro);
  });

  teste('retirar do app só desativa; nada é apagado', async () => {
    limpar();
    semRpcNoBanco();
    await retirarDoApp('v1');
    igual(updates('planos_alimentares').map(c => c.payload), [{ ativo: false }]);
    igual(chamadas.filter(c => c.operacao === 'delete').length, 0);
  });

  teste('com a RPC no banco, publicar vai SÓ por ela (nenhum UPDATE direto)', async () => {
    limpar();
    rpc('rpc_dieta_publicar', ({ p_plano_id }) => [{ id: p_plano_id, ativo: true, status: 'publicado' }]);
    tabela('planos_alimentares', [{ id: 'novo', paciente_id: 'p1', ativo: false }]);
    tabela('plano_refeicoes', [{ id: 'r1', plano_id: 'novo', itens: [{ id: 'i1' }] }]);
    const r = await publicarVersao('novo');
    igual(r.status, 'publicado');
    igual(updates('planos_alimentares').length, 0);
    igual(chamadas.filter(c => c.operacao === 'rpc').map(c => c.payload), [{ p_plano_id: 'novo' }]);
  });

  teste('permissão negada pela RPC SOBE: não cai no caminho direto', async () => {
    limpar();
    rpc('rpc_dieta_publicar', () => { throw new Error('sem permissao para publicar plano alimentar'); });
    tabela('planos_alimentares', [{ id: 'novo', paciente_id: 'p1', ativo: false }]);
    tabela('plano_refeicoes', [{ id: 'r1', plano_id: 'novo', itens: [{ id: 'i1' }] }]);
    let erro = null;
    try { await publicarVersao('novo'); } catch (e) { erro = e; }
    ok(erro && /permissao/.test(erro.message));
    igual(updates('planos_alimentares').length, 0);
  });

  teste('com a RPC no banco, retirar do app vai só por ela', async () => {
    limpar();
    rpc('rpc_dieta_retirar', ({ p_plano_id }) => ({ id: p_plano_id, ativo: false, status: 'arquivado' }));
    await retirarDoApp('v1');
    igual(updates('planos_alimentares').length, 0);
  });

  teste('modo somente-servidor: RPC ausente BLOQUEIA (nenhum caminho alternativo)', async () => {
    const antes = PUBLICACAO.somenteServidor;
    PUBLICACAO.somenteServidor = true;
    try {
      for (const [fn, args] of [[publicarVersao, ['novo']], [retirarDoApp, ['novo']]]) {
        limpar();
        semRpcNoBanco();
        tabela('planos_alimentares', [{ id: 'novo', paciente_id: 'p1', ativo: false }]);
        tabela('plano_refeicoes', [{ id: 'r1', plano_id: 'novo', itens: [{ id: 'i1' }] }]);
        let erro = null;
        try { await fn(...args); } catch (e) { erro = e; }
        ok(erro && /bloqueada/.test(erro.message), `${fn.name} deveria bloquear`);
        igual(updates('planos_alimentares').length, 0, `${fn.name} não pode fazer UPDATE direto`);
      }
    } finally {
      PUBLICACAO.somenteServidor = antes;
    }
  });

  teste('hoje (antes da migration) o modo é o de transição', () => {
    // Virar para true é o commit seguinte à migration confirmada em produção.
    // Se este teste falhar, alguém virou o modo: confira se a migration já
    // está aplicada e, se estiver, atualize este teste junto.
    igual(PUBLICACAO.somenteServidor, false);
  });

  teste('só "função inexistente" libera o caminho antigo', () => {
    ok(ehRpcAusente({ code: 'PGRST202', message: 'x' }));
    ok(ehRpcAusente({ code: '42883', message: 'x' }));
    ok(ehRpcAusente({ message: 'Could not find the function public.rpc_dieta_publicar' }));
    ok(!ehRpcAusente({ code: '42501', message: 'permission denied' }));
    ok(!ehRpcAusente({ code: 'P0001', message: 'sem permissao para publicar plano alimentar' }));
    ok(!ehRpcAusente(null));
  });
});

grupo('dieta · publicação · metas do cálculo de calorias', () => {
  const pub = { id: 'pub', ativo: true, criado_em: '2026-10-01' };
  teste('sem plano: nenhum alvo (a tela cria um RASCUNHO)', () => igual(planoDasMetas([]), null));
  teste('rascunho mais novo que o publicado recebe as metas', () => {
    const r = { id: 'r', ativo: false, criado_em: '2026-11-01' };
    igual(planoDasMetas([r, pub]).id, 'r');
  });
  teste('rascunho antigo (versão que saiu do app) não recebe metas', () => {
    const velho = { id: 'v', ativo: false, criado_em: '2026-09-01' };
    igual(planoDasMetas([pub, velho]).id, 'pub');
  });
  teste('no publicado, a tela não grava o objetivo (que aparece no app)', () => {
    const src = ler('js/calorias-ui.js');
    ok(/const \{ objetivo, \.\.\.numericas \} = metas;\s*await atualizarPlano\(alvo\.id, numericas\);/.test(src));
  });
});

grupo('dieta · publicação · o editor não altera plano publicado', () => {
  const src = ler('js/dieta-ui.js');
  const fns = corpos(src);

  // Tudo que escreve num plano, numa refeição ou num item.
  const ESCRITAS = /\b(atualizarPlano|excluirPlano|criarRefeicao|atualizarRefeicao|excluirRefeicao|adicionarItem|atualizarItem|excluirItem|duplicarRefeicao|duplicarItem|reordenarItens|reordenarRefeicoes|salvarDados|publicarVersao|retirarDoApp)\(/;
  // Quem escreve sem começar por exigirRascunho(), e por quê.
  const EXCECOES = {
    salvarDados:     'guarda condicional: plano novo ainda não existe',
    removerPlano:    'confere planoPublicado() antes e recusa',
    retirarDoAppUI:  'é a ação explícita de tirar do app',
    publicarPlano:   'começa por exigirRascunho() depois de checar o modo',
    criarNovaVersaoUI: 'não escreve no plano aberto: cria outro',
    salvarPlanoNaBiblioteca: 'copia para a biblioteca, não altera o plano',
    aplicarModelo:   'cria um rascunho novo',
    // Só ligam eventos a funções que já têm a trava (salvarDados, publicar...).
    ligarDadosAberto: 'liga o botão a salvarDados',
    ligarBarra:       'liga os botões a salvarDados/publicarPlano/...',
    ligarAtalhos:     'liga Ctrl+S a salvarDados',
  };
  // Corpo sem a assinatura. Os parâmetros podem ter `{` (desestruturação),
  // então o corte é no `) {` + quebra de linha que abre o corpo.
  const semAssinatura = (c) => c.replace(/^[\s\S]*?\)\s*\{\n/, '');

  teste('toda função que escreve começa pela trava (ou está nas exceções justificadas)', () => {
    const sem = fns.filter(f => ESCRITAS.test(semAssinatura(f.corpo)) && !EXCECOES[f.nome])
      .filter(f => !/^\s*if \(!exigirRascunho\(\)\) return;/.test(semAssinatura(f.corpo)))
      .map(f => f.nome);
    igual(sem, [], 'funções que escrevem sem a trava');
  });
  teste('as exceções existem e fazem o que a justificativa diz', () => {
    const corpo = (n) => fns.find(f => f.nome === n)?.corpo || '';
    ok(corpo('salvarDados').includes('if (_plano && !exigirRascunho()) return false;'));
    ok(corpo('removerPlano').includes('if (planoPublicado(_modo, plano))'));
    ok(corpo('removerPlano').includes("plano?.status === 'substituido'"), 'histórico não se exclui');
    ok(corpo('publicarPlano').includes('if (!exigirRascunho()) return;'));
    ok(corpo('publicarPlano').includes('confirmar('), 'publicar pede confirmação');
  });
  teste('planoPublicado: só plano de paciente ativo', () => {
    igual([planoPublicado('paciente', { ativo: true }), planoPublicado('paciente', { ativo: false }),
      planoPublicado('modelo', { ativo: true }), planoPublicado('paciente', null)], [true, false, false, false]);
  });
  teste('o formulário de dados não tem mais o seletor Ativo/Inativo', () => {
    ok(!src.includes('id="plAtivo"'));
    ok(!/ativo:\s*ativoEl/.test(src));
  });
  teste('usar modelo não registra mais "plano publicado"', () => {
    const corpo = fns.find(f => f.nome === 'aplicarModelo').corpo;
    ok(!corpo.includes('eventoPlanoPublicado'));
  });
});

grupo('dieta · publicação · nenhum outro caminho ativa plano no front', () => {
  teste('as únicas escritas de `ativo: true` em plano são a publicação e o modelo', () => {
    const achados = [];
    for (const f of ['js/dieta.js', 'js/dieta-ui.js', 'js/calorias-ui.js', 'js/paciente-resumo.js']) {
      ler(f).split('\n').forEach((l, i) => {
        if (/ativo:\s*true/.test(l) && !/^\s*\/\//.test(l)) achados.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    igual(achados.map(a => a.split(': ').slice(1).join(': ')), [
      'const publicado = await atualizarPlano(planoId, { ativo: true });',
      '_plano = { ..._plano, ...publicado, ativo: true };',
    ]);
  });
  teste('calorias-ui não ativa nem desativa planos', () => {
    const src = ler('js/calorias-ui.js');
    ok(!/atualizarPlano\([^)]*ativo/.test(src));
    ok(!/ativo:\s*true/.test(src));
  });
});
