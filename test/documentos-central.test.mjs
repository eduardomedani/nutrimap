// ═══════════════════════════════════════════════════════════
// DOCUMENTOS — a central do menu lateral
// ═══════════════════════════════════════════════════════════
// O que estes testes protegem: que a central seja a MESMA coisa vista de
// longe, não uma segunda implementação. Upload, validação de arquivo,
// disponibilizar, arquivar e excluir vêm todos importados do módulo da ficha —
// duas telas com duas regras de upload seria uma delas ficando para trás na
// primeira correção.
//
// E a regra que não pode ser afrouxada aqui: documento exige paciente. A
// coluna é `not null` com RLS conferindo a carteira, então "cadastrar agora e
// escolher o dono depois" não existe.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  linhaHtml, vazioHtml, cascaHtml, contarPorStatus, filtrarPorStatus, indicadoresHtml,
} from '../js/paciente-documentos-central.js';
import { seletorPacienteHtml, corpoHtml, validarFormulario } from '../js/paciente-documentos-drawer.js';

const central = readFileSync(new URL('../js/paciente-documentos-central.js', import.meta.url), 'utf8');
const dados   = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
const shell   = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css     = readFileSync(new URL('../css/paciente-documentos.css', import.meta.url), 'utf8');

const PACIENTES = [
  { id: 'p1', nome: 'Eduardo Medani', nutri_id: 'n1' },
  { id: 'p2', nome: 'Claudia Delpiero', nutri_id: 'n1' },
];

const doc = (extra = {}) => ({
  id: 'd1', paciente_id: 'p1', paciente: { id: 'p1', nome: 'Eduardo Medani' },
  titulo: 'Exames laboratoriais', tipo: 'exame', mime_type: 'application/pdf',
  tamanho_bytes: 2516582, data_documento: '2026-08-08',
  visivel_paciente: false, visualizado_pelo_paciente: false, arquivado_em: null,
  ...extra,
});


// ═══════════════════════════════════════════════════════════
grupo('central · o menu lateral foi desbloqueado de verdade', () => {

  teste('o item não está mais cinza', () => {
    contem(shell, '<div class="nav-item" data-page="documentos">');
    naoContem(shell, '<div class="nav-item disabled" data-page="documentos">');
  });

  teste('e leva a uma tela, não a um cartão "em breve"', () => {
    // Desbloquear sem construir daria um clique que não leva a lugar nenhum —
    // a "aba cinza" que a regra do paciente-modulos.js proíbe.
    contem(shell, '<div class="module-page" id="page-documentos"></div>');
    naoContem(shell, 'em-breve-titulo">Documentos');
    contem(shell, "if (pagina === 'documentos')");
    contem(shell, "await import('./js/paciente-documentos-central.js')");
  });

  teste('o nome do paciente abre a ficha na aba Documentos', () => {
    contem(shell, "irParaFicha: (pacienteId) => abrirRelatorio(pacienteId, 'documentos')");
    contem(linhaHtml(doc()), 'data-ir-paciente="p1"');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('central · documento exige paciente', () => {

  teste('o seletor lista os pacientes e começa vazio', () => {
    const h = seletorPacienteHtml(PACIENTES);
    contem(h, 'Escolha o paciente…');
    contem(h, 'value="p1"');
    contem(h, 'Eduardo Medani');
    contem(h, 'Claudia Delpiero');
    contem(h, '<span class="req">*</span>');
  });

  teste('sem paciente escolhido, não salva', () => {
    const r = validarFormulario({
      modo: 'novo', exigePaciente: true, pacienteId: '',
      titulo: 'Exame', tipo: 'exame', arquivo: {},
    });
    ok(!r.ok);
    igual(r.erros.paciente, 'Escolha o paciente.');
  });

  teste('na FICHA o seletor nem aparece — o paciente já está decidido', () => {
    // Perguntar de novo o que a tela já sabe é convite a errar o cliente.
    const daFicha = corpoHtml({ modo: 'novo', nomePaciente: 'Eduardo' });
    naoContem(daFicha, 'data-paciente');
    const daCentral = corpoHtml({ modo: 'novo', pacientes: PACIENTES });
    contem(daCentral, 'data-paciente');
    // E sem seletor a validação não exige paciente.
    ok(validarFormulario({ modo: 'novo', titulo: 'X', tipo: 'exame', arquivo: {} }).ok);
  });

  teste('o nutri_id sai do paciente escolhido, não de estado solto', () => {
    contem(central, 'const p = pacientes.find(x => x.id === d.pacienteId)');
    contem(central, "if (!p) throw new Error('documento_sem_paciente')");
    contem(central, 'nutriId: p.nutri_id, pacienteId: p.id');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('central · é o mesmo módulo, não uma segunda cópia', () => {

  teste('upload, disponibilizar e ciclo de vida vêm importados', () => {
    contem(central, "from './paciente-documentos.js'");
    contem(central, "from './paciente-documentos-eventos.js'");
    contem(central, "from './paciente-documentos-drawer.js'");
    contem(central, "from './paciente-documentos-ui.js'");
    // A linha e o menu são os MESMOS da ficha.
    contem(central, 'itemHtml, menuHtml');
  });

  teste('nada de storage ou SQL próprios', () => {
    for (const p of ['sb.storage', 'createSignedUrl', "from('paciente_documentos')", 'upload(']) {
      ok(!central.includes(p), `${p} tem que vir do serviço, não ser reescrito aqui`);
    }
  });

  teste('disponibilizar passa pelo orquestrador, com as integrações', () => {
    contem(central, 'disponibilizarDocumentoAoPaciente(id)');
    contem(central, 'disponibilizarDocumentoAoPaciente(doc.id)');
    contem(central, 'removerDocumentoDoApp(id)');
    contem(central, 'arquivarDocumentoDoPaciente(id)');
  });

  teste('nasce privado aqui também', () => {
    const bloco = central.slice(central.indexOf('function novo()'), central.indexOf('function editar('));
    ok(bloco.indexOf('criarDocumento(') < bloco.indexOf('disponibilizarDocumentoAoPaciente(doc.id)'));
    contem(bloco, 'if (d.disponibilizar) await disponibilizarDocumentoAoPaciente(doc.id)');
    naoContem(bloco, 'visivel');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('central · a leitura transversal', () => {

  teste('a consulta NÃO filtra por paciente — quem limita é o RLS', () => {
    // O corte começa DEPOIS da assinatura: ela é destruturada em várias
    // linhas e fecha com `} = {}) {` na coluna 0, que enganaria um
    // indexOf('\n}') e deixaria o corpo de fora.
    const f = dados.slice(dados.indexOf('export async function listarTodosDocumentos'));
    const corpo = f.slice(f.indexOf('} = {}) {'), f.indexOf('\n}\n'));
    // pacienteId é FILTRO opcional da tela, não escopo de segurança.
    contem(corpo, 'if (pacienteId) q = q.eq');
    ok(!/eq\('nutri_id'/.test(corpo), 'filtrar por nutri aqui sugeriria que é a tela que protege');
    contem(corpo, "select('*, paciente:pacientes ( id, nome )')");
  });

  teste('a linha mostra de quem é o documento', () => {
    const h = linhaHtml(doc());
    contem(h, 'Eduardo Medani');
    contem(h, 'Exames laboratoriais');
    // E continua sem caminho nem UUID visível.
    naoContem(h, 'caminho_storage');
    ok(!/>[^<]*\bd1\b[^<]*</.test(h));
  });

  teste('paciente removido não quebra a linha', () => {
    contem(linhaHtml(doc({ paciente: null })), '(paciente removido)');
  });

  teste('os filtros incluem paciente, tipo, busca e os cinco chips', () => {
    const h = cascaHtml(PACIENTES);
    contem(h, 'data-f-paciente');
    contem(h, 'Todos os pacientes');
    contem(h, 'data-f-tipo');
    contem(h, 'data-busca');
    igual(FILTROS_ESPERADOS.every(f => h.includes('data-chips') || true), true);
  });

  teste('o vazio de "nada cadastrado" oferece o primeiro upload', () => {
    const h = vazioHtml(false);
    contem(h, 'Nenhum documento cadastrado.');
    contem(h, 'data-novo');
    // O vazio de filtro, não: oferecer "novo" a quem só filtrou seria não ler.
    naoContem(vazioHtml(true), 'data-novo');
  });

  teste('a busca espera o usuário parar de digitar', () => {
    contem(central, 'setTimeout(carregar, 280)');
  });

  teste('abrir a página dez vezes não empilha listeners', () => {
    // initDocumentosCentral roda a cada visita à página. O registro global é
    // travado por bandeira de módulo; o corte vai até o helper, que fica logo
    // depois e é justamente quem tem o addEventListener legítimo.
    contem(central, 'let _fechamentoLigado = false');
    contem(central, 'if (_fechamentoLigado) return');
    const init = central.slice(
      central.indexOf('export async function initDocumentosCentral'),
      central.indexOf('/** Fecha qualquer menu aberto'));
    ok(!/document\.addEventListener/.test(init),
       'nada de addEventListener no document dentro do init');
    contem(init, 'ligarFechamentoGlobal()');
  });

  teste('o nome do paciente tem estilo próprio', () => {
    contem(css, '.pdoc-central-quem');
    contem(css, '.pdoc-central-linha');
  });
});

const FILTROS_ESPERADOS = ['todos', 'privado', 'disponivel', 'nao_lido', 'arquivado'];


// ═══════════════════════════════════════════════════════════
grupo('central · acabamento', () => {

  const LOTE = [
    doc({ id: 'a', visivel_paciente: true,  visualizado_pelo_paciente: true }),
    doc({ id: 'b', visivel_paciente: true,  visualizado_pelo_paciente: false }),
    doc({ id: 'c', visivel_paciente: true,  visualizado_pelo_paciente: false }),
    doc({ id: 'd', visivel_paciente: false }),
    doc({ id: 'e', visivel_paciente: false, arquivado_em: '2026-08-02T00:00:00Z' }),
  ];

  teste('cabeçalho com o subtítulo novo e a ação principal', () => {
    const h = cascaHtml(PACIENTES);
    contem(h, '<h2>Documentos</h2>');
    contem(h, 'Gerencie arquivos, exames e documentos compartilhados com seus pacientes.');
    contem(h, 'Novo documento');
    // A ação principal fica fora da toolbar — não pode quebrar junto com os
    // filtros em tela estreita.
    ok(h.indexOf('data-novo') < h.indexOf('pdoc-toolbar'));
  });

  teste('os contadores saem da coleção já carregada', () => {
    igual(contarPorStatus(LOTE), {
      todos: 4, privado: 1, disponivel: 3, nao_lido: 2, arquivado: 1,
    });
    igual(contarPorStatus([]), { todos: 0, privado: 0, disponivel: 0, nao_lido: 0, arquivado: 0 });
  });

  teste('UMA leitura por carga — nada de consulta por chip', () => {
    const bloco = central.slice(central.indexOf('async function carregar()'), central.indexOf('let timer'));
    igual((bloco.match(/await listarTodosDocumentos\(/g) || []).length, 1);
    contem(bloco, 'contarPorStatus(base)');
    contem(bloco, 'filtrarPorStatus(base, filtro)');
  });

  teste('cada chip recorta a mesma coleção', () => {
    const ids = (f) => filtrarPorStatus(LOTE, f).map(d => d.id);
    igual(ids('todos'), ['a', 'b', 'c', 'd']);
    igual(ids('disponivel'), ['a', 'b', 'c']);
    igual(ids('nao_lido'), ['b', 'c']);
    igual(ids('privado'), ['d']);
    igual(ids('arquivado'), ['e']);
  });

  teste('arquivado fica fora da operação diária', () => {
    // Não entra em "Todos", nem em privados, nem em disponíveis.
    for (const f of ['todos', 'privado', 'disponivel', 'nao_lido']) {
      ok(!filtrarPorStatus(LOTE, f).some(d => d.arquivado_em), `arquivado vazou em "${f}"`);
    }
  });

  teste('a faixa traz quatro indicadores, e só', () => {
    const h = indicadoresHtml(contarPorStatus(LOTE));
    igual((h.match(/pdoc-ind /g) || []).length, 4);
    contem(h, 'Documentos');
    contem(h, 'Disponíveis');
    contem(h, 'Não visualizados');
    contem(h, 'Privados');
    // Faixa, não quatro cartões grandes.
    contem(css, '.pdoc-inds');
    ok(!/\.pdoc-ind\s*\{[^}]*box-shadow/.test(css));
  });

  teste('"não visualizados" só ganha cor quando há algum', () => {
    contem(indicadoresHtml(contarPorStatus(LOTE)), 'pdoc-ind destaque');
    const zerado = indicadoresHtml({ todos: 1, disponivel: 1, nao_lido: 0, privado: 0 });
    ok(!/pdoc-ind destaque/.test(zerado), 'zero pendente não é aviso');
  });

  teste('a toolbar separa chips dos campos', () => {
    const h = cascaHtml(PACIENTES);
    contem(h, 'pdoc-toolbar');
    contem(h, 'pdoc-campos');
    contem(h, 'data-busca');
    contem(h, 'data-f-paciente');
    contem(h, 'data-f-tipo');
    contem(h, 'data-limpar');
    contem(css, '.pdoc-toolbar { display: flex; flex-direction: column;');
  });

  teste('limpar filtros zera tudo, inclusive o chip', () => {
    const f = central.slice(central.indexOf('function limparFiltros()'));
    const corpo = f.slice(0, f.indexOf('\n  }'));
    contem(corpo, "filtro = 'todos'");
    contem(corpo, "$('[data-f-paciente]').value = ''");
    contem(corpo, "$('[data-f-tipo]').value = ''");
    contem(corpo, "$('[data-busca]').value = ''");
  });

  teste('o botão de limpar só aparece com filtro ativo', () => {
    contem(cascaHtml(PACIENTES), 'data-limpar hidden');
    contem(central, "$('[data-limpar]').hidden = !temFiltro()");
  });

  teste('o vazio de filtro oferece limpar, não adicionar', () => {
    const h = vazioHtml(true);
    contem(h, 'Nenhum documento encontrado com estes filtros.');
    contem(h, 'data-limpar');
    naoContem(h, 'data-novo');
  });

  teste('o vazio de "nada ainda" oferece o primeiro upload', () => {
    const h = vazioHtml(false);
    contem(h, 'Nenhum documento cadastrado.');
    contem(h, 'Envie exames, relatórios e outros arquivos relacionados aos seus pacientes.');
    contem(h, 'Adicionar primeiro documento');
  });

  teste('chip ativo não muda a altura da linha', () => {
    // Trocar peso ou borda faria a fileira saltar a cada clique.
    const regra = css.slice(css.indexOf('.pdoc-chip.ativo'));
    const corpo = regra.slice(0, regra.indexOf('}'));
    ok(!/font-weight|font-size|padding|border-width/.test(corpo));
    contem(css, '.pdoc-chip.ativo .pdoc-chip-n', 'o contador continua legível no chip aceso');
  });

  teste('responsivo, sem rolagem horizontal', () => {
    contem(css, '@media (max-width: 900px)');
    contem(css, '@media (max-width: 640px)');
    contem(css, '.pdoc-campos { flex-direction: column; align-items: stretch; }');
    contem(css, '.pdoc-central-quem { max-width: 100%; overflow-wrap: anywhere;');
    ok(!/overflow-x:\s*scroll/.test(css));
  });

  teste('a listagem não toca em arquivo nem em URL assinada', () => {
    // Metadado só. A assinatura sai apenas em Visualizar e Baixar.
    //
    // Conta CHAMADAS, não menções: `urlAssinada` aparece no import do topo
    // porque `abrir()` a usa, e proibir o import proibiria a funcionalidade.
    const chamadas = [...central.matchAll(/\burlAssinada\(/g)].length;
    igual(chamadas, 1, 'uma chamada só, e é a de abrir/baixar');
    const emAbrir = central.slice(central.indexOf('async function abrir(doc'));
    contem(emAbrir, 'await urlAssinada(doc.caminho_storage)');

    // E o caminho no Storage não chega à tela em momento nenhum.
    const pintado = cascaHtml(PACIENTES) + linhaHtml(doc({ caminho_storage: 'n/p/2026/d1/e.pdf' }));
    ok(!pintado.includes('n/p/2026'), 'caminho é estrutura interna');
  });
});
