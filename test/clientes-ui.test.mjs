// ═══════════════════════════════════════════════════════════
// CLIENTES — busca, filtro, ordem, cadastro e a página
// ═══════════════════════════════════════════════════════════
// O defeito que motivou a revisão (11/11/2026): "eduard" no campo e a lista
// inteira na tela — recarregar desenhava tudo ignorando a busca. Estes testes
// protegem a regra pura e a ligação da página com ela.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  normalizar, soDigitos, bateComBusca, filtrarClientes, textoContagem, validarNovoCliente,
  statusDaAnamnese, linhaHtml, tabelaHtml, vazioHtml, painelHtml, sucessoHtml, ANAMNESE,
} from '../js/clientes-ui.js';

const ler = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

const C = [
  { id: '1', nome: 'Eduardo Medani', email: 'edu@exemplo.com', telefone: '(31) 99876-5432', codigo: 'AB12CD', status: 'completo', criado_em: '2026-11-01T10:00:00Z' },
  { id: '2', nome: 'Ana Júlia Ávila', email: 'ana@exemplo.com', telefone: '31 3333-2222', codigo: 'ZZ99YY', status: 'aguardando', criado_em: '2026-11-05T10:00:00Z' },
  { id: '3', nome: 'Bruno Souza', email: null, telefone: null, codigo: 'QW34ER', status: null, criado_em: '2026-10-20T10:00:00Z' },
  { id: '4', nome: null, email: null, telefone: null, codigo: 'NN00NN', status: 'aguardando', criado_em: '2026-09-01T10:00:00Z' },
];
const ids = l => l.map(p => p.id);

grupo('clientes · a busca', () => {
  teste('sem caixa e sem acento', () => {
    igual(normalizar('  Ávila JÚLIA '), 'avila julia');
    igual(ids(filtrarClientes(C, { busca: 'EDUARD' })), ['1']);
    igual(ids(filtrarClientes(C, { busca: 'avila' })), ['2'], '"avila" acha "Ávila"');
    igual(ids(filtrarClientes(C, { busca: 'júlia' })), ['2']);
  });
  teste('por e-mail', () => {
    igual(ids(filtrarClientes(C, { busca: 'ana@exem' })), ['2']);
  });
  teste('por WhatsApp em qualquer formatação', () => {
    igual(soDigitos('(31) 99876-5432'), '31998765432');
    igual(ids(filtrarClientes(C, { busca: '99876' })), ['1']);
    igual(ids(filtrarClientes(C, { busca: '(31) 99876-5432' })), ['1']);
    igual(ids(filtrarClientes(C, { busca: '3199876 5432' })), ['1']);
    igual(ids(filtrarClientes(C, { busca: '3333-2222' })), ['2']);
  });
  teste('telefone só com 3+ dígitos (um "3" não acha meia agenda)', () => {
    ok(!bateComBusca(C[0], '3'), '1 dígito');
    ok(!bateComBusca(C[0], '31'), '2 dígitos');
    ok(bateComBusca(C[0], '319'));
  });
  teste('o código de acesso continua achando', () => {
    igual(ids(filtrarClientes(C, { busca: 'qw34' })), ['3']);
  });
  teste('busca vazia ou só espaços: todos', () => {
    igual(filtrarClientes(C, { busca: '   ' }).length, 4);
  });
  teste('cliente sem nome/e-mail/telefone não quebra', () => {
    ok(!bateComBusca(C[3], 'eduardo'));
  });
});

grupo('clientes · filtro de anamnese e ordem', () => {
  teste('status vazio conta como "aguardando" (o padrão do banco)', () => {
    igual(statusDaAnamnese({ status: null }), 'aguardando');
    igual(statusDaAnamnese({ status: 'completo' }), 'completo');
  });
  teste('filtro: aguardando e respondida', () => {
    igual(ids(filtrarClientes(C, { anamnese: 'completo' })), ['1']);
    igual(ids(filtrarClientes(C, { anamnese: 'aguardando' })), ['2', '3', '4']);
  });
  teste('ordem: mais recentes primeiro (padrão)', () => {
    igual(ids(filtrarClientes(C)), ['2', '1', '3', '4']);
  });
  teste('ordem: nome A–Z, sem acento atrapalhar, sem nome no fim', () => {
    igual(ids(filtrarClientes(C, { ordem: 'nome' })), ['2', '3', '1', '4']);
  });
  teste('busca + filtro + ordem juntos', () => {
    const extra = [...C, { id: '5', nome: 'Eduarda Lima', status: 'aguardando', codigo: 'X', criado_em: '2026-11-09T00:00:00Z' }];
    igual(ids(filtrarClientes(extra, { busca: 'eduard', anamnese: 'aguardando', ordem: 'nome' })), ['5']);
    igual(ids(filtrarClientes(extra, { busca: 'eduard', ordem: 'nome' })), ['5', '1']);
  });
  teste('não muda a lista recebida', () => {
    const copia = [...C];
    filtrarClientes(C, { ordem: 'nome' });
    igual(ids(C), ids(copia));
  });
  teste('rótulos da anamnese', () => {
    igual(ANAMNESE.aguardando.rotulo, 'Aguardando resposta');
    igual(ANAMNESE.completo.rotulo, 'Respondida');
  });
});

grupo('clientes · contagem e vazio', () => {
  teste('"X clientes" sem busca; "X resultados" com', () => {
    igual(textoContagem(12, false), '12 clientes');
    igual(textoContagem(1, false), '1 cliente');
    igual(textoContagem(3, true), '3 resultados');
    igual(textoContagem(1, true), '1 resultado');
    igual(textoContagem(0, true), '0 resultados');
  });
  teste('vazio com busca: "Nenhum cliente encontrado" + limpar', () => {
    const h = vazioHtml({ filtrando: true });
    contem(h, 'Nenhum cliente encontrado');
    contem(h, 'data-cli="limpar"');
  });
  teste('sem nenhum cliente: convite para cadastrar', () => {
    const h = vazioHtml({ filtrando: false });
    contem(h, 'data-cli="novo"');
    naoContem(h, 'Nenhum cliente encontrado');
  });
});

grupo('clientes · a linha', () => {
  const h = linhaHtml(C[0]);
  teste('nome é botão para a ficha; "Abrir ficha" secundário', () => {
    contem(h, '<button type="button" class="cli-nome" data-cli="ficha" data-id="1">Eduardo Medani</button>');
    contem(h, 'class="btn cli-abrir" data-cli="ficha"');
    contem(h, '>Abrir ficha<');
    naoContem(h, '>Ver<');
    naoContem(h, 'primary');
  });
  teste('anamnese como badge; código com copiar rotulado', () => {
    contem(h, 'Respondida');
    contem(h, '<span class="cli-codigo">AB12CD</span>');
    contem(h, 'aria-label="Copiar link da anamnese de Eduardo Medani"');
  });
  teste('app e exclusão no menu "…" acessível', () => {
    contem(h, 'aria-haspopup="menu" aria-expanded="false"');
    contem(h, 'aria-label="Mais opções para Eduardo Medani"');
    contem(h, 'role="menu" hidden');
    contem(h, 'data-cli="app"');
    contem(h, 'data-cli="excluir" data-id="1"');
    igual((h.match(/role="menuitem"/g) || []).length, 3);
  });
  teste('dado do banco é escapado', () => {
    const x = linhaHtml({ id: '"><x>', nome: '<img src=x onerror=1>', codigo: '<b>', status: 'completo' });
    naoContem(x, '<img src=x');
    naoContem(x, '<b>');
    contem(x, '&lt;img src=x onerror=1&gt;');
  });
  teste('sem nome: "(sem nome)"; sem data: sem linha de data', () => {
    const x = linhaHtml(C[3]);
    contem(x, '(sem nome)');
    contem(linhaHtml({ ...C[3], criado_em: null }), 'cli-nome');
    naoContem(linhaHtml({ ...C[3], criado_em: null }), 'Cadastrado em');
  });
  teste('tabela com cabeçalhos de coluna', () => {
    const t = tabelaHtml(C);
    for (const th of ['Cliente', 'Anamnese', 'Código de acesso']) contem(t, `<th scope="col">${th}</th>`);
    contem(t, '<span class="sr-only">Ações</span>');
  });
});

grupo('clientes · cadastro', () => {
  teste('nome obrigatório; e-mail e WhatsApp opcionais', () => {
    igual(Object.keys(validarNovoCliente({ nome: '' })), ['nome']);
    igual(Object.keys(validarNovoCliente({ nome: '  ' })), ['nome']);
    igual(validarNovoCliente({ nome: 'Ana' }), {});
  });
  teste('e-mail e WhatsApp, se vierem, precisam fazer sentido', () => {
    ok(validarNovoCliente({ nome: 'A', email: 'ana' }).email);
    ok(!validarNovoCliente({ nome: 'A', email: 'ana@x.com' }).email);
    ok(validarNovoCliente({ nome: 'A', telefone: '9999' }).telefone);
    ok(!validarNovoCliente({ nome: 'A', telefone: '(31) 99999-1234' }).telefone);
  });
  teste('painel: rótulos visíveis ligados aos campos', () => {
    const h = painelHtml();
    contem(h, '<label for="cliNovo-nome">Nome do cliente');
    contem(h, '<label for="cliNovo-email">E-mail');
    contem(h, '<label for="cliNovo-telefone">WhatsApp');
    contem(h, 'role="dialog" aria-modal="true"');
    contem(h, 'Cadastrar cliente');
  });
  teste('painel: erro fica no campo e os dados continuam', () => {
    const h = painelHtml({ form: { nome: '', email: 'x', telefone: '31' }, erros: { nome: 'Informe o nome do cliente.' } });
    contem(h, 'aria-invalid="true" aria-describedby="cliNovo-nome-erro"');
    contem(h, 'Informe o nome do cliente.');
    contem(h, 'value="x"');
  });
  teste('painel: salvando trava o botão', () => {
    const h = painelHtml({ salvando: true });
    contem(h, 'disabled aria-busy="true"');
    contem(h, 'Cadastrando…');
  });
  teste('painel: erro do servidor aparece como alerta', () => {
    contem(painelHtml({ erroGeral: 'Não foi possível cadastrar o cliente.' }), 'role="alert"');
  });
  teste('sucesso: código e as ações que existiam (link, WhatsApp, prévia)', () => {
    const h = sucessoHtml({ nome: 'Ana', codigo: 'AB12CD', link: 'https://x/anamnese.html?p=AB12CD' });
    contem(h, 'AB12CD');
    for (const a of ['copiar', 'whatsapp', 'ver', 'outro']) contem(h, `data-cli-ok="${a}"`);
  });
  teste('o módulo impede envio duplo', () => {
    contem(ler('../js/clientes-ui.js'), 'if (salvando) return;   // duplo clique / Enter repetido');
  });
});

grupo('clientes · a página (index.html)', () => {
  const html = ler('../index.html');
  const pagina = html.slice(html.indexOf('<div class="module-page" id="page-pacientes">'), html.indexOf('<!-- BIBLIOTECA DE EXERCÍCIOS'));
  teste('o formulário aberto saiu; "Novo cliente" no cabeçalho', () => {
    naoContem(pagina, 'novoPacienteNome');
    naoContem(pagina, 'novo-paciente-card');
    contem(pagina, '<h1 class="page-title">Clientes</h1>');
    contem(pagina, 'Gerencie seus clientes e acesse suas fichas.');
    contem(pagina, 'id="cliNovo"');
  });
  teste('busca com rótulo, placeholder e limpar', () => {
    contem(pagina, 'placeholder="Buscar cliente por nome, e-mail ou WhatsApp"');
    contem(pagina, '<label for="cliBusca" class="sr-only">');
    contem(pagina, 'id="cliBuscaLimpar" aria-label="Limpar busca" hidden');
    contem(pagina, 'autocomplete="off"');
  });
  teste('filtro chama-se "Status da anamnese"; ordem; contagem anunciada', () => {
    contem(pagina, 'Status da anamnese');
    contem(pagina, '<option value="recentes">Mais recentes</option>');
    contem(pagina, '<option value="nome">Nome (A–Z)</option>');
    contem(pagina, 'id="cliContagem" aria-live="polite"');
  });
  teste('recarregar NÃO ignora a busca: a lista passa pelo módulo', () => {
    contem(html, 'function renderizarPacientes(lista) {\n    definirClientes(lista);\n  }');
    naoContem(html, "document.getElementById('searchInput')");
  });
  teste('só a última carga pinta', () => {
    contem(html, 'const vez = ++_cargaClientes;');
    contem(html, 'if (vez !== _cargaClientes) return;');
  });
  teste('a busca global no menu diz o que é e mantém o atalho', () => {
    contem(html, '<span>Busca global</span> <kbd aria-hidden="true">Ctrl K</kbd>');
  });
  teste('itens do menu lateral alcançáveis pelo teclado', () => {
    contem(html, "item.setAttribute('role', 'link');");
    contem(html, "if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }");
  });
  teste('folhas carregadas', () => {
    contem(html, '<link rel="stylesheet" href="css/clientes.css">');
    contem(html, '<link rel="stylesheet" href="css/painel-lateral.css">');
  });
});
