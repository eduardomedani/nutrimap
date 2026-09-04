// Contracheque publicado — o arquivo que o colaborador vai abrir no app.
//
// O que este arquivo protege:
//   1. o CAMINHO no Storage, que é o que as policies leem para decidir quem vê
//      o quê — trocar a ordem das pastas abre o holerite de um para outro;
//   2. o documento ser AUTOSSUFICIENTE, porque ele vai ser aberto fora do
//      painel, possivelmente offline;
//   3. o estilo ter uma origem só: copiado para dentro do gerador, ele
//      divergiria da tela no primeiro ajuste.

import { grupo, teste, ok, igual, contem, naoContem, lanca } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  BUCKET, documentoHtml, estiloDoDocumento, traduzirErroContracheque,
} from '../js/contracheque-arquivo.js';
import { caminhoDoDocumento } from '../js/documentos.js';

const NUTRI = '00000000-1111-2222-3333-444444444444';
const FUNC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

grupo('contracheque publicado · vai para o repositório', () => {
  teste('o caminho é o do repositório de documentos', () => {
    // Este módulo deixou de ter caminho próprio: quem organiza pasta, versão e
    // registro é js/documentos.js. Dois lugares montando caminho divergiriam.
    const c = caminhoDoDocumento({
      nutriId: NUTRI, colaboradorId: FUNC, competencia: '2026-08-01',
      tipo: 'contracheque', arquivo: 'contracheque.html',
    });
    igual(c, `${NUTRI}/${FUNC}/2026-08/contracheque/contracheque.html`);
  });

  teste('o bucket é o do repositório, privado', () => {
    const sql = readFileSync(new URL('../db/colaborador_documentos.sql', import.meta.url), 'utf8');
    igual(BUCKET, 'colaborador-documentos');
    ok(sql.includes("values ('colaborador-documentos', 'colaborador-documentos', false)"));
  });

  teste('o módulo não guarda arquivo por conta própria', () => {
    const cc = readFileSync(new URL('../js/contracheque-arquivo.js', import.meta.url), 'utf8');
    ok(!/storage\.from\(/.test(cc), 'o upload tem que passar pelo repositório');
    ok(cc.includes('guardarDocumento'));
  });
});

grupo('contracheque publicado · o documento', () => {
  const html = documentoHtml('<article class="cc">miolo</article>', {
    titulo: 'Contracheque · Aline', css: '.cc { color: red; }',
  });

  teste('é um HTML completo, não um fragmento', () => {
    ok(html.startsWith('<!doctype html>'), 'sem doctype o navegador entra em modo peculiar');
    contem(html, '<html lang="pt-BR">');
    contem(html, '<meta charset="utf-8">');
    contem(html, 'name="viewport"');
  });

  teste('o estilo vai embutido', () => {
    // Ele será aberto fora do painel: um <link> relativo não resolveria.
    contem(html, '.cc { color: red; }');
    naoContem(html, '<link', 'nada de folha externa no documento publicado');
    naoContem(html, '<script', 'documento não executa nada');
  });

  teste('o título é escapado', () => {
    const perigoso = documentoHtml('<p>x</p>', { titulo: '<script>x</script>', css: '' });
    naoContem(perigoso, '<title><script>');
  });

  teste('imprime sem a moldura de tela', () => {
    contem(html, '@media print');
  });
});

grupo('contracheque publicado · estilo de origem única', () => {
  teste('lê as folhas do próprio app, não uma cópia', async () => {
    const pedidos = [];
    const css = await estiloDoDocumento(async (caminho) => {
      pedidos.push(caminho);
      return `/* ${caminho} */`;
    });
    igual(pedidos, ['css/tokens.css', 'css/contracheque.css']);
    contem(css, 'css/contracheque.css');
  });

  teste('o CSS do documento saiu do financeiro.css', () => {
    // As duas telas têm que desenhar o recibo a partir do MESMO arquivo.
    const fin = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');
    const doc = readFileSync(new URL('../css/contracheque.css', import.meta.url), 'utf8');
    ok(doc.includes('.cc {'), 'o documento tem que estar em css/contracheque.css');
    ok(!/^\.cc \{/m.test(fin), 'e não pode ter ficado duplicado no financeiro.css');
    // A moldura da tela continua onde estava.
    ok(fin.includes('.cc-barra'), '.cc-barra é moldura de tela, fica no financeiro.css');
    ok(!doc.includes('.cc-barra'), 'e não vaza para o documento publicado');
  });

  teste('o index carrega as duas folhas', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    ok(index.includes('href="css/contracheque.css"'), 'faltou o <link> do documento');
    ok(index.indexOf('css/contracheque.css') > index.indexOf('css/financeiro.css'),
      'o documento vem depois, para poder ajustar o que a moldura definiu');
  });

  teste('erro de bucket ausente manda rodar o schema', () => {
    ok(traduzirErroContracheque('Bucket not found').includes('contracheque_publicado.sql'));
  });

  // O erro cru do Storage não diz o que fazer, e chegava assim ao usuário no
  // meio do fechamento da folha.
  teste('erro de MIME manda rodar a migration da lista de tipos', () => {
    const t = traduzirErroContracheque('mime type text/html is not supported');
    ok(t.includes('documentos_mime_do_app.sql'), 'faltou dizer qual arquivo rodar');
    ok(t.includes('text/html'), 'faltou dizer qual tipo foi recusado');
  });

  teste('a migration dos tipos cobre o que o app grava', () => {
    const sql = readFileSync(
      new URL('../db/documentos_mime_do_app.sql', import.meta.url), 'utf8');
    for (const mime of [
      'application/pdf',
      'text/html',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]) {
      ok(sql.includes(`'${mime}'`), `faltou ${mime} na lista canônica`);
    }
    // Acrescenta à lista existente: substituir apagaria em silêncio um tipo
    // que a migration não conhece — foi assim que text/html se perdeu.
    ok(sql.includes('allowed_mime_types ||'), 'a lista precisa ser acrescentada, não trocada');
    ok(sql.includes('allowed_mime_types is not null'),
      'bucket sem restrição nenhuma não pode ganhar uma');
  });
});

grupo('contracheque publicado · quando fechar a folha', () => {
  const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../db/contracheque_publicado.sql', import.meta.url), 'utf8');

  teste('publica ANTES de fechar', () => {
    // Folha fechada não aceita mais update em folha_itens — a trava está no
    // banco. Publicar depois deixaria o caminho sem onde ser gravado.
    const iPub = ui.indexOf('await publicarContracheques(');
    const iFech = ui.indexOf('await fecharFolha(');
    ok(iPub > 0 && iFech > 0, 'faltou uma das duas etapas');
    ok(iPub < iFech, 'a publicação tem que vir antes do fechamento');
  });

  teste('falha ao publicar não trava o fechamento', () => {
    // A folha fechada é o registro do pagamento; o Storage fora do ar não tem
    // nada a ver com o dinheiro ter saído.
    ok(/falhas\.push/.test(ui), 'a falha tem que ser colecionada, não lançada');
    ok(/Não publiquei \$\{falhas\.length\}/.test(ui), 'e reportada ao usuário');
  });

  teste('linha zerada não vira contracheque', () => {
    ok(/publicaveis = _itens\.filter\(i => totalItem\(i\) !== 0\)/.test(ui),
      'recibo de R$ 0,00 não é documento');
  });

  teste('o registro fica no repositório, não na linha da folha', () => {
    // Duas fontes de verdade para o mesmo arquivo divergiriam na primeira
    // regeneração — e ninguém saberia qual valia.
    ok(!ui.includes('contracheque_arquivo:'), 'a folha não grava mais o caminho');
    const doc = readFileSync(new URL('../db/colaborador_documentos.sql', import.meta.url), 'utf8');
    for (const col of ['caminho_storage', 'disponibilizado_em', 'versao']) {
      ok(doc.includes(col), `faltou a coluna ${col} no repositório`);
    }
    // As colunas antigas continuam no banco: nada destrutivo.
    ok(sql.includes('contracheque_arquivo'), 'a coluna antiga não foi removida');
  });

  teste('o painel abre o mesmo arquivo do colaborador, por URL assinada', () => {
    ok(ui.includes('abrirDocumentoDaLinha'), 'faltou o caminho de conferência');
    ok(ui.includes('urlAssinada'), 'e por URL assinada — o bucket é privado');
    ok(!ui.includes('getPublicUrl'), 'nada de URL pública para holerite');
  });

  teste('o colaborador só lê a pasta dele', () => {
    ok(/contracheque_func_read[\s\S]*foldername\(name\)\)\[2\] = public\.funcionario_do_auth\(\)/.test(sql),
      'a policy tem que casar a pasta 2 com o funcionário logado');
    ok(!/contracheque_func_(insert|update|delete)/.test(sql), 'no app ele lê, não escreve');
  });
});
