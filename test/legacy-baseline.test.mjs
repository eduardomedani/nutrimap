// ═══════════════════════════════════════════════════════════
// ETAPA 1B — os baselines dos objetos legados
// ═══════════════════════════════════════════════════════════
// O que estas guardas protegem não é o conteúdo do banco: é a DISCIPLINA da
// etapa. Um baseline que ganha um `create policy` novo, ou que troca um
// `auth.uid()`, deixa de ser retrato e vira migration disfarçada — e uma
// migration disfarçada de baseline é exatamente o tipo de arquivo que alguém
// roda em produção achando que é inofensivo.
//
// As buscas descobrem os objetos em vez de contar linhas: `create table if
// not exists public.X` diz que X está representado, e continua dizendo isso
// se o arquivo crescer.

import { readFileSync, readdirSync } from 'node:fs';
import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { BASELINES, esperados, inventario, gerarSql } from './gerar-conferencia-legado.mjs';

const ler = nome => readFileSync(new URL(`../db/${nome}`, import.meta.url), 'utf8');

// O sexto chegou na Etapa 3.5, e não pela mesma porta que os cinco primeiros:
// `handle_new_user` não é objeto legado descoberto numa varredura — é o gatilho
// que carimba uma linha em `nutricionistas` a CADA conta nova de auth.users, e
// que estava vivo sem aparecer em nenhum arquivo do repositório. Entrou aqui
// porque a conferência 70 é o único lugar que compara repositório × banco item
// a item, e um objeto que roda em todo cadastro precisa estar nessa comparação.
const BASELINES_ESPERADOS = [
  'nutricionistas_legacy_baseline.sql',
  'pacientes_legacy_baseline.sql',
  'clinico_legacy_baseline.sql',
  'convites_legacy_baseline.sql',
  'auth_legacy_rpcs_baseline.sql',
  'auth_signup_baseline.sql',
];

const TABELAS = [
  'nutricionistas', 'pacientes',
  'avaliacoes', 'respostas', 'exames', 'recordatorio_calc',
  'codigos_convite', 'codigos_uso',
];

const RPCS = [
  'validar_codigo_convite',
  'registrar_uso_codigo',
  'rpc_salvar_respostas',
  'rpc_marcar_completo',
  'rpc_buscar_paciente_por_codigo',
  'gerar_codigo_paciente',
];

// RPCS é a lista de auth_legacy_rpcs_baseline.sql; FUNCOES é tudo o que a
// conferência 70 confere. As duas separadas de propósito: o teste do
// `$function$` conta as marcas DAQUELE arquivo, e somar handle_new_user ali
// faria a conta dar errado por um motivo que não tem nada a ver com ele.
const FUNCOES = [...RPCS, 'handle_new_user'];

const TRIGGERS = ['on_auth_user_created', 'trg_avaliacoes_atualizado'];

const textoDe = f => ler(f);
const tudo = () => BASELINES.map(textoDe).join('\n');

// Sem comentários: as asserções que proíbem algo não podem casar com o
// comentário que EXPLICA por que aquilo é proibido. Foi assim que uma guarda
// da barra do PWA passou a conferir meia regra.
const semComentario = s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');


// ═══════════════════════════════════════════════════════════
grupo('etapa 1b · os cinco baselines existem e se declaram', () => {

  teste('os cinco arquivos estão no repositório', () => {
    // BASELINES_ESPERADOS, e não a lista descoberta: conferir a lista
    // descoberta contra o disco é tautologia — ela VEM do disco.
    const naDb = readdirSync(new URL('../db/', import.meta.url));
    for (const f of BASELINES_ESPERADOS) {
      ok(naDb.includes(f), `falta db/${f}`);
    }
  });

  teste('cada um se declara BASELINE e desaconselha execução cega', () => {
    // É a única coisa que separa este arquivo de uma migration, e ela é
    // textual: quem abrir precisa ler isso antes de qualquer comando.
    for (const f of BASELINES) {
      const s = textoDe(f);
      contem(s, 'BASELINE DE');
      contem(s, 'NAO E MIGRATION');
      contem(s, 'NAO EXECUTE ESTE ARQUIVO CEGAMENTE');
    }
  });

  teste('nenhum baseline tem par de desfazer', () => {
    // §15: a etapa não altera banco, então rollback de banco não existe.
    // Criar `*_desfazer.sql` só por convenção sugeriria que houve alteração.
    const naDb = readdirSync(new URL('../db/', import.meta.url));
    for (const f of BASELINES) {
      const desfazer = f.replace('.sql', '_desfazer.sql');
      ok(!naDb.includes(desfazer), `${desfazer} não deveria existir`);
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 1b · os objetos legados estão representados', () => {

  teste('as oito tabelas legadas aparecem', () => {
    const s = tudo();
    for (const t of TABELAS) {
      ok(s.includes(`create table if not exists public.${t} (`),
         `public.${t} não está representada em nenhum baseline`);
    }
  });

  teste('as seis RPCs aparecem com corpo, não só citadas', () => {
    const s = textoDe('auth_legacy_rpcs_baseline.sql');
    for (const r of RPCS) {
      ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${r}\\s*\\(`).test(s),
         `${r} não tem definição no baseline`);
    }
    // Corpo de verdade: seis pares de $function$ abrindo e fechando.
    igual((s.match(/\$function\$/g) || []).length, 12,
          'cada função abre e fecha um $function$ — 6 funções, 12 marcas');
  });

  teste('as assinaturas vêm completas, com tipos de parâmetro', () => {
    // Assinatura sem tipo é assinatura inútil: o Postgres resolve overload por
    // tipo, e um baseline que diz `registrar_uso_codigo(...)` não permite
    // recriar nem conferir a função.
    const s = textoDe('auth_legacy_rpcs_baseline.sql');
    contem(s, 'validar_codigo_convite(p_codigo text)');
    contem(s, 'registrar_uso_codigo(p_codigo text, p_nutri_id uuid, p_email text)');
    contem(s, 'rpc_salvar_respostas(p_codigo text, p_modulos jsonb)');
    contem(s, 'rpc_marcar_completo(p_codigo text)');
    contem(s, 'rpc_buscar_paciente_por_codigo(p_codigo text)');
    contem(s, 'gerar_codigo_paciente()');
  });

  teste('security e search_path de cada função ficam registrados', () => {
    // SEM COMENTÁRIO, e é obrigatório: os comentários deste baseline explicam
    // que duas funções são `SECURITY DEFINER` sem `set search_path`. Contando
    // o texto cru, a explicação entra na conta e a guarda passa a medir quanto
    // eu escrevi, não o que o arquivo declara.
    const s = semComentario(textoDe('auth_legacy_rpcs_baseline.sql'));
    igual((s.match(/SECURITY DEFINER/g) || []).length, 5,
          'cinco das seis são security definer — gerar_codigo_paciente é invoker');
    igual((s.match(/SET search_path TO 'public'/g) || []).length, 3,
          'só as três da anamnese fixam search_path; as outras três não fixam');
  });

  teste('o trigger legado de avaliações está representado', () => {
    const s = textoDe('clinico_legacy_baseline.sql');
    contem(s, 'create trigger trg_avaliacoes_atualizado');
    contem(s, 'execute function public.set_atualizado_em()');
  });

  teste('a função do trigger NÃO é duplicada aqui', () => {
    // Ela já existe versionada em db/foods_schema.sql. Duas definições para a
    // mesma função significam que a última a rodar vence, em silêncio.
    const s = textoDe('clinico_legacy_baseline.sql');
    ok(!/create or replace function public\.set_atualizado_em/i.test(s),
       'set_atualizado_em pertence a foods_schema.sql — aqui só a dependência');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 1b · nenhum baseline atravessa o escopo da etapa', () => {

  teste('nenhum cria organização, perfil ou permissão', () => {
    // §13: a fundação multiusuário é a Etapa 2. Se ela vazar para cá, o
    // baseline deixa de representar o banco atual.
    const s = semComentario(tudo());
    for (const t of ['organizacoes', 'organizacao_usuarios', 'perfis', 'permissoes',
                     'perfil_permissoes', 'usuario_permissoes']) {
      ok(!new RegExp(`create table[^;]*\\b${t}\\b`, 'i').test(s),
         `baseline não pode criar ${t}`);
    }
    ok(!/organizacao_do_auth/i.test(s),
       'organizacao_do_auth() é da Etapa 2');
  });

  teste('nenhum troca auth.uid() por outra coisa', () => {
    // Todo auth.uid() do dump continua auth.uid() aqui. A troca é da Etapa 4,
    // módulo a módulo, e não pode acontecer por acidente num arquivo que se
    // apresenta como retrato.
    const s = semComentario(tudo());
    const usos = (s.match(/auth\.uid\(\)/g) || []).length;
    ok(usos >= 8, `esperava os auth.uid() das policies legadas, achei ${usos}`);
    ok(!/organizacao_do_auth\(\)/.test(s), 'nenhuma substituição pode ter acontecido');
  });

  teste('nenhum executa hardening: sem revoke, sem grant, sem default privileges', () => {
    // §7: a etapa DOCUMENTA os grants amplos. Escrever `grant`/`revoke` num
    // arquivo do repositório faria o retrato virar recomendação.
    const s = semComentario(tudo());
    ok(!/^\s*revoke\b/im.test(s), 'revoke é hardening, não baseline');
    ok(!/^\s*grant\b/im.test(s), 'grant é hardening, não baseline');
    ok(!/alter\s+default\s+privileges/i.test(s), 'default privileges é outra decisão');
  });

  teste('nenhum conserta exames', () => {
    // A ausência de policy de INSERT é deliberada — veio de
    // db/exames_fechar_insercao_publica.sql. Reabri-la aqui desfaria uma
    // correção de segurança sem ninguém perceber.
    const s = semComentario(textoDe('clinico_legacy_baseline.sql'));
    const regras = s.match(/create policy[^;]*on public\.exames[^;]*;/gi) || [];
    igual(regras.length, 1, 'exames tem UMA policy, e é a de leitura');
    ok(/for select/i.test(regras[0]), 'a única policy de exames é SELECT');
  });

  teste('nenhum adiciona policy aos códigos de convite', () => {
    // RLS ativa com zero policies é o desenho: só funções DEFINER entram.
    const s = semComentario(textoDe('convites_legacy_baseline.sql'));
    for (const t of ['codigos_convite', 'codigos_uso']) {
      ok(!new RegExp(`create policy[^;]*on public\\.${t}`, 'i').test(s),
         `${t} não pode ganhar policy — o acesso é por SECURITY DEFINER`);
    }
    contem(s, 'alter table public.codigos_convite enable row level security');
    contem(s, 'alter table public.codigos_uso enable row level security');
  });

  teste('nenhum toca em storage, front ou auditoria', () => {
    const s = semComentario(tudo());
    ok(!/storage\.objects|storage\.buckets/i.test(s), 'storage é Etapa 4');
    ok(!/_auditoria/i.test(s), 'auditoria não muda nesta etapa');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 1b · os achados ficam marcados, e como achado', () => {

  teste('cada achado usa a marcação combinada', () => {
    // §3: comentário de diagnóstico não pode se confundir com decisão tomada.
    const s = tudo();
    const marcas = (s.match(/ACHADO DE DIAGNOSTICO - NAO CORRIGIDO NESTA ETAPA/g) || []).length;
    ok(marcas >= 6, `esperava os achados marcados, achei ${marcas}`);
  });

  teste('os dois achados que mais custam estão escritos', () => {
    const rpcs = textoDe('auth_legacy_rpcs_baseline.sql');
    // O bug latente de tenancy: quem gera código não enxerga a tabela inteira.
    contem(rpcs, 'SECURITY INVOKER');
    contem(rpcs, 'UNIQUE GLOBAL');
    // O dono vindo por parâmetro em função aberta para anon.
    contem(rpcs, 'recebe p_nutri_id por PARAMETRO');
  });

  teste('o que é deliberado NÃO está marcado como achado', () => {
    // exames e códigos de convite estão como estão de propósito. Marcá-los
    // como achado convidaria alguém a "consertar" uma correção.
    const clinico = textoDe('clinico_legacy_baseline.sql');
    contem(clinico, 'E DELIBERADA, NAO E ACHADO');
    contem(clinico, 'exames_fechar_insercao_publica.sql');
    const convites = textoDe('convites_legacy_baseline.sql');
    contem(convites, 'E DE PROPOSITO, NAO E ACHADO');
    contem(convites, 'convites_fechar_leitura_publica.sql');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 1b · a conferência cobre tudo o que o baseline declara', () => {
  // A cobertura é DESCOBERTA dos baselines, não escrita à mão aqui. Uma
  // tabela nova num baseline entra na conferência sozinha; se o gerador
  // deixar de vê-la, é aqui que aparece.
  //
  // Foi o que pegou o primeiro defeito do gerador: o filtro procurava
  // `_legacy_baseline.sql` e auth_legacy_rpcs_baseline.sql termina em
  // `_rpcs_baseline.sql`. Ele rodava sem erro e emitia zero funções.

  teste('o gerador enxerga os seis baselines', () => {
    igual([...BASELINES].sort(), [...BASELINES_ESPERADOS].sort());
  });

  teste('as oito tabelas do baseline entram na conferência', () => {
    const { tabelas } = inventario();
    for (const t of TABELAS) {
      ok(tabelas.includes(t), `${t} está no baseline mas fora da conferência`);
    }
    igual(tabelas.length, TABELAS.length, 'nem a mais, nem a menos');
  });

  teste('as funções dos baselines entram na conferência', () => {
    const { funcoes } = inventario();
    for (const r of FUNCOES) {
      ok(funcoes.includes(r), `${r} está no baseline mas fora da conferência`);
    }
    igual(funcoes.length, FUNCOES.length);
  });

  teste('os triggers legados entram na conferência', () => {
    igual([...inventario().triggers].sort(), [...TRIGGERS].sort());
  });

  teste('cada tabela é conferida em profundidade, não só citada', () => {
    // Aparecer na lista não basta: se o gerador extrair o nome mas nenhuma
    // coluna, a conferência passaria dizendo "OK" sobre nada.
    const itens = esperados();
    for (const t of TABELAS) {
      const meus = itens.filter(i => i.objeto === t);
      ok(meus.some(i => i.item.startsWith('coluna:')), `${t} sem colunas conferidas`);
      ok(meus.some(i => i.item === 'rls'), `${t} sem estado de RLS conferido`);
      ok(meus.some(i => i.item.startsWith('constraint:')), `${t} sem constraints conferidas`);
    }
  });

  teste('cada RPC confere assinatura, security, search_path e corpo', () => {
    const itens = esperados();
    for (const r of RPCS) {
      const meus = itens.filter(i => i.objeto === `fn:${r}`).map(i => i.item);
      for (const campo of ['assinatura', 'linguagem', 'security', 'search_path', 'corpo']) {
        ok(meus.includes(campo), `fn:${r} não confere ${campo}`);
      }
    }
  });

  teste('o arquivo gerado está em dia com os baselines', () => {
    // Snapshot: se alguém editar um baseline e esquecer de regerar, o .sql
    // versionado passa a mentir sobre o que espera. Regerar é
    // `node test/gerar-conferencia-legado.mjs`.
    const gerado = readFileSync(
      new URL('../db/conferencia/70_legacy_baseline_comparacao_LIMPO.sql', import.meta.url), 'utf8');
    igual(gerado, gerarSql(),
          'db/conferencia/70_* está desatualizado — rode node test/gerar-conferencia-legado.mjs');
  });

  teste('o script de conferência não altera nada', () => {
    const sql = readFileSync(
      new URL('../db/conferencia/70_legacy_baseline_comparacao.sql', import.meta.url), 'utf8');
    const comandos = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
    for (const proibido of ['insert into', 'update ', 'delete from', 'drop ', 'alter ',
                            'create table', 'create policy', 'grant ', 'revoke ', 'truncate']) {
      ok(!new RegExp(`^\\s*${proibido}`, 'im').test(comandos),
         `conferência não pode conter "${proibido}"`);
    }
  });
});
