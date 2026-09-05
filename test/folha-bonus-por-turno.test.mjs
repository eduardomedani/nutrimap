// ═══════════════════════════════════════════════════════════
// FOLHA — o bônus por número de alunos
// ═══════════════════════════════════════════════════════════
// O fechamento passa a mostrar quantos alunos ativos cada turno tinha no
// ÚLTIMO DIA DO MÊS QUE A FOLHA PAGA — para a folha de Setembro, 31/08 —, e
// escolher um dos dois bônus já preenche o valor: alunos × R$ 10.
//
// Isto vira dinheiro no contracheque, então o que estes testes protegem é a
// diferença entre "contei e deu zero" e "não consegui contar". As duas coisas
// mostram um número pequeno na tela; só uma delas é uma resposta.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  BONUS_POR_ALUNO, TURNOS_COM_BONUS, ADICIONAIS_SUGERIDOS,
  rotuloDoBonus, turnoDoBonus, valorDoBonus, diaDaContagem, mesTrabalhado,
  DESCONTO_MAXIMO,
} from '../js/folha.js';

const UI = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
const SQL = readFileSync(new URL('../db/comercial_alunos_por_turno.sql', import.meta.url), 'utf8');

// ───────────────────────────────────────────────────────────
grupo('bônus por turno · a conta', () => {
  teste('alunos × valor por aluno', () => {
    igual(valorDoBonus({ Diurno: 27, Noturno: 27 }, 'Diurno'), 270);
    igual(valorDoBonus({ Diurno: 27, Noturno: 31 }, 'Noturno'), 310);
  });

  teste('o valor por aluno é R$ 10', () => {
    igual(BONUS_POR_ALUNO, 10);
  });

  teste('o teto de desconto é 7%, e mora num lugar só', () => {
    // 20% -> 10% -> 7%. O numero governa a chamada da RPC E o texto da tela —
    // repetido em prosa, viraria duas fontes que discordam no dia em que uma
    // mudar, e a que a pessoa le seria justamente a que nao decide nada.
    igual(DESCONTO_MAXIMO, 0.07);
    contem(readFileSync(new URL('../js/folha.js', import.meta.url), 'utf8'),
           'p_desconto_maximo: DESCONTO_MAXIMO');
  });

  teste('O MESMO TETO VALE PARA OS DOIS BÔNUS', () => {
    // Ate 05/09/2026 so o bonus POR ALUNO olhava desconto; o de PRESENCA
    // pagava por qualquer um que entrasse na sala, cortesia inclusive. Duas
    // reguas para a mesma pergunta, e so uma respondendo.
    const folha = readFileSync(new URL('../js/folha.js', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
    // As duas RPCs recebem o MESMO valor, e na MESMA data de corte.
    igual((folha.match(/p_desconto_maximo: DESCONTO_MAXIMO/g) || []).length, 2);
    igual((folha.match(/p_ref: diaDaContagem\(competencia\)/g) || []).length, 2);
    contem(ui, 'alunoElegivel:');
  });

  teste('sem a lista do banco, NINGUÉM é barrado', () => {
    // Falhar fechando a folha com bonus zerado para todo mundo e pior que
    // fechar pagando a mais: o excesso aparece na conferencia, a falta so
    // aparece quando o estagiario reclama.
    contem(readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8'),
           'alunosDoBonus(_folha.competencia).catch(() => null)');
  });

  teste('zero alunos vale zero — é resposta', () => {
    igual(valorDoBonus({ Diurno: 0 }, 'Diurno'), 0);
  });

  teste('SEM contagem devolve null, e não zero', () => {
    // A distinção inteira deste arquivo. Zero é "contei e não achei ninguém";
    // null é "não consegui contar". Devolver zero nos dois casos faria o bônus
    // sair R$ 0,00 num mês em que a contagem só não chegou.
    igual(valorDoBonus(null, 'Diurno'), null);
    igual(valorDoBonus({}, 'Diurno'), null);
    igual(valorDoBonus({ Noturno: 5 }, 'Diurno'), null);
  });

  teste('o valor por aluno é parâmetro, para o dia em que mudar', () => {
    igual(valorDoBonus({ Diurno: 10 }, 'Diurno', 15), 150);
  });
});

// ───────────────────────────────────────────────────────────
grupo('bônus por turno · o rótulo é derivado do turno', () => {
  teste('cada turno gera o próprio rótulo', () => {
    igual(rotuloDoBonus('Diurno'), 'Bônus por número de alunos diurnos');
    igual(rotuloDoBonus('Noturno'), 'Bônus por número de alunos noturnos');
  });

  teste('os dois estão nas sugestões, e o genérico saiu', () => {
    for (const t of TURNOS_COM_BONUS) ok(ADICIONAIS_SUGERIDOS.includes(rotuloDoBonus(t)));
    ok(!ADICIONAIS_SUGERIDOS.includes('Bônus por número de alunos'),
       'o genérico ao lado dos dois seria um convite ao erro: ele não calcula');
  });

  teste('o rótulo volta a virar turno, ignorando caixa e espaço', () => {
    igual(turnoDoBonus('Bônus por número de alunos diurnos'), 'Diurno');
    igual(turnoDoBonus('  BÔNUS POR NÚMERO DE ALUNOS NOTURNOS  '), 'Noturno');
  });

  teste('descrição que não é bônus por turno devolve null', () => {
    // "Auxílio faculdade" não pode preencher valor nenhum.
    igual(turnoDoBonus('Auxílio faculdade'), null);
    igual(turnoDoBonus('Bônus por número de alunos'), null);
    igual(turnoDoBonus(''), null);
    igual(turnoDoBonus(null), null);
  });

  teste('renomear o turno renomeia o bônus junto', () => {
    // Rótulo escrito à mão passaria a discordar do cadastro, e a discordância
    // apareceria como bônus que não calcula, sem nada dizendo por quê.
    for (const t of TURNOS_COM_BONUS) {
      contem(rotuloDoBonus(t).toLowerCase(), t.toLowerCase());
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('bônus por turno · a data da contagem', () => {
  teste('a contagem é do último dia do mês ANTERIOR à competência', () => {
    // A casa nomeia a folha pelo mês em que PAGA, e paga o mês trabalhado
    // antes: as 24 folhas com data foram pagas entre os dias 1 e 4 da própria
    // competência, em quase dois anos, sem exceção. Ninguém paga em 03/08 o
    // trabalho de agosto.
    igual(diaDaContagem('2026-09-01'), '2026-08-31');
    igual(diaDaContagem('2026-08-01'), '2026-07-31');
  });

  teste('a primeira versão contava no mês errado', () => {
    // Ela devolvia 30/09 para a folha de setembro — data que ainda nem chegou
    // quando a folha é paga, e que mede o mês seguinte ao trabalhado.
    ok(diaDaContagem('2026-09-01') !== '2026-09-30');
  });

  teste('vira o ano sem tropeçar', () => {
    igual(diaDaContagem('2026-01-01'), '2025-12-31');
  });

  teste('fevereiro e ano bissexto saem certos', () => {
    igual(diaDaContagem('2026-03-01'), '2026-02-28');
    igual(diaDaContagem('2028-03-01'), '2028-02-29');
  });

  teste('o mês trabalhado sai por extenso, para a tela dizer a convenção', () => {
    igual(mesTrabalhado('2026-09-01'), 'Agosto de 2026');
    igual(mesTrabalhado('2026-01-01'), 'Dezembro de 2025');
  });

  teste('a virada não depende do fuso de quem olha', () => {
    // Em UTC-3, o dia 1 às 00:00 local ainda é o mês anterior em UTC — e a
    // folha de agosto contaria julho.
    contem(readFileSync(new URL('../js/folha.js', import.meta.url), 'utf8'), 'Date.UTC');
  });

  teste('competência inválida não inventa data', () => {
    igual(diaDaContagem(''), '');
    igual(diaDaContagem('abacaxi'), 'abacaxi');
  });
});

// ───────────────────────────────────────────────────────────
grupo('bônus por turno · a tela', () => {
  teste('a contagem é carregada junto com o mês', () => {
    contem(UI, 'await carregarTurnos();');
    contem(UI, 'alunosPorTurno(_folha.competencia)');
  });

  teste('a contagem falha em silêncio, sem derrubar a folha', () => {
    // O bônus é opcional; o fechamento do mês não. Derrubar a tela porque um
    // resumo não carregou trocaria um incômodo por um bloqueio.
    const bloco = UI.slice(UI.indexOf('async function carregarTurnos'), UI.indexOf('function resumoTurnosHtml'));
    contem(bloco, 'try {');
    contem(bloco, '_turnos = null;');
  });

  teste('sem contagem, o painel DIZ que não contou', () => {
    contem(UI, 'Não consegui contar os alunos por turno');
    contem(UI, 'fp-turnos-vazio');
    contem(UI, '_turnos === null');
  });

  teste('o painel mostra a data por extenso', () => {
    // A contagem é DAQUELE dia, não de hoje. Sem dizer isso, um número visto em
    // outubro pareceria desatualizado quando está certo e congelado.
    contem(UI, 'Alunos ativos em ${esc(dia)}');
    contem(UI, 'diaDaContagem(_folha.competencia)');
  });

  teste('escolher o bônus preenche o valor, e só quando há contagem', () => {
    contem(UI, 'turnoDoBonus(escolhido)');
    contem(UI, 'valorDoBonus(_turnos, turno)');
    contem(UI, 'if (calculado !== null) val.value');
  });

  teste('o campo continua editável depois de preenchido', () => {
    // Quem fecha a folha pode ter um motivo que o banco não sabe. Travar
    // transformaria uma sugestão muito boa numa imposição.
    naoContem(UI, 'val.readOnly = true');
    naoContem(UI, 'val.disabled = true');
  });

  teste('o resumo aparece no cabeçalho da folha', () => {
    contem(UI, '${resumoTurnosHtml()}');
  });

  teste('a tela DIZ que a folha paga o mês anterior', () => {
    // Foi essa confusão que fez a folha de agosto parecer erro de cadastro
    // quando era a convenção da casa. O painel agora explica em vez de deixar
    // a data solta.
    contem(UI, 'paga <b>${esc(mes)}</b>');
    contem(UI, 'mesTrabalhado(_folha.competencia)');
    contem(UI, 'fp-turnos-mes');
    contem(CSS, '.fp-turnos-mes');
  });

  teste('a conta aparece inteira, e não só o resultado', () => {
    // A primeira versão mostrava "27" e "R$ 270,00" sem dizer o que liga um ao
    // outro. Quem conferia precisava saber a taxa de cabeça, e uma taxa errada
    // só apareceria no contracheque.
    contem(UI, '${n} × ${esc(formatarBRL(BONUS_POR_ALUNO))}');
    contem(CSS, '.fp-turno-conta');
  });

  teste('NÃO existe total somando os dois turnos', () => {
    // Ele existia e foi removido: os dois bônus vão para PESSOAS DIFERENTES,
    // então a soma não corresponde a pagamento nenhum. Um número que ninguém
    // paga, ao lado de dois que alguém paga, convida a lançar o valor errado.
    naoContem(UI, 'no total');
    naoContem(UI, 'total * BONUS_POR_ALUNO');
    naoContem(CSS, '.fp-turno-total');
  });

  teste('a regra de exclusão é texto visível, não tooltip', () => {
    // É ela que responde "por que 27 e não 94". No celular tooltip não existe,
    // e quem lê o painel no telefone ficava sem a única informação que explica
    // o número.
    contem(UI, 'fp-turnos-regra');
    contem(UI, 'mais de ${Math.round(DESCONTO_MAXIMO * 100)}% de desconto');
    // "vencida" saiu em 04/09/2026: quem pagou atrasado conta se o período pago
    // inclui o dia. A tela precisa dizer isso, senão o número parece errado
    // justamente para quem conhece os alunos pelo nome.
    contem(UI, 'não tinha mensalidade cobrindo');
    contem(UI, 'pagou atrasado conta');
    naoContem(UI, 'fp-turnos-ajuda');
    naoContem(UI, 'title="Não entram');
  });

  teste('cada turno tem ícone próprio', () => {
    // Sol e lua se leem antes do texto, e o painel é consultado de relance.
    contem(UI, "ICONE_DO_TURNO = { Diurno: 'sun', Noturno: 'moon' }");
    contem(UI, "ICONE_DO_TURNO[t] || 'users'");
  });

  teste('a grade quebra pela largura, não por breakpoint escolhido a dedo', () => {
    // O painel divide a linha com a folha e nem sempre ocupa a tela toda —
    // `auto-fit` acerta nos dois casos sem media query.
    contem(CSS, '.fp-turnos');
    contem(CSS, '.fp-turnos-vazio');
    contem(CSS, 'repeat(auto-fit, minmax(190px, 1fr))');
  });

  teste('singular e plural do rótulo', () => {
    contem(UI, "n === 1 ? 'aluno' : 'alunos'");
  });
});

// ───────────────────────────────────────────────────────────
grupo('bônus por turno · a função no banco', () => {
  teste('monta a vida inteira da assinatura, não só o período de hoje', () => {
    // `fim_periodo` é o período VIGENTE e anda a cada pagamento; os períodos
    // antigos só existem na auditoria. É a união dos dois que permite perguntar
    // se uma data qualquer estava coberta.
    contem(SQL, 'comercial_assinatura_auditoria');
    contem(SQL, "ad.acao = 'renovada'");
    contem(SQL, 'union all');
    contem(SQL, "antes ->> 'inicio_periodo'");
    contem(SQL, "antes ->> 'fim_periodo'");
    contem(SQL, "antes ->> 'valor_contratado'");
    contem(SQL, "antes ->> 'plano_id'");
  });

  teste('conta quem tem a data DENTRO de um período', () => {
    // A regra de 04/09/2026. Não é "estava em dia naquele dia" — é "aquele dia
    // caiu num período pago", ainda que o pagamento tenha entrado depois. Em
    // 31/08/2026 isso valia para dez alunos, R$ 100 de bônus.
    // As duas linhas JUNTAS, com a quebra de linha no meio e no fim. Soltas,
    // cada uma é um PREFIXO: `<= p_ref` continua casando se alguém escrever
    // `<= p_ref + 1`, e o teste passaria com a data deslocada em um dia.
    // Uma mutação provou isso — a asserção por substring não pega termo
    // acrescentado no fim, só termo removido.
    contem(SQL, 'where pe.inicio_periodo <= p_ref\n       and pe.fim_periodo    >= p_ref\n');
  });

  teste('um período por assinatura, mesmo com sobreposição', () => {
    // Correção manual pode deixar dois períodos cobrindo o mesmo dia. Sem o
    // `distinct on` a pessoa contaria duas vezes e o bônus sairia inflado.
    contem(SQL, 'distinct on (pe.id)');
    contem(SQL, 'order by pe.id, pe.fim_periodo desc');
  });

  teste('as regras de exclusão estão lá', () => {
    contem(SQL, "coalesce(trim(a.horario), '') <> ''");
    contem(SQL, 'and pe.fim_periodo    >= p_ref\n');
    contem(SQL, 'p.preco_padrao > 0');
    contem(SQL, 'p_desconto_maximo');
  });

  teste('auditoria sem intervalo não é adivinhada', () => {
    // Registro antigo pode não ter o período. Sem ele não dá para dizer se
    // cobre a data, e chutar seria pior que faltar.
    contem(SQL, "ad.antes ->> 'inicio_periodo' is not null");
    contem(SQL, "ad.antes ->> 'fim_periodo'    is not null");
  });

  teste('o teto do desconto é parâmetro, não número solto', () => {
    // Mudar a regra comercial não pode exigir migração.
    contem(SQL, 'p_desconto_maximo  numeric default 0.10');
  });

  teste('desconto negativo conta', () => {
    // Quem paga ACIMA da tabela não é bolsista. Um `abs()` excluiria justamente
    // quem paga mais.
    naoContem(SQL, 'abs(1 -');
    contem(SQL, '<= p_desconto_maximo');
  });

  teste('quem começou depois da data não conta', () => {
    // Sem filtro próprio: quem começou depois não tem período que contenha a
    // data. A condição de cobertura já diz isso, e a regra repetida seria mais
    // uma para manter em dia com a outra.
    const codigo = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    naoContem(codigo, 'data_inicio_original');
  });

  teste('exige equipe.folha e NÃO exige comercial.visualizar', () => {
    // Devolve dois inteiros por turno, não a carteira. Quem fecha a folha
    // precisa do número, não da lista de clientes.
    contem(SQL, "tem_permissao('equipe.folha')");
    naoContem(SQL, "tem_permissao('comercial.visualizar')");
  });

  teste('é definer, estável, com search_path fixo', () => {
    contem(SQL, 'security definer');
    contem(SQL, 'stable');
    contem(SQL, 'set search_path = public');
  });

  teste('a anon-key não executa', () => {
    contem(SQL, 'revoke all on function public.comercial_alunos_por_turno(date, numeric) from public, anon;');
    contem(SQL, 'grant execute on function public.comercial_alunos_por_turno(date, numeric) to authenticated;');
  });

  teste('não escreve nada', () => {
    const codigo = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    naoContem(codigo, 'insert into');
    naoContem(codigo, 'update public.');
    naoContem(codigo, 'delete from');
  });

  teste('os limites da reconstrução estão escritos', () => {
    // A auditoria começou em 13/08/2026 e cancelamento não é auditado. Quem for
    // fechar julho precisa saber que o número é aproximado.
    contem(SQL, 'AUDITORIA COMECOU EM 13/08/2026');
    contem(SQL, 'CANCELAMENTO NAO E AUDITADO');
  });

  teste('o desfazer existe e avisa a ordem', () => {
    const undo = readFileSync(new URL('../db/comercial_alunos_por_turno_desfazer.sql', import.meta.url), 'utf8');
    contem(undo, 'drop function if exists public.comercial_alunos_por_turno(date, numeric);');
    contem(undo, 'tire o frontend primeiro');
  });
});
