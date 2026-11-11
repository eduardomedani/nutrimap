// ═══════════════════════════════════════════════════════════
// SERVIÇOS CONTRATADOS — Alimentação, Treino, Academia
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: o aluno vê só o que contratou; o que não
// contratou de Treino e Alimentação vira oferta; sem definição, nada muda.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { contratou, normalizarServicos, rotuloServicos, SERVICOS } from '../js/servicos.js';
import { inicioHtml } from '../js/pwa-inicio-ui.js';
import { servicosHtml } from '../js/paciente-servicos-ui.js';

const ler = p => readFileSync(new URL(p, import.meta.url), 'utf8');

grupo('serviços · a regra', () => {
  teste('sem definição (null), tudo vale — ninguém perde tela', () => {
    for (const s of ['alimentacao', 'treino', 'academia']) ok(contratou(null, s), s);
    ok(contratou(undefined, 'treino'));
  });
  teste('definido, vale só o marcado; lista vazia = nada', () => {
    igual(contratou(['alimentacao'], 'treino'), false);
    igual(contratou(['treino', 'academia'], 'academia'), true);
    igual(contratou([], 'alimentacao'), false);
  });
  teste('normaliza: sem repetição, sem lixo, na ordem oficial', () => {
    igual(normalizarServicos(['academia', 'treino', 'treino', 'xpto']), ['treino', 'academia']);
    igual(SERVICOS.map(s => s.id), ['alimentacao', 'treino', 'academia']);
  });
  teste('rótulo para a ficha', () => {
    igual(rotuloServicos(null), 'Não definido');
    igual(rotuloServicos([]), 'Nenhum serviço');
    igual(rotuloServicos(['academia', 'treino']), 'Treino + Academia');
  });
});

grupo('serviços · o Início do aluno', () => {
  const base = {
    hoje: '2026-11-10', treino: { dia: 'A', feito: false }, temTreino: true,
    dieta: { nome: 'Plano', refeicoes: 3, proxima: null },
    agenda: { aula: null, podeAgendar: true },
    plano: { ativo: true, plano: 'Mensal 3x', fim: '2026-12-10', feitas: 1, disponiveis: 2 },
  };
  teste('academia (Treino + Academia): sem dieta, com a oferta da dieta', () => {
    const h = inicioHtml({ ...base, servicos: ['treino', 'academia'] });
    contem(h, 'Treino de hoje');
    contem(h, 'Sua semana');
    contem(h, 'Próxima aula');
    contem(h, 'Meu plano');
    naoContem(h, 'Sua alimentação');
    contem(h, 'data-oferta="alimentacao"');
    naoContem(h, 'data-oferta="treino"');
  });
  teste('nutricionista (só Alimentação): sem treino, sem semana, sem academia; oferta do treino', () => {
    const h = inicioHtml({ ...base, servicos: ['alimentacao'] });
    contem(h, 'Sua alimentação');
    for (const fora of ['Treino de hoje', 'Sua semana', 'Próxima aula', 'Meu plano', 'data-oferta="alimentacao"']) naoContem(h, fora);
    contem(h, 'data-oferta="treino"');
  });
  teste('os três: tudo, e nenhuma oferta', () => {
    const h = inicioHtml({ ...base, servicos: ['alimentacao', 'treino', 'academia'] });
    for (const s of ['Treino de hoje', 'Sua alimentação', 'Próxima aula', 'Meu plano']) contem(h, s);
    naoContem(h, 'data-oferta=');
  });
  teste('não definido: igual a antes (tudo, sem oferta)', () => {
    const h = inicioHtml({ ...base, servicos: null });
    for (const s of ['Treino de hoje', 'Sua alimentação', 'Próxima aula']) contem(h, s);
    naoContem(h, 'data-oferta=');
  });
  teste('o card de oferta tem "Conhecer" (vai para a aba) e "Agora não"', () => {
    const h = inicioHtml({ ...base, servicos: ['treino'] });
    const i = h.indexOf('data-oferta="alimentacao"');
    const card = h.slice(i, h.indexOf('</section>', i));
    contem(card, 'data-ir="dieta"');
    contem(card, 'Conhecer');
    contem(card, 'data-oferta-adiar="alimentacao"');
  });
  teste('"Agora não": a oferta adiada não aparece', () => {
    const h = inicioHtml({ ...base, servicos: ['academia'], ofertasAdiadas: ['treino'] });
    naoContem(h, 'data-oferta="treino"');
    contem(h, 'data-oferta="alimentacao"');
  });
  teste('só um card de destaque ocupa a linha inteira', () => {
    contem(inicioHtml({ ...base, servicos: ['alimentacao'] }), 'class="in-duo in-duo-um"');
    contem(inicioHtml({ ...base, servicos: null }), 'class="in-duo"');
  });
  teste('o que não foi contratado nem é buscado', () => {
    const ui = ler('../js/pwa-inicio-ui.js');
    contem(ui, "tem('alimentacao') ? tentar(carregarDieta, 'dieta') : nada,");
    contem(ui, "tem('academia') ? tentar(carregarAgenda, 'agenda') : nada,");
  });
});

grupo('serviços · a barra e a leitura do aluno', () => {
  const casca = ler('../js/paciente-ui.js');
  const abas = casca.slice(casca.indexOf('function abasDaBarra'), casca.indexOf('function bottomNav'));
  teste('cada aba depende do serviço; Treino e Dieta à venda ficam com cadeado', () => {
    contem(abas, "_agendaAtiva && temServico('academia')");
    contem(abas, "temServico('treino')");
    contem(abas, "temServico('alimentacao')");
    contem(abas, "aVenda('treino') ? [['treino', 'dumbbell', 'Treino', 0, true]]");
    contem(abas, "aVenda('alimentacao') ? [['dieta', 'salad', 'Dieta', 0, true]]");
  });
  teste('aba não contratada abre a vitrine, venha da barra ou do Início', () => {
    contem(casca, "if (sec === 'dieta' && !temServico('alimentacao')) renderOferta('alimentacao');");
    contem(casca, "else if (sec === 'treino' && !temServico('treino')) renderOferta('treino');");
    contem(casca, ".then(m => m.renderVitrine('paOferta', id))");
  });
  teste('quem não é da academia nem consulta a agenda', () => {
    contem(casca, "if (!temServico('academia')) return;");
  });
  teste('sem a coluna no banco, o app abre igual (lê de novo sem ela)', () => {
    const dados = ler('../js/paciente-data.js');
    contem(dados, "ler('id, nome, codigo, status, sexo, servicos')");
    contem(dados, "if (error && error.code === '42703')");
  });
  teste('servicos.js está no cache do app (import estático)', () => {
    contem(ler('../sw.js'), "'js/servicos.js',");
  });
});

grupo('serviços · a ficha do cliente (cabeçalho)', () => {
  teste('três botões liga/desliga, com a explicação do que cada um libera', () => {
    const h = servicosHtml(['treino']);
    igual((h.match(/data-sv="/g) || []).length, 3);
    contem(h, 'data-sv="treino" aria-pressed="true"');
    contem(h, 'data-sv="alimentacao" aria-pressed="false"');
    contem(h, 'title="Plano alimentar e a aba Dieta no app"');
  });
  teste('não definido: nenhum aceso e o aviso de que o app mostra tudo', () => {
    const h = servicosHtml(null);
    naoContem(h, 'aria-pressed="true"');
    contem(h, 'não definido');
  });
  teste('sem permissão de editar, só leitura', () => {
    igual((servicosHtml(['treino'], { editar: false }).match(/disabled/g) || []).length, 3);
  });
  teste('grava só a coluna e confere a volta do banco', () => {
    const ui = ler('../js/paciente-servicos-ui.js');
    contem(ui, ".update({ servicos: marcados }).eq('id', paciente.id).select('servicos').maybeSingle()");
    contem(ui, "pode('clientes.editar')");
  });
  teste('no cabeçalho, no lugar de "Registrar consulta"/"Registrar avaliação" (que foram para o menu ⋯)', () => {
    const hub = ler('../js/paciente-hub.js');
    contem(hub, '<div class="hub-servicos" data-hub-servicos role="group" aria-label="Serviços contratados"></div>');
    contem(hub, ".catch(e => console.error('[hub] serviços:', e));");
    contem(hub, "{ id: 'consulta',  label: 'Registrar consulta',  icone: 'stethoscope', aba: 'consultas' },");
    contem(hub, "{ id: 'avaliacao', label: 'Registrar avaliação', icone: 'ruler',       aba: 'avaliacoes' },");
    igual(/destaque: true/.test(hub), false, 'nenhuma ação em destaque');
    igual(ler('../js/paciente-painel.js').includes('data-pv-servicos'), false, 'saiu da Visão geral');
  });
  teste('CSS só com tokens', () => {
    const css = ler('../css/paciente-servicos.css').replace(/\/\*[\s\S]*?\*\//g, '');
    igual(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), false);
  });
});

grupo('serviços · a migração', () => {
  const sql = ler('../db/paciente_servicos.sql');
  const des = ler('../db/paciente_servicos_desfazer.sql');
  teste('coluna que aceita nulo, sem padrão, com regra dos três nomes', () => {
    contem(sql, 'alter table public.pacientes add column if not exists servicos text[];');
    contem(sql, "servicos is null or servicos <@ array['alimentacao', 'treino', 'academia']::text[]");
    naoContem(sql, 'default');
  });
  teste('não mexe em dado nem em política', () => {
    igual(/\bupdate public\.|\binsert into|\bdelete from|create policy|drop policy|grant /i.test(sql), false);
  });
  teste('o desfazer tira a regra e a coluna', () => {
    contem(des, 'drop constraint if exists pacientes_servicos_validos');
    contem(des, 'drop column if exists servicos');
  });
});
