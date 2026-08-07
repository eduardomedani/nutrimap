// ═══════════════════════════════════════════════════════════
// SUPABASE — Configuração central do cliente
// Importado por todos os outros módulos
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://jdtpludqkpvhnzkekrgm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdHBsdWRxa3B2aG56a2VrcmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzI4MTIsImV4cCI6MjA5ODMwODgxMn0.dgvZHm5sIGQqcC-ZpSsw8U-_ZlUQ49JHSwt4nE8VXu4';

/**
 * Cada aplicação guarda a sessão numa chave própria.
 *
 * Sem isto o Supabase usa a chave padrão, que é por ORIGEM — e as três apps
 * vivem na mesma origem. Entrar no painel entrava no app do aluno junto, e
 * testar o PWA exigia janela anônima. Pior: dava para "ver" a tela do paciente
 * logado como nutri e achar que o isolamento estava certo, quando o que estava
 * acontecendo era a sessão errada.
 *
 * A chave sai do NOME DO ARQUIVO, não de uma variável passada por quem
 * importa: `supabase.js` é importado por dezenas de módulos, e um deles
 * esquecer o parâmetro devolveria silenciosamente a chave compartilhada.
 */
function appDaPagina() {
  const arquivo = (window.location.pathname.split('/').pop() || '').toLowerCase();
  if (arquivo.startsWith('app')) return 'aluno';
  if (arquivo.startsWith('equipe')) return 'colaborador';
  return 'painel';   // index.html, admin.html e o resto do consultório
}

export const APP = appDaPagina();

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // O nome carrega a app de propósito: quem abrir o localStorage no
    // DevTools vê de quem é cada sessão sem precisar decodificar o token.
    storageKey: `evollo-auth-${APP}`,
  },
});

// URL base do questionário (calculada a partir do local atual)
export const QUESTIONARIO_URL = (() => {
  const url = new URL(window.location.href);
  return url.origin + url.pathname.replace(/[^/]+$/, '');
})();
