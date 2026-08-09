// ═══════════════════════════════════════════════════════════
// EDGE FUNCTION · enviar-push — o que sai dela
// ═══════════════════════════════════════════════════════════
// Esta função recebe a LINHA INTEIRA da tabela pelo webhook: para documentos,
// isso inclui título, descrição e caminho no Storage. Então tudo que ela
// devolve ou imprime é superfície de vazamento — o corpo da resposta vai para
// os logs da Edge Function, que ficam guardados no projeto.
//
// Os testes leem o arquivo, e por isso trabalham sobre o CÓDIGO EXECUTÁVEL:
// comentários são removidos antes de qualquer asserção. Uma guarda que proíbe
// a palavra "message" em comentário é uma guarda que apaga a explicação de por
// que ela existe.
//
// A validação de tipos do Deno continua pendente para o deploy: este ambiente
// não tem as dependências npm que a função importa.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../supabase/functions/enviar-push/index.ts', import.meta.url), 'utf8');

/** Só o que executa: sem `//`, sem `/* *\/` e sem template de comentário. */
const codigo = fonte
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n');

/** O corpo de um `catch (...) { ... }`, para conferir o que ele faz com o erro. */
function corposDeCatch(src) {
  const blocos = [];
  const re = /catch\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let profundidade = 1;
    let i = re.lastIndex;
    while (i < src.length && profundidade > 0) {
      if (src[i] === '{') profundidade++;
      else if (src[i] === '}') profundidade--;
      i++;
    }
    blocos.push({ variavel: m[1].trim(), corpo: src.slice(re.lastIndex, i - 1) });
  }
  return blocos;
}


// ═══════════════════════════════════════════════════════════
grupo('edge push · o erro não vaza para o corpo da resposta', () => {

  teste('nenhum catch devolve message, stack ou o próprio erro', () => {
    for (const { variavel, corpo } of corposDeCatch(codigo)) {
      // O erro pode ser inspecionado (statusCode, para limpar inscrição
      // expirada); o que não pode é virar texto de saída.
      naoContem(corpo, '.message', 'mensagem de erro não pode sair da função');
      naoContem(corpo, '.stack');
      ok(!new RegExp(`String\\(\\s*${variavel.replace(/[^\w]/g, '')}\\s*\\)`).test(corpo),
         'String(e) serializa o erro inteiro');
      ok(!new RegExp(`JSON\\.stringify\\(\\s*${variavel.replace(/[^\w]/g, '')}`).test(corpo),
         'JSON.stringify(e) idem');
    }
  });

  teste('o catch externo nem lê a variável de erro', () => {
    // `_e` marca a intenção: o erro não é usado, e isso é decisão, não esquecimento.
    contem(codigo, 'catch (_e) {');
    const externo = corposDeCatch(codigo).find(c => c.variavel === '_e');
    ok(externo, 'o catch do handler tem que existir');
    ok(!/\b_e\b/.test(externo.corpo), 'o erro não é referenciado em lugar nenhum do bloco');
  });

  teste('a resposta de erro é um código neutro', () => {
    contem(codigo, "JSON.stringify({ ok: false, error: 'push_failed' })");
    contem(codigo, "'Content-Type': 'application/json'");
    // Nada além do código: sem detalhe, sem dica, sem eco do payload.
    const f = codigo.slice(codigo.indexOf('function respostaErroSeguro'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    for (const p of ['message', 'stack', 'record', 'payload', 'detail', 'hint']) {
      naoContem(corpo, p);
    }
  });

  teste('o status continua 200 — webhook não pode entrar em loop de reenvio', () => {
    const f = codigo.slice(codigo.indexOf('function respostaErroSeguro'));
    contem(f.slice(0, f.indexOf('\n}')), 'status: 200');
    // Nenhuma resposta 4xx/5xx em lugar nenhum da função.
    ok(!/status:\s*[45]\d\d/.test(codigo), 'status de erro faria o Supabase reenviar');
  });

  teste('não há um segundo lugar devolvendo erro cru', () => {
    // Se aparecer outro catch com risco, ele tem que usar o mesmo helper.
    const respostas = [...codigo.matchAll(/new Response\(([^;]*?)\)/gs)].map(m => m[1]);
    for (const r of respostas) {
      naoContem(r, 'message');
      naoContem(r, 'stack');
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('edge push · o log não conta o que não deve', () => {

  teste('o console.error leva só origem e horário', () => {
    const i = codigo.indexOf("console.error('push_failed'");
    ok(i > -1, 'o log de falha tem que existir para dar para diagnosticar');
    const bloco = codigo.slice(i, codigo.indexOf('});', i) + 3);
    contem(bloco, 'payload?.type');
    contem(bloco, 'payload?.table');
    contem(bloco, 'timestamp');
    // O que NÃO pode estar lá.
    for (const p of ['record', 'old_record', 'titulo', 'descricao', 'endpoint',
                     'subscription', 'p256dh', 'auth', 'message', 'stack']) {
      naoContem(bloco, p, `${p} não pode ir para o log`);
    }
  });

  teste('não existe nenhum outro console na função', () => {
    const chamadas = [...codigo.matchAll(/console\.\w+\(/g)].map(m => m[0]);
    igual(chamadas, ['console.error('], 'um log só, e é o sanitizado');
  });

  teste('nem o record nem o old_record são serializados em lugar nenhum', () => {
    for (const alvo of ['JSON.stringify(record', 'JSON.stringify(payload',
                        'JSON.stringify(anterior', 'JSON.stringify(subs']) {
      naoContem(codigo, alvo);
    }
  });

  teste('o erro de envio continua sendo lido só pelo statusCode', () => {
    // É esse código que distingue inscrição expirada (404/410) de falha real.
    contem(codigo, 'statusCode');
    contem(codigo, 'code === 404 || code === 410');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('edge push · o sucesso não mudou', () => {

  teste('o push de treino continua igual', () => {
    contem(codigo, "title: 'Treino atualizado'");
    contem(codigo, 'Seu profissional atualizou ${nome}. Toque para ver.');
    contem(codigo, "url: '/app.html'");
    contem(codigo, 'tag: `treino-${treinoId}`');
    // E as saídas de caminho normal continuam texto puro, como eram.
    for (const r of ['sem treino/paciente', 'cooldown', 'sem inscricoes', 'ok']) {
      contem(codigo, `new Response('${r}'`);
    }
  });

  teste('o cooldown do treino continua de pé', () => {
    contem(codigo, 'COOLDOWN_MS = 5 * 60 * 1000');
    contem(codigo, "from('treino_notificacoes')");
  });

  teste('o push de documento continua neutro', () => {
    contem(codigo, "title: 'Novo documento disponível'");
    contem(codigo, "body: 'Seu profissional compartilhou um novo documento com você.'");
    contem(codigo, "url: '/app.html#documentos'");
    const f = codigo.slice(codigo.indexOf('async function pushDeDocumento'));
    const payload = f.slice(f.indexOf('const body = JSON.stringify'), f.indexOf('});', f.indexOf('const body')));
    for (const campo of ['titulo', 'descricao', 'record.tipo', 'caminho']) {
      naoContem(payload, campo, 'push aparece na tela bloqueada');
    }
  });

  teste('as condições de disparo continuam as mesmas', () => {
    contem(codigo, "payload?.table === 'paciente_documentos'");
    contem(codigo, 'record?.visivel_paciente === true');
    contem(codigo, "anterior?.visivel_paciente !== true");
    contem(codigo, "eq('acao', 'push_enviado')");
  });

  teste('a função continua escrevendo em duas tabelas, e só', () => {
    const escritas = [...codigo.matchAll(/\.from\('(\w+)'\)\s*\.(insert|update|delete|upsert)/g)]
      .map(m => `${m[1]}.${m[2]}`);
    igual([...new Set(escritas)].sort(),
          ['paciente_documento_auditoria.insert', 'push_subscriptions.delete', 'treino_notificacoes.upsert']);
  });
});
