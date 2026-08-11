// ═══════════════════════════════════════════════════════════
// ETAPA 3 — Usuários e acessos
// ═══════════════════════════════════════════════════════════
// Estas guardas leem código, não banco. Elas protegem o contrato: toda
// operação sensível passa por RPC que confere permissão, nenhuma tabela nova
// aceita escrita direta, e a Etapa 3 não começa a migrar policy nenhuma.
//
// O que só existe em execução — o segundo login resolver a organização certa,
// o bloqueio zerar as permissões, a exceção conceder e revogar — mora em
// db/conferencia/74_usuarios_acessos.sql, que roda no banco. Teste que
// fingisse cobrir isso seria pior que nenhum.

import { readFileSync } from 'node:fs';
import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { trocarPerfil } from '../js/usuarios-data.js';
import { ultimoAcesso, excecoesRedundantes, semAcessoHtml,
         indicadoresHtml, linhaUsuarioHtml } from '../js/usuarios-ui.js';

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SQL      = ler('db/organizacao_usuarios_admin.sql');
const DESFAZER = ler('db/organizacao_usuarios_admin_desfazer.sql');
const DATA     = ler('js/usuarios-data.js');
const UI       = ler('js/usuarios-ui.js');
const PERM     = ler('js/permissoes.js');
const HTML     = ler('index.html');

// SEM COMENTÁRIO, e é obrigatório em toda asserção que PROÍBE algo: os
// comentários deste módulo explicam por que `localStorage` não pode ser usado,
// por que não há `.from('organizacao_usuarios')` e por que a tela externa não
// migra nada. Lendo o texto cru, a guarda encontra a explicação e acusa a
// própria justificativa.
//
// Custou cinco falhas de uma vez para eu aprender isto pela quarta vez neste
// projeto — e uma delas foi pior: o slice de `iniciarApp` terminava num
// `restaurarRota()` que estava DENTRO de um comentário, e a guarda conferia
// um trecho que nem chegava ao código.
const semComentario = s => s.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
const semJs = s => s.split('\n')
  .filter(l => !l.trimStart().startsWith('//'))
  .join('\n')
  .replace(/<!--[\s\S]*?-->/g, '');

const SQLC  = semComentario(SQL);
const DATAC = semJs(DATA);
const UIC   = semJs(UI);
const PERMC = semJs(PERM);
const HTMLC = semJs(HTML);

const RPCS_ESCRITA = ['usuario_convidar', 'usuario_vincular', 'usuario_definir_perfil',
                      'usuario_definir_status', 'usuario_definir_permissao',
                      'usuario_convite_revogar'];
const RPCS_LEITURA = ['usuarios_da_organizacao', 'convites_pendentes', 'permissoes_do_usuario',
                      'contas_fora_da_organizacao', 'conta_externa_detalhe', 'registrar_meu_acesso'];


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · toda escrita passa por RPC que confere permissão', () => {

  teste('o frontend não escreve direto nas tabelas da administração', () => {
    // As tabelas ou têm RLS sem policy de escrita, ou não têm policy nenhuma.
    // Um `.from(...).insert()` aqui seria código morto que parece funcionar.
    for (const t of ['organizacao_usuarios', 'organizacao_convites', 'usuario_permissoes',
                     'perfil_permissoes', 'organizacao_auditoria']) {
      ok(!new RegExp(`from\\(['"]${t}['"]\\)`).test(DATAC), `${t} acessada direto no front`);
    }
  });

  teste('cada RPC de escrita exige usuarios.gerenciar', () => {
    for (const rpc of RPCS_ESCRITA.filter(r => r !== 'usuario_vincular')) {
      const i = SQLC.indexOf(`create or replace function public.${rpc}`);
      ok(i > 0, `${rpc} não existe`);
      const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
      contem(corpo, "exige_permissao('usuarios.gerenciar')");
    }
  });

  teste('exige_permissao confere sessão, organização E permissão', () => {
    const i = SQLC.indexOf('create or replace function public.exige_permissao');
    const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
    contem(corpo, 'precisa_estar_logado');
    contem(corpo, 'sem_organizacao');
    contem(corpo, 'sem_permissao');
  });

  teste('toda RPC nova é definer com search_path fixo', () => {
    // Definer passa por cima da RLS: sem search_path fixo, é a forma clássica
    // de escalada de privilégio.
    for (const rpc of [...RPCS_ESCRITA, ...RPCS_LEITURA, 'exige_permissao', 'gerar_codigo_organizacao']) {
      const i = SQLC.indexOf(`create or replace function public.${rpc}`);
      ok(i > 0, `${rpc} não existe`);
      const cabecalho = SQLC.slice(i, SQLC.indexOf('as $fn$', i));
      contem(cabecalho, 'security definer');
      contem(cabecalho, 'set search_path = public');
    }
  });

  teste('cada leitura confere organização E permissão — definer não isola sozinho', () => {
    // Esquecer o escopo numa função definer é vazar entre organizações. É o
    // risco mais caro desta etapa, e por isso a guarda é por função.
    for (const rpc of ['usuarios_da_organizacao', 'convites_pendentes',
                       'permissoes_do_usuario', 'contas_fora_da_organizacao']) {
      const i = SQLC.indexOf(`create or replace function public.${rpc}`);
      const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
      contem(corpo, 'public.tem_permissao(');
      if (rpc !== 'contas_fora_da_organizacao') {
        contem(corpo, 'public.organizacao_do_auth()');
      }
    }
  });

  teste('ACL: as internas não vão para authenticated', () => {
    // exige_permissao e o gerador são chamados de dentro das outras, que já
    // rodam como definer. Expor os dois daria a qualquer autenticado o poder
    // de gerar código válido.
    for (const f of ['exige_permissao(text)', 'gerar_codigo_organizacao()',
                     'fn_protege_ultimo_proprietario()']) {
      const escapado = f.replace(/[()]/g, '\\$&');
      ok(new RegExp(`revoke all on function public\\.${escapado}\\s+from public, anon, authenticated`).test(SQL),
         `${f} deveria ser interna`);
      ok(!new RegExp(`grant execute on function public\\.${escapado}`).test(SQL),
         `${f} não pode ter grant`);
    }
  });

  teste('ACL: as expostas revogam public e anon, e concedem a authenticated', () => {
    for (const rpc of [...RPCS_ESCRITA, ...RPCS_LEITURA]) {
      ok(new RegExp(`revoke all on function public\\.${rpc}\\(`).test(SQL), `${rpc} sem revoke`);
      ok(new RegExp(`grant execute on function public\\.${rpc}\\(`).test(SQL), `${rpc} sem grant`);
    }
    naoContem(SQL, 'to anon;');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · o código de vínculo', () => {

  teste('tem estrutura própria, e não reaproveita as outras três', () => {
    // pacientes.codigo abre a anamnese pública; funcionarios.codigo_acesso
    // vincula colaborador; codigos_convite cria organização nova. Misturar
    // seria dar a um o poder do outro.
    contem(SQLC, 'create table if not exists public.organizacao_convites');
    ok(!/from public\.codigos_convite/.test(SQLC), 'não pode usar o código do SaaS');
    ok(!/funcionarios.*codigo_acesso/.test(SQLC), 'não pode usar o código do colaborador');
  });

  teste('é único, expirável, revogável e de uso único', () => {
    contem(SQLC, 'create unique index if not exists uq_org_convite_codigo');
    contem(SQLC, 'upper(codigo)');
    contem(SQLC, 'expira_em');
    contem(SQLC, 'revogado_em');
    contem(SQLC, 'usado_em');
  });

  teste('o gerador é DEFINER — o de paciente é invoker e por isso quebra', () => {
    // gerar_codigo_paciente() é invoker e só enxerga os próprios pacientes ao
    // testar unicidade, enquanto o código é único global: com duas
    // organizações, gera repetido. Aqui a função vê a tabela inteira.
    const i = SQLC.indexOf('create or replace function public.gerar_codigo_organizacao');
    const cabecalho = SQLC.slice(i, SQLC.indexOf('as $fn$', i));
    contem(cabecalho, 'security definer');
    // Alfabeto sem 0/O/1/I/L: o código vai ser ditado por telefone.
    ok(!/ABCDEFGHIJKLMNOP/.test(SQLC), 'alfabeto com caracteres ambíguos');
  });

  teste('o vínculo valida tudo o que foi especificado', () => {
    const i = SQLC.indexOf('create or replace function public.usuario_vincular');
    const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
    for (const erro of ['precisa_estar_logado', 'conta_ja_vinculada', 'codigo_invalido',
                        'codigo_revogado', 'codigo_usado', 'codigo_expirado',
                        'organizacao_inativa', 'email_diferente_do_convite']) {
      contem(corpo, erro);
    }
  });

  teste('o e-mail do convite tem que bater com o da conta', () => {
    // Sem isto o código sozinho é a credencial: quem interceptar entra na
    // organização. Com isto ele só vale para quem foi convidado.
    const i = SQLC.indexOf('create or replace function public.usuario_vincular');
    const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
    contem(corpo, 'lower(u.email)');
    contem(corpo, 'is distinct from lower(c.email)');
  });

  teste('proprietário não nasce por convite', () => {
    for (const rpc of ['usuario_convidar', 'usuario_definir_perfil']) {
      const i = SQLC.indexOf(`create or replace function public.${rpc}`);
      const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
      contem(corpo, 'perfil_proprietario_nao_permitido');
    }
  });

  teste('o convite não pode ser de colaborador de outra organização', () => {
    contem(SQLC, 'funcionario_de_outra_organizacao');
    contem(SQLC, 'f.nutri_id = v_org');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · último proprietário e bloqueio', () => {

  teste('a trava do último proprietário é TRIGGER, não só RPC', () => {
    // "Mesmo que a UI tenha bug": qualquer caminho — RPC, SQL Editor, script
    // futuro — esbarra no trigger.
    contem(SQLC, 'create trigger trg_protege_ultimo_proprietario');
    contem(SQLC, 'before update or delete on public.organizacao_usuarios');
    contem(SQLC, "raise exception 'ultimo_proprietario'");
  });

  teste('a trava permite transferir a propriedade', () => {
    // Promover outra pessoa e só então rebaixar a primeira tem que funcionar.
    // O que ela impede é a organização ficar sem NENHUM proprietário ativo.
    const i = SQLC.indexOf('create or replace function public.fn_protege_ultimo_proprietario');
    const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
    contem(corpo, 'if v_sera_prop and new.status = \'ativo\' then');
    contem(corpo, 'ou.id <> old.id');
  });

  teste('ninguém bloqueia a si mesmo', () => {
    // Sem isto o único administrador se tranca do lado de fora e ninguém mais
    // consegue reativar.
    contem(SQLC, 'nao_pode_bloquear_a_si_mesmo');
  });

  teste('bloquear e reativar são RPC, nunca update direto', () => {
    contem(DATA, "chamar('usuario_definir_status'");
    ok(!/\.update\(/.test(DATA), 'nenhum update direto no módulo de dados');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · permissões no frontend', () => {

  teste('uma chamada por sessão, não uma por item de menu', () => {
    igual((semJs(PERM).match(/rpc\('minhas_permissoes'\)/g) || []).length, 1);
    contem(PERM, '_carregando');   // chamadas simultâneas compartilham a ida à rede
  });

  teste('o cache é de memória — localStorage sobreviveria à troca de conta', () => {
    // Já houve o caso: painel abriu com conta de teste e apareceu vazio, sem
    // erro na tela. Menu servido do cache da conta anterior seria a mesma
    // armadilha, mostrando módulos que a pessoa não pode abrir.
    ok(!/localStorage|sessionStorage/.test(PERMC), 'permissões não podem ser persistidas');
    contem(HTML, 'limparPermissoes()');
  });

  teste('pode() nega enquanto não sabe', () => {
    contem(PERM, 'return !!_chaves && _chaves.has(chave)');
  });

  teste('a rota é conferida ANTES de renderizar', () => {
    const i = HTMLC.indexOf('function navegar(pagina, secao)');
    const corpo = HTMLC.slice(i, i + 2500);
    contem(corpo, 'if (!podeAbrir(pagina))');
    // O bloqueio vem antes de qualquer chamada de módulo.
    ok(corpo.indexOf('podeAbrir') < corpo.indexOf('abrirDashboard'),
       'a permissão precisa ser a primeira coisa em navegar()');
  });

  teste('a tela de usuários confere permissão antes de buscar dados', () => {
    const i = UIC.indexOf('export async function abrirUsuarios');
    const corpo = UIC.slice(i, i + 900);
    ok(corpo.indexOf("pode('usuarios.visualizar')") < corpo.indexOf('dados.listarUsuarios'),
       'não se busca dado para depois escondê-lo');
  });

  teste('só usuarios exige permissão nesta etapa', () => {
    // Esconder Financeiro ou Equipe agora, com as policies antigas ainda em
    // nutri_id = auth.uid(), tiraria módulo do proprietário sem motivo.
    const i = HTMLC.indexOf('const EXIGE_PERMISSAO');
    const bloco = HTMLC.slice(i, HTMLC.indexOf('}', i) + 1);
    igual((bloco.match(/:/g) || []).length, 1, 'só uma rota protegida na Etapa 3');
    contem(bloco, 'usuarios');
  });

  teste('as permissões carregam antes de restaurar a rota', () => {
    const i = HTMLC.indexOf('async function iniciarApp()');
    const corpo = HTMLC.slice(i, HTMLC.indexOf('restaurarRota()', i));
    contem(corpo, 'await carregarPermissoes()');
    contem(corpo, 'aplicarPermissoesNoMenu()');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · a tela', () => {

  teste('último acesso vira frase legível', () => {
    igual(ultimoAcesso(null), 'nunca entrou');
    const agora = new Date();
    contem(ultimoAcesso(agora.toISOString()), 'Hoje');
    igual(ultimoAcesso('2026-07-12T10:00:00Z').slice(0, 2), '12');
  });

  teste('os indicadores são faixa, não quatro cartões', () => {
    const html = indicadoresHtml({
      usuarios: [{ status: 'ativo' }, { status: 'bloqueado' }],
      fora: [{}, {}, {}, {}],
    });
    contem(html, 'us-faixa');
    contem(html, '<b>2</b><span>Usuários</span>');
    contem(html, '<b>1</b><span>Ativos</span>');
    contem(html, '<b>4</b><span>Fora da organização</span>');
  });

  teste('o proprietário aparece com badge', () => {
    const html = linhaUsuarioHtml({
      id: 'u1', nome: 'Eduardo', email: 'e@x.com', perfil_nome: 'Proprietário',
      status: 'ativo', e_proprietario: true, sou_eu: true, excecoes: 0,
    });
    contem(html, 'PROPRIETÁRIO');
    contem(html, 'us-eu');
  });

  teste('exceção redundante é detectada sem apagar nada', () => {
    // §16: não apagar personalização em silêncio, mas também não deixar o
    // administrador com uma exceção que ele acha que muda algo e não muda.
    const linhas = [
      { descricao: 'Ver financeiro', modo: 'permitir', do_perfil: true  },  // redundante
      { descricao: 'Ver anamnese',   modo: 'bloquear', do_perfil: false },  // redundante
      { descricao: 'Lançar',         modo: 'permitir', do_perfil: false },  // faz diferença
      { descricao: 'Editar',         modo: 'perfil',   do_perfil: true  },  // herdada
    ];
    igual(excecoesRedundantes(linhas), ['Ver financeiro', 'Ver anamnese']);
  });

  teste('a tela de bloqueio não traz dado nenhum', () => {
    const html = semAcessoHtml();
    contem(html, 'Você não tem acesso a esta área');
    ok(!/<table|<tbody/.test(html));
  });

  teste('a exceção individual tem três modos, e o padrão não grava linha', () => {
    contem(UI, "['perfil', 'permitir', 'bloquear']");
    const i = SQLC.indexOf('create or replace function public.usuario_definir_permissao');
    const corpo = SQLC.slice(i, SQLC.indexOf('$fn$;', SQLC.indexOf('$fn$', i) + 4));
    contem(corpo, "if p_modo = 'perfil' then");
    contem(corpo, 'delete from public.usuario_permissoes');
  });

  teste('contas fora da organização ficam em bloco separado', () => {
    // Misturar na lista principal faria parecer que são membros com problema,
    // quando são pessoas fora da organização, com dados próprios.
    contem(UI, 'us-secao-fora');
    contem(UI, 'Contas fora da organização');
    contem(UI, 'não pertencem');
  });

  teste('a tela de conta externa não oferece nenhuma ação que altere', () => {
    const drawer = ler('js/usuarios-drawer.js');
    const i = drawer.indexOf('export function drawerContaExterna');
    const corpo = semJs(drawer.slice(i));
    // A conferência é por CHAMADA, não por palavra: o texto da tela explica ao
    // administrador que decidir entre "criar organização, migrar os dados ou
    // encerrar" é decisão dele. Procurar a palavra "migrar" acusaria a própria
    // frase que diz que nada foi migrado.
    // `traduzirErro` entra na lista permitida por ser pura: converte código do
    // Postgres em frase, não fala com o banco.
    const chamadas = [...new Set([...corpo.matchAll(/dados\.(\w+)/g)].map(m => m[1]))].sort();
    igual(chamadas, ['detalheContaExterna', 'traduzirErro'],
          'a tela só lê — qualquer outra chamada de dados altera algo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · não atravessa o escopo da etapa', () => {

  teste('nenhuma policy antiga é migrada', () => {
    ok(!/nutri_id\s*=\s*public\.organizacao_do_auth/.test(SQLC),
       'a troca de predicado é a Etapa 4');
    for (const t of ['pacientes', 'avaliacoes', 'respostas', 'financeiro_lancamentos',
                     'comercial_assinaturas', 'treinos']) {
      ok(!new RegExp(`create policy[^;]*on public\\.${t}\\b`).test(SQLC),
         `${t} não pode ganhar policy nesta etapa`);
    }
  });

  teste('nenhum dado legado é alterado', () => {
    ok(!/^\s*update\s+public\.(pacientes|nutricionistas|avaliacoes|respostas)/im.test(SQLC));
    ok(!/^\s*delete\s+from\s+public\.(pacientes|nutricionistas)/im.test(SQLC));
  });

  teste('nenhuma conta externa é alterada automaticamente', () => {
    // A tela é diagnóstica. Nem a migration nem as RPCs tocam nessas contas.
    const i = SQLC.indexOf('create or replace function public.contas_fora_da_organizacao');
    const corpo = SQLC.slice(i);
    ok(!/insert into public\.organizacao_usuarios/.test(corpo.slice(0, 2000)),
       'listar não pode vincular');
    ok(!/update public\.nutricionistas/.test(SQLC));
  });

  teste('storage não é tocado', () => {
    // A conferência PODE ler o storage; a migration não pode alterá-lo.
    ok(!/storage\.(buckets|objects)\s*\n?\s*(set|values)/i.test(SQLC));
    ok(!/create policy[^;]*storage\./.test(SQLC));
  });

  teste('o schema da Etapa 2 não é alterado retroativamente', () => {
    for (const t of ['organizacao_usuarios', 'organizacoes', 'perfis', 'permissoes']) {
      ok(!new RegExp(`alter table public\\.${t} (add|drop|alter) column`).test(SQLC),
         `${t} é da Etapa 2 e não pode mudar aqui`);
    }
  });

  teste('sem FORCE RLS nas tabelas novas', () => {
    ok(!/force\s+row\s+level\s+security/i.test(SQLC));
    contem(SQLC, 'alter table public.organizacao_convites  enable row level security');
    contem(SQLC, 'alter table public.organizacao_auditoria enable row level security');
  });

  teste('convites e auditoria ficam sem policy — só DEFINER entra', () => {
    for (const t of ['organizacao_convites', 'organizacao_auditoria']) {
      ok(!new RegExp(`create policy[^;]*on public\\.${t}`).test(SQLC),
         `${t} não pode ter policy`);
    }
  });

  teste('a auditoria separa dono de autor', () => {
    contem(SQLC, 'usuario_alvo');
    contem(SQLC, 'usuario_autor  uuid not null default auth.uid()');
    contem(SQLC, 'organizacao_id uuid not null references public.organizacoes(id)');
  });

  teste('as sete ações auditadas estão previstas', () => {
    for (const a of ['codigo_gerado', 'codigo_revogado', 'vinculo_realizado', 'perfil_alterado',
                     'permissao_alterada', 'usuario_bloqueado', 'usuario_reativado']) {
      contem(SQLC, `'${a}'`);
    }
  });

  teste('o cadastro por código de organização não valida código de SaaS', () => {
    // Quem entra por convite de organização não tem código do SaaS, e não deve
    // ter: ele criaria outra organização.
    const i = HTMLC.indexOf("if (codigo.startsWith('EVL-'))");
    ok(i > 0, 'falta o caminho de cadastro por código de organização');
    // O recorte termina exatamente onde o caminho antigo começa: o bloco EVL-
    // vai da condição até a primeira linha do fluxo do proprietário.
    const bloco = HTMLC.slice(i, HTMLC.indexOf('const validacao = await validarCodigoConvite', i));
    ok(bloco.length > 100, 'não achei o bloco do código de organização');
    ok(!bloco.includes('validarCodigoConvite'), 'não pode exigir código de SaaS');
    contem(bloco, 'criarConta');
    contem(bloco, 'vincular(codigo)');
  });

  teste('o fluxo de cadastro do proprietário continua intacto', () => {
    contem(HTML, 'const validacao = await validarCodigoConvite(codigo);');
    contem(HTML, 'await registrarUsoCodigo(codigo, data.user.id, email);');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · a troca de perfil pela tela', () => {
  // Esta falha custou uma rodada inteira: a RPC funcionava, gravava auditoria,
  // e a troca não chegava ao banco. A causa era de DESENHO — a RPC disparava
  // no `change` do select, e `<select>` só emite `change` quando o valor muda.
  // Abrir a lista e clicar na opção já marcada não dispara nada, e sem botão,
  // sem estado de ocupado e sem confirmação, o silêncio era ambíguo: não dava
  // para distinguir "não cliquei" de "cliquei e falhou".

  const api = (respostas = {}) => {
    const chamadas = [];
    return {
      chamadas,
      definirPerfil: async (u, p) => {
        chamadas.push({ fn: 'definirPerfil', u, p });
        if (respostas.erroAoDefinir) throw new Error(respostas.erroAoDefinir);
      },
      listarUsuarios: async () => {
        chamadas.push({ fn: 'listarUsuarios' });
        return respostas.lista ?? [{ id: 'u1', perfil_chave: 'recepcao', nome: 'Teste' }];
      },
    };
  };

  teste('envia o perfil ESCOLHIDO, não o que já estava', async () => {
    const a = api();
    await trocarPerfil({ api: a, usuarioId: 'u1', perfilAtualId: 'ADM', perfilNovoId: 'REC' });
    igual(a.chamadas[0], { fn: 'definirPerfil', u: 'u1', p: 'REC' });
  });

  teste('não chama a RPC quando nada mudou', async () => {
    const a = api();
    const r = await trocarPerfil({ api: a, usuarioId: 'u1', perfilAtualId: 'ADM', perfilNovoId: 'ADM' });
    igual(r.mudou, false);
    igual(a.chamadas.length, 0, 'ida à rede à toa');
  });

  teste('relê do servidor — não confia no que acabou de enviar', async () => {
    // Se a tela se atualizasse com o valor enviado, mostraria "Recepção" mesmo
    // que o banco tivesse recusado. É o modo de falha que nos enganou.
    const a = api({ lista: [{ id: 'u1', perfil_chave: 'recepcao', nome: 'Teste' }] });
    const r = await trocarPerfil({ api: a, usuarioId: 'u1', perfilAtualId: 'ADM', perfilNovoId: 'REC' });
    igual(a.chamadas.map(c => c.fn), ['definirPerfil', 'listarUsuarios']);
    igual(r.usuario.perfil_chave, 'recepcao');
  });

  teste('erro da RPC SOBE — não pode ser engolido', async () => {
    const a = api({ erroAoDefinir: 'ultimo_proprietario' });
    let subiu = false;
    try { await trocarPerfil({ api: a, usuarioId: 'u1', perfilAtualId: 'ADM', perfilNovoId: 'REC' }); }
    catch (e) { subiu = /ultimo_proprietario/.test(e.message); }
    ok(subiu, 'quem chama precisa poder mostrar a mensagem');
    igual(a.chamadas.length, 1, 'não pode reler como se tivesse dado certo');
  });

  teste('usuário sumido depois de salvar é erro, não silêncio', async () => {
    const a = api({ lista: [] });
    let subiu = false;
    try { await trocarPerfil({ api: a, usuarioId: 'u1', perfilAtualId: 'ADM', perfilNovoId: 'REC' }); }
    catch (e) { subiu = /usuario_nao_encontrado/.test(e.message); }
    ok(subiu);
  });

  teste('o select NÃO salva sozinho — existe botão explícito', () => {
    const d = semJs(ler('js/usuarios-drawer.js'));
    contem(d, 'data-salvar-perfil');
    // O `change` só habilita o botão; a RPC mora no clique.
    const iChange = d.indexOf("sel?.addEventListener('change'");
    const corpoChange = d.slice(iChange, d.indexOf('});', iChange));
    ok(!/trocarPerfil|definirPerfil/.test(corpoChange),
       'o change não pode chamar a RPC — foi assim que a falha se escondeu');
    contem(corpoChange, 'btnP.disabled');
  });

  teste('o botão mostra que está ocupado e volta se falhar', () => {
    const d = semJs(ler('js/usuarios-drawer.js'));
    const i = d.indexOf("btnP?.addEventListener('click'");
    const corpo = d.slice(i, d.indexOf('\n      });', i));
    contem(corpo, "btnP.textContent = 'Salvando…'");
    contem(corpo, 'btnP.disabled = false');   // dá para tentar de novo
    contem(corpo, 'mostrarErro');
    ok(!/fechar\(\)/.test(corpo), 'não pode fechar o drawer como se tivesse salvo');
  });

  teste('a lista atrás atualiza sem F5', () => {
    const d = semJs(ler('js/usuarios-drawer.js'));
    const i = d.indexOf("btnP?.addEventListener('click'");
    const corpo = d.slice(i, d.indexOf('\n      });', i));
    contem(corpo, 'aoSalvar?.()');
    contem(corpo, 'desenhar()');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('etapa 3 · rollback', () => {

  teste('remove só o que a Etapa 3 criou', () => {
    contem(DESFAZER, 'drop table if exists public.organizacao_convites');
    contem(DESFAZER, 'drop table if exists public.organizacao_auditoria');
    for (const rpc of [...RPCS_ESCRITA, ...RPCS_LEITURA]) {
      ok(new RegExp(`drop function if exists public\\.${rpc}\\(`).test(DESFAZER), `${rpc} não é removida`);
    }
  });

  teste('não toca na Fundação da Etapa 2 nem no legado', () => {
    const d = semComentario(DESFAZER);
    for (const t of ['organizacoes', 'organizacao_usuarios', 'perfis', 'permissoes',
                     'perfil_permissoes', 'usuario_permissoes',
                     'nutricionistas', 'pacientes', 'funcionarios']) {
      ok(!new RegExp(`drop table[^;]*\\b${t}\\b`).test(d), `o rollback não pode dropar ${t}`);
    }
    for (const f of ['organizacao_do_auth', 'tem_permissao', 'minhas_permissoes']) {
      ok(!new RegExp(`drop function[^;]*${f}`).test(d), `${f} é da Etapa 2`);
    }
  });
});
