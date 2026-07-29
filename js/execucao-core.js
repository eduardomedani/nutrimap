// ═══════════════════════════════════════════════════════════
// EXECUÇÃO — regras puras compartilhadas (profissional ↔ aluno)
// ═══════════════════════════════════════════════════════════
// Sem DOM e sem rede: só interpretação da prescrição (descanso, cadência,
// RIR). Os dois lados leem daqui para que "90s" signifique exatamente a
// mesma coisa na tela do profissional e no cronômetro do aluno.

// ── DESCANSO ─────────────────────────────────────────────────
// O campo é texto livre desde sempre ("60s", "1min30", "2 min", "90").
// Aqui ele vira segundos; o que não der para entender volta null.
export function segDescanso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;

  const s = String(v).trim().toLowerCase().replace(',', '.');
  if (!s) return null;

  // "1:30" / "01:30"
  const rel = s.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (rel) return Number(rel[1]) * 60 + Number(rel[2]);

  // "1min30", "1 min 30s", "2min", "1m30", "1 minuto"
  // (?![a-z]) impede que "1m" engula o "s" de "90s" pelo caminho errado.
  const min = s.match(/^(\d+(?:\.\d+)?)\s*(?:min[a-z]*|m)(?![a-z])\s*(\d+)?/);
  if (min) {
    const seg = Math.round(Number(min[1]) * 60) + (min[2] ? Number(min[2]) : 0);
    return seg > 0 ? seg : null;
  }

  // "90s", "90 seg", "90"
  const num = s.match(/^(\d+(?:\.\d+)?)/);
  if (!num) return null;
  const n = Math.round(Number(num[0]));
  return n > 0 ? n : null;
}

// Relógio do cronômetro: 90 → "1:30"; 45 → "0:45".
export function fmtRelogio(seg) {
  const t = Math.max(0, Math.round(seg));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Por extenso, para textos de prescrição: 90 → "1 min 30 s"; 60 → "1 min".
export function fmtSegLongo(seg) {
  const t = Math.max(0, Math.round(Number(seg) || 0));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60), r = t % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

// Opções oferecidas ao profissional (o campo continua aceitando texto antigo).
export const DESCANSO_OPCOES = [30, 45, 60, 90, 120, 180];

/**
 * Descanso efetivo de um exercício, em segundos.
 *   entre = descanso do item → descanso padrão do treino → null
 *   final = descanso_final do item → o mesmo `entre`
 * `null` significa "não prescrito": o app do aluno não inventa cronômetro.
 */
export function descansoDoItem(item, treino) {
  const entre = segDescanso(item?.descanso) ?? segDescanso(treino?.descanso_padrao);
  const final = segDescanso(item?.descanso_final) ?? entre;
  return { entre, final };
}

// ── CADÊNCIA ─────────────────────────────────────────────────
// Preenchida = ligada. Vazia = o aluno não vê nada sobre cadência.
// Formato canônico: 4 fases "excêntrica-pausa-concêntrica-pausa" (3-1-2-0).
// Aceita 3 números (a pausa final vira 0) e "X" (explosivo ≈ 1 s).
const FASES = [
  { k: 'desc',  label: 'Descida',   vazio: 'Sem descida controlada', icone: 'arrow-down' },
  { k: 'pausa', label: 'Pausa',     vazio: 'Sem pausa embaixo',      icone: 'pause' },
  { k: 'sobe',  label: 'Subida',    vazio: 'Sem subida controlada',  icone: 'arrow-up' },
  { k: 'topo',  label: 'Pausa no topo', vazio: 'Sem pausa no topo',  icone: 'pause' },
];

export function parseCadencia(txt) {
  const s = String(txt ?? '').trim().toLowerCase();
  if (!s) return null;

  // "3-1-2-0", "3 1 2 0", "3/1/2/0" ou "3120" (compacto).
  let partes = s.split(/[^0-9x]+/).filter(Boolean);
  if (partes.length === 1 && /^[0-9x]{3,4}$/.test(partes[0])) partes = partes[0].split('');
  if (partes.length < 3 || partes.length > 4) return null;

  const seg = partes.map(p => (p === 'x' ? 1 : Number(p)));
  if (seg.some(n => !Number.isFinite(n) || n < 0 || n > 60)) return null;
  while (seg.length < 4) seg.push(0);
  if (!seg.some(n => n > 0)) return null;

  const fases = FASES.map((f, i) => ({ ...f, seg: seg[i], rapido: partes[i] === 'x' }));
  return {
    fases,
    tec: partes.map(p => (p === 'x' ? 'X' : p)).concat(partes.length < 4 ? ['0'] : []).slice(0, 4).join('-'),
    ciclo: seg.reduce((a, b) => a + b, 0),
  };
}

// Frase didática de uma fase: "Descida · 3 segundos" ou "Sem pausa no topo".
export function fraseFase(f) {
  if (!f.seg) return f.vazio;
  return `${f.label} · ${f.seg} ${f.seg === 1 ? 'segundo' : 'segundos'}`;
}

// ── RIR / ESFORÇO ────────────────────────────────────────────
export const RIR_MODOS = [
  { v: '',       label: 'Não perguntar' },
  { v: 'rir',    label: 'RIR (repetições na reserva)' },
  { v: 'escala', label: 'Escala subjetiva (muito leve → falha)' },
];

// Opções mostradas ao aluno. `v` é o que fica gravado no jsonb da série.
export const RIR_OPCOES = [
  { v: 4, label: '4' },
  { v: 3, label: '3' },
  { v: 2, label: '2' },
  { v: 1, label: '1' },
  { v: 0, label: '0' },
];
export const ESCALA_OPCOES = [
  { v: 4, label: 'Muito leve' },
  { v: 3, label: 'Leve' },
  { v: 2, label: 'Ideal' },
  { v: 1, label: 'Pesado' },
  { v: 0, label: 'Falha' },
];

// Como mostrar de volta o esforço registrado (resumo, histórico).
export function rotuloEsforco(valor, modo) {
  if (valor == null) return '';
  if (modo === 'escala') {
    return (ESCALA_OPCOES.find(o => o.v === Number(valor)) || {}).label || '';
  }
  const n = Number(valor);
  return n === 0 ? 'RIR 0 · falha' : `RIR ${n}`;
}
