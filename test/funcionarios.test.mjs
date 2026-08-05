// Financeiro · cadastro de funcionários.
//
// O que este arquivo protege: o CPF é a chave da pessoa no módulo financeiro.
// Se ele entrar formatado, entrar errado ou entrar vazio como string, a mesma
// pessoa passa a caber duas vezes na folha — e o erro só aparece no pagamento.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

import {
  soDigitos, formatarCPF, cpfValido, formatarTelefone, formatarCEP,
  enderecoResumido, normalizarFuncionario, validarFuncionario,
  traduzirErroFuncionario, SEXOS,
} from '../js/funcionarios.js';

grupo('funcionarios · CPF', () => {
  teste('formata os 11 dígitos e deixa o resto passar', () => {
    igual(formatarCPF('11144477735'), '111.444.777-35');
    igual(formatarCPF('111.444.777-35'), '111.444.777-35');
    igual(formatarCPF('123'), '123');
    igual(formatarCPF(null), '');
  });

  teste('confere os dígitos verificadores', () => {
    ok(cpfValido('111.444.777-35'), 'CPF válido devia passar');
    ok(!cpfValido('111.444.777-36'), 'último dígito trocado devia falhar');
    ok(!cpfValido('12345678901'), 'sequência qualquer não é CPF');
  });

  teste('sequência repetida não passa', () => {
    // 111.111.111-11 fecha a conta dos verificadores, mas não existe.
    for (const d of ['00000000000', '11111111111', '99999999999']) {
      ok(!cpfValido(d), `${d} devia ser rejeitado`);
    }
  });

  teste('os CPFs do seed da equipe são válidos', () => {
    // Confere os CPFs REAIS do seed, que não é versionado (o repositório é
    // público e o arquivo carrega nome, CPF e endereço de gente real). Lendo
    // do arquivo em vez de copiar para cá, o teste protege a transcrição na
    // máquina de quem tem o seed e não vaza nada em lugar nenhum.
    let seed;
    try {
      seed = readFileSync(new URL('../db/funcionarios_seed.sql', import.meta.url), 'utf8');
    } catch (e) {
      ok(true, 'sem o seed local não há o que conferir');
      return;
    }
    // O CPF é o valor logo depois do nome — pegar todo grupo de 11 dígitos
    // traria os telefones junto, e telefone não passa em dígito verificador.
    const cpfs = [...seed.matchAll(/'[A-ZÀ-Ú][^']{3,}',\s*'(\d{11})'/g)].map(m => m[1]);
    ok(cpfs.length >= 6, `só achei ${cpfs.length} CPFs no seed`);
    igual(cpfs.filter(c => !cpfValido(c)), [], 'erro de digitação na importação');
  });
});

grupo('funcionarios · máscaras', () => {
  teste('telefone celular e fixo', () => {
    igual(formatarTelefone('27999990001'), '(27) 99999-0001');
    igual(formatarTelefone('2733334444'), '(27) 3333-4444');
    igual(formatarTelefone('123'), '123');
  });

  teste('CEP', () => {
    igual(formatarCEP('29185000'), '29185-000');
    igual(formatarCEP('2918500'), '2918500');
  });

  teste('soDigitos tira qualquer pontuação', () => {
    igual(soDigitos('(27) 9 9999-0001'), '27999990001');
    igual(soDigitos(null), '');
  });
});

grupo('funcionarios · normalização para o banco', () => {
  teste('chave entra sem máscara', () => {
    const d = normalizarFuncionario({
      cpf: '111.444.777-35', telefone: '(27) 9 9999-0001', cep: '29185-000',
    });
    igual(d.cpf, '11144477735');
    igual(d.telefone, '27999990001');
    igual(d.cep, '29185000');
  });

  teste('campo em branco vira NULL, não string vazia', () => {
    // Duas linhas com cpf = '' colidiriam no índice único; com NULL, não.
    const d = normalizarFuncionario({ cpf: '', documento: '   ', nome: ' Ana ' });
    igual(d.cpf, null);
    igual(d.documento, null);
    igual(d.nome, 'Ana');
  });

  teste('e-mail em minúsculas e UF em maiúsculas', () => {
    const d = normalizarFuncionario({ email: '  Ana.Vitoria@Exemplo.com ', uf: 'es' });
    igual(d.email, 'ana.vitoria@exemplo.com');
    igual(d.uf, 'ES');
  });

  teste('booleano e undefined passam intactos', () => {
    const d = normalizarFuncionario({ ativo: false, acesso_bloqueado: true, cargo: undefined });
    igual(d.ativo, false);
    igual(d.acesso_bloqueado, true);
    ok(!('cargo' in d), 'campo não enviado não pode virar null no update');
  });
});

grupo('funcionarios · validação', () => {
  teste('nome é obrigatório', () => {
    igual(validarFuncionario({ nome: '  ' }).length, 1);
    igual(validarFuncionario({ nome: 'Rafael Gusmão' }), []);
  });

  teste('CPF é opcional, mas se vier tem que ser real', () => {
    igual(validarFuncionario({ nome: 'X', cpf: '' }), []);
    ok(validarFuncionario({ nome: 'X', cpf: '111.111.111-11' })[0].includes('CPF'));
  });

  teste('e-mail, telefone e CEP só reclamam quando preenchidos', () => {
    igual(validarFuncionario({ nome: 'X', email: '', telefone: '', cep: '' }), []);
    ok(validarFuncionario({ nome: 'X', email: 'sem-arroba' }).length === 1);
    ok(validarFuncionario({ nome: 'X', telefone: '2799' }).length === 1);
    ok(validarFuncionario({ nome: 'X', cep: '2918' }).length === 1);
  });

  teste('dinheiro ilegível não apaga o valor que já estava lá', () => {
    // "abc" no valor/hora virava null e limpava o campo em silêncio; o erro só
    // apareceria na próxima folha, com a pessoa ganhando zero.
    const ui = readFileSync(new URL('../js/funcionarios-ui.js', import.meta.url), 'utf8');
    ok(/valorDeTexto\(txt\) === null/.test(ui), 'a tela tem que conferir o texto cru antes de converter');
    ok(ui.includes('não é um'), 'e avisar em vez de gravar vazio');
    // E a validação de negócio recusa número impossível.
    ok(validarFuncionario({ nome: 'X', valor_hora: -5 }).length === 1);
    ok(validarFuncionario({ nome: 'X', salario_fixo: -1 }).length === 1);
    igual(validarFuncionario({ nome: 'X', valor_hora: 17, salario_fixo: 0 }), []);
  });

  teste('nascimento no futuro não passa', () => {
    ok(validarFuncionario({ nome: 'X', data_nascimento: '2999-01-01' }).length === 1);
    igual(validarFuncionario({ nome: 'X', data_nascimento: '1992-01-11' }), []);
  });

  teste('a ficha completa passa inteira', () => {
    igual(validarFuncionario({
      nome: 'Ana Vitória de Almeida', cpf: '111.444.777-35', documento: '3223079',
      data_nascimento: '1992-01-11', sexo: 'feminino', email: 'ana.vitoria@exemplo.com',
      telefone: '(27) 9 9999-0001', cargo: 'Administrador', unidade: 'Go Up',
      cep: '29185-000', logradouro: 'Jerônimo Sirtoli', numero: '196',
      bairro: 'Santo Antônio', cidade: 'Fundão', uf: 'ES',
    }), []);
  });
});

grupo('funcionarios · apresentação', () => {
  teste('endereço resumido ignora o que está vazio', () => {
    igual(enderecoResumido({ logradouro: 'Jerônimo Sirtoli', numero: '196', cidade: 'Fundão', uf: 'ES', cep: '29185000' }),
      'Jerônimo Sirtoli, 196 — Fundão · ES — CEP 29185-000');
    igual(enderecoResumido({}), '');
    igual(enderecoResumido(null), '');
  });

  teste('os sexos são os mesmos que o CHECK do banco aceita', () => {
    const schema = readFileSync(new URL('../db/funcionarios_schema.sql', import.meta.url), 'utf8');
    for (const v of Object.keys(SEXOS)) {
      ok(schema.includes(`'${v}'`), `o banco não aceita sexo = ${v}`);
    }
  });

  teste('erro de CPF duplicado vira instrução, não jargão de Postgres', () => {
    const m = traduzirErroFuncionario('duplicate key value violates unique constraint "uniq_funcionarios_cpf"');
    ok(m.includes('CPF'), m);
    ok(!m.includes('constraint'), 'não repassar o texto cru do banco');
  });
});

grupo('funcionarios · a linha da lista desenha de verdade', () => {
  // Estes testes EXECUTAM a função, não leem o arquivo. Foi essa a lacuna que
  // deixou passar um "Cannot access 'appLigado' before initialization": uma
  // variável usada antes da declaração é texto perfeitamente válido, e o erro
  // só aparecia quando a tela tentava desenhar — em branco, com a mensagem
  // escondida no console.
  const FICHA = {
    id: 'f1', nome: 'Ana Vitória de Almeida', cpf: '11144477735',
    cargo: 'Administrador', unidade: 'Go Up', email: 'ana.vitoria@exemplo.com',
    telefone: '27999990001', valor_hora: 13, chave_pix: '27999990001',
    codigo_acesso: 'K7PMR4', ativo: true, acesso_bloqueado: false,
  };

  teste('a ficha completa vira HTML sem explodir', async () => {
    const { linhaFuncionarioHtml } = await import('../js/funcionarios-ui.js');
    const html = linhaFuncionarioHtml(FICHA);
    contem(html, 'Ana Vitória de Almeida');
    contem(html, '111.444.777-35');
    contem(html, 'Administrador · Go Up');
    contem(html, 'K7PMR4', 'o código do convite tem que aparecer');
  });

  teste('a ficha mais vazia possível também', async () => {
    // Um cadastro recém-criado só tem nome.
    const { linhaFuncionarioHtml } = await import('../js/funcionarios-ui.js');
    const html = linhaFuncionarioHtml({ id: 'f2', nome: 'Fulano', ativo: true });
    contem(html, 'Fulano');
    naoContem(html, 'undefined');
    naoContem(html, 'null');
    naoContem(html, 'NaN');
  });

  teste('quem já ligou a conta troca o código pelo selo', async () => {
    const { linhaFuncionarioHtml } = await import('../js/funcionarios-ui.js');
    const html = linhaFuncionarioHtml({ ...FICHA, auth_user_id: 'u1' });
    contem(html, 'No app');
    naoContem(html, 'K7PMR4', 'reenviar código já usado só produz "não funciona"');
  });

  teste('desligado e bloqueado aparecem, e sem convite', async () => {
    const { linhaFuncionarioHtml } = await import('../js/funcionarios-ui.js');
    const desligado = linhaFuncionarioHtml({ ...FICHA, ativo: false });
    contem(desligado, 'Desligado');
    naoContem(desligado, 'K7PMR4', 'quem saiu não recebe convite');

    const bloqueado = linhaFuncionarioHtml({ ...FICHA, acesso_bloqueado: true });
    contem(bloqueado, 'Acesso bloqueado');
  });

  teste('nome digitado nunca vira marcação', async () => {
    const { linhaFuncionarioHtml } = await import('../js/funcionarios-ui.js');
    const html = linhaFuncionarioHtml({ ...FICHA, nome: '<img onerror=x>' });
    naoContem(html, '<img');
  });
});

grupo('funcionarios · fiação da tela', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  teste('o item Equipe do menu está habilitado', () => {
    // Funcionários deixou de ser assunto do Financeiro: mora em Equipe.
    const item = /<div class="nav-item([^"]*)" data-page="equipe"/.exec(index);
    ok(item, 'sumiu o item de menu da Equipe');
    ok(!item[1].includes('disabled'), 'o menu continua desabilitado — a página não abre');
  });

  teste('a página existe e é preenchida pelo módulo', () => {
    ok(index.includes('id="page-equipe"'), 'faltou o container da página');
    ok(index.includes("import('./js/equipe-admin-ui.js')"), 'a página não carrega a casca do módulo');
    ok(index.includes('initEquipeUI'), 'a entrada do módulo não é chamada');
  });

  teste('a seção de funcionários desenha no container que recebe', () => {
    // Ela divide a página com a folha: se voltar a escrever direto em
    // #page-equipe, apaga as abas ao renderizar.
    const ui = readFileSync(new URL('../js/funcionarios-ui.js', import.meta.url), 'utf8');
    ok(/initFuncionariosUI\(nutriId, containerId/.test(ui), 'a entrada tem que aceitar o container');
    ok(!ui.includes("page.innerHTML = `\n    <div class=\"page-header\">"), 'o cabeçalho agora é da casca');
  });

  teste('navegar() dispara o carregamento da página', () => {
    ok(/pagina === 'equipe'/.test(index), 'clicar no menu não carregaria nada');
  });

  teste('o CSS do módulo é carregado depois de brand.css', () => {
    const iFin = index.indexOf('href="css/financeiro.css"');
    const iBrand = index.indexOf('href="css/brand.css"');
    ok(iFin > 0, 'faltou o <link> do css/financeiro.css');
    ok(iFin > iBrand, 'financeiro.css antes de brand.css seria sobrescrito');
  });
});

grupo('funcionarios · seed da equipe', () => {
  // O seed não é versionado: carrega nome, CPF e endereço de gente real, e o
  // repositório é público. Estes testes rodam na máquina de quem tem o
  // arquivo e se calam onde ele não existe — afirmar nomes reais aqui seria
  // vazar pela porta dos fundos o que o .gitignore fecha pela da frente.
  let seed = null;
  try {
    seed = readFileSync(new URL('../db/funcionarios_seed.sql', import.meta.url), 'utf8');
  } catch (e) { /* sem seed local */ }

  teste('a equipe inteira está no seed', () => {
    if (!seed) { ok(true, 'sem o seed local não há o que conferir'); return; }
    const pessoas = [...seed.matchAll(/'[A-ZÀ-Ú][^']{3,}',\s*'\d{11}'/g)];
    ok(pessoas.length >= 6, `só achei ${pessoas.length} pessoas no seed`);
  });

  teste('os CPFs do seed entram sem máscara', () => {
    if (!seed) { ok(true, 'sem o seed local'); return; }
    const comMascara = seed.match(/'\d{3}\.\d{3}\.\d{3}-\d{2}'/g) || [];
    igual(comMascara, [], 'o CHECK do banco só aceita 11 dígitos');
  });

  teste('rodar duas vezes não duplica ninguém', () => {
    if (!seed) { ok(true, 'sem o seed local'); return; }
    ok(/on conflict[\s\S]*do nothing/i.test(seed), 'seed sem proteção contra reexecução');
  });
});
