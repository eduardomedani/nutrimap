// ═══════════════════════════════════════════════════════════
// COMERCIAL · RELATÓRIO DE QUEM PRECISA DE ATENÇÃO
// ═══════════════════════════════════════════════════════════
// A aba Clientes responde "como está cada um". Esta responde outra pergunta:
// "quem eu procuro hoje, e por quê". A diferença não é de apresentação — é o
// motivo vir ESCRITO, porque a folha é impressa em preto e branco e uma cor de
// badge não sobrevive à impressora.
//
// O que este arquivo protege é a regra de agrupamento. Um cliente com três
// motivos aparecendo em três blocos seria ligado três vezes, ou riscado num e
// esquecido nos outros — e é o tipo de erro que só aparece depois de a folha
// já estar na mão de alguém.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { motivosDeAtencao, agruparPorAtencao, MOTIVOS } from '../js/comercial.js';
import { relatorioHtml, ABAS, telaHtml } from '../js/comercial-ui.js';

const CSS = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../js/comercial-ui.js', import.meta.url), 'utf8');
const HOJE = '2026-09-04';

const cliente = (nome, extra = {}) => ({
  id: 'a-' + nome, status: 'ativa', horario: 'Diurno',
  fim_periodo: '2026-10-01',
  paciente: { id: 'p-' + nome, nome, telefone: '27999887766' },
  plano: { nome: 'Mensal - 5x' },
  ...extra,
});

grupo('comercial · motivos de atenção', () => {
  teste('mensalidade vencida diz HÁ QUANTOS DIAS', () => {
    // "Vencido" manda ligar; "vencido há 20 dias" manda ligar hoje. O detalhe é
    // a diferença entre uma lista que se lê e uma que se usa.
    const m = motivosDeAtencao(cliente('A', { fim_periodo: '2026-08-15' }), HOJE);
    igual(m[0].chave, 'vencido');
    igual(m[0].detalhe, 'há 20 dias');
  });

  teste('um dia é "dia", não "dias"', () => {
    const m = motivosDeAtencao(cliente('A', { fim_periodo: '2026-09-03' }), HOJE);
    igual(m[0].detalhe, 'há 1 dia');
  });

  teste('cobrança vencida é motivo próprio, separado do vencimento', () => {
    // Um cliente em dia pode ter cobrança vencida do período seguinte, e um
    // vencido pode estar com tudo pago. Misturar os dois foi o que fez a
    // planilha antiga ter duas colunas de status dizendo a mesma coisa.
    const m = motivosDeAtencao(cliente('B', {
      cobrancaAberta: { status: 'pendente', vencimento: '2026-08-30' },
    }), HOJE);
    igual(m[0].chave, 'cobranca_vencida');
    contem(m[0].detalhe, '30/08');
    contem(m[0].detalhe, 'há 5 dias');
  });

  teste('sem turno é buraco de cadastro que custa dinheiro', () => {
    // Sem turno o aluno não entra na contagem de nenhum bônus — some da conta
    // sem dar erro nenhum.
    const m = motivosDeAtencao(cliente('C', { horario: '  ' }), HOJE);
    igual(m[0].chave, 'sem_turno');
  });

  teste('cliente em ordem não gera motivo nenhum', () => {
    igual(motivosDeAtencao(cliente('D'), HOJE).length, 0);
  });

  teste('cancelado fica de fora', () => {
    // Quem cancelou não é trabalho pendente, é histórico. Campanha de
    // reativação seria outra lista, com outro nome.
    igual(motivosDeAtencao(cliente('E', { status: 'cancelada', fim_periodo: '2026-01-01' }), HOJE).length, 0);
  });

  teste('vários motivos vêm juntos, do mais grave ao menos', () => {
    const m = motivosDeAtencao(cliente('F', { fim_periodo: '2026-08-15', horario: '' }), HOJE);
    igual(m.length, 2);
    igual(m[0].chave, 'vencido');
    igual(m[1].chave, 'sem_turno');
    ok(m[0].peso < m[1].peso, 'a ordem tem que sair do peso, não da ordem de escrita');
  });

  teste('a ordem por peso não depende da ordem de escrita', () => {
    // `motivosDeAtencao` ordena por peso, e hoje MOTIVOS já está declarada em
    // ordem — então o sort parece redundante. Uma mutação provou que é: apagá-lo
    // não quebrava nada. Ele fica como defesa barata para o dia em que alguém
    // inserir um motivo no meio da lista, e ESTE teste é o que avisa nesse dia.
    const pesos = MOTIVOS.map(m => m.peso);
    igual(pesos.join(','), [...pesos].sort((a, b) => a - b).join(','),
      'MOTIVOS saiu de ordem — o sort ainda salva a saída, mas a lista ficou confusa de ler');

    // E a garantia de verdade: embaralhado, o resultado tem de sair igual.
    const embaralhado = [...MOTIVOS].reverse();
    const cli = cliente('Z', { fim_periodo: '2026-08-15', horario: '' });
    const manual = embaralhado
      .map(m => ({ chave: m.chave, peso: m.peso, detalhe: m.detalhe(cli, HOJE) }))
      .filter(m => m.detalhe)
      .sort((a, b) => a.peso - b.peso)
      .map(m => m.chave);
    igual(manual.join(','), motivosDeAtencao(cli, HOJE).map(m => m.chave).join(','));
  });

  teste('os pesos são únicos', () => {
    // Peso repetido faz a ordem depender de quem foi escrito primeiro, e a
    // folha muda de ordem sozinha quando alguém acrescenta um motivo no meio.
    const pesos = MOTIVOS.map(m => m.peso);
    igual(new Set(pesos).size, pesos.length, 'dois motivos com o mesmo peso: ' + pesos.join(','));
  });
});

grupo('comercial · agrupamento do relatório', () => {
  const lista = [
    cliente('Vencido antigo', { fim_periodo: '2026-08-10' }),
    cliente('Vencido novo', { fim_periodo: '2026-09-01' }),
    cliente('Sem turno', { horario: '' }),
    cliente('Em ordem'),
    cliente('Cancelado', { status: 'cancelada' }),
  ];

  teste('o cliente aparece UMA vez, no grupo do motivo mais grave', () => {
    // É o que faz a folha ser percorrível. Repetido, o mesmo nome seria ligado
    // duas vezes — ou riscado num bloco e esquecido no outro.
    const r = agruparPorAtencao([cliente('Duplo', { fim_periodo: '2026-08-15', horario: '' })], HOJE);
    igual(r.total, 1);
    igual(r.grupos.length, 1);
    igual(r.grupos[0].chave, 'vencido');
    igual(r.grupos[0].clientes[0].motivos.length, 2, 'o segundo motivo não pode sumir, só mudar de lugar');
  });

  teste('dentro do grupo, o mais urgente primeiro', () => {
    const r = agruparPorAtencao(lista, HOJE);
    const g = r.grupos.find(x => x.chave === 'vencido');
    igual(g.clientes[0].assinatura.paciente.nome, 'Vencido antigo',
      'quem está há 25 dias sem pagar vem antes de quem está há 3');
  });

  teste('grupos vazios não aparecem', () => {
    const r = agruparPorAtencao(lista, HOJE);
    ok(r.grupos.every(g => g.clientes.length > 0));
    ok(!r.grupos.some(g => g.chave === 'pausado'));
  });

  teste('os grupos vêm na ordem de gravidade', () => {
    const r = agruparPorAtencao(lista, HOJE);
    const pesos = r.grupos.map(g => g.peso);
    igual(pesos.join(','), [...pesos].sort((a, b) => a - b).join(','));
  });

  teste('quem está em ordem é contado, não listado', () => {
    // O número existe para dar tamanho ao trabalho: "12 na lista, 71 em ordem"
    // diz uma coisa; "12 na lista" sozinho não diz nada.
    const r = agruparPorAtencao(lista, HOJE);
    igual(r.semMotivo, 1, 'cancelado não pode ser contado como em ordem — ele sai da folha inteira');
    igual(r.total, 3);
  });
});

grupo('comercial · a folha', () => {
  const html = relatorioHtml([
    cliente('Fulano de Tal', { fim_periodo: '2026-08-15', horario: '' }),
    cliente('Beltrana', { cobrancaAberta: { status: 'pendente', vencimento: '2026-08-30' } }),
  ], HOJE);

  teste('a aba entra depois de Planos', () => {
    const ids = ABAS.map(a => a.id);
    igual(ids.join(','), 'visao,clientes,planos,relatorio');
  });

  teste('telaHtml conhece a aba', () => {
    const t = telaHtml({ aba: 'relatorio', assinaturas: [cliente('X', { fim_periodo: '2026-08-15' })], hoje: HOJE });
    contem(t, 'cm-rel-grupo');
    naoContem(t, 'cm-tabela-caixa');
  });

  teste('o motivo vem escrito, não codificado em cor', () => {
    // A folha é impressa em preto e branco. Uma badge colorida vira um
    // retângulo cinza que não informa nada.
    contem(html, 'Mensalidade vencida');
    contem(html, 'há 20 dias');
    contem(html, 'Cobrança vencida');
  });

  teste('os motivos secundários aparecem na mesma linha', () => {
    contem(html, 'cm-rel-tambem');
    contem(html, 'também: sem turno definido');
  });

  teste('o cabeçalho diz de quando é a foto', () => {
    // Folha impressa sem data vira folha de qualquer dia, e alguém liga para
    // quem já pagou na semana passada.
    contem(html, '04/09/2026');
    contem(html, 'Posição de');
  });

  teste('o telefone vem em texto, não como link', () => {
    // Na folha impressa um link não ajuda; na tela, o nome já abre o cliente.
    contem(html, '(27) 99988-7766');
    naoContem(html, 'wa.me');
  });

  teste('sem ninguém para procurar, a folha diz isso', () => {
    const limpo = relatorioHtml([cliente('Tudo certo')], HOJE);
    contem(limpo, 'Ninguém precisa de atenção agora');
    naoContem(limpo, 'cm-rel-grupo');
  });

  teste('o nome do cliente é escapado', () => {
    const perigo = relatorioHtml([cliente('<script>x</script>', { fim_periodo: '2026-08-15' })], HOJE);
    naoContem(perigo, '<script>x</script>');
    contem(perigo, '&lt;script&gt;');
  });
});

grupo('comercial · a impressão', () => {
  teste('imprime a folha, não a tela', () => {
    contem(CSS, '@media print');
    contem(CSS, '@page { size: A4 portrait; margin: 14mm 15mm; }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-abas');
    contem(bloco, 'display: none !important');
  });

  teste('em preto e branco o que separa é o filete, não o fundo', () => {
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, 'background: transparent');
    contem(bloco, 'border-bottom: 1px solid #000');
  });

  teste('um grupo não se parte entre páginas sem repetir o título', () => {
    // Quem lê a página 2 não saberia o motivo daquela lista.
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, 'page-break-inside: avoid');
    contem(bloco, 'display: table-header-group');
  });

  teste('a caixa de riscar existe só no papel', () => {
    // Na tela seria um controle que não controla nada, e um checkbox falso
    // ensina a desconfiar dos de verdade.
    contem(CSS, '.cm-rel-ok { display: none; }');
    const bloco = CSS.slice(CSS.lastIndexOf('@media print'));
    contem(bloco, '.cm-rel-ok { display: table-cell');
    contem(bloco, "content: ''");
  });

  teste('o botão chama window.print', () => {
    contem(UI, "querySelector('[data-imprimir-relatorio]')");
    contem(UI, 'window.print()');
    // `?.` porque a aba pode não estar aberta: sem ele, abrir Clientes
    // estouraria em cima de um botão que não existe naquela aba.
    contem(UI, "?.addEventListener('click', () => window.print())");
  });
});
