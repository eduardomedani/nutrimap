// ═══════════════════════════════════════════════════════════
// GERA api/_dados/base-evollo.js A PARTIR DA BASE DE TREINOS EVOLLO
// ═══════════════════════════════════════════════════════════
// Uso:  node db/base_evollo/gerar.mjs "<caminho>/evollo_base_treinos.json"
//
// A base original (1,9 MB) repete nome/grupo/tipo/equipamento em cada uma das
// ~3.800 linhas de exercício dos 150 treinos. O módulo gerado guarda isso UMA
// vez (em `exercicios`) e cada linha de treino vira uma tupla curta. Junto vai
// `b`: o nome do exercício na biblioteca (db/base_evollo/mapa_biblioteca.mjs).
//
// Fica em api/_dados (o "_" impede a Vercel de tratar como rota) para a base
// não ser servida como arquivo estático do site.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAPA, nomeNaBiblioteca } from './mapa_biblioteca.mjs';

const origem = process.argv[2];
if (!origem) { console.error('informe o caminho do evollo_base_treinos.json'); process.exit(1); }
const base = JSON.parse(readFileSync(origem, 'utf8'));

const NIVEL = { 1: 1, 2: 2, 3: 3 };
const exercicios = {};
for (const e of base.exercicios) {
  const b = nomeNaBiblioteca(e.id);
  if (!b) throw new Error(`exercício ${e.id} (${e.nome}) sem mapeamento para a biblioteca`);
  exercicios[e.id] = { n: e.nome, g: e.grupo, t: e.tipo === 'C' ? 'C' : 'I', nm: NIVEL[e.nivel_minimo] || 1, eq: e.equipamento, b };
}
exercicios.CARDIO = { n: 'Cardio moderado (esteira, bike ou elíptico)', g: 'Cardio', t: 'I', nm: 1, eq: 'Esteira/Bike/Elíptico', b: nomeNaBiblioteca('CARDIO') };

const sobrando = Object.keys(MAPA).filter(id => !exercicios[id]);
if (sobrando.length) throw new Error(`mapa tem ids que não estão na base: ${sobrando.join(', ')}`);

const treinos = base.treinos.map(t => ({
  id: t.id, nivel: t.nivel, nome: t.nome, divisao: t.divisao, modelo: t.modelo_divisao, objetivo: t.objetivo,
  enfase: t.enfase, freq: t.frequencia_semanal, agenda: t.agenda_sugerida, duracao: t.duracao_media_min,
  descricao: t.descricao,
  dias: t.dias.map(d => ({
    l: d.letra, nome: d.nome, grupos: d.grupos, dur: d.duracao_estimada_min,
    // [exercicio_id, series, repeticoes, descanso_seg, tecnica, observacao]
    ex: d.exercicios.map(e => {
      if (!exercicios[e.exercicio_id]) throw new Error(`${t.id}/${d.letra}: exercício ${e.exercicio_id} fora da biblioteca da base`);
      return [e.exercicio_id, e.series, e.repeticoes, e.descanso_seg, e.tecnica || '', e.observacao || ''];
    }),
  })),
}));

const saida = {
  nome: base.nome, versao: base.versao, gerado_em: base.gerado_em, observacoes: base.observacoes,
  exercicios, treinos,
};

const destino = fileURLToPath(new URL('../../api/_dados/base-evollo.js', import.meta.url));
writeFileSync(destino,
  `// GERADO por db/base_evollo/gerar.mjs a partir de evollo_base_treinos.json — não editar à mão.\n` +
  `// ${treinos.length} treinos-modelo, ${Object.keys(exercicios).length} exercícios. Base: ${base.nome} v${base.versao} (${base.gerado_em}).\n` +
  `export default ${JSON.stringify(saida)};\n`);
console.log(`gerado ${destino}: ${treinos.length} treinos, ${Object.keys(exercicios).length} exercícios`);
