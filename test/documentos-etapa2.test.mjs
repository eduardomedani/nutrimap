// Documentos — etapa 2: pendências, auditoria, revisão do fechamento, aviso.
//
// O que este arquivo protege:
//   . o arquivo que não achou dono não se perde nem aparece para quem não é;
//   . o log de ações não depende de alguém lembrar de escrevê-lo;
//   . fechar a folha com pendência não parece igual a fechar sem.

import { grupo, teste, ok, igual } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { caminhoPendente, ACOES } from '../js/documentos.js';

const NUTRI = '00000000-1111-2222-3333-444444444444';
const sql1 = readFileSync(new URL('../db/colaborador_documentos.sql', import.meta.url), 'utf8');
const sql2 = readFileSync(new URL('../db/documentos_etapa2.sql', import.meta.url), 'utf8');
const dados = readFileSync(new URL('../js/documentos.js', import.meta.url), 'utf8');
const folhaUi = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');

grupo('etapa 2 · pendentes de vínculo', () => {
  teste('pendente não é documento com dono nulo', () => {
    // Abrir exceção enfraqueceria a garantia em TODA consulta: cada uma
    // passaria a precisar de "and colaborador_id is not null".
    ok(sql2.includes('create table if not exists public.documentos_pendentes'));
    ok(/colaborador_id uuid not null/.test(sql1), 'o documento continua exigindo dono');
  });

  teste('o arquivo órfão vai para pasta que ninguém enxerga', () => {
    // A pasta 2 não é um colaborador, então a policy de leitura do colaborador
    // (que compara a pasta 2 com o próprio id) nunca casa aqui.
    const c = caminhoPendente({ nutriId: NUTRI, competencia: '2026-08-01', arquivo: 'x.pdf' });
    igual(c, `${NUTRI}/_pendentes/2026-08/x.pdf`);
    igual(c.split('/')[1], '_pendentes');
  });

  teste('a importação guarda o que não casou, em vez de descartar', () => {
    ok(folhaUi.includes('guardarOrfaos'), 'faltou a coleta dos órfãos');
    ok(folhaUi.includes('pendentes de vínculo'), 'e o aviso na tela');
    const iGuarda = folhaUi.indexOf('await guardarOrfaos(orfaos)');
    const iConfirma = folhaUi.indexOf('titulo: `Preencher');
    ok(iGuarda > 0 && iGuarda < iConfirma, 'guardar vem antes de qualquer confirmação');
  });

  teste('sugestão fraca não é sugestão', () => {
    // Quem confirma no automático acabaria mandando o documento de uma pessoa
    // para outra.
    ok(/normalizar\(f\.nome\) === alvo/.test(folhaUi), 'só sugere com nome idêntico');
  });

  teste('o arquivo é copiado antes de sair da sala de espera', () => {
    // Mover primeiro deixaria o arquivo fora das duas pastas se o registro
    // falhasse — e nenhuma tela saberia onde ele foi parar.
    const trecho = dados.slice(dados.indexOf('export async function vincularPendente'));
    const iCopia = trecho.indexOf('.copy(');
    const iRpc = trecho.indexOf("rpc('vincular_documento_pendente'");
    const iRemove = trecho.indexOf('.remove(');
    ok(iCopia > 0 && iCopia < iRpc && iRpc < iRemove, 'copiar, registrar, só então apagar');
  });

  teste('vincular cria documento e fecha a pendência juntos', () => {
    ok(/function public\.vincular_documento_pendente[\s\S]{0,3000}insert into public\.colaborador_documentos/.test(sql2));
    ok(/update public\.documentos_pendentes\s*\n?\s*set status = 'vinculado'/.test(sql2));
  });

  teste('vincular respeita quem já tinha documento', () => {
    ok(/v_versao := v_atual\.versao \+ 1/.test(sql2), 'não pode sobrescrever o que existe');
  });

  teste('o mesmo arquivo não entra duas vezes na fila', () => {
    ok(/uniq_dp_hash[\s\S]{0,180}status = 'aguardando_vinculo'/.test(sql2));
    ok(/uniq_dp_hash\|duplicate key/.test(dados), 'e repetir a importação não vira erro na tela');
  });

  teste('a fila é do painel — o colaborador não vê', () => {
    // Um arquivo sem dono definido pode ser de outra pessoa.
    ok(!/documentos_pendentes[\s\S]{0,600}funcionario_do_auth/.test(sql2));
    ok(/dp_nutri_all[\s\S]{0,140}nutri_id = auth\.uid\(\)/.test(sql2));
  });

  teste('a fila aparece na folha quando tem alguém nela', () => {
    ok(folhaUi.includes('fpPendentes'), 'faltou o alerta na barra');
    ok(folhaUi.includes('aguardando vínculo'), 'e o rótulo que diz o que é');
  });
});

grupo('etapa 2 · auditoria', () => {
  teste('quem escreve é o gatilho, não a tela', () => {
    // Um insert espalhado por cada ponto de ação seria esquecido no primeiro
    // caminho novo — e o registro que falta é sempre o do dia em que alguém
    // precisou dele.
    ok(/create trigger trg_auditoria_documento/.test(sql2), 'faltou o gatilho');
    ok(!/from\('documento_auditoria'\)[\s\S]{0,80}\.insert/.test(dados),
      'a tela não pode inserir no log');
  });

  teste('ninguém edita o próprio log', () => {
    ok(/da_nutri_select[\s\S]{0,140}for select/.test(sql2));
    for (const p of ['da_nutri_insert', 'da_nutri_update', 'da_nutri_delete']) {
      ok(!sql2.includes(p), `não devia existir a política ${p}`);
    }
  });

  teste('registra as ações que importam', () => {
    for (const acao of ['documento_gerado', 'documento_importado', 'nova_versao_gerada',
      'documento_visualizado', 'documento_arquivado', 'documento_excluido']) {
      ok(sql2.includes(`'${acao}'`), `faltou registrar ${acao}`);
    }
  });

  teste('exclusão é registrada antes de a linha sumir', () => {
    ok(/tg_op = 'DELETE'[\s\S]{0,500}insert into public\.documento_auditoria/.test(sql2));
    ok(/after insert or update or delete/.test(sql2));
  });

  teste('todo código de ação do banco tem rótulo no JS', () => {
    // Ação sem rótulo apareceria crua na tela: "nova_versao_gerada".
    const noSql = [...sql2.matchAll(/v_acao := '(\w+)'/g)].map(m => m[1]);
    ok(noSql.length >= 5, 'não achei as ações no gatilho');
    igual(noSql.filter(a => !ACOES[a]), []);
  });

  teste('atualização sem novidade não gera registro', () => {
    // Salvar a linha sem mudar nada relevante encheria o log de ruído e
    // esconderia os eventos que importam.
    ok(/Nada que valha registro[\s\S]{0,200}return new;/.test(sql2),
      'o gatilho tem que sair sem gravar quando nada relevante mudou');
  });
});

grupo('etapa 2 · revisão no fechamento', () => {
  teste('a revisão lista o que está incompleto', () => {
    ok(folhaUi.includes('com folha de ponto vinculada'), 'faltou o número de pontos');
    ok(folhaUi.includes('Sem folha de ponto:'), 'e quem ficou sem');
    ok(/arquivos? aguardam?/.test(folhaUi), 'e a fila de pendências');
    ok(/if \(pendentes\) revisao\.push/.test(folhaUi), 'que só aparece quando existe');
  });

  teste('fechar com pendência pede confirmação diferente', () => {
    // Confirmar igual nos dois casos treina a pessoa a clicar sem ler.
    ok(/incompleta \? 'Fechar com pendências\?' : 'Fechar a folha'/.test(folhaUi));
    ok(/perigo: incompleta/.test(folhaUi));
  });

  teste('a revisão relê antes de contar', () => {
    const trecho = folhaUi.slice(folhaUi.indexOf('async function concluir()'));
    const iRele = trecho.indexOf('await carregarDocumentos()');
    const iResumo = trecho.indexOf('resumoDocumentos(_itens, _docs)');
    ok(iRele > 0 && iRele < iResumo, 'contar sobre dado velho daria revisão errada');
  });
});

grupo('etapa 2 · aviso no PWA', () => {
  const ui = readFileSync(new URL('../js/equipe-ui.js', import.meta.url), 'utf8');

  teste('o aviso nomeia o documento e o mês', () => {
    // "Você tem 2 documentos novos" obriga a pessoa a ir procurar o que mudou.
    ok(ui.includes('avisoNovosHtml'), 'faltou o aviso');
    ok(/está disponível\./.test(ui), 'faltou a frase que nomeia');
    ok(/nomeCompetencia\(primeiro\.competencia\)/.test(ui), 'e o mês');
  });

  teste('o aviso é o próprio caminho para o documento', () => {
    ok(/getElementById\('eqAviso'\)\?\.addEventListener\('click', abrirDocumentos\)/.test(ui),
      'clicar tem que levar aos documentos, não a lugar nenhum');
  });

  teste('sem documento novo, nenhum aviso', () => {
    ok(/if \(!novos\.length\) return '';/.test(ui), 'aviso permanente vira ruído');
  });
});
