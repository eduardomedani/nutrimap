// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — ACL explícita nas migrations
// ═══════════════════════════════════════════════════════════
// A regra que este arquivo trava, e o incidente que a motivou.
//
// Em 08/08/2026 as migrations do módulo foram aplicadas com `revoke ... from
// public` e nada mais. A conferência no banco mostrou `anon = true` em TODAS
// as funções: no Supabase, o schema `public` tem default privilege que concede
// EXECUTE a `anon` em toda função nova, e revogar de PUBLIC não tira um grant
// DIRETO ao papel `anon`. A anon-key vive no JavaScript do site.
//
// Por isso as migrations sensíveis NÃO dependem de default privilege: a ACL
// vem escrita junto de cada função.
//
// O teste DESCOBRE as funções lendo os arquivos — não tem lista fixa nem
// contagem esperada. Uma sexta função criada sem ACL explícita reprova aqui,
// que é o ponto: a próxima pessoa não vai lembrar deste incidente.

import { grupo, teste, ok, igual } from './runner.mjs';
import { readFileSync } from 'node:fs';

/** As migrations do módulo Documentos — inclusive os desfazer, que recriam. */
const ARQUIVOS = [
  'db/paciente_documentos.sql',
  'db/paciente_documentos_desfazer.sql',
  'db/paciente_notificacoes.sql',
  'db/paciente_notificacoes_desfazer.sql',
];

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** Só o executável: comentário citando `revoke` não conta como revoke. */
const executavel = (src) =>
  src.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/**
 * As funções CRIADAS OU SUBSTITUÍDAS por um arquivo, com a assinatura de
 * chamada (tipos, sem nome de parâmetro) — que é a forma que REVOKE e GRANT
 * exigem quando há sobrecarga possível.
 */
function funcoesDe(src) {
  const re = /create or replace function\s+(public\.\w+)\s*\(([^)]*)\)/gi;
  const achadas = [];
  let m;
  while ((m = re.exec(src))) {
    const nome = m[1];
    const args = m[2].trim()
      ? m[2].split(',').map(a => a.trim().split(/\s+/).slice(1).join(' ')).join(', ')
      : '';
    achadas.push({ nome, assinatura: `${nome}(${args})` });
  }
  return achadas;
}

/** Uma função é de gatilho quando declara `returns trigger`. */
function ehGatilho(src, nome) {
  const i = src.indexOf(`create or replace function ${nome}`);
  return i > -1 && /returns\s+trigger/i.test(src.slice(i, i + 400));
}


// ═══════════════════════════════════════════════════════════
grupo('documentos · ACL explícita em toda função das migrations', () => {

  // Descoberto, não escrito à mão: é o que faz o teste continuar valendo
  // quando o módulo crescer.
  const encontradas = ARQUIVOS.flatMap(a => {
    const src = executavel(ler(a));
    return funcoesDe(src).map(f => ({ ...f, arquivo: a, src, gatilho: ehGatilho(src, f.nome) }));
  });

  teste('as migrations criam funções — o teste não passa por lista vazia', () => {
    ok(encontradas.length >= 5,
       `só achei ${encontradas.length} funções; se a descoberta quebrar, tudo abaixo passa de graça`);
  });

  teste('toda função revoga de PUBLIC', () => {
    for (const f of encontradas) {
      ok(f.src.includes(`revoke all on function ${f.assinatura} from public;`),
         `${f.assinatura} (${f.arquivo}) sem revoke de PUBLIC`);
    }
  });

  teste('toda função revoga de anon', () => {
    // A que faltou no incidente de 08/08.
    for (const f of encontradas) {
      ok(f.src.includes(`revoke all on function ${f.assinatura} from anon;`),
         `${f.assinatura} (${f.arquivo}) sem revoke de anon — nasceria aberta à anon-key`);
    }
  });

  teste('quem é chamado pelo app recebe EXECUTE; gatilho não recebe nada', () => {
    for (const f of encontradas) {
      const temGrant = f.src.includes(`grant execute on function ${f.assinatura} to authenticated;`);
      if (f.gatilho) {
        ok(!temGrant, `${f.assinatura} é gatilho — EXECUTE seria privilégio sem uso`);
        ok(f.src.includes(`revoke all on function ${f.assinatura} from authenticated;`),
           `${f.assinatura} é gatilho — precisa revogar authenticated explicitamente`);
      } else {
        ok(temGrant, `${f.assinatura} (${f.arquivo}) precisa de EXECUTE para authenticated`);
      }
    }
  });

  teste('o revoke vem ANTES do grant', () => {
    // Ordem invertida apagaria o grant que acabou de ser dado.
    for (const f of encontradas.filter(x => !x.gatilho)) {
      const r = f.src.indexOf(`revoke all on function ${f.assinatura} from anon;`);
      const g = f.src.indexOf(`grant execute on function ${f.assinatura} to authenticated;`);
      ok(r > -1 && g > -1 && r < g, `ordem errada em ${f.assinatura} (${f.arquivo})`);
    }
  });

  teste('nenhuma migration concede nada a anon', () => {
    for (const a of ARQUIVOS) {
      const src = executavel(ler(a));
      ok(!/grant[^;]*to\s+anon/i.test(src), `${a} concede a anon`);
      ok(!/to\s+public\s*;/i.test(src), `${a} concede a PUBLIC`);
    }
  });

  teste('o desfazer não restaura permissão insegura', () => {
    // Rollback desfaz objetos, não afrouxa ACL. O de notificações recria a
    // função de visualização, e precisa recriá-la fechada.
    const d = executavel(ler('db/paciente_notificacoes_desfazer.sql'));
    ok(d.includes('revoke all on function public.marcar_documento_paciente_visualizado(uuid) from anon;'),
       'desfazer recria a função — sem o revoke, voltar atrás reabriria o anon');
    ok(!/grant[^;]*to\s+anon/i.test(d));
  });

  teste('a decisão está registrada junto das funções', () => {
    // Curto, e onde quem for mexer vai ler.
    for (const a of ['db/paciente_documentos.sql', 'db/paciente_notificacoes.sql']) {
      ok(/nao depende(m)? dos default privileges/i.test(ler(a)),
         `${a} precisa dizer que não confia em default privilege`);
    }
  });
});
