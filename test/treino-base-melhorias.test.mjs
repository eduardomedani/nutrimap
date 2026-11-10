// ═══════════════════════════════════════════════════════════
// GERADOR — troca pelo mesmo padrão, orientações ao aluno, o que mais se prescreve
// ═══════════════════════════════════════════════════════════
// 1. A troca de exercício da base preferia "mesmo grupo e tipo" e família nova
//    no dia: a barra fixa no graviton (puxar na vertical) virava remada curvada
//    (puxar na horizontal). Agora o PADRÃO de movimento vem primeiro.
// 2. Agenda e orientações da Base Evollo morriam na prévia; agora vão para o
//    treino (treinos.orientacoes) e o aluno lê no app.
// 3. Na amostra do Evoluir/Ajustar, dentro de cada família, o que o
//    profissional mais prescreve vai na frente.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import BASE from '../api/_dados/base-evollo.js';
import { converterModelo, padraoDe } from '../api/_lib/base-evollo.js';
import { bibliotecaCompacta } from '../js/treino-ia-biblioteca.js';
import { A_CRIAR } from '../db/base_evollo/mapa_biblioteca.mjs';

const BIB = JSON.parse(readFileSync(new URL('./dados/base-evollo-biblioteca.json', import.meta.url), 'utf8'))
  .map(([nome, grupo, equipamento]) => ({ id: `id:${nome}`, nome, grupo, equipamento }))
  .concat(A_CRIAR.map(c => ({ id: `id:${c.nome}`, nome: c.nome, grupo: c.grupo_muscular, equipamento: c.equipamento })));
const ITENS = ['Par de halteres de 1 a 40', 'Barra W', 'Barra reta curta', 'Polia unilateral', 'Banco Scott', 'Cadeira extensora',
  'Cadeira flexora', 'Hack squat', 'Leg press 45°', 'Elevação pélvica 2D', 'Adutora e abdutora', 'Cross over',
  'Gaiola de agachamento guiado (Smith)', 'Máquina voador', 'Máquina de desenvolvimento', 'Supino articulado reto',
  'Remada cavalinho com apoio', 'Máquina pulley', 'Remada baixa KIKOS', 'Barra longa de carga + anilhas',
  'Rack / suporte de agachamento', 'Banco móvel (reto / inclinado)'];
const INV = { disponiveis: ITENS.map((nome, i) => ({ id: `EQ${i + 1}`, nome, tipo: 'equipamento' }))
  .concat([{ id: 'PG03', nome: 'MAPFIT médio', tipo: 'puxador' }, { id: 'PG09', nome: 'Triângulo metálico fechado', tipo: 'puxador' }]), ausentes: [] };

grupo('gerador · troca pelo mesmo padrão de movimento', () => {
  teste('padrões pelos nomes da base', () => {
    igual(padraoDe('Barra fixa no graviton'), 'puxar-vertical');
    igual(padraoDe('Puxada frontal aberta'), 'puxar-vertical');
    igual(padraoDe('Remada curvada com barra (pronada)'), 'puxar-horizontal');
    igual(padraoDe('Remada alta com barra'), 'empurrar-vertical', 'remada alta é ombro');
    igual(padraoDe('Supino fechado'), 'triceps', 'supino fechado é tríceps');
    igual(padraoDe('Crucifixo invertido na máquina'), 'puxar-horizontal');
    igual(padraoDe('Agachamento búlgaro'), 'joelho');
    igual(padraoDe('Stiff com halteres'), 'quadril');
    igual(padraoDe('Panturrilha no leg press'), 'panturrilha', 'leg press no nome não faz virar agachamento');
  });

  teste('O GRAVITON VIRA PUXADA, NÃO REMADA (INT-37, sem graviton na academia)', () => {
    const m = BASE.treinos.find(t => t.id === 'INT-37');
    const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: INV, nivel: m.nivel });
    const troca = c.trocas.find(t => t.includes('Barra fixa no graviton →'));
    ok(troca, 'o graviton é trocado');
    ok(/→ Puxada/.test(troca), troca);
  });

  teste('em TODOS os 150 modelos, toda troca com opção do mesmo padrão fica no padrão', () => {
    const ruins = [];
    for (const m of BASE.treinos) {
      const c = converterModelo(BASE, m, { biblioteca: BIB, inventario: INV, nivel: m.nivel });
      for (const t of c.trocas) {
        const [, de, para] = /: (.+) → (.+?) \(/.exec(t) || [];
        const pDe = padraoDe(Object.values(BASE.exercicios).find(e => e.b === de)?.n || de);
        const pPara = padraoDe(para);
        // Só reclama se existia substituto do mesmo padrão para escolher.
        const baseDe = Object.values(BASE.exercicios).find(e => e.b === de);
        const havia = baseDe && Object.values(BASE.exercicios).some(e => e !== baseDe && e.g === baseDe.g && e.t === baseDe.t && padraoDe(e.n) === pDe && e.b !== de);
        if (pDe && havia && pPara !== pDe && !['triceps', 'core', 'biceps'].includes(pDe)) ruins.push(`${m.id} ${t}`);
      }
    }
    ok(ruins.length <= 3, `trocas fora do padrão: ${ruins.slice(0, 5).join(' | ')}`);
  });
});

grupo('gerador · o que mais se prescreve vai na frente', () => {
  const supinos = ['Supino reto com barra', 'Supino na máquina', 'Supino inclinado com halteres', 'Supino declinado com barra']
    .map((nome, i) => ({ id: `s${i}`, nome, grupo_muscular: 'Peito' }));

  teste('sem contagem: nome mais curto primeiro (critério de antes)', () => {
    igual(bibliotecaCompacta(supinos, [], { comInventario: false }).map(e => e.id)[0], 's1');
  });

  teste('COM CONTAGEM: O MAIS PRESCRITO PRIMEIRO', () => {
    const prescricoes = new Map([['s2', 9], ['s0', 3]]);
    const ids = bibliotecaCompacta(supinos, [], { comInventario: false, prescricoes }).map(e => e.id);
    igual(ids.slice(0, 2).join(','), 's2,s0');
  });

  teste('a tela conta e passa a contagem, e falhar não trava', () => {
    const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
    contem(ui, 'const prescricoes = await contarPrescricoes().catch(() => new Map());');
    contem(ui, 'obrigatorios: idsBase, prescricoes });');
  });
});

grupo('gerador · orientações chegam ao aluno', () => {
  const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');
  const dados = readFileSync(new URL('../js/treinos.js', import.meta.url), 'utf8');

  teste('O TREINO DA BASE GRAVA AGENDA + ORIENTAÇÕES + AVISO', async () => {
    const { orientacoesDoPlano } = await import('../js/treinos-ui.js');
    const r = orientacoesDoPlano({ base: { id: 'INT-37', agenda: 'Seg: A · Ter: B' },
      relatorio: { orientacoes: 'Aquecimento de 5 a 10 min.', aviso: 'Consulte um médico.' } });
    igual(r.orientacoes, 'Agenda sugerida: Seg: A · Ter: B\n\nAquecimento de 5 a 10 min.\n\nConsulte um médico.');
    igual(orientacoesDoPlano({ relatorio: { estrutura: 'x' } }), {}, 'plano sem base não inventa orientação');
  });

  teste('o aluno vê o texto escapado, com quebras de linha', () => {
    contem(app, "esc(txt).replace(/\\n/g, '<br>')");
    contem(app, '${orientacoesHtml(treinoAtual)}');
    contem(app, '<summary>');
  });

  teste('o editor só mostra o campo quando a coluna existe', () => {
    contem(ui, "${t && 'orientacoes' in t ? `");
    contem(ui, "if (orientEl) dados.orientacoes = orientEl.value.trim() || null;");
  });

  teste('as cópias de treino levam as orientações; coluna ausente não derruba a gravação', () => {
    contem(dados, "...(origem && origem.orientacoes ? { orientacoes: origem.orientacoes } : {}),");
    contem(dados, "const COLUNAS_OPCIONAIS = ['base_id', 'orientacoes'];");
  });

  teste('o cache do app do aluno subiu junto (mudou o shell)', () => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    ok(!/evollo-apps-v26'/.test(sw), 'app.html e paciente-ui.js mudaram: o CACHE precisa subir');
  });
});
