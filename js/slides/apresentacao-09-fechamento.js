// SLIDE FINAL — Resumo da consulta
// O que o paciente leva embora, e as três saídas que existem de verdade hoje:
// PDF (impressão), WhatsApp e o registro no histórico do prontuário.
//
// "Enviar ao aplicativo" não entra: o app do aluno não tem caixa de entrada,
// e botão que não leva a lugar nenhum não entra.

import { esc, fmt, fmtData } from '../evolucao-core.js';
import { gerarLinkWhatsapp, mostrarToast, mostrarErro } from '../utils.js';
import { registrarEvento } from '../timeline.js';

export default {
  id: 'fechamento',
  titulo: 'Resumo da consulta',

  disponivel(d) { return !!d.atual; },

  html(d) {
    // Sem objetivo no plano ativo nada é "conquista" — mas as mudanças
    // continuam existindo, e o fechamento não pode sair vazio por isso.
    const conquistas = destaquesDaConsulta(d).slice(0, 4);
    const metas = d.metasVivas.slice(0, 3);
    const plano = d.resumo?.planoAtivo;
    const treino = d.resumo?.treinoAtivo;
    const retorno = d.resumo?.retornoSugerido;

    const bloco = (titulo, icone, itens) => itens.length ? `
      <section class="ap-fech-bloco">
        <h3 class="ap-fech-tit"><i data-lucide="${icone}"></i> ${esc(titulo)}</h3>
        <ul class="ap-fech-lista">${itens.map(t => `<li>${t}</li>`).join('')}</ul>
      </section>` : '';

    const temObjetivo = !!d.conquistas?.temObjetivo;
    const conquistasHtml = bloco(temObjetivo ? 'Conquistas' : 'O que mudou', 'trophy', conquistas.map(c =>
      `${esc(c.texto)} <b>${c.dif > 0 ? '+' : '−'}${fmt(Math.abs(c.dif))}${esc(c.unidade || '')}</b>`));

    const objetivosHtml = bloco('Próximos objetivos', 'target', metas.map(({ meta, cfg, situacao }) =>
      `${esc(meta.titulo || cfg.label || 'Meta')}: <b>${situacao.alvo != null ? fmt(situacao.alvo, cfg.casas ?? 1) + (situacao.unidade || '') : '—'}</b>`));

    const acompanhamento = [];
    if (plano)  acompanhamento.push(`Plano alimentar: <b>${esc(plano.nome || 'ativo')}</b>`);
    if (treino) acompanhamento.push(`Treino: <b>${esc(treino.nome || 'ativo')}</b>`);
    if (retorno) acompanhamento.push(`Retorno: <b>${esc(fmtData(retorno))}</b>`);
    const acompHtml = bloco('Acompanhamento', 'clipboard-list', acompanhamento);

    return `
      <div class="ap-centro ap-fech">
        <h2 class="ap-secao-tit">Resumo da consulta</h2>

        <div class="ap-fech-grid">
          ${conquistasHtml}
          ${objetivosHtml}
          ${acompHtml}
          <section class="ap-fech-bloco ap-fech-acoes" data-fech-acoes hidden>
            <h3 class="ap-fech-tit"><i data-lucide="list-checks"></i> Próximas ações</h3>
            <p class="ap-fech-texto" data-fech-acoes-txt></p>
          </section>
        </div>

        <div class="ap-fech-botoes ap-nao-imprime">
          <button class="ap-btn" data-fech-pdf><i data-lucide="printer"></i> Gerar PDF</button>
          <button class="ap-btn" data-fech-zap><i data-lucide="message-circle"></i> Enviar por WhatsApp</button>
          <button class="ap-btn ap-btn-forte" data-fech-salvar><i data-lucide="save"></i> Salvar no histórico</button>
        </div>
      </div>`;
  },

  ligar(el, d, api) {
    // As ações digitadas no slide anterior só aparecem se houver alguma.
    const acoes = (api.sessao.acoes || '').trim();
    if (acoes) {
      const box = el.querySelector('[data-fech-acoes]');
      const txt = el.querySelector('[data-fech-acoes-txt]');
      if (box && txt) { txt.textContent = acoes; box.hidden = false; }
    }

    el.querySelector('[data-fech-pdf]')?.addEventListener('click', () => window.print());

    el.querySelector('[data-fech-zap]')?.addEventListener('click', () => {
      const msg = montarMensagem(d, acoes);
      window.open(gerarLinkWhatsapp(msg, d.paciente?.telefone || ''), '_blank');
    });

    el.querySelector('[data-fech-salvar]')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await salvarNoHistorico(d, acoes);
        mostrarToast('✓ Resumo salvo no histórico');
      } catch (e) {
        mostrarErro('Não foi possível salvar: ' + (e.message || e));
      } finally {
        btn.disabled = false;
      }
    });
  },
};

/**
 * O que a consulta tem a mostrar. Com objetivo declarado são as conquistas;
 * sem objetivo, as mudanças — porque "perdeu 4 kg" continua sendo notícia
 * mesmo quando o plano não diz para onde o paciente está indo.
 */
export function destaquesDaConsulta(d) {
  const c = d.conquistas;
  if (!c) return [];
  return c.temObjetivo ? c.boas : [...c.neutras, ...c.boas, ...c.atencao];
}

/** Mensagem do WhatsApp: o resumo em texto, sem link nem anexo. */
export function montarMensagem(d, acoes = '') {
  const primeiro = String(d.paciente?.nome || '').trim().split(/\s+/)[0] || '';
  const linhas = [`Oi ${primeiro}, seguem os pontos da nossa consulta de hoje:`, ''];

  const boas = destaquesDaConsulta(d).slice(0, 4);
  if (boas.length) {
    linhas.push(d.conquistas?.temObjetivo ? 'Conquistas:' : 'O que mudou:');
    boas.forEach(c => linhas.push(`• ${c.texto} ${c.dif > 0 ? '+' : '−'}${fmt(Math.abs(c.dif))}${c.unidade || ''}`));
    linhas.push('');
  }

  const metas = d.metasVivas.slice(0, 3);
  if (metas.length) {
    linhas.push('Próximos objetivos:');
    metas.forEach(({ meta, cfg, situacao }) => linhas.push(
      `• ${meta.titulo || cfg.label || 'Meta'}: ${situacao.alvo != null ? fmt(situacao.alvo, cfg.casas ?? 1) + (situacao.unidade || '') : '—'}`));
    linhas.push('');
  }

  if (acoes) { linhas.push('Próximas ações:'); linhas.push(acoes); linhas.push(''); }
  if (d.resumo?.retornoSugerido) linhas.push(`Retorno: ${fmtData(d.resumo.retornoSugerido)}`);

  return linhas.join('\n').trim();
}

/** Registra o evento no prontuário — vira uma linha na timeline do paciente. */
export function salvarNoHistorico(d, acoes = '') {
  const boas = (d.conquistas?.boas || []).length;
  const atencao = (d.conquistas?.atencao || []).length;
  const mudou = destaquesDaConsulta(d).length;
  const partes = [];
  if (d.dias) partes.push(`${d.dias} dias de acompanhamento`);
  if (boas) partes.push(`${boas} ${boas === 1 ? 'indicador melhorou' : 'indicadores melhoraram'}`);
  else if (mudou) partes.push(`${mudou} ${mudou === 1 ? 'indicador mudou' : 'indicadores mudaram'}`);
  if (atencao) partes.push(`${atencao} ${atencao === 1 ? 'ponto de atenção' : 'pontos de atenção'}`);

  return registrarEvento({
    pacienteId: d.paciente.id,
    tipo: 'EVOLUTION_PRESENTED',
    descricao: partes.join(' · ') || null,
    entidadeTipo: 'avaliacao',
    entidadeId: d.atual?.id || null,
    metadata: {
      avaliacao_inicial: d.primeira?.numero ?? null,
      avaliacao_atual:   d.atual?.numero ?? null,
      dias: d.dias ?? null,
      meta_media: d.metaMedia ?? null,
      acoes: acoes || null,
    },
    dedupPorDia: true,   // apresentar duas vezes no mesmo dia é a mesma consulta
  });
}
