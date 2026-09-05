// ═══════════════════════════════════════════════════════════
// DOCUMENTO DO COLABORADOR — a troca de versão
// ═══════════════════════════════════════════════════════════
// Este arquivo existe por causa de um erro que aconteceu de verdade, duas
// vezes, no fechamento da folha:
//
//   Não publiquei 1: Aline: duplicate key value violates unique constraint
//   "uniq_cd_atual"
//
// O índice `uniq_cd_atual (colaborador_id, competencia, tipo_documento) where
// atual` permite UMA versão atual por competência. `guardarDocumento` inseria a
// nova como atual e SÓ DEPOIS tirava a anterior — o que viola a chave sempre
// que já existe contracheque daquela competência.
//
// POR QUE NÃO APARECEU ANTES: quem republica sem mudar nada tem o mesmo hash e
// sai antes, pelo caminho do "duplicado". Só estoura para quem teve o valor
// CORRIGIDO — exatamente a pessoa por quem se reabriu a folha.

import { grupo, teste, ok, igual } from './runner.mjs';
import { limpar, tabela, rpc, chamadas, falhar } from './duble-supabase.mjs';
import { guardarDocumento, traduzirErroDocumento } from '../js/documentos.js';
import { traduzirErroContracheque } from '../js/contracheque-arquivo.js';
import { limparOrganizacao } from '../js/organizacao.js';

const ATUAL = {
  id: 'doc-v1', nutri_id: 'org-1', colaborador_id: 'f-aline',
  competencia: '2026-09-01', tipo_documento: 'contracheque',
  versao: 1, atual: true, hash: 'hash-de-ontem', arquivado_em: null,
};

function cenario(linhas) {
  limpar();
  limparOrganizacao();
  rpc('organizacao_do_auth', () => 'org-1');
  tabela('colaborador_documentos', linhas);
}

const publicar = () => guardarDocumento({
  colaboradorId: 'f-aline',
  competencia: '2026-09-01',
  tipo: 'contracheque',
  conteudo: '<html>valor corrigido</html>',
  nomeArquivo: 'contracheque.html',
  mimeType: 'text/html',
});

const escritas = () => chamadas.filter(c => c.tabela === 'colaborador_documentos'
  && (c.operacao === 'insert' || c.operacao === 'update'));

// ───────────────────────────────────────────────────────────
grupo('documento · a versão anterior sai antes de a nova entrar', () => {
  teste('republicar com conteúdo novo não colide com uniq_cd_atual', async () => {
    cenario([ATUAL]);
    await publicar();

    const ordem = escritas();
    igual(ordem.map(c => c.operacao), ['update', 'insert'],
          'a nova versão não pode entrar enquanto a anterior ainda é a atual');
    igual(ordem[0].payload.atual, false);
    igual(ordem[1].payload.atual, true);
    igual(ordem[1].payload.versao, 2);
    igual(ordem[1].payload.substitui_documento_id, 'doc-v1');
  });

  teste('sem versão anterior, não há troca — só o insert', async () => {
    cenario([]);
    await publicar();
    igual(escritas().map(c => c.operacao), ['insert']);
  });

  teste('mesmo conteúdo não mexe em nada', async () => {
    // O caminho que escondia o defeito: quem não mudou nada sai por aqui.
    const { hashDoConteudo } = await import('../js/documentos.js');
    const hash = await hashDoConteudo('<html>valor corrigido</html>');
    cenario([{ ...ATUAL, hash }]);

    const r = await publicar();
    ok(r.duplicado, 'reenvio idêntico tinha que ser reconhecido');
    igual(escritas().length, 0);
  });

  teste('colidir SEM versão anterior visível vira um erro que se pode agir', async () => {
    // A SEGUNDA CAUSA, e a que sobreviveu à correção da ordem: o documento
    // atual existe na tabela e a RLS não o devolve, porque ele foi gravado com
    // o uuid da pessoa antes da Etapa 4C. O índice enxerga; o SELECT não.
    // "duplicate key value violates unique constraint" manda quem lê procurar
    // no lugar errado.
    cenario([]);                       // a leitura não vê nada...
    falhar('colaborador_documentos',
           'duplicate key value violates unique constraint "uniq_cd_atual"', 'insert');

    let erro = null;
    try { await publicar(); } catch (e) { erro = e; }
    igual(erro?.message, 'documento_atual_invisivel');
    igual(escritas().filter(c => c.operacao === 'update').length, 0,
          'não havia versão visível: não há troca para desfazer');
  });

  teste('e a mensagem aponta a conferência que responde', () => {
    igual(traduzirErroDocumento('documento_atual_invisivel').includes('119'), true);
    const cc = traduzirErroContracheque('documento_atual_invisivel');
    ok(cc.includes('119_documentos_fora_da_organizacao'), 'faltou dizer onde olhar');
    ok(cc.includes('documentos_trazer_para_organizacao'), 'faltou dizer como corrigir');
  });

  teste('insert que falha devolve a anterior ao estado de atual', async () => {
    // Sem a compensação, a competência ficaria sem NENHUMA versão atual e o
    // colaborador deixaria de ver o contracheque que já tinha — um estrago
    // maior que o erro que se estava tentando evitar.
    cenario([ATUAL]);
    falhar('colaborador_documentos',
           'duplicate key value violates unique constraint "uniq_cd_atual"', 'insert');

    let erro = null;
    try { await publicar(); } catch (e) { erro = e; }

    ok(erro, 'o erro tem que continuar chegando a quem chamou');
    const updates = escritas().filter(c => c.operacao === 'update');
    igual(updates.map(c => c.payload.atual), [false, true],
          'a anterior desce e volta a subir');
  });
});
