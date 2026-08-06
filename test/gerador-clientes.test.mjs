// ═══════════════════════════════════════════════════════════
// GERADOR — "Controle de Pacientes" da GoUp
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: que a importação não invente dado. Uma data
// lida errado aqui vira um cliente cobrado no dia errado, 144 vezes.
//
// Os casos vieram das linhas reais da planilha — inclusive os dois formatos de
// data, que convivem nela (130 linhas com zero à esquerda, 14 sem).

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  lerCsv, dataIso, preco, telefone, somarDias, mapear, resumo, PLANOS, STATUS,
} from '../db/gerador_clientes.mjs';

const CAB = 'Data de início,Paciente,Status,Horário,Dias Vencidos,Pacote,Status Pagamento,Preço,Data de término,Mês,Ano,MENSAGEM,STATUS,CONTATO,CONTATO Z-API,OBSERVAÇÕES,DISPARO';
// Os valores em real levam vírgula ("R$ 330,00"): sem aspas, cada preço
// viraria duas colunas e deslocaria todo o resto da linha.
const linha = (partes) => partes.map(c => (/[",\n]/.test(c) ? `"${c.split('"').join('""')}"` : c)).join(',');

// ───────────────────────────────────────────────────────────
grupo('gerador · leitura de CSV', () => {
  teste('campo com vírgula dentro de aspas não se parte', () => {
    const r = lerCsv('a,"b,c",d');
    igual(r[0], ['a', 'b,c', 'd']);
  });

  teste('aspas duplicadas viram uma só', () => {
    igual(lerCsv('a,"diz ""oi""",b')[0], ['a', 'diz "oi"', 'b']);
  });

  teste('quebra de linha dentro de aspas fica no campo', () => {
    const r = lerCsv('a,"linha1\nlinha2"\nb,c');
    igual(r.length, 2);
    igual(r[0][1], 'linha1\nlinha2');
  });

  teste('campo vazio continua existindo', () => {
    igual(lerCsv('a,,c')[0], ['a', '', 'c']);
  });
});

grupo('gerador · normalização', () => {
  teste('lê os DOIS formatos de data da planilha', () => {
    igual(dataIso('03/08/2026'), '2026-08-03');
    igual(dataIso('3/8/2026'), '2026-08-03');
    igual(dataIso('28/7/2026'), '2026-07-28');
  });

  teste('data ilegível vira null, não uma data errada', () => {
    igual(dataIso('agosto'), null);
    igual(dataIso('2026-08-03'), null);   // formato ISO não é o da planilha
    igual(dataIso(''), null);
  });

  teste('preço em real brasileiro', () => {
    igual(preco('R$ 330,00'), 330);
    igual(preco('R$ 961,00'), 961);
    igual(preco('1.200,50'), 1200.5);
    igual(preco(''), null);
    igual(preco('grátis'), null);
  });

  teste('telefone vira só dígitos com 55 na frente', () => {
    igual(telefone('5527992264711'), '5527992264711');
    igual(telefone('(27) 9 9631-7009'), '5527996317009');
    igual(telefone('27 999883543'), '5527999883543');
    igual(telefone('+55 27 99226 4711'), '5527992264711');
  });

  teste('telefone curto demais é descartado, não completado', () => {
    // "1234" com 55 na frente viraria um número que não existe.
    igual(telefone('1234'), null);
    igual(telefone(''), null);
  });

  teste('somar dias atravessa mês e ano', () => {
    igual(somarDias('2026-08-03', 30), '2026-09-02');
    igual(somarDias('2026-06-01', 90), '2026-08-30');
    igual(somarDias('2026-12-20', 30), '2027-01-19');
  });
});

grupo('gerador · o que a planilha diz vira o que o modelo entende', () => {
  teste('as cinco durações batem com a planilha', () => {
    igual(PLANOS['Mensal - 3x'].duracao_valor, 30);
    igual(PLANOS['Trimestral - 3x'].duracao_valor, 90);
    igual(PLANOS['Diária'].duracao_valor, 1);
  });

  teste('"Vencida" NÃO vira status — vencido é conta', () => {
    // Uma assinatura ativa com término no passado já aparece vencida na tela.
    // Gravar o estado além de calculá-lo criaria duas verdades.
    igual(STATUS['Vencida'], 'ativa');
    igual(STATUS['Ativo'], 'ativa');
    igual(STATUS['Cancelado'], 'cancelada');
    igual(STATUS['Pausado'], 'pausada');
  });
});

grupo('gerador · mapeamento das linhas', () => {
  const csv = [
    CAB,
    linha(['03/08/2026', 'Claudia Marcia', 'Ativo', 'Noturno', '-27', 'Mensal - 3x', 'Concluído', 'R$ 330,00', '02/09/2026', '9', '2026', '30/08/2026', '', '5527992264711', '+55 27 99226 4711', '', 'OK03']),
    linha(['01/06/2026', 'Fatima Correia', 'Ativo', 'Noturno', '-24', 'Trimestral - 3x', 'Concluído', 'R$ 961,00', '30/08/2026', '8', '2026', '27/08/2026', '', '(27) 9 9631-7009', '', '', '']),
  ].join('\n');

  const { dentro, fora } = mapear(lerCsv(csv));

  teste('o fim do período é CALCULADO, não copiado da planilha', () => {
    // Copiar aceitaria como verdade um valor que pode ter sido editado à mão.
    igual(dentro[0].fim, '2026-09-02');
    igual(dentro[1].fim, '2026-08-30');
    igual(dentro[0].divergeDaPlanilha, false);
    igual(dentro[1].divergeDaPlanilha, false);
  });

  teste('divergência entre planilha e cálculo é sinalizada, não escondida', () => {
    const torto = [CAB, linha(['03/08/2026', 'X', 'Ativo', '', '', 'Mensal - 3x', '', 'R$ 330,00', '15/09/2026', '', '', '', '', '', '', '', ''])].join('\n');
    const r = mapear(lerCsv(torto));
    igual(r.dentro[0].divergeDaPlanilha, true);
    igual(r.dentro[0].fim, '2026-09-02');       // vale o cálculo
    igual(r.dentro[0].fimPlanilha, '2026-09-15');
  });

  teste('telefone e preço saem normalizados', () => {
    igual(dentro[0].telefone, '5527992264711');
    igual(dentro[1].telefone, '5527996317009');
    igual(dentro[1].preco, 961);
  });

  teste('nada é adivinhado: linha problemática fica de FORA e é listada', () => {
    const ruim = [
      CAB,
      linha(['', 'Sem Data', 'Ativo', '', '', 'Mensal - 3x', '', '', '', '', '', '', '', '', '', '', '']),
      linha(['03/08/2026', '', 'Ativo', '', '', 'Mensal - 3x', '', '', '', '', '', '', '', '', '', '', '']),
      linha(['03/08/2026', 'Pacote Estranho', 'Ativo', '', '', 'Semestral - 9x', '', '', '', '', '', '', '', '', '', '', '']),
      linha(['03/08/2026', 'Status Estranho', 'Congelado', '', '', 'Mensal - 3x', '', '', '', '', '', '', '', '', '', '', '']),
    ].join('\n');
    const r = mapear(lerCsv(ruim));
    igual(r.dentro.length, 0);
    igual(r.fora.length, 4);
    contem(r.fora.map(f => f.motivo).join('|'), 'data de início ilegível');
    contem(r.fora.map(f => f.motivo).join('|'), 'sem nome');
    contem(r.fora.map(f => f.motivo).join('|'), 'pacote desconhecido');
    contem(r.fora.map(f => f.motivo).join('|'), 'status desconhecido');
  });

  teste('CSV que não é a aba certa falha com mensagem, não com lixo', () => {
    let erro = null;
    try { mapear(lerCsv('a,b,c\n1,2,3')); } catch (e) { erro = e.message; }
    ok(erro && erro.includes('Controle de Pacientes'), 'a mensagem precisa dizer qual aba se esperava');
  });

  teste('o resumo conta o que importa para conferir antes de rodar', () => {
    const r = resumo(dentro);
    igual(r.total, 2);
    igual(r.ativos, 2);
    igual(r.semTelefone, 0);
    igual(r.receitaAtivos, 1291);
  });
});

grupo('gerador · dados pessoais não entram no repositório', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const fonte = readFileSync(new URL('../db/gerador_clientes.mjs', import.meta.url), 'utf8');

  teste('os arquivos de dados estão no .gitignore', () => {
    // O repositório é PÚBLICO. São 144 pessoas com nome, telefone e o que
    // negociaram. O gerador vai versionado; a saída dele, não.
    contem(ignore, 'db/comercial_clientes_seed.sql');
    contem(ignore, 'db/comercial_clientes_dados.json');
  });

  teste('o gerador não despeja nome nem telefone no terminal', () => {
    // Terminal vira print, e print vira grupo de WhatsApp.
    naoContem(fonte, 'console.log(JSON.stringify({ dentro');
    contem(fonte, 'console.log(JSON.stringify({ ...resumo(dentro), fora }');
  });
});
