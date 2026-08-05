select p.id as pendencia_id,
       p.nome_lido,
       p.cpf_lido,
       p.competencia,
       p.nome_arquivo,
       p.caminho_storage,
       p.mime_type,
       p.tamanho_bytes,
       p.motivo,
       p.status,
       p.sugestao_id,
       f.nome as colaborador_sugerido,
       p.documento_id,
       p.resolvido_em,
       p.criado_em
  from public.documentos_pendentes p
  left join public.funcionarios f on f.id = p.sugestao_id
 order by p.criado_em desc;
