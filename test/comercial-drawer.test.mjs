// ═══════════════════════════════════════════════════════════
// COMERCIAL — drawer do cliente e registro de pagamento
// ═══════════════════════════════════════════════════════════
// É o ponto mais delicado do módulo: um pagamento registrado renova o período,
// e um período renovado errado só é descoberto trinta dias depois.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import {
  tempoDeCasa, cabecalhoHtml, assinaturaHtml, cobrancaAbertaHtml, historicoHtml,
  drawerHtml, pagamentoVazio, validarPagamento, previaDaRenovacao, formPagamentoHtml,
  FORMAS,
} from '../js/comercial-drawer.js';

const HOJE = '2026-08-06';

const ASS = {
  id: 'a1', status: 'ativa',
  paciente: { id: 'p1', nome: 'Claudia Marcia Delpiero', telefone: '5527992264711' },
  plano: { nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 },
  horario: 'Noturno',
  data_inicio_original: '2024-08-03',
  inicio_periodo: '2026-08-03', fim_periodo: '2026-09-02',
  valor_contratado: 330, renovacao_automatica: true,
};

const PENDENTE = { id: 'c1', status: 'pendente', vencimento: '2026-09-02', valor: 330 };
const PAGA     = { id: 'c0', status: 'pago', vencimento: '2026-08-03', valor: 330, pago_em: '2026-08-03', valor_pago: 330 };

// ───────────────────────────────────────────────────────────
grupo('comercial · tempo de casa', () => {
  teste('conta em dias, meses e anos conforme o tamanho', () => {
    igual(tempoDeCasa('2026-08-01', HOJE), '5 dias');
    igual(tempoDeCasa('2026-05-01', HOJE), '3 meses');
    igual(tempoDeCasa('2024-08-03', HOJE), '2 anos');       // resto zero: sem "0m" pendurado
    igual(tempoDeCasa('2025-02-03', HOJE), '1a 6m');        // com resto: anos e meses
  });

  teste('um dia e um mês saem no singular', () => {
    igual(tempoDeCasa('2026-08-05', HOJE), '1 dia');
    igual(tempoDeCasa('2026-07-05', HOJE), '1 mês');
  });

  teste('data inválida não vira "NaN dias"', () => {
    igual(tempoDeCasa('abacaxi', HOJE), '');
    igual(tempoDeCasa(null, HOJE), '');
  });
});

grupo('comercial · o cabeçalho do drawer', () => {
  const html = cabecalhoHtml(ASS, HOJE);

  teste('mostra nome, situação, plano e horário', () => {
    contem(html, 'Claudia Marcia Delpiero');
    contem(html, 'cm-b-ativo');
    contem(html, 'Mensal - 3x');
    contem(html, 'Noturno');
  });

  teste('o telefone vira WhatsApp com número normalizado', () => {
    contem(html, 'https://wa.me/5527992264711');
    contem(html, '(27) 99226-4711');
  });
});

grupo('comercial · a seção de assinatura', () => {
  const html = assinaturaHtml(ASS, HOJE);

  teste('"cliente desde" NÃO é a data do período atual', () => {
    // É a distinção do §21: uma nunca muda, a outra muda toda renovação.
    contem(html, '03/08/2024');     // desde
    contem(html, '03/08/2026');     // período atual
    contem(html, '2 anos');
  });

  teste('mostra o período e o próximo vencimento com os dias', () => {
    contem(html, '03/08/2026 → 02/09/2026');
    contem(html, 'Vence em 27 dias');
  });

  teste('renovação desligada é avisada', () => {
    const off = assinaturaHtml({ ...ASS, renovacao_automatica: false }, HOJE);
    contem(off, 'não nasce sozinha');
    naoContem(html, 'não nasce sozinha');
  });
});

grupo('comercial · cobrança em aberto', () => {
  teste('pendente oferece registrar pagamento', () => {
    const html = cobrancaAbertaHtml(PENDENTE, HOJE);
    contem(html, 'Registrar pagamento');
    contem(html, 'data-registrar="c1"');
    contem(html, '330,00');
  });

  teste('JÁ PAGA não oferece registrar de novo — avisa que já tem pagamento', () => {
    // É o §13. O botão some e o lugar dele conta quando foi pago.
    const html = cobrancaAbertaHtml(PAGA, HOJE);
    contem(html, 'já possui um pagamento registrado');
    contem(html, 'Pago em 03/08/2026');
    contem(html, 'Ver receita');
    naoContem(html, 'data-registrar');
  });

  teste('vencida se identifica sem nada ter sido gravado', () => {
    const html = cobrancaAbertaHtml({ ...PENDENTE, vencimento: '2026-08-01' }, HOJE);
    contem(html, 'cm-c-vencida');
    contem(html, 'Vencido há 5 dias');
  });

  teste('sem cobrança, oferece criar em vez de ficar mudo', () => {
    const html = cobrancaAbertaHtml(null, HOJE);
    contem(html, 'Nenhuma cobrança em aberto');
    contem(html, 'data-criar-cobranca');
  });

  teste('parcial mostra quanto falta', () => {
    const html = cobrancaAbertaHtml({ ...PENDENTE, valor: 350, valor_pago: 200 }, HOJE);
    contem(html, 'Já pago');
    contem(html, 'falta');
  });
});

grupo('comercial · histórico', () => {
  teste('lista as cobranças com data, valor e situação', () => {
    const html = historicoHtml([PAGA, PENDENTE], HOJE);
    contem(html, '03/08/2026');
    contem(html, 'pago em 03/08/2026');
    contem(html, 'cm-c-pendente');
  });

  teste('cancelada não aparece no histórico', () => {
    const html = historicoHtml([{ ...PAGA, status: 'cancelado' }], HOJE);
    contem(html, 'Ainda não há cobranças');
  });

  teste('sem histórico, diz isso em vez de lista vazia', () => {
    contem(historicoHtml([], HOJE), 'Ainda não há cobranças');
  });
});

grupo('comercial · validação do pagamento', () => {
  teste('a data já vem preenchida com hoje e o valor com o da cobrança', () => {
    const f = pagamentoVazio(PENDENTE);
    igual(f.valor_pago, '330,00');
    igual(f.forma_pagamento, 'pix');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(f.pago_em));
  });

  teste('sem data ou sem valor não passa', () => {
    ok(validarPagamento({ ...pagamentoVazio(PENDENTE), pago_em: '' }, PENDENTE).pago_em);
    ok(validarPagamento({ ...pagamentoVazio(PENDENTE), valor_pago: '' }, PENDENTE).valor_pago);
  });

  teste('receber MENOS que o cobrado é barrado, não tratado como quitação', () => {
    // R$ 200 não quitam R$ 350. Pagamento parcial está modelado no banco mas
    // não implementado — então aqui se barra em vez de mentir.
    const erros = validarPagamento({ ...pagamentoVazio(PENDENTE), valor_pago: '200,00' }, PENDENTE);
    ok(erros.valor_pago);
    contem(erros.valor_pago, 'parcial');
  });

  teste('receber mais que o cobrado passa', () => {
    igual(validarPagamento({ ...pagamentoVazio(PENDENTE), valor_pago: '400,00' }, PENDENTE).valor_pago, undefined);
  });

  teste('forma de pagamento tem que ser uma das do banco', () => {
    ok(validarPagamento({ ...pagamentoVazio(PENDENTE), forma_pagamento: 'bitcoin' }, PENDENTE).forma_pagamento);
    igual(FORMAS.length, 8);
  });
});

grupo('comercial · a prévia da renovação', () => {
  teste('pagamento antecipado continua do término', () => {
    const p = previaDaRenovacao(ASS, '2026-08-28');
    igual(p.inicio_periodo, '2026-09-02');
    igual(p.fim_periodo, '2026-10-02');
    igual(p.forada, false);
  });

  teste('dentro da tolerância continua do término', () => {
    const p = previaDaRenovacao(ASS, '2026-09-07');   // 5 dias depois
    igual(p.inicio_periodo, '2026-09-02');
    igual(p.atraso, 5);
    igual(p.forada, false);
  });

  teste('além da tolerância conta do pagamento', () => {
    const p = previaDaRenovacao(ASS, '2026-09-08');   // 6 dias depois
    igual(p.inicio_periodo, '2026-09-08');
    igual(p.forada, true);
  });
});

grupo('comercial · o formulário de pagamento diz o que vai fazer', () => {
  const form = { pago_em: '2026-08-28', valor_pago: '330,00', forma_pagamento: 'pix' };
  const html = formPagamentoHtml({ cobranca: PENDENTE, assinatura: ASS, form, hoje: HOJE });

  teste('mostra de quem e de que cobrança é o pagamento', () => {
    contem(html, 'Claudia Marcia Delpiero');
    contem(html, 'vence 02/09/2026');
  });

  teste('mostra o período que vai valer, ANTES de confirmar', () => {
    // Descobrir trinta dias depois que o período contou da data errada é o
    // erro que esta caixa existe para impedir.
    contem(html, 'O que vai acontecer');
    contem(html, '02/09/2026 → 02/10/2026');
    contem(html, 'antecipado');
  });

  teste('atraso além da tolerância aparece como alerta', () => {
    const atrasado = formPagamentoHtml({
      cobranca: PENDENTE, assinatura: ASS,
      form: { ...form, pago_em: '2026-09-08' }, hoje: HOJE,
    });
    contem(atrasado, 'cm-dw-alerta');
    contem(atrasado, 'passou da tolerância');
    contem(atrasado, '08/09/2026 → 08/10/2026');
  });

  teste('deixa claro que grava UM lançamento, não dois', () => {
    contem(html, 'um</b> lançamento de receita');
    contem(html, 'Não há um segundo lugar');
  });

  teste('as oito formas de pagamento do banco estão no seletor', () => {
    for (const [id] of FORMAS) contem(html, `value="${id}"`);
  });
});

grupo('comercial · o drawer inteiro', () => {
  const html = drawerHtml({ assinatura: ASS, cobrancas: [PENDENTE, PAGA], hoje: HOJE });

  teste('tem as quatro seções do briefing', () => {
    contem(html, 'Assinatura');
    contem(html, 'Próxima cobrança');
    contem(html, 'Histórico');
    contem(html, 'Registrar pagamento');
  });

  teste('observação comercial só aparece quando existe', () => {
    naoContem(html, 'Observações comerciais');
    const comObs = drawerHtml({ assinatura: { ...ASS, observacoes: 'prefere Pix' }, cobrancas: [], hoje: HOJE });
    contem(comObs, 'Observações comerciais');
    contem(comObs, 'prefere Pix');
  });

  teste('a cobrança PENDENTE ganha o lugar, não a paga', () => {
    // Com as duas em mãos, a que importa agora é a que ainda não foi paga.
    contem(html, 'data-registrar="c1"');
    naoContem(html, 'já possui um pagamento registrado');
  });
});
