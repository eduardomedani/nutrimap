// Repositório de documentos do colaborador.
//
// O que este arquivo protege: um documento aqui é holerite. Os riscos que
// importam são (1) o arquivo cair na pasta de outra pessoa, (2) uma nova
// versão apagar a que o colaborador já viu e imprimiu, e (3) a interface
// prometer um formato que o arquivo não tem.

import { grupo, teste, ok, igual, contem, naoContem, lanca } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  BUCKET, TIPOS, STATUS, ORIGENS, TAMANHO_MAXIMO,
  nomeSeguro, caminhoDoDocumento, formatoDoDocumento, traduzirErroDocumento,
} from '../js/documentos.js';
import { tamanho } from '../js/documentos-ui.js';

const NUTRI = '00000000-1111-2222-3333-444444444444';
const COLAB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const sql = readFileSync(new URL('../db/colaborador_documentos.sql', import.meta.url), 'utf8');

grupo('documentos · caminho no storage', () => {
  teste('as pastas seguem dono, colaborador, competência e tipo', () => {
    // É esta ordem que as policies leem para decidir quem vê o quê.
    const c = caminhoDoDocumento({
      nutriId: NUTRI, colaboradorId: COLAB, competencia: '2026-08-01',
      tipo: 'contracheque', arquivo: 'contracheque.html',
    });
    igual(c.split('/'), [NUTRI, COLAB, '2026-08', 'contracheque', 'contracheque.html']);
  });

  teste('sem dono, sem tipo ou sem competência não monta caminho', async () => {
    const base = { nutriId: NUTRI, colaboradorId: COLAB, competencia: '2026-08-01', tipo: 'contracheque' };
    ok(String((await lanca(() => caminhoDoDocumento({ ...base, nutriId: null }))).message).includes('sem_dono'));
    ok(String((await lanca(() => caminhoDoDocumento({ ...base, tipo: null }))).message).includes('sem_tipo'));
    ok(String((await lanca(() => caminhoDoDocumento({ ...base, competencia: '' }))).message).includes('sem_competencia'));
  });

  teste('competência mal formada é recusada, não silenciada', async () => {
    // "sem-competencia" no caminho viraria uma pasta órfã que ninguém acha.
    const e = await lanca(() => caminhoDoDocumento({
      nutriId: NUTRI, colaboradorId: COLAB, competencia: 'agosto', tipo: 'contracheque',
    }));
    ok(String(e.message).includes('sem_competencia'));
  });

  teste('barra no nome não cria pasta a mais', () => {
    const c = caminhoDoDocumento({
      nutriId: NUTRI, colaboradorId: COLAB, competencia: '2026-08-01',
      tipo: 'folha_ponto', arquivo: '../../outro/ponto.pdf',
    });
    igual(c.split('/').length, 5, `caminho com pasta injetada: ${c}`);
  });

  teste('acento e espaço saem do nome', () => {
    igual(nomeSeguro('07-2026 Ponto Ana Vitória.pdf'), '07-2026-Ponto-Ana-Vitoria.pdf');
    igual(nomeSeguro(''), 'documento');
  });

  teste('o bucket é privado e é o que o SQL cria', () => {
    igual(BUCKET, 'colaborador-documentos');
    ok(sql.includes("values ('colaborador-documentos', 'colaborador-documentos', false)"),
      'o bucket tem que nascer privado');
  });
});

grupo('documentos · formato não acopla a interface', () => {
  teste('HTML não é chamado de PDF', () => {
    // O arquivo guardado é HTML: "Baixar PDF" seria mentira na tela.
    const f = formatoDoDocumento({ mime_type: 'text/html' });
    igual(f.formato, 'html');
    igual(f.mimeType, 'text/html');
    contem(f.rotuloSalvar, 'PDF');
    contem(f.rotuloSalvar, 'Imprimir');
    ok(f.podeImprimir);
  });

  teste('PDF se descreve como PDF', () => {
    const f = formatoDoDocumento({ mime_type: 'application/pdf' });
    igual(f.formato, 'pdf');
    igual(f.rotuloSalvar, 'Baixar');
  });

  teste('a tela pergunta capacidade, não formato', () => {
    // Quando o contracheque virar PDF, só esta função muda.
    const ui = readFileSync(new URL('../js/documentos-ui.js', import.meta.url), 'utf8');
    ok(ui.includes('formatoDoDocumento'), 'a tela tem que consultar a descrição');
    naoContem(ui, "mime_type === 'text/html'", 'nada de decidir por comparação de mime na tela');
  });

  teste('tamanho em unidade legível', () => {
    igual(tamanho(900), '900 B');
    igual(tamanho(20480), '20 KB');
    igual(tamanho(1468006), '1.4 MB');
    igual(tamanho(0), '—');
    igual(tamanho(null), '—');
  });
});

grupo('documentos · tipos extensíveis', () => {
  teste('os dois tipos de hoje e os que vêm depois', () => {
    for (const t of ['contracheque', 'folha_ponto']) {
      ok(TIPOS[t], `faltou o tipo ${t}`);
      ok(sql.includes(`'${t}'`), `o banco não aceita ${t}`);
    }
    for (const futuro of ['recibo_ferias', 'informe_rendimentos', 'advertencia', 'documento_admissional']) {
      ok(TIPOS[futuro], `faltou preparar o tipo ${futuro}`);
      ok(sql.includes(`'${futuro}'`), `o banco não aceita ${futuro}`);
    }
  });

  teste('todo tipo do código é aceito pelo banco', () => {
    // Um tipo que só existe no JavaScript quebra no insert, em produção.
    const faltando = Object.keys(TIPOS).filter(t => !sql.includes(`'${t}'`));
    igual(faltando, []);
  });

  teste('status e origem batem entre código e banco', () => {
    for (const s of Object.keys(STATUS)) ok(sql.includes(`'${s}'`), `status ${s} não existe no banco`);
    for (const o of Object.keys(ORIGENS)) ok(sql.includes(`'${o}'`), `origem ${o} não existe no banco`);
  });
});

grupo('documentos · versões e duplicidade', () => {
  const dados = readFileSync(new URL('../js/documentos.js', import.meta.url), 'utf8');

  teste('uma versão atual por colaborador, competência e tipo', () => {
    ok(/uniq_cd_atual[\s\S]{0,200}where atual/.test(sql), 'faltou o índice da versão atual');
  });

  teste('regerar cria versão, não sobrescreve', () => {
    // O colaborador pode já ter visto e impresso a versão anterior.
    ok(/const versao = \(anteriores\[0\]\?\.versao \|\| 0\) \+ 1/.test(dados));
    ok(dados.includes('substitui_documento_id'), 'a nova tem que apontar para a que substitui');
  });

  teste('a v2 não sobrescreve o arquivo da v1 no storage', () => {
    // Mesmo nome de arquivo com upsert apagaria o conteúdo da versão anterior,
    // e a linha antiga passaria a apontar para o documento novo.
    ok(/versao > 1 \? `v\$\{versao\}-\$\{nome\}` : nome/.test(dados),
      'a versão tem que entrar no nome do arquivo');
  });

  teste('mesmo conteúdo não vira versão nova', () => {
    ok(/atual\.hash === hash/.test(dados), 'faltou comparar o hash');
    ok(/return \{ documento: atual, duplicado: true \}/.test(dados), 'reenvio devolve o que existe');
  });

  teste('a anterior deixa de ser atual ANTES de a nova entrar', () => {
    // A ORDEM ERA A INVERSA, e estava errada: `uniq_cd_atual` só permite uma
    // linha atual por (colaborador, competência, tipo), então inserir a nova
    // como atual com a anterior ainda atual viola a chave. O fechamento da
    // folha falhava com "duplicate key value violates unique constraint
    // uniq_cd_atual" para quem teve o contracheque corrigido — e só para essa
    // pessoa, porque quem não mudou nada sai antes pelo hash igual.
    //
    // O que a ordem antiga protegia — nunca ficar sem versão atual — passou a
    // ser feito pela compensação no `catch`, testada em
    // test/documentos-versao.test.mjs.
    const iInsert = dados.indexOf('.insert(', dados.indexOf("from('colaborador_documentos')"));
    const iUpdate = dados.indexOf('.update({ atual: false');
    ok(iUpdate > 0 && iUpdate < iInsert, 'a troca tem que vir antes do insert');
    ok(dados.includes('.update({ atual: true'), 'faltou a compensação do insert que falha');
  });

  teste('o arquivo sobe antes do registro existir', () => {
    // Ao contrário, uma falha de rede deixaria documento "disponível"
    // apontando para nada, e o colaborador clicaria num link quebrado.
    const iUpload = dados.indexOf('.upload(caminho, blob');
    // Posição do .insert() logo depois do .from(): procurar o trecho com a
    // quebra de linha embutida falharia em máquina com CRLF.
    const iInsert = dados.indexOf('.insert(', dados.indexOf("from('colaborador_documentos')"));
    ok(iUpload > 0 && iUpload < iInsert, 'o upload tem que vir antes do insert');
  });
});

grupo('documentos · validação de entrada', () => {
  const dados = readFileSync(new URL('../js/documentos.js', import.meta.url), 'utf8');

  teste('só PDF e HTML entram', () => {
    ok(/MIMES_ACEITOS = \['application\/pdf', 'text\/html'\]/.test(dados));
    ok(dados.includes('documento_tipo_nao_aceito'));
  });

  teste('tem teto de tamanho', () => {
    igual(TAMANHO_MAXIMO, 15 * 1024 * 1024);
    ok(dados.includes('documento_grande_demais'));
  });

  teste('cada falha vira frase de gente', () => {
    for (const [erro, trecho] of [
      ['Bucket not found', 'colaborador_documentos.sql'],
      ['documento_grande_demais', '15 MB'],
      ['documento_tipo_nao_aceito', 'PDF ou HTML'],
      ['documento_sem_competencia', 'competência'],
    ]) {
      const m = traduzirErroDocumento(erro);
      contem(m, trecho, `"${erro}" virou "${m}"`);
    }
  });
});

grupo('documentos · segurança no banco', () => {
  teste('o colaborador lê, e só o que está disponível', () => {
    ok(/cd_colaborador_select[\s\S]{0,300}colaborador_id = public\.funcionario_do_auth\(\)/.test(sql));
    ok(/cd_colaborador_select[\s\S]{0,300}status = 'disponivel'/.test(sql));
    ok(/cd_colaborador_select[\s\S]{0,300}arquivado_em is null/.test(sql));
  });

  teste('o colaborador não escreve nada', () => {
    for (const p of ['cd_colaborador_insert', 'cd_colaborador_update', 'cd_colaborador_delete']) {
      ok(!sql.includes(p), `não devia existir a política ${p}`);
    }
  });

  teste('marcar visualizado passa por função, não por update direto', () => {
    // Com update na tabela, ele mexeria em status, versão e caminho.
    ok(/function public\.marcar_documento_visualizado[\s\S]{0,600}security definer/.test(sql));
    ok(/and colaborador_id = v_eu/.test(sql), 'a função só escreve na linha dele');
  });

  teste('a primeira visualização não se sobrescreve', () => {
    // É ela que responde "quando ele soube".
    ok(/visualizado_em = coalesce\(visualizado_em, now\(\)\)/.test(sql));
  });

  teste('o storage confere a TABELA, não só a pasta', () => {
    // Sem isso, documento arquivado continuaria abrindo para quem guardou o
    // caminho.
    ok(/cd_storage_colaborador[\s\S]{0,400}public\.documento_e_meu\(name\)/.test(sql));
    ok(/function public\.documento_e_meu[\s\S]{0,400}security definer/.test(sql));
  });

  teste('competência é sempre o primeiro dia do mês', () => {
    // Sem isso "agosto" viraria 31 datas e nenhum agrupamento fecharia.
    ok(/cd_competencia_check[\s\S]{0,120}extract\(day from competencia\) = 1/.test(sql));
  });

  teste('apagar colaborador com documento é barrado', () => {
    ok(/colaborador_id uuid not null references public\.funcionarios\(id\) on delete restrict/.test(sql));
  });
});

grupo('documentos · fluxos que gravam', () => {
  const folhaUi = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
  const cc = readFileSync(new URL('../js/contracheque-arquivo.js', import.meta.url), 'utf8');
  const ponto = readFileSync(new URL('../js/ponto-arquivo.js', import.meta.url), 'utf8');

  teste('contracheque e ponto passam pelo mesmo repositório', () => {
    ok(cc.includes('guardarDocumento'), 'o contracheque tem que ir para o repositório');
    ok(ponto.includes('guardarDocumento'), 'o ponto também');
    ok(cc.includes("tipo: 'contracheque'"));
    ok(ponto.includes("tipo: 'folha_ponto'"));
  });

  teste('o ponteiro do arquivo saiu da linha da folha', () => {
    // Duas fontes de verdade para o mesmo arquivo divergiriam na primeira
    // regeneração.
    ok(!/ponto_arquivo: caminho/.test(folhaUi), 'a folha não grava mais o caminho do ponto');
    ok(!/contracheque_arquivo:/.test(folhaUi), 'nem o do contracheque');
    ok(folhaUi.includes('ponto_minutos'), 'mas a APURAÇÃO continua na linha');
  });

  teste('o contracheque publicado traz o botão de imprimir', () => {
    ok(cc.includes('window.print()'), 'aberto fora do app, ele precisa de uma ação própria');
    ok(cc.includes('Imprimir ou salvar em PDF'), 'e o rótulo não pode chamar de PDF o que é HTML');
    ok(/\.cc-imprimir \{ display: none !important; \}/.test(cc), 'o botão não sai no papel');
  });

  teste('o documento publicado não pede nada de fora', () => {
    ok(cc.includes('noindex'), 'holerite não se indexa');
    naoContem(cc, '<script src', 'nada de script externo no documento');
  });

  teste('a folha mostra o que já existe e o que falta', () => {
    ok(folhaUi.includes('resumoDocumentos'), 'faltou o resumo da competência');
    ok(folhaUi.includes('Ver documentos da competência'), 'faltou a entrada da tela');
  });
});

grupo('documentos · o que a folha resume', () => {
  teste('conta gerados, vistos e quem ficou sem ponto', async () => {
    const { resumoDocumentos } = await import('../js/folha-ui.js');
    const itens = [
      { funcionario_id: 'a', modo: 'horas', funcionario: { nome: 'Ana' } },
      { funcionario_id: 'b', modo: 'horas', funcionario: { nome: 'Beatriz' } },
      { funcionario_id: 'c', modo: 'fixo', funcionario: { nome: 'Josely' } },
    ];
    const docs = new Map([
      ['a', { contracheque: { visualizado_pelo_colaborador: true }, folha_ponto: {} }],
      ['b', { contracheque: {} }],
      ['c', { contracheque: {} }],
    ]);
    const r = resumoDocumentos(itens, docs);
    igual(r.pessoas, 3);
    igual(r.contracheques, 3);
    igual(r.pontos, 1);
    igual(r.vistos, 1);
    igual(r.semPonto, ['Beatriz'], 'mensalista não precisa de folha de ponto');
  });

  teste('competência vazia não quebra', async () => {
    const { resumoDocumentos } = await import('../js/folha-ui.js');
    const r = resumoDocumentos([], new Map());
    igual(r, { pessoas: 0, contracheques: 0, pontos: 0, vistos: 0, semPonto: [] });
  });
});

grupo('documentos · PWA do colaborador', () => {
  const ui = readFileSync(new URL('../js/equipe-ui.js', import.meta.url), 'utf8');
  const dados = readFileSync(new URL('../js/equipe-data.js', import.meta.url), 'utf8');

  teste('a consulta filtra por colaborador, disponível e não arquivado', () => {
    const trecho = dados.slice(dados.indexOf('export async function meusDocumentos'));
    ok(trecho.includes(".eq('colaborador_id', funcionarioId)"), 'filtro explícito, não só a policy');
    ok(trecho.includes(".eq('status', 'disponivel')"));
    ok(trecho.includes(".is('arquivado_em', null)"));
    ok(trecho.includes(".eq('atual', true)"), 'versão antiga não aparece na lista');
  });

  teste('os documentos são agrupados por ano e competência', () => {
    // É assim que a pessoa procura: "preciso do contracheque de março".
    ok(ui.includes('renderDocumentos'), 'faltou a tela');
    ok(/porAno/.test(ui) && /meses/.test(ui), 'faltou o agrupamento');
  });

  teste('marca como visto DEPOIS de abrir', () => {
    // Marcar antes registraria leitura de documento que talvez nem abriu.
    const trecho = ui.slice(ui.indexOf('async function abrirDocumento('));
    const iAbrir = trecho.indexOf('window.open(url');
    const iMarcar = trecho.indexOf('await marcarVisualizado(id)');
    ok(iAbrir > 0 && iMarcar > iAbrir, 'a marcação vem depois da abertura');
  });

  teste('documento novo aparece marcado', () => {
    ok(ui.includes('eq-novo'), 'faltou o selo de não visualizado');
    ok(ui.includes('eq-badge'), 'e o contador no atalho');
  });

  teste('estado vazio explica o que vai aparecer ali', () => {
    contem(ui, 'Você ainda não possui documentos disponíveis.');
    contem(ui, 'aparecerão aqui quando forem disponibilizados');
  });

  teste('o app não chama de PDF o que é HTML', () => {
    naoContem(ui, 'Baixar PDF');
    contem(ui, 'imprimir ou salvar em PDF');
  });

  teste('falha nos documentos não derruba os pagamentos', () => {
    // Sem o repositório instalado, a tela principal continua funcionando.
    ok(/_documentos = \[\];\s*\n\s*_novos = 0;/.test(ui), 'faltou o caminho de degradação');
  });
});
