// ═══════════════════════════════════════════════════════════
// ETAPA 4A — o piloto: RLS multiusuário em comercial_planos
// ═══════════════════════════════════════════════════════════
// O que estas guardas protegem é o PADRÃO, não o módulo. Comercial/Planos é a
// primeira das oito ou nove subetapas da Etapa 4, e cada uma vai repetir as
// mesmas quatro camadas: tenancy no banco, tenancy na escrita, tenancy no
// frontend e permissão. Uma regressão aqui é uma regressão em todas.
//
// O modo de falha que elas existem para pegar é SILENCIOSO: com o frontend
// pedindo `user.id` contra uma policy que exige a organização, a tela abre
// vazia e sem erro — e o proprietário não percebe, porque para ele os dois
// valores são iguais. Nenhum teste de fumaça pega isso; só uma asserção
// textual pega.

import { readFileSync } from 'node:fs';
import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';

const ler = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const ORG      = ler('js/organizacao.js');
const DADOS    = ler('js/comercial-data.js');
const INDEX    = ler('index.html');
const MIGRA    = ler('db/multiusuario_comercial_planos_rls.sql');
const DESFAZER = ler('db/multiusuario_comercial_planos_rls_desfazer.sql');
const ANTES    = ler('db/conferencia/87_comercial_planos_antes.sql');
const RLS      = ler('db/conferencia/88_comercial_planos_rls_real.sql');
const DEPOIS   = ler('db/conferencia/89_comercial_planos_depois.sql');

// Sem comentário: as asserções que PROÍBEM algo não podem casar com o
// comentário que explica por que aquilo é proibido. Já aconteceu cinco vezes
// neste projeto, e o pior caso leu uma chamada dentro de um comentário.
const semJs  = s => s.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
const semSql = s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');

const ORG_JS   = semJs(ORG);
const DADOS_JS = semJs(DADOS);
const MIGRA_SQL    = semSql(MIGRA);
const DESFAZER_SQL = semSql(DESFAZER);

/** O corpo de uma função exportada de comercial-data.js. */
const funcao = (nome) => {
  const i = DADOS_JS.indexOf(`export async function ${nome}(`);
  if (i < 0) return '';
  const j = DADOS_JS.indexOf('\nexport ', i + 1);
  return DADOS_JS.slice(i, j < 0 ? undefined : j);
};

const PLANOS = ['listarPlanos', 'criarPlano', 'salvarPlano'];


// ═══════════════════════════════════════════════════════════
grupo('etapa 4a · o helper de organização', () => {

  teste('existe e resolve pela RPC da fundação', () => {
    contem(ORG_JS, "sb.rpc('organizacao_do_auth')");
    contem(ORG_JS, 'export async function organizacaoAtual');
    contem(ORG_JS, 'export function limparOrganizacao');
  });

  teste('NÃO faz fallback para auth.uid()', () => {
    // É a guarda mais importante do arquivo. Cair para o uuid da pessoa "para
    // não quebrar a tela" reintroduziria o bug exato que ele existe para
    // eliminar — e o reintroduziria no caminho de erro, onde ninguém olha.
    ok(!/getUser\(\)/.test(ORG_JS), 'organizacao.js não pode ler o usuário');
    ok(!/user\.id/.test(ORG_JS),    'organizacao.js não pode devolver user.id');
    ok(!/auth\.uid/.test(ORG_JS),   'nenhum fallback para auth.uid()');
  });

  teste('null da RPC vira erro, não valor', () => {
    // Três situações devolvem NULL e nenhuma permite continuar: sem sessão,
    // sem vínculo, bloqueado. Gravar sem saber o dono é pior que falhar.
    contem(ORG_JS, "throw new Error('sem_organizacao')");
  });

  teste('cache só em memória', () => {
    naoContem(ORG_JS, 'localStorage');
    naoContem(ORG_JS, 'sessionStorage');
    naoContem(ORG_JS, 'document.cookie');
  });

  teste('deduplica chamadas simultâneas', () => {
    // A tela do Comercial dispara três consultas em paralelo; sem isto seriam
    // três idas à rede para a mesma resposta.
    contem(ORG_JS, '_carregando');
    contem(ORG_JS, 'if (_carregando) return _carregando');
  });

  teste('é limpo no logout, junto das permissões', () => {
    // Herdar a organização da conta anterior é pior que herdar o menu: não
    // mostra dado de menos, grava dado no tenant errado.
    contem(INDEX, 'limparOrganizacao');
    const i = INDEX.indexOf('limparPermissoes();');
    const bloco = INDEX.slice(i, i + 300);
    contem(bloco, 'limparOrganizacao()');
  });

  teste('não se mistura com permissões', () => {
    // organizacao.js responde DE QUEM É o dado; permissoes.js responde O QUE a
    // pessoa pode fazer. Ciclos de invalidação diferentes.
    naoContem(ORG_JS, 'minhas_permissoes');
    naoContem(ORG_JS, 'tem_permissao');
    const PERM = semJs(ler('js/permissoes.js'));
    naoContem(PERM, 'organizacao_do_auth');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 4a · o frontend do piloto', () => {

  teste('as três funções de plano resolvem pela organização', () => {
    for (const f of PLANOS) {
      const corpo = funcao(f);
      ok(corpo.length > 0, `${f} não encontrada`);
    }
    // Só as duas que filtram; criarPlano não precisa saber o dono.
    for (const f of ['listarPlanos', 'salvarPlano']) {
      contem(funcao(f), 'await organizacaoAtual()');
    }
  });

  teste('nenhuma função de plano usa nutriId()', () => {
    // nutriId() continua no arquivo, e deve continuar: as outras onze funções
    // tocam tabelas ainda não migradas. Mas nenhuma das três de plano.
    for (const f of PLANOS) {
      ok(!/nutriId\(\)/.test(funcao(f)), `${f} ainda usa nutriId()`);
    }
  });

  teste('nutriId() sobrevive para o que ainda não migrou', () => {
    // Apagá-lo faria as onze funções restantes pedirem a organização contra
    // policies que exigem a pessoa — quebra invisível para o proprietário.
    contem(DADOS_JS, 'async function nutriId()');
    for (const f of ['listarAssinaturas', 'criarCobranca', 'pacientesSemAssinatura']) {
      contem(funcao(f), 'await nutriId()');
    }
  });

  teste('o INSERT não manda nutri_id', () => {
    // Quem determina o tenant é o banco, pelo default. O frontend manda dado
    // de negócio e mais nada — assim não existe caminho em que uma tela
    // escolha o dono de um registro.
    const corpo = funcao('criarPlano');
    // Só o argumento do `.insert(...)`: o corpo inteiro casaria com o
    // `nutri_id: _naoUsado` da desestruturação, que é justamente o que
    // GARANTE que ele não vai para o payload.
    const payload = (corpo.match(/\.insert\(([^)]*)\)/) || ['', ''])[1];
    ok(!/nutri_id/.test(payload), `criarPlano não pode mandar nutri_id — mandou: ${payload}`);
    contem(corpo, '.insert(negocio)');
  });

  teste('o INSERT descarta nutri_id se vier de fora', () => {
    // Deixar passar em silêncio devolveria ao frontend justamente a
    // autoridade que esta mudança tira dele.
    contem(funcao('criarPlano'), 'nutri_id: _naoUsado');
  });

  teste('o filtro explícito continua existindo', () => {
    // O cabeçalho do arquivo registra por que ele existe: a conta do
    // proprietário é nutri E paciente, e as policies são OR'd. Trocar por
    // "confiar no RLS" desfaria uma correção antiga.
    contem(funcao('listarPlanos'), ".eq('nutri_id', org)");
    contem(funcao('salvarPlano'),  ".eq('nutri_id', org)");
  });

  teste('salvarPlano continua sem deixar trocar o dono', () => {
    contem(funcao('salvarPlano'), 'const { nutri_id, id: _ignorado, ...limpo }');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 4a · a migration', () => {

  teste('as quatro policies têm tenancy E permissão', () => {
    // Trocar só o predicado de tenancy faria qualquer membro ativo enxergar
    // tudo. Não é avanço; é regressão de privacidade com cara de progresso.
    const criadas = MIGRA_SQL.match(/create policy \w+ on public\.comercial_planos[\s\S]*?;/g) || [];
    igual(criadas.length, 4, 'quatro policies, uma por operação');
    for (const p of criadas) {
      contem(p, 'nutri_id = public.organizacao_do_auth()');
      contem(p, 'public.tem_permissao(');
      contem(p, 'to authenticated');
    }
  });

  teste('a chave certa em cada operação', () => {
    const daOperacao = (op) => {
      const re = new RegExp(`create policy \\w+ on public\\.comercial_planos\\s+for ${op}[\\s\\S]*?;`);
      return (MIGRA_SQL.match(re) || [''])[0];
    };
    contem(daOperacao('select'), "tem_permissao('comercial.visualizar')");
    for (const op of ['insert', 'update', 'delete']) {
      contem(daOperacao(op), "tem_permissao('comercial.editar')");
    }
    // E o SELECT não pode pedir editar: quem só lê deixaria de ler.
    ok(!/for select[\s\S]*?comercial\.editar/.test(daOperacao('select')));
  });

  teste('o UPDATE exige a mesma chave nos dois lados', () => {
    // `using` decide quais linhas podem ser alvo; `with check` decide como
    // podem ficar. Pedir visualizar no using daria a recusa no lugar errado.
    const upd = (MIGRA_SQL.match(/for update[\s\S]*?;/) || [''])[0];
    igual((upd.match(/tem_permissao\('comercial\.editar'\)/g) || []).length, 2);
    igual((upd.match(/organizacao_do_auth\(\)/g) || []).length, 2,
          'com o with check também amarrado à organização, não há update que MOVA a linha de tenant');
  });

  teste('o default de nutri_id muda; o de criado_por não', () => {
    contem(MIGRA_SQL, 'alter column nutri_id set default public.organizacao_do_auth()');
    ok(!/criado_por set default/.test(MIGRA_SQL),
       'criado_por é o AUTOR e continua auth.uid() — é a prova central do piloto');
  });

  teste('não toca em nenhuma outra tabela', () => {
    // O escopo da 4A é uma tabela. As outras quatro do módulo dependem de
    // pacientes e do financeiro, que não migraram.
    for (const t of ['comercial_assinaturas', 'financeiro_lancamentos',
                     'financeiro_categorias', 'pacientes']) {
      ok(!new RegExp(`(create|drop|alter)[\\s\\S]{0,80}public\\.${t}\\b`).test(MIGRA_SQL),
         `a migration não pode tocar em ${t}`);
    }
  });

  teste('não cria SECURITY DEFINER para contornar pacientes', () => {
    naoContem(MIGRA_SQL, 'security definer');
    naoContem(MIGRA_SQL, 'create or replace function');
  });

  teste('não cria comercial.excluir', () => {
    naoContem(MIGRA_SQL, 'comercial.excluir');
    naoContem(MIGRA_SQL, 'insert into public.permissoes');
  });

  teste('não altera dado nenhum', () => {
    ok(!/\bupdate public\./.test(MIGRA_SQL), 'nenhum update');
    ok(!/\bdelete from\b/.test(MIGRA_SQL),   'nenhum delete');
    ok(!/\binsert into public\./.test(MIGRA_SQL), 'nenhum insert');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 4a · o rollback', () => {

  teste('restaura as quatro policies antigas, literalmente', () => {
    // Fonte: db/comercial_etapa2_planos.sql, linhas 199–206. Reconstruir de
    // memória é o que o baseline da Etapa 1b existe para evitar.
    const antigas = DESFAZER_SQL.match(/create policy \w+ on public\.comercial_planos[\s\S]*?;/g) || [];
    igual(antigas.length, 4);
    for (const p of antigas) {
      contem(p, 'nutri_id = auth.uid()');
      ok(!/organizacao_do_auth/.test(p), 'o rollback volta ao predicado antigo');
      ok(!/tem_permissao/.test(p),       'e sem permissão, como era');
    }
  });

  teste('restaura o default antigo', () => {
    contem(DESFAZER_SQL, 'alter column nutri_id set default auth.uid()');
  });

  teste('não apaga dado', () => {
    ok(!/\bdelete from\b/.test(DESFAZER_SQL));
    ok(!/\bdrop table\b/.test(DESFAZER_SQL));
  });

  teste('diz que não desfaz JavaScript, e em que ordem', () => {
    // Um arquivo SQL não desfaz um deploy. Fingir atomicidade entre os dois é
    // como o rollback quebra a Recepção em silêncio.
    contem(DESFAZER, 'ROLLBACK FUNCIONAL');
    contem(DESFAZER, 'FRONTEND');
    contem(DESFAZER, 'BANCO');
  });

  teste('a migration avisa que o frontend vem primeiro', () => {
    contem(MIGRA, 'O FRONTEND PRECISA ESTAR NO AR');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 4a · as conferências', () => {

  teste('o ANTES e o DEPOIS perguntam as mesmas coisas', () => {
    // Sem simetria, a comparação não vale: um número de depois sem o de antes
    // não significa nada.
    for (const item of ['linhas no total', 'donos distintos',
                        'da organizacao principal', 'da organizacao do Caio']) {
      contem(ANTES,  item);
      contem(DEPOIS, item);
    }
  });

  teste('o ANTES só lê', () => {
    const sql = semSql(ANTES);
    ok(!/\bupdate public\.|\bdelete from public\.|\binsert into public\./.test(sql),
       'o retrato não pode alterar o que retrata');
  });

  teste('o teste de RLS troca de papel, e não confia no postgres', () => {
    // postgres tem BYPASSRLS: todo teste de RLS feito com ele passa por
    // construção e não mede nada.
    contem(RLS, "set_config('role', 'authenticated', true)");
    contem(RLS, "request.jwt.claims");
    contem(RLS, 'reset role');
    naoContem(semSql(RLS), 'service_role');
  });

  teste('o teste de RLS exercita as quatro identidades', () => {
    const sql = semSql(RLS);
    contem(sql, 'v_caio');
    contem(sql, 'v_dono');
    contem(sql, 'v_recep');
    contem(sql, 'tenant forjado');
  });

  teste('o teste de RLS reverte e confere que reverteu', () => {
    contem(RLS, "raise exception 'ROLLBACK_DA_PROVA'");
    contem(RLS, 'SEM RASTRO');
    contem(RLS, 'fixtures restantes');
  });

  teste('o resultado não se anuncia como E2E', () => {
    // `set local role` prova o motor de RLS; não prova PostgREST, embed,
    // grant, nem navegador. Transformar uma coisa na outra é o tipo de
    // otimismo que só aparece em produção.
    contem(RLS, 'APROVADO — MOTOR RLS POSTGRESQL');
    contem(RLS, 'NAO PROVA');
  });

  teste('o DEPOIS confere a chave por operação', () => {
    contem(DEPOIS, 'CHAVE POR OPERACAO');
    contem(DEPOIS, 'INTOCADO');
  });
});
