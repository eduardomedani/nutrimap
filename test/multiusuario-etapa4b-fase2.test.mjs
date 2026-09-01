// ═══════════════════════════════════════════════════════════
// ETAPA 4B · FASE 2 — a RLS passa a ser da organização
// ═══════════════════════════════════════════════════════════
// Testes de TEXTO da migração, e é o que dá para fazer honestamente: o projeto
// não sobe Postgres no teste (`db/gerador_vendas.mjs` e todo o resto seguem a
// mesma regra — "testar SQL com um dublê seria testar o dublê"). Quem prova o
// comportamento no banco é db/conferencia/109_prontidao_4b.sql, rodado antes e
// depois.
//
// O que estes testes protegem são as três decisões que a etapa gravou, e cada
// uma delas some silenciosamente se alguém editar o SQL sem lembrar do porquê:
//
//   1. cobrança de cliente abre para o Comercial; o resto do caixa, não;
//   2. apagar paciente continua só do proprietário;
//   3. `clientes.visualizar` não arrasta o prontuário.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const sql = f => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

const RLS      = sql('multiusuario_etapa4b_rls.sql');
const RLS_UNDO = sql('multiusuario_etapa4b_rls_desfazer.sql');
const RPC      = sql('multiusuario_etapa4b_rpc.sql');
const RPC_UNDO = sql('multiusuario_etapa4b_rpc_desfazer.sql');
const CANONICA = sql('comercial_periodo_da_cobranca.sql');

const ALVOS = [
  'pacientes', 'comercial_assinaturas', 'financeiro_lancamentos',
  'financeiro_categorias', 'financeiro_centros_custo',
];

/** O corpo de uma policy, do `create policy <nome>` até o `;` que a fecha. */
function policy(fonte, nome) {
  const i = fonte.indexOf(`create policy ${nome} on`);
  if (i < 0) return '';
  const fim = fonte.indexOf('\n\n', i);
  return fonte.slice(i, fim < 0 ? undefined : fim);
}

/** Sem os comentários — para uma asserção não passar por causa de uma frase. */
const soCodigo = t => t.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/**
 * Só a parte que MIGRA, sem a consulta de conferência do rodapé.
 *
 * A separação importa: a conferência legitimamente contém as palavras que a
 * migração não pode conter — ela pergunta ao catálogo `prosrc like '%TETO%'` e
 * `qual like '%organizacao_do_auth%'`. Medir o arquivo inteiro fazia o teste
 * acusar o próprio verificador.
 */
const soMigracao = t => {
  const i = t.lastIndexOf('-- Conferencia');
  return soCodigo(i < 0 ? t : t.slice(0, i));
};

const RLS_CODIGO  = soMigracao(RLS);
const RPC_CODIGO  = soMigracao(RPC);
const UNDO_CODIGO = soMigracao(RLS_UNDO);

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · o padrão da Etapa 4 em todas as tabelas', () => {
  teste('as cinco tabelas ganham default de organização', () => {
    for (const t of ALVOS) {
      contem(RLS_CODIGO,
        `alter table public.${t}\n  alter column nutri_id set default public.organizacao_do_auth();`);
    }
  });

  teste('nenhuma policy nova compara com auth.uid() para decidir tenancy', () => {
    // A exceção é pacientes_delete, que usa auth.uid() de propósito — é assim
    // que ela diz "só o dono". Fora dela, auth.uid() em policy é o bug.
    const semDelete = RLS_CODIGO.replace(policy(RLS, 'pacientes_delete'), '');
    naoContem(semDelete, 'nutri_id = auth.uid()',
      'sobrou tenancy por pessoa — a migração não migrou');
  });

  teste('toda policy tem as DUAS condições, tenancy e permissão', () => {
    // Trocar só a tenancy faria qualquer membro ativo enxergar tudo o que a
    // organização tem: regressão de privacidade com cara de progresso.
    const criadas = [...RLS_CODIGO.matchAll(/create policy (\w+) on public\.(\w+)/g)];
    ok(criadas.length === 20, `esperava 20 policies, achei ${criadas.length}`);
    for (const [, nome] of criadas) {
      const corpo = policy(RLS, nome);
      contem(corpo, 'organizacao_do_auth()', `${nome} sem tenancy`);
      if (nome === 'pacientes_delete') continue;   // usa auth.uid(), ver acima
      contem(corpo, 'tem_permissao(', `${nome} sem permissão`);
    }
  });

  teste('a policy do próprio cliente não é derrubada', () => {
    // `pacientes_self_read` é o acesso do aluno à própria linha pelo PWA.
    // Policies são OR'd: dropá-la tiraria o app do ar.
    naoContem(RLS_CODIGO, 'drop policy if exists pacientes_self_read');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · decisão 1 — cobrança abre, caixa não', () => {
  const SELECT = policy(RLS, 'financeiro_lancamentos_select');

  teste('o SELECT decide pela FORMA da linha, não só pelo tenant', () => {
    contem(SELECT, 'assinatura_id is not null');
    contem(SELECT, "tem_permissao('comercial.visualizar')");
    contem(SELECT, "tem_permissao('financeiro.visualizar')");
  });

  teste('quem só tem Comercial não alcança lançamento sem assinatura', () => {
    // A estrutura tem que ser `(assinatura_id is not null and comercial) or
    // financeiro`. Se o `and assinatura_id` sumisse, comercial.visualizar
    // passaria a valer para a despesa também.
    const normalizado = SELECT.replace(/\s+/g, ' ');
    contem(normalizado,
      "(assinatura_id is not null and public.tem_permissao('comercial.visualizar')) or public.tem_permissao('financeiro.visualizar')");
  });

  teste('o INSERT e o UPDATE seguem a mesma separação', () => {
    for (const nome of ['financeiro_lancamentos_insert', 'financeiro_lancamentos_update']) {
      const corpo = policy(RLS, nome);
      contem(corpo, 'assinatura_id is not null', `${nome} perdeu a separação`);
      contem(corpo, "tem_permissao('comercial.editar')");
    }
  });

  teste('o DELETE de lançamento NÃO abre para o Comercial', () => {
    // Cobrança se CANCELA — a RPC muda o status e a linha continua existindo,
    // porque ela é a receita. DELETE sob comercial.editar seria um caminho para
    // sumir com dinheiro já registrado, sem trilha.
    const corpo = policy(RLS, 'financeiro_lancamentos_delete');
    naoContem(corpo, 'comercial.', 'cobrança poderia ser apagada em vez de cancelada');
    contem(corpo, "tem_permissao('financeiro.editar')");
  });

  teste('centros de custo não têm ramo do Comercial', () => {
    // Centro de custo só existe em despesa. A Recepção não lança despesa.
    for (const acao of ['select', 'insert', 'update', 'delete']) {
      naoContem(policy(RLS, `financeiro_centros_custo_${acao}`), 'comercial.');
    }
  });

  teste('categorias abrem no SELECT para os dois, e só no SELECT', () => {
    // RLS vale dentro do `exists` da policy de lançamento: sem este SELECT
    // aberto, a Recepção criaria cobrança e a checagem da categoria falharia,
    // com um erro que aponta para o lugar errado.
    contem(policy(RLS, 'financeiro_categorias_select'), "tem_permissao('comercial.visualizar')");
    for (const acao of ['insert', 'update', 'delete']) {
      naoContem(policy(RLS, `financeiro_categorias_${acao}`), 'comercial.',
        `categorias_${acao} deixou o Comercial mexer no catálogo`);
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · decisão 2 — apagar paciente é só do dono', () => {
  const DEL = policy(RLS, 'pacientes_delete');

  teste('o DELETE exige ser a própria organização', () => {
    contem(DEL, 'auth.uid() = public.organizacao_do_auth()');
  });

  teste('o DELETE não se delega por permissão', () => {
    // Criar `clientes.excluir` faria a exclusão virar algo que se DELEGA, e a
    // decisão foi a oposta.
    naoContem(DEL, 'tem_permissao');
    naoContem(RLS_CODIGO, 'clientes.excluir');
  });

  teste('clientes.editar não alcança o DELETE', () => {
    naoContem(DEL, 'clientes.editar');
    contem(policy(RLS, 'pacientes_update'), "tem_permissao('clientes.editar')");
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · decisão 3 — o clínico não abre junto', () => {
  const CLINICAS = ['respostas', 'avaliacoes', 'recordatorio_calc', 'consultas',
                    'paciente_documentos', 'checkin_respostas'];

  teste('a migração não toca em nenhuma tabela clínica', () => {
    for (const t of CLINICAS) {
      naoContem(RLS_CODIGO, `on public.${t}`,
        `${t} entrou na 4B — o prontuário sairia junto com o cadastro`);
    }
  });

  teste('a migração não cria policy fora das cinco tabelas', () => {
    const tocadas = new Set(
      [...RLS_CODIGO.matchAll(/create policy \w+ on public\.(\w+)/g)].map(m => m[1]));
    for (const t of tocadas) {
      ok(ALVOS.includes(t), `a 4B criou policy em ${t}, que não está no escopo`);
    }
  });

  teste('as policies clínicas continuam com a segunda tranca', () => {
    // É `p.nutri_id = auth.uid()` DENTRO do exists que mantém a Recepção fora,
    // mesmo com pacientes migrada. A 4B não pode remover isso — e este teste
    // falha se alguém "padronizar" aquelas policies junto.
    const clinico = sql('clinico_legacy_baseline.sql');
    contem(clinico, 'p.nutri_id = auth.uid()');
    naoContem(clinico, 'organizacao_do_auth');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · as RPCs perdem o teto e nada mais', () => {
  teste('o teto saiu das duas funções', () => {
    naoContem(RPC_CODIGO, 'TETO');
    naoContem(RPC_CODIGO, 'is distinct from auth.uid()');
  });

  teste('cada função mantém a checagem de organização e a de permissão', () => {
    // O teto era redundância proposital. Se ele sair e a checagem de
    // organização sair junto, as duas funções passam a servir qualquer um — e
    // SECURITY DEFINER passa por cima da RLS.
    //
    // A verificação é POR FUNÇÃO, e não por contagem no arquivo: contar
    // ocorrências afirmava um número que nada garante — as duas poderiam estar
    // na mesma função, com a outra aberta.
    const blocos = RPC_CODIGO.split('create or replace function public.').slice(1);
    igual(blocos.length, 2, 'esperava as duas funções');
    for (const b of blocos) {
      const nome = b.slice(0, b.indexOf('('));
      contem(b, 'security definer', `${nome} deixou de ser definer`);
      contem(b, 'fora da organizacao', `${nome} não checa mais a organização`);
      contem(b, "tem_permissao('comercial.editar')", `${nome} não exige mais a permissão`);
      ok(!/is distinct from auth\.uid\(\)/.test(b), `${nome} ainda tem o teto`);
    }
  });

  teste('nada além do teto mudou em relação à definição canônica', () => {
    // A migração é uma extração de db/comercial_periodo_da_cobranca.sql. Toda
    // linha de código dela tem que existir lá — o contrário seria alguém tendo
    // reescrito a função no meio do caminho.
    const linhasRpc = soMigracao(RPC).split('\n').map(l => l.trim()).filter(Boolean);
    const canonica = soCodigo(CANONICA);
    const forasteiras = linhasRpc.filter(l => !canonica.includes(l));
    // O cabeçalho, os grants e a conferência do próprio arquivo não estão lá.
    const suspeitas = forasteiras.filter(l =>
      !/^(select|count|from|join|where|and|or|;)/i.test(l) && !l.startsWith('revoke') && !l.startsWith('grant'));
    igual(suspeitas.length, 0, `linhas que não vêm da canônica: ${suspeitas.join(' | ')}`);
  });

  teste('o desfazer repõe exatamente o teto, e só ele', () => {
    const a = soCodigo(RPC).split('\n');
    const b = soCodigo(RPC_UNDO).split('\n');
    const soNoUndo = b.filter(l => l.trim() && !a.includes(l));
    // Duas funções x três linhas do guard.
    igual(soNoUndo.length, 6, `o desfazer difere em ${soNoUndo.length} linhas: ${soNoUndo.join(' | ')}`);
    ok(soNoUndo.every(l => /auth\.uid\(\)|TETO|errcode/.test(l)));
  });

  teste('a conferência do desfazer espera o teto de VOLTA', () => {
    // Reaproveitar o rodapé da migração faria o rollback relatar falha quando
    // deu certo.
    contem(RPC_UNDO, 'com_teto = 2');
    contem(RPC, 'com_teto = 0');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · o rollback devolve o estado anterior', () => {
  teste('o desfazer da RLS repõe as policies antigas', () => {
    for (const t of ALVOS) {
      contem(RLS_UNDO, `on public.${t}`);
    }
    contem(RLS_UNDO, '"Nutri ve proprios pacientes"');
    naoContem(UNDO_CODIGO, 'organizacao_do_auth',
      'o rollback tem que voltar para auth.uid()');
  });

  teste('o rollback NÃO deixa pacientes.nutri_id sem default', () => {
    // Antes da 4B a coluna não tinha default, e restaurar o estado pristino
    // seria o mais fiel. Mas `criarPaciente` parou de mandar o campo depois da
    // Fase 2: sem default, o cadastro de cliente quebraria com violação de
    // not-null na hora seguinte ao rollback, e a tela só diria "erro ao gerar
    // código". Um rollback que derruba uma função que estava funcionando não é
    // rollback, é um segundo incidente.
    naoContem(RLS_UNDO, 'alter column nutri_id drop default');
    contem(RLS_UNDO, 'alter table public.pacientes\n  alter column nutri_id set default auth.uid();');
  });

  teste('as cinco voltam para auth.uid()', () => {
    for (const t of ALVOS) {
      contem(RLS_UNDO, `alter table public.${t}\n  alter column nutri_id set default auth.uid();`);
    }
  });

  teste('os dois arquivos documentam a ordem do rollback', () => {
    // RPC primeiro, RLS depois. Ao contrário, existe um instante com funções
    // SECURITY DEFINER mais permissivas que as policies em volta.
    contem(RLS_UNDO, 'db/multiusuario_etapa4b_rpc_desfazer.sql ANTES');
    contem(RPC_UNDO, 'ESTE ARQUIVO VEM ANTES');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4B fase 2 · a ordem entre as fases está escrita', () => {
  teste('a migração avisa que a Fase 1 vem primeiro', () => {
    contem(RLS, 'NAO RODE ISTO ANTES DA FASE 1 ESTAR NO AR');
  });

  teste('a RPC avisa que vem depois da RLS', () => {
    contem(RPC, 'RODE DEPOIS DE db/multiusuario_etapa4b_rls.sql');
  });

  teste('a conferência 109 existe e cobre as duas fases', () => {
    const c = sql('conferencia/109_prontidao_4b.sql');
    contem(c, "'FASE 1'");
    contem(c, "'FASE 2'");
    contem(c, "'CLINICO'");
    contem(c, "'EXCLUSAO'");
    contem(c, "'DUAS DONAS'");
    contem(c, 'NAO ALTERA NADA');
  });
});
