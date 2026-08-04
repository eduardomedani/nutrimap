// Terreno do app do funcionário: vínculo de conta, políticas de leitura e o
// PDF do ponto guardado.
//
// O que este arquivo protege: o CAMINHO do arquivo no Storage e as travas de
// leitura. As policies do bucket decidem quem vê o quê lendo as PASTAS do
// caminho — trocar a ordem `<nutri>/<funcionario>/` abre o holerite de um
// funcionário para outro, sem erro nenhum na tela.

import { grupo, teste, ok, igual, lanca } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  BUCKET, caminhoDoPonto, traduzirErroArquivo,
} from '../js/ponto-arquivo.js';

const NUTRI = '00000000-1111-2222-3333-444444444444';
const FUNC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

grupo('app do funcionário · o ponto vai para o repositório', () => {
  // O caminho, o nome seguro e a duplicidade passaram a ser de js/documentos.js
  // — e estão cobertos em test/documentos.test.mjs. O que importa aqui é que
  // este módulo DELEGUE, em vez de montar caminho por conta própria: duas
  // regras de pasta divergiriam na primeira mudança.
  teste('o caminho é o do repositório', () => {
    const c = caminhoDoPonto({
      nutriId: NUTRI, funcionarioId: FUNC, competencia: '2026-08-01', arquivo: 'ponto.pdf',
    });
    igual(c, `${NUTRI}/${FUNC}/2026-08/folha_ponto/ponto.pdf`);
  });

  teste('sem dono, não monta caminho nenhum', async () => {
    const e = await lanca(() => caminhoDoPonto({ funcionarioId: FUNC, arquivo: 'a.pdf' }));
    ok(String(e.message).includes('sem_dono'));
  });

  teste('o bucket é o do repositório', () => {
    const sql = readFileSync(new URL('../db/colaborador_documentos.sql', import.meta.url), 'utf8');
    igual(BUCKET, 'colaborador-documentos');
    ok(sql.includes("values ('colaborador-documentos', 'colaborador-documentos', false)"));
  });

  teste('o módulo não sobe arquivo por conta própria', () => {
    const src = readFileSync(new URL('../js/ponto-arquivo.js', import.meta.url), 'utf8');
    ok(!/storage\.from\(/.test(src), 'o upload tem que passar pelo repositório');
    ok(src.includes('guardarDocumento'));
  });

  teste('erro de bucket ausente manda rodar o schema certo', () => {
    ok(traduzirErroArquivo('Bucket not found').includes('colaborador_documentos.sql'));
  });
});

grupo('app do funcionário · o que o SQL garante', () => {
  const sql = readFileSync(new URL('../db/funcionario_login_schema.sql', import.meta.url), 'utf8');

  teste('vínculo de conta e código de acesso', () => {
    ok(sql.includes('auth_user_id'), 'faltou a coluna de vínculo');
    ok(sql.includes('codigo_acesso'), 'faltou o código do convite');
    ok(sql.includes('uq_funcionarios_auth_user'), 'uma conta não pode servir a dois cadastros');
    ok(sql.includes('vincular_funcionario'), 'faltou o RPC que liga a conta ao cadastro');
  });

  teste('o código não tem caractere ambíguo', () => {
    // O código vai ser ditado por telefone: 0/O e 1/I/L viram suporte.
    const alfabeto = /v_alfabeto constant text := '([A-Z0-9]+)'/.exec(sql)?.[1] || '';
    ok(alfabeto.length > 20, 'não achei o alfabeto do gerador');
    for (const c of ['0', 'O', '1', 'I', 'L']) {
      ok(!alfabeto.includes(c), `"${c}" não pode estar no alfabeto do código`);
    }
  });

  teste('o funcionário só enxerga folha fechada', () => {
    // Rascunho é número mudando enquanto o valor ainda está sendo digitado.
    ok(/folhas_funcionario_read[\s\S]*status = 'fechada'/.test(sql), 'a folha rascunho não pode aparecer');
    ok(/folha_itens_funcionario_read[\s\S]*folha_esta_fechada/.test(sql), 'nem a linha dela');
  });

  teste('nenhuma política de escrita para o funcionário', () => {
    // No app ele lê; lançamento é do painel.
    for (const p of ['funcionario_write', 'funcionario_insert', 'funcionario_update', 'funcionario_delete']) {
      ok(!sql.includes(p), `não devia existir política ${p}`);
    }
  });

  teste('as consultas cruzadas passam por SECURITY DEFINER', () => {
    // "ver a folha se tem linha minha" + "ver a linha se a folha está fechada"
    // se chamariam em círculo e o Postgres aborta a consulta.
    for (const fn of ['funcionario_do_auth', 'folha_esta_fechada', 'folha_tem_linha_minha', 'item_e_meu']) {
      ok(new RegExp(`function public\\.${fn}[\\s\\S]{0,400}security definer`).test(sql),
        `${fn} tem que ser security definer`);
    }
  });

  teste('o vínculo recusa conta já usada e código de quem saiu', () => {
    ok(sql.includes('conta_ja_vinculada'), 'faltou barrar conta já vinculada');
    ok(/and ativo/.test(sql), 'código de funcionário desligado não pode valer');
    ok(/auth_user_id is null/.test(sql), 'código já usado não pode valer de novo');
  });

  teste('quem for contratado amanhã também ganha código', () => {
    // Sem o DEFAULT, só quem existia quando o script rodou teria código: todo
    // funcionário novo ficaria sem convite possível, e o defeito só apareceria
    // na primeira contratação, com a causa já esquecida.
    ok(/alter column codigo_acesso set default public\.gerar_codigo_funcionario\(\)/.test(sql),
      'o código tem que nascer com a linha, não por script avulso');
  });

  teste('dois pedidos com o mesmo código não desligam o primeiro', () => {
    // Entre o SELECT e o UPDATE cabe outra chamada: sem repetir a condição no
    // UPDATE, a segunda sobrescreveria o vínculo da primeira em silêncio.
    ok(/update public\.funcionarios[\s\S]{0,140}where id = v_id and auth_user_id is null/.test(sql),
      'o UPDATE tem que reconferir que ninguém pegou o código antes');
    ok(/if not found then\s*raise exception 'codigo_invalido'/.test(sql),
      'e recusar quando outro chegou primeiro');
  });

  teste('o PDF do ponto tem onde ficar e o que foi lido fica registrado', () => {
    for (const col of ['ponto_arquivo', 'ponto_minutos', 'ponto_noturnas', 'ponto_inicio', 'ponto_fim']) {
      ok(sql.includes(col), `faltou a coluna ${col}`);
    }
  });
});

grupo('app do funcionário · a tela já guarda o PDF', () => {
  const ui = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');

  teste('a importação sobe o arquivo junto', () => {
    ok(ui.includes("import('./ponto-arquivo.js')"), 'faltou o módulo de arquivo');
    ok(ui.includes('guardarPonto'), 'o PDF tem que ser guardado na importação');
    ok(ui.includes('ponto_minutos'), 'e o que ele dizia tem que ficar registrado');
  });

  teste('falha ao guardar não derruba o preenchimento', () => {
    // Perder o arquivo é ruim; perder a digitação do mês por causa dele, pior.
    ok(/catch \(e\) \{ \/\* segue sem arquivo \*\/ \}/.test(ui),
      'o upload não pode interromper a gravação das horas');
  });

  teste('o PDF guardado abre por URL assinada, não pública', () => {
    ok(ui.includes('urlAssinada'), 'faltou abrir pelo link assinado');
    ok(!ui.includes('getPublicUrl'), 'bucket é privado — nada de URL pública');
  });
});
