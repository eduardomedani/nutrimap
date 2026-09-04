// ═══════════════════════════════════════════════════════════
// ARQUIVOS DA COMPETÊNCIA — presenças e espelho de ponto
// ═══════════════════════════════════════════════════════════
// Os dois xlsx que alimentam o bônus por presença. Ficam guardados porque o
// bônus sai deles: um ano depois, "por que a Beatriz recebeu R$ 233,50 em
// setembro" só tem resposta se o arquivo que gerou o número ainda existir.
//
// ELES NÃO SÃO DE NINGUÉM, e é por isso que não vão para `colaborador_documentos`.
// O relatório de presenças fala dos ALUNOS; o espelho fala da equipe inteira,
// uma aba por pessoa. Guardá-los como documento de um colaborador faria esse
// colaborador ver, no próprio app, o ponto dos colegas.

import { sb } from './supabase.js';
import { organizacaoAtual } from './organizacao.js';
import { BUCKET, nomeSeguro, hashDoConteudo } from './documentos.js';

export const TIPOS = {
  presencas: { rotulo: 'Relatório de presenças', icone: 'users' },
  ponto:     { rotulo: 'Espelho de ponto (planilha)', icone: 'clock' },
};

/**
 * {nutri}/_mes/{AAAA-MM}/{tipo}-{carimbo}-{arquivo}
 *
 * A pasta 2 é `_mes` e não o uuid de um colaborador, então nenhuma policy de
 * leitura do colaborador casa aqui — a mesma escolha de `_pendentes`. O carimbo
 * de hora no nome evita que a reimportação sobrescreva o objeto anterior no
 * storage: a linha antiga vira `atual = false`, e o arquivo dela continua
 * baixável.
 */
export function caminhoDoArquivoDoMes({ nutriId, competencia, tipo, arquivo, agora = new Date() }) {
  if (!nutriId) throw new Error('arquivo_sem_dono');
  if (!TIPOS[tipo]) throw new Error('arquivo_sem_tipo');
  const mes = String(competencia || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('arquivo_sem_competencia');
  const carimbo = agora.toISOString().slice(0, 19).replace(/[:T-]/g, '');
  return `${nutriId}/_mes/${mes}/${tipo}-${carimbo}-${nomeSeguro(arquivo, '.xlsx')}`;
}

/** Os arquivos correntes do mês, um por tipo. */
export async function arquivosDoMes(competencia) {
  const nutriId = await organizacaoAtual();
  const { data, error } = await sb
    .from('folha_arquivos')
    .select('*')
    .eq('nutri_id', nutriId)
    .eq('competencia', competencia)
    .eq('atual', true);
  if (error) throw error;
  return data || [];
}

/**
 * Guarda o arquivo e registra a linha.
 *
 * A ORDEM IMPORTA: primeiro o upload, depois o banco. Ao contrário, uma falha
 * no upload deixaria uma linha apontando para um objeto que não existe — e a
 * tela ofereceria um download que estoura. Objeto sem linha é lixo silencioso;
 * linha sem objeto é erro na cara do usuário.
 *
 * E a versão anterior só vira `atual = false` DEPOIS de a nova entrar. Se a
 * inserção falhar no meio, o mês continua com o arquivo antigo em vez de ficar
 * sem nenhum.
 */
export async function guardarArquivoDoMes({ competencia, tipo, arquivo, resumo = {} }) {
  const nutriId = await organizacaoAtual();
  const caminho = caminhoDoArquivoDoMes({
    nutriId, competencia, tipo, arquivo: arquivo.name,
  });

  const { error: erroUpload } = await sb.storage.from(BUCKET).upload(caminho, arquivo, {
    contentType: arquivo.type || 'application/octet-stream',
    upsert: false,
  });
  if (erroUpload) throw erroUpload;

  const { data, error } = await sb
    .from('folha_arquivos')
    .insert({
      competencia, tipo,
      nome_arquivo: arquivo.name,
      caminho_storage: caminho,
      mime_type: arquivo.type || null,
      tamanho_bytes: arquivo.size ?? null,
      hash: await hashDoConteudo(arquivo),
      resumo,
    })
    .select().single();

  if (error) {
    // O objeto já subiu e a linha não entrou: sem esta limpeza o próximo envio
    // com o mesmo nome esbarraria num arquivo órfão que ninguém consegue ver.
    await sb.storage.from(BUCKET).remove([caminho]).catch(() => {});
    throw error;
  }

  // Agora sim a anterior sai de cena. O índice único é parcial (`where atual`),
  // então até esta linha rodar existem duas correntes — e é por isso que a
  // inserção acima precisa vir antes: o banco recusaria a segunda.
  await sb.from('folha_arquivos')
    .update({ atual: false })
    .eq('nutri_id', nutriId)
    .eq('competencia', competencia)
    .eq('tipo', tipo)
    .eq('atual', true)
    .neq('id', data.id);

  return data;
}

/** Link temporário para baixar o arquivo guardado. */
export async function urlDoArquivoDoMes(caminho, segundos = 3600) {
  if (!caminho) return null;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error) throw error;
  return data?.signedUrl || null;
}

/** O histórico de um tipo — para conferir o que gerou um bônus antigo. */
export async function versoesDoArquivo(competencia, tipo) {
  const nutriId = await organizacaoAtual();
  const { data, error } = await sb
    .from('folha_arquivos')
    .select('*')
    .eq('nutri_id', nutriId)
    .eq('competencia', competencia)
    .eq('tipo', tipo)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function traduzirErroArquivo(msg = '') {
  const m = String(msg);
  if (/arquivo_sem_competencia/.test(m)) return 'Escolha a competência antes de importar.';
  if (/arquivo_sem_tipo/.test(m)) return 'Tipo de arquivo desconhecido.';
  if (/arquivo_sem_dono/.test(m)) return 'Sessão sem organização. Entre de novo.';
  if (/espelho_sem_colaborador/.test(m)) {
    return 'Esta planilha não tem abas de colaborador. Envie o espelho de ponto em .xlsx, '
      + 'com uma aba por pessoa.';
  }
  if (/planilha_sem_presencas/.test(m)) {
    return 'A planilha abriu, mas nenhuma linha tem Cliente e Data. '
      + 'Confira se é o relatório de presenças.';
  }
  if (/arquivo_nao_e_xlsx|planilha_sem_aba/.test(m)) {
    return 'Não consegui ler este arquivo. Ele precisa ser um .xlsx.';
  }
  if (/row-level security/i.test(m)) return 'Sem permissão para guardar arquivos da folha.';
  if (/duplicate|already exists/i.test(m)) return 'Este arquivo já foi importado neste minuto.';
  return 'Não consegui guardar o arquivo. Tente de novo.';
}
