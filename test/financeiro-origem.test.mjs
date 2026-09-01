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

  teste('cobrança sem descrição ganha uma montada do plano e do cliente', () => {
    const r = preencherDaCobranca({ ...COBRANCA, descricao: null }, ASSINATURA);
    contem(r.descricao, 'Mensal - 3x');
    contem(r.descricao, 'Cliente Exemplo');
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
