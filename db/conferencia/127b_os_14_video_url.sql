-- ===========================================================================
-- 127b · O QUE HA HOJE EM video_url
-- ---------------------------------------------------------------------------
-- NAO ALTERA NADA. So le.
--
-- Os 14 sao URLs externas de clipe gratuito: nao estao em disco nosso e nao se
-- reconstroem. A migracao tem que preserva-los, e para isso precisa saber
-- exatamente quais sao e de onde vem.
-- ===========================================================================
select e.nome,
       e.grupo_muscular,
       split_part(replace(replace(e.video_url, 'https://', ''), 'http://', ''), '/', 1)
                                                  as dominio,
       e.video_url
from public.exercicios e
where e.video_url is not null and e.video_url <> ''
order by e.nome;
