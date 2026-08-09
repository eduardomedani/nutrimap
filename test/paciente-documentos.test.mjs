// ═══════════════════════════════════════════════════════════
// DOCUMENTOS DO PACIENTE — Etapa 1 (infraestrutura)
// ═══════════════════════════════════════════════════════════
// Duas naturezas de teste aqui, e vale saber qual é qual:
//
//   . COMPORTAMENTO — validação de arquivo, montagem de caminho, ordem do
//     upload e a compensação. Roda de verdade, contra o dublê.
//
//   . REGRA ESCRITA — RLS, policies do Storage, ACL das funções. O dublê não
//     imita o Postgres, e testar SQL contra um dublê seria testar o dublê. O
//     que dá para garantir aqui é que a regra ESTÁ NO ARQUIVO e não foi
//     afrouxada sem alguém perceber. A prova de comportamento é a sessão real:
//     db/conferencia/62_pd_isolamento_entre_pacientes.sql.
//
// O que nenhum teste substitui: rodar a migration e conferir com 62.

import { grupo, teste, ok, igual, contem, naoContem, lanca } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { limpar, tabela, falhar, falharStorage, objetos, chamadas } from './duble-supabase.mjs';
import {
  detectarMimeReal, validarArquivo, nomeSeguro, caminhoDoDocumento, anoDoDocumento,
  TAMANHO_MAXIMO, MIMES_ACEITOS, BUCKET, EXPIRACAO_PADRAO, urlAssinada,
} from '../js/paciente-documentos-storage.js';
import {
  criarDocumento, disponibilizar, removerDoApp, arquivarDocumento,
  editarInformacoes, marcarVisualizado, ehNovo, formatarTamanho,
  formatoDoDocumento, traduzirErroDocumento, TIPOS, STATUS, ORIGENS,
} from '../js/paciente-documentos.js';

const sql        = readFileSync(new URL('../db/paciente_documentos.sql', import.meta.url), 'utf8');
const desfazer   = readFileSync(new URL('../db/paciente_documentos_desfazer.sql', import.meta.url), 'utf8');
// Só o corpo executável: os comentários explicam o que NÃO entra e citam os
// nomes das coisas proibidas de propósito.
const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const NUTRI = '11111111-1111-1111-1111-111111111111';
const PAC   = '22222222-2222-2222-2222-222222222222';

// Arquivos de mentira com assinatura de verdade — é o byte que o serviço lê.
const PDF  = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const PNG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const HTML = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50];   // <!DOCTYP

const arquivo = (bytes, nome = 'exame.pdf', tipo = 'application/pdf', enche = 0) => {
  const corpo = enche ? [new Uint8Array(bytes), new Uint8Array(enche)] : [new Uint8Array(bytes)];
  return new File(corpo, nome, { type: tipo });
};


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · o arquivo é conferido pelo conteúdo', () => {

  teste('a assinatura manda, não a extensão', () => {
    igual(detectarMimeReal(new Uint8Array(PDF)),  'application/pdf');
    igual(detectarMimeReal(new Uint8Array(PNG)),  'image/png');
    igual(detectarMimeReal(new Uint8Array(JPEG)), 'image/jpeg');
    igual(detectarMimeReal(new Uint8Array(HTML)), null);
    igual(detectarMimeReal(new Uint8Array([])),   null);
  });

  teste('os três formatos da etapa, e só eles', () => {
    igual(MIMES_ACEITOS, ['application/pdf', 'image/jpeg', 'image/png']);
    // DOCX e HTML ficaram de fora de propósito — a lista tem que bater com o
    // allowed_mime_types do bucket, senão o erro vem cru do Supabase.
    contem(codigo, "array['application/pdf', 'image/jpeg', 'image/png']");
  });

  teste('renomear .exe para .pdf não engana', async () => {
    const falso = arquivo(HTML, 'exame.pdf', 'application/pdf');
    const e = await lanca(() => validarArquivo(falso));
    igual(e.message, 'documento_tipo_nao_aceito');
  });

  teste('o mime gravado é o real, não o declarado', async () => {
    // Navegador manda 'image/jpg', sistema manda vazio. O conteúdo decide.
    const r = await validarArquivo(arquivo(JPEG, 'foto.jpeg', 'image/jpg'));
    igual(r.mimeType, 'image/jpeg');
    ok(r.suspeito, 'divergência entre declarado e real fica registrada');
  });

  teste('arquivo acima de 15 MB é recusado antes de subir', async () => {
    const grande = arquivo(PDF, 'gordo.pdf', 'application/pdf', TAMANHO_MAXIMO);
    const e = await lanca(() => validarArquivo(grande));
    igual(e.message, 'documento_grande_demais');
    igual(TAMANHO_MAXIMO, 15 * 1024 * 1024);
    contem(codigo, '15728640', 'o mesmo teto tem que estar no bucket');
  });

  teste('arquivo vazio e ausência de arquivo têm erro próprio', async () => {
    igual((await lanca(() => validarArquivo(new File([], 'x.pdf')))).message, 'documento_vazio');
    igual((await lanca(() => validarArquivo(null))).message, 'documento_sem_arquivo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · o caminho no Storage', () => {

  teste('as quatro pastas, na ordem que as policies leem', () => {
    const c = caminhoDoDocumento({
      nutriId: NUTRI, pacienteId: PAC, documentoId: 'doc-1', ano: '2026', arquivo: 'exame.pdf',
    });
    igual(c, `${NUTRI}/${PAC}/2026/doc-1/exame.pdf`);
    // Pasta 1 = conta (policy do nutri); pasta 2 = paciente (policy do PWA).
    contem(codigo, '(storage.foldername(name))[1] = auth.uid()::text');
    contem(codigo, '(storage.foldername(name))[2] = public.paciente_do_auth()::text');
  });

  teste('o id do documento entra no caminho — substituir não sobrescreve', () => {
    const a = caminhoDoDocumento({ nutriId: NUTRI, pacienteId: PAC, documentoId: 'd1', ano: '2026', arquivo: 'e.pdf' });
    const b = caminhoDoDocumento({ nutriId: NUTRI, pacienteId: PAC, documentoId: 'd2', ano: '2026', arquivo: 'e.pdf' });
    ok(a !== b, 'mesmo nome, documentos diferentes, caminhos diferentes');
  });

  teste('sem dono, sem id ou sem ano não monta caminho', () => {
    const base = { nutriId: NUTRI, pacienteId: PAC, documentoId: 'd1', ano: '2026', arquivo: 'e.pdf' };
    for (const [campo, erro] of [['nutriId', 'documento_sem_dono'], ['pacienteId', 'documento_sem_dono'],
                                 ['documentoId', 'documento_sem_id'], ['ano', 'documento_sem_ano']]) {
      let lancou = null;
      try { caminhoDoDocumento({ ...base, [campo]: null }); } catch (e) { lancou = e.message; }
      igual(lancou, erro, `faltar ${campo} tem que barrar`);
    }
  });

  teste('barra no nome não cria pasta a mais', () => {
    igual(nomeSeguro('../../etc/passwd'), 'etc-passwd');
    igual(nomeSeguro('exame de sangue (agosto).pdf'), 'exame-de-sangue-agosto-.pdf');
    igual(nomeSeguro('  '), 'documento');
  });

  teste('o ano é o do documento, não o do upload', () => {
    // Exame de março enviado em agosto pertence à pasta do exame.
    igual(anoDoDocumento('2025-03-14', new Date('2026-08-08')), '2025');
    igual(anoDoDocumento(null, new Date('2026-08-08')), '2026');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · criar, e o que não pode acontecer', () => {

  const criar = (extra = {}) => criarDocumento({
    nutriId: NUTRI, pacienteId: PAC, arquivo: arquivo(PDF),
    titulo: 'Exames laboratoriais', tipo: 'exame', ...extra,
  });

  teste('nasce PRIVADO — upload não publica', async () => {
    limpar();
    const doc = await criar();
    igual(doc.visivel_paciente, false, 'prontuário não publica sozinho');
    igual(doc.disponibilizado_em, undefined, 'sem carimbo de disponibilização');
    igual(doc.status, 'ativo');
    igual(doc.origem, 'upload_profissional');
    // E não há como pedir o contrário: o parâmetro não existe.
    const doc2 = await criarDocumento({
      nutriId: NUTRI, pacienteId: PAC, arquivo: arquivo(PDF, 'b.pdf'),
      titulo: 'B', tipo: 'exame', visivel_paciente: true, visivelPaciente: true,
    });
    igual(doc2.visivel_paciente, false, 'mandar o campo na chamada não publica');
  });

  teste('o default também está no banco, não só no serviço', () => {
    contem(codigo, 'visivel_paciente   boolean not null default false');
  });

  teste('o arquivo sobe ANTES de existir linha', async () => {
    limpar();
    await criar();
    const ordem = chamadas.filter(c => ['upload', 'insert'].includes(c.operacao)).map(c => c.operacao);
    igual(ordem, ['upload', 'insert'], 'linha "disponível" apontando para nada é o que isso evita');
  });

  teste('COMPENSAÇÃO: banco falha depois do upload, o arquivo sai', async () => {
    limpar();
    falhar('paciente_documentos', 'boom no insert');
    const e = await lanca(() => criar());
    igual(e.message, 'boom no insert');
    igual(objetos(BUCKET), [], 'nenhum arquivo órfão no bucket');
    ok(chamadas.some(c => c.operacao === 'remove'), 'a limpeza foi chamada');
  });

  teste('se a limpeza também falhar, o caminho vem no erro', async () => {
    limpar();
    falhar('paciente_documentos', 'boom');
    falharStorage('remove', 'rede caiu');
    const e = await lanca(() => criar());
    ok(e.arquivoOrfao, 'o caminho que ficou tem que voltar, para dar pra limpar depois');
    contem(e.arquivoOrfao, `${NUTRI}/${PAC}/`);
  });

  teste('upload falha: nenhuma linha é criada', async () => {
    limpar();
    falharStorage('upload', 'sem espaço');
    await lanca(() => criar());
    ok(!chamadas.some(c => c.operacao === 'insert'), 'documento não pode existir sem arquivo');
  });

  teste('arquivo inválido morre antes de gastar rede', async () => {
    limpar();
    await lanca(() => criar({ arquivo: arquivo(HTML, 'x.pdf') }));
    igual(chamadas.filter(c => c.operacao === 'upload').length, 0);
  });

  teste('título e tipo são obrigatórios, e o tipo é da lista', async () => {
    limpar();
    igual((await lanca(() => criar({ titulo: '   ' }))).message, 'documento_sem_titulo');
    igual((await lanca(() => criar({ tipo: 'inventado' }))).message, 'documento_tipo_invalido');
  });

  teste('o nome original é preservado; o saneado vai para o Storage', async () => {
    limpar();
    const doc = await criar({ arquivo: arquivo(PDF, 'Exame de Sangue — Agosto.pdf') });
    igual(doc.nome_arquivo, 'Exame de Sangue — Agosto.pdf');
    contem(doc.caminho_storage, 'Exame-de-Sangue-Agosto.pdf');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · visibilidade e ciclo de vida', () => {

  teste('disponibilizar carimba a data; remover do app não a apaga', async () => {
    limpar();
    const pub = chamadas.length;
    await disponibilizar('doc-1');
    const up = chamadas[pub];
    igual(up.payload.visivel_paciente, true);
    ok(up.payload.disponibilizado_em, 'sem data, o CHECK do banco recusa');

    limpar();
    await removerDoApp('doc-1');
    const rem = chamadas.find(c => c.operacao === 'update');
    igual(rem.payload.visivel_paciente, false);
    ok(!('disponibilizado_em' in rem.payload),
       'o paciente TEVE acesso — apagar a data apagaria a auditoria');
  });

  teste('arquivar tira do app e preserva o arquivo', async () => {
    limpar();
    await arquivarDocumento('doc-1');
    const up = chamadas.find(c => c.operacao === 'update');
    igual(up.payload.status, 'arquivado');
    igual(up.payload.visivel_paciente, false);
    ok(up.payload.arquivado_em, 'a data do arquivamento entra');
    ok(!chamadas.some(c => c.operacao === 'remove'), 'arquivar NÃO apaga arquivo');
  });

  teste('editar informações não troca o arquivo', async () => {
    limpar();
    await editarInformacoes('doc-1', { titulo: 'Novo', tipo: 'laudo' });
    const up = chamadas.find(c => c.operacao === 'update');
    ok(!('caminho_storage' in up.payload), 'trocar arquivo é substituirArquivo(), que versiona');
    ok(!('mime_type' in up.payload));
  });

  teste('o banco impede as duas contradições', () => {
    // Visível sem data, e visível estando arquivado.
    contem(codigo, 'check (not visivel_paciente or disponibilizado_em is not null)');
    contem(codigo, 'check (arquivado_em is null or not visivel_paciente)');
  });

  teste('os três conceitos são colunas diferentes', () => {
    contem(codigo, "check (status in ('ativo', 'arquivado'))");
    contem(codigo, 'visivel_paciente');
    contem(codigo, 'visualizado_pelo_paciente');
    // "disponivel" como STATUS foi o que o módulo do colaborador fez. Aqui não.
    ok(!/check \(status in \([^)]*disponivel/.test(codigo),
       'disponibilidade é permissão, não status do arquivo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · RLS e isolamento (regra escrita)', () => {

  teste('a tabela tem RLS ligada', () => {
    contem(codigo, 'alter table public.paciente_documentos enable row level security;');
    contem(codigo, 'alter table public.paciente_documento_auditoria enable row level security;');
  });

  teste('nutri_id e paciente_id são obrigatórios', () => {
    contem(codigo, 'nutri_id    uuid not null');
    contem(codigo, 'paciente_id uuid not null');
    // restrict: apagar paciente com documento deixaria arquivo órfão no bucket.
    contem(codigo, 'references public.pacientes(id) on delete restrict');
  });

  teste('o profissional só enxerga o que é dele', () => {
    const p = codigo.slice(codigo.indexOf('create policy pd_nutri_select'));
    contem(p.slice(0, 200), 'nutri_id = auth.uid()');
  });

  teste('não dá para gravar no prontuário de paciente alheio', () => {
    // `nutri_id = auth.uid()` sozinho deixaria passar: bastaria mandar o
    // paciente_id de outro profissional.
    const p = codigo.slice(codigo.indexOf('create policy pd_nutri_insert'));
    const corpo = p.slice(0, p.indexOf(';') + 1);
    contem(corpo, 'from public.pacientes p');
    contem(corpo, 'p.id = paciente_id and p.nutri_id = auth.uid()');
  });

  teste('o paciente só lê o que foi disponibilizado a ele', () => {
    const p = codigo.slice(codigo.indexOf('create policy pd_paciente_select'));
    const corpo = p.slice(0, p.indexOf(';') + 1);
    contem(corpo, 'for select to authenticated', 'select e nada mais');
    contem(corpo, 'paciente_id = public.paciente_do_auth()');
    contem(corpo, 'visivel_paciente');
    contem(corpo, 'arquivado_em is null');
  });

  teste('o paciente não tem NENHUMA policy de escrita', () => {
    for (const cmd of ['insert', 'update', 'delete']) {
      ok(!new RegExp(`create policy pd_paciente_${cmd}`).test(codigo),
         `pd_paciente_${cmd} não pode existir`);
    }
  });

  teste('o vínculo auth→paciente é o consolidado, não um novo', () => {
    contem(codigo, 'public.paciente_do_auth()');
    ok(!/create or replace function public\.paciente_do_auth/.test(codigo),
       'a função já existe em paciente_login_schema.sql — redefinir é criar um segundo vínculo');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · Storage (regra escrita)', () => {

  teste('o bucket nasce privado', () => {
    contem(codigo, "'paciente-documentos'");
    contem(codigo, 'false,                                    -- NUNCA true');
    ok(!/values \([^)]*'paciente-documentos'[^)]*,\s*true/.test(codigo), 'nada de public = true');
    // Re-execução não pode reabrir o bucket.
    contem(codigo, 'set public             = false');
  });

  teste('o teto e os MIME também valem no bucket, não só no JavaScript', () => {
    contem(codigo, 'file_size_limit');
    contem(codigo, 'allowed_mime_types');
    ok(!codigo.includes("'text/html'"), 'HTML não é formato de documento de paciente nesta etapa');
  });

  teste('a leitura do paciente confere a TABELA, não só a pasta', () => {
    // Só a pasta deixaria abrir arquivo de upload interrompido, que mora na
    // árvore certa e não tem registro válido.
    const p = codigo.slice(codigo.indexOf('create policy pd_storage_paciente'));
    const corpo = p.slice(0, p.indexOf(';') + 1);
    contem(corpo, 'for select to authenticated');
    contem(corpo, 'public.documento_do_paciente_e_meu(name)');
    ok(!/for all/.test(corpo), 'o paciente não escreve no bucket');
  });

  teste('a função do storage confere caminho exato e as três condições', () => {
    const f = codigo.slice(codigo.indexOf('function public.documento_do_paciente_e_meu'));
    const corpo = f.slice(0, f.indexOf('$$;') + 3);
    contem(corpo, 'd.caminho_storage = p_caminho', 'caminho exato, não prefixo');
    contem(corpo, 'd.paciente_id = public.paciente_do_auth()');
    contem(corpo, 'd.visivel_paciente');
    contem(corpo, 'd.arquivado_em is null');
    contem(corpo, 'security definer');
    ok(!/like|ilike|position|starts_with/.test(corpo), 'comparação por prefixo abriria a árvore inteira');
  });

  teste('URL assinada: gerada na hora, prazo curto, nunca guardada', async () => {
    limpar();
    igual(EXPIRACAO_PADRAO, 600, '10 minutos');
    ok(EXPIRACAO_PADRAO <= 15 * 60, 'prazo curto — assinatura não consulta RLS depois de emitida');
    const url = await urlAssinada('a/b/c.pdf');
    contem(url, 'a/b/c.pdf');
    const fonte = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
    const storage = readFileSync(new URL('../js/paciente-documentos-storage.js', import.meta.url), 'utf8');
    for (const f of [fonte, storage]) {
      ok(!/getPublicUrl/.test(f), 'bucket é privado — nada de URL pública');
      ok(!/signed_url|url_assinada:|signedUrl:/.test(f), 'assinada não vira coluna');
    }
    ok(!/signed|url_assinada/.test(codigo), 'nem coluna no banco para guardar assinatura');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · a RPC de visualização', () => {

  teste('é o único caminho de escrita do paciente', async () => {
    limpar();
    await marcarVisualizado('doc-1');
    const c = chamadas.find(x => x.operacao === 'rpc');
    igual(c.nome, 'marcar_documento_paciente_visualizado');
    igual(c.payload, { p_documento: 'doc-1' });
    const fonte = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
    const pwa = fonte.slice(fonte.indexOf('PWA DO PACIENTE'));
    ok(!/\.update\(/.test(pwa), 'o PWA não faz update — teria como se autopublicar');
  });

  teste('valida dono, visibilidade e arquivamento antes de escrever', () => {
    const f = codigo.slice(codigo.indexOf('function public.marcar_documento_paciente_visualizado'));
    const corpo = f.slice(0, f.indexOf('$fn$;') + 5);
    contem(corpo, 'v_eu := public.paciente_do_auth()');
    contem(corpo, 'paciente_id = v_eu');
    contem(corpo, 'and visivel_paciente');
    contem(corpo, 'and arquivado_em is null');
    // Só os campos de leitura. Se tocasse em visivel_paciente, seria o UPDATE
    // genérico entrando pela porta dos fundos.
    //
    // A checagem é só no SET: no WHERE, `status = 'ativo'` e
    // `visivel_paciente` são FILTRO — é justamente o que restringe a linha.
    const escrita = corpo.slice(corpo.indexOf('set visualizado_pelo_paciente'), corpo.indexOf('where id ='));
    for (const proibido of ['visivel_paciente =', 'caminho_storage =', 'status =',
                            'nutri_id =', 'paciente_id =', 'arquivado_em =']) {
      ok(!escrita.includes(proibido), `a RPC não pode escrever em ${proibido}`);
    }
    for (const permitido of ['visualizado_pelo_paciente = true', 'visualizado_em =',
                             'metadata =', 'atualizado_em =']) {
      contem(escrita, permitido);
    }
  });

  teste('a primeira visualização não se sobrescreve', () => {
    contem(codigo, 'visualizado_em = coalesce(visualizado_em, now())');
    // As aberturas seguintes viram contador, sem coluna nova.
    contem(codigo, "jsonb_set(\n           metadata, '{acessos}'");
  });

  teste('sessão sem paciente devolve false, não erro', () => {
    const f = codigo.slice(codigo.indexOf('function public.marcar_documento_paciente_visualizado'));
    contem(f.slice(0, 900), 'if v_eu is null then\n    return false;');
  });

  teste('"Novo" é documento disponível e não aberto', () => {
    ok(ehNovo({ visualizado_pelo_paciente: false }));
    ok(!ehNovo({ visualizado_pelo_paciente: true }));
    ok(!ehNovo(null));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · ACL das funções', () => {

  teste('PUBLIC não executa nenhuma das funções novas', () => {
    // O hardening de 07/08 tirou EXECUTE de PUBLIC nas 77 funções do schema.
    // Função nova nasce com o grant de volta, por default do Postgres.
    for (const f of ['public.documento_do_paciente_e_meu(text)',
                     'public.marcar_documento_paciente_visualizado(uuid)',
                     'public.registrar_auditoria_documento_paciente()',
                     'public.tocar_paciente_documento()']) {
      contem(codigo, `revoke all on function ${f} from public;`);
    }
  });

  teste('e anon também não — sem depender de default privilege', () => {
    // Foi exatamente isto que faltou na primeira aplicação: `revoke from
    // public` não tira o grant DIRETO que o Supabase concede a `anon` por
    // default privilege do schema. As funções nasciam abertas à anon-key, que
    // vive no JavaScript do site.
    for (const f of ['public.documento_do_paciente_e_meu(text)',
                     'public.marcar_documento_paciente_visualizado(uuid)',
                     'public.registrar_auditoria_documento_paciente()',
                     'public.tocar_paciente_documento()']) {
      contem(codigo, `revoke all on function ${f} from anon;`);
    }
  });

  teste('função de gatilho não recebe grant nenhum', () => {
    // Ninguém as chama direto; o Postgres só exige EXECUTE em CREATE TRIGGER,
    // que roda como dono. `authenticated` ali seria privilégio sem uso.
    for (const f of ['public.registrar_auditoria_documento_paciente()',
                     'public.tocar_paciente_documento()']) {
      contem(codigo, `revoke all on function ${f} from authenticated;`);
      ok(!codigo.includes(`grant execute on function ${f}`),
         `${f} é gatilho — não precisa de EXECUTE para ninguém`);
    }
  });

  teste('o revoke vem ANTES do grant', () => {
    for (const f of ['public.documento_do_paciente_e_meu(text)',
                     'public.marcar_documento_paciente_visualizado(uuid)']) {
      const r = codigo.indexOf(`revoke all on function ${f} from public;`);
      const g = codigo.indexOf(`grant execute on function ${f} to authenticated;`);
      ok(r > -1 && g > -1 && r < g, `ordem errada em ${f} — o revoke apagaria o grant`);
    }
  });

  teste('as funções definer fixam search_path', () => {
    // Sem isso, um schema no caminho do chamador sequestra as tabelas que a
    // função definer lê.
    const definers = codigo.split('security definer').length - 1;
    const paths = codigo.split('set search_path = public').length - 1;
    ok(paths >= definers, `${definers} funções definer para ${paths} search_path fixos`);
  });

  teste('anon não entra em lugar nenhum', () => {
    ok(!/to anon/.test(codigo), 'a anon-key vive no JavaScript do site');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · auditoria e exclusão', () => {

  teste('quem escreve o log é o gatilho, não a tela', () => {
    contem(codigo, 'create trigger trg_auditoria_documento_paciente');
    contem(codigo, 'after insert or update or delete on public.paciente_documentos');
    const fonte = readFileSync(new URL('../js/paciente-documentos.js', import.meta.url), 'utf8');
    ok(!/from\('paciente_documento_auditoria'\)\s*\.insert/.test(fonte),
       'insert espalhado pela tela é esquecido no primeiro caminho novo');
  });

  teste('ninguém edita o próprio log', () => {
    const p = codigo.slice(codigo.indexOf('paciente_documento_auditoria enable row level security'));
    ok(!/create policy pda_\w*_(insert|update|delete)/.test(p), 'só o gatilho escreve');
    contem(p, 'create policy pda_nutri_select');
  });

  teste('as ações que importam viram registro', () => {
    for (const acao of ['documento_criado', 'documento_disponibilizado',
                        'documento_removido_do_app', 'documento_visualizado_pelo_paciente',
                        'documento_arquivado', 'arquivo_substituido',
                        'informacoes_editadas', 'documento_excluido']) {
      contem(codigo, `'${acao}'`);
    }
  });

  teste('a exclusão registra ANTES de a linha sumir', () => {
    const t = codigo.slice(codigo.indexOf("elsif tg_op = 'DELETE'"));
    const antes = t.indexOf('insert into public.paciente_documento_auditoria');
    const ret = t.indexOf('return old;');
    ok(antes > -1 && antes < ret, 'depois do return não há mais linha para ler o caminho');
    contem(t.slice(0, 600), "'caminho', old.caminho_storage");
  });

  teste('excluir apaga o registro primeiro e o arquivo depois', async () => {
    limpar();
    tabela('paciente_documentos', [{ id: 'doc-1', caminho_storage: 'n/p/2026/doc-1/e.pdf' }]);
    const { excluirDocumento } = await import('../js/paciente-documentos.js');
    await excluirDocumento('doc-1');
    const ordem = chamadas.filter(c => ['delete', 'remove'].includes(c.operacao)).map(c => c.operacao);
    igual(ordem, ['delete', 'remove'],
          'ao contrário, uma falha deixaria linha viva apontando para arquivo que não existe');
  });

  teste('um caminho no Storage pertence a um documento só', () => {
    contem(codigo, 'create unique index if not exists uniq_pd_caminho');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · a migration e o desfazer', () => {

  teste('é re-executável', () => {
    igual(codigo.split('create table').length - 1,
          codigo.split('create table if not exists').length - 1,
          'toda tabela com if not exists');
    for (const p of ['pd_nutri_select', 'pd_paciente_select', 'pd_storage_nutri', 'pd_storage_paciente']) {
      contem(codigo, `drop policy if exists ${p}`);
    }
    contem(codigo, 'on conflict (id) do update', 'rodar duas vezes não duplica o bucket');
  });

  teste('o desfazer existe e é o par desta migration', () => {
    for (const p of ['pd_storage_nutri', 'pd_storage_paciente', 'pd_nutri_select', 'pd_paciente_select']) {
      contem(desfazer, `drop policy if exists ${p}`);
    }
    contem(desfazer, 'drop function if exists public.documento_do_paciente_e_meu(text);');
    contem(desfazer, 'drop table if exists public.paciente_documentos;');
  });

  teste('o desfazer NÃO apaga arquivo de paciente sozinho', () => {
    // Exame apagado não volta. Os comandos destrutivos ficam comentados.
    const vivo = desfazer.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    ok(!/delete from storage\.objects/.test(vivo), 'apagar exame por rollback de schema, não');
    ok(!/drop table if exists public\.paciente_documento_auditoria/.test(vivo),
       'o log de quem viu o quê sobrevive ao schema');
    contem(desfazer, '-- delete from storage.objects');
  });

  teste('a flag do Hub só ligou porque a tela existe', () => {
    // A regra do topo de paciente-modulos.js: "um módulo só aparece quando
    // está REALMENTE funcional". A flag virou na Etapa 2, e este teste é o que
    // impede ela de voltar a ser promessa — se a aba sumir do dispatch, a flag
    // ligada passa a ser aba cinza dentro do prontuário.
    const mod = readFileSync(new URL('../js/paciente-modulos.js', import.meta.url), 'utf8');
    const ficha = readFileSync(new URL('../js/ficha.js', import.meta.url), 'utf8');
    ok(/documentos:\s*true/.test(mod), 'a fundação está de pé');
    contem(ficha, "if (abaId === 'documentos')", 'a aba tem que ter quem a renderize');
    contem(ficha, "import('./paciente-documentos-ui.js')");
  });
});


// ═══════════════════════════════════════════════════════════
grupo('documentos do paciente · o que a tela recebe', () => {

  teste('os onze tipos, e o CHECK do banco aceita todos', () => {
    igual(Object.keys(TIPOS).length, 11);
    for (const t of Object.keys(TIPOS)) contem(codigo, `'${t}'`);
  });

  teste('origem já prevê o documento gerado pelo sistema', () => {
    igual(Object.keys(ORIGENS), ['upload_profissional', 'gerado_sistema']);
    contem(codigo, "check (origem in ('upload_profissional', 'gerado_sistema'))");
  });

  teste('status é só o ciclo de vida do arquivo', () => {
    igual(Object.keys(STATUS), ['ativo', 'arquivado']);
  });

  teste('tamanho em unidade legível', () => {
    igual(formatarTamanho(2516582), '2,4 MB');
    igual(formatarTamanho(860160), '840 KB');
    igual(formatarTamanho(0), '');
    igual(formatarTamanho(null), '');
  });

  teste('a tela pergunta capacidade, não formato', () => {
    igual(formatoDoDocumento({ mime_type: 'image/png' }).ehImagem, true);
    igual(formatoDoDocumento({ mime_type: 'application/pdf' }).ehImagem, false);
    igual(formatoDoDocumento({ mime_type: 'image/jpeg' }).rotuloAbrir, 'Ver imagem');
  });

  teste('cada falha vira frase de gente, sem erro cru do Supabase', () => {
    igual(traduzirErroDocumento('documento_grande_demais'), 'O arquivo passa de 15 MB. Envie um menor.');
    igual(traduzirErroDocumento('documento_tipo_nao_aceito'), 'Formato não aceito. Envie PDF, JPG ou PNG.');
    contem(traduzirErroDocumento('new row violates row-level security policy'), 'Sem permissão');
    contem(traduzirErroDocumento('Bucket not found'), 'db/paciente_documentos.sql');
    // Nada de vazar a mensagem original.
    naoContem(traduzirErroDocumento('duplicate key value violates unique constraint "x"'), 'constraint');
  });
});
