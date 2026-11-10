// ═══════════════════════════════════════════════════════════
// VISÃO GERAL DO PACIENTE — redesenho de 10/11/2026
// ═══════════════════════════════════════════════════════════
// Protege: o caso real 98 kg / 99 kg de massa magra / −1% de gordura não vira
// número; "atual" nunca é medida antiga; ausência ≠ inválido; pendências num
// bloco só, em ordem; nada de "atrasado" sem prazo definido.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  situacaoDaAvaliacao, medidaValida, ultimaValida, avaliacoesARevisar, conferirResultados,
} from '../js/avaliacao-validacao.js';
import { montarResumo } from '../js/paciente-resumo.js';
import { alertasDoPaciente, ordenarPendencias } from '../js/paciente-alertas.js';
import { indicadoresDados, pontosValidos } from '../js/paciente-painel.js';

const ler = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const pac = { id: 'p1', nome: 'Ana', status: 'completo', criado_em: '2026-01-10' };
// O caso da imagem: 98 kg, massa magra 99 kg, gordura −1% (fração −0,01).
const AV_RUIM = { id: 'a3', numero: 3, data_avaliacao: '2026-10-20', peso: 98, pct_gordura: -0.01, peso_magro: 98.98, per_cintura: 90 };
const AV1 = { id: 'a1', numero: 1, data_avaliacao: '2026-06-01', peso: 102, pct_gordura: 0.28, peso_magro: 73.44, per_cintura: 96 };
const AV2 = { id: 'a2', numero: 2, data_avaliacao: '2026-08-15', peso: 100, pct_gordura: 0.26, peso_magro: 74, per_cintura: 94 };

grupo('visão geral · validação da avaliação', () => {
  teste('o caso real: gordura −1% e massa magra 99 kg > peso 98 kg são inválidos', () => {
    const s = situacaoDaAvaliacao(AV_RUIM);
    igual([s.peso, s.gordura, s.magra], ['ok', 'invalida', 'invalida']);
    ok(s.revisar);
    contem(s.problemas.join(' '), 'Gordura corporal impossível (-1%)');
  });
  teste('gordura ≥ 100% é inválida; 0 é ausência (sem protocolo), não erro', () => {
    igual(situacaoDaAvaliacao({ peso: 80, pct_gordura: 1.05 }).gordura, 'invalida');
    const zero = situacaoDaAvaliacao({ peso: 80, pct_gordura: 0, peso_magro: 80 });
    igual([zero.gordura, zero.magra, zero.revisar], ['ausente', 'ausente', false]);
  });
  teste('massa magra maior que o peso da MESMA avaliação é inconsistente', () => {
    const s = situacaoDaAvaliacao({ peso: 70, pct_gordura: 0.2, peso_magro: 72 });
    igual(s.magra, 'invalida');
    contem(s.problemas[0], 'Massa magra (72 kg) maior que o peso (70 kg)');
  });
  teste('a medida válida mais recente pula a avaliação ruim', () => {
    igual(ultimaValida([AV1, AV2, AV_RUIM], 'gordura').av.numero, 2);
    igual(ultimaValida([AV1, AV2, AV_RUIM], 'peso').av.numero, 3, 'o peso da AV3 é válido');
    igual(medidaValida(AV_RUIM, 'gordura'), null);
  });
  teste('a gravação recusa o resultado impossível, com a explicação', () => {
    contem(conferirResultados({ peso: 98 }, { pct_gordura: -0.01, peso_magro: 98.98 }), 'Confira as dobras');
    contem(conferirResultados({ peso: 70 }, { pct_gordura: 0.2, peso_magro: 72 }), 'maior que o peso');
    igual(conferirResultados({ peso: 80 }, { pct_gordura: 0.18, peso_magro: 65.6 }), null);
    igual(conferirResultados({ peso: 80 }, { pct_gordura: 0, peso_magro: 80 }), null, 'sem protocolo é permitido');
  });
  teste('criar e editar avaliação passam pela trava; a prévia avisa antes', () => {
    const av = ler('../js/avaliacoes.js');
    igual((av.match(/const problema = conferirResultados\(registro, resultados\);/g) || []).length, 2);
    contem(ler('../js/avaliacoes-ui.js'), 'const problema = conferirResultados(reg, r);');
  });
  teste('nada é corrigido nem apagado sozinho', () => {
    igual(/update|delete/i.test(ler('../js/avaliacao-validacao.js').replace(/\/\/.*$/gm, '')), false);
  });
});

grupo('visão geral · resumo com medidas válidas', () => {
  const r = montarResumo(pac, { avaliacoes: [AV_RUIM, AV2, AV1] });
  teste('gordura mostrada é a última VÁLIDA, com a avaliação de onde vem', () => {
    igual(r.metricas.gordura, 26);
    igual(r.metricas.avGordura.numero, 2);
    igual(r.metricas.massaMagra, null, 'a massa magra da AV3 é inválida');
  });
  teste('variação de peso entre avaliações diferentes, com o período', () => {
    igual(r.metricas.variacao, -4);
    igual([r.metricas.avPesoInicial.numero, r.metricas.avPeso.numero], [1, 3]);
  });
  teste('a avaliação ruim vira pendência "Revisar dados da avaliação"', () => {
    const a = alertasDoPaciente(r).find(x => x.tipo === 'ASSESSMENT_INVALID');
    ok(a, 'existe');
    contem(a.descricao, 'AV 3');
    igual(a.acao.aba, 'avaliacoes');
  });
  teste('"sem acompanhamento" conta o registro MAIS RECENTE, não o mais antigo', () => {
    // Plano de maio + avaliação recente: não é "nada registrado há 190 dias".
    const hoje = new Date(); const iso = d => d.toISOString().slice(0, 10);
    const recente = new Date(hoje.getTime() - 20 * 86400000);
    const r2 = montarResumo(pac, {
      avaliacoes: [{ ...AV1, data_avaliacao: iso(recente) }],
      planos: [{ id: 'pl', ativo: true, nome: 'P', data_inicio: iso(new Date(hoje.getTime() - 190 * 86400000)) }],
    });
    ok(r2.status.id !== 'parado', `status ${r2.status.id}`);
  });

  teste('uma avaliação só: sem comparativo (não zero)', () => {
    const r1 = montarResumo(pac, { avaliacoes: [AV1] });
    igual(r1.metricas.variacao, null);
    const i = indicadoresDados(r1).find(x => x.id === 'variacao');
    igual([i.val, i.vazio], [null, 'Sem comparativo']);
  });
  teste('sem avaliação: "Não registrado" em peso, variação e gordura', () => {
    const r0 = montarResumo(pac, { avaliacoes: [] });
    const ind = indicadoresDados(r0);
    for (const id of ['peso', 'variacao', 'gordura']) igual(ind.find(x => x.id === id).vazio, 'Não registrado', id);
    igual(ind.find(x => x.id === 'retorno').vazio, 'Não agendado');
  });
});

grupo('visão geral · os quatro indicadores', () => {
  const r = montarResumo(pac, { avaliacoes: [AV1, AV2, AV_RUIM] });
  const ind = indicadoresDados(r);
  teste('são quatro, nesta ordem', () => {
    igual(ind.map(i => i.id), ['peso', 'variacao', 'gordura', 'retorno']);
  });
  teste('cada número diz de qual avaliação e data vem — nada de "atual"', () => {
    igual(ind[0].rot, 'Último peso registrado');
    contem(ind[0].sub, 'AV 3 · 20/10/2026');
    contem(ind[1].sub, 'AV 1 (01/06/2026) → AV 3 (20/10/2026)');
    contem(ind[2].sub, 'AV 2 · 15/08/2026');
    naoContem(JSON.stringify(ind), 'atual');
  });
  teste('com dado inválido, o card de gordura oferece "Revisar dados da avaliação"', () => {
    ok(ind[2].revisar);
    const painel = ler('../js/paciente-painel.js');
    contem(painel, 'Revisar dados da avaliação</button>');
  });
  teste('massa magra e cintura não são cards principais', () => {
    naoContem(ind.map(i => i.rot).join(' '), 'Massa magra');
    naoContem(ind.map(i => i.rot).join(' '), 'Cintura');
  });
});

grupo('visão geral · evolução', () => {
  teste('o gráfico só usa medidas válidas', () => {
    igual(pontosValidos([AV1, AV2, AV_RUIM], 'gordura').map(p => p.av.numero), [1, 2]);
    igual(pontosValidos([AV1, AV2, AV_RUIM], 'peso').map(p => p.av.numero), [1, 2, 3]);
  });
  teste('uma medida: valor inicial e orientação, sem tendência', () => {
    const p = ler('../js/paciente-painel.js');
    contem(p, 'Registre uma nova avaliação para acompanhar a evolução.');
    contem(p, "pts.length === 1");
  });
  teste('reaproveita o gráfico que o projeto já tem (SVG da Evolução)', () => {
    contem(ler('../js/paciente-painel.js'), "import { svgLinha } from './evolucao-core.js';");
  });
});

grupo('visão geral · pendências', () => {
  teste('prioridade primeiro; dentro dela, o mais antigo primeiro', () => {
    const l = ordenarPendencias([
      { id: 'b', prioridade: 'atencao', desde: '2026-09-01' },
      { id: 'a', prioridade: 'importante', desde: '2026-10-01' },
      { id: 'c', prioridade: 'atencao', desde: '2026-05-01' },
      { id: 'd', prioridade: 'atencao' },
    ]);
    igual(l.map(x => x.id), ['a', 'c', 'b', 'd']);
  });
  teste('sem prazo de revisão, plano e avaliação são SUGESTÃO, não atraso', () => {
    const r = montarResumo(pac, {
      avaliacoes: [{ ...AV1, data_avaliacao: '2026-01-15' }],
      planos: [{ id: 'pl', ativo: true, nome: 'P', data_inicio: '2026-05-01' }],
    });
    const al = alertasDoPaciente(r);
    const t = al.map(a => a.titulo).join(' | ');
    contem(t, 'Revisão do plano sugerida');
    contem(t, 'Nova avaliação sugerida');
    naoContem(t, 'atrasad');
  });
  teste('com data de revisão definida, quem fala é "vencendo/vencido"', () => {
    const r = montarResumo(pac, { planos: [{ id: 'pl', ativo: true, nome: 'P', data_inicio: '2026-01-01', data_fim: '2026-02-01' }] });
    const al = alertasDoPaciente(r).map(a => a.titulo);
    ok(al.includes('Plano alimentar vencido'));
    ok(!al.includes('Revisão do plano sugerida'), 'não duplica com a sugestão');
  });
  teste('"Virar tarefa" é ação discreta e tarefas e alertas dividem a mesma fila', () => {
    const p = ler('../js/paciente-painel.js');
    contem(p, 'class="pv-link pv2-discreto" data-alerta-tarefa=');
    contem(p, 'const itens = ordenarPendencias([');
    contem(p, '<h3><i data-lucide="list-checks"></i> Pendências</h3>');
  });
});

grupo('visão geral · layout', () => {
  const css = ler('../css/paciente-visao.css');
  teste('duas colunas ≈65/35 no desktop, alinhadas no topo', () => {
    contem(css, 'grid-template-columns: minmax(0, 65fr) minmax(0, 35fr)');
    contem(css, 'align-items: start');
  });
  teste('celular (painel do profissional): uma coluna e pendências logo depois dos indicadores', () => {
    contem(css, '.pv2-principal, .pv2-lateral { display: contents; }');
    contem(css, '.pv2-o-pend   { order: 1; }');
    contem(css, '.pv2-o-evol   { order: 2; }');
  });
  teste('o score saiu da Visão geral e mora no cabeçalho, neutro (sem barra verde)', () => {
    const p = ler('../js/paciente-painel.js');
    naoContem(p, 'faixaSuperiorHtml(r)');
    naoContem(p, 'pv-score-bar');
    naoContem(p, 'scoreHtml(r)');
    const hub = ler('../js/paciente-hub.js');
    contem(hub, '<div class="hub-score" data-hub-score hidden></div>');
    // ordem no cabeçalho: serviços, score, menu ⋯
    ok(hub.indexOf('data-hub-servicos') < hub.indexOf('data-hub-score') && hub.indexOf('data-hub-score') < hub.indexOf('data-hub-menu'));
  });

  teste('card do score: número, faixa em texto e critérios num balão', async () => {
    const { scoreCabecalhoHtml } = await import('../js/paciente-hub.js');
    const h = scoreCabecalhoHtml({ valor: 40, base: 'Base.', criterios: [{ label: 'Avaliação em dia', nota: 0, detalhe: 'há 200 dias' }] });
    contem(h, '<b>40</b><small>/100</small> <span>· com itens em atraso</span>');
    contem(h, 'aria-controls="hubScoreCriterios"');
    contem(h, 'Avaliação em dia');
    contem(scoreCabecalhoHtml({ valor: 85, criterios: [] }), '· em dia');
    contem(scoreCabecalhoHtml({ valor: null, motivo: 'Dados insuficientes para calcular' }), 'Dados insuficientes');
  });

  teste('serviços empilhados em coluna no cabeçalho', () => {
    const c = ler('../css/paciente-servicos.css');
    contem(c, '.hub-servicos { display: flex; flex-direction: column;');
  });
  teste('CSS só com tokens', () => {
    igual(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  });
});
