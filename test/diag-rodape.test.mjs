// ═══════════════════════════════════════════════════════════
// A SONDA TEMPORÁRIA DO RODAPÉ — as lições que custaram deploy
// ═══════════════════════════════════════════════════════════
// js/diag-rodape.js é temporário e sai quando a medição no iPhone terminar —
// estes testes saem junto. Enquanto ele existir, guardam os três defeitos que a
// sonda anterior teve no aparelho (37b515f, 68f7ccd) e o que esta não pode
// fazer: mexer no layout que ela existe para medir.

import { grupo, teste, ok, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const sonda = readFileSync(new URL('../js/diag-rodape.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

// Só o código: os comentários citam de propósito o que o código não pode fazer.
const codigo = sonda
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

grupo('sonda do rodapé · não prende quem a abre', () => {
  teste('tudo o que ela desenha deixa o toque atravessar', () => {
    // O painel cobre a topbar. Sem isto ele engolia os toques no logo — que
    // são o que o fecha — e quem abria ficava preso (68f7ccd).
    const fixos = codigo.match(/position:fixed[^'`]*/g) || [];
    ok(fixos.length >= 3, `esperava painel e faixas fixed, achei ${fixos.length}`);
    // Cada declaração fixed pode continuar na linha seguinte da concatenação;
    // por isso confiro por bloco de cssText, e não por linha.
    const blocos = codigo.split(/\.style\.cssText\s*=/).slice(1).map((b) => b.split(';\n')[0]);
    ok(blocos.length >= 3, 'esperava cssText no painel, nas faixas e na sonda do env');
    blocos.forEach((b, i) => ok(/pointer-events:\s*none/.test(b),
      `o bloco ${i + 1} de cssText não tem pointer-events:none`));
  });

  teste('o gesto é pointerup em capture, não click', () => {
    // `click` repetido num elemento que não é botão é atrasado ou engolido
    // pelo iOS: cinco nunca chegavam (37b515f).
    contem(codigo, "'pointerup'");
    ok(/addEventListener\(EVENTO,[\s\S]*?\},\s*true\)/.test(codigo),
       'o ouvinte do gesto tem que estar em capture');
  });

  teste('sem persistência e sem reload', () => {
    // A marca no localStorage trazia o painel de volta a cada lançamento, e o
    // reload era indistinguível de "o gesto não funcionou" (68f7ccd).
    naoContem(codigo, 'localStorage');
    naoContem(codigo, 'sessionStorage');
    naoContem(codigo, 'reload(');
  });
});

grupo('sonda do rodapé · não mexe no que ela mede', () => {
  teste('não escreve variável, classe nem regra do app', () => {
    naoContem(codigo, 'setProperty(');
    naoContem(codigo, 'classList');
    naoContem(codigo, 'insertRule');
    naoContem(codigo, "createElement('style')");
  });

  teste('a seleção do logo é barrada em JS, não no <style>', () => {
    // A sonda anterior precisou de touch-action e user-select no CSS do logo.
    // Esta não pode depender de regra no <style>: o layout não está em jogo.
    contem(codigo, "'selectstart'");
    const bloco = app.slice(app.indexOf('  .pa-topbrand {'));
    const regra = bloco.slice(0, bloco.indexOf('}') + 1);
    ok(!/touch-action|user-select/.test(regra),
       'o logo não pode ganhar CSS por causa de uma ferramenta de medição');
  });

  teste('o fundo do body volta ao que era quando fecha', () => {
    contem(codigo, 'fundoAntes = document.body.style.background');
    contem(codigo, 'document.body.style.background = fundoAntes');
  });
});

grupo('sonda do rodapé · não derruba o app', () => {
  teste('é carregada por import dinâmico, com catch', () => {
    // O SW não a precacheia. Import ESTÁTICO de arquivo que falha offline
    // derruba o módulo inteiro — e com ele o iniciarApp() da linha de cima.
    contem(app, "import('./js/diag-rodape.js').catch(");
    ok(!/import\s+['"][^'"]*diag-rodape/.test(app),
       'import estático da sonda derruba o app quando ela falta');
  });
});
