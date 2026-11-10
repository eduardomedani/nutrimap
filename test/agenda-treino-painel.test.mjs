// ═══════════════════════════════════════════════════════════
// AGENDA DE TREINO — painel: gerador da grade e guardas da tela
// ═══════════════════════════════════════════════════════════

import { grupo, teste, igual, ok, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { montarGrade, ORDEM_DIAS, NOME_DIA } from '../js/agenda-treino-ui.js';

const ler = p => readFileSync(new URL(p, import.meta.url), 'utf8');

grupo('agenda painel · gerador da grade', () => {
  teste('segunda a domingo, segunda primeiro', () => {
    igual(ORDEM_DIAS.map(d => NOME_DIA[d]), ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']);
  });

  teste('06:00 às 22:00 de 60 min = 16 aulas por dia, a última começa 21:00', () => {
    const r = montarGrade({ dias: [1], de: '06:00', ate: '22:00', duracao: 60 });
    igual(r.length, 16);
    igual([r[0].hora_inicio, r.at(-1).hora_inicio], ['06:00', '21:00']);
  });

  teste('aula que não cabe inteira até o fim não entra', () => {
    const r = montarGrade({ dias: [6], de: '08:00', ate: '12:30', duracao: 60 });
    igual(r.map(x => x.hora_inicio), ['08:00', '09:00', '10:00', '11:00']);
  });

  teste('sábado e domingo podem entrar; dias saem na ordem Seg→Dom', () => {
    const r = montarGrade({ dias: [0, 6, 1], de: '08:00', ate: '10:00', duracao: 60 });
    igual([...new Set(r.map(x => x.dia_semana))], [1, 6, 0]);
  });

  teste('padrão de 9 vagas e Musculação', () => {
    const [x] = montarGrade({ dias: [2], de: '07:00', ate: '08:00' });
    igual([x.capacidade, x.modalidade, x.duracao_min], [9, 'Musculação', 60]);
  });

  teste('escolhas sem horário possível devolvem vazio', () => {
    igual(montarGrade({ dias: [], de: '06:00', ate: '22:00' }), []);
    igual(montarGrade({ dias: [1], de: '22:00', ate: '06:00' }), []);
    igual(montarGrade({ dias: [1], de: '06:00', ate: '06:30', duracao: 60 }), []);
  });
});

grupo('agenda painel · guardas', () => {
  teste('marcações só pelas funções do banco (nada direto em agenda_movimentos)', () => {
    const d = ler('../js/agenda-treino-data.js');
    contem(d, "sb.rpc('agenda_painel_semana'");
    contem(d, "sb.rpc('agenda_recepcao_reservar'");
    contem(d, "sb.rpc('agenda_recepcao_desmarcar'");
    igual(d.includes("from('agenda_movimentos')"), false);
  });

  teste('grade nunca é apagada pela tela (apagar levaria fixos e histórico junto)', () => {
    igual(/\.delete\(/.test(ler('../js/agenda-treino-data.js')), false);
  });

  teste('ligar para os alunos pede confirmação', () => {
    contem(ler('../js/agenda-treino-ui.js'), "titulo: 'Mostrar a agenda aos alunos'");
  });

  teste('o menu e a rota exigem agenda.visualizar', () => {
    const idx = ler('../index.html');
    contem(idx, 'data-page="agenda-treino" data-exige="agenda.visualizar" hidden');
    contem(idx, "'agenda-treino': 'agenda.visualizar',");
    contem(idx, '<div class="module-page" id="page-agenda-treino"></div>');
  });

  teste('CSS só com tokens', () => {
    const css = ler('../css/agenda-treino.css').replace(/\/\*[\s\S]*?\*\//g, '');
    igual(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), false);
  });
});

import { rotuloFixo, diferencaFixos, gradePorDia } from '../js/agenda-fixos-ui.js';

grupo('agenda · horários fixos no Comercial', () => {
  teste('rótulo curto do horário', () => {
    igual(rotuloFixo({ dia_semana: 2, hora_inicio: '18:00:00', modalidade: 'Musculação' }), 'Ter 18:00');
    igual(rotuloFixo({ dia_semana: 0, hora_inicio: '09:00', modalidade: 'Funcional' }), 'Dom 09:00 · Funcional');
  });

  teste('trocar Ter por Qua: apaga um, insere outro, mantém o resto', () => {
    igual(diferencaFixos(['ter', 'qui'], ['qua', 'qui']), { inserir: ['qua'], apagar: ['ter'] });
    igual(diferencaFixos(['ter'], ['ter']), { inserir: [], apagar: [] });
  });

  teste('grade de segunda a domingo, horas em ordem, dias vazios fora', () => {
    const r = gradePorDia([
      { id: 'a', dia_semana: 0, hora_inicio: '09:00' },
      { id: 'b', dia_semana: 1, hora_inicio: '18:00' },
      { id: 'c', dia_semana: 1, hora_inicio: '06:00' },
    ]);
    igual(r.map(d => [d.dia, d.lista.map(g => g.id)]), [[1, ['c', 'b']], [0, ['a']]]);
  });

  teste('grava apagando ANTES de inserir (senão a troca estoura a frequência no gatilho)', () => {
    const s = ler('../js/agenda-fixos-ui.js');
    const corpo = s.slice(s.indexOf('async function gravar'), s.indexOf('const frase'));
    ok(corpo.indexOf('.delete()') > 0 && corpo.indexOf('.delete()') < corpo.indexOf('.insert('));
  });

  teste('a tela não deixa marcar além da frequência do plano', () => {
    contem(ler('../js/agenda-fixos-ui.js'), "i.disabled = !i.checked && cheio;");
  });

  teste('o drawer do cliente monta a seção e falha sem derrubar o drawer', () => {
    const d = ler('../js/comercial-drawer.js');
    contem(d, '<div data-agenda-fixos></div>');
    contem(d, ".then(m => m.montarFixosNoDrawer(fundo, assinatura))");
    contem(d, ".catch(e => console.error('Comercial · horários na agenda:', e));");
  });
});
