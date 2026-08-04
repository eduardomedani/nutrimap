// App do colaborador (equipe.html).
//
// O que este arquivo protege: o app mostra HOLERITE. Os dois riscos que
// importam são (1) alguém ver o de outra pessoa e (2) alguém ver um valor que
// ainda estava sendo digitado. O primeiro depende de a consulta filtrar por
// funcionario_id — a policy sozinha não segura, porque políticas se somam por
// OR e a conta do dono casaria com a de nutri. O segundo depende de só folha
// fechada chegar à tela.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

import { traduzirErro } from '../js/equipe-data.js';

const dados = readFileSync(new URL('../js/equipe-data.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../js/equipe-ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../equipe.html', import.meta.url), 'utf8');

grupo('equipe · cada um vê só o seu', () => {
  teste('a consulta filtra por funcionario_id, não só a policy', () => {
    // Políticas permissivas se somam por OR: se a conta logada for também a do
    // dono, a política de nutri casaria e a mesma consulta devolveria a folha
    // da equipe inteira.
    ok(/\.eq\('funcionario_id', funcionarioId\)/.test(dados), 'faltou o filtro explícito');
    ok(/if \(!funcionarioId\) return \[\]/.test(dados), 'sem id, não consulta nada');
  });

  teste('o cadastro vem pelo auth_user_id da sessão', () => {
    ok(/\.eq\('auth_user_id', user\.id\)/.test(dados), 'nada de buscar cadastro por outro critério');
  });

  teste('só folha fechada chega à tela', () => {
    // Rascunho é número mudando enquanto o valor ainda está sendo digitado.
    ok(/\.eq\('folha\.status', 'fechada'\)/.test(dados), 'faltou barrar rascunho');
  });

  teste('o rascunho é descartado pelo BANCO, não pelo navegador', () => {
    // Filtrando depois de trazer, o `limite` cortaria antes do filtro: bastava
    // a pessoa ter rascunhos recentes para meses pagos sumirem da tela dela.
    ok(dados.includes('folhas!inner'), 'faltou o join interno');
    const consulta = dados.slice(dados.indexOf('.from(\'folha_itens\')'));
    const iFiltro = consulta.indexOf(".eq('folha.status'");
    const iLimite = consulta.indexOf('.limit(limite)');
    ok(iFiltro > 0 && iFiltro < iLimite, 'o filtro tem que vir antes do limite');
  });

  teste('o app não escreve nada', () => {
    // O colaborador confere; quem lança é o painel.
    for (const escrita of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      ok(!dados.includes(escrita), `o app do colaborador não pode ${escrita}`);
    }
    // A única chamada de escrita permitida é o RPC que liga a conta ao cadastro.
    contem(dados, "rpc('vincular_funcionario'");
  });
});

grupo('equipe · bloquear acesso é bloquear mesmo', () => {
  const sql = readFileSync(new URL('../db/funcionario_login_schema.sql', import.meta.url), 'utf8');

  teste('o bloqueio corta tudo num lugar só', () => {
    // Toda política de leitura do colaborador passa por funcionario_do_auth().
    // Devolver NULL ali corta folha, adicionais e os dois buckets de uma vez —
    // espalhar a condição por sete políticas seria seis chances de esquecer.
    ok(/function public\.funcionario_do_auth[\s\S]{0,400}and not acesso_bloqueado/.test(sql),
      'sem isso o interruptor só pintava um selo na tela');
  });

  teste('bloqueado não contorna pedindo outro código', () => {
    ok(/raise exception 'acesso_bloqueado'/.test(sql), 'faltou recusar o vínculo de quem está bloqueado');
    ok(/and not acesso_bloqueado[\s\S]{0,80}and auth_user_id is null/.test(sql),
      'e o código de quem está bloqueado não pode valer');
  });

  teste('o app explica, em vez de mostrar tela vazia', () => {
    // Um app que some com o holerite sem dizer por quê vira ligação para o gestor.
    ok(ui.includes('renderBloqueado'), 'faltou a tela de acesso bloqueado');
    ok(ui.includes('Acesso bloqueado'), 'e o texto que nomeia o que aconteceu');
    ok(dados.includes('acesso_bloqueado'), 'o app precisa ler o campo para saber');
    contem(traduzirErro('acesso_bloqueado'), 'bloqueado');
  });
});

grupo('equipe · documentos', () => {
  teste('abre por URL assinada — o bucket é privado', () => {
    ok(ui.includes('urlAssinada'), 'faltou abrir o documento pelo link assinado');
    ok(!ui.includes('getPublicUrl'), 'holerite não vai por URL pública');
  });

  teste('mostra o documento PUBLICADO, não uma remontagem', () => {
    // O recibo tem que ser o mesmo que foi fechado, mesmo que a folha seja
    // reaberta e corrigida depois.
    ok(ui.includes('caminho_storage'), 'a tela decide pelo arquivo guardado');
    ok(!ui.includes('htmlContracheque('), 'nada de o app montar o próprio recibo');
  });

  teste('documento que não existe aparece apagado, não some', () => {
    // Sumir faz o colaborador achar que o app escondeu algo dele.
    ok(ui.includes('Não emitido para este mês'), 'faltou o estado do contracheque ausente');
    ok(ui.includes('Não anexada para este mês'), 'faltou o do ponto ausente');
    const css = readFileSync(new URL('../css/equipe.css', import.meta.url), 'utf8');
    ok(css.includes('.eq-doc-off'), 'faltou o estilo do documento indisponível');
  });
});

grupo('equipe · entrar e vincular', () => {
  teste('o código pode vir no link do convite', () => {
    ok(/URLSearchParams\(location\.search\)\.get\('codigo'\)/.test(ui), 'faltou ler o código da URL');
    ok(ui.includes('limparCodigoDaUrl'), 'e limpar depois de usar');
  });

  teste('quem usa o e-mail da ficha entra sem ver código', () => {
    ok(ui.includes('vincularPorEmail'), 'faltou tentar o vínculo automático');
    const trecho = ui.slice(ui.indexOf('export async function iniciarApp'));
    const iCodigo = trecho.indexOf('await vincularPorCodigo(cod)');
    const iEmail = trecho.indexOf('await vincularPorEmail()');
    ok(iCodigo > 0 && iEmail > iCodigo,
      'o código do link vem primeiro: é intenção explícita de quem convidou');
  });

  teste('o vínculo por e-mail exige e-mail confirmado', () => {
    // Sem confirmação, quem souber o e-mail da pessoa cria uma conta com ele e
    // recebe o holerite dela.
    const sql = readFileSync(new URL('../db/vinculo_por_email.sql', import.meta.url), 'utf8');
    ok(sql.includes('email_confirmed_at is not null'), 'faltou exigir e-mail confirmado');
    ok(sql.includes('confirmation_sent_at is not null'),
      'só o confirmed_at não basta: com auto-confirmação ele vem preenchido sozinho');
    ok(/if not \(v_confirmado and v_enviado\) then\s*return null/.test(sql),
      'sem confirmação real tem que cair no código, não vincular');
  });

  teste('e-mail repetido em duas fichas não vincula nenhuma', () => {
    // Adivinhar qual é a pessoa entregaria o holerite errado.
    const sql = readFileSync(new URL('../db/vinculo_por_email.sql', import.meta.url), 'utf8');
    ok(/if v_quantos <> 1 then\s*return null/.test(sql), 'faltou exigir correspondência única');
  });

  teste('bloqueado e desligado não entram nem pelo e-mail', () => {
    const sql = readFileSync(new URL('../db/vinculo_por_email.sql', import.meta.url), 'utf8');
    const condicoes = (sql.match(/and ativo\s*and not acesso_bloqueado/g) || []).length;
    ok(condicoes >= 2, 'a contagem e a busca precisam das mesmas condições');
  });

  teste('não vincular não é erro — é hora de pedir o código', () => {
    const dadosSrc = readFileSync(new URL('../js/equipe-data.js', import.meta.url), 'utf8');
    ok(/return data \|\| null/.test(dadosSrc), 'ausência de par tem que virar null, não exceção');
  });

  teste('conta criada sem sessão não trava a tela', () => {
    // Com confirmação de e-mail ligada no projeto, o signUp não devolve sessão.
    ok(/if \(!r\?\.session\)/.test(ui), 'faltou tratar o cadastro que exige confirmação');
  });

  teste('dá para sair da tela de vínculo', () => {
    // Sem isso, quem errou a conta fica preso pedindo um código que não tem.
    ok(/id="eqSair"[\s\S]{0,200}Sair desta conta/.test(ui), 'faltou a saída da tela de vínculo');
  });

  teste('cada erro do vínculo tem frase própria', () => {
    for (const [erro, trecho] of [
      ['codigo_invalido', 'Código não encontrado'],
      ['conta_ja_vinculada', 'já está ligada'],
      ['precisa_estar_logado', 'Entre na sua conta'],
      ['Invalid login credentials', 'senha incorretos'],
      ['User already registered', 'Já existe uma conta'],
    ]) {
      const m = traduzirErro(erro);
      contem(m, trecho, `"${erro}" virou "${m}"`);
      ok(!m.includes('_'), 'não repassar o código cru do erro');
    }
  });

  teste('sem internet o app diz isso, não um erro técnico', () => {
    contem(traduzirErro('Failed to fetch'), 'Sem conexão');
  });
});

grupo('equipe · PWA', () => {
  teste('a página tem manifesto próprio', () => {
    contem(html, 'manifest-equipe.webmanifest');
    const manifesto = JSON.parse(
      readFileSync(new URL('../manifest-equipe.webmanifest', import.meta.url), 'utf8'));
    igual(manifesto.start_url, 'equipe.html', 'o atalho tem que abrir o app do colaborador');
    ok(manifesto.icons.length >= 2, 'faltou ícone para instalar');
    ok(manifesto.name !== 'Evollo — Aluno', 'os dois apps não podem ter o mesmo nome na tela inicial');
  });

  teste('um service worker só, para os dois apps', () => {
    // Dois SW no mesmo escopo disputam o controle da página.
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    contem(html, "register('sw.js')");
    for (const arquivo of ['equipe.html', 'js/equipe-ui.js', 'js/equipe-data.js', 'css/equipe.css']) {
      contem(sw, arquivo, 'o shell do colaborador tem que estar no cache');
    }
    contem(sw, 'app.html', 'e o do aluno tem que continuar lá');
  });

  teste('o cache foi renomeado, senão o shell antigo sobrevive', () => {
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    ok(!sw.includes("'nutrimap-aluno-v9'"), 'a versão do cache tem que mudar quando o shell muda');
  });

  teste('campo de texto com 16px, senão o iOS dá zoom ao focar', () => {
    const css = readFileSync(new URL('../css/equipe.css', import.meta.url), 'utf8');
    ok(/\.eq-campo input \{[^}]*font-size: 16px/s.test(css), 'input abaixo de 16px faz o iPhone ampliar a tela');
  });

  teste('alvos de toque grandes o suficiente', () => {
    // 44px é o mínimo que a mão acerta sem ampliar a tela.
    const css = readFileSync(new URL('../css/equipe.css', import.meta.url), 'utf8');
    const regras = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];

    for (const seletor of ['.eq-btn', '.eq-aba', '.eq-sair', '.eq-voltar', '.eq-link', '.eq-cartao-mes', '.eq-doc']) {
      const regra = regras.find(r =>
        r[1].split(',').some(s => s.trim() === seletor));
      ok(regra, `não achei a regra de ${seletor}`);
      const altura = /(?:min-height|height): (\d+)px/.exec(regra[2]);
      ok(altura && Number(altura[1]) >= 44, `${seletor} precisa de pelo menos 44px de alvo`);
    }
  });
});

grupo('equipe · convite pelo painel', () => {
  const fn = readFileSync(new URL('../js/funcionarios-ui.js', import.meta.url), 'utf8');

  teste('o painel mostra o código e copia o convite inteiro', () => {
    // Código solto obriga a pessoa a descobrir onde digitá-lo — e é aí que o
    // convite morre.
    ok(fn.includes('data-fn-convidar'), 'faltou o botão de convite');
    ok(fn.includes('equipe.html?codigo='), 'o link tem que levar direto ao app');
    ok(/copiarParaClipboard\(mensagem/.test(fn), 'copia a mensagem, não só o código');
  });

  teste('o convite some depois que a conta é ligada', () => {
    // Reenviar um código já usado só gera "não funciona".
    ok(/f\.codigo_acesso && !f\.auth_user_id && f\.ativo/.test(fn), 'faltou esconder o código já usado');
    ok(fn.includes('fn-selo-app'), 'e sinalizar quem já está no app');
  });
});
