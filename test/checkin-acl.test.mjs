// ═══════════════════════════════════════════════════════════
// CHECK-INS — ACL explícita nas migrations
// ═══════════════════════════════════════════════════════════
// Mesma guarda que o módulo Documentos ganhou depois do incidente de
// 08/08/2026: no Supabase o schema `public` tem default privilege que concede
// EXECUTE a `anon` em toda função nova, e `revoke from public` NÃO tira um
// grant DIRETO ao papel `anon`. A anon-key vive no JavaScript do site.
//
// Aqui a lição entrou desde a primeira linha da migration, em vez de ser
// descoberta em produção. O teste DESCOBRE as funções lendo os arquivos — sem
// lista fixa, sem contagem esperada. Uma função nova sem ACL explícita reprova.

import { grupo, teste, ok, igual } from './runner.mjs';
import { readFileSync } from 'node:fs';

const ARQUIVOS = ['db/checkin_schema.sql', 'db/checkin_schema_desfazer.sql'];

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const executavel = (src) => src.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/**
 * As funções criadas ou substituídas, com a assinatura de CHAMADA (tipos, sem
 * nome de parâmetro) — a forma que REVOKE e GRANT exigem quando há sobrecarga
 * possível.
 */
function funcoesDe(src) {
  const re = /create or replace function\s+(public\.\w+)\s*\(([^)]*)\)/gis;
  const achadas = [];
  let m;
  while ((m = re.exec(src))) {
    const nome = m[1];
    const args = m[2].trim()
      ? m[2].split(',').map(a => {
          const partes = a.trim().split(/\s+/);
          // "p_periodo date default null" -> "date"; "p_atribuicao uuid" -> "uuid"
          return partes[1] === 'default' ? partes[1] : partes.slice(1).join(' ').replace(/\s+default\s+.*$/i, '');
        }).join(', ')
      : '';
    achadas.push({ nome, assinatura: `${nome}(${args})` });
  }
  return achadas;
}

const ehGatilho = (src, nome) => {
  const i = src.indexOf(`create or replace function ${nome}`);
  return i > -1 && /returns\s+trigger/i.test(src.slice(i, i + 300));
};


// ═══════════════════════════════════════════════════════════
grupo('check-in · ACL explícita em toda função da migration', () => {

  const encontradas = ARQUIVOS.flatMap(a => {
    const src = executavel(ler(a));
    return funcoesDe(src).map(f => ({ ...f, arquivo: a, src, gatilho: ehGatilho(src, f.nome) }));
  });

  teste('a migration cria funções — o teste não passa por lista vazia', () => {
    ok(encontradas.length >= 4,
       `só achei ${encontradas.length}; se a descoberta quebrar, tudo abaixo passa de graça`);
  });

  teste('toda função revoga de PUBLIC', () => {
    for (const f of encontradas) {
      ok(f.src.includes(`revoke all on function ${f.assinatura} from public;`),
         `${f.assinatura} (${f.arquivo}) sem revoke de PUBLIC`);
    }
  });

  teste('toda função revoga de anon', () => {
    // A que faltou em Documentos e só apareceu na conferência em produção.
    for (const f of encontradas) {
      ok(f.src.includes(`revoke all on function ${f.assinatura} from anon;`),
         `${f.assinatura} (${f.arquivo}) sem revoke de anon — nasceria aberta à anon-key`);
    }
  });

  teste('gatilho não recebe EXECUTE de ninguém; RPC recebe só de authenticated', () => {
    for (const f of encontradas) {
      const temGrant = f.src.includes(`grant execute on function ${f.assinatura} to authenticated;`);
      if (f.gatilho) {
        ok(!temGrant, `${f.assinatura} é gatilho — EXECUTE seria privilégio sem uso`);
        ok(f.src.includes(`revoke all on function ${f.assinatura} from authenticated;`),
           `${f.assinatura} é gatilho — precisa revogar authenticated`);
      } else {
        ok(temGrant, `${f.assinatura} (${f.arquivo}) precisa de EXECUTE para authenticated`);
      }
    }
  });

  teste('o revoke vem ANTES do grant', () => {
    for (const f of encontradas.filter(x => !x.gatilho)) {
      const r = f.src.indexOf(`revoke all on function ${f.assinatura} from anon;`);
      const g = f.src.indexOf(`grant execute on function ${f.assinatura} to authenticated;`);
      ok(r > -1 && g > -1 && r < g, `ordem errada em ${f.assinatura} — o revoke apagaria o grant`);
    }
  });

  teste('nenhuma migration concede nada a anon ou a PUBLIC', () => {
    for (const a of ARQUIVOS) {
      const src = executavel(ler(a));
      ok(!/grant[^;]*to\s+anon/i.test(src), `${a} concede a anon`);
      ok(!/grant[^;]*to\s+public/i.test(src), `${a} concede a PUBLIC`);
    }
  });

  teste('as funções definer fixam search_path', () => {
    const src = executavel(ler('db/checkin_schema.sql'));
    const definers = src.split('security definer').length - 1;
    const paths = src.split('set search_path = public').length - 1;
    ok(paths >= definers, `${definers} definer para ${paths} search_path fixos`);
  });

  teste('a decisão está registrada, e é a mesma de Documentos', () => {
    const src = ler('db/checkin_schema.sql');
    ok(/nao recebem EXECUTE de ninguem|ninguem os chama direto/i.test(src),
       'a migration precisa dizer por que o gatilho não recebe grant');
  });
});
