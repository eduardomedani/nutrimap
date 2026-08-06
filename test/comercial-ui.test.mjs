// ═══════════════════════════════════════════════════════════
// COMERCIAL — a tela
// ═══════════════════════════════════════════════════════════
// A marcação é gerada aqui e conferida como marcação. O que estes testes
// protegem, além do desenho: que a tela NÃO vire a planilha de novo — 17
// colunas, linha inteira colorida, e um "Status Pagamento" que diz a mesma
// coisa que o "Status".

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  moeda, dataBR, indicadoresHtml, quebrasHtml, linhaClienteHtml, tabelaHtml,
  aplicarFiltro, ordenar, filtrosHtml, ordenacaoHtml, planosHtml, duracaoTexto,
  telaHtml, abasHtml, semSchemaHtml, COLUNAS, ABAS, FILTROS_RAPIDOS,
} from '../js/comercial-ui.js';

const HOJE = '2026-08-06';

const ass = (nome, fim, extra = {}) => ({
  id: 'a-' + nome, status: 'ativa',
  paciente: { id: 'p-' + nome, nome, telefone: '5527992264711' },
  plano: { nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia' },
  horario: 'Noturno',
  inicio_periodo: '2026-07-31', fim_periodo: fim,
  valor_contratado: 330,
  ...extra,
});

// ───────────────────────────────────────────────────────────
grupo('comercial · formatação', () => {
  teste('valor sai em real brasileiro', () => {
    contem(moeda(330), '330,00');
    contem(moeda(961), '961,00');
    igual(moeda(null), '—');
    igual(moeda('abacaxi'), '—');
  });

  teste('data sai como o brasileiro escreve', () => {
    igual(dataBR('2026-09-02'), '02/09/2026');
    igual(dataBR(null), '');
  });

  teste('duração legível, com plural certo', () => {
    igual(duracaoTexto({ duracao_valor: 30, duracao_unidade: 'dia' }), '30 dias');
    igual(duracaoTexto({ duracao_valor: 1, duracao_unidade: 'dia' }), '1 dia');
    igual(duracaoTexto({ duracao_valor: 3, duracao_unidade: 'mes' }), '3 meses');
    igual(duracaoTexto({ duracao_valor: 1, duracao_unidade: 'mes' }), '1 mês');
  });
});

grupo('comercial · indicadores', () => {
  const html = indicadoresHtml({
    ativos: 71, venceEmBreve: 8, vencidos: 5,
    recebidoNoMes: 28068, aReceber: 3300, receitaRecorrente: 28068,
  });

  teste('mostra os seis números do briefing', () => {
    contem(html, 'Ativos');
    contem(html, '71');
    contem(html, 'Vencem em 7 dias');
    contem(html, 'Vencidos');
    contem(html, 'Recebido no mês');
    contem(html, 'A receber');
    contem(html, 'Receita recorrente');
  });

  teste('recebido e a receber aparecem juntos, não um no lugar do outro', () => {
    contem(html, '28.068,00');
    contem(html, '3.300,00');
  });

  teste('a recorrente se identifica como estimativa', () => {
    contem(html, 'estimada por 30 dias');
  });

  teste('zero não vira tom de alarme', () => {
    const limpo = indicadoresHtml({ ativos: 10, venceEmBreve: 0, vencidos: 0, aReceber: 0 });
    naoContem(limpo, 'cm-kpi-risco');
    naoContem(limpo, 'cm-kpi-aviso');
  });
});

grupo('comercial · a tabela não é a planilha', () => {
  const html = tabelaHtml([ass('Claudia', '2026-09-02')], HOJE);

  teste('são dez colunas, não dezessete', () => {
    igual(COLUNAS.length, 10);
    contem(html, 'Próximo vencimento');
    contem(html, 'Situação');
    contem(html, 'Pagamento');
  });

  teste('as colunas que a planilha tinha e a tela não repete', () => {
    for (const proibida of ['Dias Vencidos', 'Mês', 'Ano', 'CONTATO Z-API', 'DISPARO', 'Status Pagamento']) {
      naoContem(html, proibida);
    }
  });

  teste('a linha inteira NÃO é colorida — a cor vive no badge', () => {
    // Linha colorida vira semáforo e o texto some. Além disso, quando metade
    // dos clientes está em algum estado, a tela vira parede de cor.
    naoContem(html, '<tr class="cm-linha vencido"');
    contem(html, '<span class="cm-badge cm-b-ativo">');
  });

  teste('o vencimento aparece com a data E com os dias', () => {
    contem(html, '02/09/2026');
    contem(html, 'Vence em 27 dias');
  });

  teste('o telefone vira link de WhatsApp com o número normalizado', () => {
    contem(html, 'https://wa.me/5527992264711');
    contem(html, '(27) 99226-4711');
  });

  teste('sem cliente, a tabela dá instrução em vez de cabeçalho vazio', () => {
    const vazio = tabelaHtml([], HOJE);
    contem(vazio, 'Nenhum cliente nesse recorte');
    naoContem(vazio, '<table');
  });

  teste('quem tem observação comercial se identifica na lista', () => {
    const comObs = tabelaHtml([ass('Ana', '2026-09-02', { observacoes: 'pediu vencimento dia 10' })], HOJE);
    contem(comObs, 'cm-tem-obs');
    // Mas o texto da observação NÃO vaza para a tabela: é do drawer.
    naoContem(comObs, 'pediu vencimento dia 10');
  });
});

grupo('comercial · situação do cliente e da cobrança são colunas diferentes', () => {
  teste('cliente ativo com cobrança pendente mostra os dois estados', () => {
    const a = ass('Eduardo', '2026-09-02', {
      cobrancaAberta: { status: 'pendente', vencimento: '2026-09-02', valor: 330 },
    });
    const html = linhaClienteHtml(a, HOJE);
    contem(html, 'cm-b-ativo');       // situação do cliente
    contem(html, 'cm-c-pendente');    // situação da cobrança
  });

  teste('cobrança vencida aparece sem que nada tenha sido gravado', () => {
    const a = ass('Ana', '2026-09-02', {
      cobrancaAberta: { status: 'pendente', vencimento: '2026-08-01', valor: 330 },
    });
    contem(linhaClienteHtml(a, HOJE), 'cm-c-vencida');
  });

  teste('sem cobrança, a coluna fica em branco e não em zero', () => {
    contem(linhaClienteHtml(ass('Ana', '2026-09-02'), HOJE), 'cm-vazio');
  });
});

grupo('comercial · filtros', () => {
  const lista = [
    ass('Ativo Longe',  '2026-12-01'),
    ass('Vence Semana', '2026-08-10'),
    ass('Vencido',      '2026-07-10'),
    ass('Cancelado',    '2026-12-01', { status: 'cancelada' }),
    ass('Pendente',     '2026-12-01', { cobrancaAberta: { status: 'pendente', vencimento: '2026-08-20' } }),
  ];
  const nomes = l => l.map(a => a.paciente.nome).sort();

  teste('"Todos" não inclui cancelado — cancelado tem chip próprio', () => {
    // O dia a dia é sobre quem está no estúdio.
    const r = aplicarFiltro(lista, { filtro: 'todos', hoje: HOJE });
    naoContem(nomes(r).join(','), 'Cancelado');
    igual(r.length, 4);
  });

  teste('cada chip recorta o que promete', () => {
    igual(nomes(aplicarFiltro(lista, { filtro: 'vencidos', hoje: HOJE })), ['Vencido']);
    igual(nomes(aplicarFiltro(lista, { filtro: 'cancelados', hoje: HOJE })), ['Cancelado']);
    igual(nomes(aplicarFiltro(lista, { filtro: 'semana', hoje: HOJE })), ['Vence Semana']);
    igual(nomes(aplicarFiltro(lista, { filtro: 'pendentes', hoje: HOJE })), ['Pendente']);
  });

  teste('"Vencem esta semana" não inclui quem JÁ venceu', () => {
    // Vencido é outro chip. Misturar os dois esconde a urgência real.
    const r = aplicarFiltro(lista, { filtro: 'semana', hoje: HOJE });
    naoContem(nomes(r).join(','), 'Vencido');
  });

  teste('a busca é por nome e ignora maiúscula', () => {
    igual(nomes(aplicarFiltro(lista, { filtro: 'todos', busca: 'VENCE', hoje: HOJE })), ['Vence Semana']);
    igual(aplicarFiltro(lista, { filtro: 'todos', busca: 'zzz', hoje: HOJE }).length, 0);
  });

  teste('os seis chips do briefing existem', () => {
    igual(FILTROS_RAPIDOS.length, 6);
    const html = filtrosHtml('vencidos');
    contem(html, 'data-filtro="vencidos"');
    contem(html, 'aria-selected="true"');
  });
});

grupo('comercial · ordenação por urgência', () => {
  const lista = [
    ass('D ativo',        '2026-12-01'),
    ass('C vence breve',  '2026-08-08'),
    ass('B vencido novo', '2026-08-05'),
    ass('A vencido velho','2026-07-10'),
  ];

  teste('vencido primeiro, e o mais antigo na frente', () => {
    // Quem está há 27 dias sem pagar importa mais que quem está há 1.
    const r = ordenar(lista, 'urgencia', HOJE).map(a => a.paciente.nome);
    igual(r, ['A vencido velho', 'B vencido novo', 'C vence breve', 'D ativo']);
  });

  teste('as outras ordens fazem o que dizem', () => {
    igual(ordenar(lista, 'nome', HOJE)[0].paciente.nome, 'A vencido velho');
    igual(ordenar(lista, 'vencimento', HOJE)[0].fim_periodo, '2026-07-10');
    igual(ordenar([ass('x', '2026-12-01', { valor_contratado: 100 }),
                   ass('y', '2026-12-01', { valor_contratado: 900 })], 'valor', HOJE)[0].valor_contratado, 900);
  });

  teste('o seletor oferece urgência como opção', () => {
    contem(ordenacaoHtml('urgencia'), 'value="urgencia" selected');
  });
});

grupo('comercial · catálogo de planos', () => {
  const planos = [
    { id: 'p1', nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia',
      frequencia_semanal: 3, preco_padrao: 330, tolerancia_dias: 5, ativo: true },
  ];
  const html = planosHtml(planos);

  teste('mostra duração, preço e tolerância — tudo configurável', () => {
    contem(html, 'Mensal - 3x');
    contem(html, '30 dias');
    contem(html, '3x/semana');
    contem(html, '330,00');
    contem(html, '5 dias');
  });

  teste('avisa que mudar o preço não mexe em contrato antigo', () => {
    // É a regra do §9, e é contraintuitiva o bastante para estar na tela.
    contem(html, 'não altera');
  });

  teste('sem plano, oferece criar em vez de tabela vazia', () => {
    const vazio = planosHtml([]);
    contem(vazio, 'Nenhum plano cadastrado');
    contem(vazio, 'data-novo-plano');
  });
});

grupo('comercial · a tela inteira', () => {
  const dados = {
    indicadores: { ativos: 71, venceEmBreve: 8, vencidos: 5, recebidoNoMes: 28068, aReceber: 3300 },
    assinaturas: [ass('Claudia', '2026-09-02'), ass('Ana', '2026-08-10')],
    planos: [{ id: 'p1', nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', ativo: true }],
    hoje: HOJE,
  };

  teste('as três abas do briefing existem', () => {
    igual(ABAS.map(a => a.id), ['visao', 'clientes', 'planos']);
    contem(abasHtml('clientes'), 'data-aba="clientes"');
  });

  teste('a visão geral mostra indicadores e quebras', () => {
    const html = telaHtml({ ...dados, aba: 'visao' });
    contem(html, 'Ativos');
    contem(html, 'Por plano');
    contem(html, 'Por horário');
    naoContem(html, '<table class="cm-tabela">');   // a tabela é da outra aba
  });

  teste('a aba de clientes conta quantos aparecem no recorte', () => {
    const html = telaHtml({ ...dados, aba: 'clientes' });
    contem(html, '2 clientes');
    contem(html, 'Claudia');
  });

  teste('o filtro muda a contagem', () => {
    const html = telaHtml({ ...dados, aba: 'clientes', filtro: 'vencidos' });
    contem(html, '0 clientes');
  });

  teste('sem o schema, a tela manda rodar a migração', () => {
    const html = semSchemaHtml();
    contem(html, 'comercial_etapa1_vinculo.sql');
    contem(html, 'comercial_etapa2_planos.sql');
  });
});

grupo('comercial · a camada de dados não inventa financeiro', () => {
  const fonte = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');

  teste('a cobrança é criada em financeiro_lancamentos, não em tabela própria', () => {
    contem(fonte, "from('financeiro_lancamentos')");
    naoContem(fonte, "from('comercial_cobrancas')");
  });

  teste('o pagamento grava status, pago_em e forma numa operação só', () => {
    contem(fonte, "status: 'pago'");
    contem(fonte, 'pago_em: pagoEm');
    contem(fonte, 'forma_pagamento');
  });

  teste('o pagamento renova o período usando a regra, não +30 fixo', () => {
    contem(fonte, 'renovar({ fimVigente: assinatura.fim_periodo');
    naoContem(fonte, '+ 30');
  });

  teste('toda consulta filtra pelo nutri explicitamente', () => {
    // A conta do Eduardo é nutri E paciente; policies OR'd não bastam.
    const consultas = fonte.split('.from(').length - 1;
    const filtros = fonte.split(".eq('nutri_id'").length - 1;
    ok(filtros >= consultas - 3, `consultas=${consultas} filtros=${filtros}: falta filtro explícito`);
  });

  teste('a competência da cobrança sai da regra, não é digitada', () => {
    contem(fonte, 'competencia: competenciaDaCobranca(vencimento)');
  });
});
