// ═══════════════════════════════════════════════════════════
// ARQUITETURA — Financeiro da empresa × Equipe e pagamentos
// ═══════════════════════════════════════════════════════════
// O que este arquivo protege: a fronteira entre os dois módulos. Eles moraram
// na mesma opção de menu, e o custo disso não era estético — a folha de
// pagamento se apresentava como o resultado financeiro da empresa, que ela
// nunca foi.
//
// A tentação de "só mostrar o custo da equipe também no financeiro" é
// permanente, e é assim que os dois voltam a se misturar. Por isso os testes
// afirmam as duas direções: o que cada lado TEM e o que cada lado NÃO PODE ter.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const ler = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const index = ler('../index.html');
const equipe = ler('../js/equipe-admin-ui.js');
const financeiro = ler('../js/financeiro-ui.js');
const dadosFin = ler('../js/financeiro.js');
const gerador = ler('../db/gerador_custos.mjs');

// ───────────────────────────────────────────────────────────
grupo('arquitetura · o menu mostra os dois módulos', () => {
  teste('Financeiro e Equipe são itens separados', () => {
    ok(/data-page="financeiro"/.test(index), 'sumiu o item Financeiro');
    ok(/data-page="equipe"/.test(index), 'sumiu o item Equipe');
    igual((index.match(/data-page="financeiro"/g) || []).length, 1, 'um item só de Financeiro');
    igual((index.match(/data-page="equipe"/g) || []).length, 1, 'um item só de Equipe');
  });

  teste('os dois estão habilitados', () => {
    for (const pagina of ['financeiro', 'equipe']) {
      const item = new RegExp(`<div class="nav-item([^"]*)" data-page="${pagina}"`).exec(index);
      ok(item, `sumiu o item ${pagina}`);
      ok(!item[1].includes('disabled'), `${pagina} está desabilitado — a página não abre`);
    }
  });

  teste('os dois vivem sob Administração, e nessa ordem', () => {
    const i = index.indexOf('>Administração<');
    ok(i > 0, 'faltou o grupo Administração no menu');
    const trecho = index.slice(i, i + 800);
    const iFin = trecho.indexOf('data-page="financeiro"');
    const iEq = trecho.indexOf('data-page="equipe"');
    ok(iFin > 0 && iEq > 0, 'os dois itens têm que ficar dentro do grupo');
    ok(iFin < iEq, 'Financeiro vem antes de Equipe');
  });

  teste('cada página tem o seu container', () => {
    ok(index.includes('id="page-financeiro"'), 'faltou #page-financeiro');
    ok(index.includes('id="page-equipe"'), 'faltou #page-equipe');
  });

  teste('cada página carrega a sua casca', () => {
    ok(index.includes("import('./js/financeiro-ui.js')"), 'o Financeiro não carrega o módulo');
    ok(index.includes("import('./js/equipe-admin-ui.js')"), 'a Equipe não carrega o módulo');
    ok(/pagina === 'financeiro'/.test(index), 'clicar em Financeiro não carregaria nada');
    ok(/pagina === 'equipe'/.test(index), 'clicar em Equipe não carregaria nada');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · o que mora em Equipe', () => {
  const ABAS = ['resumo', 'funcionarios', 'ponto', 'folha', 'documentos'];

  teste('as cinco abas existem, na ordem do briefing', () => {
    const ordem = [...equipe.matchAll(/\{ id: '([\w-]+)'/g)].map(m => m[1]);
    igual(ordem, ABAS);
  });

  teste('cada aba carrega o seu módulo', () => {
    for (const arquivo of ['./resumo-ui.js', './funcionarios-ui.js', './ponto-ui.js',
                           './folha-ui.js', './documentos-central.js']) {
      ok(equipe.includes(`import('${arquivo}')`), `a casca não carrega ${arquivo}`);
    }
  });

  teste('a rota guarda a aba', () => {
    contem(equipe, '#equipe/${id}', 'F5 tem que voltar na mesma aba');
  });

  teste('o menu é curto e o título da página é completo', () => {
    // Na barra lateral cabe "Equipe"; dentro da tela o nome longo é o que
    // impede a leitura de "isto é só o cadastro de pessoas".
    ok(/data-page="equipe"><span class="nav-icon">.*?<\/span><span>Equipe<\/span>/.test(index),
      'o menu tem que dizer só "Equipe"');
    contem(equipe, "const TITULO = 'Equipe e pagamentos'");
    contem(equipe, 'Gerencie colaboradores, ponto, folha de pagamento e documentos.');
  });

  teste('o título da página não muda ao trocar de aba', () => {
    // O <h1> é fixo; o assunto da aba vai no cabeçalho de seção logo abaixo.
    const trecho = equipe.slice(equipe.indexOf('export async function abrirSecao'));
    ok(!trecho.includes('page-title'), 'abrirSecao não pode reescrever o <h1> do módulo');
    contem(trecho, "getElementById('eqTitulo')", 'a troca é no cabeçalho da seção');
  });

  teste('o resumo se apresenta como custo de equipe, não como financeiro', () => {
    contem(equipe, 'Custos da equipe', 'faltou o título da seção');
    contem(equipe, 'Acompanhe horas, pagamentos, adicionais e custos dos colaboradores.');
  });

  teste('a folha se apresenta como o que ela é', () => {
    contem(equipe, 'Transforme as horas trabalhadas em pagamentos e contracheques.');
  });

  teste('a Equipe não mostra receitas nem despesas da empresa', () => {
    // A fronteira que se perde primeiro: um card de receita "só para comparar".
    for (const proibido of ['Receitas', 'Despesas', 'Contas a receber',
                            'Contas a pagar', 'Fluxo de caixa']) {
      naoContem(equipe, proibido, `${proibido} é assunto do Financeiro da empresa`);
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · o que mora no Financeiro da empresa', () => {
  teste('as abas são as do negócio', () => {
    const ordem = [...financeiro.matchAll(/\{ id: '([\w-]+)'/g)].map(m => m[1]);
    igual(ordem, ['visao-geral', 'receitas', 'despesas', 'contas-receber',
                  'contas-pagar', 'fluxo-caixa', 'categorias', 'relatorios']);
  });

  teste('nenhuma aba de gente, ponto ou folha', () => {
    const ordem = [...financeiro.matchAll(/\{ id: '([\w-]+)'/g)].map(m => m[1]);
    for (const proibida of ['funcionarios', 'ponto', 'folha', 'documentos']) {
      ok(!ordem.includes(proibida), `${proibida} não é aba do Financeiro`);
    }
  });

  teste('não carrega nenhum módulo da folha', () => {
    for (const modulo of ['folha-ui.js', 'funcionarios-ui.js', 'resumo-ui.js',
                          'ponto-ui.js', 'documentos-central.js', 'contracheque.js']) {
      naoContem(financeiro, modulo, `o Financeiro não pode montar ${modulo}`);
    }
  });

  teste('nada de chave Pix, contracheque ou hora de colaborador', () => {
    // Campos e tabelas, não a palavra: o cabeçalho do arquivo EXPLICA que
    // contracheque mora no outro módulo, e proibir a palavra proibiria a
    // explicação. O que não pode é o Financeiro LER esse dado.
    for (const campo of ['chave_pix', 'valor_hora', 'ponto_minutos', 'folha_itens',
                         'colaborador_documentos', 'funcionarios']) {
      naoContem(financeiro, campo, `${campo} é dado de Equipe e pagamentos`);
    }
  });

  teste('sem lançamento nenhum, a tela diz isso — não desenha eixo vazio', () => {
    contem(financeiro, 'Nenhum lançamento ainda');
    // O desenho mora em js/financeiro-grafico.js, que devolve '' quando não há
    // mês nenhum. SVG escrito aqui dentro seria marcação fora do alcance do
    // teste de geometria — e eixo sem barra se lê como sistema quebrado.
    naoContem(financeiro, '<svg', 'o SVG mora no módulo do gráfico, não na tela');
    contem(financeiro, 'financeiro-grafico.js');
  });

  teste('do gráfico da folha vêm helpers, nunca o gráfico', () => {
    // escalaBonita/curto/rotuloCurto são genéricos e já testados; duplicá-los
    // criaria dois eixos que divergem no dia em que um for ajustado. Mas
    // graficoMensal e graficoPorPessoa são a folha desenhada — se um deles
    // entrar aqui, o Financeiro volta a mostrar a equipe como se fosse o caixa.
    const grafico = ler('../js/financeiro-grafico.js');
    for (const proibido of ['graficoMensal', 'graficoPorPessoa']) {
      naoContem(grafico, proibido, `${proibido} é o desenho da folha, não do caixa`);
    }
    contem(grafico, "from './resumo-grafico.js'");
  });

  teste('o total não se apresenta como fechado enquanto há pendência', () => {
    // A importação da planilha trouxe 22 lançamentos sem categoria e 1 sem
    // valor. Somar isso e exibir como total é o defeito: quem confere caixa não
    // tem como saber que o número está incompleto se a tela não disser.
    contem(financeiro, 'O total ainda não está fechado', 'sumiu o aviso de pendência');
    contem(financeiro, 'sem categoria');
    contem(financeiro, 'sem valor');
    contem(financeiro, 'fora do total', 'o que não tem valor tem que sair do total à vista');
  });

  teste('nada é classificado por adivinhação', () => {
    // Deduzir o centro de custo pelo texto da descrição escreveria no balanço
    // uma opinião do programa, indistinguível de informação para quem lê.
    for (const chute of ['/energia/i', '/fopag/i', 'inferirCategoria', 'adivinhar']) {
      naoContem(financeiro, chute, 'categoria não se deduz do texto da descrição');
    }
  });

  teste('nenhum botão que só abre aviso', () => {
    // Botão que não faz o que promete gasta a confiança de quem clicou — e na
    // segunda vez a pessoa não clica mais em nada da tela.
    naoContem(financeiro, 'mostrarToast', 'nada de "em breve" disfarçado de ação');
    naoContem(financeiro, 'data-fe-acao', 'a ação falsa devia ter saído');
    // Todo [data-fin-ir] leva a uma aba que existe de verdade.
    const abas = [...financeiro.matchAll(/\{ id: '([\w-]+)'/g)].map(m => m[1]);
    for (const m of financeiro.matchAll(/data-fin-ir="([\w-]+)"/g)) {
      ok(abas.includes(m[1]), `data-fin-ir="${m[1]}" aponta para aba inexistente`);
    }
  });

  teste('o custo da equipe é lido da folha, nunca copiado', () => {
    contem(financeiro, 'Custo da equipe', 'faltou o card de ponte');
    contem(financeiro, 'Ver folha e colaboradores', 'faltou a ação do card');
    contem(financeiro, 'equipe/resumo', 'o clique tem que abrir Equipe > Resumo');
    // A consulta mora na camada de dados; a tela não fala com o banco direto.
    contem(dadosFin, 'folha_resumo_mensal', 'o número tem que ser real, não estimado');
    naoContem(financeiro, 'from(', 'a tela não consulta o banco: quem lê é financeiro.js');
  });

  teste('despesa e folha aparecem como duas parcelas, não como um total só', () => {
    // Um número que junta os dois sem dizer de onde cada pedaço veio é
    // impossível de conferir no dia em que os dois divergirem.
    contem(financeiro, 'Despesas lançadas');
    contem(financeiro, 'despesas + folha', 'o total tem que declarar do que é feito');
    contem(dadosFin, 'export function custoDoMes', 'faltou a soma que separa as parcelas');
  });

  teste('o caixa importado não escreve na folha, e marca o que é dela', () => {
    // A folha da planilha DEIXOU de ser descartada: ela entra marcada em
    // `metadata.folha`, e é a marca que faz `folhaDoPeriodo()` contar o custo
    // de equipe uma vez só. O que continua proibido é o gerador MEXER na
    // apuração — o caixa registra o pagamento, quem apura é o módulo Equipe.
    contem(gerador, 'export function ehFolha', 'faltou o que distingue folha de despesa');
    contem(gerador, "'{\"folha\": true}'::jsonb", 'a folha tem que entrar marcada');
    contem(gerador, "'despesa'", 'a importação é só de despesa');
    // Só as escritas: citar `folhas/folha_itens` na prosa é a explicação, e
    // proibir a palavra proibiria explicar.
    for (const escrita of ['insert into public.folha', 'update public.folha',
                           'delete from public.folha']) {
      naoContem(gerador, escrita, 'o gerador não escreve na apuração da folha');
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · links antigos continuam funcionando', () => {
  teste('o mapa traduz as três rotas que mudaram de dono', async () => {
    const { rotaCanonica } = await import('../js/rotas.js');
    igual(rotaCanonica('financeiro/resumo'), 'equipe/resumo');
    igual(rotaCanonica('financeiro/funcionarios'), 'equipe/funcionarios');
    igual(rotaCanonica('financeiro/folha'), 'equipe/folha');
  });

  teste('aceita o hash com "#" e com barra sobrando', async () => {
    const { rotaCanonica } = await import('../js/rotas.js');
    igual(rotaCanonica('#financeiro/folha'), 'equipe/folha');
    igual(rotaCanonica('financeiro/folha/'), 'equipe/folha');
  });

  teste('o que não é rota antiga volta intacto', async () => {
    const { rotaCanonica, ehRotaAntiga } = await import('../js/rotas.js');
    for (const h of ['pacientes', 'equipe/ponto', 'financeiro/fluxo-caixa', 'ficha/abc/visao', '']) {
      igual(rotaCanonica(h), h.replace(/^#/, ''), `${h} não devia ser redirecionado`);
      ok(!ehRotaAntiga(h), `${h} não é rota antiga`);
    }
  });

  teste('a query viaja junto no redirecionamento', async () => {
    // Redirecionar perdendo a competência leva à tela certa no mês errado — e
    // o mês errado não avisa que está errado.
    const { rotaCanonica } = await import('../js/rotas.js');
    igual(rotaCanonica('financeiro/folha?competencia=2026-08'), 'equipe/folha?competencia=2026-08');
    igual(rotaCanonica('#financeiro/funcionarios?termo=ana&ativos=1'),
          'equipe/funcionarios?termo=ana&ativos=1');
    igual(rotaCanonica('financeiro/resumo?periodo=24'), 'equipe/resumo?periodo=24');
  });

  teste('caminho e parâmetros se leem separados', async () => {
    const { caminhoDaRota, parametrosDaRota } = await import('../js/rotas.js');
    igual(caminhoDaRota('#equipe/folha?competencia=2026-08'), 'equipe/folha');
    igual(parametrosDaRota('#equipe/folha?competencia=2026-08'), { competencia: '2026-08' });
    igual(parametrosDaRota('equipe/folha'), {});
    igual(parametrosDaRota('equipe/funcionarios?termo=jo%C3%A3o'), { termo: 'joão' });
  });

  teste('o index.html aplica a competência do link antes de montar a aba', () => {
    contem(index, 'parametrosDaRota(bruto)');
    contem(index, 'definirCompetencia(params.competencia)');
    const iComp = index.indexOf('definirCompetencia(params.competencia)');
    const iAba = index.indexOf("h.startsWith('equipe/')");
    ok(iComp > 0 && iAba > iComp, 'a competência tem que ser fixada ANTES de despachar');
  });

  teste('nenhum destino do mapa aponta para uma rota que também é antiga', () => {
    // Redirecionar para um link que redireciona de novo é laço à espera de
    // acontecer, e o navegador só mostraria a tela errada.
    const rotas = ler('../js/rotas.js');
    const destinos = [...rotas.matchAll(/:\s*'([\w/-]+)',/g)].map(m => m[1]);
    ok(destinos.length >= 3, 'o mapa tem que ter as rotas do briefing');
    for (const d of destinos) ok(d.startsWith('equipe/'), `destino inesperado: ${d}`);
  });

  teste('o index.html usa o mapa antes de escolher a página', () => {
    contem(index, "from './js/rotas.js'");
    contem(index, 'rotaCanonica(bruto)', 'restaurarRota tem que traduzir o hash');
    const i = index.indexOf('rotaCanonica(bruto)');
    const j = index.indexOf("h.startsWith('equipe/')");
    ok(i > 0 && j > i, 'a tradução tem que vir ANTES de despachar a rota');
  });

  teste('abrir um link com aba monta a página UMA vez', () => {
    // navegar() já dispara a montagem. Chamar a abertura da aba logo depois
    // desenharia a página duas vezes, e a primeira na aba errada.
    contem(index, "navegar('equipe', h.split('/')[1])");
    contem(index, "navegar('financeiro', h.split('/')[1])");
    ok(!/navegar\('equipe'\);\s*\n\s*abrirEquipe\(/.test(index), 'montagem dupla na Equipe');
    ok(!/navegar\('financeiro'\);\s*\n\s*abrirFinanceiro\(/.test(index), 'montagem dupla no Financeiro');
  });

  teste('a barra de endereço passa a mostrar o link novo', () => {
    const trecho = index.slice(index.indexOf('function restaurarRota'), index.indexOf('function restaurarRota') + 900);
    contem(trecho, "history.replaceState(null, '', '#' + bruto)", 'o link antigo tem que ser reescrito');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · nada foi perdido no caminho', () => {
  const folha = ler('../js/folha-ui.js');
  const ponto = ler('../js/ponto-ui.js');
  const central = ler('../js/documentos-central.js');

  teste('a folha continua com fechamento, contracheque e importação de ponto', () => {
    for (const acao of ['fecharFolha', 'reabrirFolha', 'importarPontos',
                        'publicarContracheques', 'abrirContracheques']) {
      contem(folha, acao, `a folha perdeu ${acao}`);
    }
  });

  teste('a importação de ponto continua onde preenche a linha', () => {
    // Tirar o leitor de PDF da folha obrigaria a importar numa tela e conferir
    // as horas em outra. A aba Ponto consulta; a folha lança.
    contem(folha, 'lerPontoPdf', 'o leitor de PDF saiu da folha');
    naoContem(ponto, 'lerPontoPdf', 'a aba Ponto não lê PDF — ela consulta o que já foi lido');
    contem(ponto, 'irParaFolha', 'a aba Ponto tem que levar para onde se importa');
  });

  teste('as duas telas novas usam os serviços existentes, sem consulta paralela', () => {
    for (const fonte of [ponto, central]) {
      ok(!/from\s+'\.\/supabase\.js'/.test(fonte), 'tela nova não fala com o banco direto');
    }
    contem(central, "from './documentos.js'", 'a central tem que usar o repositório existente');
    contem(ponto, "from './folha.js'", 'o ponto tem que ler as horas pela folha');
  });

  teste('a aba Documentos filtra pelos cinco recortes do briefing', () => {
    for (const id of ['dxCol', 'dxTipo', 'dxComp', 'dxStatus', 'dxVisto']) {
      contem(central, id, `faltou o filtro ${id}`);
    }
  });

  teste('o resumo mostra os seis indicadores', () => {
    const resumo = ler('../js/resumo-ui.js');
    for (const rotulo of ['Custo total no período', 'Média mensal da equipe', 'Maior folha',
                          'Peso dos adicionais', 'Colaboradores', 'Horas trabalhadas']) {
      contem(resumo, rotulo, `faltou o indicador "${rotulo}"`);
    }
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · a competência é uma só na sessão', () => {
  const ponto = ler('../js/ponto-ui.js');
  const folha = ler('../js/folha-ui.js');
  const central = ler('../js/documentos-central.js');
  const resumo = ler('../js/resumo-ui.js');

  teste('o estado mora em um módulo só', async () => {
    const mod = await import('../js/competencia.js');
    for (const f of ['competenciaAtiva', 'definirCompetencia', 'normalizar', 'esquecer']) {
      ok(typeof mod[f] === 'function', `competencia.js não exporta ${f}`);
    }
  });

  teste('guarda, normaliza e devolve o mês', async () => {
    const { definirCompetencia, competenciaAtiva, esquecer, normalizar } = await import('../js/competencia.js');
    esquecer();
    igual(competenciaAtiva(), null, 'sem escolha, ninguém força um mês');
    igual(normalizar('2026-08'), '2026-08-01', 'a tabela folhas guarda o dia 1');
    definirCompetencia('2026-08');
    igual(competenciaAtiva(), '2026-08-01');
    esquecer();
  });

  teste('lixo não apaga a escolha que já valia', async () => {
    const { definirCompetencia, competenciaAtiva, esquecer } = await import('../js/competencia.js');
    esquecer();
    definirCompetencia('2026-08-01');
    definirCompetencia('mês que vem');
    definirCompetencia('2026-13');
    igual(competenciaAtiva(), '2026-08-01', 'valor inválido tem que ser ignorado');
    esquecer();
  });

  teste('as três abas do mês leem e gravam o mesmo estado', () => {
    for (const [nome, fonte] of [['ponto', ponto], ['folha', folha], ['documentos', central]]) {
      contem(fonte, "from './competencia.js'", `${nome} não usa o estado compartilhado`);
      contem(fonte, 'competenciaAtiva', `${nome} não LÊ a competência da sessão`);
      contem(fonte, 'definirCompetencia', `${nome} não GRAVA a competência escolhida`);
    }
  });

  teste('nenhuma aba volta sozinha para o mês corrente', () => {
    // O defeito é exatamente este: abrir a folha em outubro porque "é hoje",
    // depois de a pessoa ter passado meia hora conferindo agosto no ponto.
    for (const fonte of [ponto, folha]) {
      const usa = /competenciaAtual\(\)/.test(fonte);
      const antes = fonte.indexOf('competenciaAtiva');
      const depois = fonte.indexOf('competenciaAtual()');
      ok(!usa || (antes > 0 && antes < depois),
        'o mês corrente só pode ser o último recurso, depois do estado da sessão');
    }
  });

  teste('a janela do resumo também sobrevive à troca de aba', () => {
    contem(resumo, 'periodoDoResumo', 'quem abriu 24 meses não quer voltar em 12');
    contem(resumo, 'definirPeriodoDoResumo');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · Ponto leva à Folha sem perder o mês', () => {
  const ponto = ler('../js/ponto-ui.js');
  const folha = ler('../js/folha-ui.js');
  const equipeCasca = ler('../js/equipe-admin-ui.js');

  teste('o estado vazio diz o que falta e oferece a saída', () => {
    contem(ponto, 'Nenhuma folha de ponto foi importada para esta competência.');
    contem(ponto, 'Importar na folha de pagamento');
    naoContem(ponto, '>Importar folhas de ponto<', 'rótulo genérico devia ter saído');
  });

  teste('a divergência vira ação nomeada, não enfeite', () => {
    contem(ponto, 'Revisar na folha');
    contem(ponto, 'data-pt-revisar');
  });

  teste('toda saída daqui leva a competência da tela', () => {
    const fn = ponto.slice(ponto.indexOf('function irParaFolha'), ponto.indexOf('async function abrirDocumento'));
    contem(fn, 'competencia: _competencia', 'a folha tem que abrir no mesmo mês');
    contem(fn, 'competencia=', 'e o link de recuo também');
    ok(!/_irParaFolha\(\)\s*;/.test(ponto), 'nenhuma chamada sem competência');
  });

  teste('a casca repassa o pedido até a folha', () => {
    contem(equipeCasca, "abrirSecao('folha', o || {})");
    contem(equipeCasca, 'initFolhaUI(MIOLO, opcoes)');
    ok(/abrirSecao\(id, opcoes = \{\}\)/.test(equipeCasca), 'abrirSecao tem que aceitar o pedido');
  });

  teste('a folha abre no mês pedido e destaca a importação', () => {
    contem(folha, 'opcoes.competencia', 'o mês pedido tem que vencer o padrão');
    contem(folha, 'destacarImportacao');
    contem(folha, "getElementById('fpZona')", 'o destaque é na zona de arquivos');
    // Criar é decidido por "esta competência não existe", não por "não há
    // nenhuma folha": quem pede agosto para importar quer agosto aberto.
    contem(folha, "criar: !_folhas.some(f => f.competencia === alvo)");
  });

  teste('repetir a aba com pedido não é ignorado', () => {
    // "Revisar na folha" estando na folha tem que redestacar, e não virar nada.
    contem(equipeCasca, 'if (id === _secao && !Object.keys(opcoes).length) return;');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · Documentos separa estado de leitura', () => {
  const central = ler('../js/documentos-central.js');
  const documentos = ler('../js/documentos.js');

  teste('"disponível" e "visualizado" são colunas diferentes', () => {
    contem(central, '<th>Status do documento</th>');
    contem(central, '<th>Visualização pelo colaborador</th>');
    // E filtros diferentes: um é ciclo de vida do arquivo, o outro é o
    // colaborador ter aberto. Um documento disponível e não lido continua
    // disponível — juntar os dois esconderia quem não recebeu.
    contem(central, "select('dxStatus', 'Status do documento'");
    contem(central, "select('dxVisto', 'Visualização pelo colaborador'");
  });

  teste('visualizado não é status de documento', () => {
    const bloco = documentos.slice(documentos.indexOf('export const STATUS = {'),
                                   documentos.indexOf('export const ORIGENS'));
    naoContem(bloco.toLowerCase(), 'visualizado', 'quem visualiza é o colaborador');
    for (const s of ['rascunho', 'processando', 'disponivel', 'erro', 'arquivado']) {
      contem(bloco, s, `faltou o status ${s}`);
    }
    contem(bloco, "rascunho:    'Pendente'", 'o rótulo do rascunho é "Pendente"');
  });

  teste('contracheque e folha de ponto têm atalho próprio', () => {
    contem(central, "TIPOS_PRINCIPAIS = ['contracheque', 'folha_ponto']");
    contem(central, 'data-dx-tipo');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · navegação ativa e ícones', () => {
  teste('os dois itens do menu usam ícones distintos', () => {
    const icone = (pagina) => new RegExp(
      `data-page="${pagina}"><span class="nav-icon"><i data-lucide="([\\w-]+)"`).exec(index)?.[1];
    const fin = icone('financeiro');
    const eq = icone('equipe');
    const cli = icone('pacientes');
    ok(fin && eq, 'faltou ícone em algum dos dois');
    ok(fin !== eq, `Financeiro e Equipe usam o mesmo ícone (${fin})`);
    ok(eq !== cli, `Equipe e Clientes usam o mesmo ícone (${eq})`);
  });

  teste('só uma página fica ativa por vez', () => {
    // navegar() liga o item pelo data-page e desliga todos os outros; é o que
    // impede que uma rota redirecionada deixe Financeiro aceso em Equipe.
    contem(index, "el.classList.toggle('active', el.dataset.page === pagina)");
    contem(index, "el.classList.toggle('active', el.id === 'page-' + pagina)");
  });

  teste('rota redirecionada acende Equipe, nunca Financeiro', () => {
    const iEq = index.indexOf("navegar('equipe', h.split('/')[1])");
    const iFin = index.indexOf("navegar('financeiro', h.split('/')[1])");
    const iTraduz = index.indexOf('rotaCanonica(bruto)');
    ok(iEq > 0 && iFin > 0, 'faltou um dos despachos');
    // A rota já chega traduzida: #financeiro/folha virou #equipe/folha antes de
    // qualquer despacho, então nunca cai no ramo do Financeiro.
    ok(iTraduz > 0 && iTraduz < iEq && iTraduz < iFin, 'a tradução vem antes dos dois');
    ok(iEq < iFin, 'e o ramo de equipe/ é testado primeiro');
  });
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · os módulos novos carregam', () => {
  // Import de verdade, com o Supabase dublado. Pega erro de topo de arquivo —
  // o tipo que só apareceria como tela branca no navegador.
  const MODULOS = {
    '../js/rotas.js': ['rotaCanonica', 'ehRotaAntiga', 'caminhoDaRota', 'parametrosDaRota'],
    '../js/competencia.js': ['competenciaAtiva', 'definirCompetencia'],
    '../js/equipe-admin-ui.js': ['initEquipeUI', 'abrirSecao'],
    '../js/financeiro-ui.js': ['initFinanceiroUI', 'abrirSecao'],
    '../js/ponto-ui.js': ['initPontoUI'],
    '../js/documentos-central.js': ['initDocumentosCentralUI'],
  };

  for (const [caminho, entradas] of Object.entries(MODULOS)) {
    teste(`carrega ${caminho.replace('../js/', '')} e expõe a sua entrada`, async () => {
      const mod = await import(caminho);
      for (const e of entradas) {
        ok(typeof mod[e] === 'function', `${caminho} não exporta ${e}`);
      }
    });
  }
});

// ───────────────────────────────────────────────────────────
grupo('arquitetura · responsividade das telas novas', () => {
  const css = ler('../css/financeiro.css');
  const ponto = ler('../js/ponto-ui.js');
  const central = ler('../js/documentos-central.js');

  teste('as abas continuam roláveis no celular', () => {
    const regra = /\.fin-abas \{[^}]*\}/.exec(css)?.[0] || '';
    contem(regra, 'overflow-x: auto', 'sem scroll, cinco abas não cabem em 360px');
  });

  teste('no celular a tabela vira cartão, com rótulo em cada célula', () => {
    ok(/\.pt-tabela thead,\s*\n\s*\.dx-tabela thead \{ display: none; \}/.test(css)
       || css.includes('.dx-tabela thead'), 'faltou esconder o cabeçalho no mobile');
    contem(css, 'content: attr(data-rot)', 'valor sem rótulo não se lê');
  });

  teste('as células trazem o data-rot que o CSS usa', () => {
    for (const fonte of [ponto, central]) {
      ok((fonte.match(/data-rot="/g) || []).length >= 4, 'faltou data-rot nas colunas');
    }
  });
});
