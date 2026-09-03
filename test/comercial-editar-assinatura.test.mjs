// ═══════════════════════════════════════════════════════════
// COMERCIAL — editar assinatura
// ═══════════════════════════════════════════════════════════
// A tela não existia, e a falta dela apareceu de um jeito torto: seis
// assinaturas estavam sem horário e não havia como preencher. `salvarAssinatura`
// existia em js/comercial-data.js desde a Etapa 2, testada, e nenhuma linha do
// frontend a chamava.
//
// O que estes testes protegem não é o formulário — é o que ele NÃO deixa mexer.
// Plano, período e cliente têm efeito colateral (renovação programada, "um
// pagamento = uma renovação", identidade do contrato). Um patch que os
// carregasse por engano reescreveria as três coisas com o que a tela tinha em
// memória, e nada na interface diria que isso aconteceu.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  edicaoAssinaturaVazia, validarEdicaoAssinatura,
  edicaoAssinaturaParaBanco, formEdicaoAssinaturaHtml,
} from '../js/comercial-formularios.js';

const FONTE = readFileSync(new URL('../js/comercial-formularios.js', import.meta.url), 'utf8');
const DRAWER = readFileSync(new URL('../js/comercial-drawer.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/comercial.css', import.meta.url), 'utf8');

const ASSINATURA = {
  id: 'a1',
  paciente: { id: 'p1', nome: 'Cliente Exemplo' },
  plano: { id: 'pl1', nome: 'Mensal - 3x', preco_padrao: 330 },
  valor_contratado: 311,
  horario: 'Noturno',
  data_inicio_original: '2026-01-10',
  inicio_periodo: '2026-08-11',
  fim_periodo: '2026-09-10',
  observacoes: 'prefere Pix',
  renovacao_automatica: true,
};

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · o formulário nasce do que está gravado', () => {
  teste('os cinco campos vêm da assinatura, não vazios', () => {
    const f = edicaoAssinaturaVazia(ASSINATURA);
    igual(f.valor_contratado, '311,00');
    igual(f.horario, 'Noturno');
    igual(f.data_inicio_original, '2026-01-10');
    igual(f.observacoes, 'prefere Pix');
    igual(f.renovacao_automatica, true);
  });

  teste('assinatura sem horário abre com o campo vazio, não com "null"', () => {
    // É o caso que motivou a tela. Um `null` virando a string "null" no campo
    // faria a pessoa salvar a palavra.
    const f = edicaoAssinaturaVazia({ ...ASSINATURA, horario: null, observacoes: null });
    igual(f.horario, '');
    igual(f.observacoes, '');
  });

  teste('renovação automática desligada continua desligada ao abrir', () => {
    igual(edicaoAssinaturaVazia({ ...ASSINATURA, renovacao_automatica: false }).renovacao_automatica, false);
  });
});

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · o patch só carrega o que a tela edita', () => {
  const CAMPOS = ['valor_contratado', 'horario', 'data_inicio_original',
                  'observacoes', 'renovacao_automatica'];

  teste('exatamente cinco chaves saem para o banco', () => {
    const patch = edicaoAssinaturaParaBanco(edicaoAssinaturaVazia(ASSINATURA));
    igual(Object.keys(patch).sort().join(','), [...CAMPOS].sort().join(','));
  });

  teste('plano, período e cliente NUNCA entram no patch', () => {
    // O teste que mais importa deste arquivo. Se um deles vazar, um `update`
    // reescreve o contrato com o que a tela tinha em memória.
    const patch = edicaoAssinaturaParaBanco({
      ...edicaoAssinaturaVazia(ASSINATURA),
      // Mesmo que alguém injete os campos no form, eles não podem sair daqui.
      plano_id: 'outro', paciente_id: 'outro',
      inicio_periodo: '2020-01-01', fim_periodo: '2020-02-01', status: 'cancelada',
    });
    for (const proibido of ['plano_id', 'paciente_id', 'inicio_periodo', 'fim_periodo', 'status']) {
      ok(!(proibido in patch), `${proibido} vazou para o patch`);
    }
  });

  teste('valor apagado vira null, e não o preço do plano', () => {
    // Na CRIAÇÃO, campo em branco copia o preço vigente. Aqui, apagar é dizer
    // "volte a seguir o plano" — copiar o preço de novo congelaria o valor de
    // hoje, que é o oposto do pedido.
    const patch = edicaoAssinaturaParaBanco({ ...edicaoAssinaturaVazia(ASSINATURA), valor_contratado: '' });
    igual(patch.valor_contratado, null);
  });

  teste('horário e observação em branco viram null, não string vazia', () => {
    const patch = edicaoAssinaturaParaBanco({
      ...edicaoAssinaturaVazia(ASSINATURA), horario: '   ', observacoes: '',
    });
    igual(patch.horario, null);
    igual(patch.observacoes, null);
  });

  teste('o horário digitado chega inteiro', () => {
    const patch = edicaoAssinaturaParaBanco({ ...edicaoAssinaturaVazia(ASSINATURA), horario: 'Diurno' });
    igual(patch.horario, 'Diurno');
  });

  teste('valor com vírgula é lido como decimal', () => {
    const patch = edicaoAssinaturaParaBanco({ ...edicaoAssinaturaVazia(ASSINATURA), valor_contratado: '1.121,00' });
    igual(patch.valor_contratado, 1121);
  });
});

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · validação', () => {
  teste('valor inválido é recusado antes de ir ao banco', () => {
    const e = validarEdicaoAssinatura({ valor_contratado: 'abc' }, ASSINATURA);
    ok(e.valor_contratado, 'valor inválido tem que ser apontado no campo');
  });

  teste('valor em branco é válido — significa "siga o plano"', () => {
    igual(Object.keys(validarEdicaoAssinatura({ valor_contratado: '' }, ASSINATURA)).length, 0);
  });

  teste('"cliente desde" depois do período em curso é recusado', () => {
    // É o mesmo CHECK que a tabela tem. Deixar passar devolveria um erro cru do
    // Postgres em vez de uma frase.
    const e = validarEdicaoAssinatura({ data_inicio_original: '2026-09-01' }, ASSINATURA);
    ok(e.data_inicio_original);
  });

  teste('"cliente desde" antes do período em curso passa', () => {
    igual(Object.keys(validarEdicaoAssinatura({ data_inicio_original: '2020-01-01' }, ASSINATURA)).length, 0);
  });
});

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · a tela segue o design system', () => {
  const html = formEdicaoAssinaturaHtml({
    assinatura: ASSINATURA, form: edicaoAssinaturaVazia(ASSINATURA),
  });

  teste('usa o drawer do módulo, com rótulo de diálogo', () => {
    contem(html, 'class="cm-drawer"');
    contem(html, 'role="dialog"');
    contem(html, 'aria-modal="true"');
    contem(html, 'cm-drawer-topo');
    contem(html, 'cm-drawer-corpo');
    contem(html, 'cm-drawer-pe');
  });

  teste('os campos usam as classes do módulo', () => {
    contem(html, 'class="cm-campo');
    contem(html, 'cm-linha-campos');
    contem(html, 'cm-ajuda-campo');
    contem(html, 'class="cm-check"');
  });

  teste('o rodapé tem Voltar e Salvar, com o forte à direita', () => {
    contem(html, 'data-fechar>Voltar');
    contem(html, 'cm-btn cm-btn-forte" type="button" data-salvar');
    ok(html.indexOf('data-fechar>Voltar') < html.indexOf('data-salvar'),
       'o botão forte fica por último, como nos outros drawers');
  });

  teste('o que não se edita aparece como LEITURA, não como campo cinza', () => {
    // Campo desabilitado convida a tentar clicar. Mesma decisão de
    // `formEdicaoHtml` para a cobrança.
    contem(html, 'cm-dw-leitura');
    contem(html, 'Cliente Exemplo');
    contem(html, 'Mensal - 3x');
    naoContem(html, 'disabled');
    naoContem(html, 'readonly');
  });

  teste('não existe campo de plano, período ou cliente', () => {
    for (const id of ['cmaPlano', 'cmaInicio', 'cmaPaciente']) naoContem(html, id);
    naoContem(html, '<select');
  });

  teste('a tela diz onde se troca de plano', () => {
    // Sem isso, "não dá para trocar o plano aqui" vira beco sem saída.
    contem(html, 'Criar cobrança do período');
  });

  teste('o campo de horário oferece as duas grafias conhecidas', () => {
    // Texto livre com datalist: a sugestão evita "noturno", "Noite", "NOTURNO"
    // virarem três turnos diferentes na contagem da folha.
    contem(html, 'list="cmEaHorarios"');
    contem(html, '<option value="Diurno">');
    contem(html, '<option value="Noturno">');
  });

  teste('o valor mostra o preço do plano como placeholder', () => {
    contem(html, 'placeholder="330,00"');
  });

  teste('erro aparece no campo, não em alerta solto', () => {
    const comErro = formEdicaoAssinaturaHtml({
      assinatura: ASSINATURA, form: edicaoAssinaturaVazia(ASSINATURA),
      erros: { valor_contratado: 'Valor inválido.' },
    });
    contem(comErro, 'cm-erro-campo');
    contem(comErro, 'Valor inválido.');
  });
});

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · a fiação no drawer do cliente', () => {
  teste('a seção Assinatura ganhou o botão', () => {
    contem(DRAWER, 'data-editar-assinatura');
    contem(DRAWER, 'data-lucide="pencil"');
  });

  teste('o botão chama salvarAssinatura, que estava órfã', () => {
    contem(DRAWER, 'dados.salvarAssinatura(assinatura.id, patch)');
  });

  teste('reabre com o que o banco confirmou, não com a cópia em memória', () => {
    // Mesma decisão de "criar cobrança": se o banco recusar parte do patch, a
    // tela mostra o que ficou gravado, não o que se tentou gravar.
    contem(DRAWER, '{ ...assinatura, ...r }');
    contem(DRAWER, 'aoMudar?.()');
  });

  teste('sair da edição devolve ao cliente', () => {
    contem(DRAWER, 'aoVoltar: () => abrirDrawerCliente({ assinatura, aoMudar })');
  });

  teste('o toast diz ASSINATURA, e não cobrança', () => {
    // As duas edições convivem no mesmo drawer; um toast genérico deixaria a
    // pessoa sem saber qual das duas salvou.
    contem(DRAWER, 'assinaturaSalva:');
    contem(DRAWER, "'Assinatura atualizada.'");
  });

  teste('secao() ganhou a ação sem quebrar quem já usava', () => {
    contem(DRAWER, "function secao(titulo, conteudo, acao = '')");
    contem(DRAWER, 'cm-dw-secao-topo');
  });
});

// ───────────────────────────────────────────────────────────
grupo('editar assinatura · o CSS não estica o botão do cabeçalho', () => {
  teste('a regra do cabeçalho existe e vence a geral', () => {
    // `.cm-dw-secao .cm-btn` dá 100% de largura — certo para "Registrar
    // pagamento", errado para um "Editar" ao lado do título.
    contem(CSS, '.cm-dw-secao-topo');
    contem(CSS, '.cm-dw-secao-topo .cm-btn');
    const topo = CSS.slice(CSS.indexOf('.cm-dw-secao-topo .cm-btn'));
    contem(topo.slice(0, 120), 'width: auto');
  });

  teste('a regra do cabeçalho vem DEPOIS da geral no arquivo', () => {
    // As duas têm a MESMA especificidade (0,2,0): `.cm-dw-secao .cm-btn` e
    // `.cm-dw-secao-topo .cm-btn`. Empate resolve por ordem, então a do
    // cabeçalho só ganha se vier por último.
    //
    // Este teste já pegou o erro uma vez: a regra nasceu junto de
    // `.cm-dw-secao-topo`, lá no alto do arquivo, e perdia da geral — o botão
    // esticava atravessando o drawer, sem nada explicando por quê.
    ok(CSS.indexOf('.cm-dw-secao-topo .cm-btn') > CSS.indexOf('.cm-dw-secao .cm-btn'),
       'a regra do cabeçalho precisa vir depois para ganhar da geral');
  });
});
