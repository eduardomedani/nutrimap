// ═══════════════════════════════════════════════════════════
// C2 — condições da implantação (autorizada em 10/11/2026)
// ═══════════════════════════════════════════════════════════
// O que precisa ser verdade no commit do C2, sem tocar em dado real:
//   . XSS refletido da anamnese corrigido (código da URL escapado);
//   . anamnese por CÓDIGO continua igual (mesmas RPCs de hoje);
//   . as dietas que já estão no app continuam visíveis (o app lê o mesmo
//     filtro, e o C2 não escreve em plano existente fora de Publicar/Retirar);
//   . nenhuma RPC que dependa de migration ainda não aplicada sem caminho
//     alternativo;
//   . nada de financeiro, comercial ou treinos é importado pelos arquivos do C2.
// Rascunho, publicação compatível e "uma versão no app" estão em
// test/dieta-publicacao.test.mjs.

import { readFileSync } from 'node:fs';
import { grupo, teste, ok, igual } from './runner.mjs';
import { escaparHtml } from '../js/html-seguro.js';
import { PUBLICACAO } from '../js/dieta.js';

const ler = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ARQUIVOS_C2 = ['anamnese.html', 'js/calorias-ui.js', 'js/dieta-seguranca.js', 'js/dieta-ui.js', 'js/dieta.js',
  'js/pwa-dieta-ui.js', 'js/relatorio.js'];
const ANAMNESE = ler('anamnese.html');

grupo('C2 · XSS refletido da anamnese (código não encontrado)', () => {
  teste('o código da URL entra escapado na mensagem', () => {
    ok(ANAMNESE.includes("import { escaparHtml } from './js/html-seguro.js';"));
    ok(ANAMNESE.includes('O código <strong>${escaparHtml(patientCode)}</strong> não foi encontrado'));
  });
  teste('não sobra nenhuma interpolação crua do código em HTML', () => {
    const usos = ANAMNESE.match(/\$\{patientCode\}/g) || [];
    igual(usos.length, 1);   // a única é a chave do localStorage
    ok(ANAMNESE.includes('const STORAGE_KEY = `nutrimap_paciente_${patientCode}`;'));
  });
  teste('a carga maliciosa vira texto', () => {
    const carga = '<img src=x onerror=alert(1)>"\'&';
    igual(escaparHtml(carga), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
  });
});

grupo('C2 · anamnese por código continua igual', () => {
  teste('a anamnese valida o código e salva pelas mesmas funções de hoje', () => {
    ok(ANAMNESE.includes("import { buscarPacientePorCodigo, marcarComoCompleto } from './js/pacientes.js';"));
    ok(ANAMNESE.includes("import { salvarTodasRespostas } from './js/respostas.js';"));
    ok(ANAMNESE.includes('pacienteSupabase = await buscarPacientePorCodigo(patientCode);'));
    ok(ANAMNESE.includes("const patientCode = urlParams.get('p') || 'demo';"));
  });
  teste('as funções usam as RPCs públicas atuais', () => {
    ok(ler('js/pacientes.js').includes("rpc('rpc_buscar_paciente_por_codigo'"));
    ok(ler('js/respostas.js').includes("rpc('rpc_salvar_respostas'"));
  });
});

grupo('C2 · dietas existentes e backend atual', () => {
  teste('o app do aluno lê a dieta ativa do próprio paciente (filtro de hoje)', () => {
    const d = ler('js/pwa-dieta-data.js');
    ok(/\.from\('planos_alimentares'\)[\s\S]{0,200}\.eq\('paciente_id', meu\)\s*\.eq\('ativo', true\)/.test(d));
  });
  teste('nenhuma RPC sem caminho alternativo além das que já existem em produção', () => {
    const rpcs = new Set();
    for (const f of ARQUIVOS_C2) for (const m of ler(f).matchAll(/(?:\brpc|chamarRpcDaDieta)\('([a-z_]+)'/g)) rpcs.add(m[1]);
    igual([...rpcs].sort(), ['foods_buscar', 'rpc_dieta_publicar', 'rpc_dieta_retirar']);
    igual(PUBLICACAO.somenteServidor, false);   // sem a v2, publicar/retirar usam o caminho de hoje
  });
  teste('nenhum arquivo do C2 importa financeiro, comercial ou treinos', () => {
    for (const f of ARQUIVOS_C2) {
      ok(!/from '\.\/(js\/)?(financeiro|comercial|treino|exercicio|folha|agenda)[^']*'|import\('\.\/(js\/)?(financeiro|comercial|treino|exercicio|folha|agenda)/.test(ler(f)), f);
    }
  });
});
