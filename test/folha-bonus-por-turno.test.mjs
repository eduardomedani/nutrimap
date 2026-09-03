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
    contem(UI, 'mais de 20% de desconto');
    contem(UI, 'mensalidade vencida');
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
  teste('rebobina o estado pela auditoria', () => {
    // `fim_periodo` é o período VIGENTE e anda a cada pagamento. Perguntar hoje
    // "quem estava vencido em 31/08" com o dado de hoje erra para quem renovou
    // depois — eram 10 das 94 assinaturas em 03/09/2026.
    contem(SQL, 'comercial_assinatura_auditoria');
    contem(SQL, "ad.acao = 'renovada'");
    contem(SQL, 'ad.criado_em::date > p_ref');
    contem(SQL, "antes ->> 'fim_periodo'");
    contem(SQL, "antes ->> 'valor_contratado'");
    contem(SQL, "antes ->> 'plano_id'");
  });

  teste('pega a renovação mais ANTIGA depois da data', () => {
    // É o `antes` dela que descreve o estado naquele dia. A mais recente
    // descreveria o estado de ontem.
    contem(SQL, 'order by ad.criado_em');
    contem(SQL, 'limit 1');
  });

  teste('as quatro regras de exclusão estão lá', () => {
    contem(SQL, "coalesce(trim(a.horario), '') <> ''");
    contem(SQL, 'r.fim_periodo >= p_ref');
    contem(SQL, 'p.preco_padrao > 0');
    contem(SQL, 'p_desconto_maximo');
  });

  teste('o teto do desconto é parâmetro, não número solto', () => {
    // Mudar a regra comercial não pode exigir migração.
    contem(SQL, 'p_desconto_maximo  numeric default 0.20');
  });

  teste('desconto negativo conta', () => {
    // Quem paga ACIMA da tabela não é bolsista. Um `abs()` excluiria justamente
    // quem paga mais.
    naoContem(SQL, 'abs(1 -');
    contem(SQL, '<= p_desconto_maximo');
  });

  teste('quem começou depois da data não conta', () => {
    contem(SQL, 'a.data_inicio_original <= p_ref');
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

  teste('os limites da rebobinagem estão escritos', () => {
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
