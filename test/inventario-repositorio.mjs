// ═══════════════════════════════════════════════════════════
// INVENTÁRIO DO REPOSITÓRIO — o que os SQLs versionados esperam
// ═══════════════════════════════════════════════════════════
// Lê db/*.sql e extrai os objetos que o repositório declara: tabelas, funções,
// triggers, policies, índices e buckets. Classifica cada arquivo por tipo e
// cada objeto por módulo.
//
// É a metade repositório da Etapa 3.5. A outra metade — o que o banco tem de
// fato — sai de db/conferencia/79_prontidao_multiusuario.sql, que este mesmo
// arquivo gera.
//
// POR QUE NÃO ESCREVER A LISTA À MÃO: já custou caro duas vezes neste projeto.
// O gerador da conferência do baseline (70) nasceu disso, e `conta_externa_
// detalhe` quebrou na primeira aplicação por listar tabelas à mão — uma delas
// não existia no banco.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const lerDb = f => readFileSync(new URL(`db/${f}`, raiz), 'utf8');

const SQLS = readdirSync(new URL('db/', raiz)).filter(f => f.endsWith('.sql'));

// ── classificação dos arquivos ─────────────────────────────
// Um `.sql` no repositório não é necessariamente algo que deva estar aplicado.
// Baseline é retrato, desfazer é rollback, conferência é leitura. Tratar os
// três como "migration não aplicada" produziria um relatório cheio de falso
// alarme.
export function classificar(nome) {
  if (nome.includes('/')) nome = nome.split('/').pop();
  if (/_LIMPO\.sql$/.test(nome))        return 'CONFERENCIA';   // cópia de paste
  if (/_desfazer\.sql$/.test(nome))     return 'DESFAZER';
  if (/_baseline\.sql$/.test(nome))     return 'BASELINE';
  // PROPOSTA é o quarto caso de "existe no repositório e NÃO deve estar
  // aplicado". Um desenho aprovado mas não executado — as RPCs da Agenda são o
  // primeiro. Sem esta classe, o relatório de prontidão acusaria as quatro
  // funções como "migration versionada não aplicada", que é literalmente
  // verdade e completamente enganoso: elas não estão aplicadas de propósito.
  if (/_proposta\.sql$/.test(nome))     return 'PROPOSTA';
  if (/^\d+_/.test(nome))               return 'CONFERENCIA';
  if (/_seed\.sql$|_dados\.json$/.test(nome)) return 'SEED';
  if (/hardening|fechar_|grants/.test(nome))  return 'HARDENING';
  if (/corre[cç]ao|corrigir|ajuste|migrar|desfaz/.test(nome)) return 'CORRECAO';
  // `_rls` entra na lista pelas migrations da Etapa 4: `multiusuario_<modulo>_rls.sql`
  // é migration de pleno direito e não casava com nenhum dos outros padrões.
  if (/schema|_etapa\d|_login|_admin|_publicado|_trava|vinculo|_rls/.test(nome)) return 'MIGRATION';
  return 'OUTRO';
}

// ── módulo de cada arquivo ─────────────────────────────────
const MODULOS = [
  [/^checkin/,                         'CHECK-INS'],
  [/^paciente_documentos|^documentos_/, 'DOCUMENTOS DO PACIENTE'],
  [/^colaborador_documentos|^contracheque/, 'DOCUMENTOS DO COLABORADOR'],
  [/^comercial/,                       'COMERCIAL'],
  [/^financeiro/,                      'FINANCEIRO'],
  [/^folha|^funcionario/,              'EQUIPE'],
  [/^dieta|^plano/,                    'ALIMENTACAO'],
  [/^foods|^alimentos/,                'BANCO DE ALIMENTOS'],
  [/^treino/,                          'TREINOS'],
  [/^exercicio/,                       'EXERCICIOS'],
  [/^consultas/,                       'AGENDA'],
  [/^timeline|^hub_/,                  'TIMELINE E HUB'],
  [/^organizacao/,                     'MULTIUSUARIO'],
  [/^admin_convites/,                  'CONVITES SaaS'],
  [/^paciente_login|^paciente_notific|^paciente_nome/, 'PWA DO PACIENTE'],
  [/^pacientes_|^nutricionistas_|^clinico_|^convites_|^auth_legacy|^auth_signup/, 'LEGADO CENTRAL'],
  [/^vinculo/,                         'VINCULOS'],
  // Nao e modulo do produto: e o registro de um objeto de OUTRO produto que
  // esta vivo neste banco (db/pedcrm_objeto_estranho.sql). Fica em categoria
  // propria para nao ser lido como funcionalidade do Evollo nem como objeto
  // desconhecido — ver o cabecalho daquele arquivo.
  [/^pedcrm/,                          'OBJETO ESTRANHO'],
];

export function moduloDe(arquivo) {
  // O prefixo `multiusuario_` some antes de classificar: as migrations da
  // Etapa 4 se chamam `multiusuario_<modulo>_rls.sql` e pertencem ao módulo que
  // migram, não a um módulo "multiusuário". Sem isto,
  // `multiusuario_comercial_planos_rls.sql` cairia em OUTRO e as quatro
  // policies do Comercial mudariam de módulo no relatório dependendo da ordem
  // em que o disco devolvesse os arquivos.
  const base = arquivo.split('/').pop().replace(/^multiusuario_/, '');
  for (const [re, mod] of MODULOS) if (re.test(base)) return mod;
  return 'OUTRO';
}

// ── extração dos objetos ───────────────────────────────────
export function inventario() {
  const objetos = [];   // {tipo, nome, tabela, arquivo, modulo, classe}

  for (const arq of SQLS) {
    const classe = classificar(arq);
    // Conferência, desfazer e proposta não DECLARAM objeto que deva existir:
    // uma lê, a outra remove, a terceira ainda não foi executada. Incluí-las
    // inverteria o sinal do relatório.
    if (classe === 'CONFERENCIA' || classe === 'DESFAZER' || classe === 'PROPOSTA') continue;

    const sql = lerDb(arq);
    const mod = moduloDe(arq);
    const add = (tipo, nome, tabela) =>
      objetos.push({ tipo, nome, tabela: tabela || null, arquivo: arq, modulo: mod, classe });

    for (const m of sql.matchAll(/create table if not exists public\.([a-z_]+)/g)) add('tabela', m[1]);
    // `i` no regex, e não só minúsculas: db/auth_legacy_rpcs_baseline.sql traz
    // as seis RPCs legadas com CREATE OR REPLACE FUNCTION em MAIÚSCULA, porque
    // o corpo veio de pg_get_functiondef. Sem a flag, as seis sumiam do
    // inventário e apareciam como "o front chama e o repositório não declara".
    for (const m of sql.matchAll(/create or replace function public\.([a-z_]+)/gi)) add('funcao', m[1]);
    // Views entram como objeto próprio: três delas — financeiro_resumo_mensal,
    // folha_resumo_mensal, folha_resumo_colaborador — são lidas pelo front com
    // `.from()`, e sem isto apareciam como tabela inexistente.
    for (const m of sql.matchAll(/create or replace view public\.([a-z_]+)/gi)) add('view', m[1]);
    for (const m of sql.matchAll(/create trigger (\S+)[\s\S]{0,200}?on public\.([a-z_]+)/g)) add('trigger', m[1], m[2]);
    for (const m of sql.matchAll(/create policy ("[^"]+"|\S+) on public\.([a-z_]+)/g))
      add('policy', m[1].replace(/^"|"$/g, ''), m[2]);
    for (const m of sql.matchAll(/create (?:unique )?index if not exists (\S+)\s+on public\.([a-z_]+)/g))
      add('indice', m[1], m[2]);
    for (const m of sql.matchAll(/bucket_id = '([a-z-]+)'/g)) add('bucket', m[1]);
  }
  return objetos;
}

// ── uso pelo frontend ──────────────────────────────────────
export function usoNoFront() {
  const arquivos = [
    ...readdirSync(new URL('js/', raiz)).filter(f => f.endsWith('.js')).map(f => `js/${f}`),
    ...readdirSync(raiz).filter(f => f.endsWith('.html')),
  ];
  const uso = { tabelas: new Map(), rpcs: new Map(), buckets: new Map() };
  const reg = (mapa, chave, arq) => {
    if (!mapa.has(chave)) mapa.set(chave, new Set());
    mapa.get(chave).add(arq);
  };

  for (const arq of arquivos) {
    const s = readFileSync(new URL(arq, raiz), 'utf8');
    for (const m of s.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g))          reg(uso.tabelas, m[1], arq);
    for (const m of s.matchAll(/\.rpc\(\s*['"]([a-z_]+)['"]/g))                reg(uso.rpcs,    m[1], arq);
    for (const m of s.matchAll(/storage\s*\n?\s*\.from\(\s*['"]([a-z-]+)['"]/g)) reg(uso.buckets, m[1], arq);
  }
  return uso;
}

// ── mapa de tenancy, lido das policies ─────────────────────
// Como o dono é resolvido HOJE em cada policy. É o mapa que a Etapa 4 vai
// seguir, e ele precisa sair do texto real das policies, não de suposição.
export function tenancy() {
  const linhas = [];
  for (const arq of SQLS) {
    const classe = classificar(arq);
    if (classe === 'CONFERENCIA' || classe === 'DESFAZER' || classe === 'BASELINE'
        || classe === 'PROPOSTA') continue;
    const sql = lerDb(arq);
    for (const m of sql.matchAll(
      /create policy ("[^"]+"|\S+) on public\.([a-z_]+)\s*([\s\S]*?);\n/g)) {
      const [, nomeCru, tabela, resto] = m;
      const cmd = (resto.match(/for\s+(all|select|insert|update|delete)/i) || [])[1] || '?';
      let tipo = 'OUTRO';
      if (/paciente_do_auth\(\)/.test(resto))            tipo = 'PACIENTE';
      else if (/funcionario_do_auth\(\)/.test(resto))    tipo = 'COLABORADOR';
      else if (/organizacao_do_auth\(\)/.test(resto))    tipo = 'ORGANIZACAO';
      else if (/nutri_id\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*nutri_id/.test(resto)) tipo = 'DIRETO';
      else if (/from public\.pacientes[\s\S]*?nutri_id\s*=\s*auth\.uid\(\)/.test(resto)) tipo = 'INDIRETO';
      else if (/using\s*\(\s*true\s*\)/.test(resto))     tipo = 'GLOBAL';
      else if (/auth\.uid\(\)/.test(resto))              tipo = 'OUTRO auth.uid()';
      linhas.push({
        tabela, policy: nomeCru.replace(/^"|"$/g, ''), cmd: cmd.toLowerCase(),
        tipo, modulo: moduloDe(arq), arquivo: arq,
      });
    }
  }
  return linhas;
}

// ── geração da conferência ─────────────────────────────────
const aspas = s => "'" + String(s ?? '').replace(/'/g, "''") + "'";

// A seção `A PRONTIDAO 3.5` responde as cinco perguntas de encerramento da
// etapa. Ela é a primeira do resultado (o prefixo `A ` existe só para vencer o
// `order by 1`), e nenhuma das respostas é constante embutida: cada uma é
// consultada no banco na hora, para que o script continue valendo depois de
// aplicar o check-in ou de criar as chaves de agenda.
//
// Sobre CONTAS EXTERNAS: uma conta só está "resolvida" quando se sabe o que
// ela é — membro da organização, paciente vinculado ou colaborador vinculado.
// As que não são nenhum dos três exigem decisão explícita. Nada de comentário
// `--` dentro do SQL gerado: o arquivo _LIMPO é colado no SQL Editor, e lá o
// `--` se perde na quebra de linha e vira comando.
export function gerarSqlProntidao() {
  const inv = inventario().filter(o => o.tipo !== 'indice');
  const uso = usoNoFront();

  // Chave de cada objeto: tipo + nome + tabela. Sem a tabela, duas policies
  // homônimas em tabelas diferentes viram uma só.
  const vistos = new Set();
  const linhas = [];
  for (const o of inv) {
    const k = `${o.tipo}|${o.nome}|${o.tabela || ''}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const usado =
      o.tipo === 'tabela' ? uso.tabelas.has(o.nome)
      : o.tipo === 'funcao' ? uso.rpcs.has(o.nome)
      : o.tipo === 'bucket' ? uso.buckets.has(o.nome)
      : null;
    linhas.push(
      `    (${aspas(o.tipo)}, ${aspas(o.nome)}, ${aspas(o.tabela || '')}, ` +
      `${aspas(o.modulo)}, ${aspas(o.arquivo)}, ${usado === null ? 'null' : usado})`);
  }

  return `with esperado(tipo, nome, tabela, modulo, arquivo, front_usa) as (
  values
${linhas.join(',\n')}
),
atual(tipo, nome, tabela) as (
  select 'tabela', c.relname::text, ''
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'view', c.relname::text, ''
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')
  union all
  select 'funcao', p.proname::text, ''
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'trigger', t.tgname::text, c.relname::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'policy', p.policyname::text, p.tablename::text
    from pg_policies p where p.schemaname = 'public'
  union all
  select 'bucket', b.id::text, '' from storage.buckets b
),
comparado as (
  select
    coalesce(e.tipo, a.tipo)     as tipo,
    coalesce(e.nome, a.nome)     as nome,
    coalesce(e.tabela, a.tabela) as tabela,
    coalesce(e.modulo, '(nao versionado)') as modulo,
    e.arquivo, e.front_usa,
    case when a.nome is null then 'AUSENTE NO BANCO'
         when e.nome is null then 'AUSENTE NO REPOSITORIO'
         else 'OK' end as status
  from esperado e
  full outer join atual a
    on a.tipo = e.tipo and a.nome = e.nome and coalesce(a.tabela,'') = coalesce(e.tabela,'')
),
relevante as (
  select * from comparado
   where status <> 'AUSENTE NO REPOSITORIO'
      or (tipo = 'tabela')
      or (tipo = 'funcao' and nome not like 'pg\_%' and nome not like 'uuid\_%'
          and nome not like 'gtrgm%' and nome not like 'gin\_%' and nome not like 'set\_limit'
          and nome not like 'show\_%' and nome not like 'similarity%' and nome not like 'word\_similarity%'
          and nome not like 'strict\_word%' and nome not like 'unaccent%' and nome not like 'armor'
          and nome not like 'dearmor' and nome not like 'crypt' and nome not like 'digest'
          and nome not like 'encrypt%' and nome not like 'decrypt%' and nome not like 'hmac'
          and nome not like 'gen\_%' and nome not like 'pgp\_%')
      or (tipo in ('policy','trigger','bucket'))
),
por_modulo as (
  select modulo,
         count(*) filter (where status = 'OK')               as ok,
         count(*) filter (where status = 'AUSENTE NO BANCO')  as ausente_banco,
         count(*) filter (where status = 'AUSENTE NO REPOSITORIO') as ausente_repo,
         count(*) filter (where status = 'AUSENTE NO BANCO' and front_usa) as front_quebrado
    from relevante group by modulo
)
select
  'A PRONTIDAO 3.5' as secao, p.item, p.valor, p.resultado
from (
  values
    ('CHECK-INS',
     (select count(*)::text from relevante
       where modulo = 'CHECK-INS' and status = 'AUSENTE NO BANCO') || ' objetos faltando no banco',
     case when exists (select 1 from relevante
                        where modulo = 'CHECK-INS' and status = 'AUSENTE NO BANCO')
          then 'BLOQUEADO' else 'PRONTO' end),

    ('HANDLE_NEW_USER',
     coalesce((select status from relevante where tipo = 'funcao' and nome = 'handle_new_user'),
              'nao aparece nem no banco nem no repositorio'),
     case when exists (select 1 from relevante
                        where tipo = 'funcao' and nome = 'handle_new_user' and status = 'OK')
          then 'VERSIONADO' else 'NAO VERSIONADO' end),

    ('PEDCRM_NOVO_MEMBRO',
     coalesce((select modulo from relevante where tipo = 'funcao' and nome = 'pedcrm_novo_membro'),
              '(ausente)'),
     case when exists (select 1 from relevante
                        where tipo = 'funcao' and nome = 'pedcrm_novo_membro'
                          and modulo = 'OBJETO ESTRANHO')
          then 'CLASSIFICADO' else 'NAO CLASSIFICADO' end),

    ('AGENDA',
     (select count(*)::text from public.permissoes where chave like 'agenda.%') || ' chaves no catalogo',
     case when exists (select 1 from public.permissoes where chave like 'agenda.%')
          then 'PERMISSOES DEFINIDAS' else 'PENDENTES' end),

    ('TIMELINE',
     (select count(*)::text from public.permissoes where chave like 'timeline.%') || ' chaves no catalogo',
     case when exists (select 1 from public.permissoes where chave like 'timeline.%')
          then 'PERMISSOES DEFINIDAS' else 'PENDENTES' end),

    ('CONTAS EXTERNAS',
     (select count(*)::text from public.nutricionistas n
       where not exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id)
         and not exists (select 1 from public.pacientes    p where p.auth_user_id  = n.id)
         and not exists (select 1 from public.funcionarios f where f.auth_user_id  = n.id))
     || ' contas sem papel definido',
     case when exists (select 1 from public.nutricionistas n
                        where not exists (select 1 from public.organizacao_usuarios ou where ou.auth_user_id = n.id)
                          and not exists (select 1 from public.pacientes    p where p.auth_user_id  = n.id)
                          and not exists (select 1 from public.funcionarios f where f.auth_user_id  = n.id))
          then 'DECISAO PENDENTE' else 'RESOLVIDAS' end)
) as p(item, valor, resultado)
union all
select
  'MODULO' as secao, modulo as item,
  ok || ' ok / ' || ausente_banco || ' faltam no banco / ' || ausente_repo || ' fora do repo' as valor,
  case when front_quebrado > 0 then 'FRONTEND DEPENDE DE OBJETO AUSENTE (' || front_quebrado || ')'
       when ausente_banco > 0  then 'MIGRATION NAO APLICADA'
       when ausente_repo > 0   then 'objeto nao versionado'
       else 'PRONTO' end as resultado
from por_modulo
union all
select 'DIVERGENCIA', tipo || ' ' || nome || case when tabela <> '' then ' (' || tabela || ')' else '' end,
       coalesce(arquivo, '(sem arquivo)') || ' · ' || modulo,
       status || case when front_usa then '  <<< O FRONTEND USA' else '' end
  from relevante where status <> 'OK'
union all
select 'zz TOTAL', 'objetos conferidos',
       (select count(*)::text from relevante),
       case when exists (select 1 from relevante where status = 'AUSENTE NO BANCO' and front_usa)
            then 'NAO PRONTO — frontend depende de objeto ausente'
            when exists (select 1 from relevante where status = 'AUSENTE NO BANCO')
            then 'RESSALVA — ha migration versionada nao aplicada'
            else 'PRONTO PARA A ETAPA 4' end
order by 1, 4, 2;
`;
}

const CABECALHO = `-- ===========================================================================
-- ETAPA 3.5 — PRONTIDAO PARA A MIGRACAO MULTIUSUARIO
-- ---------------------------------------------------------------------------
-- ARQUIVO GERADO. Regenere com:  node test/inventario-repositorio.mjs
-- A fonte e db/*.sql. Editar aqui cria a segunda fonte que o gerador evita.
--
-- NAO ALTERA NADA. So le catalogo.
--
-- Compara o que os SQLs versionados DECLARAM com o que o banco TEM, objeto a
-- objeto, e diz por modulo se da para migrar a policy dele.
--
-- Baseline, desfazer e conferencia ficam de fora do lado "esperado": um e
-- retrato, outro e rollback, o terceiro so le. Conta-los como migration nao
-- aplicada encheria o relatorio de falso alarme.
--
-- COMO LER:
--   AUSENTE NO BANCO        versionado e nunca aplicado
--   AUSENTE NO REPOSITORIO  existe no banco e ninguem versionou
--   <<< O FRONTEND USA      prioridade maxima: a tela chama e o objeto nao existe
--
-- Para colar no SQL Editor, use db/conferencia/79_prontidao_multiusuario_LIMPO.sql
-- ===========================================================================

`;

if (process.argv[1]?.endsWith('inventario-repositorio.mjs')) {
  const sql = gerarSqlProntidao();
  writeFileSync(new URL('db/conferencia/79_prontidao_multiusuario.sql', raiz), CABECALHO + sql);
  writeFileSync(new URL('db/conferencia/79_prontidao_multiusuario_LIMPO.sql', raiz), sql);
  // Contagem DEDUPLICADA, a mesma que o SQL gerado usa. A contagem crua conta
  // duas vezes um objeto declarado em dois arquivos — o que passou a acontecer
  // na Etapa 4: `multiusuario_comercial_planos_rls.sql` redeclara as quatro
  // policies que `comercial_etapa2_planos.sql` já declarava. O número no
  // console tem de bater com o número que o script confere.
  const vistos = new Set();
  for (const o of inventario()) {
    if (o.tipo === 'indice') continue;
    vistos.add(`${o.tipo}|${o.nome}|${o.tabela || ''}`);
  }
  console.log('gerado db/conferencia/79_prontidao_multiusuario.sql');
  console.log('  ' + vistos.size + ' objetos esperados (fora indices, sem repetir)');
}
