// ═══════════════════════════════════════════════════════════
// COMERCIAL — formulários de plano e de assinatura
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem é o momento em que o contrato nasce: um preço
// lido errado ou um fim de período calculado errado aqui contamina todas as
// renovações seguintes.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import {
  planoVazio, planoDoBanco, validarPlano, planoParaBanco,
  assinaturaVazia, validarAssinatura, assinaturaParaBanco,
  formPlanoHtml, formAssinaturaHtml,
} from '../js/comercial-formularios.js';

const MENSAL = { id: 'p1', nome: 'Mensal - 3x', duracao_valor: 30, duracao_unidade: 'dia', preco_padrao: 330, tolerancia_dias: 5 };

// ───────────────────────────────────────────────────────────
grupo('comercial · validação do plano', () => {
  const base = () => ({ ...planoVazio(), nome: 'Mensal - 3x' });

  teste('plano sem nome não passa', () => {
    igual(Object.keys(validarPlano({ ...planoVazio() })).includes('nome'), true);
  });

  teste('o padrão já vem certo para a GoUp', () => {
    const v = planoVazio();
    igual(v.duracao_valor, '30');
    igual(v.duracao_unidade, 'dia');
    igual(v.tolerancia_dias, '5');
  });

  teste('duração tem que ser inteiro positivo', () => {
    ok(validarPlano({ ...base(), duracao_valor: '0' }).duracao_valor);
    ok(validarPlano({ ...base(), duracao_valor: '-5' }).duracao_valor);
    ok(validarPlano({ ...base(), duracao_valor: '1,5' }).duracao_valor);
    igual(validarPlano({ ...base(), duracao_valor: '90' }).duracao_valor, undefined);
  });

  teste('tolerância zero é válida — significa sem tolerância', () => {
    igual(validarPlano({ ...base(), tolerancia_dias: '0' }).tolerancia_dias, undefined);
    ok(validarPlano({ ...base(), tolerancia_dias: '-1' }).tolerancia_dias);
  });

  teste('frequência fora de 1 a 7 não passa', () => {
    ok(validarPlano({ ...base(), frequencia_semanal: '0' }).frequencia_semanal);
    ok(validarPlano({ ...base(), frequencia_semanal: '8' }).frequencia_semanal);
    igual(validarPlano({ ...base(), frequencia_semanal: '' }).frequencia_semanal, undefined);
  });

  teste('preço vazio é permitido — nem todo plano tem tabela', () => {
    igual(validarPlano({ ...base(), preco_padrao: '' }).preco_padrao, undefined);
  });
});

grupo('comercial · o plano vira registro do banco', () => {
  teste('"330,00" vira 330 e não 33000', () => {
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: '330,00' }).preco_padrao, 330);
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: 'R$ 330,00' }).preco_padrao, 330);
  });

  teste('"1.200,00" é mil e duzentos, não um e dois', () => {
    // O ponto é milhar quando há vírgula depois. Ler como 1,20 cobraria um
    // real e vinte de um plano de mil e duzentos.
    igual(planoParaBanco({ ...planoVazio(), nome: 'X', preco_padrao: '1.200,00' }).preco_padrao, 1200);
  });

  teste('campos em branco viram null, não string vazia', () => {
    const r = planoParaBanco({ ...planoVazio(), nome: 'X' });
    igual(r.preco_padrao, null);
    igual(r.frequencia_semanal, null);
    igual(r.descricao, null);
  });

  teste('números saem como número, não como texto', () => {
    const r = planoParaBanco({ ...planoVazio(), nome: 'X', duracao_valor: '90', tolerancia_dias: '3' });
    igual(r.duracao_valor, 90);
    igual(r.tolerancia_dias, 3);
  });

  teste('ida e volta do banco preserva o plano', () => {
    const volta = planoParaBanco(planoDoBanco(MENSAL));
    igual(volta.nome, 'Mensal - 3x');
    igual(volta.duracao_valor, 30);
    igual(volta.preco_padrao, 330);
    igual(volta.tolerancia_dias, 5);
  });
});

grupo('comercial · validação da assinatura', () => {
  const base = () => ({ ...assinaturaVazia(), paciente_id: 'pac1', plano_id: 'p1', inicio_periodo: '2026-08-06', data_inicio_original: '2026-08-06' });

  teste('sem cliente ou sem plano não passa', () => {
    ok(validarAssinatura({ ...base(), paciente_id: '' }, MENSAL).paciente_id);
    ok(validarAssinatura({ ...base(), plano_id: '' }, MENSAL).plano_id);
  });

  teste('o período não pode começar antes de o cliente existir', () => {
    // É o mesmo CHECK da tabela; barrar aqui evita um erro cru do Postgres.
    const erros = validarAssinatura({
      ...base(), data_inicio_original: '2026-08-10', inicio_periodo: '2026-08-06',
    }, MENSAL);
    ok(erros.inicio_periodo);
  });

  teste('renovação com o mesmo dia nas duas datas passa', () => {
    igual(validarAssinatura(base(), MENSAL).inicio_periodo, undefined);
  });

  teste('valor mal digitado não passa', () => {
    ok(validarAssinatura({ ...base(), valor_contratado: 'abacaxi' }, MENSAL).valor_contratado);
    igual(validarAssinatura({ ...base(), valor_contratado: '' }, MENSAL).valor_contratado, undefined);
  });
});

grupo('comercial · a assinatura vira registro do banco', () => {
  const form = () => ({
    ...assinaturaVazia(), paciente_id: 'pac1', plano_id: 'p1',
    inicio_periodo: '2026-08-06', data_inicio_original: '2026-08-06',
  });

  teste('o fim do período é CALCULADO, não digitado', () => {
    // 06/08 + 30 dias = 05/09. Ninguém digita essa data.
    igual(assinaturaParaBanco(form(), MENSAL).fim_periodo, '2026-09-05');
  });

  teste('trimestral usa a duração do plano, não 30 fixo', () => {
    const tri = { ...MENSAL, duracao_valor: 90 };
    igual(assinaturaParaBanco(form(), tri).fim_periodo, '2026-11-04');
  });

  teste('valor em branco copia o preço padrão do plano', () => {
    igual(assinaturaParaBanco(form(), MENSAL).valor_contratado, 330);
  });

  teste('valor preenchido GANHA do preço do plano', () => {
    // É o §9: o cliente antigo de R$ 330 continua em 330 quando o plano virar
    // R$ 350. O que vale é o que foi combinado com ele.
    const r = assinaturaParaBanco({ ...form(), valor_contratado: '350,00' }, MENSAL);
    igual(r.valor_contratado, 350);
  });

  teste('a data de início original viaja separada do período', () => {
    const r = assinaturaParaBanco({
      ...form(), data_inicio_original: '2024-03-01', inicio_periodo: '2026-08-06',
    }, MENSAL);
    igual(r.data_inicio_original, '2024-03-01');
    igual(r.inicio_periodo, '2026-08-06');
  });

  teste('a assinatura nasce ativa', () => {
    igual(assinaturaParaBanco(form(), MENSAL).status, 'ativa');
  });

  teste('observação em branco vira null e não string vazia', () => {
    igual(assinaturaParaBanco(form(), MENSAL).observacoes, null);
    igual(assinaturaParaBanco(form(), MENSAL).horario, null);
  });
});

grupo('comercial · o formulário de plano na tela', () => {
  const html = formPlanoHtml({ form: planoDoBanco(MENSAL), edicao: true });

  teste('duração e unidade são campos, não constantes', () => {
    contem(html, 'id="cmpDuracao"');
    contem(html, 'id="cmpUnidade"');
    contem(html, 'dias corridos');
    contem(html, 'meses calendário');
  });

  teste('explica que o preço não retroage', () => {
    // A regra é contraintuitiva o bastante para ficar na tela, não só no código.
    contem(html, 'não altera');
  });

  teste('explica o que a tolerância faz', () => {
    contem(html, 'continua do término anterior');
    contem(html, 'data do pagamento');
  });

  teste('erro aparece no campo, não num alerta do navegador', () => {
    const comErro = formPlanoHtml({ form: planoVazio(), erros: { nome: 'Dê um nome ao plano.' } });
    contem(comErro, 'cm-erro-campo');
    contem(comErro, 'Dê um nome ao plano.');
  });
});

grupo('comercial · o formulário de assinatura na tela', () => {
  const pacientes = [{ id: 'pac1', nome: 'Claudia Marcia' }];
  const html = formAssinaturaHtml({
    form: { ...assinaturaVazia(), plano_id: 'p1', inicio_periodo: '2026-08-06' },
    pacientes, planos: [MENSAL], plano: MENSAL,
  });

  teste('o fim do período aparece calculado, e não editável', () => {
    // Um input ali sugeriria que dá para contrariar a duração do plano.
    contem(html, '05/09/2026');
    contem(html, 'cm-calculado');
    naoContem(html, 'id="cmaFim"');
  });

  teste('o preço padrão do plano vira sugestão, não imposição', () => {
    contem(html, 'placeholder="330,00"');
    contem(html, 'id="cmaValor"');
  });

  teste('"cliente desde" se explica', () => {
    contem(html, 'nunca muda');
  });

  teste('observação comercial se separa do prontuário', () => {
    contem(html, 'Observações comerciais');
    contem(html, 'Nada clínico aqui');
  });

  teste('sem cliente disponível, diz o porquê em vez de lista vazia', () => {
    const vazio = formAssinaturaHtml({ form: assinaturaVazia(), pacientes: [], planos: [MENSAL] });
    contem(vazio, 'já têm assinatura ativa');
  });

  teste('horário sugere Diurno e Noturno sem travar neles', () => {
    // Hoje são esses dois; o plano é evoluir para 05:00, 06:00. `datalist`
    // sugere sem impedir.
    contem(html, '<datalist');
    contem(html, 'Diurno');
    contem(html, 'Noturno');
  });
});
