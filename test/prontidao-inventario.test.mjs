// ═══════════════════════════════════════════════════════════
// ETAPA 3.5 — o inventário que gera o relatório de prontidão
// ═══════════════════════════════════════════════════════════
// O script 79 é gerado por test/inventario-repositorio.mjs, e o que ele diz
// depende inteiramente de uma decisão: quais arquivos do repositório DECLARAM
// objeto que deve existir no banco.
//
// Errar essa classificação não produz erro — produz um relatório confiante e
// errado. Um arquivo classificado a mais vira "migration versionada não
// aplicada" para sempre; um a menos some da conferência e ninguém percebe.
// Estas guardas protegem a classificação, não o SQL.

import { grupo, teste, ok, igual } from './runner.mjs';
import { classificar, moduloDe, inventario } from './inventario-repositorio.mjs';


// ═══════════════════════════════════════════════════════════
grupo('etapa 3.5 · o que declara objeto e o que não declara', () => {

  teste('as quatro classes que NÃO devem estar aplicadas', () => {
    // Cada uma existe no repositório por um motivo diferente, e nenhuma
    // representa "isto deveria estar no banco":
    //   CONFERENCIA  lê
    //   DESFAZER     remove
    //   BASELINE     retrata o que já existe
    //   PROPOSTA     foi aprovado e ainda não foi executado
    igual(classificar('70_legacy_baseline_comparacao_LIMPO.sql'), 'CONFERENCIA');
    igual(classificar('checkin_schema_desfazer.sql'),             'DESFAZER');
    igual(classificar('auth_signup_baseline.sql'),                'BASELINE');
    igual(classificar('agenda_rpc_operacional_proposta.sql'),     'PROPOSTA');
  });

  teste('o desfazer de uma proposta ainda é desfazer', () => {
    // A ordem dos testes em classificar() importa: `_desfazer.sql` precisa
    // ganhar de `_proposta.sql` num nome que tivesse os dois.
    igual(classificar('agenda_rpc_operacional_desfazer.sql'), 'DESFAZER');
  });

  teste('as RPCs propostas da Agenda ficam fora do inventário', () => {
    // Elas não estão aplicadas de propósito: aplicá-las daria à Recepção
    // acesso operacional à agenda antes da Etapa 4. Se entrassem aqui, o
    // módulo AGENDA apareceria como "migration não aplicada" no relatório.
    const nomes = inventario().map(o => o.nome);
    for (const f of ['agenda_listar', 'agenda_agendar', 'agenda_remarcar', 'agenda_cancelar']) {
      ok(!nomes.includes(f), `${f} é proposta e não deveria estar no inventário`);
    }
  });

  teste('o objeto de outro produto não é lido como módulo do Evollo', () => {
    // pedcrm_novo_membro está vivo neste banco e não é nosso. Categoria
    // própria: registrado para não voltar a ser "objeto desconhecido", e
    // separado para não ser lido como funcionalidade.
    igual(moduloDe('pedcrm_objeto_estranho.sql'), 'OBJETO ESTRANHO');
    ok(inventario().some(o => o.nome === 'pedcrm_novo_membro'),
       'o objeto precisa continuar inventariado, só que em categoria própria');
  });

  teste('o gatilho do cadastro entra pelo baseline, no legado central', () => {
    igual(moduloDe('auth_signup_baseline.sql'), 'LEGADO CENTRAL');
    ok(inventario().some(o => o.nome === 'handle_new_user' && o.tipo === 'funcao'));
  });

  teste('check-in continua declarado — foi aplicado, não removido', () => {
    const checkin = inventario().filter(o => o.modulo === 'CHECK-INS' && o.tipo !== 'indice');
    igual(checkin.length, 27, 'os 27 objetos do módulo');
  });
});
