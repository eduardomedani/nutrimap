// ═══════════════════════════════════════════════════════════
// OFERTAS — vitrine e card do que o cliente não contratou
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: só quem tem os serviços DEFINIDOS vê oferta;
// a vitrine tem o botão de contratar; e o "Quero contratar" não promete o que
// ainda não faz (nada é gravado nem enviado nesta fase).

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { ofertaveis, VENDIDOS_NO_APP } from '../js/servicos.js';
import {
  OFERTAS, ofertaDaAba, ofertaCardHtml, vitrineHtml, respostaQuero, estaAdiada, ADIAR_DIAS,
} from '../js/pwa-ofertas.js';

const ler = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

grupo('ofertas · quem vê', () => {
  teste('sem definição na ficha: nada à venda', () => {
    igual(ofertaveis(null), []);
    igual(ofertaveis(undefined), []);
  });
  teste('à venda: Treino e Alimentação que faltam (Academia nunca)', () => {
    igual(VENDIDOS_NO_APP, ['treino', 'alimentacao']);
    igual(ofertaveis([]), ['treino', 'alimentacao']);
    igual(ofertaveis(['treino', 'academia']), ['alimentacao']);
    igual(ofertaveis(['alimentacao']), ['treino']);
    igual(ofertaveis(['alimentacao', 'treino']), []);
  });
  teste('cada oferta sabe a sua aba', () => {
    igual(ofertaDaAba('treino').id, 'treino');
    igual(ofertaDaAba('dieta').id, 'alimentacao');
    igual(ofertaDaAba('agenda'), null);
  });
});

grupo('ofertas · vitrine', () => {
  for (const id of Object.keys(OFERTAS)) {
    teste(`${id}: título, o que está incluído, exemplo e "Quero contratar"`, () => {
      const h = vitrineHtml(id);
      contem(h, OFERTAS[id].titulo);
      contem(h, 'O que está incluído');
      igual((h.match(/class="of-ben"/g) || []).length, OFERTAS[id].beneficios.length);
      contem(h, 'Exemplo');
      contem(h, `data-quero="${id}"`);
      contem(h, 'Quero contratar');
    });
  }
  teste('o exemplo é decorativo para o leitor de tela', () => {
    contem(vitrineHtml('treino'), '<div class="of-ex-conteudo" aria-hidden="true">');
  });
  teste('sem preço definido, não mostra preço', () => {
    naoContem(vitrineHtml('treino'), 'of-preco');
  });
  teste('oferta desconhecida: nada', () => {
    igual(vitrineHtml('academia'), '');
    igual(ofertaCardHtml('academia'), '');
  });
});

grupo('ofertas · "Quero contratar" não promete o que não faz', () => {
  teste('manda falar com a equipe; não diz que enviou pedido', () => {
    for (const id of ['treino', 'alimentacao']) {
      const r = respostaQuero(id);
      const tudo = `${r.titulo} ${r.texto} ${r.regra}`;
      contem(tudo, 'Fale com a recepção ou com o seu profissional');
      for (const promessa of ['enviad', 'recebemos', 'vamos entrar em contato', 'pedido']) naoContem(tudo.toLowerCase(), promessa);
    }
    contem(respostaQuero('alimentacao').texto, 'o acompanhamento nutricional');
    contem(respostaQuero('treino').titulo, 'o Treino');
  });
});

grupo('ofertas · "Agora não"', () => {
  const dia = 86400000;
  const agora = Date.parse('2026-11-11T12:00:00Z');
  teste(`some por ${ADIAR_DIAS} dias e depois volta`, () => {
    ok(estaAdiada(new Date(agora - 1 * dia).toISOString(), agora), 'ontem');
    ok(estaAdiada(new Date(agora - 29 * dia).toISOString(), agora), '29 dias');
    ok(!estaAdiada(new Date(agora - 30 * dia).toISOString(), agora), '30 dias: volta');
  });
  teste('sem registro (ou lixo): mostra', () => {
    ok(!estaAdiada(null, agora));
    ok(!estaAdiada('abc', agora));
  });
});

grupo('ofertas · casca e cache', () => {
  teste('a barra desenha o cadeado na aba bloqueada', () => {
    const casca = ler('../js/paciente-ui.js');
    contem(casca, '<span class="pa-barra-cadeado" aria-hidden="true"><i data-lucide="lock"></i></span>');
    contem(casca, "aria-label=\"${label} (conheça)\"");
  });
  teste('folha e módulo no app e no cache', () => {
    contem(ler('../app.html'), '<link rel="stylesheet" href="css/pwa-ofertas.css">');
    const sw = ler('../sw.js');
    contem(sw, "'css/pwa-ofertas.css',");
    contem(sw, "'js/pwa-ofertas.js',");
  });
});
