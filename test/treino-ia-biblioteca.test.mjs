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

  teste('O TREINO GERADO PARA O ALUNO NASCE RASCUNHO (INATIVO)', () => {
    // O app do aluno só lista treinos ativos (paciente-data.js). Nascer ativo
    // publicava a sugestão da IA antes de o professor revisar.
    contem(ui, "ativo: _modo === 'modelo',");
    contem(ui, '_rascunhoIA = treino.id;');
  });

  teste('publicar ativa e registra a publicação; descartar pede confirmação', () => {
    const ini = ui.indexOf('async function publicarRascunho');
    const fim = ui.indexOf('async function removerTreino');
    const bloco = ui.slice(ini, fim);
    contem(bloco, 'atualizarTreino(_treino.id, { ativo: true })');
    contem(bloco, "eventoTreino('WORKOUT_PUBLISHED')");
    contem(bloco, 'await confirmar({');
    contem(bloco, 'excluirTreino(_treino.id)');
  });

  teste('a faixa some quando o treino já está ativo', () => {
    contem(ui, "const ehRascunho = t && _rascunhoIA === t.id && (_modo === 'modelo' || !t.ativo);");
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
