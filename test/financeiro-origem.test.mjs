// ═══════════════════════════════════════════════════════════
// FINANCEIRO — a origem de uma receita
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é o caixa não contar o mesmo dinheiro duas
// vezes. A cobrança de um cliente JÁ É um lançamento; se escolher a cobrança
// em "Nova receita" criasse outra linha, a receita dobraria e a cobrança
// continuaria em aberto, cobrando quem já pagou.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  ORIGENS, origemDoLancamento, modoDeSalvar, rotuloDaCobranca,
  secaoOrigemHtml, validarOrigem, preencherDaCobranca,
} from '../js/financeiro-origem.js';
import { cobrancasDoForm, drawerHtml } from '../js/financeiro-lancamento-form.js';

const COBRANCA = {
  id: 'c1', descricao: 'Mensal - 3x — Cliente', valor: 330,
  vencimento: '2026-09-02', competencia: '2026-09-01', categoria_id: 'cat1', status: 'pendente',
};

const ASSINATURA = {
  id: 'a1',
  paciente: { id: 'p1', nome: 'Cliente Exemplo' },
  plano: { nome: 'Mensal - 3x' },
  cobrancas: [COBRANCA],
};

// ───────────────────────────────────────────────────────────
grupo('financeiro · a origem é derivada, não gravada', () => {
  teste('lançamento com assinatura é de cliente', () => {
    igual(origemDoLancamento({ assinatura_id: 'a1' }), 'cliente');
    igual(origemDoLancamento({ paciente_id: 'p1' }), 'cliente');
  });

  teste('lançamento importado da planilha de vendas é venda', () => {
    igual(origemDoLancamento({ origem: 'vendas' }), 'venda');
  });

  teste('o resto é outra receita', () => {
    igual(origemDoLancamento({ origem: 'manual' }), 'outra');
    igual(origemDoLancamento(null), 'outra');
  });

  teste('são três origens, e nenhuma vira coluna nova', () => {
    igual(ORIGENS.map(o => o[0]), ['cliente', 'venda', 'outra']);
  });
});

grupo('financeiro · escolher cobrança troca o que o botão faz', () => {
  teste('com cobrança escolhida, o modo é PAGAMENTO e não criação', () => {
    // É esta a trava contra a receita dobrada.
    igual(modoDeSalvar({ origem: 'cliente', assinatura_id: 'a1', cobranca_id: 'c1' }), 'pagamento');
  });

  teste('sem cobrança, cria normalmente', () => {
    igual(modoDeSalvar({ origem: 'cliente', assinatura_id: 'a1' }), 'novo');
    igual(modoDeSalvar({ origem: 'outra' }), 'novo');
    igual(modoDeSalvar({}), 'novo');
  });

  teste('a tela avisa que vai dar baixa, e não criar', () => {
    const html = secaoOrigemHtml({
      form: { origem: 'cliente', assinatura_id: 'a1', cobranca_id: 'c1' },
      assinaturas: [ASSINATURA], cobrancas: [COBRANCA],
    });
    contem(html, 'vai dar baixa nessa cobrança');
    contem(html, 'Nenhum lançamento novo é criado');
  });
});

grupo('financeiro · a seção de origem', () => {
  teste('sem origem "Cliente", os seletores nem aparecem', () => {
    // Campo desabilitado o tempo todo é campo morto ocupando tela.
    const html = secaoOrigemHtml({ form: { origem: 'outra' }, assinaturas: [ASSINATURA] });
    contem(html, 'id="dspOrigem"');
    naoContem(html, 'id="dspCliente"');
    naoContem(html, 'id="dspCobranca"');
  });

  teste('com "Cliente", o seletor de cobrança espera o cliente', () => {
    const html = secaoOrigemHtml({ form: { origem: 'cliente' }, assinaturas: [ASSINATURA], cobrancas: [] });
    contem(html, 'id="dspCliente"');
    contem(html, 'Escolha o cliente primeiro');
    contem(html, 'disabled');
  });

  teste('a cobrança se descreve com plano, vencimento e valor', () => {
    // Sem comparar a string inteira: o `toLocaleString` do real usa espaço
    // NÃO SEPARÁVEL entre "R$" e o número, e um teste que exige o espaço comum
    // falha por um caractere que ninguém vê.
    const r = rotuloDaCobranca(COBRANCA, ASSINATURA);
    contem(r, 'Mensal - 3x');
    contem(r, 'vence 02/09/2026');
    contem(r, '330,00');
  });

  teste('cliente sem cobrança em aberto diz isso', () => {
    const html = secaoOrigemHtml({
      form: { origem: 'cliente', assinatura_id: 'a1' },
      assinaturas: [{ ...ASSINATURA, cobrancas: [] }], cobrancas: [],
    });
    contem(html, 'não tem cobrança em aberto');
  });

  teste('sem nenhum cliente com assinatura, manda cadastrar', () => {
    const html = secaoOrigemHtml({ form: { origem: 'cliente' }, assinaturas: [] });
    contem(html, 'Nenhum cliente com assinatura');
    contem(html, 'Comercial');
  });
});

grupo('financeiro · validação da origem', () => {
  teste('origem "Cliente" exige cliente e cobrança', () => {
    ok(validarOrigem({ origem: 'cliente' }).assinatura_id);
    ok(validarOrigem({ origem: 'cliente', assinatura_id: 'a1' }).cobranca_id);
    igual(Object.keys(validarOrigem({ origem: 'cliente', assinatura_id: 'a1', cobranca_id: 'c1' })).length, 0);
  });

  teste('as outras origens não exigem nada disso', () => {
    igual(Object.keys(validarOrigem({ origem: 'outra' })).length, 0);
    igual(Object.keys(validarOrigem({ origem: 'venda' })).length, 0);
  });
});

grupo('financeiro · a cobrança dita os campos', () => {
  teste('descrição, valor, categoria e datas vêm dela', () => {
    // Redigitar é convite a divergir: o valor da tela e o da cobrança
    // precisam ser o mesmo número.
    const r = preencherDaCobranca(COBRANCA, ASSINATURA);
    igual(r.descricao, 'Mensal - 3x — Cliente');
    igual(r.valor, '330,00');
    igual(r.categoria_id, 'cat1');
    igual(r.vencimento, '2026-09-02');
    igual(r.competencia, '2026-09');
  });

  teste('cobrança sem descrição cai no NOME DO CLIENTE, sem o plano', () => {
    // O plano saiu do rótulo em 05/09/2026 e passou a viver na categoria. Esta
    // sugestão tem de ser igualzinha à que `criarCobranca` grava: se a tela
    // propuser um texto e o banco gravar outro, o operador salva a diferença
    // sem perceber e a lista fica com dois formatos.
    const r = preencherDaCobranca({ ...COBRANCA, descricao: null }, ASSINATURA);
    igual(r.descricao, 'Cliente Exemplo');
    ok(!r.descricao.includes('Mensal'), 'o plano não volta para a descrição');
  });

  teste('sem cobrança, não preenche nada', () => {
    igual(Object.keys(preencherDaCobranca(null)).length, 0);
  });
});

grupo('financeiro · a origem entra no drawer só na receita', () => {
  teste('receita mostra a seção', () => {
    const html = drawerHtml({ tipo: 'receita', form: { origem: 'outra' }, assinaturas: [ASSINATURA] });
    contem(html, 'Origem');
    contem(html, 'id="dspOrigem"');
  });

  teste('despesa NÃO mostra — despesa não tem cliente', () => {
    const html = drawerHtml({ tipo: 'despesa', form: {} });
    naoContem(html, 'id="dspOrigem"');
  });

  teste('as cobranças do formulário vêm do cliente escolhido', () => {
    igual(cobrancasDoForm({ assinatura_id: 'a1' }, [ASSINATURA]).length, 1);
    igual(cobrancasDoForm({ assinatura_id: 'outro' }, [ASSINATURA]).length, 0);
    igual(cobrancasDoForm({}, []).length, 0);
  });
});

grupo('financeiro · o formulário não cria linha para cobrança escolhida', () => {
  const fonte = readFileSync(new URL('../js/financeiro-lancamento-form.js', import.meta.url), 'utf8');

  teste('o caminho de pagamento sai ANTES do criarDespesa', () => {
    const iPagamento = fonte.indexOf("modoDeSalvar(form) === 'pagamento'");
    const iCriar = fonte.indexOf('await criarDespesa(');
    ok(iPagamento > 0 && iCriar > 0 && iPagamento < iCriar,
       'o desvio de pagamento precisa vir antes da criação');
    contem(fonte, 'registrarPagamento({');
  });

  teste('o comercial não pode derrubar o financeiro', () => {
    // O financeiro existia antes do módulo comercial e tem que abrir sem ele.
    contem(fonte, 'catch (e) { assinaturasCom = []; }');
  });

  teste('a validação da origem soma à do lançamento, não substitui', () => {
    contem(fonte, '...validarLancamento(form, { rascunho, tipo }), ...validarOrigem(form)');
  });
});

// ───────────────────────────────────────────────────────────
// O RÓTULO DA COBRANÇA — nome do cliente na descrição, plano na categoria
// ---------------------------------------------------------------------------
// Decisão de 05/09/2026 (db/comercial_rotulo_da_cobranca.sql). Três coisas
// dependiam dela: a lista ficar legível, a receita de assinatura entrar no
// relatório por categoria, e a guarda anti-duplicata da importação voltar a
// casar — ela compara `descricao = nome`, e era o prefixo do plano que a fazia
// errar, deixando cinco pagamentos entrarem duas vezes em agosto/2026.
//
// Estes testes leem o SQL: provam o que está escrito, não substituem rodar.
// ───────────────────────────────────────────────────────────
grupo('comercial · o rótulo da cobrança', () => {
  const sql = readFileSync(new URL('../db/comercial_rotulo_da_cobranca.sql', import.meta.url), 'utf8');
  const codigo = sql.replace(/--[^\n]*/g, '');
  const dados = readFileSync(new URL('../js/comercial-data.js', import.meta.url), 'utf8');

  teste('AS DUAS RPCs perderam o prefixo do plano', () => {
    // Se sobrar uma, metade das cobranças nasce com um formato e metade com
    // outro — e a guarda da importação volta a errar só nessa metade.
    naoContem(codigo, "'Mensalidade'");
    naoContem(codigo, "coalesce(v_plano_nm,");
  });

  teste('a descrição é o nome do cliente, com piso', () => {
    // `descricao` é NOT NULL: cliente sem nome não pode gravar string vazia.
    contem(codigo, "coalesce(nullif(btrim(coalesce(v_nome, '')), ''), 'Cobranca de assinatura')");
  });

  teste('a categoria sai do plano nas duas RPCs', () => {
    const usos = (codigo.match(/comercial_categoria_do_plano\(v_ass\.nutri_id, v_ass\.plano_id\)/g) || []).length;
    igual(usos, 2, 'uma na cobrança do período, outra na próxima cobrança');
  });

  teste('a categoria é ENCONTRADA antes de ser criada', () => {
    // Criar uma segunda "Mensal - 5x" racharia o total do relatório em duas
    // sem ninguém perceber. A importação de vendas já criou essas categorias;
    // reaproveitá-las é o que faz o histórico e as cobranças novas somarem.
    contem(codigo, 'if v_cat is not null then return v_cat; end if;');
    contem(codigo, 'on conflict do nothing');
  });

  teste('assinatura sem plano não inventa categoria', () => {
    contem(codigo, 'if p_plano is null or p_nutri is null then return null; end if;');
  });

  teste('o JS usa o MESMO resolvedor, não uma segunda regra', () => {
    // Duas lógicas para o mesmo assunto divergem na primeira maiúscula.
    contem(dados, "sb.rpc('comercial_categoria_do_plano'");
    naoContem(dados, "plano?.nome || 'Mensalidade'");
  });

  teste('categoria que falha não derruba a cobrança', () => {
    // Categoria é classificação, não dinheiro: uma receita sem categoria se
    // conserta na tela; uma cobrança que não nasceu deixa o cliente sem o que
    // pagar.
    contem(dados, 'categoria = cat || null;');
  });
});
