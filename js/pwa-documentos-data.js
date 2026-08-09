// ═══════════════════════════════════════════════════════════
// PWA · DOCUMENTOS — as contas da tela
// ═══════════════════════════════════════════════════════════
// Funções puras: recebem dado, devolvem dado. Nada de rede, nada de DOM — é o
// que deixa a tela testável sem navegador e sem Supabase, como em
// pwa-inicio-data.js.
//
// A LEITURA SEGURA NÃO MORA AQUI, e é de propósito: quem filtra documento
// privado é o RLS (policy pd_paciente_select), não este arquivo. Se a
// filtragem fosse daqui, bastaria um bug de renderização para vazar um exame
// que o profissional não publicou. O que chega a estas funções JÁ passou pelo
// banco — e o que o banco não deixa passar, nenhuma delas pode reintroduzir.

import { TIPOS, formatarTamanho, formatoDoDocumento, ehNovo } from './paciente-documentos.js';

const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
             'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "8 de agosto de 2026" — por extenso, que é como o paciente lê uma data. */
export function dataPorExtenso(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [a, m, d] = s.split('-');
  return `${Number(d)} de ${MES[Number(m) - 1]} de ${a}`;
}

/**
 * Um documento pronto para o cartão.
 *
 * O nome técnico do arquivo NÃO entra: "8f2c-exame-sangue.pdf" não diz nada a
 * quem já está lendo "Exames laboratoriais". Caminho, UUID, nutri_id e
 * paciente_id também não — nenhum deles é informação de tela.
 */
export function paraCartao(doc) {
  if (!doc) return null;
  const t = TIPOS[doc.tipo] || TIPOS.outro;
  const f = formatoDoDocumento(doc);
  return {
    id: doc.id,
    titulo: doc.titulo || 'Documento',
    tipo: t.rotulo,
    // Ícone pelo FORMATO, não pelo tipo clínico: no app do paciente o que
    // importa é "isto abre como documento ou como imagem".
    icone: f.ehImagem ? 'image' : 'file-text',
    ehImagem: f.ehImagem,
    formato: f.ehImagem ? 'Imagem' : 'PDF',
    tamanho: formatarTamanho(doc.tamanho_bytes),
    // A data do documento é a que interessa; a de disponibilização é o
    // desempate para quem não preencheu aquela.
    data: dataPorExtenso(doc.data_documento || doc.disponibilizado_em),
    novo: ehNovo(doc),
  };
}

/** Mais recente primeiro. Data do documento manda; disponibilização desempata. */
export function ordenar(docs = []) {
  const chave = (d) => String(d.data_documento || '').slice(0, 10)
                    || String(d.disponibilizado_em || '').slice(0, 10);
  return [...docs].sort((a, b) => chave(b).localeCompare(chave(a)));
}

/**
 * Agrupa por ano — mas só quando isso melhora a leitura.
 *
 * Com todos os documentos do mesmo ano, o título "2026" repetido uma vez sobre
 * a lista inteira não informa nada e rouba uma linha. Aí devolvemos um grupo
 * sem rótulo, e a tela desenha a lista corrida.
 */
export function agruparPorAno(docs = []) {
  const ordenados = ordenar(docs);
  const anos = new Map();
  for (const d of ordenados) {
    const ano = String(d.data_documento || d.disponibilizado_em || '').slice(0, 4) || '—';
    if (!anos.has(ano)) anos.set(ano, []);
    anos.get(ano).push(d);
  }
  if (anos.size <= 1) return [{ ano: null, itens: ordenados }];
  return [...anos.entries()].map(([ano, itens]) => ({ ano, itens }));
}

/**
 * O que o Dashboard precisa saber, de UMA leitura.
 *
 * Não faz consulta por documento: recebe a lista que a tela já carregou e
 * conta. Uma consulta por cartão seria N idas à rede para mostrar um número.
 */
export function resumoParaInicio(docs = []) {
  const novos = docs.filter(ehNovo);
  return {
    total: docs.length,
    novos: novos.length,
    // Um título quando é um só; a contagem quando são vários. Cinco títulos no
    // Dashboard viram uma segunda tela de documentos dentro do Início.
    titulo: novos.length === 1 ? (novos[0].titulo || 'Documento') : null,
  };
}
