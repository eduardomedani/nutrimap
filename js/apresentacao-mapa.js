// ═══════════════════════════════════════════════════════════
// MAPA CORPORAL — silhueta anatômica + mapeamento das medidas
// ═══════════════════════════════════════════════════════════
// SVG autoral, inline, sem asset externo e sem dependência.
//
// Geometria: viewBox 240×560, corpo centrado em x=120 e TODAS as coordenadas
// espelhadas em torno desse eixo (74↔166, 90↔150…). Simetria à mão erra fácil;
// por isso as larguras vêm de meia-largura + centro, e o braço/perna esquerdo
// é o direito espelhado por `espelhar()`.
//
// Cada região é uma forma clicável ligada a UMA coluna da avaliação (per_* ou
// dc_*). Perimetria é faixa (retângulo arredondado sobre o segmento medido);
// dobra cutânea é ponto (círculo no local da pinça). Região sem medida nas
// duas avaliações fica apagada e inerte — não vira botão morto.
//
// Cores (regra do produto): reduziu → verde · aumentou → azul · piorou pelo
// objetivo → âmbar. Vermelho não aparece: quem olha é o paciente.

const EIXO = 120;

// faixa(nome, y, altura, meiaLargura) — perimetria, centrada no eixo.
const faixa = (o, y, h, meia) => ({
  ...o, forma: { tipo: 'rect', x: EIXO - meia, y, w: meia * 2, h, rx: 7 },
});
// ponto(nome, cx, cy) — dobra cutânea, no local da pinça.
const ponto = (o, cx, cy) => ({ ...o, dobra: true, forma: { tipo: 'circ', cx, cy, r: 10 } });
// membro(nome, x, y, largura, altura) — braço/perna, fora do eixo.
const membro = (o, x, y, w, h) => ({ ...o, forma: { tipo: 'rect', x, y, w, h, rx: 7 } });

export const REGIOES_FRENTE = [
  faixa({ id: 'torax',    campo: 'per_torax',    rotulo: 'Tórax',    unidade: 'cm' }, 104, 44, 40),
  faixa({ id: 'abdomen',  campo: 'per_abdomen',  rotulo: 'Abdômen',  unidade: 'cm' }, 156, 42, 35),
  faixa({ id: 'cintura',  campo: 'per_cintura',  rotulo: 'Cintura',  unidade: 'cm' }, 204, 38, 31),
  faixa({ id: 'quadril',  campo: 'per_quadril',  rotulo: 'Quadril',  unidade: 'cm' }, 250, 50, 39),

  membro({ id: 'braco_d', campo: 'per_braco_direito',  rotulo: 'Braço direito',  unidade: 'cm' }, 58, 132, 22, 68),
  membro({ id: 'braco_e', campo: 'per_braco_esquerdo', rotulo: 'Braço esquerdo', unidade: 'cm' }, 160, 132, 22, 68),
  membro({ id: 'coxa_d',  campo: 'per_coxa_direita',   rotulo: 'Coxa direita',   unidade: 'cm' }, 90, 320, 28, 76),
  membro({ id: 'coxa_e',  campo: 'per_coxa_esquerda',  rotulo: 'Coxa esquerda',  unidade: 'cm' }, 122, 320, 28, 76),
  membro({ id: 'pant_d',  campo: 'per_panturrilha_direita',  rotulo: 'Panturrilha direita',  unidade: 'cm' }, 93, 408, 22, 62),
  membro({ id: 'pant_e',  campo: 'per_panturrilha_esquerda', rotulo: 'Panturrilha esquerda', unidade: 'cm' }, 125, 408, 22, 62),

  ponto({ id: 'dc_peitoral',     campo: 'dc_peitoral',     rotulo: 'Dobra peitoral',      unidade: 'mm' }, 99, 126),
  ponto({ id: 'dc_abdominal',    campo: 'dc_abdominal',    rotulo: 'Dobra abdominal',     unidade: 'mm' }, 137, 177),
  ponto({ id: 'dc_supra_iliaca', campo: 'dc_supra_iliaca', rotulo: 'Dobra supra-ilíaca',  unidade: 'mm' }, 146, 223),
  ponto({ id: 'dc_coxa',         campo: 'dc_coxa',         rotulo: 'Dobra da coxa',       unidade: 'mm' }, 104, 352),
];

export const REGIOES_COSTAS = [
  ponto({ id: 'dc_subescapular',  campo: 'dc_subescapular',  rotulo: 'Dobra subescapular',     unidade: 'mm' }, 142, 146),
  ponto({ id: 'dc_tricipital',    campo: 'dc_tricipital',    rotulo: 'Dobra tricipital',       unidade: 'mm' }, 69, 160),
  ponto({ id: 'dc_axilar_media',  campo: 'dc_axilar_media',  rotulo: 'Dobra axilar média',     unidade: 'mm' }, 95, 168),
  ponto({ id: 'dc_crista_iliaca', campo: 'dc_crista_iliaca', rotulo: 'Dobra da crista ilíaca', unidade: 'mm' }, 148, 238),
  ponto({ id: 'dc_panturrilha',   campo: 'dc_panturrilha',   rotulo: 'Dobra da panturrilha',   unidade: 'mm' }, 136, 438),
];

// ── Silhueta ────────────────────────────────────────────────
// Estilizada de propósito: é um mapa de medidas, não uma prancha de anatomia.
// Braço e perna são desenhados uma vez e espelhados, para não haver assimetria.
const BRACO  = 'M74 98 C63 102 57 113 57 127 L53 205 C52 216 59 223 66 221 C72 219 75 213 75 206 L81 138 Z';
const PERNA  = 'M88 306 L118 306 L118 398 L114 470 L113 500 L91 500 L91 470 L88 398 Z';

/** Espelha um path em torno do eixo do corpo (x → 240 − x). */
function espelhar(d) {
  return d.replace(/([ML]\s*)(-?\d+(?:\.\d+)?)/g, (_, cmd, x) => `${cmd}${240 - Number(x)}`)
          .replace(/(C\s*)(-?\d+(?:\.\d+)?)(\s+)(-?\d+(?:\.\d+)?)(\s+)(-?\d+(?:\.\d+)?)(\s+)(-?\d+(?:\.\d+)?)(\s+)(-?\d+(?:\.\d+)?)/g,
            (_, c, x1, s1, y1, s2, x2, s3, y2, s4, x3) =>
              `${c}${240 - Number(x1)}${s1}${y1}${s2}${240 - Number(x2)}${s3}${y2}${s4}${240 - Number(x3)}`);
}

const CORPO = `
  <circle cx="120" cy="50" r="28"/>
  <rect x="110" y="70" width="20" height="20" rx="8"/>
  <path d="M74 96 C74 91 86 86 120 86 C154 86 166 91 166 96
           L162 152 L150 236 L158 292 L152 312 L88 312 L82 292 L90 236 L78 152 Z"/>
  <path d="${BRACO}"/>
  <path d="${espelhar(BRACO)}"/>
  <path d="${PERNA}"/>
  <path d="${espelhar(PERNA)}"/>
`;

/**
 * Desenha uma vista do mapa.
 * @param {'frente'|'costas'} vista
 * @param {Array} estados  [{ id, tom, temDado }]
 */
export function svgCorpo(vista, estados) {
  const regioes = vista === 'costas' ? REGIOES_COSTAS : REGIOES_FRENTE;
  const porId = new Map((estados || []).map(e => [e.id, e]));

  const areas = regioes.map(r => {
    const e = porId.get(r.id) || { tom: 'sem-dado', temDado: false };
    const cls = ['ap-regiao', r.dobra ? 'ap-regiao-dobra' : '', `tom-${e.tom}`,
                 e.temDado ? '' : 'sem-dado'].filter(Boolean).join(' ');
    const f = r.forma;
    const geo = f.tipo === 'circ'
      ? `<circle cx="${f.cx}" cy="${f.cy}" r="${f.r}"`
      : `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="${f.rx}"`;
    // Sem medida = sem foco e sem clique.
    return `${geo} class="${cls}" data-regiao="${r.id}"
              role="${e.temDado ? 'button' : 'presentation'}" tabindex="${e.temDado ? '0' : '-1'}"
              aria-label="${esc(r.rotulo)}${e.temDado ? '' : ' — sem medida'}">
              <title>${esc(r.rotulo)}</title>
            ${f.tipo === 'circ' ? '</circle>' : '</rect>'}`;
  }).join('');

  return `
    <svg viewBox="0 0 240 560" class="ap-corpo" role="img"
         aria-label="Mapa corporal — vista ${vista === 'costas' ? 'de costas' : 'de frente'}">
      <g class="ap-corpo-silhueta" aria-hidden="true">${CORPO}</g>
      <g class="ap-corpo-areas">${areas}</g>
    </svg>`;
}

/**
 * Estado de cada região a partir das duas avaliações.
 * Devolve também de/para/dif, que alimentam o painel de detalhe.
 */
export function estadosDasRegioes(vista, primeira, atual, objetivo, deps) {
  const { num, tomDaVariacao } = deps;
  const regioes = vista === 'costas' ? REGIOES_COSTAS : REGIOES_FRENTE;
  return regioes.map(r => {
    const de = primeira ? num(primeira[r.campo]) : null;
    const para = atual ? num(atual[r.campo]) : null;
    const temDado = para != null || de != null;
    const dif = (de != null && para != null) ? para - de : null;
    return {
      id: r.id, campo: r.campo, rotulo: r.rotulo, unidade: r.unidade, dobra: !!r.dobra,
      de, para, dif, temDado,
      tom: dif != null ? tomDaVariacao(r.campo, dif, objetivo) : (temDado ? 'igual' : 'sem-dado'),
    };
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
