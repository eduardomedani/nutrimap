// ═══════════════════════════════════════════════════════════
// O PORTÃO DO PAINEL — quem vê a tela do profissional
// ═══════════════════════════════════════════════════════════
// O defeito que estes testes existem para impedir: o painel tratava "está
// logado" como "tem acesso". Uma conta de aluno que abrisse a raiz do site e
// usasse a senha do app via a tela profissional. Achado em 11/09/2026, com uma
// conta de teste de aluno num Preview.
//
// Os quatro perfis pedidos — profissional, aluno, usuário sem organização e
// organização inativa — mais o caso que não pode ser confundido com eles: a
// consulta falhar.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { rpc, limpar, chamadas } from './duble-supabase.mjs';
import { limparOrganizacao } from '../js/organizacao.js';
import {
  decidirAcesso, portaoDoPainel, ACESSO, AVISO_SEM_ACESSO, AVISO_ERRO,
} from '../js/acesso-painel.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MODULO = readFileSync(new URL('../js/acesso-painel.js', import.meta.url), 'utf8');
const ORG_SQL = readFileSync(new URL('../db/organizacao_schema.sql', import.meta.url), 'utf8');

/**
 * Prepara a sessão. `org` e `ficha` são o que as duas RPCs devolvem; `falha`
 * faz a RPC de organização lançar, que é como o dublê simula rede fora do ar.
 */
function sessao({ org = null, ficha = null, falhaOrg = false, falhaFicha = false } = {}) {
  limpar();
  limparOrganizacao();
  rpc('organizacao_do_auth', () => { if (falhaOrg) throw new Error('fetch failed'); return org; });
  rpc('paciente_do_auth', () => { if (falhaFicha) throw new Error('fetch failed'); return ficha; });
}

/** Roda o portão e devolve tudo o que ele fez — o que é o objeto da prova. */
async function passarPeloPortao() {
  const avisos = [];
  const destinos = [];
  const montou = await portaoDoPainel({
    avisar: (t) => avisos.push(t),
    irPara: (u) => destinos.push(u),
  });
  const saidas = chamadas.filter((c) => c.operacao === 'signOut');
  return { montou, avisos, destinos, saidas };
}

grupo('portão do painel · os quatro perfis', () => {
  teste('profissional com organização ativa: o painel monta, e nada mais acontece', async () => {
    sessao({ org: 'org-1' });
    const r = await passarPeloPortao();
    igual(r.montou, true);
    igual(r.saidas.length, 0, 'profissional não pode ser desconectado');
    igual(r.destinos.length, 0);
    igual(r.avisos.length, 0);
    igual(await decidirAcesso(), ACESSO.PAINEL);
  });

  teste('aluno: não monta, encerra SÓ a sessão do painel e vai para o app', async () => {
    sessao({ org: null, ficha: 'pac-1' });
    const r = await passarPeloPortao();
    igual(r.montou, false);
    igual(r.saidas.length, 1);
    igual(r.saidas[0].payload?.scope, 'local',
      'signOut global revogaria também o login do app no celular do aluno');
    igual(r.destinos.length, 1);
    igual(r.destinos[0], 'app.html', 'relativo: o site também roda em subpasta');
    igual(r.avisos.length, 0, 'o aluno não precisa de aviso — ele vai para o lugar certo');
  });

  teste('usuário sem organização e sem ficha: não monta, desconecta e avisa na entrada', async () => {
    sessao({ org: null, ficha: null });
    const r = await passarPeloPortao();
    igual(r.montou, false);
    igual(r.saidas.length, 1);
    igual(r.saidas[0].payload?.scope, 'local');
    igual(r.destinos.length, 0, 'sem ficha de aluno, mandar para o app seria um palpite');
    igual(r.avisos.length, 1);
    igual(r.avisos[0], AVISO_SEM_ACESSO);
  });

  teste('organização inativa: o banco responde "sem organização", e o portão nega igual', async () => {
    // A RPC não diz "inativa" — ela devolve NULL, porque filtra `o.ativo`. O
    // painel não precisa distinguir: em nenhum dos casos a tela pode montar.
    // O teste de SQL logo abaixo prova que o NULL vem mesmo desse filtro.
    sessao({ org: null, ficha: null });
    const r = await passarPeloPortao();
    igual(r.montou, false);
    igual(r.saidas.length, 1);
    igual(r.avisos[0], AVISO_SEM_ACESSO);
    igual(await decidirAcesso(), ACESSO.SEM_ACESSO);
  });

  teste('organizacao_do_auth só devolve organização com vínculo ativo E organização ativa', () => {
    const i = ORG_SQL.indexOf('create or replace function public.organizacao_do_auth()');
    ok(i > 0, 'não achei organizacao_do_auth no schema');
    const corpo = ORG_SQL.slice(i, ORG_SQL.indexOf('$fn$;', i));
    contem(corpo, "ou.status = 'ativo'");
    contem(corpo, 'and o.ativo');
  });
});

grupo('portão do painel · falha não é resposta', () => {
  teste('se a consulta de organização falha, não monta — mas não desconecta nem redireciona', async () => {
    // Rede instável não pode tirar o profissional do painel nem mandá-lo para
    // o app do aluno. O painel nega por padrão, e a entrada diz o porquê.
    sessao({ falhaOrg: true });
    const r = await passarPeloPortao();
    igual(r.montou, false);
    igual(r.saidas.length, 0, 'erro de rede não é "sem acesso"');
    igual(r.destinos.length, 0);
    igual(r.avisos[0], AVISO_ERRO);
    igual(await decidirAcesso(), ACESSO.ERRO);
  });

  teste('sem organização e a consulta de ficha falha: nega sem palpitar que é aluno', async () => {
    sessao({ org: null, falhaFicha: true });
    const r = await passarPeloPortao();
    igual(r.montou, false);
    igual(r.destinos.length, 0);
    igual(r.avisos[0], AVISO_SEM_ACESSO);
  });

  teste('RPC não programada ([]) não conta como ficha de aluno', async () => {
    // `[]` é verdadeiro em JS. Só um id de verdade manda para o app.
    limpar();
    limparOrganizacao();
    rpc('organizacao_do_auth', () => null);
    const r = await passarPeloPortao();
    igual(r.destinos.length, 0);
  });
});

grupo('portão do painel · nenhum frame da tela profissional', () => {
  const i = INDEX.indexOf('async function iniciarApp()');
  const corpo = INDEX.slice(i, INDEX.indexOf('\n  }\n', i));

  teste('o portão roda ANTES de esconder a entrada e revelar o painel', () => {
    const portao = corpo.indexOf('await portaoDoPainel(');
    const esconde = corpo.indexOf("getElementById('authWrapper').style.display = 'none'");
    const revela = corpo.indexOf("getElementById('app').classList.add('active')");
    ok(portao > 0, 'iniciarApp não chama o portão');
    ok(portao < esconde, 'a entrada sumiu antes de o portão responder');
    ok(portao < revela, 'o painel foi revelado antes de o portão responder');
    contem(corpo, 'if (!liberado) return false;');
  });

  teste('só um lugar do index.html revela o painel, e é o iniciarApp', () => {
    const revelacoes = INDEX.split("getElementById('app').classList.add('active')").length - 1;
    igual(revelacoes, 1, 'uma segunda porta que revele o painel pularia o portão');
  });

  teste('as três portas de formulário reabilitam o botão quando o portão nega', () => {
    // Sem isto, Entrar e Criar conta ficariam girando para sempre.
    const n = INDEX.split('if (!(await iniciarApp())) ocupado(btn, false, null,').length - 1;
    igual(n, 3);
  });

  teste('a sessão salva, ao abrir a página, passa pelo mesmo portão', () => {
    contem(INDEX, 'if (sessao) await iniciarApp();');
  });
});

grupo('portão do painel · o que ele não faz', () => {
  const codigo = MODULO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  teste('nunca desconecta de forma global', () => {
    contem(codigo, "signOut({ scope: 'local' })");
    naoContem(codigo, 'signOut()');
    naoContem(codigo, "scope: 'global'");
  });

  teste('não afrouxa nada: só lê as duas RPCs que já existem', () => {
    contem(codigo, "rpc('paciente_do_auth')");
    naoContem(codigo, '.insert(');
    naoContem(codigo, '.update(');
    naoContem(codigo, '.delete(');
  });
});
