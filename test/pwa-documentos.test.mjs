// ═══════════════════════════════════════════════════════════
// PWA · DOCUMENTOS — Etapa 3 (o app do paciente)
// ═══════════════════════════════════════════════════════════
// A marcação é GERADA aqui e conferida como marcação, não procurada como
// palavra no fonte — mesmo padrão do teste da dieta e do início.
//
// O que estes testes protegem além do desenho: que a tela não vaze documento
// privado nem invente leitura. A prova de que o RLS filtra é a conferência 62,
// em sessão real; o que se garante aqui é que a TELA não reintroduz o que o
// banco barrou, e que ela não conta leitura de arquivo que não abriu.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  cartaoHtml, listaHtml, cascaHtml, vazioHtml, erroHtml, skeletonHtml,
  renderDocumentosPaciente,
} from '../js/pwa-documentos-ui.js';
import {
  paraCartao, ordenar, agruparPorAno, resumoParaInicio, dataPorExtenso,
} from '../js/pwa-documentos-data.js';
import { documentosHtml, atalhosHtml, inicioHtml, rotuloDocumentos } from '../js/pwa-inicio-ui.js';

const css   = readFileSync(new URL('../css/pwa-documentos.css', import.meta.url), 'utf8');
const ui    = readFileSync(new URL('../js/pwa-documentos-ui.js', import.meta.url), 'utf8');
const dados = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
const casca = readFileSync(new URL('../js/paciente-ui.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const sw    = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const doc = (extra = {}) => ({
  id: 'doc-1', titulo: 'Exames laboratoriais', tipo: 'exame',
  caminho_storage: 'n/p/2026/doc-1/exame.pdf', mime_type: 'application/pdf',
  tamanho_bytes: 2516582, data_documento: '2026-08-08',
  disponibilizado_em: '2026-08-08T10:00:00Z',
  visualizado_pelo_paciente: false, visualizado_em: null,
  ...extra,
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · a leitura é do banco, não da tela', () => {

  teste('a consulta não manda paciente_id — quem filtra é o RLS', () => {
    const f = dados.slice(dados.indexOf('export async function meusDocumentos'));
    const corpo = f.slice(0, f.indexOf('\n}'));
    ok(!/\.eq\('paciente_id'/.test(corpo),
       'filtrar aqui daria a impressão de que trocar o id mudaria o resultado');
    ok(!/\.eq\('visivel_paciente'/.test(corpo),
       'privado não pode ser filtrado DEPOIS de buscado — ele não pode ser buscado');
    ok(!/\.is\('arquivado_em'/.test(corpo));
  });

  teste('a policy é que garante as três condições', () => {
    const sql = readFileSync(new URL('../db/paciente_documentos.sql', import.meta.url), 'utf8');
    const p = sql.slice(sql.indexOf('create policy pd_paciente_select'));
    const corpo = p.slice(0, p.indexOf(';') + 1);
    contem(corpo, 'paciente_id = public.paciente_do_auth()');
    contem(corpo, 'visivel_paciente');
    contem(corpo, 'arquivado_em is null');
  });

  teste('a tela nunca filtra visibilidade por conta própria', () => {
    // Se filtrasse, um bug de render poderia mostrar o que o banco escondeu —
    // e pior: sugeriria que a segurança mora no JavaScript.
    ok(!/visivel_paciente/.test(ui));
    ok(!/arquivado_em/.test(ui));
  });

  teste('a lista não conhece nutri_id nem paciente_id', () => {
    const c = paraCartao(doc({ nutri_id: 'n1', paciente_id: 'p1' }));
    igual(Object.keys(c).sort(),
          ['data', 'ehImagem', 'formato', 'icone', 'id', 'novo', 'tamanho', 'tipo', 'titulo']);
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · o cartão', () => {

  teste('mostra tipo, data por extenso, formato e tamanho', () => {
    const h = cartaoHtml(paraCartao(doc()));
    contem(h, 'Exames laboratoriais');
    contem(h, '8 de agosto de 2026');
    contem(h, 'Exame');
    contem(h, 'PDF');
    contem(h, '2,4 MB');
  });

  teste('NÃO mostra nome técnico, caminho nem UUID', () => {
    const h = cartaoHtml(paraCartao(doc({ nome_arquivo: '8f2c-exame-sangue.pdf' })));
    naoContem(h, '8f2c-exame-sangue.pdf');
    naoContem(h, 'n/p/2026');
    // O id existe só como data-atributo, para o clique achar o registro.
    ok(!/>[^<]*doc-1[^<]*</.test(h), 'UUID não é informação de tela');
  });

  teste('PDF é ícone de documento; JPG e PNG, de imagem', () => {
    igual(paraCartao(doc()).icone, 'file-text');
    for (const m of ['image/jpeg', 'image/png']) {
      const c = paraCartao(doc({ mime_type: m }));
      igual(c.icone, 'image');
      igual(c.formato, 'Imagem');
    }
  });

  teste('nada de thumbnail nesta etapa', () => {
    // Miniatura de exame é conteúdo clínico renderizado sem o paciente pedir.
    ok(!/<img|background-image|createObjectURL/.test(ui));
  });

  teste('o botão é <button> de verdade, com aria-label', () => {
    const h = cartaoHtml(paraCartao(doc()));
    contem(h, '<button type="button" class="pd-abrir"');
    contem(h, 'aria-label="Visualizar Exames laboratoriais, ainda não visualizado"');
    contem(cartaoHtml(paraCartao(doc({ visualizado_pelo_paciente: true }))),
           'aria-label="Visualizar Exames laboratoriais"');
  });

  teste('"Novo" não depende só da cor', () => {
    contem(cartaoHtml(paraCartao(doc())), '>Novo<');
    // 44px de alvo de toque: abaixo disso o dedo erra e são duas assinaturas.
    contem(css, 'min-height: 44px');
  });

  teste('título com < ou aspas não quebra a marcação', () => {
    const h = cartaoHtml(paraCartao(doc({ titulo: '<img src=x> "a"' })));
    naoContem(h, '<img src=x>');
    contem(h, '&lt;img');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · ordem e agrupamento', () => {

  teste('mais recente primeiro', () => {
    const lista = [
      doc({ id: 'a', data_documento: '2025-07-15' }),
      doc({ id: 'b', data_documento: '2026-08-08' }),
      doc({ id: 'c', data_documento: '2026-01-02' }),
    ];
    igual(ordenar(lista).map(d => d.id), ['b', 'c', 'a']);
  });

  teste('sem data do documento, a disponibilização desempata', () => {
    const lista = [
      doc({ id: 'a', data_documento: null, disponibilizado_em: '2026-08-01T00:00:00Z' }),
      doc({ id: 'b', data_documento: null, disponibilizado_em: '2026-08-09T00:00:00Z' }),
    ];
    igual(ordenar(lista).map(d => d.id), ['b', 'a']);
  });

  teste('um ano só = lista corrida, sem título repetido', () => {
    const g = agruparPorAno([doc({ id: 'a' }), doc({ id: 'b' })]);
    igual(g.length, 1);
    igual(g[0].ano, null, '"2026" sozinho sobre a lista inteira não informa nada');
    naoContem(listaHtml([doc()]), 'pd-ano');
  });

  teste('dois anos = agrupado, mais recente primeiro', () => {
    const g = agruparPorAno([
      doc({ id: 'a', data_documento: '2025-07-15' }),
      doc({ id: 'b', data_documento: '2026-08-08' }),
    ]);
    igual(g.map(x => x.ano), ['2026', '2025']);
    contem(listaHtml([doc({ data_documento: '2025-01-01' }), doc({ data_documento: '2026-01-01' })]), 'pd-ano');
  });

  teste('data por extenso, e data ruim não vira "NaN"', () => {
    igual(dataPorExtenso('2026-08-08'), '8 de agosto de 2026');
    igual(dataPorExtenso('2026-12-25'), '25 de dezembro de 2026');
    igual(dataPorExtenso(null), '');
    igual(dataPorExtenso('sei lá'), '');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · abrir na ordem certa', () => {

  const alvo = () => {
    const el = { innerHTML: '', _q: {}, querySelector: () => null,
                 querySelectorAll: () => [] };
    return el;
  };

  teste('a ordem é URL → marcar → abrir', () => {
    // Marcar antes da URL contaria leitura de documento que não abriu.
    const bloco = ui.slice(ui.indexOf('async function abrir(botao)'));
    const iUrl = bloco.indexOf('await assinar(doc.caminho_storage)');
    const iMarcar = bloco.indexOf('await marcar(doc.id)');
    const iAbrir = bloco.indexOf('abrirUrl(url)');
    ok(iUrl > -1 && iMarcar > iUrl, 'a URL vem antes da marcação');
    ok(iAbrir > iMarcar, 'abrir vem depois das duas');
  });

  teste('não marca porque o cartão apareceu', () => {
    // A leitura começa quando o paciente TENTA abrir.
    const pintar = ui.slice(ui.indexOf('async function pintar()'), ui.indexOf('function ligar(corpo)'));
    ok(!/marcar\(/.test(pintar), 'rolar a lista não é ler o documento');
  });

  teste('falha ao gerar a URL não conta leitura', () => {
    const bloco = ui.slice(ui.indexOf('async function abrir(botao)'));
    // O throw do 'sem_url' está ANTES da marcação, então o catch pula tudo.
    ok(bloco.indexOf("throw new Error('sem_url')") < bloco.indexOf('await marcar(doc.id)'));
    contem(bloco, 'Não foi possível abrir este documento.');
  });

  teste('falha ao MARCAR não impede de abrir', async () => {
    // O paciente veio ver o exame, não alimentar a nossa métrica.
    const bloco = ui.slice(ui.indexOf('async function abrir(botao)'));
    contem(bloco, "catch (e) { console.warn('Documentos · marcar:', e); }");
    ok(bloco.indexOf('console.warn') < bloco.indexOf('abrirUrl(url)'));
  });

  teste('o caminho NÃO vem do DOM', () => {
    // Fosse atributo, bastaria editá-lo no inspetor para pedir assinatura de
    // qualquer arquivo do bucket.
    contem(cartaoHtml(paraCartao(doc())), 'data-abrir="doc-1"');
    naoContem(cartaoHtml(paraCartao(doc())), 'n/p/2026/doc-1/exame.pdf');
    contem(ui, 'docs.find(d => d.id === botao.dataset.abrir)');
    contem(ui, 'assinar(doc.caminho_storage)');
  });

  teste('a URL é temporária e não é guardada', () => {
    const st = readFileSync(new URL('../js/paciente-documentos-storage.js', import.meta.url), 'utf8');
    contem(st, 'EXPIRACAO_PADRAO = 10 * 60');
    ok(!/getPublicUrl/.test(ui));
    ok(!/localStorage|sessionStorage|indexedDB/.test(ui), 'assinatura não se guarda em lugar nenhum');
  });

  teste('o selo some na hora e o banco é quem persiste', () => {
    contem(ui, "doc.visualizado_pelo_paciente = true");
    contem(ui, '.pd-novo`)?.remove()');
    // Persistência é a RPC — recarregar continua sem "Novo" porque o banco diz.
    contem(dados, "sb.rpc('marcar_documento_paciente_visualizado'");
  });

  teste('o paciente não edita, não apaga e não muda visibilidade', () => {
    for (const proibido of ['.update(', '.delete(', '.insert(', 'disponibilizar', 'arquivar']) {
      ok(!ui.includes(proibido), `a tela do paciente não pode chamar ${proibido}`);
    }
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · vazio, carregando e erro', () => {

  teste('o vazio explica o que vai chegar, e não oferece botão inútil', () => {
    // A tela agora abre mesmo sem arquivo nenhum — o atalho do Início é
    // permanente. Então o vazio não é um beco: é a explicação do lugar.
    const h = vazioHtml();
    contem(h, 'Nenhum documento por aqui ainda');
    contem(h, 'Quando seu profissional compartilhar exames, relatórios ou outros arquivos, eles aparecerão aqui.');
    naoContem(h, '<button');
  });

  teste('carregando é skeleton, e o vazio NUNCA vem antes dos dados', () => {
    igual((skeletonHtml(3).match(/pd-sk/g) || []).length, 3);
    contem(cascaHtml(), 'pd-sk');
    naoContem(cascaHtml(), 'pa-empty');
    // A primeira pintura do corpo é esqueleto; o vazio só entra depois do await.
    const pintar = ui.slice(ui.indexOf('async function pintar()'));
    ok(pintar.indexOf('skeletonHtml()') < pintar.indexOf('vazioHtml()'));
  });

  teste('erro traz o que fazer, sem mensagem técnica', () => {
    const h = erroHtml();
    contem(h, 'Não foi possível carregar seus documentos.');
    contem(h, 'Tentar novamente');
    contem(h, 'data-retry');
    naoContem(h, 'Supabase');
  });

  teste('o cabeçalho é simples — nada de painel de métricas', () => {
    const h = cascaHtml();
    contem(h, 'Documentos');
    contem(h, 'Arquivos compartilhados pelo seu profissional.');
    ok(!/pa-stats|in-prog|contador/.test(h));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · o bloco no Início', () => {

  teste('sem documento nenhum, o CARTÃO some — o atalho não', () => {
    // A regra mudou: Documentos é módulo permanente. O cartão contextual
    // continua condicional (só com novidade), mas o acesso não — um módulo
    // que só aparece depois de ter conteúdo é um módulo que o paciente nunca
    // descobre, porque ele não sabe que existe um lugar onde o exame vai cair.
    igual(documentosHtml({ novos: 0, total: 0 }), '');
    const h = inicioHtml({ documentos: { total: 0, novos: 0 }, temTreino: true });
    naoContem(h, 'in-doc-tag', 'sem novidade não há cartão contextual');
    contem(h, 'data-ir="documentos"', 'mas o atalho existe sempre');
    contem(h, 'Nenhum arquivo');
  });

  teste('o atalho conta arquivos, e novos vencem o total', () => {
    contem(inicioHtml({ documentos: { total: 8, novos: 0 } }), '8 arquivos');
    // Quem tem 8 arquivos e 2 por abrir quer saber dos 2.
    contem(inicioHtml({ documentos: { total: 8, novos: 2 } }), '2 novos');
    contem(inicioHtml({ documentos: { total: 1, novos: 1 } }), '1 novo');
  });

  teste('consulta falha: o atalho continua, sem afirmar "0 arquivos"', () => {
    // A existência da funcionalidade não depende do sucesso da consulta.
    const h = inicioHtml({ documentos: null, temTreino: true });
    contem(h, 'data-ir="documentos"');
    naoContem(h, 'Nenhum arquivo', 'a tela não sabe se ele tem ou não');
    naoContem(h, 'arquivos');
    naoContem(h, 'in-doc-tag');
    igual(rotuloDocumentos(null), '');
  });

  teste('com novidade existem os DOIS: cartão e atalho', () => {
    // Intencional: o primeiro chama atenção, o segundo garante navegação.
    const h = inicioHtml({ documentos: { total: 3, novos: 1, titulo: 'Exames' }, temTreino: true });
    contem(h, 'in-doc-tag');
    contem(h, 'Ver documento');
    contem(h, 'data-ir="documentos"');
    contem(h, '1 novo');
  });

  teste('com novidade, cartão contextual com destaque moderado', () => {
    const h = documentosHtml({ novos: 1, titulo: 'Exames laboratoriais' });
    contem(h, 'Novo documento');
    contem(h, 'Exames laboratoriais');
    contem(h, 'Compartilhado pelo seu profissional');
    contem(h, 'Ver documento');
  });

  teste('vários novos viram contagem, não uma lista de títulos', () => {
    const h = documentosHtml({ novos: 3, titulo: null });
    contem(h, '3 novos documentos');
    contem(h, 'Ver documentos');
    // Cinco títulos no Início seriam uma segunda tela de documentos dentro dele.
    igual((h.match(/in-doc-tit/g) || []).length, 0);
  });

  teste('sem novidade, o acesso persiste — discreto, no Acesso rápido', () => {
    const h = inicioHtml({ documentos: { total: 8, novos: 0 }, temTreino: true });
    naoContem(h, 'in-doc-tag', 'sem novidade não há cartão contextual');
    contem(h, 'data-ir="documentos"');
    contem(h, '8 arquivos');
    // Não some depois da primeira leitura: um módulo que desaparece é um
    // módulo que o paciente aprende que não existe.
  });

  teste('singular e plural', () => {
    igual(rotuloDocumentos({ total: 0, novos: 0 }), 'Nenhum arquivo');
    igual(rotuloDocumentos({ total: 1, novos: 0 }), '1 arquivo');
    igual(rotuloDocumentos({ total: 8, novos: 0 }), '8 arquivos');
    igual(rotuloDocumentos({ total: 8, novos: 1 }), '1 novo');
    igual(rotuloDocumentos({ total: 8, novos: 2 }), '2 novos');
    contem(documentosHtml({ novos: 1, titulo: 'X' }), 'Novo documento');
    contem(documentosHtml({ novos: 2 }), '2 novos documentos');
  });

  teste('o cartão vem depois de refeição e treino, antes do progresso', () => {
    // Os marcadores são os RÓTULOS que as seções realmente emitem, não nomes
    // de classe supostos: `progressoHtml` escreve "Seu progresso" sob .in-t, e
    // procurar uma classe que não existe faz a asserção passar por engano no
    // dia em que a ordem quebrar.
    const h = inicioHtml({
      documentos: { total: 2, novos: 2 }, temTreino: true, temDieta: true,
      treino: { dia: { nome: 'A' }, feito: false },
      refeicao: { nome: 'Almoço', horario: '12:00' },
    });
    const iHero = h.indexOf('in-hero');
    const iRefeicao = h.indexOf('Próxima refeição');
    const iTreino = h.indexOf('Treino do dia');
    const iDoc = h.indexOf('in-doc');
    const iProg = h.indexOf('Seu progresso');

    ok(iHero > -1 && iDoc > -1 && iProg > -1, 'as três seções têm que estar na tela');
    ok(iHero < iDoc, 'a saudação vem primeiro');
    // O que o paciente abriu o app para ver às 7h continua acima do exame.
    ok(iRefeicao > -1 && iRefeicao < iDoc, 'a próxima refeição vem antes');
    ok(iTreino > -1 && iTreino < iDoc, 'o treino do dia vem antes');
    ok(iDoc < iProg, 'e o cartão fica acima do progresso');
  });

  teste('a contagem sai de UMA leitura, não de uma consulta por documento', () => {
    const r = resumoParaInicio([doc({ id: 'a' }), doc({ id: 'b', visualizado_pelo_paciente: true })]);
    igual(r, { total: 2, novos: 1, titulo: 'Exames laboratoriais' });
    const inicio = readFileSync(new URL('../js/pwa-inicio-ui.js', import.meta.url), 'utf8');
    contem(inicio, 'meusDocumentos({ limite: 100 })');
    // Entra no mesmo Promise.all das outras fontes: quatro esperas em fila
    // seriam a soma dos tempos, não o maior deles.
    contem(inicio, "tentar(carregarDocumentos, 'documentos')");
  });

  teste('documentos que não carregaram viram ausência, não "0 arquivos"', () => {
    const inicio = readFileSync(new URL('../js/pwa-inicio-ui.js', import.meta.url), 'utf8');
    contem(inicio, 'documentos: rDocs.ok ? resumoParaInicio(rDocs.valor || []) : null');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · a rota e a barra inferior', () => {

  teste('NENHUMA quarta aba foi criada', () => {
    const nav = casca.slice(casca.indexOf('function bottomNav()'), casca.indexOf('// Liga o logout'));
    igual((nav.match(/item\('/g) || []).length, 3, 'Início | Treino | Dieta, e só');
    naoContem(nav, 'documentos');
    naoContem(nav, "'mais'");
  });

  teste('Documentos é subtela do Início — a barra acende Início', () => {
    const r = casca.slice(casca.indexOf('function renderDocumentos()'));
    contem(r.slice(0, 300), "_secao = 'inicio'");
    // Mesmo padrão do treino em andamento, que mantém _secao = 'treino'.
    contem(casca, "else if (sec === 'documentos') renderDocumentos()");
  });

  teste('sair de Documentos volta para o Início', () => {
    contem(casca, 'aoVoltar: renderInicio');
    contem(cascaHtml(), 'data-voltar');
    contem(cascaHtml(), 'aria-label="Voltar para o início"');
  });

  teste('a tela carrega sob demanda e a casca desenha antes', () => {
    const r = casca.slice(casca.indexOf('function renderDocumentos()'));
    // Barra e topo aparecem já; o miolo entra quando o módulo chegar.
    ok(r.indexOf('bottomNav()') < r.indexOf("import('./pwa-documentos-ui.js')"));
    contem(shell, 'css/pwa-documentos.css');
  });

  teste('a reserva da barra inferior continua sendo uma só', () => {
    // Declarar padding-bottom aqui reabriria o vão embaixo do último cartão.
    ok(!/^\.pd\s*\{[^}]*padding-bottom/m.test(css));
    ok(!css.includes('--pa-nav-h'), 'a reserva é da casca, em --pa-nav-reserva');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · privacidade no cache', () => {

  teste('o service worker não cacheia nada do Supabase', () => {
    // Storage é outra origem: PDF, imagem e URL assinada nunca entram no cache.
    contem(sw, "if (req.method !== 'GET' || url.origin !== self.location.origin) return;");
  });

  teste('nenhum documento entra no app shell', () => {
    const shellArr = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];'));
    ok(!/documento|paciente-documentos|\.pdf/.test(shellArr));
  });

  teste('a tela não guarda documento em armazenamento local', () => {
    ok(!/localStorage|sessionStorage|indexedDB|caches\./.test(ui));
    const d = readFileSync(new URL('../js/pwa-documentos-data.js', import.meta.url), 'utf8');
    ok(!/localStorage|sessionStorage|indexedDB/.test(d));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('pwa documentos · mobile e acessibilidade', () => {

  teste('cartão de largura total, sem rolagem horizontal', () => {
    contem(css, '.pd-abrir');
    contem(css, 'width: 100%');
    ok(!/overflow-x:\s*(scroll|auto)/.test(css));
  });

  teste('o título não é comprimido', () => {
    // "Exames laboratoriais — ago..." não identifica documento nenhum.
    const bloco = css.slice(css.indexOf('.pd-titulo'));
    ok(!/text-overflow:\s*ellipsis/.test(bloco.slice(0, 260)));
    contem(css, 'overflow-wrap: anywhere');
  });

  teste('o aviso de erro se anuncia sozinho ao leitor de tela', () => {
    contem(ui, "box.setAttribute('role', 'status')");
  });

  teste('quem pediu menos movimento não recebe animação', () => {
    contem(css, '@media (prefers-reduced-motion: reduce)');
  });

  teste('nenhuma cor literal nova na folha', () => {
    const cores = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(c => c !== '#fff' && c !== '#C0392B');
    igual(cores, [], 'a identidade vem dos tokens');
  });
});
