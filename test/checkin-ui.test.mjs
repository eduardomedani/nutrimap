// ═══════════════════════════════════════════════════════════
// CHECK-INS — Etapa 2 (painel do profissional)
// ═══════════════════════════════════════════════════════════
// A marcação é GERADA aqui e conferida como marcação.
//
// A regra que mais importa neste arquivo: a leitura de uma resposta antiga sai
// do SNAPSHOT, nunca de `checkin_perguntas`. Se lesse a pergunta de hoje,
// editar o modelo mudaria visualmente o passado — e o profissional leria uma
// resposta sob uma pergunta que não foi a feita.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  drawerModeloHtml, modeloVazio, perguntaVazia, validarModelo, perguntaHtml,
  configuracaoHtml, opcoesDeTipo, TIPO_ROTULO, FREQ_ROTULO, AJUDA_DIA_MES,
} from '../js/checkin-modelo-drawer.js';
import { modeloHtml, vazioModelosHtml } from '../js/checkin-modelos-ui.js';
import {
  valorLegivel, comparar, corpoRespostasHtml, porPergunta, linhaRespostaHtml,
} from '../js/checkin-respostas-ui.js';
import { panorama, indicadoresHtml, ocorrenciaHtml, cascaHtml, ABAS } from '../js/checkin-ui.js';
import { recorrenciaTexto, atribuicaoHtml, drawerAtribuirHtml, previaHtml, vazioHtml } from '../js/checkin-paciente-ui.js';

const modelosUi = readFileSync(new URL('../js/checkin-modelos-ui.js', import.meta.url), 'utf8');
const respUi    = readFileSync(new URL('../js/checkin-respostas-ui.js', import.meta.url), 'utf8');
const pacUi     = readFileSync(new URL('../js/checkin-paciente-ui.js', import.meta.url), 'utf8');
const globalUi  = readFileSync(new URL('../js/checkin-ui.js', import.meta.url), 'utf8');
const dados     = readFileSync(new URL('../js/checkin-data.js', import.meta.url), 'utf8');
const shell     = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css       = readFileSync(new URL('../css/checkin.css', import.meta.url), 'utf8');

const MODELO = { id: 'm1', nome: 'Check-in semanal', descricao: 'Como foi a semana',
                 frequencia_padrao: 'semanal', status: 'ativo' };

const SNAP = {
  modelo: { id: 'm1', nome: 'Check-in semanal' },
  perguntas: [
    { id: 'q1', texto: 'Como está sua fome?', tipo: 'escala', ordem: 1, obrigatoria: true,
      configuracao: { min: 0, max: 10 } },
    { id: 'q2', texto: 'Peso', tipo: 'numero', ordem: 2, configuracao: { unidade: 'kg' } },
    { id: 'q3', texto: 'Comentário', tipo: 'texto_longo', ordem: 3, configuracao: {} },
  ],
};

const OC = {
  id: 'o1', paciente_id: 'p1', modelo_id: 'm1', periodo: '2026-08-08',
  snapshot: SNAP, status: 'respondido', respondido_em: '2026-08-08T18:40:00',
  disponivel_em: '2026-08-08T00:00:00', prazo_em: '2026-08-14T23:59:59',
};


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · o módulo entra em Análise', () => {

  teste('o item está no menu, e não está cinza', () => {
    contem(shell, '<div class="nav-item" data-page="checkins">');
    naoContem(shell, 'nav-item disabled" data-page="checkins"');
  });

  teste('leva a uma tela de verdade', () => {
    contem(shell, '<div class="module-page" id="page-checkins"></div>');
    contem(shell, "if (pagina === 'checkins')");
    contem(shell, "await import('./js/checkin-ui.js')");
    contem(shell, 'css/checkin.css');
  });

  teste('o nome do paciente abre a ficha na aba Check-ins', () => {
    contem(shell, "irParaFicha: (pacienteId) => abrirRelatorio(pacienteId, 'checkins')");
  });

  teste('três abas, e só', () => {
    igual(ABAS.map(a => a.id), ['visao', 'modelos', 'respostas']);
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · construtor de modelos', () => {

  teste('nome e ao menos uma pergunta são exigidos', () => {
    igual(validarModelo({ nome: '', frequencia_padrao: 'semanal' }, []).erros.nome, 'Dê um nome ao modelo.');
    igual(validarModelo({ nome: 'X', frequencia_padrao: 'semanal' }, []).erros.perguntas,
          'Adicione ao menos uma pergunta.');
    ok(validarModelo({ nome: 'X', frequencia_padrao: 'semanal' }, [perguntaVazia(1)]).ok === false,
       'pergunta sem texto também barra');
  });

  teste('a configuração de cada pergunta é validada', () => {
    const p = { texto: 'Fome', tipo: 'escala', configuracao: { min: 10, max: 0 } };
    contem(validarModelo({ nome: 'X', frequencia_padrao: 'semanal' }, [p]).erros.p0, 'menor que o máximo');
    const ok1 = validarModelo({ nome: 'X', frequencia_padrao: 'semanal' },
      [{ texto: 'Fome', tipo: 'escala', configuracao: { min: 0, max: 10 } }]);
    ok(ok1.ok);
  });

  teste('pergunta inativa não conta para o mínimo, mas não invalida', () => {
    const ps = [{ texto: '', tipo: 'escala', ativo: false, configuracao: {} },
                { texto: 'Fome', tipo: 'escala', configuracao: { min: 0, max: 10 } }];
    ok(validarModelo({ nome: 'X', frequencia_padrao: 'semanal' }, ps).ok);
  });

  teste('rótulo amigável, nunca o enum técnico', () => {
    const h = opcoesDeTipo('escala');
    contem(h, 'Escala 0–10');
    contem(h, 'Múltipla escolha');
    contem(h, 'Sim ou não');
    igual(TIPO_ROTULO.texto_longo, 'Texto longo');
    // O value é técnico, mas o texto visível não.
    ok(!/>escala</.test(h) && !/>multipla_escolha</.test(h));
  });

  teste('escala mostra mínimo, máximo e as duas descrições', () => {
    const h = configuracaoHtml('escala', { min: 0, max: 10, label_min: 'Muito ruim', label_max: 'Excelente' }, 0);
    contem(h, 'Mínimo');
    contem(h, 'Máximo');
    contem(h, 'Descrição do mínimo');
    contem(h, 'Descrição do máximo');
    contem(h, 'Muito ruim');
  });

  teste('múltipla escolha lista opções e deixa reordenar', () => {
    const h = configuracaoHtml('multipla_escolha', { opcoes: ['Sempre', 'Nunca'] }, 0);
    contem(h, 'Sempre');
    contem(h, 'data-opcao-add');
    contem(h, 'data-opcao-sobe');
    contem(h, 'data-opcao-tira');
  });

  teste('número tem unidade, com min e max opcionais', () => {
    const h = configuracaoHtml('numero', { unidade: 'kg' }, 0);
    contem(h, 'Unidade');
    contem(h, 'Mínimo (opcional)');
    contem(h, 'Máximo (opcional)');
    contem(h, 'kg');
  });

  teste('sim/não e textos não configuram nada', () => {
    igual(configuracaoHtml('sim_nao', {}, 0), '');
    igual(configuracaoHtml('texto_curto', {}, 0), '');
    igual(configuracaoHtml('texto_longo', {}, 0), '');
  });

  teste('NUNCA aparece JSON na tela', () => {
    const h = drawerModeloHtml({
      form: MODELO,
      perguntas: [{ id: 'q1', texto: 'Fome', tipo: 'escala', configuracao: { min: 0, max: 10 } }],
    });
    naoContem(h, '{"min"');
    naoContem(h, 'configuracao =');
    ok(!/\{&quot;/.test(h), 'configuração vira campo com nome, não objeto');
  });

  teste('reordenar é por botão, sem dependência nova', () => {
    const h = perguntaHtml({ texto: 'A', tipo: 'escala', configuracao: {} }, 1, { total: 3 });
    contem(h, 'data-sobe');
    contem(h, 'data-desce');
    // Primeiro não sobe, último não desce.
    contem(perguntaHtml({ tipo: 'escala' }, 0, { total: 3 }), 'data-sobe data-i="0" disabled');
    contem(modelosUi, 'reordenarPerguntas(novos)');
    ok(!/sortable|dragula|draggable=/i.test(modelosUi + css), 'nada de biblioteca de arrastar');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · pergunta não se exclui', () => {

  teste('a ação é Desativar, e explica o histórico', () => {
    const h = perguntaHtml({ texto: 'A', tipo: 'escala', configuracao: {} }, 0, { total: 1 });
    contem(h, 'data-desativar');
    naoContem(h, 'Excluir');
    contem(modelosUi, 'não aparecerá em novos check-ins, mas o histórico será preservado');
  });

  teste('duplicar gera pergunta NOVA, sem id', () => {
    // É assim que se muda o significado sem quebrar a série da original.
    contem(modelosUi, 'id: undefined');
    contem(modelosUi, '(cópia)');
    contem(dados, 'export async function duplicarPergunta');
  });

  teste('o aviso de histórico aparece só em pergunta já usada', () => {
    const com = perguntaHtml({ texto: 'A', tipo: 'escala', configuracao: {} }, 0, { total: 1, temHistorico: true });
    contem(com, 'já possui histórico');
    contem(com, 'comprometer comparações futuras');
    contem(com, 'Duplicar');
    const sem = perguntaHtml({ texto: 'A', tipo: 'escala', configuracao: {} }, 0, { total: 1 });
    naoContem(sem, 'já possui histórico');
  });

  teste('o serviço não tem excluirPergunta', () => {
    ok(!/export async function excluirPergunta/.test(dados));
    contem(dados, 'export async function desativarPergunta');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · atribuição', () => {

  teste('semanal pede dia da semana; mensal, dia do mês; manual, nada', () => {
    const sem = drawerAtribuirHtml([MODELO], { frequencia: 'semanal', dataInicio: '2026-08-06', modeloId: '' });
    contem(sem, 'data-dia-semana');
    naoContem(sem, 'data-dia-mes');

    const men = drawerAtribuirHtml([MODELO], { frequencia: 'mensal', dataInicio: '2026-08-06', modeloId: '' });
    contem(men, 'data-dia-mes');
    naoContem(men, 'data-dia-semana');

    const man = drawerAtribuirHtml([MODELO], { frequencia: 'manual', dataInicio: '2026-08-06', modeloId: '' });
    naoContem(man, 'data-dia-semana');
    naoContem(man, 'data-dia-mes');
    contem(man, 'Sem data automática');
  });

  teste('a regra do dia 31 aparece na tela', () => {
    igual(AJUDA_DIA_MES, 'Em meses menores, será usado o último dia disponível.');
    contem(drawerAtribuirHtml([MODELO], { frequencia: 'mensal', dataInicio: '2026-08-06', modeloId: '' }),
           'último dia disponível');
  });

  teste('quinzenal se apresenta como 14 dias', () => {
    igual(FREQ_ROTULO.quinzenal, 'Quinzenal (a cada 14 dias)');
  });

  teste('a prévia usa a regra do domínio, sem recalcular', () => {
    contem(previaHtml({ frequencia: 'semanal', diaSemana: 1, dataInicio: '2026-08-06' }), '10/08/2026');
    contem(pacUi, 'calcularProximaOcorrencia(');
    // Nenhuma conta de data reescrita na tela.
    ok(!/setDate\(|getDay\(\) [-+]/.test(pacUi), 'a regra mora em checkin.js');
  });

  teste('a validação da frequência vem do domínio', () => {
    contem(pacUi, 'validarAtribuicao({ frequencia: form.frequencia');
    ok(!/frequencia === 'semanal' && !form\.diaSemana/.test(pacUi), 'não duplicar a regra aqui');
  });

  teste('a recorrência vira português', () => {
    igual(recorrenciaTexto({ frequencia: 'semanal', dia_semana: 1 }), 'Semanal · Toda segunda-feira');
    igual(recorrenciaTexto({ frequencia: 'mensal', dia_mes: 10 }), 'Mensal · Todo dia 10');
    igual(recorrenciaTexto({ frequencia: 'manual' }), 'Manual · sem data automática');
  });

  teste('o vazio da ficha convida a atribuir', () => {
    const h = vazioHtml();
    contem(h, 'Nenhum check-in atribuído.');
    contem(h, 'acompanhar evolução, adesão e bem-estar entre as consultas');
    contem(h, 'data-atribuir');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · gerar agora', () => {

  teste('usa a RPC existente, sem lógica paralela', () => {
    contem(pacUi, 'materializarOcorrencia({');
    contem(dados, "sb.rpc('materializar_ocorrencia_checkin'");
    // Nada de montar snapshot ou inserir ocorrência pela tela.
    for (const p of ["from('checkin_ocorrencias')\n    .insert", 'montarSnapshot(']) {
      ok(!pacUi.includes(p), `${p} seria uma segunda definição de ocorrência`);
    }
  });

  teste('segunda geração avisa que já existia, sem duplicar', () => {
    contem(pacUi, 'const jaExistia = antes.some(x => x.id === oc?.id)');
    contem(pacUi, 'Este check-in já existia para o período.');
  });

  teste('mostra quando fica disponível e qual o prazo', () => {
    contem(pacUi, 'Check-in criado. Disponível agora');
    contem(pacUi, 'prazo ${dataBR(oc.prazo_em)}');
  });

  teste('o prazo é derivado da frequência — sem coluna nova', () => {
    // checkin_atribuicoes não guarda prazo. Um semanal está atrasado quando o
    // da semana seguinte chega.
    contem(dados, 'export function prazoDaOcorrencia');
    contem(dados, 'calcularProximaOcorrencia(atribuicao, periodo)');
    contem(pacUi, 'prazoEm: prazoDaOcorrencia(a, periodo)');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · a resposta antiga sai do SNAPSHOT', () => {

  teste('a tela NUNCA consulta checkin_perguntas', () => {
    // Se lesse a pergunta de hoje, editar o modelo mudaria visualmente o
    // passado. É a regra central desta etapa.
    //
    // Sem comentários: os três arquivos CITAM `checkin_perguntas` justamente
    // para explicar que não a leem, e proibir a explicação seria uma guarda
    // que se resolve apagando o comentário.
    const semComentario = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    for (const [nome, src] of [['respostas-ui', respUi], ['paciente-ui', pacUi], ['checkin-ui', globalUi]]) {
      const codigo = semComentario(src);
      ok(!/checkin_perguntas/.test(codigo), `${nome} não pode ler a pergunta atual`);
      ok(!/listarPerguntas\(/.test(codigo), `${nome} não pode listar a pergunta atual`);
    }
    // E a montagem sai mesmo do snapshot.
    contem(respUi, 'ocorrencia?.snapshot');
    contem(respUi, 'snap.perguntas');
  });

  teste('o corpo é montado a partir do snapshot, na ordem dele', () => {
    const respostas = porPergunta([
      { pergunta_id: 'q3', tipo: 'texto_longo', valor: 'Semana difícil' },
      { pergunta_id: 'q1', tipo: 'escala', valor: 7 },
      { pergunta_id: 'q2', tipo: 'numero', valor: 78.4 },
    ]);
    const h = corpoRespostasHtml(OC, respostas);
    // Ordem do SNAPSHOT, não a de criado_em (que é a ordem em que digitou).
    ok(h.indexOf('Como está sua fome?') < h.indexOf('Peso'));
    ok(h.indexOf('Peso') < h.indexOf('Comentário'));
    contem(h, '7 / 10');
    contem(h, '78,4 kg');
    contem(h, 'Semana difícil');
  });

  teste('editar o modelo depois não muda a leitura antiga', () => {
    const respostas = porPergunta([{ pergunta_id: 'q1', tipo: 'escala', valor: 7 }]);
    const antes = corpoRespostasHtml(OC, respostas);
    // O "modelo de hoje" mudou o texto — o snapshot da ocorrência, não.
    contem(antes, 'Como está sua fome?');
    naoContem(antes, 'à noite');
  });

  teste('o valor se lê pelo tipo DO SNAPSHOT', () => {
    igual(valorLegivel({ tipo: 'escala', configuracao: { max: 10 } }, { valor: 7 }), '7 / 10');
    igual(valorLegivel({ tipo: 'numero', configuracao: { unidade: 'kg' } }, { valor: 78.4 }), '78,4 kg');
    igual(valorLegivel({ tipo: 'sim_nao' }, { valor: true }), 'Sim');
    igual(valorLegivel({ tipo: 'sim_nao' }, { valor: false }), 'Não');
    igual(valorLegivel({ tipo: 'texto_curto' }, { valor: 'oi' }), 'oi');
    igual(valorLegivel({ tipo: 'escala' }, null), '—');
  });

  teste('não respondido mostra as perguntas, sem inventar valor', () => {
    const h = corpoRespostasHtml({ ...OC, status: 'disponivel', respondido_em: null }, {});
    contem(h, 'Ainda não respondido');
    contem(h, 'Como está sua fome?');
    contem(h, 'ck-resp-vazio');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · comparação com a anterior', () => {

  teste('só escala e número comparam', () => {
    igual(comparar({ tipo: 'escala' }, { valor: 7 }, { valor: 5 }).texto, '+2');
    igual(comparar({ tipo: 'numero' }, { valor: 78.4 }, { valor: 80 }).texto, '-1,6');
    igual(comparar({ tipo: 'texto_longo' }, { valor: 'a' }, { valor: 'b' }), null);
    igual(comparar({ tipo: 'sim_nao' }, { valor: true }, { valor: false }), null);
    igual(comparar({ tipo: 'multipla_escolha' }, { valor: 'a' }, { valor: 'b' }), null);
  });

  teste('sem anterior, não compara', () => {
    igual(comparar({ tipo: 'escala' }, { valor: 7 }, null), null);
    igual(comparar({ tipo: 'escala' }, null, { valor: 5 }), null);
  });

  teste('igual é "igual", e nada é julgado como bom ou ruim', () => {
    igual(comparar({ tipo: 'escala' }, { valor: 7 }, { valor: 7 }).texto, 'igual');
    // Menos fome pode ser bom ou ruim, e a tela não tem como saber.
    ok(!/melhor|pior|positivo|negativo|verde|vermelho/i.test(respUi.slice(respUi.indexOf('export function comparar'))));
  });

  teste('a comparação é bônus — a leitura não depende dela', () => {
    contem(globalUi, 'comparação é bônus; a leitura principal não depende dela');
    contem(respUi, 'comparacao ? `');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · visão geral e lista global', () => {

  const AGORA = new Date('2026-08-10T12:00:00');
  const OCS = [
    { id: 'a', paciente_id: 'p1', status: 'respondido', respondido_em: '2026-08-09T10:00:00' },
    { id: 'b', paciente_id: 'p1', status: 'disponivel', prazo_em: '2026-08-20T00:00:00' },
    { id: 'c', paciente_id: 'p2', status: 'disponivel', prazo_em: '2026-08-05T00:00:00' },
    { id: 'd', paciente_id: 'p2', status: 'agendado' },
  ];

  teste('os números da operação saem de uma leitura só', () => {
    const n = panorama(
      { ocorrencias: OCS, modelos: [{ status: 'ativo' }, { status: 'arquivado' }],
        atribuicoes: [{ paciente_id: 'p1', ativo: true }, { paciente_id: 'p2', ativo: true }] },
      AGORA, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    igual(n.modelosAtivos, 1);
    igual(n.pacientesComCheckin, 2);
    igual(n.disponiveis, 1);
    igual(n.atrasados, 1);
    igual(n.aguardando, 2, 'disponível + atrasado');
    igual(n.respondidosSemana, 1);
    igual(n.semCheckin, 1);
  });

  teste('atrasado é derivado, nunca lido do banco', () => {
    // O filtro de situação é aplicado em JS, sobre o que voltou. Repetir a
    // regra de data em SQL criaria uma segunda definição de "atrasado", e as
    // duas divergiriam no primeiro ajuste de fuso ou de prazo.
    contem(globalUi, 'situacaoDaOcorrencia(o) === sitFiltro');
    ok(!/eq\('status', 'atrasado'\)/.test(globalUi + dados));
    ok(!/prazo_em.*lt\(|lt\(.*prazo_em/.test(dados), 'nada de comparar prazo no banco');
    // E a situação não é coluna: o CHECK do schema não tem 'atrasado'.
    const schema = readFileSync(new URL('../db/checkin_schema.sql', import.meta.url), 'utf8');
    ok(!/'atrasado'/.test(schema));
  });

  teste('só o que pede ação ganha cor', () => {
    const h = indicadoresHtml({ modelosAtivos: 1, pacientesComCheckin: 2, aguardando: 2,
                                atrasados: 1, respondidosSemana: 1, semCheckin: 0 });
    contem(h, 'ck-ind destaque');
    const zerado = indicadoresHtml({ modelosAtivos: 1, pacientesComCheckin: 2, aguardando: 0,
                                     atrasados: 0, respondidosSemana: 0, semCheckin: 0 });
    ok(!/ck-ind destaque/.test(zerado));
  });

  teste('a lista global identifica o paciente', () => {
    const h = ocorrenciaHtml({ ...OC, paciente_id: 'p1', paciente: { id: 'p1', nome: 'Eduardo' },
                               modelo: { nome: 'Semanal' } }, { comPaciente: true });
    contem(h, 'Eduardo');
    contem(h, 'data-ir-paciente="p1"');
    contem(h, 'Ver respostas');
  });

  teste('filtros à esquerda, ação principal no cabeçalho', () => {
    const h = cascaHtml('respostas', [{ id: 'p1', nome: 'Eduardo' }], [MODELO]);
    // Não disputam a mesma flex-wrap.
    ok(h.indexOf('data-novo-modelo') < h.indexOf('ck-filtros'));
    contem(h, 'data-f-paciente');
    contem(h, 'data-f-modelo');
    contem(h, 'data-f-situacao');
    contem(h, 'data-limpar');
  });

  teste('modelo sem paciente não é erro', () => {
    const h = modeloHtml(MODELO, { perguntas: 3, pacientes: 0 });
    contem(h, '0 pacientes');
    naoContem(h, 'erro');
  });

  teste('o vazio de modelos convida a criar', () => {
    contem(vazioModelosHtml(), 'Nenhum modelo criado.');
    contem(vazioModelosHtml(), 'Criar primeiro modelo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in ui · o que NÃO foi ligado', () => {

  const js = modelosUi + respUi + pacUi + globalUi + dados;

  teste('nada de cron, agendador ou processo em background', () => {
    const semComentario = js
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const p of ['setInterval', 'cron', 'requestIdleCallback']) {
      ok(!new RegExp(p, 'i').test(semComentario), `${p} é de outra etapa`);
    }
  });

  teste('nada de PWA, Timeline, Saúde 360°, push ou notificação', () => {
    for (const p of ['registrarEvento', 'paciente_notificacoes', 'enviar-push',
                     'CHECKIN_COMPLETED', 'pwa-', 'paciente-painel']) {
      ok(!js.includes(p), `${p} é de etapa seguinte`);
    }
  });

  teste('nenhuma escrita direta em respostas', () => {
    // Quem grava é a RPC de finalização, e ela é da Etapa 3.
    ok(!/from\('checkin_respostas'\)[\s\S]{0,40}\.(insert|update|delete)/.test(js));
    contem(dados, 'export async function finalizarCheckin');
    contem(dados, "sb.rpc('finalizar_checkin'");
  });

  teste('nenhuma migration nova', () => {
    // A Etapa 2 é CRUD sobre o que a Fundação criou.
    const schema = readFileSync(new URL('../db/checkin_schema.sql', import.meta.url), 'utf8');
    ok(!/prazo_dias|prazo_resposta/.test(schema), 'o prazo é derivado da frequência');
  });
});
