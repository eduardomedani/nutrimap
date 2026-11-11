// ═══════════════════════════════════════════════════════════
// OFERTAS — vender o Treino e a Alimentação para quem ainda não tem
// ═══════════════════════════════════════════════════════════
// Fase 1 (11/11/2026, pedido do Eduardo): SÓ as telas e os botões.
//   * A aba do serviço não contratado continua na barra, com cadeado, e abre
//     uma VITRINE: o que está incluído, um exemplo e "Quero contratar".
//   * No Início, um card de oferta com "Conhecer" e "Agora não" (some por 30
//     dias neste aparelho).
//   * "Quero contratar" ainda NÃO grava nem envia nada: abre um cartão que
//     diz a verdade — fale com a recepção/profissional. O pedido no painel, o
//     WhatsApp e o pagamento são a fase seguinte (precisam de banco).
//
// Quem vê oferta: só quem tem os serviços DEFINIDOS na ficha e não tem este
// (js/servicos.js → ofertaveis). Sem definição, tudo liberado e nada à venda.
//
// A marcação sai de funções puras (dado → string), testadas em
// test/pwa-ofertas.test.mjs.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = nome => `<i data-lucide="${esc(nome)}"></i>`;

/**
 * O texto de cada oferta. `preco` fica null até o Eduardo decidir se o app
 * mostra preço; com valor, aparece embaixo do título da vitrine.
 * `exemplo` é ILUSTRATIVO e a tela diz isso ("Exemplo").
 */
export const OFERTAS = {
  treino: {
    id: 'treino',
    aba: 'treino',
    icone: 'dumbbell',
    rotulo: 'Treino',
    comArtigo: 'o Treino',
    servico: 'o treino',
    titulo: 'Seu treino, montado para você',
    chamada: 'Um programa feito pelo seu profissional para o seu objetivo e a sua rotina — direto no app, exercício por exercício.',
    card: 'Tenha um treino montado para o seu objetivo, com vídeo de cada exercício e a sua evolução registrada.',
    beneficios: [
      ['target', 'Montado para o seu objetivo', 'Hipertrofia, emagrecimento ou condicionamento, no seu nível.'],
      ['circle-play', 'Vídeo de cada exercício', 'Veja a execução certa antes de começar a série.'],
      ['trending-up', 'Cargas e evolução registradas', 'Cada série fica salva e você acompanha o seu progresso.'],
      ['timer', 'Cronômetro e tempo estimado', 'Saiba quanto falta e mantenha o ritmo do treino.'],
    ],
    exemplo: {
      titulo: 'Treino A · Peito e tríceps',
      linhas: [['Supino reto', '4 × 8–12'], ['Crucifixo com halteres', '3 × 10–15'], ['Tríceps na polia', '3 × 10–15']],
    },
    preco: null,
  },
  alimentacao: {
    id: 'alimentacao',
    aba: 'dieta',
    icone: 'salad',
    rotulo: 'Dieta',
    comArtigo: 'a Dieta',
    servico: 'o acompanhamento nutricional',
    titulo: 'Uma alimentação feita para a sua rotina',
    chamada: 'Um plano alimentar montado por nutricionista para o seu objetivo, com as refeições do seu dia na palma da mão.',
    card: 'Quer um plano alimentar feito para a sua rotina e o seu objetivo? Veja como funciona o acompanhamento nutricional.',
    beneficios: [
      ['target', 'Feito para o seu objetivo', 'Do emagrecimento ao ganho de massa, no seu ritmo.'],
      ['clock', 'Refeições com horários', 'O seu dia organizado, refeição por refeição.'],
      ['house', 'Próxima refeição no Início', 'Abriu o app, já sabe o que vem a seguir.'],
      ['refresh-cw', 'Ajustes conforme a evolução', 'O plano acompanha os seus resultados.'],
    ],
    exemplo: {
      titulo: 'Plano alimentar · 5 refeições',
      linhas: [['Café da manhã', '07:00'], ['Almoço', '12:30'], ['Lanche da tarde', '16:00']],
    },
    preco: null,
  },
};

/** A oferta que a aba representa ('treino' | 'dieta'), ou null. */
export const ofertaDaAba = aba => Object.values(OFERTAS).find(o => o.aba === aba) || null;

// ── Card do Início ──────────────────────────────────────────
export function ofertaCardHtml(id) {
  const o = OFERTAS[id];
  if (!o) return '';
  return `
    <section class="in-card in-oferta" data-oferta="${esc(id)}" aria-labelledby="inOferta-${esc(id)}">
      <div class="in-card-top">
        <span class="in-card-ic">${ic(o.icone)}</span>
        <div class="in-card-cab">
          <p class="in-card-rot">Para você</p>
          <h2 class="in-card-tit" id="inOferta-${esc(id)}">${esc(o.titulo)}</h2>
        </div>
      </div>
      <p class="in-card-vazio">${esc(o.card)}</p>
      <div class="of-card-acoes">
        <button class="in-btn in-btn-pri" type="button" data-ir="${esc(o.aba)}">${ic('sparkles')} Conhecer</button>
        <button class="of-adiar" type="button" data-oferta-adiar="${esc(id)}">Agora não</button>
      </div>
    </section>`;
}

// ── "Agora não": some por 30 dias NESTE aparelho ─────────────
export const ADIAR_DIAS = 30;
const chaveAdiada = (pacienteId, id) => `evo_oferta_adiada_${pacienteId || 'anon'}_${id}`;

/** Ainda dentro dos 30 dias desde o "Agora não"? (puro: recebe as datas) */
export function estaAdiada(quando, agora = Date.now()) {
  const t = Date.parse(quando || '');
  if (!Number.isFinite(t)) return false;
  return agora - t < ADIAR_DIAS * 86400000;
}

export function ofertaAdiada(pacienteId, id, agora = Date.now()) {
  try { return estaAdiada(localStorage.getItem(chaveAdiada(pacienteId, id)), agora); }
  catch { return false; }   // sem storage (modo privado): mostra
}

export function adiarOferta(pacienteId, id, agora = new Date()) {
  try { localStorage.setItem(chaveAdiada(pacienteId, id), agora.toISOString()); } catch {}
}

// ── Vitrine (a aba com cadeado) ─────────────────────────────
export function vitrineHtml(id) {
  const o = OFERTAS[id];
  if (!o) return '';
  const beneficios = o.beneficios.map(([icone, t, s]) => `
      <li class="of-ben">
        <span class="of-ben-ic">${ic(icone)}</span>
        <span class="of-ben-txt"><b>${esc(t)}</b><span>${esc(s)}</span></span>
      </li>`).join('');
  const exemplo = o.exemplo.linhas.map(([a, b]) => `
        <li><span>${esc(a)}</span><span class="of-ex-v">${esc(b)}</span></li>`).join('');
  return `
    <div class="of-vitrine">
      <header class="of-hero">
        <span class="of-selo">${ic('lock')} Ainda não incluído no seu plano</span>
        <span class="of-hero-ic" aria-hidden="true">${ic(o.icone)}</span>
        <h1 class="of-tit">${esc(o.titulo)}</h1>
        <p class="of-chamada">${esc(o.chamada)}</p>
        ${o.preco ? `<p class="of-preco">${esc(o.preco)}</p>` : ''}
      </header>

      <section class="of-bloco" aria-labelledby="ofInclui">
        <h2 class="of-bloco-t" id="ofInclui">O que está incluído</h2>
        <ul class="of-bens">${beneficios}</ul>
      </section>

      <section class="of-bloco" aria-labelledby="ofExemplo">
        <h2 class="of-bloco-t" id="ofExemplo">Como fica no app</h2>
        <div class="of-ex">
          <div class="of-ex-conteudo" aria-hidden="true">
            <p class="of-ex-t">${esc(o.exemplo.titulo)}</p>
            <ul class="of-ex-l">${exemplo}</ul>
          </div>
          <div class="of-ex-veu">${ic('lock')}<span>Exemplo — o seu fica aqui quando você contratar</span></div>
        </div>
      </section>

      <div class="of-cta">
        <button class="in-btn in-btn-pri" type="button" data-quero="${esc(id)}">${ic('sparkles')} Quero contratar</button>
      </div>
    </div>`;
}

/**
 * O que o "Quero contratar" responde nesta fase. Nada é gravado nem enviado,
 * então o texto NÃO diz "pedido enviado" — manda falar com a equipe.
 */
export function respostaQuero(id) {
  const o = OFERTAS[id] || { comArtigo: 'o serviço', servico: 'o serviço' };
  return {
    titulo: `Que bom que você quer ${o.comArtigo}!`,
    texto: `Fale com a recepção ou com o seu profissional para incluir ${o.servico} no seu plano.`,
    regra: 'Em breve você vai poder contratar direto por aqui.',
  };
}

// ── O cartão (mesmo visual dos avisos da agenda) ─────────────
function cartao({ titulo, texto, regra }) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'agc-fundo';
    fundo.innerHTML = `
      <div class="agc agc-ok" role="alertdialog" aria-modal="true" aria-labelledby="agcT" aria-describedby="agcX">
        <div class="agc-ic">${ic('sparkles')}</div>
        <h2 class="agc-t" id="agcT">${esc(titulo)}</h2>
        <p class="agc-x" id="agcX">${esc(texto)}</p>
        ${regra ? `<p class="agc-regra">${esc(regra)}</p>` : ''}
        <div class="agc-acoes"><button type="button" class="ag-btn" data-agc="sim">OK</button></div>
      </div>`;
    document.body.classList.add('agc-travado');
    document.body.appendChild(fundo);
    window.renderIcons?.();
    const fechar = () => {
      document.removeEventListener('keydown', tecla);
      fundo.remove();
      document.body.classList.remove('agc-travado');
      resolve(true);
    };
    const tecla = e => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', tecla);
    const ok = fundo.querySelector('[data-agc="sim"]');
    ok.addEventListener('click', fechar);
    ok.focus();
  });
}

/** Monta a vitrine no elemento `alvo` (id). */
export function renderVitrine(alvo, id) {
  const cx = typeof alvo === 'string' ? document.getElementById(alvo) : alvo;
  if (!cx) return;
  cx.innerHTML = vitrineHtml(id);
  window.renderIcons?.();
  cx.querySelector('[data-quero]')?.addEventListener('click', () => cartao(respostaQuero(id)));
}
