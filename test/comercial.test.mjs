// ═══════════════════════════════════════════════════════════
// COMERCIAL — as regras do contrato
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é o dinheiro do cliente e o do estúdio: um erro
// de um dia na renovação é um dia cobrado a mais ou entregue de graça, 74 vezes
// por mês.
//
// Os números vieram da planilha real (2026. Studio (GOUP) 1.0), conferidos
// contra as 144 linhas antes de virar regra.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  comoData, somarDias, somarMeses, diasEntre,
  fimDoPeriodo, inicioDaRenovacao, renovar,
  diasAteVencer, situacaoDoCliente, textoDoVencimento, pesoDaUrgencia,
  situacaoDaCobranca, saldoDaCobranca, competenciaDaCobranca,
  telefoneDigitos, telefoneBonito, telefoneZApi,
  indicadores, PLANO_PADRAO,
} from '../js/comercial.js';

const MENSAL     = { duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 };
const TRIMESTRAL = { duracao_valor: 90, duracao_unidade: 'dia', tolerancia_dias: 5 };
const CALENDARIO = { duracao_valor: 1,  duracao_unidade: 'mes', tolerancia_dias: 5 };

// ───────────────────────────────────────────────────────────
grupo('comercial · datas', () => {
  teste('lê os dois formatos que a planilha usa', () => {
    // 130 linhas vêm como 03/08/2026 e 14 como 3/8/2026, sem zero à esquerda.
    igual(comoData('2026-08-03').getDate(), 3);
    igual(comoData('03/08/2026').getDate(), 3);
    igual(comoData('3/8/2026').getMonth(), 7);
    igual(comoData('abacaxi'), null);
    igual(comoData(''), null);
  });

  teste('somar mês preserva o fim do mês', () => {
    // 31/01 + 1 mês tem que ser 28/02, não 03/03. O setMonth cru transborda.
    igual(somarMeses('2026-01-31', 1), '2026-02-28');
    igual(somarMeses('2024-01-31', 1), '2024-02-29');   // bissexto
    igual(somarMeses('2026-08-15', 3), '2026-11-15');
  });

  teste('somar dias atravessa mês e ano', () => {
    igual(somarDias('2026-08-03', 30), '2026-09-02');
    igual(somarDias('2026-12-20', 30), '2027-01-19');
  });

  teste('diasEntre é positivo para o futuro', () => {
    igual(diasEntre('2026-08-06', '2026-08-09'), 3);
    igual(diasEntre('2026-08-09', '2026-08-06'), -3);
    igual(diasEntre('2026-08-06', '2026-08-06'), 0);
  });
});

grupo('comercial · o período, como a GoUp faz hoje', () => {
  teste('mensal são 30 dias corridos, não um mês', () => {
    // Conferido em 131 de 131 linhas da planilha que tinham as duas datas.
    igual(fimDoPeriodo('2026-08-03', MENSAL), '2026-09-02');
    igual(fimDoPeriodo('2026-08-05', MENSAL), '2026-09-04');
    igual(fimDoPeriodo('2026-07-28', MENSAL), '2026-08-27');
  });

  teste('trimestral são 90 dias, não 3 meses', () => {
    // 01/06 -> 30/08 na planilha. Três meses calendário dariam 01/09.
    igual(fimDoPeriodo('2026-06-01', TRIMESTRAL), '2026-08-30');
  });

  teste('mês calendário existe para planos futuros', () => {
    igual(fimDoPeriodo('2026-08-03', CALENDARIO), '2026-09-03');
    igual(fimDoPeriodo('2026-01-31', CALENDARIO), '2026-02-28');
  });

  teste('plano sem duração não inventa período', () => {
    igual(fimDoPeriodo('2026-08-03', { duracao_valor: 0 }), null);
    igual(fimDoPeriodo('abacaxi', MENSAL), null);
  });
});

grupo('comercial · renovação — pagamento ANTECIPADO', () => {
  teste('pagar antes NÃO encurta o período já comprado', () => {
    // O caso do briefing: vence 31/08, paga 25/08. Setembro tem que continuar
    // começando em 31/08, não em 25/08 — senão o cliente perde 6 dias que
    // pagou. Na planilha, 25 dos 95 intervalos são menores que 25 dias: isso
    // é rotina, não exceção.
    igual(inicioDaRenovacao({ fimVigente: '2026-08-31', dataPagamento: '2026-08-25', toleranciaDias: 5 }),
          '2026-08-31');
  });

  teste('pagar MUITO antes também não encurta', () => {
    igual(inicioDaRenovacao({ fimVigente: '2026-08-31', dataPagamento: '2026-08-01', toleranciaDias: 5 }),
          '2026-08-31');
  });

  teste('o período renovado sai inteiro e encadeado', () => {
    const r = renovar({ fimVigente: '2026-08-31', dataPagamento: '2026-08-25', plano: MENSAL });
    igual(r.inicio_periodo, '2026-08-31');
    igual(r.fim_periodo, '2026-09-30');
  });
});

grupo('comercial · renovação — pagamento EM ATRASO, tolerância de 5 dias', () => {
  teste('no dia do vencimento, continua a série', () => {
    igual(inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: '2026-07-31', toleranciaDias: 5 }),
          '2026-07-31');
  });

  teste('dentro dos 5 dias, continua a série', () => {
    // Atrasar 5 dias não vira desconto nem vira prejuízo.
    igual(inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: '2026-08-05', toleranciaDias: 5 }),
          '2026-07-31');
  });

  teste('no 6º dia, o período passa a contar do pagamento', () => {
    // Quem sumiu não recebe retroativo que não usou.
    igual(inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: '2026-08-06', toleranciaDias: 5 }),
          '2026-08-06');
  });

  teste('atraso longo conta do pagamento', () => {
    const r = renovar({ fimVigente: '2026-07-31', dataPagamento: '2026-09-10', plano: MENSAL });
    igual(r.inicio_periodo, '2026-09-10');
    igual(r.fim_periodo, '2026-10-10');
  });

  teste('a tolerância é do PLANO, não do código', () => {
    igual(inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: '2026-08-06', toleranciaDias: 0 }),
          '2026-08-06');
    igual(inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: '2026-08-20', toleranciaDias: 30 }),
          '2026-07-31');
  });

  teste('a fronteira exata dos 5 dias', () => {
    const na = d => inicioDaRenovacao({ fimVigente: '2026-07-31', dataPagamento: d, toleranciaDias: 5 });
    igual(na('2026-08-05'), '2026-07-31');   // 5º dia: ainda continua
    igual(na('2026-08-06'), '2026-08-06');   // 6º dia: muda
  });
});

grupo('comercial · situação do cliente, derivada', () => {
  const ass = (fim, status = 'ativa') => ({ fim_periodo: fim, status });

  teste('ativo enquanto falta mais que o aviso', () => {
    igual(situacaoDoCliente(ass('2026-09-02'), '2026-08-06', 7), 'ativo');
  });

  teste('vence em breve dentro da janela', () => {
    igual(situacaoDoCliente(ass('2026-08-10'), '2026-08-06', 7), 'vence_em_breve');
    igual(situacaoDoCliente(ass('2026-08-06'), '2026-08-06', 7), 'vence_em_breve');  // vence hoje
  });

  teste('vencido no dia seguinte ao fim', () => {
    igual(situacaoDoCliente(ass('2026-08-05'), '2026-08-06', 7), 'vencido');
  });

  teste('pausa e cancelamento vêm gravados — não dá para calcular', () => {
    igual(situacaoDoCliente(ass('2026-09-02', 'pausada'), '2026-08-06'), 'pausado');
    igual(situacaoDoCliente(ass('2026-09-02', 'cancelada'), '2026-08-06'), 'cancelado');
    igual(situacaoDoCliente(ass('2026-09-02', 'aguardando_inicio'), '2026-08-06'), 'aguardando');
  });

  teste('cancelado continua cancelado mesmo com período no futuro', () => {
    // A conta diria "ativo". A decisão humana ganha.
    igual(situacaoDoCliente(ass('2027-01-01', 'cancelada'), '2026-08-06'), 'cancelado');
  });
});

grupo('comercial · dias, em português', () => {
  teste('o texto muda com o sinal e com o número', () => {
    igual(textoDoVencimento('2026-08-18', '2026-08-06'), 'Vence em 12 dias');
    igual(textoDoVencimento('2026-08-07', '2026-08-06'), 'Vence amanhã');
    igual(textoDoVencimento('2026-08-06', '2026-08-06'), 'Vence hoje');
    igual(textoDoVencimento('2026-08-05', '2026-08-06'), 'Vencido há 1 dia');
    igual(textoDoVencimento('2026-07-10', '2026-08-06'), 'Vencido há 27 dias');
  });

  teste('nada é guardado: a mesma assinatura muda de texto com o dia', () => {
    // É esta a diferença para a planilha, onde "Dias Vencidos" ficava velho
    // sempre que ninguém abria o arquivo.
    const fim = '2026-08-10';
    igual(diasAteVencer(fim, '2026-08-06'), 4);
    igual(diasAteVencer(fim, '2026-08-11'), -1);
  });

  teste('urgência ordena vencido primeiro, e o mais antigo na frente', () => {
    const hoje = '2026-08-06';
    const a = { fim_periodo: '2026-07-10', status: 'ativa' };   // vencido há 27
    const b = { fim_periodo: '2026-08-05', status: 'ativa' };   // vencido há 1
    const c = { fim_periodo: '2026-08-08', status: 'ativa' };   // vence em breve
    const d = { fim_periodo: '2026-12-01', status: 'ativa' };   // ativo
    const ordenado = [d, c, b, a].sort((x, y) => {
      const px = pesoDaUrgencia(x, hoje), py = pesoDaUrgencia(y, hoje);
      return px[0] - py[0] || px[1] - py[1];
    });
    igual(ordenado.map(x => x.fim_periodo), ['2026-07-10', '2026-08-05', '2026-08-08', '2026-12-01']);
  });
});

grupo('comercial · a cobrança é outra coisa que o cliente', () => {
  teste('pendente com vencimento no futuro é pendente', () => {
    igual(situacaoDaCobranca({ status: 'pendente', vencimento: '2026-09-02' }, '2026-08-06'), 'pendente');
  });

  teste('pendente com vencimento no passado é vencida — sem gravar nada', () => {
    igual(situacaoDaCobranca({ status: 'pendente', vencimento: '2026-08-01' }, '2026-08-06'), 'vencida');
  });

  teste('paga é paga, mesmo vencida há muito', () => {
    igual(situacaoDaCobranca({ status: 'pago', vencimento: '2026-01-01' }, '2026-08-06'), 'pago');
  });

  teste('cliente ATIVO pode ter cobrança PENDENTE ao mesmo tempo', () => {
    // Foi confundir os dois que fez a planilha ter "Status Pagamento" com
    // "Concluído" em 141 de 144 linhas — uma coluna que não informa nada.
    const cliente = situacaoDoCliente({ fim_periodo: '2026-09-02', status: 'ativa' }, '2026-08-06');
    const cobranca = situacaoDaCobranca({ status: 'pendente', vencimento: '2026-09-02' }, '2026-08-06');
    igual(cliente, 'ativo');
    igual(cobranca, 'pendente');
  });
});

grupo('comercial · saldo e pagamento parcial (modelado, não implementado)', () => {
  teste('sem valor_pago, pago quita e pendente deve tudo', () => {
    igual(saldoDaCobranca({ valor: 330, status: 'pago' }).saldo, 0);
    igual(saldoDaCobranca({ valor: 330, status: 'pendente' }).saldo, 330);
  });

  teste('R$ 200 de R$ 350 NÃO viram quitação', () => {
    // A regra que o modelo já protege, mesmo antes da tela existir.
    const s = saldoDaCobranca({ valor: 350, valor_pago: 200, status: 'pendente' });
    igual(s.pago, 200);
    igual(s.saldo, 150);
    igual(s.parcial, true);
  });

  teste('pago igual ao valor não é parcial', () => {
    const s = saldoDaCobranca({ valor: 350, valor_pago: 350, status: 'pago' });
    igual(s.saldo, 0);
    igual(s.parcial, false);
  });
});

grupo('comercial · competência', () => {
  teste('é sempre o dia 1º, como o CHECK da tabela exige', () => {
    igual(competenciaDaCobranca('2026-08-03'), '2026-08-01');
    igual(competenciaDaCobranca('2026-12-31'), '2026-12-01');
    igual(competenciaDaCobranca(null), null);
  });
});

grupo('comercial · telefone: um dado, três formatos', () => {
  teste('a planilha guardava dois campos que discordavam; aqui há um', () => {
    const bruto = '5527992264711';
    igual(telefoneDigitos(bruto), '5527992264711');
    igual(telefoneBonito(bruto), '(27) 99226-4711');
    igual(telefoneZApi(bruto), '5527992264711');
  });

  teste('aceita o que a planilha realmente tem', () => {
    igual(telefoneBonito('(27) 9 9631-7009'), '(27) 99631-7009');
    igual(telefoneBonito('27 999883543'), '(27) 99988-3543');
    igual(telefoneZApi('+55 27 99226 4711'), '5527992264711');
  });

  teste('põe o 55 quando falta, e não duplica quando já tem', () => {
    igual(telefoneDigitos('27998210719'), '5527998210719');
    igual(telefoneDigitos('5527998210719'), '5527998210719');
  });

  teste('vazio não vira "55" solto', () => {
    igual(telefoneDigitos(''), '');
    igual(telefoneDigitos(null), '');
    igual(telefoneBonito(''), '');
  });
});

grupo('comercial · indicadores da visão geral', () => {
  const hoje = '2026-08-06';
  const ass = (fim, valor, dias = 30, status = 'ativa') => ({
    status, fim_periodo: fim, valor_contratado: valor,
    inicio_periodo: somarDias(fim, -dias),
  });

  teste('conta ativos, a vencer e vencidos', () => {
    const r = indicadores({
      assinaturas: [
        ass('2026-09-02', 330), ass('2026-09-04', 385),
        ass('2026-08-10', 330),                                  // vence em breve
        ass('2026-07-30', 330),                                  // vencido
        ass('2026-09-02', 330, 30, 'cancelada'),
      ],
      hoje, avisoDias: 7,
    });
    igual(r.ativos, 3);            // 2 ativos + 1 vencendo
    igual(r.venceEmBreve, 1);
    igual(r.vencidos, 1);
    igual(r.cancelados, 1);
  });

  teste('trimestral NÃO conta como se entrasse todo mês', () => {
    // R$ 961 por 90 dias é ~R$ 320 por mês. Somar 961 inflaria o MRR em 3x.
    const r = indicadores({ assinaturas: [ass('2026-10-01', 961, 90)], hoje });
    ok(r.receitaRecorrente > 315 && r.receitaRecorrente < 325,
       `recorrente deveria ficar perto de 320, veio ${r.receitaRecorrente}`);
  });

  teste('recebido no mês só conta o que foi pago NESTE mês', () => {
    const r = indicadores({
      assinaturas: [],
      lancamentos: [
        { tipo: 'receita', status: 'pago', valor: 330, pago_em: '2026-08-03' },
        { tipo: 'receita', status: 'pago', valor: 330, pago_em: '2026-07-03' },   // mês passado
        { tipo: 'receita', status: 'pendente', valor: 385, vencimento: '2026-08-20' },
        { tipo: 'despesa', status: 'pago', valor: 900, pago_em: '2026-08-02' },   // não é receita
      ],
      hoje,
    });
    igual(r.recebidoNoMes, 330);
    igual(r.aReceber, 385);
  });

  teste('cancelado não entra em a receber', () => {
    const r = indicadores({
      lancamentos: [{ tipo: 'receita', status: 'cancelado', valor: 500, vencimento: '2026-08-20' }],
      hoje,
    });
    igual(r.aReceber, 0);
  });
});

grupo('comercial · a migração não recria a planilha', () => {
  const e1 = readFileSync(new URL('../db/comercial_etapa1_vinculo.sql', import.meta.url), 'utf8');
  const e2 = readFileSync(new URL('../db/comercial_etapa2_planos.sql', import.meta.url), 'utf8');
  const codigo = [e1, e2].map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')).join('\n');

  teste('nenhuma tabela de cliente nova', () => {
    naoContem(codigo, 'create table if not exists public.comercial_clientes');
    naoContem(codigo, 'create table if not exists public.clientes');
  });

  teste('nenhuma tabela de cobrança nova — a cobrança é o lançamento', () => {
    naoContem(codigo, 'create table if not exists public.comercial_cobrancas');
    contem(codigo, 'alter table public.financeiro_lancamentos');
  });

  teste('as colunas que a planilha tinha e o banco não deve ter', () => {
    for (const proibida of ['dias_vencidos', 'contato_zapi', 'mes_referencia', 'ano_referencia']) {
      naoContem(codigo, proibida);
    }
  });

  teste('preço contratado é do cliente, não do plano', () => {
    contem(codigo, 'valor_contratado');
    contem(codigo, 'preco_padrao');
  });

  teste('a data de início original existe separada do período vigente', () => {
    contem(codigo, 'data_inicio_original');
    contem(codigo, 'inicio_periodo');
    contem(codigo, 'fim_periodo');
  });

  teste('duração e tolerância são dado configurável', () => {
    contem(codigo, 'duracao_valor');
    contem(codigo, 'duracao_unidade');
    contem(codigo, 'tolerancia_dias');
  });

  teste('valor_pago já existe, para o parcial não virar remendo depois', () => {
    contem(codigo, 'valor_pago');
  });

  teste('RLS por nutri nas duas tabelas novas', () => {
    contem(codigo, 'alter table public.comercial_planos      enable row level security');
    contem(codigo, 'alter table public.comercial_assinaturas enable row level security');
    igual(codigo.split('nutri_id = auth.uid()').length - 1 >= 8, true);
  });

  teste('não dá para apontar para paciente de outro profissional', () => {
    contem(codigo, 'paciente_de_outro_profissional');
    contem(codigo, 'p.nutri_id = auth.uid()');
  });

  teste('apagar cliente não apaga o dinheiro dele', () => {
    contem(codigo, 'add column if not exists paciente_id uuid references public.pacientes(id) on delete set null');
  });

  teste('existe desfazer para as duas etapas', () => {
    const u1 = readFileSync(new URL('../db/comercial_etapa1_vinculo_desfazer.sql', import.meta.url), 'utf8');
    const u2 = readFileSync(new URL('../db/comercial_etapa2_planos_desfazer.sql', import.meta.url), 'utf8');
    contem(u1, 'drop column if exists paciente_id');
    contem(u2, 'drop table if exists public.comercial_assinaturas');
    contem(u2, 'drop table if exists public.comercial_planos');
  });
});
