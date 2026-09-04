// ═══════════════════════════════════════════════════════════
// ARQUIVOS DA COMPETÊNCIA — as planilhas que geram o bônus
// ═══════════════════════════════════════════════════════════
// O bônus por presença sai de dois xlsx exportados de outro sistema. Um ano
// depois, "por que a Beatriz recebeu R$ 233,50 em setembro" só tem resposta se
// os arquivos que geraram o número ainda existirem — por isso eles ficam
// guardados, e por isso reimportar não apaga o anterior.
//
// ELES NÃO SÃO DE NINGUÉM. O relatório de presenças fala dos ALUNOS; o espelho
// fala da equipe inteira, uma aba por pessoa. Guardá-los em
// `colaborador_documentos`, que exige dono, faria um colaborador ver no próprio
// app o ponto dos colegas.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import { sb, tabela, limpar, falhar, chamadas } from './duble-supabase.mjs';
import { limparOrganizacao } from '../js/organizacao.js';
import { rpc } from './duble-supabase.mjs';
import {
  caminhoDoArquivoDoMes, guardarArquivoDoMes, arquivosDoMes, traduzirErroArquivo,
} from '../js/folha-arquivos.js';

const SQL = readFileSync(new URL('../db/folha_arquivos.sql', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../js/folha-ui.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/financeiro.css', import.meta.url), 'utf8');

// Pessoa e organização com UUIDs DIFERENTES: com os dois iguais — o caso do
// proprietário — todo teste de tenancy passa com o código errado.
const ORG = 'org-distinta-do-usuario';
function preparar() {
  limpar();
  limparOrganizacao();
  rpc('organizacao_do_auth', () => ORG);
}
const arquivoFake = (nome = 'presencas.xlsx') => ({
  name: nome, size: 1234, type: 'application/vnd.ms-excel',
  arrayBuffer: async () => new ArrayBuffer(8),
});
const ultima = (nome, op) => [...chamadas].reverse().find(c => c.tabela === nome && c.operacao === op);

grupo('arquivos da competência · o caminho', () => {
  const agora = new Date('2026-09-04T11:37:00Z');

  teste('a pasta 2 é `_mes`, não um colaborador', () => {
    // Nenhuma policy de leitura do colaborador casa aqui — a mesma escolha de
    // `_pendentes`. E uuid não começa com underline, então não há colisão.
    const c = caminhoDoArquivoDoMes({
      nutriId: ORG, competencia: '2026-09-01', tipo: 'presencas',
      arquivo: 'relatório de presenças.xlsx', agora,
    });
    ok(c.startsWith(`${ORG}/_mes/2026-09/`), c);
  });

  teste('o carimbo de hora evita sobrescrever a versão anterior', () => {
    // Reimportar mantém a linha antiga como histórico. Se o objeto tivesse o
    // mesmo caminho, o arquivo que gerou o bônus já pago seria substituído.
    const c = caminhoDoArquivoDoMes({
      nutriId: ORG, competencia: '2026-09-01', tipo: 'ponto', arquivo: 'x.xlsx', agora,
    });
    contem(c, 'ponto-20260904113700-');
  });

  teste('o nome do arquivo é higienizado', () => {
    // Barra criaria pasta e desalinharia o caminho inteiro.
    const c = caminhoDoArquivoDoMes({
      nutriId: ORG, competencia: '2026-09-01', tipo: 'presencas',
      arquivo: 'a/b ç.xlsx', agora,
    });
    igual(c.split('/').length, 4, 'quatro níveis: org, _mes, mês, arquivo');
    naoContem(c.split('/')[3], 'ç');
  });

  teste('recusa o que não dá para endereçar', () => {
    const erro = (args) => { try { caminhoDoArquivoDoMes(args); return null; } catch (e) { return e.message; } };
    igual(erro({ competencia: '2026-09-01', tipo: 'ponto', arquivo: 'x' }), 'arquivo_sem_dono');
    igual(erro({ nutriId: ORG, tipo: 'zzz', arquivo: 'x', competencia: '2026-09-01' }), 'arquivo_sem_tipo');
    igual(erro({ nutriId: ORG, tipo: 'ponto', arquivo: 'x', competencia: '' }), 'arquivo_sem_competencia');
  });
});

grupo('arquivos da competência · guardar', () => {
  teste('sobe o arquivo ANTES de gravar a linha', async () => {
    // Ao contrário, uma falha no upload deixaria uma linha apontando para um
    // objeto que não existe, e a tela ofereceria um download que estoura.
    preparar();
    tabela('folha_arquivos', [{ id: 'fa1' }]);
    await guardarArquivoDoMes({
      competencia: '2026-09-01', tipo: 'presencas', arquivo: arquivoFake(), resumo: { visitas: 1063 },
    });
    const upload = chamadas.findIndex(c => c.operacao === 'upload');
    const insert = chamadas.findIndex(c => c.tabela === 'folha_arquivos' && c.operacao === 'insert');
    ok(upload >= 0 && insert >= 0, 'faltou upload ou insert');
    ok(upload < insert, 'o upload tem que vir antes da linha');
  });

  teste('não escolhe o dono', async () => {
    // Mesma regra da 4C: quem determina o tenant é o banco. Um `nutri_id` vindo
    // da tela seria o uuid da PESSOA, não o da organização.
    preparar();
    tabela('folha_arquivos', [{ id: 'fa1' }]);
    await guardarArquivoDoMes({ competencia: '2026-09-01', tipo: 'ponto', arquivo: arquivoFake() });
    ok(!('nutri_id' in ultima('folha_arquivos', 'insert').payload));
  });

  teste('o resumo vai junto com a linha', async () => {
    // Sem ele, mostrar "1.063 presenças" exigiria baixar e reprocessar o xlsx
    // a cada abertura da folha.
    preparar();
    tabela('folha_arquivos', [{ id: 'fa1' }]);
    await guardarArquivoDoMes({
      competencia: '2026-09-01', tipo: 'presencas', arquivo: arquivoFake(),
      resumo: { visitas: 1063, alunos: 84 },
    });
    igual(ultima('folha_arquivos', 'insert').payload.resumo.visitas, 1063);
  });

  teste('a versão anterior só sai de cena DEPOIS de a nova entrar', async () => {
    // Se a inserção falhar no meio, o mês continua com o arquivo antigo em vez
    // de ficar sem nenhum. E o índice único é parcial, então até o update rodar
    // existem duas correntes — o insert precisa vir antes.
    preparar();
    tabela('folha_arquivos', [{ id: 'fa1' }]);
    await guardarArquivoDoMes({ competencia: '2026-09-01', tipo: 'ponto', arquivo: arquivoFake() });
    const insert = chamadas.findIndex(c => c.tabela === 'folha_arquivos' && c.operacao === 'insert');
    const update = chamadas.findIndex(c => c.tabela === 'folha_arquivos' && c.operacao === 'update');
    ok(update > insert, 'o update tem que vir depois');
    igual(ultima('folha_arquivos', 'update').payload.atual, false);
  });

  teste('upload recusado não grava linha nenhuma', async () => {
    // Linha apontando para objeto inexistente é erro na cara do usuário: a
    // tela oferece um download que estoura. Uma mutação apagou o `throw` e
    // nada quebrava — o insert corria mesmo sem o arquivo ter subido.
    preparar();
    const { falharStorage } = await import('./duble-supabase.mjs');
    falharStorage('upload', 'storage indisponivel');
    let subiu = null;
    try {
      await guardarArquivoDoMes({ competencia: '2026-09-01', tipo: 'ponto', arquivo: arquivoFake() });
    } catch (e) { subiu = e; }
    ok(subiu, 'o erro do upload tem que estourar');
    ok(!ultima('folha_arquivos', 'insert'), 'e nenhuma linha pode ter sido gravada');
  });

  teste('o update que aposenta a anterior não pega a linha nova', async () => {
    // Sem o `neq`, o update marcaria `atual = false` também na que acabou de
    // entrar, e o mês ficaria sem nenhum arquivo corrente — some da tela e o
    // bônus deixa de ser calculável.
    preparar();
    tabela('folha_arquivos', [{ id: 'fa-nova' }]);
    await guardarArquivoDoMes({ competencia: '2026-09-01', tipo: 'ponto', arquivo: arquivoFake() });
    // O `id` conferido é o da linha que o INSERT devolveu — no dublê o insert
    // ecoa o payload, que não tem id, então o teste garante a COLUNA e não o
    // valor. Quem garante o valor é o `.select().single()` do banco real.
    const up = ultima('folha_arquivos', 'update');
    ok(up.filtros.some(f => f.tipo === 'neq' && f.coluna === 'id'),
      'faltou excluir a linha recém-criada: ' + JSON.stringify(up.filtros));
  });

  teste('linha recusada limpa o objeto que já subiu', async () => {
    // Sem isto, o próximo envio esbarraria num arquivo órfão que ninguém vê.
    preparar();
    falhar('folha_arquivos', 'new row violates row-level security policy');
    let subiu = null;
    try {
      await guardarArquivoDoMes({ competencia: '2026-09-01', tipo: 'ponto', arquivo: arquivoFake() });
    } catch (e) { subiu = e; }
    ok(subiu, 'o erro tem que estourar');
    ok(chamadas.some(c => c.operacao === 'remove'), 'faltou apagar o objeto órfão');
  });

  teste('lê só os correntes do mês', async () => {
    preparar();
    tabela('folha_arquivos', [{ id: 'fa1', tipo: 'presencas' }]);
    await arquivosDoMes('2026-09-01');
    const c = ultima('folha_arquivos', 'select');
    ok(c.filtros.some(f => f.coluna === 'atual' && f.valor === true), JSON.stringify(c.filtros));
    ok(c.filtros.some(f => f.coluna === 'competencia' && f.valor === '2026-09-01'));
  });
});

grupo('arquivos da competência · o SQL', () => {
  teste('tabela própria, e o porquê está escrito', () => {
    contem(SQL, 'create table if not exists public.folha_arquivos');
    contem(SQL, 'colaborador_id not null');
    contem(SQL, 'competencia date not null');
  });

  teste('o dono vem do banco, não da tela', () => {
    contem(SQL, 'nutri_id  uuid not null default public.organizacao_do_auth()');
  });

  teste('RLS sob a mesma chave da folha', () => {
    // Quem vê estes arquivos vê o ponto da equipe inteira e a carteira de
    // alunos por tabela — a mesma exigência de `comercial_alunos_por_turno`.
    contem(SQL, 'enable row level security');
    igual((SQL.match(/tem_permissao\('equipe\.folha'\)/g) || []).length, 5,
      'select, insert e update (using + with check)');
    contem(SQL, "create policy folha_arquivos_select");
    contem(SQL, "create policy folha_arquivos_insert");
    contem(SQL, "create policy folha_arquivos_update");
  });

  teste('SEM policy de delete', () => {
    // Apagar o arquivo que gerou um bônus já pago é o tipo de coisa que
    // ninguém faz de propósito. Reimportar já resolve o caso real.
    naoContem(SQL, 'for delete');
  });

  teste('o índice único é PARCIAL, para o histórico caber ao lado', () => {
    contem(SQL, 'create unique index uniq_folha_arquivo_atual');
    contem(SQL, '(nutri_id, competencia, tipo)\n  where atual;');
  });

  teste('o desfazer avisa que os arquivos ficam', () => {
    const undo = readFileSync(new URL('../db/folha_arquivos_desfazer.sql', import.meta.url), 'utf8');
    contem(undo, 'TIRE O FRONTEND PRIMEIRO');
    contem(undo, 'drop table if exists public.folha_arquivos');
    contem(undo, 'continuam no bucket');
  });
});

grupo('arquivos da competência · a tela', () => {
  teste('a segunda zona é separada da de PDF', () => {
    // São entradas de naturezas diferentes: o PDF preenche HORAS de uma pessoa;
    // as planilhas alimentam o BÔNUS de todas. Uma zona só faria a pessoa
    // descobrir o que aconteceu depois de soltar.
    contem(UI, 'id="fpZonaXlsx"');
    contem(UI, 'accept=".xlsx"');
    contem(UI, 'Arraste as planilhas do bônus');
    contem(UI, 'id="fpZona"', 'a zona de PDF continua lá');
  });

  teste('o tipo é descoberto lendo, não pelo nome do arquivo', () => {
    // Nome de exportação muda quando o outro sistema atualiza.
    contem(UI, 'lerEspelhoDePonto(arquivo)');
    contem(UI, 'espelho_sem_colaborador');
    ok(!/name[^\n]*includes\('ponto'\)/.test(UI), 'o tipo não pode sair do nome do arquivo');
  });

  teste('o espelho é testado ANTES das presenças', () => {
    // Ele é o mais específico — exige abas com "Colaborador:". O de presenças
    // aceita quase qualquer planilha com Cliente e Data, e testado primeiro
    // engoliria o outro.
    const bloco = UI.slice(UI.indexOf('async function importarPlanilhasDoBonus'));
    ok(bloco.indexOf('lerEspelhoDePonto') < bloco.indexOf('lerPresencas('),
      'a ordem dos dois testes decide qual arquivo é qual');
  });

  teste('o bônus SUGERE, não lança sozinho', () => {
    // Mesmo desenho do bônus por turno: o número sai de planilhas exportadas
    // de outro sistema, e quem fecha a folha pode ter um motivo que elas não
    // sabem.
    contem(UI, 'data-fp-lancar-bonus');
    contem(UI, 'await confirmar({');
    const bloco = UI.slice(UI.indexOf('async function lancarBonusDePresenca'));
    ok(bloco.indexOf('confirmar(') < bloco.indexOf('adicionarAdicional('),
      'a confirmação tem que vir antes de gravar');
  });

  teste('avisa quando o bônus já foi lançado', () => {
    // Reimportar para conferir é normal. Sem esta checagem, cada conferência
    // somaria outro bônus na mesma linha.
    contem(UI, 'const repetidos = aplicaveis.filter');
    contem(UI, 'Lançar de novo soma ao que já está lá');
  });

  teste('casa a pessoa pelo CPF, não pelo nome', () => {
    // Nome bate errado — acento, sobrenome abreviado, ordem invertida.
    const bloco = UI.slice(UI.indexOf('async function lancarBonusDePresenca'));
    contem(bloco, "i.funcionario?.cpf || ''");
    contem(bloco, "replace(/\\D/g, '')");
  });

  teste('quem está no cálculo mas não na folha continua visível', () => {
    // Sumindo da lista, o valor apurado para essa pessoa sumiria com ele.
    contem(UI, 'fp-bp-sem-linha');
    contem(UI, 'não está nesta folha');
  });

  teste('a batida ímpar aparece na tela', () => {
    // Ela não entra no cálculo, e o colaborador recebe menos por um erro de
    // marcação. Sem o aviso, ninguém saberia.
    contem(UI, 'fp-bp-impares');
    contem(UI, 'Batidas sem saída não entraram no cálculo');
    contem(UI, 'está recebendo menos');
  });

  teste('falhar no bônus não derruba a folha', () => {
    // Sem o bônus a tela continua servindo para lançar horas e fechar o mês.
    const bloco = UI.slice(UI.indexOf('async function carregarArquivosDoMes'));
    contem(bloco, 'catch');
    contem(bloco, '_bonus = null');
  });

  teste('a segunda zona é mais discreta que a primeira', () => {
    // A de PDF é o trabalho de todo mês; esta é uma vez por fechamento. Duas
    // zonas com o mesmo peso fariam a tela ter duas ações principais.
    contem(CSS, '.fp-importar-xlsx');
    contem(CSS, 'background: var(--surface-subtle)');
  });
});
