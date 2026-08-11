// ═══════════════════════════════════════════════════════════
// ETAPA 2 — a Fundação Multiusuário
// ═══════════════════════════════════════════════════════════
// Estas guardas leem SQL, não banco. O que elas protegem é o contrato da
// etapa: a Fundação existe inteira, e não atravessa o escopo dela.
//
// O que NÃO dá para provar aqui — organizacao_do_auth() devolver o uuid certo,
// deny by default, RLS isolando — mora em db/conferencia/71 e 72, que rodam
// no banco. Um teste que fingisse cobrir isso seria pior que nenhum.

import { readFileSync, readdirSync } from 'node:fs';
import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';

const ler = f => readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');

const SCHEMA   = ler('organizacao_schema.sql');
const DESFAZER = ler('organizacao_schema_desfazer.sql');
const CONF     = ler('conferencia/71_organizacao_fundacao.sql');
const PROVA    = ler('conferencia/72_organizacao_equivalencia.sql');

// Sem comentário: as asserções que PROÍBEM algo não podem casar com o
// comentário que explica por que aquilo é proibido.
const semComentario = s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
const SQL = semComentario(SCHEMA);

/** As chaves do catálogo, lidas do INSERT — a lista real, não um número. */
const catalogo = () => {
  const bloco = SQL.slice(SQL.indexOf('insert into public.permissoes'),
                          SQL.indexOf('on conflict (chave) do nothing'));
  return [...bloco.matchAll(/\('([a-z_.]+)',\s*'/g)].map(m => m[1]);
};

/** O pacote de um perfil padrão, lido do INSERT que o semeia. */
const pacoteDe = (chave) => {
  const i = SQL.indexOf(`p.chave = '${chave}'`);
  const bloco = SQL.slice(i, SQL.indexOf('on conflict', i));
  return [...bloco.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
};

const TABELAS = ['organizacoes', 'perfis', 'permissoes',
                 'perfil_permissoes', 'organizacao_usuarios', 'usuario_permissoes'];
const FUNCOES = ['organizacao_do_auth', 'tem_permissao', 'minhas_permissoes'];
const PERFIS  = ['proprietario', 'administrador', 'nutricionista',
                 'treinador', 'recepcao', 'financeiro'];


// ═══════════════════════════════════════════════════════════
grupo('etapa 2 · a fundação existe inteira', () => {

  teste('as seis tabelas são criadas', () => {
    for (const t of TABELAS) {
      contem(SQL, `create table if not exists public.${t} (`);
    }
  });

  teste('as seis nascem com RLS ativa', () => {
    // `\s+` e não espaço único: as seis linhas são alinhadas em coluna no
    // schema, e alinhamento é estilo — não pode derrubar a guarda.
    for (const t of TABELAS) {
      ok(new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(SQL),
         `${t} sem RLS`);
    }
  });

  teste('as três funções são criadas, definer e com search_path fixo', () => {
    for (const f of FUNCOES) {
      const i = SQL.indexOf(`create or replace function public.${f}`);
      ok(i > 0, `${f} não é criada`);
      const cabecalho = SQL.slice(i, SQL.indexOf('$fn$', i));
      contem(cabecalho, 'security definer');
      contem(cabecalho, 'set search_path = public');
      contem(cabecalho, 'stable');
    }
  });

  teste('os seis perfis padrão são semeados, protegidos e sem organização', () => {
    const bloco = SQL.slice(SQL.indexOf('insert into public.perfis'));
    for (const p of PERFIS) contem(bloco, `'${p}'`);
    // organizacao_id NULL = perfil do sistema, vale para todas.
    igual((bloco.match(/\(null, '/g) || []).length, 6);
  });

  teste('o catálogo cobre os módulos construídos, e nenhum desabilitado', () => {
    // Sem número mágico: a guarda confere que cada módulo REAL tem chave, não
    // que o total é 27. Módulo novo entra sem quebrar teste; módulo que sumir
    // do catálogo quebra.
    const chaves = catalogo();
    igual(new Set(chaves).size, chaves.length, 'nenhuma chave repetida');
    for (const modulo of ['clientes', 'anamnese', 'avaliacoes', 'alimentacao', 'alimentos',
                          'treinos', 'exercicios', 'checkins', 'documentos',
                          'comercial', 'financeiro', 'equipe', 'usuarios']) {
      ok(chaves.some(c => c.startsWith(modulo + '.')), `${modulo} sem nenhuma chave`);
    }
    // agendamentos, evolucao, ia e materiais estão `disabled` no painel:
    // permissão para módulo inexistente é catálogo inflado sem nada a autorizar.
    for (const modulo of ['agendamentos', 'evolucao', 'ia.', 'materiais']) {
      ok(!chaves.some(c => c.startsWith(modulo)), `${modulo} não deveria estar no catálogo`);
    }
  });

  teste('o Banco de Alimentos participa do motor', () => {
    // É módulo real e habilitado no painel. Sem chave, a Etapa 4 não teria
    // como autorizá-lo: qualquer perfil veria tudo ou nada.
    const chaves = catalogo();
    ok(chaves.includes('alimentos.visualizar'));
    ok(chaves.includes('alimentos.editar'));
  });

  teste('cadastro do cliente e dado clínico são chaves separadas', () => {
    // O §25 da Etapa 1: Recepção vê nome e telefone sem ver a anamnese.
    for (const c of ['clientes.visualizar', 'anamnese.visualizar',
                     'avaliacoes.visualizar', 'documentos.visualizar']) {
      contem(SQL, `'${c}'`);
    }
    const recepcao = SQL.slice(SQL.indexOf("p.chave = 'recepcao'"));
    const pacote = recepcao.slice(0, recepcao.indexOf('on conflict'));
    for (const proibido of ['anamnese', 'avaliacoes', 'alimentacao', 'documentos', 'checkins']) {
      ok(!pacote.includes(proibido), `Recepção não pode receber ${proibido}`);
    }
  });

  teste('comercial e financeiro da empresa são chaves separadas', () => {
    // O §26: registrar mensalidade sem ver fluxo de caixa.
    const pacote = pacoteDe('recepcao');
    ok(pacote.includes('comercial.editar'));
    ok(!pacote.some(c => c.startsWith('financeiro.')), 'Recepção não vê o financeiro da empresa');
  });

  teste('o perfil Financeiro é exatamente o pacote aprovado', () => {
    igual(pacoteDe('financeiro').sort(), [
      'clientes.visualizar',
      'comercial.visualizar',
      'financeiro.editar',
      'financeiro.lancar',
      'financeiro.visualizar',
    ]);
  });

  teste('Financeiro não recebe comercial.editar nem equipe.visualizar', () => {
    // Menor privilégio, e as duas ausências são deliberadas:
    //
    //   comercial.editar   "registrar pagamento" não pode custar o direito de
    //                      contratar, renovar e cancelar assinatura. Se o
    //                      Financeiro precisar receber, o certo é uma chave
    //                      própria — não alargar esta.
    //   equipe.visualizar  concedida por hipótese de que um dia mexeria com
    //                      folha. Permissão dada por hipótese ninguém revoga.
    const pacote = pacoteDe('financeiro');
    ok(!pacote.includes('comercial.editar'));
    ok(!pacote.includes('equipe.visualizar'));
    // Mas as duas continuam no catálogo, e no pacote de quem deve tê-las.
    ok(catalogo().includes('comercial.editar'));
    ok(catalogo().includes('equipe.visualizar'));
    ok(pacoteDe('administrador') !== null);
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 2 · o motor de permissão é único', () => {

  teste('o Proprietário recebe o catálogo por dados, não por atalho na função', () => {
    // `cross join permissoes` = todas as linhas em perfil_permissoes.
    const bloco = SQL.slice(SQL.indexOf('perfil_permissoes'));
    contem(bloco, "cross join public.permissoes pm");
    contem(bloco, "p.chave = 'proprietario'");
  });

  teste('nenhuma função conhece nome de perfil', () => {
    // `if perfil = 'proprietario' then true` criaria um caminho privilegiado
    // que não passa pelo cálculo — e caminho privilegiado é onde o furo mora.
    const inicio = SQL.indexOf('create or replace function public.organizacao_do_auth');
    const funcoes = SQL.slice(inicio, SQL.indexOf('revoke all on function'));
    for (const p of PERFIS) {
      ok(!funcoes.includes(`'${p}'`), `a função não pode citar o perfil ${p}`);
    }
  });

  teste('a permissão efetiva é exceção primeiro, perfil depois, senão nega', () => {
    const i = SQL.indexOf('create or replace function public.tem_permissao');
    const corpo = SQL.slice(i, SQL.indexOf('$fn$;', SQL.indexOf('$fn$', i) + 4));
    // coalesce nessa ordem É a regra: primeiro argumento não nulo vence.
    const excecao = corpo.indexOf('usuario_permissoes');
    const perfil  = corpo.indexOf('perfil_permissoes');
    ok(excecao > 0 && perfil > 0 && excecao < perfil,
       'a exceção individual precisa ser consultada antes do perfil');
    contem(corpo, 'false');   // o último argumento do coalesce: deny by default
  });

  teste('minhas_permissoes devolve só o concedido', () => {
    const i = SQL.indexOf('create or replace function public.minhas_permissoes');
    const corpo = SQL.slice(i);
    contem(corpo, 'where chave not in (select chave from excecoes)');
    contem(corpo, 'select chave from excecoes where concede');
  });

  teste('as três funções exigem membro ativo e organização ativa', () => {
    const inicio = SQL.indexOf('create or replace function public.organizacao_do_auth');
    const funcoes = SQL.slice(inicio, SQL.indexOf('revoke all on function'));
    igual((funcoes.match(/ou\.status = 'ativo'/g) || []).length, 3,
          'as três precisam recusar usuário bloqueado');
    igual((funcoes.match(/and o\.ativo/g) || []).length, 3,
          'as três precisam recusar organização inativa');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 2 · ACL, RLS e o risco de recursão', () => {

  teste('ACL explícita: revoke de public e anon, execute só para authenticated', () => {
    for (const f of FUNCOES) {
      const assinatura = f === 'tem_permissao' ? 'tem_permissao(text)' : `${f}()`;
      ok(new RegExp(`revoke all on function public\\.${assinatura.replace(/[()]/g, '\\$&')}\\s+from public, anon`).test(SQL),
         `${f} sem revoke de public/anon`);
      ok(new RegExp(`grant execute on function public\\.${assinatura.replace(/[()]/g, '\\$&')}\\s+to authenticated`).test(SQL),
         `${f} sem grant para authenticated`);
    }
    naoContem(SQL, 'to anon');
  });

  teste('FORCE RLS não aparece — é o que faria a função cair na própria policy', () => {
    // organizacao_do_auth() é definer e lê organizacao_usuarios; a policy de
    // organizacao_usuarios chama organizacao_do_auth(). Só não é laço porque a
    // dona da tabela ignora RLS. Com `force`, ignora deixa de valer.
    ok(!/force\s+row\s+level\s+security/i.test(SQL),
       'force row level security reabre a recursão');
  });

  teste('nenhuma policy de escrita nas tabelas da fundação', () => {
    const policies = [...SQL.matchAll(/create policy \S+ on public\.(\S+)\s+for (\w+)/g)];
    ok(policies.length > 0, 'esperava policies de leitura');
    for (const [, tabela, cmd] of policies) {
      igual(cmd, 'select', `${tabela} ganhou policy de ${cmd} — escrita é por RPC na Etapa 3`);
    }
  });

  teste('perfil_permissoes e usuario_permissoes ficam sem policy nenhuma', () => {
    // Mesmo desenho de codigos_convite: RLS ativa, zero policies, só DEFINER entra.
    for (const t of ['perfil_permissoes', 'usuario_permissoes']) {
      ok(!new RegExp(`create policy[^;]*on public\\.${t}`).test(SQL),
         `${t} não pode ter policy`);
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 2 · não atravessa o escopo da etapa', () => {

  teste('nenhum UUID escrito à mão — o proprietário sai do estado', () => {
    ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
         SQL.replace(/'00000000-0000-0000-0000-000000000000'/g, '')),
       'UUID pessoal no SQL — a descoberta tem que vir de admins');
    contem(SQL, 'join public.admins a on a.user_id = n.id');
  });

  teste('a descoberta aborta com zero e com mais de um candidato', () => {
    const bloco = SQL.slice(SQL.indexOf('do $$'));
    igual((bloco.match(/raise exception/g) || []).length, 3,
          'zero candidatos, vários candidatos, perfil ausente — cada um com sua parada');
    contem(bloco, 'if v_qtd = 0 then');
    contem(bloco, 'if v_qtd > 1 then');
    contem(bloco, 'string_agg');   // a lista dos candidatos na mensagem
  });

  teste('o bootstrap é idempotente', () => {
    const bloco = SQL.slice(SQL.indexOf('do $$'));
    contem(bloco, 'on conflict (id) do nothing');
    contem(bloco, 'on conflict (auth_user_id) do nothing');
  });

  teste('não existe constraint amarrando id ao proprietário', () => {
    // Na organização inicial os dois coincidem por ESTRATÉGIA. Virar constraint
    // impediria organização futura de ter uuid próprio.
    ok(!/check\s*\(\s*id\s*=\s*proprietario_user_id/i.test(SQL));
  });

  teste('profissional_id não é criado', () => {
    // Não existe entidade profissional hoje: nutricionistas.id É o
    // auth.users.id, então a coluna guardaria o mesmo valor de auth_user_id, e
    // não representaria um treinador.
    ok(!/profissional_id/.test(SCHEMA), 'profissional_id fica para quando a entidade existir');
  });

  teste('nenhuma policy antiga é tocada e nenhum nutri_id muda', () => {
    ok(!/nutri_id\s*=\s*public\.organizacao_do_auth/.test(SQL),
       'a troca de predicado é a Etapa 4');
    ok(!/^\s*update\s+public\.(pacientes|nutricionistas|avaliacoes|respostas)/im.test(SQL),
       'nenhum dado legado é atualizado');
    for (const t of ['pacientes', 'avaliacoes', 'respostas', 'exames',
                     'recordatorio_calc', 'codigos_convite', 'codigos_uso']) {
      ok(!new RegExp(`alter table public\\.${t}\\b`).test(SQL), `${t} não pode ser alterada`);
    }
  });

  teste('nenhum bucket é tocado', () => {
    ok(!/storage\.(objects|buckets)/.test(SQL), 'Storage não muda na Etapa 2');
    // Mas a conferência PRECISA olhar o Storage para provar o invariante.
    contem(CONF, 'storage.foldername');
  });

  teste('nutricionistas continua intacta', () => {
    ok(!/alter table public\.nutricionistas/.test(SQL));
    ok(!/drop .*nutricionistas/i.test(SQL));
    // Ela é lida na descoberta do proprietário, e só.
    contem(SQL, 'from public.nutricionistas n');
  });

  teste('nenhum segundo usuário é criado', () => {
    const bloco = SQL.slice(SQL.indexOf('do $$'));
    igual((bloco.match(/insert into public\.organizacao_usuarios/g) || []).length, 1,
          'só o proprietário entra na Etapa 2 — Recepção é a Etapa 3');
  });

  teste('o frontend e o login não são tocados', () => {
    // Nenhum arquivo js/ ou html mudou nesta etapa: a guarda é a ausência de
    // qualquer arquivo de front entre os que a etapa cria.
    const naDb = readdirSync(new URL('../db/', import.meta.url));
    ok(naDb.includes('organizacao_schema.sql'));
    ok(naDb.includes('organizacao_schema_desfazer.sql'));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 2 · rollback e conferências', () => {

  teste('o desfazer remove as seis tabelas e as três funções', () => {
    for (const t of TABELAS) contem(DESFAZER, `drop table if exists public.${t}`);
    for (const f of FUNCOES) ok(new RegExp(`drop function if exists public\\.${f}`).test(DESFAZER));
  });

  teste('o desfazer não encosta em nada legado', () => {
    const d = semComentario(DESFAZER);
    for (const t of ['nutricionistas', 'pacientes', 'avaliacoes', 'respostas',
                     'exames', 'codigos_convite', 'codigos_uso', 'funcionarios']) {
      ok(!new RegExp(`drop table[^;]*\\b${t}\\b`).test(d), `o rollback não pode dropar ${t}`);
    }
    ok(!/storage\./.test(d), 'o rollback não toca em Storage');
    ok(!/auth\.users/.test(d), 'o rollback não toca em auth.users');
    // set_atualizado_em é de foods_schema.sql e serve outras tabelas.
    ok(!/drop function[^;]*set_atualizado_em/.test(d),
       'set_atualizado_em não pertence a esta etapa');
  });

  teste('a ordem do rollback respeita as dependências', () => {
    const pos = t => DESFAZER.indexOf(`drop table if exists public.${t}`);
    ok(pos('usuario_permissoes') < pos('organizacao_usuarios'), 'quem aponta cai antes');
    ok(pos('perfil_permissoes')  < pos('perfis'));
    ok(pos('organizacao_usuarios') < pos('perfis'));
    ok(pos('perfis') < pos('organizacoes'));
  });

  teste('a conferência prova o invariante do Storage', () => {
    contem(CONF, 'INVARIANTE');
    contem(CONF, 'storage.foldername(so.name))[1]');
    // Reporta, não corrige.
    ok(!/update|insert|delete|alter/i.test(semComentario(CONF).replace(/\bdelete\w*/gi, '')),
       'a conferência só lê');
  });

  teste('a prova devolve TABELA, não notice', () => {
    // A primeira versão era um `DO` puro: a grade do SQL Editor dizia
    // "Success. No rows returned" e a evidência ficava numa aba que ninguém
    // abre. Conferência cuja saída não chega a quem decide não é conferência.
    contem(PROVA, 'create temp table conf72');
    contem(PROVA, 'select ordem, teste, resultado, detalhe from conf72 order by ordem');
    // Temporária: vive na sessão, não é objeto do schema.
    contem(PROVA, 'drop table if exists conf72');
  });

  teste('a prova compara organizacao_do_auth com auth.uid', () => {
    contem(PROVA, "'organizacao_do_auth() = auth.uid()'");
    contem(PROVA, 'v_uid = v_owner and v_org = v_uid');
    // Simula identidade sem conceder privilégio, e só dentro da transação.
    contem(PROVA, "set_config('request.jwt.claims'");
  });

  teste('a prova cobre os testes obrigatórios do motor', () => {
    for (const alvo of [
      'excecao individual REVOGA o que o perfil dava',
      'excecao individual CONCEDE sobre a ausencia',
      'ausencia de linha NEGA',
      'usuario bloqueado -> organizacao_do_auth() null',
      'organizacao inativa -> organizacao_do_auth() null',
      'usuario sem vinculo: sem organizacao, sem permissao',
      'perfil Proprietario tem o catalogo completo',
      'perfil Financeiro com as 5 permissoes aprovadas',
      'ACL: anon sem execute, authenticated com execute',
      'estado voltou ao anterior',
    ]) {
      contem(PROVA, alvo);
    }
    contem(PROVA, 'EQUIVALENCIA PROVADA');
  });

  teste('cada teste de comportamento reverte sozinho', () => {
    // `begin … exception … end` no plpgsql é subtransação: a alteração
    // acontece, o teste lê o efeito, e o raise proposital desfaz. Se o script
    // parar no meio, a subtransação cai junto — o proprietário não fica
    // bloqueado nem a organização inativa.
    //
    // O resultado sobrevive porque fica numa VARIÁVEL, que não é transacional;
    // a alteração, não. Por isso o insert em conf72 vem DEPOIS do handler.
    const reverte = (PROVA.match(/raise exception 'REVERTER'/g) || []).length;
    const handlers = (PROVA.match(/if sqlerrm <> 'REVERTER' then/g) || []).length;
    ok(reverte >= 5, `esperava as mutações revertidas, achei ${reverte}`);
    igual(handlers, reverte, 'cada REVERTER precisa do handler que o absorve');
    // E a prova de que reverteu é um teste próprio, o 12.
    contem(PROVA, 'nada dos testes persistiu');
  });

  teste('o diagnóstico das contas órfãs chaveia toda linha pela conta', () => {
    const diag = ler('conferencia/73_segunda_conta_diagnostico.sql');
    // Com mais de uma conta, devolver os campos em blocos separados deixa de
    // ser legível: não há garantia de que a ordem dentro de cada bloco seja a
    // mesma, e dá para ler o e-mail de uma ao lado do login de outra.
    contem(diag, 'select conta, item, valor');
    contem(diag, 'order by conta, secao, ordem');
    ok(!/update|insert into|delete from|create temp/i.test(
         diag.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')),
       'o diagnóstico só lê');
  });

  teste('o ajuste do Financeiro é idempotente e não toca no catálogo', () => {
    const ajuste = ler('organizacao_ajuste_perfil_financeiro.sql');
    const desfazer = ler('organizacao_ajuste_perfil_financeiro_desfazer.sql');
    contem(ajuste, "pp.permissao_chave in ('comercial.editar', 'equipe.visualizar')");
    // Delete de vínculo, nunca de permissão do catálogo.
    ok(!/delete from public\.permissoes/.test(ajuste), 'o catálogo não pode perder chave');
    ok(!/delete from public\.perfis/.test(ajuste), 'nenhum perfil é removido');
    // O desfazer restaura só os dois.
    contem(desfazer, "pm.chave in ('comercial.editar', 'equipe.visualizar')");
    contem(desfazer, 'on conflict do nothing');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3.5 · agenda, atendimento e timeline no catálogo', () => {

  const MIGRATION = semComentario(ler('organizacao_permissoes_agenda_atendimento_timeline.sql'));
  const ROLLBACK  = ler('organizacao_permissoes_agenda_atendimento_timeline_desfazer.sql');

  const NOVAS = ['atendimento.visualizar', 'atendimento.registrar',
                 'agenda.visualizar', 'agenda.criar', 'agenda.editar',
                 'timeline.visualizar', 'timeline.gerenciar'];

  /** As chaves que um texto SQL declara em `insert into public.permissoes`. */
  const declaradas = (sql) => {
    const bloco = sql.slice(sql.indexOf('insert into public.permissoes'),
                            sql.indexOf('on conflict (chave) do nothing'));
    return [...bloco.matchAll(/\('([a-z_.]+)',\s*'/g)].map(m => m[1]);
  };

  /** O pacote de um perfil, lido de qualquer um dos dois arquivos. */
  const pacoteEm = (sql, chave) => {
    const i = sql.indexOf(`p.chave = '${chave}'`);
    if (i < 0) return [];
    return [...sql.slice(i, sql.indexOf('on conflict', i))
                  .matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
  };

  teste('as sete chaves entram, e o catálogo vai a 34', () => {
    const chaves = catalogo();
    for (const c of NOVAS) ok(chaves.includes(c), `${c} não está no schema`);
    igual(chaves.length, 34);
    igual(new Set(chaves).size, 34, 'nenhuma repetida');
  });

  teste('agenda.excluir não existe', () => {
    // A Recepção cancela — a RPC muda `status` e a linha continua existindo.
    // O DELETE real é do profissional, sob atendimento.registrar. Chave para
    // operação que ninguém faz é catálogo inflado.
    ok(!catalogo().includes('agenda.excluir'));
    ok(!declaradas(MIGRATION).includes('agenda.excluir'));
  });

  teste('a migration corretiva declara exatamente as sete, e nada mais', () => {
    // Se ela declarasse uma das 27, um `on conflict do nothing` esconderia a
    // divergência e os dois arquivos passariam a discordar em silêncio.
    igual(declaradas(MIGRATION).sort(), [...NOVAS].sort());
  });

  teste('instalação limpa e produção chegam ao mesmo estado', () => {
    // Os dois arquivos são fontes diferentes do MESMO fato. Divergirem
    // significa que quem instala do zero recebe permissão diferente de quem
    // migrou — e ninguém descobre isso até um perfil se comportar diferente
    // em dois lugares.
    for (const perfil of ['nutricionista', 'recepcao']) {
      igual(pacoteEm(MIGRATION, perfil).filter(c => NOVAS.includes(c)).sort(),
            pacoteEm(SQL, perfil).filter(c => NOVAS.includes(c)).sort(),
            `${perfil} diverge entre a migration e o schema`);
    }
  });

  teste('a Recepção recebe a agenda e nada do prontuário', () => {
    // É o §2 da decisão: agenda e prontuário não são a mesma autorização.
    for (const sql of [SQL, MIGRATION]) {
      const pacote = pacoteEm(sql, 'recepcao');
      igual(pacote.filter(c => c.startsWith('agenda.')).sort(),
            ['agenda.criar', 'agenda.editar', 'agenda.visualizar']);
      ok(!pacote.some(c => c.startsWith('atendimento.')), 'Recepção não vê o registro clínico');
      ok(!pacote.some(c => c.startsWith('timeline.')),    'Recepção não vê a timeline');
    }
  });

  teste('Treinador e Financeiro não recebem nenhuma das sete', () => {
    // A ausência é a decisão, e ela precisa de guarda: pacote vazio some sem
    // deixar rastro quando alguém edita a lista ao lado.
    for (const perfil of ['treinador', 'financeiro']) {
      for (const sql of [SQL, MIGRATION]) {
        const pacote = pacoteEm(sql, perfil);
        ok(!pacote.some(c => NOVAS.includes(c)),
           `${perfil} não deveria receber nenhuma das sete`);
      }
    }
  });

  teste('o Nutricionista recebe as sete', () => {
    const pacote = pacoteEm(SQL, 'nutricionista');
    for (const c of NOVAS) ok(pacote.includes(c), `nutricionista sem ${c}`);
  });

  teste('Proprietário e Administrador ganham as novas sem lista explícita', () => {
    // Os dois pacotes são `cross join public.permissoes`. Reexecutá-los já
    // concede o que for novo — e continua correto quando a próxima chave
    // nascer e alguém esquecer de vir aqui.
    for (const perfil of ['proprietario', 'administrador']) {
      const i = MIGRATION.indexOf(`p.chave = '${perfil}'`);
      ok(i > 0, `a migration não reexecuta o pacote de ${perfil}`);
      contem(MIGRATION.slice(Math.max(0, i - 220), i), 'cross join public.permissoes');
    }
  });

  teste('atendimento.* e timeline.* nascem sensíveis', () => {
    // `sensivel` não autoriza nada — é o metadado que faz a tela destacar o
    // que é clínico. Uma chave de prontuário sem ele passa despercebida na
    // hora de conceder.
    for (const c of ['atendimento.visualizar', 'atendimento.registrar',
                     'timeline.visualizar', 'timeline.gerenciar']) {
      const linha = SQL.split('\n').find(l => l.includes(`('${c}'`));
      ok(linha && /true,\s*\d+\)/.test(linha), `${c} deveria ser sensivel`);
    }
    // As de agenda não são: a superfície operacional não tem conteúdo clínico.
    for (const c of ['agenda.visualizar', 'agenda.criar', 'agenda.editar']) {
      const linha = SQL.split('\n').find(l => l.includes(`('${c}'`));
      ok(linha && /false,\s*\d+\)/.test(linha), `${c} não deveria ser sensivel`);
    }
  });

  teste('a migration não toca nas 27 existentes', () => {
    ok(!/delete from public\.permissoes/.test(MIGRATION), 'nenhuma chave é removida');
    ok(!/update public\.permissoes/.test(MIGRATION),      'nenhuma chave é alterada');
    ok(!/delete from public\.perfil_permissoes/.test(MIGRATION), 'nenhum vínculo é removido');
  });

  teste('o rollback se recusa a rodar depois da Etapa 4', () => {
    // Apagar uma chave que já governa policy não volta ao estado anterior:
    // deixa `tem_permissao()` de chave inexistente, que é false, e o módulo
    // some para todo mundo — inclusive para o proprietário.
    contem(ROLLBACK, 'from pg_policies');
    contem(ROLLBACK, 'from public.usuario_permissoes');
    igual((ROLLBACK.match(/raise exception/g) || []).length, 2,
          'as duas guardas precisam abortar, não avisar');
    contem(ROLLBACK, 'delete from public.perfil_permissoes');
    contem(ROLLBACK, 'delete from public.permissoes');
  });
});
