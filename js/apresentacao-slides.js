// ═══════════════════════════════════════════════════════════
// MODO APRESENTAÇÃO — registro dos slides
// ═══════════════════════════════════════════════════════════
// A ordem deste array é a ordem da apresentação. Cada slide é um módulo com o
// mesmo contrato:
//
//   id           string  identificador estável (usado no DOM e nos testes)
//   titulo       string  nome no rodapé e no leitor de tela
//   disponivel(d)  bool  false → o slide NÃO entra no deck
//   html(d)      string  puro: monta a string, não toca no DOM
//   ligar(el,d,api)      opcional: cliques e campos
//   aoEntrar(el,d,api)   opcional: dispara as animações (já com layout válido)
//
// `disponivel` é o que cumpre a regra "quando faltar informação, ocultar o
// bloco": slide sem dado não vira placeholder, ele simplesmente não existe — e
// a numeração se ajusta sozinha.

import boasVindas   from './slides/apresentacao-01-boas-vindas.js';
import resumo       from './slides/apresentacao-02-resumo.js';
import composicao   from './slides/apresentacao-03-composicao.js';
import linhaDoTempo from './slides/apresentacao-04-linha-do-tempo.js';
import graficos     from './slides/apresentacao-05-graficos.js';
import corpo        from './slides/apresentacao-06-corpo.js';
import conquistas   from './slides/apresentacao-07-conquistas.js';
import objetivos    from './slides/apresentacao-08-objetivos.js';
import fechamento   from './slides/apresentacao-09-fechamento.js';

export const SLIDES = [
  boasVindas,
  resumo,
  composicao,
  linhaDoTempo,
  graficos,
  corpo,
  conquistas,
  objetivos,
  fechamento,
];

/** Só os slides que este paciente tem dado para preencher. */
export function slidesDisponiveis(d) {
  return SLIDES.filter(s => {
    try { return s.disponivel ? !!s.disponivel(d) : true; }
    catch (e) { console.error('[apresentacao] slide', s.id, e); return false; }
  });
}
