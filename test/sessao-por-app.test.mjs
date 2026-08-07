// ═══════════════════════════════════════════════════════════
// SESSÃO — uma chave por aplicação
// ═══════════════════════════════════════════════════════════
// As três apps vivem na mesma origem. Sem storageKey próprio, o Supabase usa a
// chave padrão e elas dividem a sessão: entrar no painel entrava no app do
// aluno junto.
//
// O risco não é só de conforto. Com a sessão compartilhada dava para abrir a
// tela do paciente logado como nutri, ver dados aparecerem, e concluir que o
// isolamento funcionava — quando o que estava acontecendo era a sessão errada.
// Foi assim que um teste de RLS aprovou sem provar nada.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/supabase.js', import.meta.url), 'utf8');

/** Reproduz a regra do arquivo, para exercitá-la sem navegador. */
function appDaPagina(pathname) {
  const arquivo = (pathname.split('/').pop() || '').toLowerCase();
  if (arquivo.startsWith('app')) return 'aluno';
  if (arquivo.startsWith('equipe')) return 'colaborador';
  return 'painel';
}

grupo('sessão · cada app tem a sua chave', () => {
  teste('as três apps caem em chaves diferentes', () => {
    igual(appDaPagina('/app.html'), 'aluno');
    igual(appDaPagina('/equipe.html'), 'colaborador');
    igual(appDaPagina('/index.html'), 'painel');
  });

  teste('admin entra junto com o painel — é a mesma pessoa', () => {
    // O admin é um nutri com poderes a mais, não outro usuário. Separar a
    // sessão dele obrigaria a logar duas vezes para a mesma conta.
    igual(appDaPagina('/admin.html'), 'painel');
  });

  teste('a raiz do site é o painel', () => {
    igual(appDaPagina('/'), 'painel');
    igual(appDaPagina(''), 'painel');
  });

  teste('subpasta não confunde a detecção', () => {
    // Em GitHub Pages o site vive em /nutrimap/.
    igual(appDaPagina('/nutrimap/app.html'), 'aluno');
    igual(appDaPagina('/nutrimap/equipe.html'), 'colaborador');
  });

  teste('maiúscula no nome do arquivo não escapa', () => {
    igual(appDaPagina('/APP.HTML'), 'aluno');
  });
});

grupo('sessão · a regra mora no supabase.js, não em quem importa', () => {
  teste('o storageKey é configurado no createClient', () => {
    contem(fonte, 'storageKey: `evollo-auth-${APP}`');
  });

  teste('a app é derivada do caminho, não recebida por parâmetro', () => {
    // supabase.js é importado por dezenas de módulos; um deles esquecer o
    // parâmetro devolveria silenciosamente a chave compartilhada de volta.
    contem(fonte, 'window.location.pathname');
    naoContem(fonte, 'export function criarCliente(');
  });

  teste('o nome da chave diz de quem é a sessão', () => {
    // Quem abrir o localStorage no DevTools vê "evollo-auth-aluno" e entende,
    // sem decodificar o token.
    contem(fonte, 'evollo-auth-');
  });
});
