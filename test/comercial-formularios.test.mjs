// ═══════════════════════════════════════════════════════════
// COMERCIAL — formulários de plano e de assinatura
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é o momento em que o contrato nasce: um preço
// lido errado ou um fim de período calculado errado aqui contamina todas as
// renovações seguintes.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  planoVazio, planoDoBanco, validarPlano, planoParaBanco,
  assinaturaVazia, validarAssinatura, assinaturaParaBanco,
  formPlanoHtml, formAssinaturaHtml,
  cobrancaDoPeriodoVazia, mudancaDaRenovacao, validarCobrancaDoPeriodo,
  formCobrancaPeriodoHtml, resumoRenovacaoHtml, valorSugeridoAoTrocarPlano,
} from '../js/comercial-formularios.js';

const MENSAL = { id: 'p1', nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', preco_padrao: 330, tolerancia_dias: 5 };

// ───────────────────────────────────────────────────────────
grupo('comercial · validação do plano', () => {
  const base = () => ({ ...planoVazio(), nome: 'Mensal - 3x' });

  teste('plano sem nome não passa', () => {
    igual(Object.keys(validarPlano({ ...planoVazio() })).includes('nome'), true);
  });

  teste('o padrão já vem certo para a GoUp', () => {
    const v = planoVazio();
    igual(v.duracao_valor, '30');
    igual(v.duracao_unidade, 'dia');
    igual(v.tolerancia_dias, '5');
  });

  teste('duração tem que ser inteiro positivo', () => {
    ok(validarPlano({ ...base(), duracao_valor: '0' }).duracao_valor);
    ok(validarPlano({ ...base(), duracao_valor: '-5' }).duracao_valor);
    ok(validarPlano({ ...base(), duracao_valor: '1,5' }).duracao_valor);
    igual(validarPlano({ ...base(), duracao_valor: '90' }).duracao_valor, undefined);
  });

  teste('tolerância zero é válida — significa sem tolerância', () => {
    igual(validarPlano({ ...base(), tolerancia_dias: '0' }).tolerancia_dias, undefined);
    ok(validarPlano({ ...base(), tolerancia_dias: '-1' }).tolerancia_dias);
  });

  teste('frequência fora de 1 a 7 não passa', () => {
    ok(validarPlano({ ...base(), frequencia_semanal: '0' }).frequencia_semanal);
    ok(validarPlano({ ...base(), frequencia_semanal: '8' }).frequencia_semanal);
    igual(validarPlano({ ...base(), frequencia_semanal: '' }).frequencia_semanal, undefined);
  });

  teste('preço vazio é permitido — nem todo plano tem tabela', () => {
    igual(validarPlano({ ...base(), preco_padrao: '' }).preco_padrao, undefined);
  });
});

grupo('comercial · o plano vira registro do banco', () => {
  teste('"330,00" vira 330 e não 33000', () => {
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: '330,00' }).preco_padrao, 330);
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: 'R$ 330,00' }).preco_padrao, 330);
  });

  teste('"1.200,00" é mil e duzentos, não um e dois', () => {
    // O ponto é milhar quando há vírgula depois. Ler como 1,20 cobraria um
    // real e vinte de um plano de mil e duzentos.
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: '1.200,00' }).preco_padrao, 1200);
  });

  teste('campos em branco viram null, não string vazia', () => {
    const r = planoParaBanco({ ...planoVazio(), nome: 'X' });
    igual(r.preco_padrao, null);
    igual(r.frequencia_semanal, null);
    igual(r.descricao, null);
  });

  teste('números saem como número, não como texto', () => {
    const r = planoParaBanco({ ...planoVazio(), nome: 'X', duracao_valor: '90', tolerancia_dias: '3' });
    igual(r.duracao_valor, 90);
    igual(r.tolerancia_dias, 3);
  });

  teste('ida e volta do banco preserva o plano', () => {
    const volta = planoParaBanco(planoDoBanco(MENSAL));
    igual(volta.nome, 'Mensal - 3x');
    igual(volta.duracao_valor, 30);
    igual(volta.preco_padrao, 330);
    igual(volta.tolerancia_dias, 5);
  });
});

grupo('comercial · o padrão da assinatura nova', () => {
  teste('RENOVAÇÃO AUTOMÁTICA NASCE DESLIGADA', () => {
    // Ligada, cada baixa criava na hora a cobrança do período seguinte, que
    // passava um mês inteiro como "Em aberto" no Financeiro. Como a tela de
    // receitas não separa "ainda não venceu" de "venceu e não pagaram", a
    // única cobrança realmente vencida ficava escondida no meio de vinte que
    // ninguém devia. Decisão de 05/09/2026.
    igual(assinaturaVazia().renovacao_automatica, false);
  });

  teste('mas a cobrança DO PERÍODO continua nascendo', () => {
    // Sem ela a assinatura nasce sem nada para dar baixa, e o operador teria
    // de criar a cobrança à mão antes do primeiro pagamento. São duas opções
    // diferentes, e só uma mudou.
    igual(assinaturaVazia().criar_cobranca, true);
  });
});

grupo('comercial · validação da assinatura', () => {
  const base = () => ({ ...assinaturaVazia(), paciente_id: 'pac1', plano_id: 'p1', inicio_periodo: '2026-08-06', data_inicio_original: '2026-08-06' });

  teste('sem cliente ou sem plano não passa', () => {
    ok(validarAssinatura({ ...base(), paciente_id: '' }, MENSAL).paciente_id);
    ok(validarAssinatura({ ...base(), plano_id: '' }, MENSAL).plano_id);
  });

  teste('o período não pode começar antes de o cliente existir', () => {
    // É o mesmo CHECK da tabela; barrar aqui evita um erro cru do Postgres.
    const erros = validarAssinatura({
      ...base(), data_inicio_original: '2026-08-10', inicio_periodo: '2026-08-06',
    }, MENSAL);
    ok(erros.inicio_periodo);
  });

  teste('renovação com o mesmo dia nas duas datas passa', () => {
    igual(validarAssinatura(base(), MENSAL).inicio_periodo, undefined);
  });

  teste('valor mal digitado não passa', () => {
    ok(validarAssinatura({ ...base(), valor_contratado: 'abacaxi' }, MENSAL).valor_contratado);
    igual(validarAssinatura({ ...base(), valor_contratado: '' }, MENSAL).valor_contratado, undefined);
  });
});

grupo('comercial · a assinatura vira registro do banco', () => {
  const form = () => ({
    ...assinaturaVazia(), paciente_id: 'pac1', plano_id: 'p1',
    inicio_periodo: '2026-08-06', data_inicio_original: '2026-08-06',
  });

  teste('o fim do período é CALCULADO, não digitado', () => {
    // 06/08 + 30 dias = 05/09. Ninguém digita essa data.
    igual(assinaturaParaBanco(form(), MENSAL).fim_periodo, '2026-09-05');
  });

  teste('trimestral usa a duração do plano, não 30 fixo', () => {
    const tri = { ...MENSAL, duracao_valor: 90 };
    igual(assinaturaParaBanco(form(), tri).fim_periodo, '2026-11-04');
  });

  teste('valor em branco copia o preço padrão do plano', () => {
    igual(assinaturaParaBanco(form(), MENSAL).valor_contratado, 330);
  });

  teste('valor preenchido GANHA do preço do plano', () => {
    // É o §9: o cliente antigo de R$ 330 continua em 330 quando o plano virar
    // R$ 350. O que vale é o que foi combinado com ele.
    const r = assinaturaParaBanco({ ...form(), valor_contratado: '350,00' }, MENSAL);
    igual(r.valor_contratado, 350);
  });

  teste('a data de início original viaja separada do período', () => {
    const r = assinaturaParaBanco({
      ...form(), data_inicio_original: '2024-03-01', inicio_periodo: '2026-08-06',
    }, MENSAL);
    igual(r.data_inicio_original, '2024-03-01');
    igual(r.inicio_periodo, '2026-08-06');
  });

  teste('a assinatura nasce ativa', () => {
    igual(assinaturaParaBanco(form(), MENSAL).status, 'ativa');
  });

  teste('observação em branco vira null e não string vazia', () => {
    igual(assinaturaParaBanco(form(), MENSAL).observacoes, null);
    igual(assinaturaParaBanco(form(), MENSAL).horario, null);
  });
});

grupo('comercial · o formulário de plano na tela', () => {
  const html = formPlanoHtml({ form: planoDoBanco(MENSAL), edicao: true });

  teste('duração e unidade são campos, não constantes', () => {
    contem(html, 'id="cmpDuracao"');
    contem(html, 'id="cmpUnidade"');
    contem(html, 'dias corridos');
    contem(html, 'meses calendário');
  });

  teste('explica que o preço não retroage', () => {
    // A regra é contraintuitiva o bastante para ficar na tela, não só no código.
    contem(html, 'não altera');
  });

  teste('explica o que a tolerância faz', () => {
    contem(html, 'continua do término anterior');
    contem(html, 'data do pagamento');
  });

  teste('erro aparece no campo, não num alerta do navegador', () => {
    const comErro = formPlanoHtml({ form: planoVazio(), erros: { nome: 'Dê um nome ao plano.' } });
    contem(comErro, 'cm-erro-campo');
    contem(comErro, 'Dê um nome ao plano.');
  });
});

grupo('comercial · o formulário de assinatura na tela', () => {
  const pacientes = [{ id: 'pac1', nome: 'Paciente Teste B Teste B' }];
  const html = formAssinaturaHtml({
    form: { ...assinaturaVazia(), plano_id: 'p1', inicio_periodo: '2026-08-06' },
    pacientes, planos: [MENSAL], plano: MENSAL,
  });

  teste('o fim do período aparece calculado, e não editável', () => {
    // Um input ali sugeriria que dá para contrariar a duração do plano.
    contem(html, '05/09/2026');
    contem(html, 'cm-calculado');
    naoContem(html, 'id="cmaFim"');
  });

  teste('o preço padrão do plano vira sugestão, não imposição', () => {
    contem(html, 'placeholder="330,00"');
    contem(html, 'id="cmaValor"');
  });

  teste('"cliente desde" se explica', () => {
    contem(html, 'nunca muda');
  });

  teste('observação comercial se separa do prontuário', () => {
    contem(html, 'Observações comerciais');
    contem(html, 'Nada clínico aqui');
  });

  teste('sem cliente disponível, diz o porquê em vez de lista vazia', () => {
    const vazio = formAssinaturaHtml({ form: assinaturaVazia(), pacientes: [], planos: [MENSAL] });
    contem(vazio, 'já têm assinatura ativa');
  });

  teste('horário sugere Diurno e Noturno sem travar neles', () => {
    // Hoje são esses dois; o plano é evoluir para 05:00, 06:00. `datalist`
    // sugere sem impedir.
    contem(html, '<datalist');
    contem(html, 'Diurno');
    contem(html, 'Noturno');
  });
});

// ───────────────────────────────────────────────────────────
// COBRANÇA DO PERÍODO + RENOVAÇÃO PROGRAMADA (Migration A)
// ---------------------------------------------------------------------------
// A confusão que este formulário existe para tornar impossível: o que ele cria
// é a cobrança do período que JÁ ESTÁ CORRENDO; o plano escolhido embaixo vale
// só a partir do PRÓXIMO ciclo. Se os dois se misturassem, o período vigente
// passaria a parecer que pertence ao plano novo.
// ───────────────────────────────────────────────────────────
grupo('comercial · cobrança do período', () => {
  const TRI = { id: 'p-tri', nome: 'Trimestral - 5x', duracao_valor: 90, duracao_unidade: 'dia', preco_padrao: 1121, tolerancia_dias: 5 };
  const MEN = { id: 'p-men', nome: 'Mensal - 3x',     duracao_valor: 30, duracao_unidade: 'dia', preco_padrao: 330,  tolerancia_dias: 5 };
  const PLANOS = [TRI, MEN];

  const ASS = {
    id: 'a1', paciente_id: 'pac1', plano_id: 'p-tri', plano: TRI,
    inicio_periodo: '2025-05-19', fim_periodo: '2025-08-17',
    valor_contratado: 1121,
  };

  // A data de criação da cobrança, EXPLÍCITA. Sem ela a função lê o relógio e
  // o teste passa a depender do dia em que roda.
  const HOJE_CP = '2026-08-13';

  teste('abre com o vencimento em hoje + 30, e o resto do período vigente', () => {
    // `hoje` vai EXPLÍCITO. Sem ele a função lê o relógio, e o teste passa a
    // depender do dia em que roda — foi o que aconteceu quando a data virou.
    const f = cobrancaDoPeriodoVazia(ASS, '2026-08-13');
    igual(f.vencimento, '2026-09-12', 'prazo de pagamento, não fim do período');
    ok(f.vencimento !== ASS.fim_periodo);
    igual(f.valor, '1121,00', 'o valor da cobrança é o do período que correu');
    // O plano atual vem selecionado: renovar no mesmo plano é o caso comum e
    // não pode custar trabalho nenhum.
    igual(f.proximo_plano_id, 'p-tri');
    igual(f.proximo_valor, '1121,00');
  });

  teste('A. mesmo plano e mesmo valor NÃO programam renovação', () => {
    const m = mudancaDaRenovacao(cobrancaDoPeriodoVazia(ASS, HOJE_CP), ASS);
    igual(m.mudou, false);
    igual(m.trocaPlano, false);
    igual(m.trocaValor, false);
  });

  teste('B. plano diferente programa', () => {
    const m = mudancaDaRenovacao({ ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_plano_id: 'p-men' }, ASS);
    igual(m.trocaPlano, true);
    igual(m.mudou, true);
    igual(m.planoFuturo, 'p-men');
  });

  teste('C. mesmo plano com valor diferente programa', () => {
    const m = mudancaDaRenovacao({ ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_valor: '990,00' }, ASS);
    igual(m.trocaPlano, false);
    igual(m.trocaValor, true);
    igual(m.mudou, true);
    igual(m.valorFuturo, 990);
  });

  teste('plano E valor diferentes programam os dois', () => {
    const m = mudancaDaRenovacao(
      { ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_plano_id: 'p-men', proximo_valor: '330,00' }, ASS);
    ok(m.trocaPlano && m.trocaValor && m.mudou);
  });

  teste('campo de valor vazio é "não mexi nisso", não "mudou para nada"', () => {
    // Espelha o `p_proximo_valor is not null and ...` da RPC.
    const m = mudancaDaRenovacao({ ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_valor: '' }, ASS);
    igual(m.trocaValor, false);
    igual(m.valorFuturo, null);
  });

  teste('"Manter o atual" no select não conta como troca', () => {
    const m = mudancaDaRenovacao({ ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_plano_id: '' }, ASS);
    igual(m.trocaPlano, false);
    igual(m.planoFuturo, 'p-tri');
  });

  teste('o formulário separa a cobrança de agora do contrato futuro', () => {
    const html = formCobrancaPeriodoHtml({ assinatura: ASS, planos: PLANOS, form: cobrancaDoPeriodoVazia(ASS, HOJE_CP) });
    contem(html, 'Cobrança deste período');
    contem(html, 'Próxima renovação');
    contem(html, 'Valor da cobrança');
    contem(html, 'Valor contratado futuro');
    // E o período vigente aparece como LEITURA, nunca como campo.
    contem(html, '19/05/2025 → 17/08/2025');
    naoContem(html, 'id="cmcpInicio"');
    naoContem(html, 'id="cmcpFim"');
  });

  teste('sem mudança o botão é "Criar cobrança", e não há resumo', () => {
    const html = formCobrancaPeriodoHtml({ assinatura: ASS, planos: PLANOS, form: cobrancaDoPeriodoVazia(ASS, HOJE_CP) });
    contem(html, '> Criar cobrança\n');
    naoContem(html, 'data-resumo');
    naoContem(html, 'programar renovação');
  });

  teste('com mudança o botão avisa, e o resumo mostra o de-para', () => {
    const form = { ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_plano_id: 'p-men', proximo_valor: '330,00' };
    const html = formCobrancaPeriodoHtml({ assinatura: ASS, planos: PLANOS, form });
    contem(html, 'Criar cobrança e programar renovação');
    contem(html, 'data-resumo');
    contem(html, 'class="cm-dw-depara"');
    contem(html, '<span class="cm-dw-de">Trimestral - 5x</span>');
    contem(html, '<b class="cm-dw-para">Mensal - 3x</b>');
    contem(html, 'Vale a partir do <b>próximo período</b>');
  });

  teste('o resumo só fala do que mudou', () => {
    const soPlano = resumoRenovacaoHtml(
      mudancaDaRenovacao({ ...cobrancaDoPeriodoVazia(ASS, HOJE_CP), proximo_plano_id: 'p-men' }, ASS), PLANOS);
    contem(soPlano, '<span class="cm-dw-de">Trimestral - 5x</span>');
    contem(soPlano, '<b class="cm-dw-para">Mensal - 3x</b>');
    naoContem(soPlano, 'Valor contratado');
  });

  teste('validação: vencimento e valor da cobrança são obrigatórios', () => {
    ok(validarCobrancaDoPeriodo({ vencimento: '', valor: '100' }).vencimento);
    ok(validarCobrancaDoPeriodo({ vencimento: '2025-08-17', valor: '' }).valor);
    ok(validarCobrancaDoPeriodo({ vencimento: '2025-08-17', valor: '0' }).valor);
    igual(Object.keys(validarCobrancaDoPeriodo({ vencimento: '2025-08-17', valor: '1121,00' })).length, 0);
  });

  teste('o valor futuro é opcional, mas se vier tem que ser válido', () => {
    igual(validarCobrancaDoPeriodo({ vencimento: '2025-08-17', valor: '100', proximo_valor: '' }).proximo_valor, undefined);
    ok(validarCobrancaDoPeriodo({ vencimento: '2025-08-17', valor: '100', proximo_valor: 'abacaxi' }).proximo_valor);
  });
});

// ───────────────────────────────────────────────────────────
// O PREÇO SUGERIDO AO TROCAR DE PLANO
// ---------------------------------------------------------------------------
// No E2E de 13/08/2026 a CASO_TROCA_DE_PLANO saiu de um Mensal de R$ 330 para um
// Trimestral e o campo de valor futuro continuou R$ 330 — um trimestre pelo
// preço de um mês. Foi pego a olho antes de salvar; quem não olhar, contrata
// errado em silêncio.
// ───────────────────────────────────────────────────────────
grupo('comercial · preço sugerido na troca de plano', () => {
  const MENSAL = { id: 'p-m', nome: 'Mensal - 3x',     preco_padrao: 330 };
  const TRI    = { id: 'p-t', nome: 'Trimestral - 3x', preco_padrao: 990 };
  const SEMPRECO = { id: 'p-s', nome: 'Sem preço',     preco_padrao: null };
  const PLANOS = [MENSAL, TRI, SEMPRECO];
  const ASS = { id: 'a1', plano_id: 'p-m', valor_contratado: 330, fim_periodo: '2026-07-09' };

  teste('F. trocar de plano sugere o preço padrão dele', () => {
    igual(valorSugeridoAoTrocarPlano('p-t', PLANOS, ASS), '990,00');
  });

  teste('H. trocar de novo sugere o preço do novo plano', () => {
    igual(valorSugeridoAoTrocarPlano('p-t', PLANOS, ASS), '990,00');
    igual(valorSugeridoAoTrocarPlano('p-m', PLANOS, ASS), '330,00');
  });

  teste('"Manter o atual" volta ao valor vigente', () => {
    igual(valorSugeridoAoTrocarPlano('', PLANOS, ASS), '330,00');
  });

  teste('plano sem preço padrão não vira R$ 0,00', () => {
    // `null` quer dizer "não tenho o que sugerir, deixe como está". Zero
    // afirmaria que o cliente não paga nada.
    igual(valorSugeridoAoTrocarPlano('p-s', PLANOS, ASS), null);
  });

  teste('G. só a troca de plano escreve no valor — o resto lê o form', () => {
    // A regra do §9 mora na ligação dos eventos: o handler do PLANO sobrescreve
    // `form.proximo_valor`; o do VALOR só redesenha. Como o desenho lê `form`,
    // nada reaplica o preço padrão por cima do que foi digitado.
    const fonte = readFileSync(new URL('../js/comercial-formularios.js', import.meta.url), 'utf8');
    const doPlano = fonte.slice(fonte.indexOf("querySelector('#cmcpPlano')"),
                                fonte.indexOf("querySelector('#cmcpProxValor')"));
    contem(doPlano, 'valorSugeridoAoTrocarPlano(form.proximo_plano_id, planos, assinatura)');
    contem(doPlano, 'if (sugerido !== null) form.proximo_valor = sugerido;');

    const doValor = fonte.slice(fonte.indexOf("querySelector('#cmcpProxValor')"));
    const corpo = doValor.slice(0, doValor.indexOf('\n      });'));
    ok(!/proximo_valor\s*=/.test(corpo), 'mexer no valor não pode sobrescrever o valor');

    // E o desenho nunca calcula preço: ele só imprime o que está no form.
    const desenho = fonte.slice(fonte.indexOf('export function formCobrancaPeriodoHtml'));
    ok(!/valorSugeridoAoTrocarPlano/.test(desenho.slice(0, desenho.indexOf('\n}'))),
       'sugerir no render sobrescreveria edição manual a cada tecla');
  });
});
