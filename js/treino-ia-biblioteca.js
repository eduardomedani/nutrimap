// ═══════════════════════════════════════════════════════════
// QUAIS EXERCÍCIOS DA BIBLIOTECA A IA RECEBE — e famílias de movimento
// ═══════════════════════════════════════════════════════════
// Puro: usado pela tela (amostra enviada) e pelo servidor (api/gerar-treino.js,
// para conferir repetição no dia).
//
// O ERRO QUE ISTO CORRIGE. A amostra pegava os N PRIMEIROS de cada grupo em
// ordem ALFABÉTICA. Em Peito: Crossover… Crucifixo… Flexão… — e os Supinos,
// que vêm depois no alfabeto, ficavam de fora (5 de 25 chegavam; como grupo
// secundário, nenhum). A IA montava dia de peito só com crucifixo porque era
// o que existia na lista que ela viu.
//
// AGORA: dentro de cada grupo, os exercícios são separados por FAMÍLIA de
// movimento e escolhidos em rodízio — um de cada família, depois o segundo de
// cada… — começando pelo nome mais curto (o mais "canônico": "Supino reto com
// barra" antes de "Supino fechado declinado com tríceps testa").

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

// Palavras que sozinhas não dizem o movimento: a família leva a próxima palavra
// que significa algo ("elevacao lateral" ≠ "elevacao frontal").
const GENERICAS = new Set(['elevacao', 'cadeira', 'extensao', 'mesa', 'levantamento', 'rosca']);
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'na', 'no', 'em', 'e', 'a', 'o', 'para', 'por']);
// Sinônimos de família: o mesmo movimento com nomes diferentes.
const SINONIMOS = { crossover: 'crucifixo', voador: 'crucifixo', pulley: 'puxada', pulldown: 'pulldown' };

/** Família de movimento pelo nome: "supino", "crucifixo", "elevacao lateral", "rosca martelo"… */
export function familiaDe(nome) {
  const n = norm(nome);
  // "Flexão" é a flexão de braço em todas as variações (aberta, declinada…);
  // as de perna/quadril/posterior/lateral são outros movimentos.
  const flex = /^flexao (de )?(perna|pernas|quadril|posterior|lateral)/.exec(n);
  if (flex) return `flexao ${flex[2]}`;
  const palavras = n.split(' ').filter(p => p && !VAZIAS.has(p));
  if (!palavras.length) return '';
  const p1 = SINONIMOS[palavras[0]] || palavras[0];
  if (!GENERICAS.has(p1)) return p1;
  const p2 = palavras[1] || '';
  return p2 ? `${p1} ${SINONIMOS[p2] || p2}` : p1;
}

// COMO AS VAGAS DE UM GRUPO SÃO DIVIDIDAS
// Um rodízio "um de cada família" dava a mesma vaga a uma família de 25
// supinos e a um "Svend press" solitário — Peito recebia 2 supinos em 15.
// Agora é proporcional (método D'Hondt, o das vagas por votos):
//   · peso da família = nº de exercícios dela que cabem na academia,
//     em DOBRO se for composto (o que estrutura o treino);
//   · nenhuma família passa de TETO_FAMILIA das vagas (variedade);
//   · mobilidade/alongamento/isometria não disputam vaga: só entram se sobrar.
const COMPOSTOS = /^(supino|puxada|remada|agachamento|leg|hack|desenvolvimento|levantamento|stiff|afundo|barra|paralelas|mergulho|elevacao pelvica|bom)/;
const MOBILIDADE = /alongamento|liberacao|isometric|^circulos|^postura|^o maior|^abraco|^joelho|^um joelho|^cotovelos|^limpadores/;
const TETO_FAMILIA = 0.4;

const porNomeCurto = (a, b) => String(a.nome).length - String(b.nome).length || String(a.nome).localeCompare(String(b.nome));

// Dentro da família: primeiro o que o profissional MAIS PRESCREVE; entre os
// que ele nunca usou (ou empatados), o nome mais curto — o mais "canônico".
// Sem contagem, é o critério de antes.
const porUsoDepoisNome = prescricoes => (a, b) =>
  (prescricoes.get(b.id) || 0) - (prescricoes.get(a.id) || 0) || porNomeCurto(a, b);

function amostraVariada(exs, teto, prescricoes = new Map()) {
  const ordem = porUsoDepoisNome(prescricoes);
  const mobilidade = exs.filter(e => MOBILIDADE.test(norm(e.nome)));
  const forca = exs.filter(e => !MOBILIDADE.test(norm(e.nome)));

  const familias = new Map();
  for (const e of forca) {
    const f = familiaDe(e.nome);
    if (!familias.has(f)) familias.set(f, []);
    familias.get(f).push(e);
  }
  const lista = [...familias.entries()].map(([f, l]) => ({
    f, fila: l.sort(ordem), peso: l.length * (COMPOSTOS.test(f) ? 2 : 1), vagas: 0,
  }));
  const maxPorFamilia = Math.max(1, Math.ceil(teto * TETO_FAMILIA));

  const out = [];
  while (out.length < teto) {
    // D'Hondt: a próxima vaga vai para quem tem o maior peso/(vagas+1).
    let melhor = null;
    for (const x of lista) {
      if (x.vagas >= x.fila.length || x.vagas >= maxPorFamilia) continue;
      const q = x.peso / (x.vagas + 1);
      if (!melhor || q > melhor.q || (q === melhor.q && x.f < melhor.x.f)) melhor = { x, q };
    }
    if (!melhor) break;
    out.push(melhor.x.fila[melhor.x.vagas++]);
  }
  // Sobrou vaga (grupo pequeno)? Primeiro o resto das famílias além do teto
  // por família; por último, mobilidade.
  for (const x of lista) while (out.length < teto && x.vagas < x.fila.length) out.push(x.fila[x.vagas++]);
  for (const e of mobilidade.sort(ordem)) if (out.length < teto) out.push(e);
  return out;
}

/**
 * A lista enviada à IA. `obrigatorios` (ids do treino atual, no Evoluir/
 * Ajustar) entram sempre — a IA precisa poder MANTER o que está funcionando.
 * `prescricoes` (Map id → vezes que aparece nos treinos do profissional) põe
 * na frente, dentro de cada família, o que ele de fato usa.
 */
export function bibliotecaCompacta(todos, gruposAlvo, { comInventario = false, obrigatorios = [], prescricoes = new Map() } = {}) {
  const alvo = new Set((gruposAlvo || []).map(g => String(g).toLowerCase()));
  const ids = new Set(obrigatorios);
  const enxuto = e => ({ id: e.id, nome: e.nome, grupo: e.grupo_muscular || '', equipamento: e.equipamento || '' });

  const fixos = todos.filter(e => ids.has(e.id));
  const porGrupo = {};
  todos.filter(e => !ids.has(e.id)).forEach(e => { (porGrupo[e.grupo_muscular || 'outros'] ||= []).push(e); });

  const out = fixos.map(enxuto);
  for (const [g, exs] of Object.entries(porGrupo)) {
    const teto = alvo.has(g.toLowerCase()) ? (comInventario ? 40 : 25) : (comInventario ? 15 : 10);
    amostraVariada(exs, teto, prescricoes).forEach(e => out.push(enxuto(e)));
  }
  return out.slice(0, comInventario ? 320 : 180);
}
