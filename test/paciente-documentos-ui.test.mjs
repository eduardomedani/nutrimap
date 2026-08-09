// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — Etapa 2 (painel do profissional)
// ═══════════════════════════════════════════════════════════
// Como no teste da dieta, a marcação é GERADA aqui e conferida como marcação,
// não procurada como palavra no fonte.
//
// O que estes testes protegem, além do desenho: que a tela não publique nada
// sozinha. O default do switch, a confirmação que nomeia o paciente e o fato
// de "disponibilizar" ser uma segunda chamada depois de criar são regra de
// privacidade, não preferência de UX.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  itemHtml, menuHtml, badgesDe, vazioHtml, cascaHtml, skeletonHtml, dataBR, FILTROS,
} from '../js/paciente-documentos-ui.js';
import {
  drawerHtml, corpoHtml, opcoesDeTipo, dropHtml, arquivoHtml,
  avisoPrivacidadeHtml, validarFormulario, ACEITA,
} from '../js/paciente-documentos-drawer.js';
import { TIPOS } from '../js/paciente-documentos.js';

const css   = readFileSync(new URL('../css/paciente-documentos.css', import.meta.url), 'utf8');
const ui    = readFileSync(new URL('../js/paciente-documentos-ui.js', import.meta.url), 'utf8');
const dw    = readFileSync(new URL('../js/paciente-documentos-drawer.js', import.meta.url), 'utf8');
const ficha = readFileSync(new URL('../js/ficha.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const doc = (extra = {}) => ({
  id: 'doc-1', titulo: 'Exames laboratoriais', tipo: 'exame',
  nome_arquivo: 'exame de sangue.pdf', caminho_storage: 'n/p/2026/doc-1/exame.pdf',
  mime_type: 'application/pdf', tamanho_bytes: 2516582, data_documento: '2026-08-08',
  visivel_paciente: false, visualizado_pelo_paciente: false, arquivado_em: null,
  ...extra,
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · a aba se apresenta como central', () => {

  teste('cabeçalho, subtítulo e a ação principal', () => {
    const h = cascaHtml();
    contem(h, '<h2>Documentos</h2>');
    contem(h, 'Arquivos, exames, relatórios e documentos compartilhados com o paciente.');
    contem(h, 'Novo documento');
  });

  teste('os cinco filtros do briefing, mais tipo, ano e pesquisa', () => {
    igual(FILTROS.map(f => f.id), ['todos', 'privado', 'disponivel', 'nao_lido', 'arquivado']);
    const h = cascaHtml();
    contem(h, 'data-f-tipo');
    contem(h, 'data-f-ano');
    contem(h, 'data-busca');
    contem(h, 'Todos os tipos');
  });

  teste('a pesquisa espera o usuário parar de digitar', () => {
    // Uma consulta por tecla seria uma consulta por letra.
    contem(ui, 'setTimeout(carregar, 280)');
    contem(ui, 'clearTimeout(timer)');
  });

  teste('abrir a aba dez vezes não empilha dez listeners no document', () => {
    // initDocumentos() roda a cada visita. Sem a trava, cada visita somaria um
    // listener de click e um de keydown no document, para sempre.
    contem(ui, 'let _fechamentoLigado = false');
    contem(ui, 'if (_fechamentoLigado) return');
    const init = ui.slice(ui.indexOf('export async function initDocumentos'));
    ok(!/document\.addEventListener/.test(init),
       'nada de addEventListener no document dentro do init');
  });

  teste('a busca cobre título, descrição, arquivo e tipo — não o PDF', () => {
    const dados = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
    contem(dados, 'titulo.ilike');
    contem(dados, 'descricao.ilike');
    contem(dados, 'nome_arquivo.ilike');
    contem(dados, 'tipo.ilike');
  });

  teste('a aba está ligada ao Hub e carrega sob demanda', () => {
    contem(ficha, "if (abaId === 'documentos')");
    // Import dinâmico: quem nunca abre a aba não baixa o módulo.
    contem(ficha, "await import('./paciente-documentos-ui.js')");
    contem(index, 'css/paciente-documentos.css');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · a linha da lista', () => {

  teste('mostra tipo, formato, tamanho e data', () => {
    const h = itemHtml(doc());
    contem(h, 'Exames laboratoriais');
    contem(h, 'Exame');
    contem(h, 'PDF');
    contem(h, '2,4 MB');
    contem(h, '08/08/2026');
  });

  teste('NUNCA mostra caminho do storage nem UUID', () => {
    const h = itemHtml(doc());
    naoContem(h, 'n/p/2026', 'caminho do Storage é estrutura interna');
    naoContem(h, '/exame.pdf');
    // O id aparece só como data-atributo, para o clique achar a linha — nunca
    // como texto para o usuário ler.
    ok(!/>[^<]*doc-1[^<]*</.test(h), 'UUID não é informação de tela');
  });

  teste('imagem se descreve como imagem, não como PDF', () => {
    contem(itemHtml(doc({ mime_type: 'image/png' })), 'Imagem');
    contem(itemHtml(doc({ mime_type: 'image/png' })), 'Ver imagem');
  });

  teste('cada tipo tem o seu ícone, e todos os 11 existem', () => {
    for (const [id, t] of Object.entries(TIPOS)) {
      contem(itemHtml(doc({ tipo: id })), `data-lucide="${t.icone}"`);
    }
  });

  teste('título com aspas ou < não quebra a marcação', () => {
    const h = itemHtml(doc({ titulo: '<img src=x onerror=alert(1)> "aspas"' }));
    naoContem(h, '<img src=x');
    contem(h, '&lt;img');
    contem(h, '&quot;aspas&quot;');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · os selos dizem o estado, sem excesso de cor', () => {

  teste('privado é o padrão, e é o mais discreto', () => {
    const b = badgesDe(doc());
    igual(b.length, 1);
    igual(b[0].tom, 'privado');
    igual(b[0].label, 'Privado');
  });

  teste('disponível e ainda não aberto = "Não visualizado"', () => {
    const b = badgesDe(doc({ visivel_paciente: true, disponibilizado_em: '2026-08-08T10:00:00Z' }));
    igual(b.map(x => x.tom), ['disponivel', 'novo']);
  });

  teste('depois de aberto, o selo vira a data da leitura', () => {
    const b = badgesDe(doc({
      visivel_paciente: true, visualizado_pelo_paciente: true, visualizado_em: '2026-08-09T14:00:00Z',
    }));
    igual(b.map(x => x.tom), ['disponivel', 'visto']);
    contem(b[1].label, '09/08/2026');
  });

  teste('arquivado não é privado nem disponível — saiu do jogo', () => {
    const b = badgesDe(doc({ arquivado_em: '2026-08-10T00:00:00Z', visivel_paciente: false }));
    igual(b.map(x => x.tom), ['arquivado']);
  });

  teste('quatro tons, e nenhuma cor literal na folha', () => {
    for (const tom of ['privado', 'disponivel', 'novo', 'arquivado']) {
      contem(css, `.pdoc-badge.${tom}`);
    }
    // A identidade vem dos tokens; um #hex aqui não muda quando a marca mudar.
    // Exceção declarada: o vermelho de risco e as sombras pretas translúcidas.
    const cores = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(c => c !== '#fff' && c !== '#C0392B');
    igual(cores, [], 'cor literal nova na folha');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · o menu de ações', () => {

  teste('documento privado oferece disponibilizar; disponível oferece remover', () => {
    contem(menuHtml(doc()), 'Disponibilizar ao paciente');
    naoContem(menuHtml(doc()), 'Remover do aplicativo');

    const pub = menuHtml(doc({ visivel_paciente: true }));
    contem(pub, 'Remover do aplicativo');
    naoContem(pub, 'Disponibilizar ao paciente');
  });

  teste('a ordem do briefing, com excluir por último e separado', () => {
    const h = menuHtml(doc());
    const ordem = [...h.matchAll(/data-acao="(\w+)"/g)].map(m => m[1]);
    igual(ordem, ['ver', 'baixar', 'editar', 'disponibilizar', 'substituir', 'arquivar', 'excluir']);
    ok(h.indexOf('pdoc-menu-sep') < h.indexOf('data-acao="excluir"'), 'excluir fica depois da divisória');
    contem(h, 'class="risco" data-acao="excluir"');
  });

  teste('arquivado não oferece disponibilizar nem substituir', () => {
    const h = menuHtml(doc({ arquivado_em: '2026-08-10T00:00:00Z' }));
    naoContem(h, 'Disponibilizar ao paciente');
    naoContem(h, 'Substituir arquivo');
    contem(h, 'Reativar');
  });

  teste('excluir só fica vermelho no hover', () => {
    // Vermelho permanente vira ruído e ensina a ignorar.
    contem(css, '.pdoc-menu button.risco:hover');
    ok(!/\.pdoc-menu button\.risco \{[^}]*color:\s*var\(--danger/.test(css));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · o drawer não publica nada sozinho', () => {

  teste('é painel lateral, não modal pequeno', () => {
    contem(css, '.pdoc-drawer-raiz');
    contem(css, 'justify-content: flex-end');
    contem(css, 'width: min(540px, 100%)');
    contem(drawerHtml(), 'role="dialog"');
    contem(drawerHtml(), 'aria-modal="true"');
  });

  teste('o switch nasce DESLIGADO', () => {
    const h = corpoHtml({ modo: 'novo', nomePaciente: 'Eduardo' });
    contem(h, 'data-visivel');
    ok(!/data-visivel[^>]*\bchecked\b/.test(h),
       'prontuário não publica sozinho — upload não é publicação');
  });

  teste('o aviso nomeia o paciente e só aparece com o switch ligado', () => {
    contem(avisoPrivacidadeHtml('Eduardo Medani'), 'ficará visível para <b>Eduardo Medani</b>');
    // Escondido de saída; quem revela é o change do switch.
    contem(corpoHtml({ modo: 'novo', nomePaciente: 'Eduardo' }), '<div data-area-aviso hidden>');
    contem(dw, 'areaAviso.hidden = !sw?.checked');
    contem(dw, "sw?.addEventListener('change', atualizarAviso)");
  });

  teste('na central o aviso reescreve o nome quando o paciente muda', () => {
    // Lá o nome só se sabe depois de escolher, e "ficará visível para o
    // paciente" não serve para conferir nada.
    contem(dw, "sel?.addEventListener('change'");
    contem(dw, 'areaAviso.innerHTML = avisoPrivacidadeHtml(sel.value ? nome : \'\')');
  });

  teste('os campos do briefing, com título, tipo e arquivo obrigatórios', () => {
    const h = corpoHtml({ modo: 'novo' });
    for (const c of ['data-titulo', 'data-tipo', 'data-descricao', 'data-file', 'data-data']) contem(h, c);
    igual((h.match(/<span class="req">\*<\/span>/g) || []).length, 3);
  });

  teste('os 11 tipos aparecem no seletor', () => {
    const o = opcoesDeTipo('laudo');
    for (const id of Object.keys(TIPOS)) contem(o, `value="${id}"`);
    contem(o, 'value="laudo" selected');
  });

  teste('a área de upload é grande, aceita arrastar e deixa trocar', () => {
    contem(dropHtml(), 'Arraste o arquivo aqui');
    contem(dropHtml(), 'PDF, JPG ou PNG · até 15 MB');
    contem(css, '.pdoc-drop');
    contem(dw, "drop.addEventListener('drop'");
    // Sem preventDefault o navegador abre o arquivo na aba e perde o formulário.
    contem(dw, 'e.preventDefault();\n      drop.classList.remove');
    contem(arquivoHtml({ name: 'exame.pdf', size: 2516582, type: 'application/pdf' }), 'data-trocar');
  });

  teste('o accept é conveniência — quem valida é o byte', () => {
    contem(ACEITA, 'application/pdf');
    contem(ACEITA, 'image/png');
    // A validação real é validarArquivo(), que lê a assinatura.
    contem(dw, 'await validarArquivo(f)');
  });

  teste('editar não troca arquivo; substituir não mexe em informação', () => {
    const ed = corpoHtml({ modo: 'editar', doc: doc() });
    naoContem(ed, 'data-file');
    naoContem(ed, 'data-visivel');
    const sub = corpoHtml({ modo: 'substituir', doc: doc() });
    contem(sub, 'data-file');
    naoContem(sub, 'data-titulo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · validação do formulário', () => {

  teste('título, tipo e arquivo são exigidos ao criar', () => {
    const r = validarFormulario({ modo: 'novo', titulo: '  ', tipo: 'nada', arquivo: null });
    ok(!r.ok);
    igual(Object.keys(r.erros).sort(), ['arquivo', 'tipo', 'titulo']);
  });

  teste('data no futuro é recusada', () => {
    const r = validarFormulario({ modo: 'novo', titulo: 'X', tipo: 'exame', arquivo: {}, dataDocumento: '2026-12-31' }, '2026-08-08');
    igual(r.erros.data, 'A data não pode ser no futuro.');
    // Ontem passa: exame antigo é o caso comum.
    ok(validarFormulario({ modo: 'novo', titulo: 'X', tipo: 'exame', arquivo: {}, dataDocumento: '2025-03-14' }, '2026-08-08').ok);
  });

  teste('editar não exige arquivo; substituir não exige título', () => {
    ok(validarFormulario({ modo: 'editar', titulo: 'X', tipo: 'exame', arquivo: null }).ok);
    ok(validarFormulario({ modo: 'substituir', arquivo: {} }).ok);
    ok(!validarFormulario({ modo: 'substituir', arquivo: null }).ok);
  });

  teste('a validação é inline, sem alert do navegador', () => {
    contem(css, '.pdoc-erro-campo');
    contem(css, '.pdoc-campo.invalido input');
    contem(dw, 'marcarCampo(');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · as confirmações que evitam erro humano', () => {

  teste('disponibilizar confirma nomeando o paciente', () => {
    contem(ui, 'ficará visível para ${nome} no aplicativo Evollo');
    contem(ui, 'const nome = paciente.nome');
  });

  teste('remover do app diz o que NÃO acontece', () => {
    contem(ui, 'Remover este documento do aplicativo do paciente?');
    contem(ui, 'O arquivo NÃO é apagado');
  });

  teste('excluir exige digitar o título, não um OK a mais', () => {
    // Um segundo "OK" não distingue quem leu de quem clicou.
    contem(ui, 'EXCLUIR DEFINITIVAMENTE');
    contem(ui, 'digite o título do documento');
    contem(ui, 'if (t.trim() !== String(doc.titulo).trim())');
    contem(ui, 'Prefira Arquivar');
  });

  teste('criar e disponibilizar são duas chamadas, nesta ordem', () => {
    // O documento existe antes de ser publicado — mesmo com o switch ligado.
    // É a SEGUNDA chamada que dispara aviso, timeline e push; o upload não
    // anuncia nada, e é por isso que as duas não podem virar uma só.
    const bloco = ui.slice(ui.indexOf('function novo()'), ui.indexOf('function editar('));
    ok(bloco.indexOf('criarDocumento(') < bloco.indexOf('disponibilizarDocumentoAoPaciente(doc.id)'));
    contem(bloco, 'if (d.disponibilizar) await disponibilizarDocumentoAoPaciente(doc.id)');
    // E criarDocumento não recebe visibilidade nenhuma.
    naoContem(bloco, 'visivel');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · abrir e baixar', () => {

  teste('sempre por URL assinada, nunca pública', () => {
    contem(ui, 'await urlAssinada(doc.caminho_storage)');
    naoContem(ui, 'getPublicUrl');
    // A assinada é usada e descartada: não vai para estado nem para atributo.
    ok(!/_urlCache|urlAssinadaSalva|dataset\.url/.test(ui));
  });

  teste('abrir usa noopener; baixar restitui o nome ORIGINAL', () => {
    contem(ui, "window.open(url, '_blank', 'noopener')");
    contem(ui, 'a.download = doc.nome_arquivo');
  });

  teste('falha ao abrir vira frase de gente', () => {
    contem(ui, 'Não foi possível abrir este documento.');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · vazio, carregando e erro', () => {

  teste('o vazio de "nada ainda" oferece o primeiro upload', () => {
    const h = vazioHtml(null);
    contem(h, 'Nenhum documento adicionado.');
    contem(h, 'Envie exames, relatórios e arquivos relacionados a este paciente.');
    contem(h, 'data-novo');
  });

  teste('o vazio de filtro não oferece adicionar — seria não ler', () => {
    const h = vazioHtml('arquivado');
    contem(h, 'Nenhum documento neste filtro');
    naoContem(h, 'Adicionar documento');
  });

  teste('carregando é skeleton, não spinner', () => {
    contem(skeletonHtml(), 'pdoc-sk');
    igual((skeletonHtml(3).match(/pdoc-sk/g) || []).length, 3);
    naoContem(cascaHtml(), 'spinner');
    contem(css, '@keyframes pdoc-brilho');
  });

  teste('erro traz o que fazer, não o que o Supabase disse', () => {
    contem(cascaHtml(), 'data-retry');
    contem(cascaHtml(), 'Tentar novamente');
    contem(ui, 'traduzirErroDocumento(e?.message)');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos · responsividade', () => {

  teste('mobile vira cartão, sem rolagem horizontal', () => {
    contem(css, '@media (max-width: 640px)');
    contem(css, "grid-template-areas: 'ico corpo' 'acoes acoes'");
    ok(!/overflow-x:\s*scroll/.test(css), 'a lista nunca rola de lado');
    // Os chips de filtro rolam sozinhos em vez de quebrar em quatro linhas.
    contem(css, '.pdoc-chips');
    contem(css, 'overflow-x: auto');
  });

  teste('tablet compacta a linha; desktop mantém a lista inteira', () => {
    contem(css, '@media (max-width: 900px)');
    contem(css, '.pdoc-drawer { width: 100%; }');
  });

  teste('o rodapé do drawer respeita a safe-area, uma vez', () => {
    contem(css, 'padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px))');
  });

  teste('quem pediu menos movimento não recebe animação', () => {
    contem(css, '@media (prefers-reduced-motion: reduce)');
  });
});
