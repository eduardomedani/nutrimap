// ═══════════════════════════════════════════════════════════
// COMERCIAL — A REGRA DEFINITIVA DE RENOVAÇÃO
// ═══════════════════════════════════════════════════════════
// Regra fechada em 14/08/2026. O código já a obedecia; estes testes existem
// para que ela não se perca, e para cobrir as durações que ninguém tinha
// exercitado — semestral, anual e plano personalizado.
//
// A NOMENCLATURA, que é onde o erro nasce:
//
//   CALENDÁRIO DA ASSINATURA -> `assinatura.fim_periodo`
//   PRAZO FINANCEIRO         -> `financeiro_lancamentos.vencimento`
//
// O atraso da renovação se mede contra o PRIMEIRO. As duas datas coincidiram
// até 12/08/2026, e quando a cobrança manual passou a vencer em criação + 30
// elas se separaram. Medir pelo vencimento financeiro empurraria a base do
// período para frente a cada ciclo — a CASO_COBRANCA_MANUAL, período 03/08→02/09, com
// cobrança vencendo 13/09, pagando em 05/09, ganharia 11 dias, e de novo no
// ciclo seguinte.
//
//   dias_atraso = data_pagamento - assinatura.fim_periodo
//   se dias_atraso <= plano_que_entra.tolerancia_dias:
//       inicio = assinatura.fim_periodo
//   senão:
//       inicio = data_pagamento
//   fim = inicio + duração_do_plano_que_entra
//
// DURAÇÃO E TOLERÂNCIA VÊM SEMPRE DO PLANO QUE ENTRA, nunca do que sai, e
// nunca de constante no código.

import { grupo, teste, ok, igual, contem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { inicioDaRenovacao, renovar, fimDoPeriodo } from '../js/comercial.js';
import { previaDaRenovacao } from '../js/comercial-drawer.js';

const ler = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const soCodigo = s => s.replace(/--[^\n]*/g, '');

// Os planos do enunciado. Nenhuma duração aparece no código da regra: todas
// entram por aqui, que é o ponto do §12.
const MENSAL      = { id: 'p-m',  nome: 'Mensal',      duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 5 };
const TRIMESTRAL  = { id: 'p-t',  nome: 'Trimestral',  duracao_valor: 90, duracao_unidade: 'dia', tolerancia_dias: 5 };
const SEMESTRAL   = { id: 'p-s',  nome: 'Semestral',   duracao_valor: 6,  duracao_unidade: 'mes', tolerancia_dias: 5 };
const ANUAL       = { id: 'p-a',  nome: 'Anual',       duracao_valor: 12, duracao_unidade: 'mes', tolerancia_dias: 5 };
const CUSTOM45    = { id: 'p-45', nome: '45 dias',     duracao_valor: 45, duracao_unidade: 'dia', tolerancia_dias: 5 };
const CUSTOM4M    = { id: 'p-4m', nome: '4 meses',     duracao_valor: 4,  duracao_unidade: 'mes', tolerancia_dias: 5 };
const TOL_ZERO    = { id: 'p-t0', nome: 'Sem tolerância', duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 0 };
const TOL_DEZ     = { id: 'p-t10', nome: 'Tolerante',  duracao_valor: 30, duracao_unidade: 'dia', tolerancia_dias: 10 };

const FIM = '2026-08-13';   // o fim de período do enunciado


// ───────────────────────────────────────────────────────────
// A TOLERÂNCIA — os três casos do enunciado, com as datas dele
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · a tolerância decide a data-base', () => {
  teste('A. atraso de 1 dia (14/08) preserva a data-base 13/08', () => {
    igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: '2026-08-14', toleranciaDias: 5 }), FIM);
  });

  teste('B. atraso de 5 dias (18/08) ainda preserva — o limite é inclusivo', () => {
    igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: '2026-08-18', toleranciaDias: 5 }), FIM);
  });

  teste('C. atraso de 6 dias (19/08) passa a contar do pagamento', () => {
    igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: '2026-08-19', toleranciaDias: 5 }), '2026-08-19');
  });

  teste('a fronteira é exatamente entre 5 e 6, e não perto disso', () => {
    for (let d = 0; d <= 5; d++) {
      const pago = `2026-08-${String(13 + d).padStart(2, '0')}`;
      igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: pago, toleranciaDias: 5 }), FIM,
        `atraso de ${d} dias tem de preservar`);
    }
    for (const pago of ['2026-08-19', '2026-08-20', '2026-09-30']) {
      igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: pago, toleranciaDias: 5 }), pago,
        `${pago} está fora da tolerância`);
    }
  });

  teste('pagar ANTES do fim nunca encurta o que já foi comprado', () => {
    igual(inicioDaRenovacao({ fimVigente: FIM, dataPagamento: '2026-07-20', toleranciaDias: 5 }), FIM);
  });
});


// ───────────────────────────────────────────────────────────
// A DURAÇÃO — D a H, uma por plano
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · a duração vem do plano, sempre', () => {
  // Mesmo pagamento em todos, para a única variável ser o plano.
  const base = { fimVigente: FIM, dataPagamento: '2026-08-14' };

  teste('D. Mensal de 30 dias', () => {
    igual(renovar({ ...base, plano: MENSAL }).fim_periodo, '2026-09-12');
  });

  teste('E. Trimestral de 90 dias', () => {
    igual(renovar({ ...base, plano: TRIMESTRAL }).fim_periodo, '2026-11-11');
  });

  teste('F. Semestral de 6 MESES — calendário, não 180 dias', () => {
    // 13/08 + 6 meses = 13/02/2027. Se fossem 180 dias corridos daria 09/02.
    const r = renovar({ ...base, plano: SEMESTRAL });
    igual(r.inicio_periodo, FIM);
    igual(r.fim_periodo, '2027-02-13');
    ok(r.fim_periodo !== '2027-02-09', 'meses calendário e dias corridos não são a mesma coisa');
  });

  teste('G. Anual de 12 MESES', () => {
    igual(renovar({ ...base, plano: ANUAL }).fim_periodo, '2027-08-13');
  });

  teste('H. plano personalizado funciona sem código novo', () => {
    // Nenhum destes existe hoje no cadastro da GoUp. Se a regra fosse por
    // nome de plano, ou tivesse 30/90/180/365 embutidos, estes quebrariam.
    igual(renovar({ ...base, plano: CUSTOM45 }).fim_periodo, '2026-09-27');
    igual(renovar({ ...base, plano: CUSTOM4M }).fim_periodo, '2026-12-13');
    igual(renovar({ ...base, plano: { duracao_valor: 60, duracao_unidade: 'dia', tolerancia_dias: 5 } }).fim_periodo,
      '2026-10-12');
    igual(renovar({ ...base, plano: { duracao_valor: 1, duracao_unidade: 'dia', tolerancia_dias: 5 } }).fim_periodo,
      '2026-08-14');
  });

  teste('meses calendário preservam o fim do mês', () => {
    // 31/01 + 1 mês não pode virar 03/03. É a razão de `somarMeses` existir.
    igual(fimDoPeriodo('2026-01-31', { duracao_valor: 1, duracao_unidade: 'mes' }), '2026-02-28');
    igual(fimDoPeriodo('2026-08-31', { duracao_valor: 6, duracao_unidade: 'mes' }), '2027-02-28');
  });

  teste('o cadastro aceita todas as durações do enunciado', () => {
    const schema = soCodigo(ler('../db/comercial_etapa2_planos.sql'));
    contem(schema, "check (duracao_unidade in ('dia', 'mes'))");
    contem(schema, 'check (duracao_valor > 0)');
    contem(schema, 'check (tolerancia_dias >= 0)');
    // 45 dias, 60 dias, 4/6/12 meses passam por estes CHECKs sem exceção.
    const form = ler('../js/comercial-formularios.js');
    contem(form, "['dia', 'mes'].includes(form.duracao_unidade)");
  });
});


// ───────────────────────────────────────────────────────────
// A TOLERÂNCIA CONFIGURÁVEL — J
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · a tolerância também vem do plano', () => {
  teste('J. tolerância 0 — qualquer atraso conta do pagamento', () => {
    const r = renovar({ fimVigente: FIM, dataPagamento: '2026-08-14', plano: TOL_ZERO });
    igual(r.inicio_periodo, '2026-08-14');
    // No próprio dia ainda preserva: atraso 0 <= 0.
    igual(renovar({ fimVigente: FIM, dataPagamento: FIM, plano: TOL_ZERO }).inicio_periodo, FIM);
  });

  teste('J. tolerância 10 — o 6º dia ainda preserva', () => {
    igual(renovar({ fimVigente: FIM, dataPagamento: '2026-08-19', plano: TOL_DEZ }).inicio_periodo, FIM);
    igual(renovar({ fimVigente: FIM, dataPagamento: '2026-08-23', plano: TOL_DEZ }).inicio_periodo, FIM);
    igual(renovar({ fimVigente: FIM, dataPagamento: '2026-08-24', plano: TOL_DEZ }).inicio_periodo, '2026-08-24');
  });

  teste('o 5 não está escrito na regra — sai do plano', () => {
    const js = ler('../js/comercial.js');
    const f = js.slice(js.indexOf('export function renovar'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    contem(corpo, 'toleranciaDias: plano?.tolerancia_dias');
  });
});


// ───────────────────────────────────────────────────────────
// O PLANO QUE ENTRA — I
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · duração e tolerância são do plano que ENTRA', () => {
  const assinatura = {
    id: 'a1', plano_id: MENSAL.id, plano: MENSAL,
    inicio_periodo: '2026-07-14', fim_periodo: FIM,
    valor_contratado: 330,
  };

  teste('I. Mensal → Trimestral usa os 90 dias do que entra', () => {
    const com = { ...assinatura, proximo_plano_id: TRIMESTRAL.id, proximo_valor_contratado: 990 };
    const p = previaDaRenovacao(com, '2026-08-14', [MENSAL, TRIMESTRAL]);
    igual(p.inicio_periodo, FIM, 'atraso de 1 dia preserva a base');
    igual(p.fim_periodo, '2026-11-11', '90 dias, e não os 30 do plano que sai');
    igual(p.trocaPlano, true);
    igual(p.incompleta, false);
  });

  teste('I. fora da tolerância, a base é o pagamento E a duração é a do novo', () => {
    // O exemplo do §7: pagamento em 19/08, atraso 6, Trimestral entrando.
    const com = { ...assinatura, proximo_plano_id: TRIMESTRAL.id };
    const p = previaDaRenovacao(com, '2026-08-19', [MENSAL, TRIMESTRAL]);
    igual(p.inicio_periodo, '2026-08-19');
    igual(p.fim_periodo, '2026-11-17', '19/08 + 90 dias');
  });

  teste('a TOLERÂNCIA também é a do que entra, não a do que sai', () => {
    // Sai um plano sem tolerância, entra um que tolera 10. O atraso de 6 dias
    // tem de ser julgado pelo que ENTRA.
    const com = {
      ...assinatura, plano_id: TOL_ZERO.id, plano: TOL_ZERO,
      proximo_plano_id: TOL_DEZ.id,
    };
    const p = previaDaRenovacao(com, '2026-08-19', [TOL_ZERO, TOL_DEZ]);
    igual(p.tolerancia, 10);
    igual(p.inicio_periodo, FIM, 'pela tolerância do plano que sai, teria começado em 19/08');
    igual(p.forada, false);
  });

  teste('sem troca programada, quem manda é o plano vigente', () => {
    const p = previaDaRenovacao(assinatura, '2026-08-14', [MENSAL, TRIMESTRAL]);
    igual(p.fim_periodo, '2026-09-12');
    igual(p.trocaPlano, false);
  });

  teste('a RPC escolhe o plano que entra pelo mesmo coalesce', () => {
    const rpc = soCodigo(ler('../db/comercial_periodo_da_cobranca.sql'));
    contem(rpc, 'v_plano_id := v_ass.proximo_plano_id;');
    contem(rpc, 'v_duracao    := coalesce(v_plano.duracao_valor');
    contem(rpc, 'v_tolerancia := coalesce(v_plano.tolerancia_dias');
    contem(rpc, 'v_atraso := p_pago_em - v_ass.fim_periodo;');
    contem(rpc, 'if v_atraso <= v_tolerancia then');
  });
});


// ───────────────────────────────────────────────────────────
// A NOMENCLATURA — a divergência que quase entrou
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · o atraso mede contra fim_periodo, nunca contra o vencimento', () => {
  teste('a RPC compara com v_ass.fim_periodo, e não com o vencimento da cobrança', () => {
    const rpc = soCodigo(ler('../db/comercial_periodo_da_cobranca.sql'));
    contem(rpc, 'v_atraso := p_pago_em - v_ass.fim_periodo;');
    ok(!/v_atraso\s*:=\s*p_pago_em\s*-\s*v_lanc\.vencimento/.test(rpc),
      'o prazo financeiro não pode virar calendário da assinatura');
  });

  teste('o JS recebe fim_periodo, e o drawer passa exatamente isso', () => {
    const dw = ler('../js/comercial-drawer.js');
    const f = dw.slice(dw.indexOf('export function previaDaRenovacao'));
    contem(f.slice(0, f.indexOf('\n}')), 'fimVigente: assinatura.fim_periodo');
  });

  teste('O CASO DA CASO_COBRANCA_MANUAL: as duas leituras dão 11 dias de diferença', () => {
    // Período 03/08 → 02/09, cobrança manual criada em 14/08 vencendo 13/09,
    // pagamento em 05/09. É o exemplo que fechou a decisão.
    const celinea = { inicio_periodo: '2026-08-03', fim_periodo: '2026-09-02', plano: MENSAL };

    const certo = renovar({ fimVigente: celinea.fim_periodo, dataPagamento: '2026-09-05', plano: MENSAL });
    igual(certo.inicio_periodo, '2026-09-02', 'atraso de 3 dias, dentro da tolerância');
    igual(certo.fim_periodo, '2026-10-02');

    // A leitura recusada, simulada de propósito para o número ficar registrado.
    const errado = renovar({ fimVigente: '2026-09-13', dataPagamento: '2026-09-05', plano: MENSAL });
    igual(errado.inicio_periodo, '2026-09-13');
    igual(errado.fim_periodo, '2026-10-13');
    // Onze dias de presente, e cumulativos a cada ciclo.
  });

  teste('a documentação nomeia as duas datas', () => {
    const js = ler('../js/comercial.js');
    const doc = js.slice(js.indexOf('Onde começa o PRÓXIMO período'),
                         js.indexOf('export function inicioDaRenovacao'));
    contem(doc, 'assinatura.fim_periodo');
    contem(doc, 'financeiro_lancamentos.vencimento');
  });
});


// ───────────────────────────────────────────────────────────
// §12 — nada de duração no código
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · nenhuma duração de plano está no código', () => {
  teste('a regra não tem 30, 90, 180 nem 365 embutidos', () => {
    const js = ler('../js/comercial.js');
    const ini = js.indexOf('export function inicioDaRenovacao');
    const regra = js.slice(ini, js.indexOf('export function renovar'))
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const n of ['30', '90', '180', '365']) {
      ok(!new RegExp(`\\b${n}\\b`).test(regra), `${n} não pode aparecer na regra`);
    }
  });

  teste('a RPC não soma duração literal nenhuma', () => {
    const rpc = soCodigo(ler('../db/comercial_periodo_da_cobranca.sql'));
    const ini = rpc.indexOf('v_atraso := p_pago_em');
    const regra = rpc.slice(ini, rpc.indexOf('update public.comercial_assinaturas', ini));
    for (const n of ['30', '90', '180', '365']) {
      ok(!new RegExp(`\\b${n}\\b`).test(regra), `${n} não pode aparecer na aritmética do período`);
    }
    contem(regra, "(v_duracao || ' months')::interval");
    contem(regra, 'v_inicio + v_duracao');
  });

  teste('PRAZO_COBRANCA_DIAS é a única constante de 30, e não é duração', () => {
    const form = ler('../js/comercial-formularios.js');
    contem(form, 'export const PRAZO_COBRANCA_DIAS = 30');
    // Ela nunca pode encostar na renovação.
    const js = ler('../js/comercial.js');
    ok(!/PRAZO_COBRANCA/.test(js), 'o prazo financeiro não entra no calendário da assinatura');
  });
});


// ───────────────────────────────────────────────────────────
// SEM PLANO — falhar em vez de inventar
// ───────────────────────────────────────────────────────────
grupo('comercial · renovação · sem plano, a prévia recusa em vez de inventar', () => {
  teste('assinatura sem plano marca `incompleta`, e não 30 dias', () => {
    // `PLANO_PADRAO` daria 30 dias e tolerância 5 com cara de regra. Duração
    // inventada é pior que previsão recusada. Decidido em 14/08/2026.
    const sem = { id: 'a2', inicio_periodo: '2026-07-14', fim_periodo: FIM, valor_contratado: 330 };
    const p = previaDaRenovacao(sem, '2026-08-14', []);
    igual(p.semPlano, true);
    igual(p.incompleta, true);
  });

  teste('com plano, nada disso dispara', () => {
    const com = { id: 'a3', plano_id: MENSAL.id, plano: MENSAL, fim_periodo: FIM, valor_contratado: 330 };
    const p = previaDaRenovacao(com, '2026-08-14', [MENSAL]);
    igual(p.semPlano, false);
    igual(p.incompleta, false);
  });

  // ─────────────────────────────────────────────────────────
  // PENDÊNCIA DA MIGRAÇÃO MULTIUSUÁRIO — registrada em 14/08/2026
  // ─────────────────────────────────────────────────────────
  teste('tirar o TETO obriga a validar a organização do plano que ENTRA', () => {
    // A ASSIMETRIA: `comercial_registrar_pagamento` valida que a ASSINATURA é
    // da organização (`v_ass.nutri_id is distinct from v_org`), mas lê o plano
    // que entra sem a mesma checagem. A RPC da cobrança manual já valida o
    // plano futuro do mesmo jeito — então isto é assimetria, não decisão.
    //
    // Hoje é INOFENSIVO, e só por causa do teto temporário: enquanto a RPC
    // exigir `nutri_id = auth.uid()`, só o proprietário passa, e ele não tem
    // como apontar para plano de outra organização. No dia em que o teto sair
    // e a Recepção puder registrar pagamento, um `proximo_plano_id` de outra
    // organização passaria a reger o período — duração e tolerância alheias.
    //
    // Este teste não pede a correção agora. Ele amarra as duas coisas: quem
    // remover o teto sem pôr a checagem derruba a suíte. É a única forma de a
    // pendência sobreviver a quem não leu esta conversa.
    const rpc = soCodigo(ler('../db/comercial_periodo_da_cobranca.sql'));
    const fn = rpc.slice(rpc.indexOf('create or replace function public.comercial_registrar_pagamento'));
    const corpo = fn.slice(0, fn.indexOf('\n$fn$;'));

    const temTeto = corpo.includes('TETO TEMPORARIO');
    const validaOrgDoPlano = /select \* into v_plano[\s\S]{0,600}?v_plano\.nutri_id is distinct from v_org/.test(corpo);

    ok(temTeto || validaOrgDoPlano,
      'o teto saiu e o plano que ENTRA continua sem checagem de organização: ' +
      'um proximo_plano_id de outra organização passaria a reger o período. ' +
      'Ver db/comercial_renovacao_sem_plano.sql, que já traz o bloco pronto.');

    // Enquanto o teto está de pé, o estado esperado é exatamente este.
    igual(temTeto, true, 'se isto falhar, a Etapa 4B mexeu aqui — leia o comentário acima');
  });

  teste('a programação sem o plano na lista continua marcando incompleta', () => {
    const com = { id: 'a4', plano_id: MENSAL.id, plano: MENSAL, fim_periodo: FIM,
                  proximo_plano_id: 'p-que-nao-veio', valor_contratado: 330 };
    const p = previaDaRenovacao(com, '2026-08-14', [MENSAL]);
    igual(p.incompleta, true);
    igual(p.semPlano, false, 'aqui há plano; o que falta é o FUTURO');
  });
});
