// ═══════════════════════════════════════════════════════════
// COMERCIAL — "Cliente desde": ação própria, confirmação e trilha
// ═══════════════════════════════════════════════════════════
// "Cliente desde" (`data_inicio_original`) é dado CADASTRAL/HISTÓRICO. Nenhuma
// regra de cobrança o lê. Até 11/09/2026 era um campo do "Editar assinatura",
// gravado por update direto, sem confirmação e sem registro de quem mudou.
//
// O que estes testes protegem, na ordem de importância:
//   1. a mudança só toca a coluna — nunca período, plano, valor ou financeiro;
//   2. ela deixa trilha (quem, quando, antes e depois);
//   3. a tela confirma mostrando as duas datas.
// O funcionamento no banco é provado pela conferência 137.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  CLIENTE_DESDE_NAO_MUDA, clienteDesdeVazio, validarClienteDesde,
  textoConfirmacaoClienteDesde, traduzirErroClienteDesde, formClienteDesdeHtml,
  formEdicaoAssinaturaHtml, edicaoAssinaturaVazia, edicaoAssinaturaParaBanco,
} from '../js/comercial-formularios.js';
import { assinaturaHtml, MSG } from '../js/comercial-drawer.js';

const ler = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SQL      = ler('../db/comercial_cliente_desde.sql');
const DESFAZER = ler('../db/comercial_cliente_desde_desfazer.sql');
const CONF     = ler('../db/conferencia/137_cliente_desde.sql');
const DRAWER   = ler('../js/comercial-drawer.js');
const FORMS    = ler('../js/comercial-formularios.js');
const DADOS    = ler('../js/comercial-data.js');

const A = {
  id: 'a1',
  paciente: { id: 'p1', nome: 'Cliente Exemplo' },
  plano: { id: 'pl1', nome: 'Mensal - 3x' },
  data_inicio_original: '2026-07-07',
  inicio_periodo: '2026-08-06', fim_periodo: '2026-09-05',
  valor_contratado: 150, horario: 'Diurno', renovacao_automatica: true,
};

/** O corpo da RPC, entre `as $fn$` e `$fn$;`. */
const corpoRpc = () => {
  const i = SQL.indexOf('create or replace function public.comercial_alterar_cliente_desde(');
  const ini = SQL.indexOf('as $fn$', i);
  return SQL.slice(ini, SQL.indexOf('$fn$;', ini + 7));
};

// ───────────────────────────────────────────────────────────
grupo('cliente desde · validação', () => {
  teste('abre com a data gravada', () => {
    igual(clienteDesdeVazio(A).data, '2026-07-07');
  });

  teste('sem data, não segue', () => {
    ok(validarClienteDesde({ data: '' }, A).data);
  });

  teste('depois do início do período atual é recusado, dizendo o limite', () => {
    // O CHECK da tabela: inicio_periodo >= data_inicio_original.
    const e = validarClienteDesde({ data: '2026-08-07' }, A);
    contem(e.data, '06/08/2026');
  });

  teste('o próprio início do período é o limite, e passa', () => {
    igual(Object.keys(validarClienteDesde({ data: '2026-08-06' }, A)).length, 0);
  });

  teste('a mesma data não pede confirmação de nada', () => {
    ok(validarClienteDesde({ data: '2026-07-07' }, A).data);
  });

  teste('data anterior válida passa', () => {
    igual(Object.keys(validarClienteDesde({ data: '2024-03-01' }, A)).length, 0);
  });
});

// ───────────────────────────────────────────────────────────
grupo('cliente desde · a confirmação', () => {
  const t = textoConfirmacaoClienteDesde(A, '2024-03-01');

  teste('mostra data anterior → data nova', () => {
    contem(t, '07/07/2026 → 01/03/2024');
    contem(t, 'Cliente Exemplo');
  });

  teste('diz tudo o que NÃO muda', () => {
    for (const item of CLIENTE_DESDE_NAO_MUDA) contem(t, item);
    for (const palavra of ['período', 'cobranças', 'vencimentos', 'pagamentos', 'competências', 'plano', 'valor contratado']) {
      contem(t, palavra);
    }
  });

  teste('avisa que fica registrado', () => {
    contem(t, 'registrada com quem fez e quando');
  });

  teste('o salvar pergunta antes de gravar', () => {
    contem(FORMS, 'confirm(textoConfirmacaoClienteDesde(assinatura, form.data))');
    ok(FORMS.indexOf('confirm(textoConfirmacaoClienteDesde') < FORMS.indexOf('await aoSalvar(form.data)'),
       'a confirmação vem antes da gravação');
  });
});

// ───────────────────────────────────────────────────────────
grupo('cliente desde · a tela', () => {
  const html = formClienteDesdeHtml({ assinatura: A, form: clienteDesdeVazio(A) });

  teste('drawer do módulo, com diálogo rotulado', () => {
    contem(html, 'class="cm-drawer"');
    contem(html, 'role="dialog"');
    contem(html, 'cm-drawer-pe');
  });

  teste('a data gravada e o período aparecem como leitura', () => {
    contem(html, 'cm-dw-leitura');
    contem(html, '07/07/2026');
    contem(html, '06/08/2026 a 05/09/2026');
  });

  teste('o campo não deixa passar do início do período', () => {
    contem(html, 'id="cmCdData" type="date"');
    contem(html, 'max="2026-08-06"');
  });

  teste('diz o que não muda, antes de salvar', () => {
    for (const item of CLIENTE_DESDE_NAO_MUDA) contem(html, item);
  });

  teste('erro do banco aparece em frase, no topo', () => {
    const h = formClienteDesdeHtml({ assinatura: A, form: {}, erros: { geral: 'Sem conexão. Tente novamente.' } });
    contem(h, 'role="alert"');
    contem(h, 'Sem conexão');
  });

  teste('o nome é escapado', () => {
    const h = formClienteDesdeHtml({ assinatura: { ...A, paciente: { nome: '<b>x</b>' } }, form: {} });
    naoContem(h, '<b>x</b>');
  });

  teste('nenhuma mensagem técnica chega ao usuário', () => {
    igual(traduzirErroClienteDesde(new Error('cliente desde nao pode ser depois do inicio do periodo atual (06/08/2026)')),
          'A data não pode ser depois do início do período atual.');
    igual(traduzirErroClienteDesde(new Error('sem permissao comercial.editar')),
          'Sem permissão para alterar esta assinatura.');
    const t = traduzirErroClienteDesde(new Error('ERROR: 42501 something'));
    naoContem(t, '42501');
  });
});

// ───────────────────────────────────────────────────────────
grupo('cliente desde · a fiação', () => {
  teste('a ficha tem a ação ao lado da data', () => {
    const h = assinaturaHtml(A, '2026-09-11');
    contem(h, 'data-alterar-cliente-desde');
    contem(h, 'Cliente desde');
  });

  teste('o drawer chama a RPC, e não salvarAssinatura', () => {
    contem(DRAWER, 'dados.alterarClienteDesde(assinatura.id, data)');
    contem(DADOS, "sb.rpc('comercial_alterar_cliente_desde'");
  });

  teste('reabre com o que o banco confirmou, preservando paciente e plano', () => {
    contem(DRAWER, 'r?.assinatura ? { ...assinatura, ...r.assinatura } : assinatura');
  });

  teste('o toast diz o que aconteceu', () => {
    igual(MSG.clienteDesdeSalvo, '"Cliente desde" atualizado.');
    contem(DRAWER, 'r?.alterou ? MSG.clienteDesdeSalvo : MSG.clienteDesdeIgual');
  });

  teste('o "Editar assinatura" não carrega mais a data', () => {
    const patch = edicaoAssinaturaParaBanco(edicaoAssinaturaVazia(A));
    ok(!('data_inicio_original' in patch));
    naoContem(formEdicaoAssinaturaHtml({ assinatura: A, form: edicaoAssinaturaVazia(A) }), 'cmEaDesde');
  });
});

// ───────────────────────────────────────────────────────────
grupo('cliente desde · a RPC só toca a coluna', () => {
  const corpo = corpoRpc();

  teste('o único UPDATE muda só data_inicio_original', () => {
    const updates = corpo.match(/update\s+public\.\w+/gi) || [];
    igual(updates.join(','), 'update public.comercial_assinaturas');
    ok(/update public\.comercial_assinaturas\s+set data_inicio_original = p_data\s+where id = v_ass\.id/.test(corpo),
       'o SET tem uma coluna só');
  });

  teste('não toca em período, plano, valor nem no financeiro', () => {
    const upd = corpo.slice(corpo.indexOf('update public.comercial_assinaturas'), corpo.indexOf('returning * into v_ass;'));
    for (const col of ['inicio_periodo', 'fim_periodo', 'plano_id', 'valor_contratado', 'status']) {
      naoContem(upd, col);
    }
    naoContem(corpo, 'financeiro_lancamentos');
  });

  teste('a trilha é gravada ANTES do update, com quem, antes e depois', () => {
    ok(corpo.indexOf("'inicio_contrato_alterado'") < corpo.indexOf('update public.comercial_assinaturas'));
    contem(corpo, "jsonb_build_object('data_inicio_original', v_antes)");
    contem(corpo, "jsonb_build_object('data_inicio_original', p_data)");
    contem(corpo, "'inicio_contrato_alterado', auth.uid()");
  });

  teste('exige sessão, organização e comercial.editar', () => {
    contem(corpo, "if auth.uid() is null");
    contem(corpo, "'assinatura fora da organizacao'");
    contem(corpo, "tem_permissao('comercial.editar')");
    contem(corpo, 'for update');
  });

  teste('recusa passar do início do período, e não grava a mesma data', () => {
    contem(corpo, 'if p_data > v_ass.inicio_periodo then');
    contem(corpo, "'alterou', false");
  });

  teste('é SECURITY DEFINER e fechada para anon', () => {
    contem(SQL, 'security definer');
    contem(SQL, 'revoke all on function public.comercial_alterar_cliente_desde(uuid, date) from public, anon;');
    contem(SQL, 'grant execute on function public.comercial_alterar_cliente_desde(uuid, date) to authenticated;');
  });
});

// ───────────────────────────────────────────────────────────
grupo('cliente desde · a trava e o CHECK', () => {
  teste('o gatilho recusa mudar a coluna por outro caminho', () => {
    contem(SQL, 'before update of data_inicio_original on public.comercial_assinaturas');
    contem(SQL, "current_setting('comercial.cliente_desde_pela_rpc', true)");
    // A RPC se autoriza só na própria transação, e desliga logo depois.
    contem(corpoRpc(), "set_config('comercial.cliente_desde_pela_rpc', 'sim', true)");
    contem(corpoRpc(), "set_config('comercial.cliente_desde_pela_rpc', '', true)");
  });

  teste('o CHECK aprende a ação sem perder as cinco de antes', () => {
    for (const acao of ['renovacao_programada', 'renovacao_cancelada', 'renovada',
                        'bonificada', 'bonificacao_desfeita', 'inicio_contrato_alterado']) {
      contem(SQL, `'${acao}'`);
    }
  });

  teste('há guarda antes de mexer no CHECK', () => {
    ok(SQL.indexOf('do $guarda$') < SQL.indexOf('drop constraint if exists comercial_assinatura_auditoria_acao_check'));
  });

  teste('o desfazer não apaga a trilha para caber no CHECK antigo', () => {
    contem(DESFAZER, "where acao = 'inicio_contrato_alterado'");
    contem(DESFAZER, 'drop function if exists public.comercial_alterar_cliente_desde(uuid, date);');
    contem(DESFAZER, 'drop trigger if exists trg_comercial_cliente_desde_so_pela_rpc');
    naoContem(DESFAZER, 'delete from');
  });

  teste('a conferência 137 roda os casos e se desfaz sozinha', () => {
    contem(CONF, "raise exception 'desfazer_teste_137'");
    for (const caso of ['CASO A', 'CASO B', 'CASO C', 'CASO D', 'SEM RASTRO']) contem(CONF, caso);
  });
});
