// ═══════════════════════════════════════════════════════════
// ETAPA 4C · FASE 2 — a RLS do módulo Equipe passa a ser da organização
// ═══════════════════════════════════════════════════════════
// Testes de TEXTO da migração, como na 4B: o projeto não sobe Postgres no
// teste, e quem prova o comportamento no banco é
// db/conferencia/112_prontidao_4c.sql, rodado antes e depois.
//
// O que estes testes protegem são as três coisas que somem em silêncio se
// alguém editar o SQL sem lembrar do porquê:
//
//   1. tudo sob `equipe.folha`, nunca sob `equipe.visualizar` — salário, CPF e
//      chave Pix são COLUNAS de `funcionarios`, e RLS protege linha, não coluna;
//   2. as policies do próprio colaborador ficam intactas — elas resolvem por
//      `funcionario_do_auth()`, que não é tenancy;
//   3. a trava de folha fechada sobrevive à migração.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const sql = f => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

const RLS  = sql('multiusuario_etapa4c_rls.sql');
const UNDO = sql('multiusuario_etapa4c_rls_desfazer.sql');

const ALVOS = ['folhas', 'folha_itens', 'folha_adicionais', 'funcionarios',
               'colaborador_documentos', 'documentos_pendentes'];

/** Sem comentários e sem a conferência do rodapé — a consulta de verificação
 *  legitimamente contém as palavras que a migração não pode conter. */
const soMigracao = t => {
  const i = t.lastIndexOf('-- Conferencia');
  return (i < 0 ? t : t.slice(0, i))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
};
const CODIGO = soMigracao(RLS);
const UNDO_CODIGO = soMigracao(UNDO);

/** O corpo de uma policy, do `create policy <nome>` até a linha em branco. */
function policy(fonte, nome) {
  const i = fonte.indexOf(`create policy ${nome} on`);
  if (i < 0) return '';
  const fim = fonte.indexOf('\n\n', i);
  return fonte.slice(i, fim < 0 ? undefined : fim);
}

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · o padrão da Etapa 4 nas seis tabelas', () => {
  teste('as seis ganham default de organização', () => {
    for (const t of ALVOS) {
      contem(CODIGO,
        `alter table public.${t}\n  alter column nutri_id set default public.organizacao_do_auth();`);
    }
  });

  teste('nenhuma policy nova decide tenancy por auth.uid()', () => {
    naoContem(CODIGO, 'nutri_id = auth.uid()',
      'sobrou tenancy por pessoa — a migração não migrou');
  });

  teste('toda policy criada tem tenancy E permissão', () => {
    const criadas = [...CODIGO.matchAll(/create policy (\w+) on public\.(\w+)/g)];
    igual(criadas.length, 21, `esperava 21 policies, achei ${criadas.length}`);
    for (const [, nome] of criadas) {
      const corpo = policy(RLS, nome);
      contem(corpo, 'organizacao_do_auth()', `${nome} sem tenancy`);
      contem(corpo, "tem_permissao('equipe.folha')", `${nome} sem a chave sensível`);
    }
  });

  teste('a migração não cria policy fora do módulo', () => {
    const tocadas = new Set(
      [...CODIGO.matchAll(/create policy \w+ on public\.(\w+)/g)].map(m => m[1]));
    for (const t of tocadas) ok(ALVOS.includes(t), `a 4C criou policy em ${t}, fora do escopo`);
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · decisão — tudo sob a chave sensível', () => {
  teste('nenhuma tabela é liberada por equipe.visualizar', () => {
    // `funcionarios` guarda salário, CPF e chave Pix nas próprias colunas. RLS
    // protege LINHA, não COLUNA: liberar a linha por `equipe.visualizar`
    // entregaria o salário junto — o mesmo problema que a Agenda enfrentou com
    // o prontuário.
    naoContem(CODIGO, 'equipe.visualizar',
      'quem só vê cadastro passaria a ver salário');
  });

  teste('funcionarios exige a chave em todas as quatro ações', () => {
    for (const acao of ['select', 'insert', 'update', 'delete']) {
      contem(policy(RLS, `funcionarios_${acao}`), "tem_permissao('equipe.folha')");
    }
  });

  teste('a decisão de não separar coluna está escrita, com a receita', () => {
    // Se um dia aparecer alguém que precise ver cadastro sem valores, o
    // caminho não deve ser redescoberto.
    contem(RLS, 'RLS protege LINHA, nao COLUNA');
    contem(RLS, 'SECURITY DEFINER');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · o colaborador não perde o próprio dado', () => {
  const DO_COLABORADOR = [
    'funcionarios_self_read', 'folhas_funcionario_read',
    'folha_itens_funcionario_read', 'folha_adicionais_funcionario_read',
    'cd_colaborador_select', 'cd_storage_colaborador',
  ];

  teste('nenhuma policy do colaborador é dropada', () => {
    // Elas resolvem por `funcionario_do_auth()` — o vínculo da pessoa com o
    // próprio cadastro, não tenancy. Policies são OR'd: as duas famílias
    // convivem, e derrubar uma tira o contracheque do ar.
    for (const p of DO_COLABORADOR) {
      naoContem(CODIGO, `drop policy if exists ${p}`, `${p} foi derrubada`);
    }
  });

  teste('a migração não menciona funcionario_do_auth', () => {
    naoContem(CODIGO, 'funcionario_do_auth',
      'a 4C não tem nada a dizer sobre o acesso do próprio colaborador');
  });

  teste('só a policy do dono do bucket muda', () => {
    contem(CODIGO, 'drop policy if exists cd_storage_nutri on storage.objects;');
    naoContem(CODIGO, 'drop policy if exists cd_storage_colaborador');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · o bucket, que a 4B não tinha', () => {
  const ST = policy(RLS, 'cd_storage_nutri');

  teste('a pasta 1 passa a ser a organização', () => {
    contem(ST, "(storage.foldername(name))[1] = public.organizacao_do_auth()::text");
    contem(ST, "bucket_id = 'colaborador-documentos'");
  });

  teste('o using e o with check exigem a mesma coisa', () => {
    const partes = ST.split('with check');
    igual(partes.length, 2, 'a policy precisa dos dois lados');
    for (const p of partes) {
      contem(p, 'organizacao_do_auth()');
      contem(p, "tem_permissao('equipe.folha')");
    }
  });

  teste('nenhum arquivo precisa ser movido, e o arquivo diz por quê', () => {
    contem(RLS, 'NENHUM ARQUIVO PRECISA SER MOVIDO');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · a trava da folha fechada sobrevive', () => {
  teste('folha fechada continua recusando mexer nas linhas', () => {
    // É regra anterior a qualquer discussão de tenancy, e a migração troca só
    // o lado esquerdo da comparação.
    for (const nome of ['folha_itens_insert', 'folha_itens_update', 'folha_itens_delete',
                        'folha_adicionais_insert', 'folha_adicionais_update',
                        'folha_adicionais_delete']) {
      contem(policy(RLS, nome), "status <> 'fechada'", `${nome} perdeu a trava`);
    }
  });

  teste('folha fechada não se apaga', () => {
    contem(policy(RLS, 'folhas_delete'), "status <> 'fechada'");
  });

  teste('os exists de folha e funcionário continuam', () => {
    // Sem eles, uma linha entraria apontando para folha ou funcionário de outra
    // organização — a policy só olha o nutri_id da própria linha.
    const ins = policy(RLS, 'folha_itens_insert');
    contem(ins, 'from public.folhas f');
    contem(ins, 'from public.funcionarios u');
    contem(ins, 'f.nutri_id = public.organizacao_do_auth()');
    contem(ins, 'u.nutri_id = public.organizacao_do_auth()');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · o rollback devolve o estado anterior', () => {
  teste('as seis voltam para auth.uid()', () => {
    for (const t of ALVOS) {
      contem(UNDO, `alter table public.${t}\n  alter column nutri_id set default auth.uid();`);
    }
    naoContem(UNDO_CODIGO, 'organizacao_do_auth',
      'o rollback tem que voltar para auth.uid()');
  });

  teste('toda policy da migração é reposta pelo rollback', () => {
    for (const [, nome] of CODIGO.matchAll(/create policy (\w+) on public\./g)) {
      contem(UNDO, `create policy ${nome} on public.`, `${nome} não volta`);
    }
    contem(UNDO, 'create policy cd_storage_nutri on storage.objects');
  });

  teste('o rollback também não toca no colaborador', () => {
    naoContem(UNDO_CODIGO, 'funcionario_do_auth');
    naoContem(UNDO_CODIGO, 'drop policy if exists cd_storage_colaborador');
  });

  teste('a trava da folha fechada volta junto', () => {
    contem(UNDO, "and status <> 'fechada'");
    igual((UNDO_CODIGO.match(/fechada/g) || []).length, 7,
      'as sete checagens de folha fechada têm que voltar');
  });

  teste('o rollback explica por que não desfaz a Fase 1', () => {
    // `abrirFolha` exigir `criar: true` era conserto de LEITURA, não de
    // tenancy. Desfazer traria a folha fantasma de volta.
    contem(UNDO, 'criar: true');
    contem(UNDO, 'folha fantasma');
  });
});

// ───────────────────────────────────────────────────────────
grupo('4C fase 2 · a ordem e a conferência', () => {
  teste('a migração registra que a Fase 1 já está no ar', () => {
    contem(RLS, 'A FASE 1 JA ESTA NO AR');
    contem(RLS, '69b3da6');
  });

  teste('a conferência 112 cobre as duas fases e o que não pode mudar', () => {
    const c = sql('conferencia/112_prontidao_4c.sql');
    contem(c, 'NAO ALTERA NADA');
    for (const s of ["'FASE 1'", "'FASE 2'", "'BUCKET'", "'COLABORADOR'",
                     "'FOLHA FECHADA'", "'DADO INTOCADO'"]) {
      contem(c, s, `a 112 não tem a seção ${s}`);
    }
  });

  teste('a 112 mede o arquivo na pasta errada', () => {
    // É o risco que só existe neste módulo: o caminho do Storage carrega o
    // dono, e arquivo na pasta da pessoa fica inacessível depois de migrar.
    contem(sql('conferencia/112_prontidao_4c.sql'), 'storage.foldername(name))[1] <> v_org');
  });
});
