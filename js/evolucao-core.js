// ═══════════════════════════════════════════════════════════
// EVOLUÇÃO — núcleo compartilhado (aba Evolução ↔ Modo Apresentação)
// ═══════════════════════════════════════════════════════════
// Tudo que as duas telas precisam falar igual: quais indicadores existem, como
// virar ponto de gráfico, como desenhar a linha e — o mais importante — como
// ler uma variação.
//
// A leitura de "melhorou/piorou" respeita o OBJETIVO do plano ativo: perder
// massa magra não é vitória em emagrecimento, e perder peso não é vitória em
// hipertrofia. Sem objetivo declarado, mostra a direção sem julgar. Essa regra
// mora aqui e em lugar nenhum mais — se a aba e a apresentação discordassem
// sobre o que é uma boa notícia, o paciente ouviria as duas versões.
//
// Sem biblioteca de gráfico: SVG inline, uma série por vez (misturar kg e % no
// mesmo eixo mente sobre a escala).

// ── Catálogo de séries ──────────────────────────────────────
// `campo` é a coluna da avaliação; `escala` converte para a unidade exibida
// (pct_gordura vem como fração); `meta` liga a série a um tipo de meta.
export const SERIES = {
  peso:        { label: 'Peso',            campo: 'peso',         unidade: 'kg', escala: 1,   meta: 'peso' },
  gordura:     { label: '% de gordura',    campo: 'pct_gordura',  unidade: '%',  escala: 100, meta: 'gordura' },
  massa_magra: { label: 'Massa magra',     campo: 'peso_magro',   unidade: 'kg', escala: 1,   meta: 'massa_magra' },
  cintura:     { label: 'Cintura',         campo: 'per_cintura',  unidade: 'cm', escala: 1,   meta: 'cintura' },
  imc:         { label: 'IMC',             campo: 'imc',          unidade: '',   escala: 1,   meta: null },

  // Séries extras — só a apresentação usa (a aba Evolução mantém as 5 acima).
  massa_gorda: { label: 'Massa gorda',     campo: 'peso_gordura', unidade: 'kg', escala: 1,   meta: null },
  abdomen:     { label: 'Abdômen',         campo: 'per_abdomen',  unidade: 'cm', escala: 1,   meta: null },
  quadril:     { label: 'Quadril',         campo: 'per_quadril',  unidade: 'cm', escala: 1,   meta: null },
  braco:       { label: 'Braço D',         campo: 'per_braco_direito',       unidade: 'cm', escala: 1, meta: null },
  coxa:        { label: 'Coxa D',          campo: 'per_coxa_direita',        unidade: 'cm', escala: 1, meta: null },
  panturrilha: { label: 'Panturrilha D',   campo: 'per_panturrilha_direita', unidade: 'cm', escala: 1, meta: null },
  dobra_abd:   { label: 'Dobra abdominal', campo: 'dc_abdominal', unidade: 'mm', escala: 1,   meta: null },
  dobra_supra: { label: 'Dobra supra-ilíaca', campo: 'dc_supra_iliaca', unidade: 'mm', escala: 1, meta: null },
  dobra_tri:   { label: 'Dobra tricipital',   campo: 'dc_tricipital',   unidade: 'mm', escala: 1, meta: null },
};

// As séries que a aba Evolução mostra. Ficou explícito para que somar uma
// série nova ao catálogo não mude aquela tela sem alguém decidir.
export const SERIES_ABA = ['peso', 'gordura', 'massa_magra', 'cintura', 'imc'];

export const PERIODOS = [
  { id: 30,  label: '30 dias' },
  { id: 90,  label: '90 dias' },
  { id: 180, label: '6 meses' },
  { id: 365, label: '1 ano' },
  { id: 0,   label: 'Tudo' },
];

// Indicadores da comparação, na ordem clínica de leitura.
export const COMPARAR = [
  { campo: 'peso',                     label: 'Peso',            unidade: 'kg', escala: 1 },
  { campo: 'imc',                      label: 'IMC',             unidade: '',   escala: 1 },
  { campo: 'pct_gordura',              label: '% de gordura',    unidade: '%',  escala: 100 },
  { campo: 'peso_gordura',             label: 'Massa gorda',     unidade: 'kg', escala: 1 },
  { campo: 'peso_magro',               label: 'Massa magra',     unidade: 'kg', escala: 1 },
  { campo: 'per_cintura',              label: 'Cintura',         unidade: 'cm', escala: 1 },
  { campo: 'per_abdomen',              label: 'Abdômen',         unidade: 'cm', escala: 1 },
  { campo: 'per_quadril',              label: 'Quadril',         unidade: 'cm', escala: 1 },
  { campo: 'per_braco_direito',        label: 'Braço D',         unidade: 'cm', escala: 1 },
  { campo: 'per_coxa_direita',         label: 'Coxa D',          unidade: 'cm', escala: 1 },
  { campo: 'per_panturrilha_direita',  label: 'Panturrilha D',   unidade: 'cm', escala: 1 },
];

// ── Helpers numéricos e de data ─────────────────────────────
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmt(v, casas = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

export function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T12:00:00` : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
}

/** Data de uma avaliação como Date (meio-dia, para não escorregar de fuso). */
export function dataDaAvaliacao(av) {
  if (!av?.data_avaliacao) return null;
  const dt = new Date(`${av.data_avaliacao}T12:00:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Dias entre duas datas (string ISO ou Date), arredondado. */
export function diasEntre(de, ate) {
  // new Date(null) é 01/01/1970, não data inválida — sem esta guarda, uma
  // avaliação sem data viraria "20.659 dias juntos" na tela do paciente.
  const paraData = (v) => {
    if (v instanceof Date) return v;
    if (v == null || v === '') return null;
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00` : v);
  };
  const a = paraData(de), b = paraData(ate);
  if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

// ── Pontos de uma série ─────────────────────────────────────
/**
 * Converte as avaliações nos pontos de uma série, já na unidade de exibição.
 * `periodoDias` = 0 significa todo o período.
 */
export function pontosDaSerie(avaliacoes, serieId, periodoDias = 0) {
  const cfg = SERIES[serieId];
  if (!cfg) return [];
  const limite = periodoDias ? Date.now() - periodoDias * 86400000 : null;
  return (avaliacoes || [])
    .filter(a => a.data_avaliacao && num(a[cfg.campo]) != null)
    .map(a => ({ data: new Date(`${a.data_avaliacao}T12:00:00`), valor: num(a[cfg.campo]) * cfg.escala, av: a }))
    .filter(p => !limite || p.data.getTime() >= limite)
    .sort((a, b) => a.data - b.data);
}

/** Início dos planos alimentares no período — marca vertical no gráfico. */
export function marcosDePlano(planos, periodoDias = 0) {
  const limite = periodoDias ? Date.now() - periodoDias * 86400000 : null;
  return (planos || [])
    .map(p => ({ data: new Date(p.data_inicio ? `${p.data_inicio}T12:00:00` : p.criado_em), nome: p.nome }))
    .filter(m => !isNaN(m.data.getTime()) && (!limite || m.data.getTime() >= limite));
}

// ── Gráfico de linha ────────────────────────────────────────
/**
 * SVG puro, sem dependência. `rotulo` é o texto do aria-label — vem de fora
 * porque o mesmo desenho serve à aba e à apresentação, que nomeiam a série de
 * jeitos diferentes.
 */
export function svgLinha(pontos, { unidade = '', meta = null, marcos = [], largura = 640, altura = 210, rotulo = 'Evolução' } = {}) {
  if (!pontos || pontos.length < 2) return '';
  const W = largura, H = altura, ml = 46, mr = 16, mt = 16, mb = 28;
  const vals = pontos.map(p => p.valor);
  if (meta != null) vals.push(meta);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const folga = (max - min) * 0.12;
  min -= folga; max += folga;

  // O eixo vai até HOJE, não até a última medida: assim o intervalo sem
  // avaliação fica visível (a linha simplesmente para no meio) e as mudanças
  // de plano recentes cabem no gráfico.
  const t0 = pontos[0].data.getTime();
  const t1 = Math.max(pontos[pontos.length - 1].data.getTime(), Date.now());
  const x = (d) => ml + (t1 === t0 ? 0.5 : (Math.min(Math.max(d.getTime(), t0), t1) - t0) / (t1 - t0)) * (W - ml - mr);
  const y = (v) => mt + (1 - (v - min) / (max - min)) * (H - mt - mb);

  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p.data).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const area = `${linha} L${x(pontos[pontos.length - 1].data).toFixed(1)},${H - mb} L${x(pontos[0].data).toFixed(1)},${H - mb} Z`;

  const marcasY = [max - folga, (min + max) / 2, min + folga].map(v => `
    <line x1="${ml}" y1="${y(v).toFixed(1)}" x2="${W - mr}" y2="${y(v).toFixed(1)}" class="ev-grade"/>
    <text x="${ml - 7}" y="${(y(v) + 3.5).toFixed(1)}" class="ev-eixo" text-anchor="end">${fmt(v)}</text>`).join('');

  const linhaMeta = meta != null ? `
    <line x1="${ml}" y1="${y(meta).toFixed(1)}" x2="${W - mr}" y2="${y(meta).toFixed(1)}" class="ev-meta-linha"/>
    <text x="${W - mr}" y="${(y(meta) - 6).toFixed(1)}" class="ev-meta-txt" text-anchor="end">meta ${fmt(meta)}${unidade}</text>` : '';

  const linhasMarco = (marcos || []).map(m => {
    const px = x(m.data);
    if (px < ml || px > W - mr) return '';
    return `<line x1="${px.toFixed(1)}" y1="${mt}" x2="${px.toFixed(1)}" y2="${H - mb}" class="ev-marco">
              <title>Plano: ${esc(m.nome || 'sem nome')} · ${m.data.toLocaleDateString('pt-BR')}</title></line>`;
  }).join('');

  const bolinhas = pontos.map(p => `
    <circle cx="${x(p.data).toFixed(1)}" cy="${y(p.valor).toFixed(1)}" r="3.5" class="ev-ponto">
      <title>${p.data.toLocaleDateString('pt-BR')} · ${fmt(p.valor)}${unidade}${p.av?.numero ? ` (AV ${p.av.numero})` : ''}</title>
    </circle>`).join('');

  const datas = `
    <text x="${ml}" y="${H - 8}" class="ev-eixo">${pontos[0].data.toLocaleDateString('pt-BR')}</text>
    <text x="${W - mr}" y="${H - 8}" class="ev-eixo" text-anchor="end">${new Date(t1).toLocaleDateString('pt-BR')}</text>`;

  return `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="ev-svg" role="img"
         aria-label="Evolução de ${esc(rotulo)} em ${pontos.length} medidas">
      ${marcasY}${linhasMarco}
      <path d="${area}" class="ev-area"/>
      <path d="${linha}" class="ev-linha"/>
      ${linhaMeta}${bolinhas}${datas}
    </svg>`;
}

// ── A regra: isso é uma boa notícia? ────────────────────────
// O objetivo é texto livre no plano (com chips de sugestão), então a leitura
// começa normalizando: "Definição" tem cedilha e nunca casaria com /definic/.
const semAcento = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * O objetivo do plano aponta uma DIREÇÃO para os indicadores?
 *
 * Dos seis objetivos sugeridos, só dois apontam: Emagrecimento e Hipertrofia.
 * Manutenção, Recomposição, Performance e Saúde não dizem se subir é bom — e
 * essa diferença é o que separa descrever de julgar. Antes, quem consultava
 * apenas `objetivo != null` tratava "Manutenção" como se houvesse direção, e
 * então nenhuma variação virava conquista.
 *
 * @returns {'emagrecer'|'ganhar'|null}
 */
export function objetivoDirigido(objetivo) {
  const o = semAcento(objetivo);
  if (!o) return null;
  if (/emagre|perda|redu|gordura|definic/.test(o)) return 'emagrecer';
  if (/hipertrof|ganho|massa|volume/.test(o)) return 'ganhar';
  return null;
}

/**
 * Uma queda não é boa por si só: depende do objetivo do plano ativo.
 * Devolve { tom: 'bom' | 'atencao' | '' } — vazio = sem julgamento.
 */
export function interpretar(campo, dif, objetivo) {
  if (dif == null || Math.abs(dif) < 0.05) return { tom: '' };
  const direcao = objetivoDirigido(objetivo);
  if (!direcao) return { tom: '' };
  const emagrecer = direcao === 'emagrecer';

  const desce = dif < 0;
  if (campo === 'peso_magro') return { tom: desce ? 'atencao' : 'bom' };
  if (campo === 'pct_gordura' || campo === 'peso_gordura') return { tom: desce ? 'bom' : 'atencao' };
  if (campo.startsWith('dc_')) return { tom: desce ? 'bom' : 'atencao' };   // dobra é gordura local
  if (campo.startsWith('per_')) {
    if (emagrecer) return { tom: desce ? 'bom' : 'atencao' };
    return { tom: '' };            // em hipertrofia, medida maior pode ser músculo
  }
  if (campo === 'peso' || campo === 'imc') {
    if (emagrecer) return { tom: desce ? 'bom' : 'atencao' };
    return { tom: desce ? 'atencao' : 'bom' };
  }
  return { tom: '' };
}

/**
 * Cor de uma variação, na convenção da apresentação:
 *   reduziu → verde · aumentou → azul · piorou (pelo objetivo) → âmbar.
 * Nunca vermelho: esta tela é vista pelo paciente.
 */
export function tomDaVariacao(campo, dif, objetivo) {
  if (dif == null || Math.abs(dif) < 0.05) return 'igual';
  const { tom } = interpretar(campo, dif, objetivo);
  if (tom === 'atencao') return 'atencao';
  if (tom === 'bom') return 'bom';
  return dif < 0 ? 'bom' : 'subiu';     // sem objetivo: descreve a direção
}
