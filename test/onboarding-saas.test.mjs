// ═══════════════════════════════════════════════════════════
// ONBOARDING DO SaaS — conta + organização ativa + vínculo ativo, ou nada
// ═══════════════════════════════════════════════════════════
// O defeito: o cadastro pelo convite do SaaS criava a conta e mais nada. Nenhum
// código criava a organização nem o vínculo; o profissional novo ficava sem
// acesso e sem como tentar de novo ("e-mail já cadastrado").
//
// A regra, decidida pelo Eduardo: cadastro profissional concluído = conta +
// organização ativa + vínculo ativo; se uma das três falhar, não está
// concluído. A única forma de as três serem tudo-ou-nada é acontecerem na
// transação do próprio cadastro — dentro do gatilho de auth.users.
//
// Estes testes leem o SQL, não o executam: um dublê não prova Postgres. O que
// eles prendem é o DESENHO, e a conferência 141 confere o banco.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const semComentarioSql = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const MIG = ler('db/onboarding_saas.sql');
const MIG_SQL = semComentarioSql(MIG);
const DESF = ler('db/onboarding_saas_desfazer.sql');
const BASE = ler('db/auth_signup_baseline.sql');
const HARD = ler('db/hardening_execute_publico.sql');
const HTML = ler('index.html');
const AUTH = ler('js/auth.js');

/** O corpo da função entre as marcas $function$, normalizado. */
function corpo(sql) {
  const i = sql.indexOf('$function$');
  const j = sql.indexOf('$function$', i + 10);
  return sql.slice(i + 10, j);
}
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const FN = corpo(MIG_SQL);

grupo('onboarding SaaS · uma transação só', () => {
  teste('a migration inteira é uma transação', () => {
    ok(/^\s*begin;\s*$/m.test(MIG_SQL), 'falta o begin');
    ok(/^\s*commit;\s*$/m.test(MIG_SQL), 'falta o commit');
    ok(MIG_SQL.indexOf('begin;') < MIG_SQL.indexOf('create or replace function public.handle_new_user()'));
    ok(MIG_SQL.indexOf('commit;') > MIG_SQL.indexOf('$function$;'));
  });

  teste('a CHECK da auditoria é ampliada ANTES da função, sem perder nenhuma das 7', () => {
    // Com a lista antiga, o insert de auditoria violaria a CHECK, o raise
    // desfaria tudo, e NENHUM cadastro do SaaS completaria.
    const check = MIG_SQL.indexOf('add  constraint organizacao_auditoria_acao_check');
    ok(check > 0 && check < MIG_SQL.indexOf('create or replace function'), 'a CHECK tem que vir antes');
    for (const a of ['codigo_gerado', 'codigo_revogado', 'vinculo_realizado', 'perfil_alterado',
                     'permissao_alterada', 'usuario_bloqueado', 'usuario_reativado',
                     'organizacao_criada_no_cadastro']) {
      contem(MIG_SQL.slice(check, MIG_SQL.indexOf(';', check)), `'${a}'`);
    }
  });

  teste('a lista de 7 é a mesma que o banco tem hoje', () => {
    // A única definição da CHECK no repositório; se outra migration ampliar a
    // lista, a migration do onboarding tem que acompanhar — senão a apagaria.
    const orig = ler('db/organizacao_usuarios_admin.sql');
    const i = orig.indexOf('add  constraint organizacao_auditoria_acao_check');
    const lista = orig.slice(i, orig.indexOf(';', i)).match(/'[a-z_]+'/g);
    igual(lista.length, 7);
    for (const a of lista) contem(MIG_SQL, a);
  });
});

grupo('onboarding SaaS · o gatilho', () => {
  teste('definer, e com search_path fixo', () => {
    const cab = MIG_SQL.slice(MIG_SQL.indexOf('create or replace function public.handle_new_user()'),
                              MIG_SQL.indexOf('$function$'));
    contem(cab, 'returns trigger');
    contem(cab, 'security definer');
    contem(cab, 'set search_path = public');
  });

  teste('a linha em nutricionistas é a mesma de antes, para todo mundo', () => {
    // Aluno, colaborador e EVL- passam só por aqui: nada pode mudar para eles.
    contem(norm(FN), norm(`insert into public.nutricionistas (id, nome, email)
      values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email);`));
    ok(FN.indexOf('insert into public.nutricionistas') < FN.indexOf('if v_convite is null'),
       'a linha em nutricionistas tem que vir antes de qualquer decisão');
  });

  teste('sem convite no metadata, sai logo depois de nutricionistas', () => {
    const sai = FN.indexOf('if v_convite is null then');
    ok(sai > 0, 'falta a saída para quem não manda convite');
    const trecho = FN.slice(sai, FN.indexOf('end if;', sai));
    contem(trecho, 'return new;');
    ok(sai < FN.indexOf('codigos_convite'), 'a saída tem que vir antes de tocar no convite');
  });

  teste('o convite é travado e revalidado dentro do gatilho', () => {
    // `for update` resolve a corrida entre dois cadastros com o mesmo convite.
    ok(/from public\.codigos_convite\s+where upper\(codigo\) = upper\(v_convite\)\s+for update;/.test(FN),
       'o convite tem que ser lido com for update');
    contem(FN, "raise exception 'onboarding_convite_invalido'");
    contem(FN, "raise exception 'onboarding_convite_expirado'");
    contem(FN, "raise exception 'onboarding_convite_esgotado'");
  });

  teste('a organização nasce com o id da conta, e o vínculo é de proprietário, ativo', () => {
    contem(norm(FN), norm(`insert into public.organizacoes (id, nome, proprietario_user_id, ativo)
      values (new.id, v_nome, new.id, true)`));
    contem(norm(FN), norm(`where organizacao_id is null and chave = 'proprietario'`));
    contem(norm(FN), norm(`insert into public.organizacao_usuarios (organizacao_id, auth_user_id, nome, perfil_id, status)
      values (new.id, new.id, v_nome, v_perfil, 'ativo')`));
    contem(FN, 'on conflict (id) do nothing');
    contem(FN, 'on conflict (auth_user_id) do nothing');
  });

  teste('a regra é conferida antes de consumir, e falha desfaz a conta', () => {
    const regra = FN.indexOf("raise exception 'onboarding_incompleto'");
    ok(regra > 0, 'falta a conferência da regra');
    const bloco = FN.slice(FN.lastIndexOf('if not exists', regra), regra);
    contem(bloco, "ou.status = 'ativo'");
    contem(bloco, 'o.ativo');
    contem(bloco, 'ou.organizacao_id = new.id');
    ok(regra < FN.indexOf('set usos_atuais'), 'o consumo não pode vir antes de o vínculo existir');
    ok(regra < FN.indexOf('insert into public.codigos_uso'));
  });

  teste('a auditoria grava o autor explícito — auth.uid() é NULL no gatilho', () => {
    contem(norm(FN), norm(`insert into public.organizacao_auditoria (organizacao_id, usuario_alvo, usuario_autor, acao, depois)
      values (new.id, new.id, new.id, 'organizacao_criada_no_cadastro'`));
  });

  teste('nenhuma exceção é engolida', () => {
    // Um `exception when others` aqui transformaria "falhou" em "concluído
    // pela metade" — exatamente o que a regra proíbe.
    ok(!/exception\s+when/i.test(FN), 'o gatilho não pode capturar exceção');
  });
});

grupo('onboarding SaaS · a RPC sem chamador', () => {
  teste('a migration fecha registrar_uso_codigo para anon e authenticated', () => {
    contem(MIG_SQL, 'revoke all on function public.registrar_uso_codigo(text, uuid, text) from public, anon, authenticated;');
  });

  teste('o hardening devolve anon a 4, e não reabre a sem chamador', () => {
    const lista = HARD.slice(HARD.indexOf("p.proname in ('rpc_buscar_paciente_por_codigo'"));
    const fim = lista.indexOf(')');
    naoContem(lista.slice(0, fim), 'registrar_uso_codigo');
    contem(HARD, 'if v_anon < 4 then');
    contem(HARD, "execute 'revoke all on function public.registrar_uso_codigo(text, uuid, text) from authenticated'");
    // O 3b tem que vir DEPOIS do passo 2, que reabre tudo para authenticated.
    ok(HARD.indexOf('grant execute on function %s(%s) to authenticated') <
       HARD.indexOf("revoke all on function public.registrar_uso_codigo(text, uuid, text) from authenticated"));
  });

  teste('validar_codigo_convite continua pública — o cadastro valida antes de ter sessão', () => {
    const lista = HARD.slice(HARD.indexOf("p.proname in ('rpc_buscar_paciente_por_codigo'"));
    contem(lista.slice(0, lista.indexOf(')')), "'validar_codigo_convite'");
  });
});

grupo('onboarding SaaS · o front', () => {
  teste('o cadastro do SaaS manda o convite no signUp', () => {
    contem(HTML, 'await criarConta({ nome, email, senha, convite: codigo });');
  });

  teste('o caminho EVL- NÃO manda convite — ele entra numa organização que já existe', () => {
    const i = HTML.indexOf("if (codigo.startsWith('EVL-'))");
    const bloco = HTML.slice(i, HTML.indexOf('const validacao = await validarCodigoConvite', i));
    contem(bloco, 'criarConta({ nome, email, senha })');
    naoContem(bloco, 'convite:');
  });

  teste('ninguém mais chama registrar_uso_codigo', () => {
    naoContem(HTML, 'registrarUsoCodigo');
    naoContem(AUTH, 'registrarUsoCodigo');
    naoContem(AUTH, "rpc('registrar_uso_codigo'");
  });

  teste('criarConta só põe o convite no metadata quando ele existe', () => {
    contem(AUTH, 'data: convite ? { nome, convite } : { nome }');
  });

  teste('a recusa do gatilho vira uma mensagem que diz o que fazer', () => {
    // O Auth esconde o texto do raise; é esta frase que chega.
    contem(HTML, "if (m.includes('database error saving new user'))");
  });
});

grupo('onboarding SaaS · o desfazer', () => {
  teste('restaura o corpo EXATO do baseline — nada reescrito de memória', () => {
    const doBaseline = corpo(BASE.slice(BASE.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()')));
    const doDesfazer = corpo(DESF.slice(DESF.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()')));
    igual(norm(doDesfazer), norm(doBaseline));
  });

  teste('volta sem search_path, como era', () => {
    const cab = DESF.slice(DESF.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()'),
                           DESF.indexOf('AS $function$'));
    ok(!/search_path/i.test(cab), 'o desfazer não pode fixar search_path');
    contem(cab, 'SECURITY DEFINER');
  });

  teste('reabre registrar_uso_codigo exatamente como estava', () => {
    // anon e authenticated executavam (o hardening dava authenticated a todas
    // e devolvia anon às cinco). PUBLIC continua revogado, como antes.
    contem(DESF, 'grant execute on function public.registrar_uso_codigo(text, uuid, text) to anon, authenticated;');
    naoContem(semComentarioSql(DESF), 'to public');
  });

  teste('restaura a CHECK de 7 ações — e só quando é seguro', () => {
    const bloco = DESF.slice(DESF.indexOf('do $volta_check$'), DESF.indexOf('$volta_check$;'));
    ok(bloco.length > 100, 'falta o bloco que restaura a CHECK');
    contem(bloco, "where acao = 'organizacao_criada_no_cadastro'");
    contem(bloco, 'if n > 0 then');
    contem(bloco, 'raise notice');
    // A lista restaurada é a de antes: exatamente 7, sem a oitava.
    const check = bloco.slice(bloco.indexOf('add  constraint'));
    const lista = check.slice(0, check.indexOf(';')).match(/'[a-z_]+'/g) || [];
    igual(lista.length, 7, 'a CHECK restaurada tem que ter as 7 de antes, e só elas');
    ok(!lista.includes("'organizacao_criada_no_cadastro'"));
  });
});

// ═══════════════════════════════════════════════════════════
// A REVISÃO FINAL — os cinco pontos que o Eduardo pediu antes de aplicar
// ═══════════════════════════════════════════════════════════
grupo('onboarding SaaS · 1. idempotência e colisão', () => {
  const SCHEMA = ler('db/organizacao_schema.sql');

  teste('duas organizações para o mesmo dono: barrado pela chave primária', () => {
    // O id da organização É o id da conta. Uma segunda tentativa para a mesma
    // conta colide na PK, e o `on conflict (id) do nothing` a absorve.
    // NÃO existe unique em proprietario_user_id — e o schema diz que não deve
    // existir (é estratégia de migração, não regra de negócio). Por isso o que
    // protege ESTE fluxo é o id derivado, não uma constraint de dono.
    contem(FN, 'values (new.id, v_nome, new.id, true)');
    contem(FN, 'on conflict (id) do nothing');
    contem(SCHEMA, 'id                   uuid primary key');
    ok(!/unique[^\n]*proprietario_user_id/.test(SCHEMA),
       'se algum dia existir unique de proprietário, este teste tem que ser revisto');
  });

  teste('dois vínculos para a mesma pessoa: barrado por dois índices únicos', () => {
    contem(SCHEMA, 'create unique index if not exists uq_org_usuario_por_org\n  on public.organizacao_usuarios (organizacao_id, auth_user_id);');
    contem(SCHEMA, 'create unique index if not exists uq_org_usuario_unico\n  on public.organizacao_usuarios (auth_user_id);');
    contem(FN, 'on conflict (auth_user_id) do nothing');
  });

  teste('consumo duplicado: só consome o que nasceu naquela execução', () => {
    contem(FN, 'returning id into v_vinculo;');
    const guarda = FN.indexOf('if v_vinculo is null then');
    ok(guarda > 0, 'falta a guarda de idempotência');
    ok(guarda < FN.indexOf('set usos_atuais'), 'a guarda tem que vir antes de somar o uso');
    ok(guarda < FN.indexOf('insert into public.codigos_uso'), 'e antes de registrar o uso');
    ok(guarda < FN.indexOf('organizacao_criada_no_cadastro'), 'e antes da auditoria');
  });
});

grupo('onboarding SaaS · 2. concorrência do convite', () => {
  teste('a trava vem ANTES de decidir se ainda há uso', () => {
    // Em READ COMMITTED, o segundo cadastro fica preso no `for update` até o
    // primeiro terminar, e então relê a linha JÁ com o uso somado — e cai no
    // esgotado. Se a decisão viesse antes da trava, os dois leriam o mesmo
    // contador e os dois passariam.
    const trava = FN.indexOf('for update;');
    ok(trava > 0, 'falta o for update');
    ok(trava < FN.indexOf('usos_atuais, 0) >='), 'a trava tem que vir antes da conta de usos');
    ok(trava < FN.indexOf('onboarding_convite_esgotado'));
    ok(trava < FN.indexOf('onboarding_convite_expirado'));
  });

  teste('o uso é somado a partir do valor lido sob trava, sem recontagem', () => {
    contem(FN, 'set usos_atuais = coalesce(usos_atuais, 0) + 1');
    contem(FN, 'where id = c.id');
  });
});

grupo('onboarding SaaS · 3. o ramo é só do SaaS', () => {
  teste('a condição é o convite no metadata, e nada mais', () => {
    contem(FN, "v_convite text := nullif(btrim(new.raw_user_meta_data->>'convite'), '')");
    contem(FN, 'if v_convite is null then');
  });

  teste('aluno e colaborador não mandam metadata nenhum', () => {
    // Se um dia mandarem, este teste cai — e é para cair.
    for (const f of ['js/paciente-data.js', 'js/equipe-data.js']) {
      const fonte = ler(f);
      contem(fonte, 'sb.auth.signUp({ email, password: senha })');
      naoContem(fonte, 'convite');
    }
  });

  teste('o convite EVL- não entra no ramo, e o painel do Supabase também não', () => {
    // EVL- cria conta sem metadata de convite (testado acima, no front) e
    // entra numa organização que já existe, por usuario_vincular.
    // "Add user" do painel não manda metadata por construção: o ramo depende
    // de uma chave que só o nosso cadastro escreve.
    const i = HTML.indexOf("if (codigo.startsWith('EVL-'))");
    naoContem(HTML.slice(i, HTML.indexOf('const validacao', i)), 'convite:');
    contem(ler('db/organizacao_usuarios_admin.sql'), 'create or replace function public.usuario_vincular');
  });
});

grupo('onboarding SaaS · 5. o front antigo com o banco novo', () => {
  teste('a migration REVOGA, não derruba a função', () => {
    // Derrubar faria a chamada do front antigo virar "function does not exist"
    // — e tiraria do desfazer a possibilidade de devolver o estado anterior.
    naoContem(MIG_SQL, 'drop function');
    contem(MIG_SQL, 'revoke all on function public.registrar_uso_codigo(text, uuid, text) from public, anon, authenticated;');
  });

  teste('sem convite no metadata, o front antigo tem o comportamento de hoje', () => {
    // O cadastro antigo não manda convite: cria conta + nutricionistas e para
    // aí, exatamente como antes da migration. Nenhuma organização nasce, e o
    // portão do painel avisa — que é o estado de hoje, não uma regressão.
    const sai = FN.indexOf('if v_convite is null then');
    ok(sai < FN.indexOf('codigos_convite'), 'sem convite, nada do ramo novo é tocado');
  });

  teste('no intervalo entre banco e front, o convite não é contado duas vezes', () => {
    // Front antigo: a chamada a registrar_uso_codigo falha (revogada) dentro de
    // um try/catch que só faz console.warn — a UX segue. E como ele não manda
    // convite, o gatilho também não consome. Zero contagem, nunca duas.
    const publicado = ler('index.html');
    naoContem(publicado, 'registrarUsoCodigo');
    contem(FN, 'if v_convite is null then');
  });
});
