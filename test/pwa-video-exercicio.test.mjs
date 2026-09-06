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

  teste('o player tem altura reservada', () => {
    // Sem `aspect-ratio`, o card cresce quando o vídeo chega e o dedo do aluno
    // erra o botão de série que estava ali.
    contem(css, '.pa-midia-v');
    contem(css, 'aspect-ratio: 9 / 16');
  });
});
