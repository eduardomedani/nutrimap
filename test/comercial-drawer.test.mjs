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
// A regra do vencimento nasce no formulário e termina no banco — o grupo
// que a protege precisa dos dois lados.
import { cobrancaDoPeriodoVazia, mudancaDaRenovacao, validarCobrancaDoPeriodo,
         PRAZO_COBRANCA_DIAS } from '../js/comercial-formularios.js';
// `situacaoDaCobranca` é a regra que decide se uma cobrança está vencida —
// derivada da data, nunca gravada.
import { situacaoDaCobranca } from '../js/comercial.js';

const HOJE = '2026-08-06';

const ASS = {
  id: 'a1', status: 'ativa',
  paciente: { id: 'p1', nome: 'Paciente Teste B', telefone: '5527900000000' },
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
    contem(html, 'Paciente Teste B');
    contem(html, 'cm-b-ativo');
    contem(html, 'Mensal - 3x');
    contem(html, 'Noturno');
  });

  teste('o telefone vira WhatsApp com número normalizado', () => {
    contem(html, 'https://wa.me/5527900000000');
    contem(html, '(27) 90000-0000');
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
    contem(html, 'Paciente Teste B');
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
// LAYOUT DO DRAWER
// ---------------------------------------------------------------------------
// O grupo existe por causa de um bug real: `cabecalhoHtml` emitia
// `class="cm-dw-topo"` e essa classe NÃO tinha uma linha sequer de CSS. Sem
// padding, sem flex e sem borda, o título encostava na quina e o botão fechar
// caía numa linha só dele. Nada quebrava, nenhum teste falhava — a tela só
// ficava feia, e feia de um jeito que se atribui a "precisa de um designer".
//
// Por isso os testes daqui olham CLASSE, não aparência: o que dá para prender
// em teste é o contrato entre a marcação e a folha de estilo.
// ───────────────────────────────────────────────────────────
grupo('comercial · o layout do drawer', () => {
  const css = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');
  const cab = cabecalhoHtml(ASS, HOJE);

  teste('o cabeçalho do cliente usa a classe de cabeçalho que existe no CSS', () => {
    // A regressão original. `cm-dw-topo` sozinha era um nome órfão.
    contem(cab, 'cm-drawer-topo cm-dw-topo');
    contem(css, '.cm-drawer-topo');
    contem(css, '.cm-dw-topo');
  });

  teste('TODA classe que o drawer emite tem regra no CSS', () => {
    // A rede que teria pegado o bug. Varre o HTML de verdade — cabeçalho,
    // assinatura, cobrança e histórico — e cobra uma regra para cada classe
    // própria do módulo.
    const html = drawerHtml({
      assinatura: { ...ASS, observacoes: 'prefere Pix' },
      cobrancas: [PENDENTE, PAGA, { ...PAGA, id: 'c9', status: 'cancelado' }],
      hoje: HOJE, mostrarCanceladas: true,
    }) + formPagamentoHtml({ cobranca: PENDENTE, assinatura: ASS, form: pagamentoVazio(PENDENTE), hoje: HOJE })
      + formEdicaoHtml({ cobranca: PENDENTE, assinatura: ASS, form: edicaoVazia(PENDENTE), hoje: HOJE });

    const classes = new Set();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].trim().split(/\s+/)) if (c.startsWith('cm-')) classes.add(c);
    }
    ok(classes.size > 25, `esperava varrer o drawer inteiro, achei ${classes.size} classes`);

    const orfas = [...classes].filter(c => !css.includes(`.${c}`)).sort();
    igual(orfas.join(', '), '', 'classes sem uma linha de CSS');
  });

  teste('o nome tem classe própria e reserva o espaço do botão fechar', () => {
    // Grid de duas colunas: a do nome e a do X. Sem a coluna reservada, nome
    // comprido empurra o botão para a linha de baixo — que era o sintoma.
    contem(cab, 'class="cm-dw-nome"');
    const regra = css.slice(css.indexOf('.cm-dw-topo {'), css.indexOf('.cm-dw-id {'));
    contem(regra, 'display: grid');
    contem(regra, 'grid-template-columns: minmax(0, 1fr) auto');
    // E o nome não passa de duas linhas.
    contem(css.slice(css.indexOf('.cm-dw-nome {')), '-webkit-line-clamp: 2');
  });

  teste('a alça do sheet é decoração, não conteúdo', () => {
    contem(cab, 'cm-dw-alca');
    contem(cab, 'aria-hidden="true"');
    // Escondida por padrão; só o celular a mostra.
    contem(css, '.cm-dw-alca { display: none; }');
  });

  teste('as linhas de dado são grade de duas colunas, não space-between', () => {
    // Com flex, rótulo curto e rótulo longo alinhavam o valor em posições
    // diferentes e a coluna da direita ficava serrilhada.
    const regra = css.slice(css.indexOf('.cm-dw-linha {'), css.indexOf('.cm-dw-rot'));
    contem(regra, 'display: grid');
    contem(regra, 'grid-template-columns: minmax(130px, 0.8fr) minmax(0, 1.2fr)');
    contem(regra, 'gap: 16px');
  });

  teste('o atraso é linha secundária, e só fica vermelho quando é atraso', () => {
    const vencido = assinaturaHtml({ ...ASS, fim_periodo: '2025-08-17' }, HOJE);
    contem(vencido, 'cm-dw-sub-val cm-dw-alerta');
    contem(vencido, 'Vencido há');
    // Em dia, a mesma informação existe sem a cor de alerta.
    const emDia = assinaturaHtml(ASS, HOJE);
    contem(emDia, 'cm-dw-sub-val');
    contem(emDia, 'Vence em 27 dias');
    ok(!/cm-dw-alerta/.test(emDia), 'cliente em dia não é alarme');
  });

  teste('a data e o atraso não vão na mesma frase', () => {
    // Concatenados com "·" eles comprimiam a data justamente quando o texto
    // era maior — ou seja, quanto mais atrasado, pior de ler.
    const h = assinaturaHtml({ ...ASS, fim_periodo: '2025-08-17' }, HOJE);
    ok(!/17\/08\/2025[^<]*·/.test(h), 'atraso em elemento próprio, não colado na data');
  });

  teste('o de/para é UM bloco — a seta nunca fica sozinha no fim da linha', () => {
    // Escrito como texto corrido, o navegador quebrava logo depois da seta e
    // deixava o valor novo sozinho embaixo. A seta não é conteúdo: é a relação
    // entre os dois valores.
    const planos = [{ id: 'p-a', nome: 'Trimestral - 5x' }, { id: 'p-b', nome: 'Mensal - 3x' }];
    const a = { ...ASS, plano_id: 'p-a', proximo_plano_id: 'p-b',
                valor_contratado: 311, proximo_valor_contratado: 330,
                renovacao_definida_em: '2026-08-13T12:00:00Z' };
    const h = drawerHtml({ assinatura: a, cobrancas: [], hoje: HOJE, planos });

    // Só os dígitos: `moeda()` usa toLocaleString, que separa "R$" do número
    // com espaço NÃO-QUEBRÁVEL. Escrever "R$ 311,00" com espaço comum aqui
    // faria o teste falhar por um caractere invisível.
    contem(h, 'class="cm-dw-de">R$');
    contem(h, '311,00</span>');
    contem(h, 'class="cm-dw-para">R$');
    contem(h, '330,00</b>');
    contem(h, '<span class="cm-dw-seta" aria-hidden="true">→</span>');
    // Nada de `<br>` para montar o de/para.
    ok(!/<br\s*\/?>/i.test(h), 'quebra de linha manual não é layout');
    // A seta é decoração: leitor de tela não deve anunciá-la.
    ok(!/class="cm-dw-seta"(?![^>]*aria-hidden)/.test(h));
  });

  teste('o bloco de comparação não quebra, e cola à direita no desktop', () => {
    const regra = css.slice(css.indexOf('.cm-dw-depara {'), css.indexOf('.cm-dw-de '));
    contem(regra, 'display: flex');
    contem(regra, 'justify-content: flex-end');
    contem(regra, 'align-items: center');
    contem(regra, 'white-space: nowrap');
    contem(regra, 'gap: 6px');
    // O período vigente tem a mesma natureza: duas datas ligadas por uma seta.
    contem(css, '.cm-dw-periodo { white-space: nowrap; }');
  });

  teste('no celular o conjunto desce inteiro, não pela metade', () => {
    // A linha empilha (rótulo em cima, valor embaixo) e o valor continua
    // `nowrap` — "R$ 311,00 → R$ 330,00" numa linha só.
    const cel = css.slice(css.indexOf('@media (max-width: 640px)'));
    contem(cel, 'grid-template-columns: 1fr');
    // O nowrap do bloco vale em toda largura: não há regra que o desligue.
    ok(!/\.cm-dw-depara[^}]*white-space:\s*normal/.test(css),
       'desligar o nowrap no celular devolveria a seta pendurada');
  });

  teste('as ações ficam num bloco, colado à informação que explicam', () => {
    contem(cobrancaAbertaHtml(PENDENTE, HOJE), 'class="cm-dw-acoes"');
    contem(cobrancaAbertaHtml(null, HOJE), 'class="cm-dw-acoes"');
  });

  teste('criar cobrança continua secundária — verde é para receber', () => {
    const h = cobrancaAbertaHtml(null, HOJE);
    contem(h, 'data-criar-cobranca');
    ok(!/cm-btn-forte[^>]*data-criar-cobranca|data-criar-cobranca[^>]*cm-btn-forte/.test(h),
       'criar cobrança é preparar trabalho, não concluir');
    // E a que recebe dinheiro continua sendo a forte.
    contem(cobrancaAbertaHtml(PENDENTE, HOJE), 'cm-btn cm-btn-forte" type="button" data-registrar');
  });
});

// ───────────────────────────────────────────────────────────
// MIGRATION A — RENOVAÇÃO PROGRAMADA
// ---------------------------------------------------------------------------
// A regra que estes testes protegem: a assinatura é O QUE ESTÁ VIGENTE, e a
// renovação programada é O QUE ENTRA NO PRÓXIMO CICLO. Criar a cobrança não
// pode mexer em plano, valor nem período — se mexesse, o período que ainda
// está correndo passaria a parecer do plano novo, e o histórico deixaria de
// responder "qual plano estava vigente naquele período".
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação programada (Migration A)', () => {
  const sqlA   = readFileSync(new URL('../db/comercial_renovacao_programada.sql', import.meta.url), 'utf8');
  const desfaz = readFileSync(new URL('../db/comercial_renovacao_programada_desfazer.sql', import.meta.url), 'utf8');
  const dados  = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
  const criar  = sqlA.slice(sqlA.indexOf('function public.comercial_criar_cobranca_do_periodo'),
                            sqlA.indexOf('function public.comercial_cancelar_cobranca'));
  const cancel = sqlA.slice(sqlA.indexOf('function public.comercial_cancelar_cobranca'));

  // O SQL sem os comentários. Sem isto, uma asserção do tipo "esta migration
  // não fala em registrarPagamento" casa com o comentário que explica
  // JUSTAMENTE que ela não fala — e o teste passa a validar prosa em vez de
  // código. Foi o que aconteceu na primeira versão destes testes.
  const soCodigo = s => s.replace(/--[^\n]*/g, '');
  const sqlCodigo = soCodigo(sqlA);

  teste('as cinco colunas nascem anuláveis e sem default', () => {
    for (const c of ['proximo_plano_id', 'proximo_valor_contratado', 'renovacao_definida_em',
                     'renovacao_definida_por', 'renovacao_origem_id']) {
      contem(sqlA, `add column if not exists ${c}`);
    }
    // Default faria as 94 assinaturas nascerem com renovação programada.
    ok(!/add column if not exists (proximo|renovacao)\w*[^;]*default/i.test(sqlA),
       'coluna de intenção com default programaria todo mundo de uma vez');
  });

  teste('o plano futuro é RESTRICT e a origem é SET NULL', () => {
    contem(sqlA, 'proximo_plano_id         uuid references public.comercial_planos(id) on delete restrict');
    contem(sqlA, 'renovacao_origem_id      uuid references public.financeiro_lancamentos(id) on delete set null');
  });

  teste('renovação programada sempre nomeia o plano que entra', () => {
    // Sem isso existiria "tem valor futuro e não se sabe de que plano", e o
    // pagamento teria que adivinhar a duração do próximo período.
    contem(sqlA, 'check ((renovacao_definida_em is null) = (proximo_plano_id is null))');
  });

  teste('a RPC NÃO toca no contrato vigente', () => {
    // O coração da Solução D. Se um dia alguém acrescentar plano_id ou
    // fim_periodo ao update desta função, este teste cai.
    const upd = soCodigo(criar.slice(criar.indexOf('update public.comercial_assinaturas')));
    const set = upd.slice(0, upd.indexOf('where'));
    // Os ALVOS da atribuição, não substrings: `proximo_valor_contratado`
    // contém `valor_contratado` e faria um `includes` acusar sozinho.
    const alvos = [...set.matchAll(/(?:^|\n)\s*(?:set\s+)?([a-z_]+)\s*=/g)].map(m => m[1]);
    for (const campo of ['plano_id', 'valor_contratado', 'inicio_periodo', 'fim_periodo']) {
      ok(!alvos.includes(campo),
         `criar cobrança não pode escrever ${campo} — isso é do pagamento`);
    }
    ok(alvos.includes('proximo_plano_id'), 'mas escreve a intenção');
  });

  teste('a intenção só é gravada quando muda de verdade', () => {
    contem(criar, 'v_prox_id      is distinct from v_ass.plano_id');
    contem(criar, 'p_proximo_valor is not null and p_proximo_valor is distinct from v_ass.valor_contratado');
    contem(criar, 'if v_muda then');
  });

  teste('dono é a organização, autor é a pessoa', () => {
    // §15: os dois não podem cair na mesma coluna.
    contem(criar, 'renovacao_definida_por   = auth.uid()');
    contem(criar, "v_org := public.organizacao_do_auth()");
    ok(!/p_nutri_id|p_organizacao/.test(sqlA), 'o dono nunca vem do frontend');
    ok(!/renovacao_definida_por\s*=\s*v_org/.test(sqlA), 'organização não é autor');
  });

  teste('as duas RPCs fazem as três validações, na ordem', () => {
    for (const f of [criar, cancel]) {
      contem(f, "raise exception 'sem sessao'");
      contem(f, 'public.organizacao_do_auth()');
      contem(f, "public.tem_permissao('comercial.editar')");
    }
  });

  teste('o TETO TEMPORÁRIO existe nas duas, e está marcado para sair', () => {
    // A RPC é SECURITY DEFINER: sem esta trava ela concederia à Recepção o que
    // a RLS de comercial_assinaturas ainda nega, e a Etapa 4 entraria pela
    // porta dos fundos.
    for (const f of [criar, cancel]) {
      contem(f, 'v_ass.nutri_id is distinct from auth.uid()');
      // O marcador vive na MENSAGEM DA EXCEÇÃO, não num comentário: o arquivo
      // _LIMPO tira toda linha `--` antes de ir para o SQL Editor, e um aviso
      // escrito como comentário chegaria ao banco apagado. Foi o que a
      // conferência de 13/08/2026 pegou — a trava estava lá, o aviso não.
      contem(soCodigo(f), 'REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS');
    }
  });

  teste('o _LIMPO leva o teto e os grants para o banco', () => {
    // O que o SQL Editor recebe é o _LIMPO. Se uma garantia só existir como
    // comentário, ela não existe em produção.
    const limpo = readFileSync(new URL('../db/comercial_renovacao_programada_LIMPO.sql', import.meta.url), 'utf8');
    ok(!/^\s*--/m.test(limpo), 'nenhum comentário sobra no arquivo de colar');
    contem(limpo, 'REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS');
    contem(limpo, 'v_ass.nutri_id is distinct from auth.uid()');
    // E o revoke que faltou na primeira aplicação: sem `authenticated`, os
    // default privileges do Supabase deixam a trilha aberta para insert.
    contem(limpo, 'revoke all    on table public.comercial_assinatura_auditoria from public, anon, authenticated;');
  });

  teste('cancelar a cobrança limpa a intenção que ELA programou', () => {
    contem(cancel, 'if v_ass.renovacao_origem_id = v_lanc.id then');
    contem(cancel, "'renovacao_cancelada'");
    // As cinco, não algumas.
    for (const c of ['proximo_plano_id         = null', 'proximo_valor_contratado = null',
                     'renovacao_definida_em    = null', 'renovacao_definida_por   = null',
                     'renovacao_origem_id      = null']) {
      contem(cancel, c);
    }
  });

  teste('a segunda FK para comercial_planos não pode quebrar os embeds', () => {
    // A REGRESSÃO QUE ESTE TESTE EXISTE PARA IMPEDIR. A Migration A criou
    // `proximo_plano_id`, e com isso `comercial_assinaturas` passou a ter DUAS
    // chaves estrangeiras para `comercial_planos`. O PostgREST deixou de saber
    // qual seguir em `plano:comercial_planos(*)`, recusou a consulta inteira
    // (PGRST201) e a tela do Comercial parou de carregar.
    //
    // Nenhum teste pegou: todos leem o texto dos arquivos, nenhum executa uma
    // consulta PostgREST de verdade. Este aqui trava o contrato entre as duas
    // coisas — a FK nova no SQL e a dica no embed.
    contem(sqlA, 'add column if not exists proximo_plano_id         uuid references public.comercial_planos(id)');

    // Só a forma de EMBED — `apelido:tabela!dica(colunas)` dentro de um
    // `.select()`. `from('comercial_planos')` e as menções em comentário não
    // entram: a primeira versão deste teste pegava as duas e acusava sozinha.
    const embeds = dados.match(/\w+:comercial_planos[^(]*\(/g) || [];
    const semDica = embeds.filter(e => !e.includes('!plano_id'));
    igual(semDica.join(', '), '', 'embed de comercial_planos sem dizer qual FK seguir');
    igual(embeds.length, 5, 'os cinco embeds do arquivo');
  });

  teste('a auditoria tem as três ações, e não duas para o mesmo fato', () => {
    contem(sqlA, "check (acao in ('renovacao_programada', 'renovacao_cancelada', 'renovada'))");
    ok(!/renovacao_aplicada|plano_alterado/.test(sqlCodigo),
       'seriam um segundo evento para o mesmo fato — o antes/depois já conta');
  });

  teste('a trilha é só de leitura pela anon-key', () => {
    contem(sqlA, 'revoke all    on table public.comercial_assinatura_auditoria from public, anon');
    contem(sqlA, 'grant  select on table public.comercial_assinatura_auditoria to authenticated');
    const pol = sqlA.match(/create policy comercial_assinatura_auditoria_\w+/g) || [];
    igual(pol.length, 1, 'só SELECT tem policy — quem escreve é a RPC');
  });

  teste('as funções nascem fechadas para anon', () => {
    contem(sqlA, 'revoke all on function public.comercial_criar_cobranca_do_periodo');
    contem(sqlA, 'revoke all on function public.comercial_cancelar_cobranca(uuid)');
    contem(sqlA, 'grant execute on function public.comercial_criar_cobranca_do_periodo');
  });

  teste('Migration A não encosta em registrarPagamento nem na Etapa 4A', () => {
    ok(!/registrarPagamento|comercial_registrar_pagamento/.test(sqlCodigo), 'isso é a Migration B');
    ok(!/create policy comercial_planos|comercial_planos_select/.test(sqlCodigo), 'Etapa 4A intacta');
    ok(!/alter table public\.financeiro_lancamentos/.test(sqlA), 'nenhuma coluna nova no financeiro');
  });

  teste('o rollback padrão preserva as colunas', () => {
    contem(desfaz, 'drop function if exists public.comercial_criar_cobranca_do_periodo');
    contem(desfaz, 'set proximo_plano_id         = null');
    // O destrutivo existe, comentado, e não roda sozinho.
    contem(desfaz, '--   alter table public.comercial_assinaturas drop column if exists proximo_plano_id;');
    ok(!/^\s*alter table public\.comercial_assinaturas drop column/m.test(desfaz),
       'drop column não pode rodar por engano numa tabela com 94 assinaturas');
  });

  teste('a camada de dados manda decisão, não identidade', () => {
    const f = dados.slice(dados.indexOf('export async function criarCobrancaDoPeriodo'));
    contem(f, "sb.rpc('comercial_criar_cobranca_do_periodo'");
    ok(!/p_nutri_id|nutri_id:/.test(f.slice(0, f.indexOf('\n}'))), 'o dono é do banco');
  });

  teste('o botão ABRE o formulário — não cria mais num clique', () => {
    const h = drawer.slice(drawer.indexOf("querySelector('[data-criar-cobranca]')"));
    const corpo = h.slice(0, h.indexOf('\n      });'));
    contem(corpo, 'abrirFormularioCobrancaPeriodo');
    ok(!/dados\.criarCobranca\(/.test(corpo), 'criar direto era o erro conceitual');
  });

  teste('a confirmação de remoção avisa da troca programada', () => {
    const t = textoRemocao(PENDENTE, HOJE, {
      assinatura: { ...ASS, plano_id: 'p-tri', proximo_plano_id: 'p-men', renovacao_origem_id: 'c1' },
      planos: [{ id: 'p-tri', nome: 'Trimestral - 5x' }, { id: 'p-men', nome: 'Mensal - 3x' }],
    });
    contem(t, 'troca de Trimestral - 5x para Mensal - 3x');
    contem(t, 'Removê-la cancela a troca');
  });

  teste('sem troca programada, a confirmação não inventa aviso', () => {
    // `conferido: true` = quem chamou acabou de ler a assinatura do banco.
    const t = textoRemocao(PENDENTE, HOJE, { assinatura: ASS, planos: [], conferido: true });
    naoContem(t, 'cancela a troca');
    naoContem(t, 'Não foi possível confirmar');
  });

  // ── CAMPO AUSENTE ≠ AUSÊNCIA DE RENOVAÇÃO ──────────────────────────────
  // O defeito de 13/08/2026: o drawer aberto pela lista trazia a assinatura do
  // cache de `_dados.assinaturas`, sem os campos da renovação, e a confirmação
  // concluía "não há troca" em silêncio. Duas guardas agora: o texto sabe
  // dizer que NÃO SABE, e quem chama relê o banco antes de perguntar.
  teste('sem conferir o banco, a confirmação NÃO conclui "não há renovação"', () => {
    const t = textoRemocao(PENDENTE, HOJE, { assinatura: ASS, planos: [] });
    contem(t, 'Não foi possível confirmar com o servidor');
    contem(t, 'Se programar, ela será cancelada junto');
  });

  teste('assinatura velha, sem os campos, também não cala', () => {
    // Exatamente o objeto que a lista servia: nem `renovacao_origem_id` existe.
    const doCache = { id: 'a1', plano_id: 'p-m5', paciente: { nome: 'X' } };
    const t = textoRemocao(PENDENTE, HOJE, { assinatura: doCache, planos: [] });
    contem(t, 'Não foi possível confirmar com o servidor');
  });

  teste('os DOIS caminhos de navegação avisam igual', () => {
    // Caminho A — remover sem sair do drawer, com a assinatura da RPC.
    // Caminho B — voltar à lista, reabrir o cliente, remover.
    //
    // Depois da correção os dois chegam ao texto com a MESMA assinatura,
    // porque o handler relê o banco antes de perguntar. O que muda é só de
    // onde o objeto veio; o texto tem que ser idêntico.
    const planos = [{ id: 'p-m5', nome: 'Mensal - 5x' }, { id: 'p-t3', nome: 'Trimestral - 3x' }];
    const fresca = { ...ASS, plano_id: 'p-m5', proximo_plano_id: 'p-t3',
                     proximo_valor_contratado: 990, renovacao_origem_id: PENDENTE.id };

    const semSair  = textoRemocao(PENDENTE, HOJE, { assinatura: fresca, planos, conferido: true });
    const pelaLista = textoRemocao(PENDENTE, HOJE, { assinatura: fresca, planos, conferido: true });

    igual(semSair, pelaLista, 'o aviso não pode depender de como o drawer foi aberto');
    contem(semSair, 'troca de Mensal - 5x para Trimestral - 3x');
    contem(semSair, 'Removê-la cancela a troca');
  });

  teste('o handler relê o banco ANTES de montar a confirmação', () => {
    // É o que faz o caminho B chegar com a assinatura certa. Sem isto, o
    // texto acima até sabe avisar, mas nunca recebe o dado para avisar.
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const bloco = js.slice(js.indexOf('data-cancelar-cobranca]'), js.indexOf('data-editar-cobranca]'));
    const posLeitura = bloco.indexOf('const conferido = await lerAssinatura()');
    const posConfirm = bloco.indexOf('confirm(textoRemocao(');
    ok(posLeitura > 0 && posConfirm > posLeitura,
       'a leitura tem que vir antes da pergunta');
    contem(bloco, 'textoRemocao(cob, hoje, { assinatura, planos, conferido })');
  });

  teste('há UMA porta para reler a assinatura, e o drawer relê ao abrir', () => {
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const abre = js.slice(js.indexOf('export async function abrirDrawerCliente'));
    const ate = abre.slice(0, abre.indexOf('return raiz('));
    contem(ate, 'async function lerAssinatura()');
    contem(ate, 'await lerAssinatura();', 'relê ao abrir, para o cache da lista não mandar');
    // UMA chamada em todo o arquivo, e ela é a de dentro do helper. Contar as
    // que vêm depois dele incluiria a própria — foi o erro da primeira versão
    // deste teste.
    const chamadas = (js.match(/dados\.assinaturaDoPaciente\(/g) || []).length;
    igual(chamadas, 1, 'toda releitura passa pelo helper — sem segunda porta');
    const corpoHelper = js.slice(js.indexOf('async function lerAssinatura()'));
    contem(corpoHelper.slice(0, corpoHelper.indexOf('\n  }')), 'dados.assinaturaDoPaciente(assinatura.paciente_id)');
  });

  teste('criar cobrança avisa a lista — o cache não pode envelhecer', () => {
    // A causa raiz do defeito: `aoMudar` é o que recarrega
    // `_dados.assinaturas` em js/comercial-ui.js.
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const h = js.slice(js.indexOf("querySelector('[data-criar-cobranca]')"));
    const corpo = h.slice(0, h.indexOf('\n      });'));
    contem(corpo, 'aoMudar?.();');
    ok(corpo.indexOf('aoMudar?.();') < corpo.indexOf('abrirDrawerCliente('),
       'a lista se atualiza antes de o drawer reabrir');
  });

  teste('a renovação programada aparece no drawer, separada do vigente', () => {
    const a = { ...ASS, plano_id: 'p-tri', proximo_plano_id: 'p-men',
                proximo_valor_contratado: 330, renovacao_definida_em: '2026-08-13T12:00:00Z' };
    const planos = [{ id: 'p-tri', nome: 'Trimestral - 5x' }, { id: 'p-men', nome: 'Mensal - 3x' }];
    const h = drawerHtml({ assinatura: a, cobrancas: [], hoje: HOJE, planos });
    contem(h, 'Próxima renovação');
    // O de/para agora é um bloco `nowrap`, não texto corrido: a seta não
    // pode ficar pendurada no fim da linha com o valor novo sozinho embaixo.
    contem(h, 'class="cm-dw-depara"');
    contem(h, '<span class="cm-dw-de">Trimestral - 5x</span>');
    contem(h, '<b class="cm-dw-para">Mensal - 3x</b>');
    contem(h, 'Entra em vigor quando a cobrança deste período for paga');
    // E a seção Assinatura continua contando o VIGENTE.
    contem(h, 'Mensal - 3x');
    // Sem renovação programada, a seção não existe.
    naoContem(drawerHtml({ assinatura: ASS, cobrancas: [], hoje: HOJE, planos }), 'Próxima renovação');
  });
});

// ───────────────────────────────────────────────────────────
// MIGRATION B — O PAGAMENTO NUMA TRANSAÇÃO SÓ
// ---------------------------------------------------------------------------
// A regra: UM PAGAMENTO = EXATAMENTE UMA RENOVAÇÃO. E o período só avança
// dentro da RPC — não existe um segundo lugar no sistema que chame a regra de
// renovação depois dela.
//
// Estes testes leem o SQL. Não substituem rodar a migration: provam que o que
// está escrito faz o que foi combinado, e travam quem for editar depois.
// ───────────────────────────────────────────────────────────
grupo('comercial · pagamento transacional (Migration B)', () => {
  const sqlB   = readFileSync(new URL('../db/comercial_pagamento_transacional.sql', import.meta.url), 'utf8');
  const desfaz = readFileSync(new URL('../db/comercial_pagamento_transacional_desfazer.sql', import.meta.url), 'utf8');
  const dados  = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
  const soCodigo = s => s.replace(/--[^\n]*/g, '');
  const rpc = sqlB.slice(sqlB.indexOf('function public.comercial_registrar_pagamento'));
  const rpcCodigo = soCodigo(rpc);

  // A — pagamento normal, sem programação
  teste('A. sem renovação programada, entram o plano e o valor VIGENTES', () => {
    contem(rpcCodigo, 'if v_ass.proximo_plano_id is not null then');
    contem(rpcCodigo, 'v_plano_id := v_ass.plano_id;');
    contem(rpcCodigo, 'v_valor    := v_ass.valor_contratado;');
  });

  // B, C, D — programação de plano, de valor, ou dos dois
  teste('B/C/D. com programação, entram o plano e o valor PROGRAMADOS', () => {
    contem(rpcCodigo, 'v_plano_id := v_ass.proximo_plano_id;');
    // Valor futuro em branco significa "não mexi no preço": cai no vigente.
    contem(rpcCodigo, 'v_valor    := coalesce(v_ass.proximo_valor_contratado, v_ass.valor_contratado);');
  });

  // E — a tolerância é do plano que ENTRA
  teste('E. duração e tolerância saem do plano que ENTRA, nunca do que sai', () => {
    // O plano é carregado DEPOIS de v_plano_id ser resolvido — é isso que faz
    // a tolerância ser a do plano novo quando há troca.
    const posEscolha = rpcCodigo.indexOf('v_plano_id := v_ass.proximo_plano_id;');
    const posCarga   = rpcCodigo.indexOf('select * into v_plano from public.comercial_planos where id = v_plano_id;');
    ok(posEscolha > 0 && posCarga > posEscolha,
       'carregar o plano antes de escolher qual entra usaria a tolerância errada');
    contem(rpcCodigo, 'v_tolerancia := coalesce(v_plano.tolerancia_dias, 5);');
    contem(rpcCodigo, 'v_duracao    := coalesce(v_plano.duracao_valor, 30);');
    // E o cálculo usa essas variáveis, não campos da assinatura antiga.
    contem(rpcCodigo, 'if v_atraso <= v_tolerancia then');
    contem(rpcCodigo, 'v_fim := v_inicio + v_duracao;');
  });

  teste('E. a regra do início é a mesma de js/comercial.js', () => {
    // inicioDaRenovacao: dentro da tolerância continua do término anterior;
    // passando dela, começa na data do pagamento.
    contem(rpcCodigo, 'v_atraso := p_pago_em - v_ass.fim_periodo;');
    contem(rpcCodigo, 'v_inicio := v_ass.fim_periodo;');
    contem(rpcCodigo, 'v_inicio := p_pago_em;');
    // E meses continuam sendo meses calendário, como somarMeses().
    contem(rpcCodigo, "(v_inicio + (v_duracao || ' months')::interval)::date");
  });

  // F — a intenção é consumida
  teste('F. as cinco colunas são limpas no MESMO update que aplica a troca', () => {
    const upd = rpcCodigo.slice(rpcCodigo.indexOf('update public.comercial_assinaturas'));
    const set = upd.slice(0, upd.indexOf('where id = v_ass.id'));
    for (const c of ['proximo_plano_id         = null', 'proximo_valor_contratado = null',
                     'renovacao_definida_em    = null', 'renovacao_definida_por   = null',
                     'renovacao_origem_id      = null']) {
      contem(set, c);
    }
    // E o mesmo update aplica o contrato novo.
    for (const c of ['plano_id                 = v_plano_id', 'valor_contratado         = v_valor',
                     'inicio_periodo           = v_inicio', 'fim_periodo              = v_fim']) {
      contem(set, c);
    }
  });

  // G, H — uma renovação por pagamento
  teste('G/H. a trava contra dupla renovação é do BANCO', () => {
    // Duas abas, dois cliques ou um retry chegam duas vezes. A segunda não
    // encontra a cobrança pendente e sai sem renovar.
    contem(rpcCodigo, "if v_lanc.status is distinct from 'pendente' then");
    contem(rpcCodigo, "and status = 'pendente'");
    contem(rpcCodigo, "'nao_pendente'");
    // E há exatamente UM update de período na função.
    const updates = (rpcCodigo.match(/update public\.comercial_assinaturas/g) || []).length;
    igual(updates, 1, 'dois updates de assinatura seriam dois avanços de período');
  });

  teste('G. nenhum segundo lugar no sistema renova depois da RPC', () => {
    // A função preparada do frontend não pode chamar `renovar()`: a RPC já
    // fez tudo, e uma segunda conta aqui seria a dupla renovação.
    // A função inteira, e só ela. `indexOf('\n}')` pararia no fecha-chaves da
    // desestruturação dos parâmetros; ir até o fim do arquivo pegaria as
    // funções seguintes. O corte é no próximo `export`.
    const ini = dados.indexOf('export async function registrarPagamento(');
    const resto = dados.slice(ini + 10);
    const fim = resto.indexOf('\nexport ');
    const corpo = fim === -1 ? dados.slice(ini) : dados.slice(ini, ini + 10 + fim);
    ok(!/\brenovar\(/.test(corpo), 'a RPC já renovou');
    ok(!/comercial_assinaturas/.test(corpo), 'e não escreve na assinatura por fora');
    contem(corpo, "sb.rpc('comercial_registrar_pagamento'");
  });

  // I — nada parcial
  teste('I. só a cobrança seguinte tolera falha, e o motivo está escrito', () => {
    // `uq_comercial_cobranca_periodo` aqui significa que a cobrança do período
    // JÁ EXISTE — derrubar a transação desfaria um pagamento legítimo por
    // causa de algo que não precisava ser feito. Era o que o fluxo antigo já
    // fazia.
    contem(rpcCodigo, 'exception when unique_violation then');
    const blocos = (rpcCodigo.match(/exception when/g) || []).length;
    igual(blocos, 1, 'um único ponto tolerante — o resto derruba tudo');
  });

  // J — a próxima cobrança segue a regra atual
  teste('J. a próxima cobrança reproduz a regra de hoje, sem invenção', () => {
    contem(rpcCodigo, 'if p_criar_proxima and v_ass.renovacao_automatica and v_ass.valor_contratado is not null then');
    // Vence no fim do período NOVO, com o valor NOVO e a categoria da paga.
    contem(rpcCodigo, 'v_ass.fim_periodo, v_ass.fim_periodo,');
    contem(rpcCodigo, 'v_ass.valor_contratado, v_lanc.categoria_id');
  });

  // K, L — autor e dono
  teste('K/L. autor é auth.uid(), dono é a organização', () => {
    contem(rpcCodigo, "'renovada', auth.uid()");
    contem(rpcCodigo, 'v_org := public.organizacao_do_auth();');
    contem(rpcCodigo, 'v_ass.nutri_id is distinct from v_org');
    ok(!/p_nutri_id|p_organizacao/.test(sqlB), 'o dono nunca vem do frontend');
  });

  teste('K. a assinatura vem do lançamento, não do frontend', () => {
    contem(rpcCodigo, 'select * into v_ass from public.comercial_assinaturas where id = v_lanc.assinatura_id;');
    ok(!/p_assinatura/.test(rpcCodigo),
       'confiar na assinatura que a tela carregou é confiar num fim_periodo velho');
  });

  // M — teto temporário
  teste('M. o teto temporário está lá, com o marcador na mensagem', () => {
    contem(rpcCodigo, 'v_ass.nutri_id is distinct from auth.uid()');
    contem(rpcCodigo, 'REMOVER NA SUBETAPA QUE MIGRAR COMERCIAL_ASSINATURAS + FINANCEIRO_LANCAMENTOS');
  });

  // N — ACL
  teste('N. nasce fechada para anon', () => {
    contem(sqlB, 'revoke all on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean) from public, anon;');
    contem(sqlB, 'grant execute on function public.comercial_registrar_pagamento(uuid, date, numeric, text, boolean) to authenticated;');
  });

  // O — rollback
  teste('O. o rollback é só derrubar a função — a B não escreve dado', () => {
    contem(desfaz, 'drop function if exists public.comercial_registrar_pagamento');
    ok(!/^\s*(update|delete|insert|alter table)/im.test(soCodigo(desfaz).replace(/^select[\s\S]*/im, '')),
       'nada a desfazer além da função');
    // E a Migration A não pode cair junto.
    ok(!/drop function if exists public\.comercial_criar_cobranca|drop table/.test(desfaz),
       'derrubar a B não pode derrubar a A');
  });

  teste('a auditoria é UM evento, com o diff contando o que mudou', () => {
    contem(rpcCodigo, "'renovada'");
    const eventos = (rpcCodigo.match(/insert into public\.comercial_assinatura_auditoria/g) || []).length;
    igual(eventos, 1, 'plano_alterado seria um segundo evento para o mesmo fato');
    // E o diff permite responder às seis perguntas do §7.
    for (const campo of ['plano_id', 'valor_contratado', 'inicio_periodo', 'fim_periodo',
                         'renovacao_consumida', 'lancamento_id']) {
      contem(rpcCodigo, `'${campo}'`);
    }
  });

  teste('receber menos que o cobrado é barrado também no banco', () => {
    // A mesma regra de validarPagamento(), agora onde duas abas não passam.
    contem(rpcCodigo, 'p_valor_pago < v_lanc.valor');
    contem(rpcCodigo, 'pagamento parcial nao esta disponivel');
  });

  teste('a Migration B ESTÁ ativa, e não sobrou andaime', () => {
    // A função de transição foi absorvida: existe UMA registrarPagamento, e
    // ela chama a RPC. Duas funções fazendo pagamento seria justamente o
    // segundo caminho que a regra proíbe.
    ok(!/registrarPagamentoTransacional/.test(dados), 'o andaime saiu');
    contem(dados, 'export async function registrarPagamento({');
    const corpo = dados.slice(dados.indexOf('export async function registrarPagamento('));
    contem(corpo, "sb.rpc('comercial_registrar_pagamento'");
    // E o import da regra de renovação saiu junto do JS.
    ok(!/import {[^}]*renovar/.test(dados), 'sem segunda lógica capaz de avançar o período');
  });

  teste('a forma pública não mudou — os dois chamadores seguem intactos', () => {
    // `assinatura` continua na lista de parâmetros e é IGNORADA: quem resolve
    // a assinatura agora é o banco, pelo assinatura_id do lançamento. Tirá-la
    // quebraria comercial-drawer.js e financeiro-lancamento-form.js sem ganho.
    const nova = dados.slice(dados.indexOf('export async function registrarPagamento('));
    contem(nova, 'lancamentoId, assinatura: _resolvidaNoBanco, pagoEm, valorPago, formaPagamento, criarProxima = true');
    contem(nova, 'return { lancamento: data.lancamento, assinatura: data.assinatura, proxima: data.proxima };');
    // E os dois chamadores não precisaram mudar.
    const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const finan  = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');
    contem(drawer, 'dados.registrarPagamento({');
    contem(finan,  'dados.registrarPagamento({');
  });
});

// ───────────────────────────────────────────────────────────
// A PRÉVIA E A RPC PRECISAM CONCORDAR
// ---------------------------------------------------------------------------
// A regra de renovação existe em dois lugares: no SQL, que grava, e aqui, que
// prevê. É dívida conhecida e assumida — o que não pode é divergirem em
// silêncio, que foi o que aconteceu no E2E de 13/08/2026: a tela previu 12/09
// e o banco gravou 11/11.
//
// Estes testes usam os MESMOS casos dos dois lados. Mudar a regra num lugar
// sem mudar no outro derruba o grupo.
// ───────────────────────────────────────────────────────────
// A REGRA DO VENCIMENTO — cobrança criada À MÃO
// ---------------------------------------------------------------------------
// `vencimento = data de criação + 30 dias corridos`. Aprovado em 13/08/2026.
//
// A REGRA ANTERIOR ERA `assinatura.fim_periodo`, e ela nascia vencida sempre
// que o período já tinha passado — a cobrança da CASO_MENSAL_ATRASADO, emitida em 13/08 para
// um período encerrado em 16/07, aparecia "Vencida há 28 dias" no instante em
// que foi criada. Os testes que protegiam aquilo foram REMOVIDOS: não se
// mantém teste contraditório só porque é recente.
//
// QUATRO DATAS QUE NÃO SE MISTURAM:
//   A. fim do período vigente          -> assinatura.fim_periodo
//   B. vencimento da cobrança MANUAL   -> criação + 30 dias  (esta regra)
//   C. vencimento da cobrança AUTOMÁTICA pós-pagamento -> fim do período novo
//   D. vencimento da primeira cobrança de "Nova assinatura" -> fim do período
// B mudou; C e D continuam como estavam, e cada uma tem teste próprio.
// ───────────────────────────────────────────────────────────
grupo('comercial · a regra do vencimento (criação manual)', () => {
  // O caso real da Paciente Teste A, virado fixture.
  const CASO_MENSAL_ATRASADO = {
    id: 'a-lu', status: 'ativa', plano_id: 'p-m3',
    paciente: { id: 'p-lu', nome: "Paciente Teste A" },
    plano: { nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 },
    data_inicio_original: '2025-01-16',
    inicio_periodo: '2026-06-16', fim_periodo: '2026-07-16',
    valor_contratado: 311, renovacao_automatica: true,
  };
  const HOJE_LU = '2026-08-13';

  // A — a conta
  teste('A. criada em 13/08/2026 vence em 12/09/2026', () => {
    igual(cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, '2026-08-13').vencimento, '2026-09-12');
  });

  teste('A. são 30 dias CORRIDOS, não "+1 mês"', () => {
    // Os três exemplos do briefing. "+1 mês" daria 01/03 no segundo caso.
    igual(cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, '2026-01-01').vencimento, '2026-01-31');
    igual(cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, '2026-02-01').vencimento, '2026-03-03');
    igual(cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, '2026-08-13').vencimento, '2026-09-12');
    igual(PRAZO_COBRANCA_DIAS, 30);
  });

  // B — o fim do período NÃO é mais a origem
  teste('B. CASO_MENSAL_ATRASADO: vence em 12/09, e NÃO em 16/07', () => {
    const f = cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE_LU);
    igual(f.vencimento, '2026-09-12');
    ok(f.vencimento !== CASO_MENSAL_ATRASADO.fim_periodo, 'o fim do período não é o vencimento');
  });

  // G — nem por acaso
  teste('G. o fim do período não inicializa o campo, seja qual for', () => {
    // Três períodos diferentes, o mesmo dia de criação: o vencimento não se
    // move. Se `fim_periodo` voltasse a ser a origem, os três divergiriam.
    const vencs = ['2026-07-16', '2025-01-02', '2027-12-31']
      .map(fim => cobrancaDoPeriodoVazia({ ...CASO_MENSAL_ATRASADO, fim_periodo: fim }, HOJE_LU).vencimento);
    igual([...new Set(vencs)].join(','), '2026-09-12');

    const form = readFileSync(new URL('../js/comercial-formularios.js', import.meta.url), 'utf8');
    const fn = form.slice(form.indexOf('export function cobrancaDoPeriodoVazia'));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    contem(corpo, 'somarDias(hoje, PRAZO_COBRANCA_DIAS)');
    ok(!/vencimento:.*fim_periodo/.test(corpo), 'fim_periodo não inicializa o vencimento');
  });

  // C — não nasce vencida
  teste('C. cobrança criada hoje NÃO nasce vencida', () => {
    const venc = cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE_LU).vencimento;
    const cob = { id: 'c', status: 'pendente', vencimento: venc, valor: 311 };
    igual(situacaoDaCobranca(cob, HOJE_LU), 'pendente');
    igual(atrasoEmDias(cob, HOJE_LU).vencida, false);
    const h = cobrancaAbertaHtml(cob, HOJE_LU);
    contem(h, 'cm-c-pendente');
    naoContem(h, 'cm-c-vencida');
  });

  // D — o plano futuro não entra nesta conta
  teste('D. trocar o plano futuro não muda o vencimento sugerido', () => {
    // A duração de 90 dias do Trimestral só vale quando o PAGAMENTO aplicar a
    // renovação. Ela não tem nada a ver com o prazo desta cobrança.
    const base = cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE_LU);
    const comTroca = { ...base, proximo_plano_id: 'p-t3', proximo_valor: '990,00' };
    igual(mudancaDaRenovacao(comTroca, CASO_MENSAL_ATRASADO).mudou, true);
    igual(comTroca.vencimento, '2026-09-12', 'o vencimento não se move');
  });

  // E — a edição manual vence
  teste('E. data digitada à mão prevalece', () => {
    // O campo é editável, e nada no desenho o reescreve: `desenhar()` lê
    // `form`, e só `cobrancaDoPeriodoVazia` calcula — uma vez, na abertura.
    const escolhida = { ...cobrancaDoPeriodoVazia(CASO_MENSAL_ATRASADO, HOJE_LU), vencimento: '2026-08-31' };
    igual(Object.keys(validarCobrancaDoPeriodo(escolhida)).length, 0);
    const form = readFileSync(new URL('../js/comercial-formularios.js', import.meta.url), 'utf8');
    const abre = form.slice(form.indexOf('export function abrirFormularioCobrancaPeriodo'));
    ok(!/form\.vencimento\s*=/.test(abre), 'nenhum handler reescreve o vencimento');
  });

  // F — o que o banco gravou é o que a tela mostra
  teste('F. reabrir o drawer mostra o vencimento GRAVADO', () => {
    // O drawer imprime `cobranca.vencimento`, sem recalcular. Uma cobrança
    // antiga, gravada pela regra anterior, continua exibindo a data dela.
    const antiga = { id: 'c1', status: 'pendente', vencimento: '2026-07-16', valor: 311 };
    contem(cobrancaAbertaHtml(antiga, HOJE_LU), '16/07/2026');
    const nova = { id: 'c2', status: 'pendente', vencimento: '2026-09-12', valor: 311 };
    contem(cobrancaAbertaHtml(nova, HOJE_LU), '12/09/2026');
  });

  teste('a assinatura continua contando o período dela, sem se mexer', () => {
    // §14: "Período termina em 16/07" e "Vencimento 12/09" convivem na tela, e
    // é isso que deixa claro que são coisas diferentes.
    const h = assinaturaHtml(CASO_MENSAL_ATRASADO, HOJE_LU);
    contem(h, 'Período termina em');
    contem(h, '16/07/2026');
    contem(h, '16/06/2026 → 16/07/2026');
    contem(h, 'Vencido há 28 dias', 'o atraso do PERÍODO continua visível');
  });

  // O que NÃO mudou
  teste('C. a cobrança automática pós-pagamento segue no fim do período novo', () => {
    // Caminho diferente: nasce dentro do SQL, sem passar por JavaScript. O
    // pedido foi só sobre o botão manual.
    const sqlB = readFileSync(new URL('../db/comercial_pagamento_transacional.sql', import.meta.url), 'utf8');
    const insert = sqlB.slice(sqlB.indexOf('insert into public.financeiro_lancamentos'));
    contem(insert, 'v_ass.fim_periodo, v_ass.fim_periodo,');
  });

  teste('o atraso de uma cobrança vencida continua contando do vencimento dela', () => {
    const atraso = atrasoEmDias({ id: 'c', status: 'pendente', vencimento: '2026-07-16' }, HOJE_LU);
    igual(atraso.vencida, true);
    igual(atraso.dias, 28);
  });

  teste('histórico não é reescrito: o drawer não recalcula data nenhuma', () => {
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const f = js.slice(js.indexOf('export function historicoItemHtml'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'dataBR(c.vencimento)');
    ok(!/somarDias|PRAZO_COBRANCA/.test(corpo), 'o histórico imprime, não calcula');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · paridade entre a prévia e a RPC', () => {
  const MENSAL3  = { id: 'p-m3', nome: 'Mensal - 3x',     duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5,  preco_padrao: 330 };
  const TRI3     = { id: 'p-t3', nome: 'Trimestral - 3x', duracao_valor: 90, duracao_unidade: 'dia', tolerancia_dias: 5,  preco_padrao: 990 };
  const TOL_ALTA = { id: 'p-ta', nome: 'Tolerante',       duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 40, preco_padrao: 400 };
  const PLANOS = [MENSAL3, TRI3, TOL_ALTA];

  // O caso REAL da CASO_TROCA_DE_PLANO, virado fixture (§16): vigente 30 dias, futuro 90,
  // pagamento 35 dias depois do vencimento — fora da tolerância.
  const CASO_TROCA_DE_PLANO = {
    id: 'a-mar', plano_id: 'p-m3', plano: MENSAL3,
    inicio_periodo: '2026-06-09', fim_periodo: '2026-07-09',
    valor_contratado: 330,
    proximo_plano_id: 'p-t3', proximo_valor_contratado: 990,
  };

  // A. sem renovação programada, vale o plano vigente
  teste('A. sem programação, a prévia usa o plano vigente', () => {
    const p = previaDaRenovacao({ ...CASO_TROCA_DE_PLANO, proximo_plano_id: null, proximo_valor_contratado: null },
                                '2026-08-13', PLANOS);
    igual(p.inicio_periodo, '2026-08-13');
    igual(p.fim_periodo, '2026-09-12');       // 30 dias do Mensal - 3x
    igual(p.trocaPlano, false);
    igual(p.valorNovo, 330);
  });

  // B, C. com programação, vale o plano FUTURO — o bug do E2E
  teste('B/C. com programação, a prévia usa o plano futuro e a duração dele', () => {
    const p = previaDaRenovacao(CASO_TROCA_DE_PLANO, '2026-08-13', PLANOS);
    igual(p.inicio_periodo, '2026-08-13');
    igual(p.fim_periodo, '2026-11-11', 'os 90 dias do Trimestral, não os 30 do Mensal');
    igual(p.planoNome, 'Trimestral - 3x');
    igual(p.trocaPlano, true);
  });

  teste('B. é exatamente o que o banco gravou no E2E', () => {
    // db/conferencia/100 apurou 2026-08-13 -> 2026-11-11 para este caso.
    // Se a prévia divergir de novo, este teste cai antes de chegar na tela.
    const p = previaDaRenovacao(CASO_TROCA_DE_PLANO, '2026-08-13', PLANOS);
    igual(`${p.inicio_periodo} -> ${p.fim_periodo}`, '2026-08-13 -> 2026-11-11');
  });

  // D. a tolerância também vem do plano que entra
  teste('D. a tolerância é a do plano futuro, não a do vigente', () => {
    // Vigente tolera 5, futuro tolera 40, e o pagamento atrasa 35 dias.
    // Pela regra do plano que ENTRA, 35 <= 40: o período continua do término
    // anterior. Pela do vigente, começaria na data do pagamento.
    const p = previaDaRenovacao(
      { ...CASO_TROCA_DE_PLANO, proximo_plano_id: 'p-ta', proximo_valor_contratado: 400 },
      '2026-08-13', PLANOS);
    igual(p.tolerancia, 40);
    igual(p.forada, false);
    igual(p.inicio_periodo, '2026-07-09', 'continuou do término anterior');
    igual(p.fim_periodo, '2026-08-08');
  });

  // E. o valor futuro
  teste('E. o valor previsto é o programado, com o vigente como reserva', () => {
    igual(previaDaRenovacao(CASO_TROCA_DE_PLANO, '2026-08-13', PLANOS).valorNovo, 990);
    // Valor futuro em branco quer dizer "não mexi no preço" — o mesmo
    // `coalesce` da RPC.
    igual(previaDaRenovacao({ ...CASO_TROCA_DE_PLANO, proximo_valor_contratado: null }, '2026-08-13', PLANOS).valorNovo, 330);
  });

  teste('sem a lista de planos, a prévia AVISA em vez de mentir', () => {
    // Cair no plano vigente daria uma previsão errada com cara de certa.
    const p = previaDaRenovacao(CASO_TROCA_DE_PLANO, '2026-08-13', []);
    igual(p.incompleta, true);
    const html = formPagamentoHtml({
      cobranca: { ...PENDENTE, vencimento: '2026-07-09' },
      assinatura: CASO_TROCA_DE_PLANO, form: pagamentoVazio(PENDENTE), hoje: HOJE, planos: [],
    });
    contem(html, 'esta tela não conseguiu carregar');
  });

  teste('a prévia na tela nomeia a troca de plano e o valor', () => {
    const html = formPagamentoHtml({
      cobranca: { ...PENDENTE, vencimento: '2026-07-09' },
      assinatura: CASO_TROCA_DE_PLANO, form: { ...pagamentoVazio(PENDENTE), pago_em: '2026-08-13' },
      hoje: HOJE, planos: PLANOS,
    });
    contem(html, 'Mensal - 3x para <b>Trimestral - 3x</b>');
    contem(html, '11/11/2026');
    contem(html, '90 dias do plano novo');
  });

  teste('sem programação, a prévia não ganha linha nenhuma a mais', () => {
    // §6: nenhuma regressão no cenário da CASO_RENOVACAO_SIMPLES.
    const html = formPagamentoHtml({
      cobranca: PENDENTE,
      assinatura: { ...ASS, proximo_plano_id: null },
      form: { ...pagamentoVazio(PENDENTE), pago_em: '2026-08-13' }, hoje: HOJE, planos: PLANOS,
    });
    naoContem(html, 'como foi programado');
    naoContem(html, 'do plano novo');
    contem(html, 'O período passa a ser');
  });

  // I, J, K — o drawer redesenha com o que o banco confirmou
  teste('I/J. depois de criar, o drawer reabre com a assinatura da RPC', () => {
    // Reabrindo com a cópia anterior, a seção "Próxima renovação" só aparecia
    // depois de fechar e abrir o cliente — a confirmação da decisão mais
    // importante da tela ficava invisível justamente na hora de tomá-la.
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const h = js.slice(js.indexOf("querySelector('[data-criar-cobranca]')"));
    const corpo = h.slice(0, h.indexOf('\n      });'));
    contem(corpo, 'assinatura: r?.assinatura ? { ...assinatura, ...r.assinatura } : assinatura');
    ok(!/abrirDrawerCliente\(\{ assinatura, aoMudar \}\)/.test(corpo),
       'reabrir com o objeto velho é o bug 3');
  });

  teste('K. depois de cancelar, a seção some sem F5', () => {
    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const bloco = js.slice(js.indexOf('data-cancelar-cobranca]'), js.indexOf('data-editar-cobranca]'));
    contem(bloco, 'await recarregar(r?.assinatura || null)');
  });

  teste('J/K. a seção sai e entra conforme a assinatura, sem recarga', () => {
    // O drawer desenha a seção a partir do dado que recebe. Com as cinco
    // colunas preenchidas ela existe; zeradas, some. É o que torna o redesenho
    // com o estado confirmado suficiente — não há cache a invalidar.
    const planos = [{ id: 'p-t3', nome: 'Trimestral - 3x' }, { id: 'p-m3', nome: 'Mensal - 3x' }];
    const comIntencao = { ...ASS, plano_id: 'p-m3', proximo_plano_id: 'p-t3',
                          proximo_valor_contratado: 990, renovacao_definida_em: '2026-08-13T12:00:00Z' };
    contem(drawerHtml({ assinatura: comIntencao, cobrancas: [], hoje: HOJE, planos }), 'Próxima renovação');

    const semIntencao = { ...comIntencao, proximo_plano_id: null, proximo_valor_contratado: null,
                          renovacao_definida_em: null, renovacao_origem_id: null };
    naoContem(drawerHtml({ assinatura: semIntencao, cobrancas: [], hoje: HOJE, planos }), 'Próxima renovação');
  });

  teste('a prévia e a RPC resolvem o plano que entra do mesmo jeito', () => {
    // Contrato de paridade: as duas escolhem `proximo_plano_id` quando existe,
    // e o vigente quando não. Se uma mudar, o texto da outra tem que mudar.
    const sqlB = readFileSync(new URL('../db/comercial_pagamento_transacional.sql', import.meta.url), 'utf8');
    contem(sqlB, 'if v_ass.proximo_plano_id is not null then');
    contem(sqlB, 'v_plano_id := v_ass.proximo_plano_id;');
    contem(sqlB, 'coalesce(v_ass.proximo_valor_contratado, v_ass.valor_contratado)');

    const js = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
    const f = js.slice(js.indexOf('export function previaDaRenovacao'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'assinatura.proximo_plano_id');
    contem(corpo, 'assinatura.proximo_valor_contratado ?? assinatura.valor_contratado');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · o drawer no celular e no desktop', () => {
  const css = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  teste('é UM componente: não existe versão de celular em JS', () => {
    // A adaptação é toda CSS. Duas árvores de marcação seriam duas regras
    // comerciais para divergirem no primeiro ajuste.
    ok(!/drawerMobile|drawerDesktop|isMobile|matchMedia/.test(drawer),
       'a responsividade não pode virar bifurcação de lógica');
  });

  teste('mobile-first: a regra base é a do celular', () => {
    const base = css.slice(css.indexOf('.cm-drawer {'), css.indexOf('@keyframes cm-entra'));
    contem(base, 'width: 100%');
    contem(base, 'border-radius: 20px 20px 0 0');
  });

  teste('o painel lateral volta a partir do tablet, e tem teto no desktop', () => {
    contem(css, '@media (min-width: 641px)');
    contem(css, 'width: min(520px, 70vw)');
    contem(css, '@media (min-width: 901px)');
    contem(css, 'width: clamp(440px, 42vw, 560px)');
  });

  teste('o scroll acontece dentro do painel, não na página', () => {
    const corpo = css.slice(css.indexOf('.cm-drawer-corpo {'), css.indexOf('.cm-drawer-pe'));
    contem(corpo, 'overflow-y: auto');
    contem(corpo, 'overscroll-behavior: contain');
    // `min-height: 0` é o que permite o filho de flex encolher e rolar.
    contem(corpo, 'min-height: 0');
    contem(css, 'body.cm-travado { overflow: hidden; }');
  });

  teste('o cabeçalho não encolhe quando o histórico cresce', () => {
    contem(css.slice(css.indexOf('.cm-drawer-topo {')), 'flex-shrink: 0');
  });

  teste('no celular as linhas empilham em vez de espremer', () => {
    const cel = css.slice(css.indexOf('@media (max-width: 640px)'));
    contem(cel, 'grid-template-columns: 1fr');
    contem(cel, 'align-items: flex-start; text-align: left');
  });

  teste('respeita as duas áreas seguras do aparelho', () => {
    // Topo: descontado da altura, para o sheet nunca subir sob o notch.
    contem(css, 'max-height: calc(100% - env(safe-area-inset-top, 0px))');
    // Base: somado ao respiro, para a última cobrança não ficar atrás da
    // barra inferior do PWA.
    contem(css, 'calc(28px + env(safe-area-inset-bottom, 0px))');
  });

  teste('o botão fechar tem alvo de toque de 44px no celular', () => {
    const cel = css.slice(css.indexOf('@media (max-width: 640px)'));
    contem(cel, '.cm-drawer-x { width: 44px; height: 44px');
  });

  teste('nada de rolagem horizontal: o que é longo quebra', () => {
    contem(css, 'overflow-wrap: anywhere');
    const val = css.slice(css.indexOf('.cm-dw-val {'), css.indexOf('.cm-dw-val small'));
    contem(val, 'min-width: 0');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · remover a cobrança é CANCELAR, não apagar', () => {
  const dados   = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');
  const drawer  = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
  const indice  = readFileSync(new URL('../db/comercial_etapa2_planos.sql', import.meta.url), 'utf8');
  const sqlA    = readFileSync(new URL('../db/comercial_renovacao_programada.sql', import.meta.url), 'utf8');

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

  // MIGRATION A moveu estas duas regras para dentro da RPC. Elas continuam
  // valendo — mudou onde moram, e o teste passa a cobrá-las lá, que é mais
  // forte: no SQL nenhuma aba, nenhum retry e nenhum cliente alternativo passa
  // por cima.
  teste('o serviço CANCELA — não existe delete de cobrança', () => {
    const f = sqlA.slice(sqlA.indexOf('function public.comercial_cancelar_cobranca'));
    contem(f, "set status = 'cancelado'");
    ok(!/delete\s+from\s+public\.financeiro_lancamentos/i.test(f),
       'apagar a linha sumiria com o registro de um contas-a-receber');
  });

  teste('a trava contra cancelar cobrança paga é do BANCO', () => {
    // Não do botão: duas abas, ou um clique numa tela velha, passariam por
    // cima de qualquer guarda que morasse só na interface.
    const f = sqlA.slice(sqlA.indexOf('function public.comercial_cancelar_cobranca'));
    contem(f, "where id = v_lanc.id and status = 'pendente'");
    contem(f, "v_lanc.assinatura_id is null");
    contem(f, "'nao_pendente'", 'não casar é "nada mudou", não erro');
    // E o frontend traduz o `cancelou: false` para o mesmo null de antes.
    const js = dados.slice(dados.indexOf('export async function cancelarCobranca'));
    contem(js.slice(0, js.indexOf('\n}')), 'if (!data?.cancelou) return null;');
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

  // A REGRA ANTERIOR ERA `patch.competencia = competenciaDaCobranca(vencimento)`,
  // e o teste que a protegia foi REMOVIDO. Ela estava certa enquanto vencimento
  // era o fim do período: as duas contas davam no mesmo. Desde que a cobrança
  // manual passou a vencer em `criação + 30 dias`, recalcular aqui jogaria a
  // receita de um mês para outro toda vez que alguém prorrogasse um prazo.
  teste('prorrogar o vencimento NÃO move a receita de mês', () => {
    const f = dados.slice(dados.indexOf('export async function editarCobranca'));
    const corpo = f.slice(0, f.indexOf('\n}'))
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    // `data` continua acompanhando: é o dia do movimento previsto.
    contem(corpo, 'patch.data = vencimento');
    ok(!/patch\.competencia/.test(corpo),
      'a competência é do período cobrado, e o período não muda porque o prazo mudou');
    ok(!/patch\.periodo_(inicio|fim)/.test(corpo),
      'editar prazo não pode reescrever o que a cobrança cobre');
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
    // A decisão continua sendo do banco, não do botão: uma tela velha não casa
    // com linha nenhuma e recebe null. `editarCobranca` ainda decide no
    // UPDATE; `cancelarCobranca` decide dentro da RPC desde a Migration A.
    const edita = dados.slice(dados.indexOf('export async function editarCobranca'));
    contem(edita.slice(0, edita.indexOf('\n}')), "eq('status', 'pendente')");

    const rpc = readFileSync(new URL('../db/comercial_renovacao_programada.sql', import.meta.url), 'utf8');
    contem(rpc.slice(rpc.indexOf('function public.comercial_cancelar_cobranca')),
           "where id = v_lanc.id and status = 'pendente'");
    // A frase mora em MSG e é USADA pelas duas ações — cancelar e editar.
    // Contar `MSG.naoPendente` cru contaria também a linha do tradutor, que é
    // mapeamento e não aviso na tela; por isso a contagem é dos usos.
    igual((drawer.match(/mostrarErro\(MSG\.naoPendente\)/g) || []).length, 2,
          'as duas ações avisam quando a tela está velha');
    // E o tradutor leva o `pagou: false` da RPC para a mesma frase.
    contem(drawer, "if (m.includes('nao_pendente')) return MSG.naoPendente;");
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
    contem(drawer, 'drawerHtml({ assinatura, cobrancas, hoje, mostrarCanceladas, planos })');
    ok(!/localStorage|sessionStorage/.test(drawer), 'não persiste globalmente');
  });
});

// ───────────────────────────────────────────────────────────
grupo('comercial · o drawer não fecha na cara do usuário', () => {
  const drawer = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');

  teste('remover recarrega em vez de fechar', () => {
    const bloco = drawer.slice(drawer.indexOf('data-cancelar-cobranca]'), drawer.indexOf('data-editar-cobranca]'));
    // Passa a assinatura que a RPC confirmou: a seção "Próxima renovação" some
    // no mesmo redesenho, sem F5 e sem uma consulta a mais.
    contem(bloco, 'await recarregar(r?.assinatura || null)');
    ok(!/\bfechar\(\)/.test(bloco), 'fechar obrigaria a reabrir o cliente para ver o efeito do clique');
  });

  teste('recarregar rebusca e redesenha, sem reload da aplicação', () => {
    const f = drawer.slice(drawer.indexOf('async function recarregar(confirmada = null)'));
    const corpo = f.slice(0, f.indexOf('\n    }'));
    contem(corpo, 'dados.cobrancasDaAssinatura(assinatura.id)');
    contem(corpo, 'desenhar()');
    contem(corpo, 'aoMudar?.()');
    ok(!/location\.reload|location\.href/.test(drawer));
    // Com a assinatura confirmada em mãos, não vai buscar de novo — e o merge
    // preserva `paciente` e `plano`, que são embeds e não vêm da RPC.
    contem(corpo, 'if (confirmada) assinatura = { ...assinatura, ...confirmada };');
    // Sem ela, relê pelo HELPER ÚNICO — nenhuma segunda porta para o banco.
    contem(corpo, 'else await lerAssinatura();');
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
    contem(drawer, 'MSG.removidaComRenovacao : MSG.removida');
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
    contem(h, 'Paciente Teste B');
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
