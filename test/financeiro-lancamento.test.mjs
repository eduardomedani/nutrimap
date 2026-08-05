// ═══════════════════════════════════════════════════════════
// DESPESA — validação, ciclo de vida e integração
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: as TRÊS DATAS não podem se confundir.
// competência é a que mês a despesa pertence, vencimento é quando vence,
// pago_em é quando o dinheiro saiu. Usar uma só para os três contextos é o
// defeito clássico do módulo financeiro — o relatório do mês fecha certo e o
// fluxo de caixa fica errado, e não há como saber qual dos dois mente.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  validarLancamento, lancamentoParaBanco, duplicarLancamento, preservarOriginal,
  statusVisual, competenciaDeData, mesesEntre, STATUS, FORMAS_PAGAMENTO, TERMOS, rotulosStatus,
} from '../js/financeiro-lancamento-validacao.js';
import {
  contasAPagar, contaNoTotal, somar, pendencias, porAno, somarDias, fimDoMes,
} from '../js/financeiro.js';
import { lancamentoVazio, lancamentoDoBanco, drawerHtml } from '../js/financeiro-lancamento-form.js';
import { filtrar, FILTRO_VAZIO, contarFiltros } from '../js/financeiro-despesas-ui.js';

const HOJE = '2026-08-05';

const valida = {
  descricao: 'Conta de energia',
  valor: '1.234,56',
  competencia: '2026-08-01',
  status: 'pendente',
  categoria_id: 'cat-1',
};

// ───────────────────────────────────────────────────────────
grupo('despesa · validação por campo, não alerta genérico', () => {
  teste('o retorno é um mapa campo → mensagem', () => {
    // Uma lista de frases obrigaria a tela a empilhar tudo no topo, e quem
    // preencheu doze campos teria que caçar qual falhou.
    const e = validarLancamento({});
    ok(e.descricao, 'faltou apontar a descrição');
    ok(e.valor, 'faltou apontar o valor');
    ok(e.competencia, 'faltou apontar a competência');
    ok(e.categoria_id, 'faltou apontar a categoria');
  });

  teste('despesa completa passa', () => {
    igual(validarLancamento(valida), {});
  });

  teste('valor tem que ser maior que zero', () => {
    ok(validarLancamento({ ...valida, valor: '0' }).valor);
    ok(validarLancamento({ ...valida, valor: '-50' }).valor);
    ok(validarLancamento({ ...valida, valor: 'abc' }).valor);
  });

  teste('"valor a definir" é estado legítimo, mas não convive com valor', () => {
    // A planilha importada tem uma linha real sem valor (REFORMA INTERNA - CP).
    igual(validarLancamento({ ...valida, valor: '', valorIndefinido: true }), {});
    ok(validarLancamento({ ...valida, valor: '100', valorIndefinido: true }).valor,
       'marcar "a definir" e informar valor é contradição');
  });

  teste('rascunho dispensa a categoria, e só ela', () => {
    igual(validarLancamento({ ...valida, categoria_id: '' }, { rascunho: true }), {});
    ok(validarLancamento({ ...valida, descricao: '' }, { rascunho: true }).descricao,
       'rascunho não dispensa a descrição');
  });

  teste('pago exige a data do pagamento', () => {
    // Sem ela o fluxo de caixa realizado fica sem eixo — e o CHECK do banco
    // recusaria a linha de qualquer forma.
    ok(validarLancamento({ ...valida, status: 'pago' }).pago_em);
    igual(validarLancamento({ ...valida, status: 'pago', pago_em: '2026-08-04' }), {});
  });

  teste('status fora da lista não passa', () => {
    ok(validarLancamento({ ...valida, status: 'vencido' }).status,
       '"vencido" não é status gravável — é derivado');
    ok(validarLancamento({ ...valida, status: 'qualquer' }).status);
    igual(Object.keys(STATUS), ['pendente', 'pago', 'cancelado']);
  });

  teste('vencimento muito longe da competência vira aviso', () => {
    igual(validarLancamento({ ...valida, vencimento: '2026-09-10' }), {},
          'um mês de distância é normal — energia de agosto vence em setembro');
    ok(validarLancamento({ ...valida, vencimento: '2027-03-10' }).vencimento);
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · as três datas não se confundem', () => {
  teste('a competência é ESCOLHIDA, não derivada do pagamento', () => {
    // Derivar da data de pagamento poria a despesa no mês errado toda vez que
    // se paga em atraso — e o mês errado não avisa que está errado.
    const b = lancamentoParaBanco({
      ...valida, competencia: '2026-07-01', status: 'pago', pago_em: '2026-08-04',
    });
    igual(b.competencia, '2026-07-01');
    igual(b.pago_em, '2026-08-04');
  });

  teste('a data do movimento cai no pagamento, senão no vencimento, senão no dia 1º', () => {
    igual(lancamentoParaBanco({ ...valida, status: 'pago', pago_em: '2026-08-04' }).data, '2026-08-04');
    igual(lancamentoParaBanco({ ...valida, vencimento: '2026-08-20' }).data, '2026-08-20');
    igual(lancamentoParaBanco(valida).data, '2026-08-01');
  });

  teste('pendente não guarda data nem forma de pagamento', () => {
    const b = lancamentoParaBanco({
      ...valida, status: 'pendente', pago_em: '2026-08-04', forma_pagamento: 'pix',
    });
    igual(b.pago_em, null);
    igual(b.forma_pagamento, null);
  });

  teste('o valor vira número com centavos preservados', () => {
    igual(lancamentoParaBanco(valida).valor, 1234.56);
    igual(lancamentoParaBanco({ ...valida, valor: '', valorIndefinido: true }).valor, null);
  });

  teste('competência sempre no primeiro dia do mês, como o CHECK exige', () => {
    igual(competenciaDeData('2026-08-23'), '2026-08-01');
    igual(competenciaDeData('2026-08'), '2026-08-01');
    igual(competenciaDeData(''), null);
    igual(mesesEntre('2026-08-01', '2026-11-01'), 3);
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · "vencido" é derivado, nunca gravado', () => {
  teste('pendente com vencimento no passado lê-se vencido', () => {
    // Gravar exigiria um job reescrevendo linhas toda meia-noite, e a linha que
    // o job não alcançasse mentiria.
    igual(statusVisual({ status: 'pendente', vencimento: '2026-08-04' }, HOJE), 'vencido');
    igual(statusVisual({ status: 'pendente', vencimento: '2026-08-05' }, HOJE), 'pendente');
    igual(statusVisual({ status: 'pendente', vencimento: '2026-09-01' }, HOJE), 'pendente');
  });

  teste('sem vencimento não vence', () => {
    igual(statusVisual({ status: 'pendente' }, HOJE), 'pendente');
  });

  teste('pago e cancelado não viram vencido', () => {
    igual(statusVisual({ status: 'pago', vencimento: '2020-01-01' }, HOJE), 'pago');
    igual(statusVisual({ status: 'cancelado', vencimento: '2020-01-01' }, HOJE), 'cancelado');
  });

  teste('linha antiga sem status usa o booleano `pago`', () => {
    // São as 2.487 linhas importadas antes da coluna existir.
    igual(statusVisual({ pago: true }, HOJE), 'pago');
    igual(statusVisual({ pago: false }, HOJE), 'pendente');
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · cancelado sai dos totais, não do registro', () => {
  const LISTA = [
    { id: '1', tipo: 'despesa', competencia: '2026-08-01', valor: 100, status: 'pago', categoria_id: 'c' },
    { id: '2', tipo: 'despesa', competencia: '2026-08-01', valor: 500, status: 'cancelado', categoria_id: 'c' },
    { id: '3', tipo: 'despesa', competencia: '2026-08-01', valor: 50, status: 'pendente', categoria_id: 'c' },
    { id: '4', tipo: 'despesa', competencia: '2026-08-01', valor: 90, status: 'pago', arquivado_em: '2026-08-01', categoria_id: 'c' },
  ];

  teste('cancelado e arquivado não somam', () => {
    igual(contaNoTotal(LISTA[0]), true);
    igual(contaNoTotal(LISTA[1]), false);
    igual(contaNoTotal(LISTA[3]), false);
    igual(somar(LISTA), 150, 'só o pago e o pendente entram');
    igual(porAno(LISTA)[0].total, 150);
  });

  teste('e também não geram alerta', () => {
    // Cobrar categoria de um lançamento desfeito é pedir trabalho por nada.
    const p = pendencias([...LISTA, { id: '5', valor: null, status: 'cancelado' }]);
    igual(p.semValor.length, 0);
    igual(p.naoPagos.map(l => l.id), ['3']);
  });

  teste('linha sem status continua contando', () => {
    // Tratá-las como canceladas zeraria os R$ 313.999,78 já importados.
    igual(somar([{ valor: 10 }, { valor: 20, pago: true }]), 30);
  });
});

// ───────────────────────────────────────────────────────────
grupo('contas a pagar · derivado, não coleção própria', () => {
  const LISTA = [
    { id: 'v', tipo: 'despesa', status: 'pendente', vencimento: '2026-07-30', valor: 100 },
    { id: 'h', tipo: 'despesa', status: 'pendente', vencimento: '2026-08-05', valor: 200 },
    { id: 'p', tipo: 'despesa', status: 'pendente', vencimento: '2026-08-09', valor: 300 },
    { id: 'f', tipo: 'despesa', status: 'pendente', vencimento: '2026-10-01', valor: 400 },
    { id: 's', tipo: 'despesa', status: 'pendente', valor: 500 },
    { id: 'x', tipo: 'despesa', status: 'pago', vencimento: '2026-08-01', valor: 600 },
    { id: 'c', tipo: 'despesa', status: 'cancelado', vencimento: '2026-08-01', valor: 700 },
    { id: 'r', tipo: 'receita', status: 'pendente', vencimento: '2026-08-01', valor: 800 },
  ];

  const cp = contasAPagar(LISTA, HOJE);

  teste('só despesa pendente COM vencimento', () => {
    igual(cp.todas.map(l => l.id), ['v', 'h', 'p', 'f']);
  });

  teste('pendente SEM vencimento fica de fora, e é contada à parte', () => {
    // Numa lista ordenada por data ela cairia em algum lugar arbitrário do
    // calendário, dando a entender uma data que ninguém informou.
    igual(cp.semVencimento.map(l => l.id), ['s']);
  });

  teste('paga, cancelada e receita não entram', () => {
    for (const id of ['x', 'c', 'r']) {
      ok(!cp.todas.some(l => l.id === id), `${id} não devia estar em contas a pagar`);
    }
  });

  teste('vencidas, hoje e próximas saem da data corrente', () => {
    igual(cp.vencidas.map(l => l.id), ['v']);
    igual(cp.hoje.map(l => l.id), ['h']);
    igual(cp.proximas.map(l => l.id), ['p']);
    igual(cp.futuras.map(l => l.id), ['f']);
  });

  teste('ordenadas por vencimento', () => {
    igual(cp.todas.map(l => l.vencimento),
          ['2026-07-30', '2026-08-05', '2026-08-09', '2026-10-01']);
  });

  teste('os atalhos de data não passam por fuso', () => {
    igual(somarDias('2026-08-05', 1), '2026-08-06');
    igual(somarDias('2026-12-31', 1), '2027-01-01');
    igual(fimDoMes('2026-02-10'), '2026-02-28');
    igual(fimDoMes('2026-08-05'), '2026-08-31');
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · estado inicial e duplicação', () => {
  teste('o formulário novo não adivinha nada', () => {
    const f = lancamentoVazio('2026-08-05');
    igual(f.status, 'pendente');
    igual(f.competencia, '2026-08-01');
    igual(f.valor, '');
    igual(f.categoria_id, '');
    igual(f.fornecedor, '');
    igual(f.vencimento, '');
  });

  teste('duplicar copia o que se repete e limpa o que não se repete', () => {
    const d = duplicarLancamento({
      id: 'x', descricao: 'Energia', valor: 900.5, categoria_id: 'c1',
      centro_custo_id: 'cc1', fornecedor: 'EDP', observacoes: 'boleto',
      status: 'pago', pago_em: '2026-07-10', forma_pagamento: 'pix',
      competencia: '2026-07-01', metadata: { original: {} },
    });
    igual(d.descricao, 'Energia');
    igual(d.categoria_id, 'c1');
    igual(d.centro_custo_id, 'cc1');
    igual(d.fornecedor, 'EDP');
    // A cópia nasce pendente: herdar o pagamento diria que saiu dinheiro que
    // não saiu.
    igual(d.status, 'pendente');
    igual(d.pago_em, null);
    igual(d.forma_pagamento, null);
    ok(!('id' in d), 'id não se duplica');
    ok(!('metadata' in d), 'metadata do original não se duplica');
  });

  teste('ida e volta do banco preserva o que foi digitado', () => {
    const f = lancamentoDoBanco({
      descricao: 'Aluguel', valor: 2500, competencia: '2026-08-01',
      vencimento: '2026-08-10', status: 'pago', pago_em: '2026-08-09',
      categoria_id: 'c1', forma_pagamento: 'boleto',
    });
    igual(f.valor, '2500,00');
    igual(f.valorIndefinido, false);
    igual(lancamentoParaBanco(f).valor, 2500);
    igual(lancamentoParaBanco(f).competencia, '2026-08-01');
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa importada · o original não se perde', () => {
  teste('a primeira edição guarda o que a planilha dizia', () => {
    // Depois dela já não há de onde recuperar.
    const m = preservarOriginal({
      origem: 'planilha', origem_linha: 42, descricao: 'Energia',
      valor: 979.5, data: '2023-11-27', competencia: '2023-11-01',
    });
    igual(m.original.descricao, 'Energia');
    igual(m.original.valor, 979.5);
    igual(m.original.origem_linha, 42);
  });

  teste('não sobrescreve o original já preservado', () => {
    igual(preservarOriginal({ origem: 'planilha', metadata: { original: { descricao: 'x' } } }), null);
  });

  teste('lançamento manual não tem original a preservar', () => {
    igual(preservarOriginal({ origem: 'manual', descricao: 'x' }), null);
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · filtros da lista', () => {
  const LISTA = [
    { id: '1', descricao: 'Energia',  categoria_id: 'c1', competencia: '2026-08-01', status: 'pago',      valor: 100, origem: 'planilha' },
    { id: '2', descricao: 'Aluguel',  categoria_id: null, competencia: '2026-08-01', status: 'pendente',  valor: null, origem: 'manual', vencimento: '2026-08-01' },
    { id: '3', descricao: 'Faxina',   categoria_id: 'c2', competencia: '2025-03-01', status: 'cancelado', valor: 400, origem: 'manual', fornecedor: 'Maria' },
  ];
  const f = (p) => filtrar(LISTA, { ...FILTRO_VAZIO, ...p }, HOJE).map(l => l.id);

  teste('sem filtro devolve tudo', () => igual(f({}), ['1', '2', '3']));
  teste('por ano', () => igual(f({ ano: '2025' }), ['3']));
  teste('sem categoria', () => igual(f({ pendencia: 'sem-categoria' }), ['2']));
  teste('sem valor', () => igual(f({ pendencia: 'sem-valor' }), ['2']));
  teste('em aberto inclui o vencido', () => igual(f({ status: 'aberto' }), ['2']));
  teste('vencido é derivado no filtro também', () => igual(f({ status: 'vencido' }), ['2']));
  teste('cancelado é filtrável — ele existe, só não soma', () => igual(f({ status: 'cancelado' }), ['3']));

  teste('categoria e origem não são mais filtros da barra', () => {
    // Saíram a pedido. O que resta tem que IGNORAR essas chaves em vez de
    // fingir que filtra: um filtro que não filtra é pior que filtro nenhum.
    igual(f({ categoria: 'sem' }), ['1', '2', '3']);
    igual(f({ origem: 'importado' }), ['1', '2', '3']);
    ok(!('categoria' in FILTRO_VAZIO));
    ok(!('origem' in FILTRO_VAZIO));
  });

  teste('a busca alcança fornecedor e observação', () => {
    igual(f({ busca: 'maria' }), ['3']);
    igual(f({ busca: 'energ' }), ['1']);
  });
  teste('filtros se combinam', () => igual(f({ ano: '2026', status: 'aberto' }), ['2']));
});

// ───────────────────────────────────────────────────────────
grupo('drawer · a marcação é GERADA no teste, não lida como texto', () => {
  // ISTO EXISTE PORQUE FALHOU. A marcação morava dentro do closure de
  // abrirLancamento, e um erro de zona morta temporal — `cls` usada antes da
  // própria declaração `const` — fazia o drawer não abrir. Nenhum teste pegou:
  // todos liam o arquivo como string e conferiam se as palavras estavam lá.
  // As palavras estavam. A função nunca tinha sido chamada.
  const CATS = [{ id: 'c1', nome: 'Energia' }, { id: 'c2', nome: 'Aluguel', ativo: false }];
  const CCS = [{ id: 'cc1', nome: 'Estrutura' }];

  teste('abre para despesa e para receita sem lançar', () => {
    for (const tipo of ['despesa', 'receita']) {
      const html = drawerHtml({ tipo, form: lancamentoVazio('2026-08-05'), categorias: CATS, centros: CCS });
      ok(html.length > 1000, `${tipo}: marcação vazia`);
      contem(html, 'class="dsp-drawer"');
      contem(html, 'id="dspSalvar"', `${tipo}: sem o botão de salvar, o drawer não grava nada`);
      contem(html, 'id="dspDescricao"');
    }
  });

  teste('o título e o subtítulo mudam com o tipo e com o modo', () => {
    const novo = t => drawerHtml({ tipo: t, form: lancamentoVazio('2026-08-05') });
    contem(novo('despesa'), 'Nova despesa');
    contem(novo('despesa'), 'Registre uma saída financeira da empresa.');
    contem(novo('receita'), 'Nova receita');
    contem(novo('receita'), 'Registre uma entrada financeira da empresa.');

    const edita = drawerHtml({ tipo: 'despesa', edicao: true, form: lancamentoVazio('2026-08-05'),
                               lancamento: { descricao: 'X' } });
    contem(edita, 'Editar despesa');
    contem(edita, 'Atualize as informações deste lançamento.');
  });

  teste('centro de custo só aparece em despesa', () => {
    // Receita não tem onde alocar: o campo seria pergunta sem resposta.
    contem(drawerHtml({ tipo: 'despesa', form: lancamentoVazio('2026-08-05'), centros: CCS }), 'id="dspCentro"');
    naoContem(drawerHtml({ tipo: 'receita', form: lancamentoVazio('2026-08-05'), centros: CCS }), 'id="dspCentro"');
  });

  teste('o erro sai embaixo do campo, e o campo se marca', () => {
    const html = drawerHtml({
      tipo: 'despesa', form: lancamentoVazio('2026-08-05'),
      erros: { descricao: 'Descreva a despesa', valor: 'Valor inválido' },
    });
    igual((html.match(/dsp-erro-campo/g) || []).length, 2);
    contem(html, 'id="dspErro-descricao"');
    contem(html, 'aria-describedby="dspErro-descricao"');
    contem(html, 'role="alert"');
  });

  teste('a data do pagamento só existe quando o status é pago', () => {
    const f = lancamentoVazio('2026-08-05');
    naoContem(drawerHtml({ tipo: 'despesa', form: f }), 'id="dspPagoEm"');
    contem(drawerHtml({ tipo: 'despesa', form: { ...f, status: 'pago' } }), 'id="dspPagoEm"');
    contem(drawerHtml({ tipo: 'despesa', form: { ...f, status: 'pago' } }), 'id="dspForma"');
  });

  teste('categoria inativa é rotulada, não escondida', () => {
    // Escondê-la faria os lançamentos antigos parecerem sem categoria.
    contem(drawerHtml({ tipo: 'despesa', form: lancamentoVazio('2026-08-05'), categorias: CATS }),
           'Aluguel (inativa)');
  });

  teste('lançamento importado mostra a origem e a linha', () => {
    const html = drawerHtml({
      tipo: 'despesa', edicao: true, form: lancamentoVazio('2026-08-05'),
      lancamento: { descricao: 'Energia', origem: 'planilha', origem_linha: 42, status: 'pago' },
    });
    contem(html, 'Origem: importação');
    contem(html, 'linha 42');
    contem(html, 'custos.csv');
  });

  teste('sem centro de custo cadastrado, o campo diz o que fazer', () => {
    // Campo desabilitado sem explicação lê-se como defeito.
    const html = drawerHtml({ tipo: 'despesa', form: lancamentoVazio('2026-08-05'), centros: [] });
    contem(html, 'financeiro_centros_custo_migrar.sql');
    contem(html, 'disabled');
  });

  teste('o valor do formulário é escapado na marcação', () => {
    const html = drawerHtml({
      tipo: 'despesa',
      form: { ...lancamentoVazio('2026-08-05'), descricao: '<script>alert(1)</script>' },
    });
    naoContem(html, '<script>alert(1)</script>');
    contem(html, '&lt;script&gt;');
  });
});

// ───────────────────────────────────────────────────────────
grupo('barra de ferramentas · a ação não quebra junto com os filtros', () => {
  const css = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
  const lista = readFileSync(new URL('../js/financeiro-despesas-ui.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');
  // `\s*` antes da chave: o CSS alinha os valores de `.dsp-f-*` com vários
  // espaços, e um regex que exigisse exatamente um não acharia a regra.
  const regra = nome => (new RegExp(`\\${nome}\\s*\\{[^}]*\\}`).exec(css) || [''])[0];

  /** O corpo de uma media query, procurada A PARTIR de um ponto. O arquivo tem
   *  vários @media do mesmo tamanho, e indexOf pega o primeiro — que costuma
   *  ser de outro componente. */
  const bloco = (de, ate, desde = 0) => {
    const i = css.indexOf(de, desde);
    if (i < 0) return '';
    const f = css.indexOf(ate, i + 1);
    return css.slice(i, f < 0 ? css.length : f);
  };

  teste('filtros e ação são containers separados', () => {
    // ACONTECEU: o botão era mais uma célula do grid `auto-fit` dos filtros.
    // Quando a largura apertava, o navegador recalculava as colunas e ele caía
    // solto na última linha. Nenhuma margem corrige isso — o defeito é o botão
    // estar no mesmo fluxo de quebra.
    for (const fonte of [lista, shell]) {
      contem(fonte, 'class="dsp-toolbar"');
      contem(fonte, 'class="dsp-toolbar-filtros"');
      contem(fonte, 'class="dsp-toolbar-acao"');
    }
    // O botão tem que estar FORA do container que quebra.
    const bloco = lista.slice(lista.indexOf('dsp-toolbar-filtros'), lista.indexOf('dsp-toolbar-acao'));
    naoContem(bloco, 'dspNova', 'o botão voltou para dentro dos filtros');
  });

  teste('o grid usa minmax(0, 1fr) — senão a barra empurra scroll horizontal', () => {
    contem(regra('.dsp-toolbar'), 'grid-template-columns: minmax(0, 1fr) auto');
    contem(regra('.dsp-toolbar'), 'align-items: start');
  });

  teste('o texto do botão não quebra nem encolhe', () => {
    const r = regra('.dsp-btn-nova');
    contem(r, 'white-space: nowrap');
    contem(r, 'flex-shrink: 0');
    contem(r, 'min-width: 152px');
    // Reduzir a fonte para caber resolveria o layout às custas da leitura.
    naoContem(r, 'font-size');
  });

  teste('nada empurra o botão com margem nem com posicionamento absoluto', () => {
    naoContem(css, '.dsp-barra #dspNova');
    naoContem(css, '.dx-filtros #fxNovo');
    naoContem(regra('.dsp-toolbar-acao'), 'position: absolute');
    naoContem(regra('.dsp-toolbar-acao'), 'margin-left: auto');
  });

  teste('a busca tem largura de busca, não de select', () => {
    const r = regra('.dsp-busca');
    contem(r, 'flex: 1 1 240px');
    contem(r, 'min-width: 220px');
    // "Buscar descrição, fornecedor ou observação..." era cortado no campo.
    contem(lista, 'placeholder="Buscar despesas"');
  });

  teste('os filtros têm largura previsível e não esticam', () => {
    // Com 1fr para todos, cinco selects vazios ocupam a tela e a busca fica do
    // tamanho de um deles.
    contem(regra('.dsp-f'), 'flex: 0 1 auto');
    for (const f of ['.dsp-f-ano', '.dsp-f-status', '.dsp-f-centro']) {
      contem(regra(f), 'min-width');
    }
  });

  teste('a barra de Despesas ficou com busca, ano, situação e centro', () => {
    for (const id of ['dspBusca', 'dspFAno', 'dspFStatus', 'dspFCentro', 'dspLimpar']) {
      contem(lista, `id="${id}"`);
    }
    naoContem(lista, 'id="dspFCat"', 'o filtro de categoria devia ter saído');
    naoContem(lista, 'id="dspFOrigem"', 'o filtro de origem devia ter saído');
  });

  teste('tudo na barra tem a mesma altura', () => {
    contem(css, '.dsp-toolbar .btn { height: 44px; }');
  });

  teste('no tablet a ação sobe, não desce', () => {
    // Empurrada para baixo dos filtros ela fica onde ninguém procura.
    const b = bloco('@media (max-width: 900px)', '@media', css.indexOf('.dsp-toolbar'));
    contem(b, '.dsp-toolbar-acao { order: -1');
    contem(b, 'grid-template-columns: 1fr');
  });

  teste('no celular os filtros recolhem atrás de um botão', () => {
    contem(lista, 'id="dspFiltrosToggle"');
    contem(lista, 'aria-expanded');
    contem(lista, 'aria-controls="dspFiltrosCampos"');
    // `display: contents` no desktop faz os selects quebrarem um a um; no
    // celular o container volta a existir para poder recolher.
    contem(regra('.dsp-filtros-campos'), 'display: contents');
    contem(css, '.dsp-filtros-campos.aberto');
  });

  teste('o contador de filtros ativos existe — lista recortada tem que se declarar', () => {
    igual(contarFiltros({ ...FILTRO_VAZIO }), 0);
    igual(contarFiltros({ ...FILTRO_VAZIO, ano: '2026' }), 1);
    igual(contarFiltros({ ...FILTRO_VAZIO, ano: '2026', status: 'aberto', busca: 'x' }), 3);
    contem(lista, 'dsp-filtros-n');
  });

  teste('o resumo fica em linha própria, fora da grade dos filtros', () => {
    contem(lista, 'class="dsp-resumo"');
    naoContem(lista, 'class="fn-contagem"', 'o resumo saiu da caixa dos filtros');
    const bloco = lista.slice(lista.indexOf('class="dsp-toolbar"'), lista.indexOf('id="dspLista"'));
    naoContem(bloco, 'dsp-resumo', 'o resumo não pode estar dentro do toolbar');
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · o que a Etapa 1 promete e o que ela não simula', () => {
  const form = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');
  const lista = readFileSync(new URL('../js/financeiro-despesas-ui.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../js/financeiro-ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');

  teste('é drawer lateral, não modal centralizado nem página', () => {
    contem(css, '.dsp-drawer {');
    const regra = /\.dsp-drawer \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'right: 0');
    contem(regra, 'clamp(560px, 46vw, 720px)', 'largura fora da faixa pedida');
  });

  teste('no celular ocupa a tela inteira', () => {
    // 90% deixaria uma faixa clicável que fecha o formulário sem querer, e o
    // que se perde é o que a pessoa acabou de digitar.
    contem(css, '.dsp-drawer { width: 100vw; border-left: none; }');
  });

  teste('o botão Nova despesa aparece na Visão geral e na lista', () => {
    contem(shell, 'fxNovaDespesa');
    contem(shell, 'Nova despesa');
    contem(lista, 'dspNova');
    contem(lista, 'dspNovaVazio', 'faltou o botão no estado vazio');
  });

  teste('as seções do formulário existem', () => {
    for (const s of ['Identificação', 'Valor e classificação', 'Datas e ',
                     'Observações', 'Ainda não disponível']) {
      contem(form, s);
    }
    // A seção de quem recebe/paga tem nome próprio de cada lado do caixa.
    igual(TERMOS.despesa.quemSecao, 'Fornecedor e documento');
    igual(TERMOS.receita.quemSecao, 'Cliente e documento');
  });

  teste('despesa e receita usam O MESMO drawer', () => {
    // Antes eram dois: modal centralizado para receita, painel lateral para
    // despesa — duas validações e dois espaçamentos, e o segundo é o que fica
    // para trás.
    contem(form, 'export async function abrirLancamento');
    igual((form.match(/export async function abrir/g) || []).length, 1, 'um drawer só');
    contem(form, "tipo = 'despesa'");
    contem(form, "ehReceita ? 'receita' : 'despesa'");
  });

  teste('as palavras mudam entre os dois lados do caixa', () => {
    // "Pago" numa venda é o contrário do que aconteceu.
    igual(rotulosStatus('receita').pago, 'Recebido');
    igual(rotulosStatus('despesa').pago, 'Pago');
    igual(TERMOS.receita.quem, 'Cliente ou pagador');
    igual(TERMOS.despesa.quem, 'Fornecedor ou favorecido');
  });

  teste('o que não existe é declarado, não simulado', () => {
    // Campo desabilitado sem explicação lê-se como defeito; dito assim, lê-se
    // como etapa.
    contem(form, 'Ainda não disponível');
    contem(form, 'Anexos');
    contem(form, 'Parcelamento');
    contem(form, 'Recorrência');
    contem(form, 'Conta de pagamento');
  });

  teste('não há conta de pagamento inventada', () => {
    // Um <select> com Caixa/Banco/Cartão gravaria texto fingindo ser vínculo.
    naoContem(form, "value=\"caixa\"");
    naoContem(form, "value=\"banco\"");
  });

  teste('o drawer avisa antes de descartar alterações', () => {
    contem(form, 'alterações não salvas');
    contem(form, "e.key === 'Escape'", 'ESC tem que fechar');
  });

  teste('editar lançamento pago avisa sobre o fluxo de caixa', () => {
    contem(form, 't.afeta', 'o aviso tem que ser renderizado');
    contem(TERMOS.despesa.afeta, 'fluxo de caixa realizado');
    contem(TERMOS.receita.afeta, 'caixa realizado');
  });

  teste('a linha da lista abre o lançamento — é como se dá baixa', () => {
    // Sem isso, só o menu "⋯" dava acesso, e ninguém descobre um menu que não
    // se vê. Os controles de dentro da linha param o clique antes.
    contem(lista, 'data-editar');
    contem(shell, 'data-editar');
    contem(shell, "e.target.closest('select, button, input, textarea, a')");
    contem(shell, 'async function editarLancamento');
  });

  teste('despesa importada mostra a origem', () => {
    contem(form, 'Origem: importação');
    contem(form, 'origem_linha');
  });

  teste('duplo envio é travado', () => {
    contem(form, 'if (salvando) return');
  });

  teste('excluir avisa que cancelar é melhor', () => {
    contem(lista, 'Cancelar é quase sempre melhor');
  });

  teste('editar a lista avisa a Visão geral, sem recarregar a página', () => {
    contem(lista, 'aoMudar');
    contem(shell, 'aoMudar');
    naoContem(lista, 'location.reload');
  });

  teste('a forma de pagamento tem as oito opções pedidas', () => {
    igual(FORMAS_PAGAMENTO.length, 8);
    igual(FORMAS_PAGAMENTO[0].id, 'pix');
  });
});

// ───────────────────────────────────────────────────────────
grupo('despesa · o que o banco garante', () => {
  const sql = readFileSync(new URL('../db/financeiro_despesas_etapa1.sql', import.meta.url), 'utf8');
  const migrar = readFileSync(new URL('../db/financeiro_centros_custo_migrar.sql', import.meta.url), 'utf8');
  const desfazer = readFileSync(new URL('../db/financeiro_despesas_etapa1_desfazer.sql', import.meta.url), 'utf8');

  teste('a competência NÃO é amarrada ao mês de `data`', () => {
    // ACONTECEU: o CHECK `competencia = date_trunc('month', data)` nasceu
    // quando `data` era a única data da tabela. Depois de existirem vencimento
    // e pago_em, ele passou a recusar o caso mais comum do módulo — despesa de
    // agosto que vence em setembro — e o cadastro não gravava.
    const schema = readFileSync(new URL('../db/financeiro_lancamentos.sql', import.meta.url), 'utf8');
    const livre = readFileSync(new URL('../db/financeiro_competencia_livre.sql', import.meta.url), 'utf8');

    naoContem(schema, "check (competencia = date_trunc('month', data)::date)");
    contem(schema, "check (competencia = date_trunc('month', competencia)::date)");
    contem(livre, 'drop constraint if exists financeiro_lancamentos_competencia_check');
    // A migração não pode reescrever linha nenhuma: a regra nova é mais frouxa.
    naoContem(livre, 'update public.financeiro_lancamentos');
  });

  teste('competência de agosto com vencimento em setembro é gravável', () => {
    // O caso que a trava recusava, agora conferido no conversor.
    const b = lancamentoParaBanco({
      ...valida, competencia: '2026-08-01', vencimento: '2026-09-20', status: 'pendente',
    });
    igual(b.competencia, '2026-08-01');
    igual(b.data, '2026-09-20');
    ok(b.competencia.slice(0, 7) !== b.data.slice(0, 7),
       'este é justamente o par que o banco recusava');
  });

  teste('não cria segunda tabela de lançamento', () => {
    // Importado e manual alimentam o MESMO módulo.
    naoContem(sql, 'create table if not exists public.despesas');
    naoContem(sql, 'create table if not exists public.financeiro_despesas');
    contem(sql, 'alter table public.financeiro_lancamentos add column if not exists status');
  });

  teste('status só aceita os três valores graváveis', () => {
    contem(sql, "check (status in ('pendente', 'pago', 'cancelado'))");
    naoContem(sql, "'vencido'", 'vencido é derivado, não gravado');
  });

  teste('pago sem data de pagamento é recusado pelo banco', () => {
    contem(sql, "check (status <> 'pago' or pago_em is not null)");
  });

  teste('o backfill traduz o booleano, sem tocar em dinheiro', () => {
    contem(sql, "set status = case when pago then 'pago' else 'pendente' end");
    contem(sql, 'where status is null', 'reexecutar não pode desfazer edição posterior');
    naoContem(sql, 'update public.financeiro_lancamentos\n   set valor');
  });

  teste('a RLS valida também o centro de custo', () => {
    // Sem isso, um id de outra conta entraria pela API e o relatório dela
    // somaria uma linha alheia.
    contem(sql, 'financeiro_centros_custo cc');
    contem(sql, 'cc.nutri_id = auth.uid()');
  });

  teste('a auditoria é só leitura para quem usa o app', () => {
    // Trilha que o próprio auditado pode apagar não é trilha.
    contem(sql, 'create policy financeiro_auditoria_select');
    naoContem(sql, 'create policy financeiro_auditoria_insert');
    naoContem(sql, 'create policy financeiro_auditoria_delete');
    contem(sql, 'security definer');
  });

  teste('a view continua com security_invoker e passa a ignorar cancelado', () => {
    contem(sql, 'with (security_invoker = on)');
    contem(sql, "where l.status <> 'cancelado'");
  });

  teste('o movimento de dados está separado do schema', () => {
    // "Não altere dados importados sem confirmação": o arquivo que mexe em
    // 310 lançamentos é rodado e conferido sozinho.
    naoContem(sql, 'set centro_custo_id');
    contem(migrar, 'set centro_custo_id');
    contem(migrar, 'ISTO MEXE EM DADO JA IMPORTADO');
  });

  teste('a migração não apaga lançamento nenhum', () => {
    naoContem(migrar, 'delete from public.financeiro_lancamentos');
    contem(migrar, 'delete from public.financeiro_categorias', 'as categorias vazias saem');
  });

  teste('o desfazer devolve a categoria antes de apagar a coluna', () => {
    // Apagar a coluna primeiro perderia o vínculo, e não haveria como saber a
    // que centro cada lançamento pertencia.
    const iDevolve = desfazer.indexOf('set categoria_id = v_cat');
    const iDropa = desfazer.indexOf('drop column if exists centro_custo_id');
    ok(iDevolve > 0 && iDropa > 0, 'faltou uma das duas partes');
    ok(iDevolve < iDropa, 'a ordem está invertida — o vínculo se perderia');
  });

  teste('o desfazer preserva a trilha de auditoria', () => {
    // Desfazer uma migração não é motivo para perder o registro de quem mexeu
    // no dinheiro.
    naoContem(desfazer, '\ndrop table if exists public.financeiro_auditoria;');
    contem(desfazer, 'drop table if exists public.financeiro_centros_custo;');
  });
});
