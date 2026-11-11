// ═══════════════════════════════════════════════════════════
// OFERTAS — vitrine e card do que o cliente não contratou
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: só quem tem os serviços DEFINIDOS vê oferta;
// a vitrine apresenta o serviço com demonstração isolada; e a ação só promete o que
// faz (WhatsApp da organização, ou orientação sem botão).

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { ofertaveis, VENDIDOS_NO_APP } from '../js/servicos.js';
import {
  OFERTAS, ofertaDaAba, ofertaCardHtml, vitrineHtml, estaAdiada, ADIAR_DIAS,
  acaoHtml, demoTreinoHtml, demoDietaHtml, normalizarWhatsapp, canalDoRetorno, painelDemoHtml,
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

grupo('ofertas · mini landing page', () => {
  for (const id of Object.keys(OFERTAS)) {
    teste(`${id}: as seções na ordem, com os fundos alternados`, () => {
      const h = vitrineHtml(id);
      const ordem = [OFERTAS[id].selo, 'Veja como funciona', 'O que você tem no app',
        'Veja como fica simples no seu dia a dia.', 'Experimentar demonstração', 'Como funciona</h2>',
        'Vamos organizar seu próximo passo?', 'Consulte os planos e valores com a equipe.'].map(t => h.indexOf(t));
      ok(ordem.every(x => x >= 0), `faltou seção: ${ordem}`);
      ok(ordem.every((x, k) => k === 0 || x > ordem[k - 1]), `fora de ordem: ${ordem}`);
      const fundos = [...h.matchAll(/class="of-s (of-\w+)/g)].map(m => m[1]);
      igual(fundos, ['of-escuro', 'of-claro', 'of-suave', 'of-claro', 'of-escuro']);
    });
    teste(`${id}: três benefícios e três passos`, () => {
      const h = vitrineHtml(id);
      igual((h.match(/class="of-ben"/g) || []).length, 3);
      igual((h.match(/class="of-passo"/g) || []).length, 3);
    });
    teste(`${id}: demonstração identificada; status discreto no fechamento`, () => {
      const h = vitrineHtml(id);
      contem(h, 'Exemplo ilustrativo. Seu plano será individualizado.');
      contem(h, '<span class="of-mini-selo">Demonstração</span>');
      ok(h.indexOf('Ainda não incluído no seu plano.') > h.indexOf('ofFimT'), 'status fora do fechamento');
    });
  }
  teste('textos pedidos', () => {
    const t = vitrineHtml('treino'), a = vitrineHtml('alimentacao');
    contem(t, '<span>Treine com direção.</span> <span>Evolua com acompanhamento.</span>');
    contem(t, 'Seu próximo passo');
    contem(a, 'Seu objetivo começa com um plano que cabe na sua rotina.');
    contem(a, 'Alimentação na vida real');
    for (const b of ['Abra e saiba o que treinar.', 'Consulte como executar.', 'Veja sua evolução.']) contem(t, b);
    for (const b of ['Abra e saiba o que comer.', 'Encontre alternativas.', 'Tenha orientação.']) contem(a, b);
  });
  teste('sem promessa de resultado nem vídeo garantido', () => {
    for (const id of Object.keys(OFERTAS)) {
      const h = vitrineHtml(id).toLowerCase();
      for (const p of ['emagre', 'hipertrofia', 'garant', 'resultado', 'vídeos']) naoContem(h, p);
    }
    contem(vitrineHtml('treino'), 'quando disponíveis');
  });
  teste('"Veja como funciona" leva a uma seção que existe', () => {
    const h = vitrineHtml('treino');
    contem(h, 'href="#ofComo"');
    contem(h, 'id="ofComo" tabindex="-1"');
  });
  teste('a página não despeja a ficha: o componente interativo fica no painel', () => {
    const h = vitrineHtml('treino');
    naoContem(h, 'pa-serie-block');
    naoContem(vitrineHtml('alimentacao'), 'dt-card');
    contem(painelDemoHtml('treino'), 'role="dialog" aria-modal="true"');
    contem(painelDemoHtml('treino'), 'pa-serie-block');
    contem(painelDemoHtml('alimentacao'), 'dt-card');
    contem(painelDemoHtml('alimentacao'), 'Exemplo ilustrativo. Seu plano será individualizado.');
  });
  teste('sem fotografia: nenhuma imagem externa ou quebrada', () => {
    for (const id of Object.keys(OFERTAS)) naoContem(vitrineHtml(id), '<img');
  });
  teste('sem preço configurado: manda consultar, sem inventar valor', () => {
    for (const id of Object.keys(OFERTAS)) {
      const h = vitrineHtml(id);
      naoContem(h, 'of-preco');
      naoContem(h, 'R$');
    }
  });
  teste('oferta desconhecida: nada', () => {
    igual(vitrineHtml('academia'), '');
    igual(ofertaCardHtml('academia'), '');
    igual(acaoHtml('academia', null), '');
  });
});

grupo('ofertas · demonstração isolada', () => {
  teste('treino: nome, séries e reps, execução e registro de carga', () => {
    const h = demoTreinoHtml();
    for (const t of ['Supino reto com barra', '<b>3</b> séries', 'reps', 'Ver execução', 'placeholder="kg"']) contem(h, t);
  });
  teste('treino: nenhum gatilho da casca que grava (data-carga, data-sdone, data-s-peso...)', () => {
    const h = demoTreinoHtml();
    for (const g of ['data-carga', 'data-sdone', 'data-s-peso', 'data-s-reps', 'data-ex=', 'data-prog-box', 'data-block']) naoContem(h, g);
  });
  teste('dieta: o componente real, aberto, com alimentos, quantidades e substituições', () => {
    const h = demoDietaHtml();
    contem(h, 'class="dt-card');
    contem(h, 'aria-expanded="true"');
    contem(h, 'Almoço');
    contem(h, '4 colheres de sopa');
    contem(h, 'data-dt-sub="demo-arroz"');
  });
  teste('o módulo não lê paciente, treino nem dieta: só a RPC do canal', () => {
    const js = ler('../js/pwa-ofertas.js');
    naoContem(js, 'sb.from(');
    igual((js.match(/sb\.rpc\(/g) || []).length, 1);
    contem(js, "sb.rpc('rpc_paciente_canal_comercial')");
  });
});

grupo('ofertas · canal comercial', () => {
  teste('número: dígitos, DDI 55 quando falta; lixo vira null', () => {
    igual(normalizarWhatsapp('(11) 99999-0000'), '5511999990000');
    igual(normalizarWhatsapp('11 3333-4444'), '551133334444');
    igual(normalizarWhatsapp('+55 11 99999-0000'), '5511999990000');
    igual(normalizarWhatsapp('123'), null);
    igual(normalizarWhatsapp(null), null);
  });
  teste('retorno da RPC: lista, linha, vazio', () => {
    igual(canalDoRetorno([{ organizacao: 'Academia X', whatsapp: '11999990000' }]), { organizacao: 'Academia X', whatsapp: '5511999990000' });
    igual(canalDoRetorno({ organizacao: '', whatsapp: '5511999990000' }), { organizacao: null, whatsapp: '5511999990000' });
    igual(canalDoRetorno([]), null);
    igual(canalDoRetorno(null), null);
    igual(canalDoRetorno([{ organizacao: 'X', whatsapp: null }]), null);
  });
  teste('com WhatsApp: link wa.me com o número da organização e a mensagem do serviço', () => {
    const canal = { organizacao: 'Academia X', whatsapp: '5511999990000' };
    const t = acaoHtml('treino', canal);
    contem(t, 'Consultar planos pelo WhatsApp');
    contem(t, `https://wa.me/5511999990000?text=${encodeURIComponent(OFERTAS.treino.mensagem)}`);
    contem(t, 'target="_blank" rel="noopener"');
    contem(acaoHtml('alimentacao', canal), encodeURIComponent('acompanhamento alimentar pelo Evollo'));
    contem(OFERTAS.treino.mensagem, 'acompanhamento de treino pelo Evollo');
  });
  teste('sem canal: orientação real, sem botão e sem confirmação fictícia', () => {
    for (const id of Object.keys(OFERTAS)) {
      const h = acaoHtml(id, null);
      naoContem(h, '<button');
      naoContem(h, '<a ');
      contem(h, 'fale com a recepção ou com o seu profissional');
      for (const p of ['enviad', 'registrad', 'recebemos', 'em breve']) naoContem(h.toLowerCase(), p);
      igual(acaoHtml(id, null, 'faixa'), '', 'sem canal, sem faixa');
    }
  });
  teste('a mesma ação na abertura, no fechamento e na faixa; sem aviso embaixo do botão', () => {
    const canal = { organizacao: null, whatsapp: '5511999990000' };
    const esc = acaoHtml('treino', canal, 'escuro'), fx = acaoHtml('treino', canal, 'faixa');
    for (const h of [esc, fx]) { contem(h, 'Consultar planos pelo WhatsApp'); naoContem(h, 'revisa'); naoContem(h, '<p'); }
    igual(esc.match(/href="([^"]+)"/)[1], fx.match(/href="([^"]+)"/)[1]);
  });
  teste('nenhum número fixo no código; a mensagem não leva dado de saúde', () => {
    const js = ler('../js/pwa-ofertas.js');
    ok(!/wa\.me\/\d/.test(js), 'número fixo');
    for (const o of Object.values(OFERTAS)) for (const p of ['peso', 'objetivo', 'alergia', 'nome']) naoContem(o.mensagem.toLowerCase(), p);
  });
  teste('o modal que terminava em "OK" saiu', () => {
    const js = ler('../js/pwa-ofertas.js');
    naoContem(js, 'Em breve você vai poder contratar');
    naoContem(js, 'Quero contratar');
    naoContem(js, 'data-agc="sim"');
  });
  teste('SQL: aditivo, só a RPC do paciente, desfazer completo', () => {
    const sql = ler('../db/canal_comercial.sql').split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
    contem(sql, 'add column if not exists whatsapp_comercial text;');
    contem(sql, 'security definer');
    contem(sql, 'where p.id = public.paciente_do_auth()');
    contem(sql, 'grant execute on function public.rpc_paciente_canal_comercial() to authenticated;');
    ok(!/\b(insert into|update public\.|delete from)\b/i.test(sql), 'mexe em dado');
    const desf = ler('../db/canal_comercial_desfazer.sql');
    contem(desf, 'drop function if exists public.rpc_paciente_canal_comercial();');
    contem(desf, 'drop column if exists whatsapp_comercial;');
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
  teste('a barra marca a aba não incluída, discreta; a ação vai na faixa fixa', () => {
    const casca = ler('../js/paciente-ui.js');
    contem(casca, '<span class="pa-barra-cadeado" aria-hidden="true"><i data-lucide="plus"></i></span>');
    contem(casca, "aria-label=\"${label}, ainda não incluído (conheça)\"");
    contem(casca, "m.renderVitrine('paOferta', id, { alvoAcao: 'paOfertaAcao' })");
    contem(casca, '<div class="pa-finishbar of-faixa" hidden>');
    contem(casca, '<main class="pa-main of-main">');
  });
  teste('folha e módulo no app e no cache', () => {
    contem(ler('../app.html'), '<link rel="stylesheet" href="css/pwa-ofertas.css">');
    const sw = ler('../sw.js');
    contem(sw, "'css/pwa-ofertas.css',");
    contem(sw, "'js/pwa-ofertas.js',");
  });
});
