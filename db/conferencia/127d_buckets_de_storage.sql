-- ===========================================================================
-- 127d · OS BUCKETS QUE JA EXISTEM
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Decide se o MP4 vai para bucket novo ou existente, e se precisa ser publico:
-- o aluno ve a animacao em fluxos onde nem sempre ha sessao autenticada.
--
-- SE DER ERRO DE PERMISSAO, nao insista: `storage.buckets` nem sempre e
-- legivel pelo papel do SQL Editor, e a mesma informacao esta no painel
-- Storage do Supabase. Me mande o texto do erro.
-- ===========================================================================
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
order by name;
