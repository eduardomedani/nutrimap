// ═══════════════════════════════════════════════════════════
// TREINO — recolher e arrastar exercícios no editor
// ═══════════════════════════════════════════════════════════
// Arrastar grava a `ordem` no banco, e o aluno vê o treino nessa ordem. O que
// estes testes travam:
//
//   O DESLOCAMENTO. Tirar o bloco da lista puxa os de baixo uma posição; errar
//   isso põe o exercício um lugar abaixo de onde foi solto.
//
//   GRAVAR SÓ QUEM MUDOU, numerando do zero — que é o que desfaz empates de
//   ordem herdados de cópias e da IA.

import { grupo, teste, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { reordenarBlocos } from '../js/treinos.js';

const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');
const blocos = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, ordem: i }));
const aplicar = (lista, mudancas) => {
  const nova = new Map(mudancas.map(m => [m.id, m.ordem]));
  return lista.map(b => ({ ...b, ordem: nova.has(b.id) ? nova.get(b.id) : b.ordem }))
    .sort((x, y) => x.ordem - y.ordem).map(b => b.id).join('');
};

grupo('treino · arrastar exercício', () => {
  teste('descer o primeiro para o fim', () => {
    igual(aplicar(blocos, reordenarBlocos(blocos, 0, 3)), 'bcda');
  });

  teste('subir o último para o topo', () => {
    igual(aplicar(blocos, reordenarBlocos(blocos, 3, 0)), 'dabc');
  });

  teste('trocar vizinhos grava só os dois', () => {
    const m = reordenarBlocos(blocos, 1, 2);
    igual(m, [{ id: 'c', ordem: 1 }, { id: 'b', ordem: 2 }]);
  });

  teste('soltar no mesmo lugar não grava nada', () => {
    igual(reordenarBlocos(blocos, 2, 2), []);
    igual(reordenarBlocos(blocos, 0, 9), [], 'destino fora da lista é ignorado');
  });

  teste('empate de ordem herdado é desfeito', () => {
    // Dois itens com ordem 0 trocariam de lugar a cada recarga.
    const empatados = [{ id: 'a', ordem: 0 }, { id: 'b', ordem: 0 }, { id: 'c', ordem: 0 }];
    igual(aplicar(empatados, reordenarBlocos(empatados, 2, 0)), 'cab');
  });
});

grupo('treino · editor recolhível', () => {
  teste('o arrasto começa pela alça, não pelo card', () => {
    // Card inteiro arrastável transforma selecionar texto de um campo em
    // arrastar o exercício.
    contem(ui, "card.querySelector('[data-ex-alca]')");
    naoContem(ui, 'tr-ex-card" draggable="true"');
  });

  teste('as setas continuam — o arrasto nativo não funciona no toque', () => {
    contem(ui, 'data-item-up="${it.id}"');
    contem(ui, 'data-item-up="${a.id}"');
  });

  teste('exercício e Bi-set recolhem pelo mesmo estado', () => {
    contem(ui, 'const recolhido = _recolhidos.has(it.id);');
    contem(ui, 'const recolhido = _recolhidos.has(a.id);');
    naoContem(ui, '_bisetRecolhidos');
  });
});
