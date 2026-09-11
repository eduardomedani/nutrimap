// ═══════════════════════════════════════════════════════════
// O VÍDEO DO EXERCÍCIO — no card, sem tirar o aluno do treino
// ═══════════════════════════════════════════════════════════
// Antes era um link "Ver vídeo" abrindo aba nova. No meio de uma série isso é
// caro: o aluno sai do app, volta, e o cronômetro de descanso já perdeu o
// contexto na cabeça dele.
//
// O erro que estes testes existem para pegar é UM SÓ, e é silencioso: renderizar
// <video> para uma URL que é PÁGINA (YouTube, Instagram, Drive). O card mostraria
// um retângulo preto que nunca toca, e ninguém descobre até um aluno reclamar —
// porque quem cadastrou o exercício vê o link funcionando na própria tela.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { midiaDoExercicioHtml } from '../js/paciente-ui.js';

grupo('pwa · a mídia do exercício', () => {
  teste('sem URL, não renderiza nada', () => {
    igual(midiaDoExercicioHtml(''), '');
    igual(midiaDoExercicioHtml(null), '');
    igual(midiaDoExercicioHtml('   '), '');
  });

  teste('ARQUIVO DE VÍDEO TOCA NO CARD', () => {
    const html = midiaDoExercicioHtml('https://exemplo.com/agachamento.mp4');
    contem(html, '<video');
    contem(html, 'src="https://exemplo.com/agachamento.mp4"');
  });

  teste('URL SEM EXTENSÃO TAMBÉM TOCA', () => {
    // As bibliotecas servem por id, não por nome de arquivo: a URL gratuita da
    // Your Move é `/api/free/<uuid>` e devolve video/mp4 sem nenhum ".mp4".
    // Sniffar extensão deixaria de fora justamente o acervo licenciado.
    contem(midiaDoExercicioHtml('https://ymove.app/api/free/13263f92-5fe2-4d92-bec0-808f8b315620'), '<video');
  });

  teste('PÁGINA NÃO VIRA PLAYER — vai como link', () => {
    // Um player quebrado é pior que um link honesto: o retângulo preto parece
    // defeito do app, e o aluno não tenta de novo.
    for (const u of [
      'https://www.youtube.com/watch?v=abc123',
      'https://youtu.be/abc123',
      'https://www.instagram.com/reel/abc/',
      'https://drive.google.com/file/d/abc/view',
      'https://vimeo.com/123456',
      'https://www.tiktok.com/@x/video/123',
    ]) {
      const html = midiaDoExercicioHtml(u);
      naoContem(html, '<video');
      contem(html, 'Ver vídeo');
      contem(html, 'target="_blank"');
    }
  });

  teste('o link de socorro vem junto, escondido', () => {
    // O `onerror` só troca o `hidden`. Montar o link por JS depois da falha
    // exigiria guardar a URL no DOM e remontar a marcação — mais código para
    // o caso que já deu errado.
    const html = midiaDoExercicioHtml('https://exemplo.com/x.mp4');
    contem(html, 'onerror=');
    contem(html, '<span hidden>');
    contem(html, 'Ver vídeo');
  });

  teste('a URL é escapada', () => {
    // `video_url` é campo de texto livre no cadastro do exercício.
    const html = midiaDoExercicioHtml('https://x.com/a.mp4" onload="alert(1)');
    naoContem(html, 'onload="alert(1)"');
    contem(html, '&quot;');
  });

  teste('não pré-carrega, e não some do card no iPhone', () => {
    // Doze exercícios por treino: pré-carregar todos gastaria a franquia do
    // aluno com vídeo que ele não vai abrir. `playsinline` para o iOS não
    // jogar em tela cheia sozinho.
    const html = midiaDoExercicioHtml('https://exemplo.com/x.mp4');
    contem(html, 'preload="none"');
    contem(html, 'playsinline');
    contem(html, 'muted');
    contem(html, 'loop');
  });
});

grupo('pwa · o card não pula quando o vídeo carrega', () => {
  const css = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

  teste('o player tem altura reservada, na proporção do acervo', () => {
    // Sem `aspect-ratio`, o card cresce quando o vídeo chega e o dedo do aluno
    // erra o botão de série que estava ali. Isto é o que o teste protege, e
    // continua valendo.
    //
    // A PROPORÇÃO MUDOU DE 9/16 PARA 16/9, e não é questão de gosto: as 68
    // animações do acervo são 1920x1080 — as 68, medido em
    // db/exercicio_midias_seed.sql. O 9/16 foi escrito quando o único vídeo do
    // card era link externo de biblioteca, que costuma ser vertical; com o
    // acervo, punha um clipe deitado numa caixa em pé.
    contem(css, '.pa-midia-v');
    contem(css, 'aspect-ratio: 16 / 9');
  });

  teste('a animação aparece inteira — nada de recorte', () => {
    // `cover` preenche a caixa recortando o que sobra: num clipe 16/9 dentro de
    // caixa 9/16, sobrava a faixa central e sumiam os dois lados do movimento.
    // `contain` mostra tudo, com tarja quando a proporção não bate — e é o que
    // mantém inteiro também o link externo vertical dos outros 14 exercícios.
    contem(css, 'object-fit: contain');
    ok(!/\.pa-midia-v\s*\{[^}]*object-fit:\s*cover/.test(css),
       'cover no player do exercício recorta a demonstração');
  });

  teste('o aviso de falha não aparece sobre um vídeo que funciona', () => {
    // `display: block` numa classe vence o `display: none` que o atributo
    // `hidden` aplica pela folha do navegador. Sem a regra explícita, o aviso
    // de indisponível fica visível embaixo de TODO vídeo que carregou bem.
    ok(/\.pa-midia-erro\[hidden\]\s*\{[^}]*display:\s*none/.test(css),
       'a classe do aviso precisa devolver o display:none do atributo hidden');
  });
});
