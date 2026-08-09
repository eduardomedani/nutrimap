// ═══════════════════════════════════════════════════════════
// COMERCIAL — drawer do cliente e registro de pagamento
// ═══════════════════════════════════════════════════════════
// É o ponto mais delicado do módulo: um pagamento registrado renova o período,
// e um período renovado errado só é descoberto trinta dias depois.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  tempoDeCasa, cabecalhoHtml, assinaturaHtml, cobrancaAbertaHtml, historicoHtml,
  drawerHtml, pagamentoVazio, validarPagamento, previaDaRenovacao, formPagamentoHtml,
  FORMAS, competenciaExtenso, atrasoEmDias, historicoItemHtml, textoRemocao,
  edicaoVazia, validarEdicao, formEdicaoHtml, formaRotulo, MSG, traduzirErroCobranca,
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
  teste('lista as cobranças com competência, vencimento, valor e situação', () => {
    const html = historicoHtml([PAGA, PENDENTE], HOJE);
    // A competência entrou porque "Agosto/2026" é o que o cliente reconhece;
    // o vencimento continua, agora rotulado.
    contem(html, 'Agosto/2026');
    contem(html, 'Setembro/2026');
    contem(html, 'Vencimento 03/08/2026');
    contem(html, 'Paga em 03/08/2026');
    // Só os dígitos: `moeda()` usa toLocaleString, que separa "R$" do número
    // com espaço não-quebrável. Escrever "R$ 330,00" com espaço comum aqui
    // faria o teste falhar por um caractere invisível.
    contem(html, '330,00');
    contem(html, 'cm-c-pendente');
  });

  teste('cancelada não aparece na lista operacional', () => {
    const html = historicoHtml([{ ...PAGA, status: 'cancelado' }], HOJE);
    naoContem(html, 'cm-dw-hist-comp', 'nenhuma linha de cobrança na lista');
    // E a frase deixou de mentir: havia cobrança, ela só não é operacional.
    // "Ainda não há cobranças registradas" com uma cancelada no banco fazia
    // quem procurava o passado concluir que ele não existia.
    contem(html, 'Nenhuma cobrança ativa');
    contem(html, 'Ver canceladas (1)');
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

// ───────────────────────────────────────────────────────────
grupo('comercial · remover a cobrança é CANCELAR, não apagar', () => {
  const dados   = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
  const drawer  = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
  const indice  = readFileSync(new URL('../db/comercial_etapa2_planos.sql', import.meta.url), 'utf8');

  teste('a cobrança pendente oferece remover, ao lado de registrar', () => {
    const h = cobrancaAbertaHtml(PENDENTE, HOJE);
    contem(h, 'data-cancelar-cobranca="c1"');
    contem(h, 'Remover cobrança');
    contem(h, 'data-registrar="c1"');
  });

  teste('a vencida também — vencer não tira o direito de corrigir', () => {
    const vencida = { ...PENDENTE, vencimento: '2026-07-01' };
    contem(cobrancaAbertaHtml(vencida, HOJE), 'data-cancelar-cobranca');
  });

  teste('a cobrança PAGA não oferece remover', () => {
    // Dinheiro que entrou não se apaga por um clique no lugar errado.
    const h = cobrancaAbertaHtml(PAGA, HOJE);
    naoContem(h, 'data-cancelar-cobranca');
    contem(h, 'já possui um pagamento registrado');
  });

  teste('sem cobrança, o que se oferece é criar', () => {
    const h = cobrancaAbertaHtml(null, HOJE);
    naoContem(h, 'data-cancelar-cobranca');
    contem(h, 'data-criar-cobranca');
  });

  teste('o serviço CANCELA — não existe delete de cobrança', () => {
    const f = dados.slice(dados.indexOf('export async function cancelarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, "update({ status: 'cancelado' })");
    ok(!/\.delete\(/.test(corpo),
       'apagar a linha sumiria com o registro de um contas-a-receber');
  });

  teste('a trava contra cancelar cobrança paga é do BANCO', () => {
    // Não do botão: duas abas, ou um clique numa tela velha, passariam por
    // cima de qualquer guarda que morasse só na interface.
    const f = dados.slice(dados.indexOf('export async function cancelarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, "eq('status', 'pendente')");
    contem(corpo, "eq('nutri_id', id)");
    contem(corpo, "not('assinatura_id', 'is', null)");
    contem(corpo, 'maybeSingle()', 'não casar é "nada mudou", não erro');
  });

  teste('a tela avisa quando a linha já não estava pendente', () => {
    contem(drawer, 'Esta cobrança não está mais pendente');
  });

  teste('a confirmação nomeia o período, o valor e o atraso', () => {
    const t = textoRemocao({ ...PENDENTE, competencia: '2026-08-01', vencimento: '2026-07-01' }, HOJE);
    contem(t, 'Remover a cobrança de Agosto/2026?');
    contem(t, '330,00');
    contem(t, 'Vencimento em 01/07/2026');
    contem(t, 'Vencida há 36 dias');
    contem(t, 'deixará de fazer parte do valor a receber');
    contem(t, 'histórico será preservado');
  });

  teste('sem atraso, não inventa "vencida há"', () => {
    const t = textoRemocao(PENDENTE, HOJE);   // vence em 02/09, hoje é 06/08
    naoContem(t, 'Vencida há');
    contem(t, 'Remover a cobrança de Setembro/2026?');
  });

  teste('cancelar libera o período — o índice único ignora canceladas', () => {
    // É isto que faz "remover e criar de novo com o valor certo" funcionar.
    // Sem o `where`, o período ficaria travado para sempre pela linha morta.
    contem(indice, 'create unique index if not exists uq_comercial_cobranca_periodo');
    contem(indice, "where assinatura_id is not null and status <> 'cancelado'");
  });

  teste('cobrança ANTIGA pendente também pode ser removida', () => {
    // Nada em cancelarCobranca() filtra por data: quem decide é o status.
    const f = dados.slice(dados.indexOf('export async function cancelarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    ok(!/vencimento|competencia|gte\(|lte\(/.test(corpo),
       'idade da cobrança não pode entrar na decisão');
    // E a linha antiga do histórico oferece a ação.
    const antiga = { ...PENDENTE, id: 'c9', vencimento: '2026-03-02', competencia: '2026-03-01' };
    contem(historicoItemHtml(antiga, HOJE), 'data-cancelar-cobranca="c9"');
  });

  teste('"Vencida" é rótulo, não status — e aceita as mesmas ações', () => {
    const vencida = { ...PENDENTE, id: 'c8', vencimento: '2026-07-01' };
    const h = historicoItemHtml(vencida, HOJE);
    contem(h, 'cm-c-vencida', 'o rótulo diz vencida');
    contem(h, 'data-cancelar-cobranca="c8"');
    contem(h, 'data-editar-cobranca="c8"');
    contem(h, 'data-registrar="c8"');
    // O status real continua pendente, e é ele que o banco confere.
    igual(vencida.status, 'pendente');
  });

  teste('cancelada não oferece nenhuma ação financeira', () => {
    const h = historicoItemHtml({ ...PENDENTE, id: 'c7', status: 'cancelado' }, HOJE);
    for (const a of ['data-registrar', 'data-editar-cobranca', 'data-cancelar-cobranca', 'data-ver-receita']) {
      naoContem(h, a, 'cancelada não se cancela de novo nem se edita');
    }
    contem(h, 'cm-dw-hist-cancelada');
  });

  teste('paga oferece só ver receita', () => {
    const h = historicoItemHtml(PAGA, HOJE);
    contem(h, 'data-ver-receita="c0"');
    for (const a of ['data-registrar', 'data-editar-cobranca', 'data-cancelar-cobranca']) {
      naoContem(h, a, 'dinheiro que entrou não se edita nem se remove por aqui');
    }
  });

  teste('"Ver canceladas" recupera o passado, sem ir ao banco', () => {
    const lista = [PAGA, { ...PENDENTE, id: 'cx', status: 'cancelado' }];
    const fechado = historicoHtml(lista, HOJE);
    contem(fechado, 'Ver canceladas (1)');
    naoContem(fechado, 'cm-dw-hist-cancelada');

    const aberto = historicoHtml(lista, HOJE, { mostrarCanceladas: true });
    contem(aberto, 'cm-dw-hist-cancelada');
    contem(aberto, 'Ocultar canceladas');
    // A alternância é de exibição: cobrancasDaAssinatura já traz todas.
    contem(dados, "eq('assinatura_id', assinaturaId)");
    ok(!/status.*cancelado/.test(dados.slice(dados.indexOf('cobrancasDaAssinatura'),
                                             dados.indexOf('receitasDeClientes'))),
       'a consulta não filtra status — quem esconde é a tela');
  });

  teste('sem canceladas, não existe o link', () => {
    naoContem(historicoHtml([PAGA], HOJE), 'data-ver-canceladas');
  });

  teste('cancelada sai do histórico e não conta como receita', () => {
    const dominio = readFileSync(new URL('../js/comercial.js', import.meta.url), 'utf8');
    contem(drawer, "filter(c => c.status !== 'cancelado')");
    contem(dominio, "l.status === 'cancelado'");
    // E o banco aceita o status — nada de migration para isto.
    const fin = readFileSync(new URL('../db/financeiro_despesas_etapa1.sql', import.meta.url), 'utf8');
    contem(fin, "check (status in ('pendente', 'pago', 'cancelado'))");
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · editar cobrança', () => {
  const dados  = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  teste('o formulário abre com o que já está gravado', () => {
    const f = edicaoVazia({ valor: 330, vencimento: '2026-09-02', observacoes: 'combinado no Pix' });
    igual(f, { valor: '330,00', vencimento: '2026-09-02', observacoes: 'combinado no Pix' });
  });

  teste('valor e vencimento são obrigatórios', () => {
    igual(validarEdicao({ valor: '0', vencimento: '2026-09-02' }).erros.valor,
          'Informe um valor maior que zero.');
    igual(validarEdicao({ valor: '330', vencimento: '' }).erros.vencimento,
          'Informe o vencimento.');
    const bom = validarEdicao({ valor: '350,50', vencimento: '2026-09-10' });
    ok(bom.ok);
    igual(bom.valor, 350.5);
  });

  teste('só valor, vencimento e observação — nada de cliente ou período', () => {
    const h = formEdicaoHtml({ cobranca: PENDENTE, assinatura: ASS, form: edicaoVazia(PENDENTE) });
    contem(h, 'cmEdValor');
    contem(h, 'cmEdVenc');
    contem(h, 'cmEdObs');
    for (const campo of ['paciente_id', 'assinatura_id', 'cmEdCompetencia', 'cmEdCliente']) {
      naoContem(h, campo, 'mudar o dono de uma cobrança não é correção');
    }
    // O período aparece como CONTEXTO, não como campo editável.
    contem(h, 'Setembro/2026');
  });

  teste('atualiza o MESMO lançamento — não cancela e recria', () => {
    const f = dados.slice(dados.indexOf('export async function editarCobranca'));
    // Sem os comentários: o corpo cita `criarCobranca()` para explicar de onde
    // vem a regra de `data`/`competencia`, e proibir a explicação seria o tipo
    // de guarda que se resolve apagando o comentário.
    const corpo = f.slice(0, f.indexOf('\n}'))
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    contem(corpo, '.update(patch)');
    for (const p of ['cancelarCobranca(', 'criarCobranca(', '.delete(']) {
      ok(!corpo.includes(p), `a auditoria contaria "cancelada + criada" no lugar de "editada" (${p})`);
    }
  });

  teste('a competência acompanha o vencimento, e não é escolhida à mão', () => {
    const f = dados.slice(dados.indexOf('export async function editarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'patch.competencia = competenciaDaCobranca(vencimento)');
    contem(corpo, 'patch.data = vencimento');
  });

  teste('editar cobrança PAGA é barrado pelo banco', () => {
    const f = dados.slice(dados.indexOf('export async function editarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, "eq('status', 'pendente')");
    contem(corpo, "eq('nutri_id', id)");
    contem(corpo, "not('assinatura_id', 'is', null)");
    contem(corpo, 'maybeSingle()');
  });

  teste('duas abas não conseguem estado inválido', () => {
    // Nas duas funções a decisão é do UPDATE, não do botão: uma tela velha
    // simplesmente não casa com linha nenhuma e recebe null.
    for (const nome of ['cancelarCobranca', 'editarCobranca']) {
      const f = dados.slice(dados.indexOf(`export async function ${nome}`));
      contem(f.slice(0, f.indexOf('\n}')), "eq('status', 'pendente')");
    }
    // A frase mora em MSG e é referenciada pelas duas ações — cancelar e
    // editar. Contar a string literal contaria a definição, não os usos.
    igual((drawer.match(/MSG\.naoPendente/g) || []).length, 2,
          'as duas ações avisam quando a tela está velha');
  });

  teste('vencimento duplicado vira frase de gente', () => {
    // O índice único protege contra duas cobranças no mesmo período; o erro
    // cru do Postgres não diz nada a quem só queria trocar uma data.
    igual(traduzirErroCobranca(new Error('duplicate key value violates unique constraint "uq_comercial_cobranca_periodo"')),
          MSG.duplicada);
    igual(MSG.duplicada, 'Já existe uma cobrança ativa para este vencimento.');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · auditoria da cobrança já existe', () => {
  const fin = readFileSync(new URL('../db/financeiro_despesas_etapa1.sql', import.meta.url), 'utf8');

  teste('o gatilho do Financeiro cobre cancelar e editar', () => {
    // Nada de infraestrutura paralela: financeiro_lancamentos já tem gatilho.
    contem(fin, 'create trigger trg_auditoria_financeiro');
    contem(fin, 'after insert or update or delete on public.financeiro_lancamentos');
    contem(fin, "when v_depois ? 'status' and new.status = 'cancelado' then 'cancelado'");
    contem(fin, "else 'editado' end");
  });

  teste('registra valor, vencimento, status e quem fez', () => {
    contem(fin, "array['descricao', 'valor', 'status', 'competencia',");
    contem(fin, "'vencimento', 'pago_em', 'categoria_id',");
    contem(fin, 'usuario_id, antes, depois');
    contem(fin, 'auth.uid()');
  });

  teste('o Comercial não escreve auditoria por conta própria', () => {
    const dados = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
    ok(!/financeiro_auditoria|comercial_auditoria/.test(dados),
       'quem escreve é o gatilho — insert na tela é esquecido no primeiro caminho novo');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · acabamento do histórico', () => {
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  const A = { ...PENDENTE, id: 'a', vencimento: '2026-03-02', competencia: '2026-03-01' };
  const B = { ...PAGA,     id: 'b', vencimento: '2026-08-03', competencia: '2026-08-01' };
  const C = { ...PENDENTE, id: 'c', vencimento: '2026-09-02', competencia: '2026-09-01' };

  teste('ordena por vencimento decrescente, sem depender de quem chamou', () => {
    const h = historicoHtml([A, C, B], HOJE);   // fora de ordem de propósito
    const ordem = [...h.matchAll(/data-(?:registrar|ver-receita)="(\w+)"/g)].map(m => m[1]);
    igual(ordem, ['c', 'b', 'a'], 'mais recente primeiro');
  });

  teste('a hierarquia da linha: competência, valor, vencimento, situação, ações', () => {
    const h = historicoItemHtml(C, HOJE);
    const i = (s) => h.indexOf(s);
    ok(i('cm-dw-hist-comp') < i('cm-dw-hist-valor'), 'competência antes do valor');
    ok(i('cm-dw-hist-valor') < i('cm-dw-hist-venc'), 'valor antes do vencimento');
    ok(i('cm-dw-hist-venc') < i('cm-badge'), 'vencimento antes da situação');
    ok(i('cm-badge') < i('cm-dw-hist-acoes'), 'situação antes das ações');
  });

  teste('os três botões têm pesos diferentes', () => {
    const h = historicoItemHtml(C, HOJE);
    contem(h, 'cm-btn-mini cm-btn-forte" type="button" data-registrar');
    contem(h, 'cm-btn cm-btn-mini" type="button" data-editar-cobranca');
    contem(h, 'cm-btn-mini cm-btn-sutil" type="button" data-cancelar-cobranca');
    // E remover só fica vermelho no hover.
    const css = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');
    contem(css, '.cm-btn-sutil:hover');
    ok(!/\.cm-btn-sutil \{[^}]*color:\s*var\(--danger/.test(css));
  });

  teste('a paga mostra data, forma e valor pago', () => {
    const h = historicoItemHtml({ ...B, forma_pagamento: 'pix', valor_pago: 330 }, HOJE);
    contem(h, 'Paga em 03/08/2026');
    contem(h, 'Pix');
    contem(h, '330,00');
    contem(h, 'data-ver-receita');
  });

  teste('sem forma de pagamento, não inventa separador solto', () => {
    const h = historicoItemHtml(B, HOJE);
    contem(h, 'Paga em 03/08/2026');
    ok(!/Paga em 03\/08\/2026 · ·/.test(h));
    igual(formaRotulo('pix'), 'Pix');
    igual(formaRotulo(null), null);
    igual(formaRotulo('inventada'), null);
  });

  teste('cancelada mostra só o badge — a data viria de consulta nova', () => {
    // `atualizado_em` não tem gatilho em financeiro_lancamentos, então não há
    // leitura simples da data de cancelamento. Ler a auditoria custaria a
    // consulta que "Ver canceladas" não pode fazer.
    const h = historicoItemHtml({ ...A, status: 'cancelado' }, HOJE);
    contem(h, 'cm-c-cancelado');
    contem(h, 'Cancelada');
    ok(!/Cancelada em/.test(h), 'não afirmar data que não temos');
    ok(!/financeiro_auditoria/.test(drawer), 'e nada de ir buscá-la ao abrir');
  });

  teste('o estado de "ver canceladas" sobrevive ao recarregar', () => {
    // É variável do fechamento do drawer, e `desenhar()` a repassa — remover
    // uma cobrança com a lista aberta não pode fechá-la de volta.
    contem(drawer, 'let mostrarCanceladas = false');
    contem(drawer, 'drawerHtml({ assinatura, cobrancas, hoje, mostrarCanceladas })');
    ok(!/localStorage|sessionStorage/.test(drawer), 'não persiste globalmente');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · o drawer não fecha na cara do usuário', () => {
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  teste('remover recarrega em vez de fechar', () => {
    const bloco = drawer.slice(drawer.indexOf('data-cancelar-cobranca]'), drawer.indexOf('data-editar-cobranca]'));
    contem(bloco, 'await recarregar()');
    ok(!/\bfechar\(\)/.test(bloco), 'fechar obrigaria a reabrir o cliente para ver o efeito do clique');
  });

  teste('recarregar rebusca e redesenha, sem reload da aplicação', () => {
    const f = drawer.slice(drawer.indexOf('async function recarregar()'));
    const corpo = f.slice(0, f.indexOf('\n    }'));
    contem(corpo, 'dados.cobrancasDaAssinatura(assinatura.id)');
    contem(corpo, 'desenhar()');
    contem(corpo, 'aoMudar?.()');
    ok(!/location\.reload|location\.href/.test(drawer));
  });

  teste('editar devolve ao cliente — salvando, voltando ou fechando', () => {
    contem(drawer, 'aoVoltar: () => abrirDrawerCliente({ assinatura, aoMudar })');
    contem(drawer, 'function voltar(fechar) { fechar(); aoVoltar?.(); }');
    // Depois de salvar: fecha a edição, avisa a tela e reabre o cliente.
    const f = drawer.slice(drawer.indexOf("querySelector('[data-salvar]')", drawer.indexOf('abrirEdicaoCobranca')));
    ok(f.indexOf('aoMudar?.()') < f.indexOf('aoVoltar?.()'));
  });

  teste('a situação é recalculada, nunca guardada', () => {
    // Não existe status "vencida" GRAVADO: redesenhar já recalcula dias,
    // situação e o que entra no total a receber.
    //
    // A conferência é sobre o que se ESCREVE no banco, não sobre variável de
    // render — `atrasoEmDias()` devolve `{ vencida: true }` justamente porque
    // é cálculo, e proibir isso proibiria o próprio recálculo.
    const dados = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
    ok(!/update\([^)]*vencid/i.test(dados), 'nada de gravar "vencida" como estado');
    ok(!/status:\s*'vencida'/.test(drawer + dados));
    contem(drawer, 'situacaoDaCobranca(c, hoje)');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · mensagens padronizadas', () => {
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  teste('as quatro frases do briefing, num lugar só', () => {
    igual(MSG.atualizada, 'Cobrança atualizada.');
    igual(MSG.removida, 'Cobrança removida.');
    igual(MSG.naoPendente, 'Esta cobrança não está mais pendente. Atualize os dados e tente novamente.');
    igual(MSG.duplicada, 'Já existe uma cobrança ativa para este vencimento.');
  });

  teste('nenhuma mensagem técnica chega ao usuário', () => {
    for (const cru of ['duplicate key value violates unique constraint "x"',
                       'new row violates row-level security policy',
                       'TypeError: cannot read property']) {
      const t = traduzirErroCobranca(new Error(cru));
      naoContem(t, 'violates');
      naoContem(t, 'constraint');
      naoContem(t, 'TypeError');
    }
    // E os handlers não concatenam mais o erro cru na frase.
    ok(!/\+ \(e\?\.message \|\| e\)/.test(drawer), 'nada de "não consegui: <erro do Postgres>"');
  });

  teste('sucesso é toast; problema é erro — não alert cru', () => {
    contem(drawer, 'mostrarToast(MSG.removida)');
    contem(drawer, 'mostrarToast(MSG.atualizada)');
    contem(drawer, 'mostrarErro(MSG.naoPendente)');
    ok(!/alert\(/.test(drawer.slice(drawer.indexOf('abrirDrawerCliente'))),
       'alert bloqueia a tela e não combina com o resto do painel');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · edição: contexto e aviso', () => {
  teste('cliente, plano e competência aparecem como LEITURA', () => {
    const h = formEdicaoHtml({ cobranca: PENDENTE, assinatura: ASS, form: edicaoVazia(PENDENTE), hoje: HOJE });
    contem(h, 'cm-dw-leitura');
    contem(h, 'Cliente');
    contem(h, 'Claudia Marcia Delpiero');
    contem(h, 'Plano');
    contem(h, 'Mensal - 3x');
    contem(h, 'Competência');
    contem(h, 'Setembro/2026');
    // Leitura, não campo desabilitado: campo cinza convida a tentar clicar.
    ok(!/disabled|readonly/.test(h));
  });

  teste('só valor e vencimento têm caixa de texto', () => {
    const h = formEdicaoHtml({ cobranca: PENDENTE, assinatura: ASS, form: edicaoVazia(PENDENTE), hoje: HOJE });
    const inputs = [...h.matchAll(/<(?:input|textarea|select)[^>]*id="(\w+)"/g)].map(m => m[1]);
    igual(inputs.sort(), ['cmEdObs', 'cmEdValor', 'cmEdVenc']);
  });

  teste('vencida ganha o aviso; em dia, não', () => {
    const vencida = { ...PENDENTE, vencimento: '2026-07-01' };
    const h = formEdicaoHtml({ cobranca: vencida, assinatura: ASS, form: edicaoVazia(vencida), hoje: HOJE });
    contem(h, 'Esta cobrança está vencida');
    contem(h, 'a situação será\n          recalculada automaticamente');

    const emDia = formEdicaoHtml({ cobranca: PENDENTE, assinatura: ASS, form: edicaoVazia(PENDENTE), hoje: HOJE });
    naoContem(emDia, 'Esta cobrança está vencida');
  });

  teste('editar o vencimento de uma vencida pode torná-la pendente de novo', () => {
    // A situação é derivada: mudar a data já muda o rótulo, sem nada a "des-vencer".
    const vencida = { ...PENDENTE, vencimento: '2026-07-01' };
    igual(atrasoEmDias(vencida, HOJE).vencida, true);
    igual(atrasoEmDias({ ...vencida, vencimento: '2026-09-02' }, HOJE).vencida, false);
  });
});
