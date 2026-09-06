// ═══════════════════════════════════════════════════════════
// GERAR COM IA NA BIBLIOTECA — montar modelos do zero
// ═══════════════════════════════════════════════════════════
// O gerador existia só dentro do paciente. Montar a biblioteca exigia criar um
// treino para alguém e depois subir para os modelos — dois passos e um treino
// fantasma no histórico do aluno.
//
// O erro que estes testes pegam é o gerador salvar no lugar errado: chamado da
// biblioteca e gravando com `paciente_id` preenchido, o "modelo" viraria uma
// prescrição — e, pior, apareceria no app de um aluno que ninguém escolheu.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../js/treinos-ui.js', import.meta.url), 'utf8');

grupo('treinos · IA na biblioteca', () => {
  teste('o botão existe nos DOIS cabeçalhos', () => {
    // Um por modo; só um renderiza por vez, e o handler usa `?.`.
    igual((ui.match(/id="trBtnIA"/g) || []).length, 2);
    contem(ui, "document.getElementById('trBtnIA')?.addEventListener");
  });

  teste('O QUE NASCE DA BIBLIOTECA É MODELO, NÃO PRESCRIÇÃO', () => {
    // `paciente_id` é o que decide, e é a mesma regra do resto do módulo.
    // Preenchido por engano, o "modelo" apareceria no app de um aluno que
    // ninguém escolheu.
    contem(ui, "paciente_id: _modo === 'modelo' ? null : _paciente.id,");
  });

  teste('a base para ajustar muda com o modo', () => {
    // Biblioteca ajusta modelos; paciente ajusta os treinos daquele aluno.
    contem(ui, "const ehBiblioteca = _modo === 'modelo';");
    contem(ui, 'await listarModelos()');
    contem(ui, '(await listarTreinosDoPaciente(_paciente.id)).filter(t => t.paciente_id)');
  });

  teste('EVOLUIR NÃO APARECE NA BIBLIOTECA', () => {
    // Ele progride a partir das cargas que o ALUNO registrou. Um modelo não
    // tem aluno nem carga: o botão prometeria uma conta impossível.
    contem(ui, "${ehBiblioteca ? '' : `<button type=\"button\" class=\"ia-modo\" data-ia-modo=\"evoluir\"");
  });

  teste('nenhum acesso a _paciente fica solto no fluxo da IA', () => {
    // Na biblioteca `_paciente` não existe; um acesso desprotegido derrubaria
    // a tela com "cannot read property id of undefined".
    const ini = ui.indexOf('async function renderGeradorIA');
    const fim = ui.indexOf('async function abrirEditor');
    const bloco = ui.slice(ini, fim);
    for (const m of bloco.match(/_paciente\.\w+/g) || []) {
      const ctx = bloco.slice(Math.max(0, bloco.indexOf(m) - 90), bloco.indexOf(m));
      ok(/ehBiblioteca|_modo === 'modelo'/.test(ctx),
         `acesso a ${m} sem guarda de modo`);
    }
  });

  teste('os rótulos falam a língua do modo', () => {
    // "Voltar para os treinos" na biblioteca mandaria a pessoa procurar uma
    // tela que não é a de onde ela veio.
    contem(ui, "Voltar para ${ehBiblioteca ? 'a biblioteca' : 'os treinos'}");
    contem(ui, "Ajustar ${ehBiblioteca ? 'um modelo' : 'treino atual'}");
    contem(ui, "${ehBiblioteca ? 'Modelo' : 'Treino'} a usar como base");
  });
});
