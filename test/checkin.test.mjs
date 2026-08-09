// ═══════════════════════════════════════════════════════════
// CHECK-INS — Etapa 1 (fundação)
// ═══════════════════════════════════════════════════════════
// Duas naturezas, e vale saber qual é qual:
//
//   COMPORTAMENTO — frequência, validação, snapshot. Funções puras, exercidas
//   de verdade.
//
//   REGRA ESCRITA — RLS, FK, índices únicos, ordem da transação. O dublê não
//   imita o Postgres, e testar SQL contra dublê seria testar o dublê. O que se
//   garante aqui é que a regra ESTÁ NO ARQUIVO e não foi afrouxada sem alguém
//   perceber. A prova de comportamento é a conferência 64/65, em sessão real.

import { grupo, teste, ok, igual, contem, naoContem } from './runner.mjs';
import { readFileSync } from 'node:fs';
import {
  TIPOS, FREQUENCIAS, calcularProximaOcorrencia, ultimoDiaDoMes, iso10,
  situacaoDaOcorrencia, diasDeAtraso, validarConfiguracao, validarAtribuicao,
  validarResposta, validarRespostas, montarSnapshot, traduzirErroCheckin,
} from '../js/checkin.js';

const sql     = readFileSync(new URL('../db/checkin_schema.sql', import.meta.url), 'utf8');
const desfaz  = readFileSync(new URL('../db/checkin_schema_desfazer.sql', import.meta.url), 'utf8');
const dados   = readFileSync(new URL('../js/checkin-data.js', import.meta.url), 'utf8');
// Só o corpo executável: os comentários explicam justamente o que não entra.
const codigo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

const MODELO = { id: 'm1', nome: 'Check-in semanal', descricao: 'Como foi a semana' };
const PERGUNTAS = [
  { id: 'q2', texto: 'Sono', tipo: 'escala', obrigatoria: true, ordem: 2,
    configuracao: { min: 0, max: 10, label_min: 'Péssimo', label_max: 'Ótimo' } },
  { id: 'q1', texto: 'Fome', tipo: 'escala', obrigatoria: true, ordem: 1,
    configuracao: { min: 0, max: 10 } },
  { id: 'q3', texto: 'Aderência', tipo: 'multipla_escolha', obrigatoria: false, ordem: 3,
    configuracao: { opcoes: ['sempre', 'quase_sempre', 'as_vezes', 'nunca'] } },
];


// ═══════════════════════════════════════════════════════════
grupo('check-in · frequências', () => {

  teste('quinzenal é a cada 14 dias, não duas vezes por mês', () => {
    // A segunda leitura faria a data pular quando o mês tem cinco semanas, e
    // ninguém saberia dizer por quê.
    igual(FREQUENCIAS.quinzenal.dias, 14);
    // Quinta 06/08/2026, alvo quinta (4): semanal dá 13/08, quinzenal dá 20/08.
    igual(calcularProximaOcorrencia({ frequencia: 'semanal', dia_semana: 4 }, '2026-08-06'), '2026-08-13');
    igual(calcularProximaOcorrencia({ frequencia: 'quinzenal', dia_semana: 4 }, '2026-08-06'), '2026-08-20');
  });

  teste('semanal cai no próximo dia da semana, e hoje conta como o da semana que vem', () => {
    // 06/08/2026 é quinta. Alvo segunda (1) → 10/08.
    igual(calcularProximaOcorrencia({ frequencia: 'semanal', dia_semana: 1 }, '2026-08-06'), '2026-08-10');
    // Alvo quinta, hoje é quinta: a de hoje está sendo fechada agora.
    igual(calcularProximaOcorrencia({ frequencia: 'semanal', dia_semana: 4 }, '2026-08-06'), '2026-08-13');
  });

  teste('mensal: dia maior que o mês vira o ÚLTIMO dia, sem pular o mês', () => {
    // Um check-in mensal que some em fevereiro é um que o paciente aprende a
    // não esperar.
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 31 }, '2026-01-31'), '2026-02-28');
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 31 }, '2026-03-31'), '2026-04-30');
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 31 }, '2026-04-30'), '2026-05-31');
    // Ano bissexto.
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 30 }, '2028-01-31'), '2028-02-29');
    igual(ultimoDiaDoMes(2028, 2), 29);
    igual(ultimoDiaDoMes(2026, 2), 28);
  });

  teste('mensal ainda neste mês, se a data não passou', () => {
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 20 }, '2026-08-06'), '2026-08-20');
  });

  teste('manual não gera data — quem materializa é o profissional', () => {
    igual(calcularProximaOcorrencia({ frequencia: 'manual' }, '2026-08-06'), null);
    igual(FREQUENCIAS.manual.exige, null);
  });

  teste('configuração incoerente não produz data', () => {
    igual(calcularProximaOcorrencia({ frequencia: 'semanal' }, '2026-08-06'), null);
    igual(calcularProximaOcorrencia({ frequencia: 'mensal', dia_mes: 99 }, '2026-08-06'), null);
    igual(calcularProximaOcorrencia({ frequencia: 'inventada', dia_semana: 1 }, '2026-08-06'), null);
  });

  teste('a data sai no fuso local, não em UTC', () => {
    // toISOString() converteria e, a leste de Greenwich, a meia-noite local
    // viraria o dia anterior.
    igual(iso10(new Date(2026, 7, 6)), '2026-08-06');
    naoContem(readFileSync(new URL('../js/checkin.js', import.meta.url), 'utf8'),
              'toISOString().slice(0, 10)');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · a atribuição exige o que a frequência pede', () => {

  teste('semanal e quinzenal exigem dia da semana', () => {
    ok(!validarAtribuicao({ frequencia: 'semanal' }).ok);
    ok(!validarAtribuicao({ frequencia: 'quinzenal' }).ok);
    ok(validarAtribuicao({ frequencia: 'semanal', dia_semana: 1 }).ok);
  });

  teste('mensal exige dia do mês', () => {
    ok(!validarAtribuicao({ frequencia: 'mensal' }).ok);
    ok(validarAtribuicao({ frequencia: 'mensal', dia_mes: 15 }).ok);
  });

  teste('manual não tem dia fixo', () => {
    ok(validarAtribuicao({ frequencia: 'manual' }).ok);
    ok(!validarAtribuicao({ frequencia: 'manual', dia_semana: 1 }).ok);
  });

  teste('combinação inválida não passa em silêncio', () => {
    // Semanal sem dia nunca produziria ocorrência, e o problema só apareceria
    // semanas depois como "o check-in não chegou".
    ok(!validarAtribuicao({ frequencia: 'semanal', dia_mes: 10 }).ok);
    ok(!validarAtribuicao({ frequencia: 'mensal', dia_semana: 3 }).ok);
  });

  teste('e o banco confere a mesma coerência', () => {
    contem(codigo, 'cka_coerencia_check');
    contem(codigo, "(frequencia in ('semanal', 'quinzenal') and dia_semana is not null and dia_mes is null)");
    contem(codigo, "or (frequencia = 'mensal' and dia_mes is not null and dia_semana is null)");
    contem(codigo, "or (frequencia = 'manual'  and dia_semana is null and dia_mes is null)");
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · configuração da pergunta', () => {

  teste('escala precisa de min e max, com min menor', () => {
    ok(validarConfiguracao('escala', { min: 0, max: 10 }).ok);
    ok(!validarConfiguracao('escala', { min: 0 }).ok);
    contem(validarConfiguracao('escala', { min: 10, max: 0 }).erros[0], 'menor que o máximo');
  });

  teste('múltipla escolha precisa de opções, sem repetição', () => {
    ok(validarConfiguracao('multipla_escolha', { opcoes: ['a', 'b'] }).ok);
    ok(!validarConfiguracao('multipla_escolha', { opcoes: [] }).ok);
    ok(!validarConfiguracao('multipla_escolha', {}).ok);
    contem(validarConfiguracao('multipla_escolha', { opcoes: ['a', 'a'] }).erros[0], 'repetidas');
  });

  teste('número aceita min/max opcionais; texto não precisa de nada', () => {
    ok(validarConfiguracao('numero', {}).ok);
    ok(validarConfiguracao('numero', { min: 30, max: 200, unidade: 'kg' }).ok);
    ok(!validarConfiguracao('numero', { min: 200, max: 30 }).ok);
    ok(validarConfiguracao('texto_curto', {}).ok);
    ok(validarConfiguracao('texto_longo', {}).ok);
  });

  teste('tipo desconhecido é recusado', () => {
    ok(!validarConfiguracao('inventado', {}).ok);
    igual(Object.keys(TIPOS).sort(),
          ['escala', 'multipla_escolha', 'numero', 'sim_nao', 'texto_curto', 'texto_longo']);
  });

  teste('o banco só garante que é objeto — o resto é do serviço', () => {
    // Um CHECK que cobrisse todo o JSONB viraria expressão ilegível que
    // ninguém mais mexe.
    contem(codigo, "check (jsonb_typeof(configuracao) = 'object')");
    contem(codigo, "check (tipo in ('escala', 'multipla_escolha', 'sim_nao', 'numero',");
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · o snapshot', () => {

  teste('guarda modelo e perguntas, na ordem', () => {
    const s = montarSnapshot(MODELO, PERGUNTAS);
    igual(s.modelo, { id: 'm1', nome: 'Check-in semanal', descricao: 'Como foi a semana' });
    igual(s.perguntas.map(p => p.id), ['q1', 'q2', 'q3'], 'ordenado por ordem, não pela entrada');
    igual(s.perguntas[0].configuracao, { min: 0, max: 10 });
    igual(s.perguntas[1].texto, 'Sono');
  });

  teste('só perguntas ATIVAS entram', () => {
    // Desativar tira dos check-ins novos sem tocar nos antigos.
    const s = montarSnapshot(MODELO, [...PERGUNTAS, { id: 'q9', texto: 'Velha', tipo: 'sim_nao', ativo: false, ordem: 9 }]);
    igual(s.perguntas.map(p => p.id), ['q1', 'q2', 'q3']);
    contem(codigo, 'where modelo_id = v_mod.id and ativo');
  });

  teste('não carrega dado administrativo', () => {
    const s = montarSnapshot(MODELO, PERGUNTAS);
    igual(Object.keys(s.perguntas[0]).sort(),
          ['configuracao', 'id', 'obrigatoria', 'ordem', 'texto', 'tipo', 'unidade']);
    for (const campo of ['nutri_id', 'modelo_id', 'criado_em', 'atualizado_em', 'ativo']) {
      ok(!(campo in s.perguntas[0]), `${campo} não é do questionário que o paciente vê`);
    }
  });

  teste('editar o modelo depois NÃO alcança a ocorrência antiga', () => {
    // A imutabilidade é estrutural: não há caminho de uma edição até uma
    // ocorrência já criada. O snapshot é uma cópia, não uma referência.
    const antes = montarSnapshot(MODELO, PERGUNTAS);
    const congelado = JSON.parse(JSON.stringify(antes));
    PERGUNTAS[1].texto = 'Como está sua fome à noite?';
    igual(antes.perguntas.find(p => p.id === 'q1').texto, congelado.perguntas.find(p => p.id === 'q1').texto);
    PERGUNTAS[1].texto = 'Fome';   // devolve para os outros testes
    // E a validação da RPC lê do snapshot, nunca da pergunta atual.
    // O corte para no `$fn$;` da própria função: até o fim do arquivo pegaria
    // a consulta de conferência, que conta perguntas e não valida nada.
    contem(codigo, "jsonb_array_elements(v_oc.snapshot -> 'perguntas')");
    const fin = codigo.slice(codigo.indexOf('function public.finalizar_checkin'));
    const corpoFin = fin.slice(0, fin.indexOf('$fn$;') + 5);
    ok(!/from public\.checkin_perguntas/.test(corpoFin),
       'finalizar não pode consultar a pergunta de hoje');
  });

  teste('o banco exige que o snapshot tenha o array', () => {
    contem(codigo, "check (jsonb_typeof(snapshot -> 'perguntas') = 'array')");
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · validação da resposta', () => {

  const q = (extra) => ({ tipo: 'escala', configuracao: { min: 0, max: 10 }, ...extra });

  teste('obrigatória vazia é recusada; opcional vazia passa', () => {
    ok(!validarResposta(q({ obrigatoria: true }), null).ok);
    ok(validarResposta(q({ obrigatoria: false }), null).ok);
    ok(validarResposta(q({ obrigatoria: false }), undefined).ok);
  });

  teste('tipo errado é recusado', () => {
    ok(!validarResposta(q(), 'sete').ok);
    ok(!validarResposta({ tipo: 'sim_nao' }, 'sim').ok);
    ok(validarResposta({ tipo: 'sim_nao' }, true).ok);
    ok(!validarResposta({ tipo: 'texto_curto' }, 5).ok);
  });

  teste('escala fora do intervalo é recusada', () => {
    ok(validarResposta(q(), 7).ok);
    contem(validarResposta(q(), 11).erro, 'máximo é 10');
    contem(validarResposta(q(), -1).erro, 'mínimo é 0');
    // Os extremos valem.
    ok(validarResposta(q(), 0).ok);
    ok(validarResposta(q(), 10).ok);
  });

  teste('opção inexistente é recusada', () => {
    const p = { tipo: 'multipla_escolha', configuracao: { opcoes: ['sim', 'nao'] } };
    ok(validarResposta(p, 'sim').ok);
    contem(validarResposta(p, 'talvez').erro, 'uma das opções');
  });

  teste('o conjunto inteiro contra o snapshot', () => {
    const s = montarSnapshot(MODELO, PERGUNTAS);
    const bom = validarRespostas(s, { q1: 5, q2: 8, q3: 'sempre' });
    ok(bom.ok);
    const ruim = validarRespostas(s, { q1: 99, q3: 'nunca_mesmo' });
    ok(!ruim.ok);
    igual(Object.keys(ruim.erros).sort(), ['q1', 'q2', 'q3']);
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · "atrasado" é derivado, nunca gravado', () => {

  const AGORA = new Date('2026-08-10T12:00:00');

  teste('disponível fora do prazo vira atrasado, sem mudar o status', () => {
    const oc = { status: 'disponivel', prazo_em: '2026-08-07T23:59:00' };
    igual(situacaoDaOcorrencia(oc, AGORA), 'atrasado');
    igual(oc.status, 'disponivel', 'o status no banco não muda');
    igual(diasDeAtraso(oc, AGORA), 2);
  });

  teste('dentro do prazo, e sem prazo, continuam disponíveis', () => {
    igual(situacaoDaOcorrencia({ status: 'disponivel', prazo_em: '2026-08-20T00:00:00' }, AGORA), 'disponivel');
    igual(situacaoDaOcorrencia({ status: 'disponivel', prazo_em: null }, AGORA), 'disponivel');
  });

  teste('respondido e cancelado não viram atrasado nunca', () => {
    igual(situacaoDaOcorrencia({ status: 'respondido', prazo_em: '2026-01-01T00:00:00' }, AGORA), 'respondido');
    igual(situacaoDaOcorrencia({ status: 'cancelado', prazo_em: '2026-01-01T00:00:00' }, AGORA), 'cancelado');
    igual(diasDeAtraso({ status: 'respondido', prazo_em: '2026-01-01T00:00:00' }, AGORA), 0);
  });

  teste('o banco não tem status "atrasado"', () => {
    contem(codigo, "check (status in ('agendado', 'disponivel', 'respondido', 'cancelado'))");
    ok(!/'atrasado'/.test(codigo), 'gravar atraso exigiria alguém passando para virar o estado');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · materialização (regra escrita)', () => {

  const f = codigo.slice(codigo.indexOf('function public.materializar_ocorrencia_checkin'));
  const corpo = f.slice(0, f.indexOf('$fn$;') + 5);

  teste('valida atribuição ativa, dono e modelo ativo', () => {
    contem(corpo, "raise exception 'checkin_atribuicao_inexistente'");
    contem(corpo, "v_at.nutri_id <> auth.uid()");
    contem(corpo, "raise exception 'checkin_atribuicao_inativa'");
    contem(corpo, "v_mod.status <> 'ativo'");
    contem(corpo, "raise exception 'checkin_modelo_arquivado'");
  });

  teste('o snapshot sai de perguntas ATIVAS, ordenadas', () => {
    contem(corpo, 'order by p.ordem, p.criado_em');
    contem(corpo, 'where modelo_id = v_mod.id and ativo');
    contem(corpo, "raise exception 'checkin_modelo_sem_perguntas'");
  });

  teste('idempotente: erro de unique não chega à aplicação', () => {
    // Um cron reexecutado ou um duplo clique produzem exatamente isto.
    contem(corpo, 'on conflict do nothing');
    contem(corpo, 'if v_oc.id is null then');
    contem(corpo, "where atribuicao_id = p_atribuicao and periodo = p_periodo and status <> 'cancelado'");
  });

  teste('uma ocorrência por chamada', () => {
    // Gerar o ano inteiro faria uma edição de modelo em março reescrever o
    // significado de dezembro.
    igual((corpo.match(/insert into public\.checkin_ocorrencias/g) || []).length, 1);
    ok(!/loop|generate_series/.test(corpo));
  });

  teste('o índice único é a garantia, e ignora cancelado', () => {
    contem(codigo, 'create unique index if not exists uniq_cko_periodo');
    contem(codigo, "on public.checkin_ocorrencias (atribuicao_id, periodo)\n  where status <> 'cancelado'");
  });

  teste('nada nesta etapa chama a materialização sozinho', () => {
    // A Etapa 2 escolhe entre cron, Edge Function ou sob demanda sem mudar o
    // modelo — é justamente para isso que a função existe agora.
    //
    // A conferência ignora COMENTÁRIOS: o serviço cita "cron" justamente para
    // explicar que o agendamento não mora nele, e uma guarda que proíbe
    // explicar é uma guarda que se resolve apagando a explicação.
    const semComentario = dados
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    contem(dados, "sb.rpc('materializar_ocorrencia_checkin'");
    ok(!/setInterval|setTimeout|cron/i.test(semComentario),
       'nenhum agendador na fundação');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · finalização e concorrência (regra escrita)', () => {

  const f = codigo.slice(codigo.indexOf('function public.finalizar_checkin'));
  const corpo = f.slice(0, f.indexOf('$fn$;') + 5);

  teste('trava a ocorrência ANTES de validar ou inserir', () => {
    // Sem o lock, duas abas validariam, as duas inseririam, e a segunda só
    // descobriria no unique — com metade do trabalho feito.
    const iLock = corpo.indexOf('for update');
    const iValida = corpo.indexOf('jsonb_array_elements');
    const iInsert = corpo.indexOf('insert into public.checkin_respostas');
    ok(iLock > -1 && iLock < iValida, 'o lock vem antes da validação');
    ok(iValida < iInsert, 'valida antes de gravar');
  });

  teste('o status muda por ÚLTIMO, e só se ainda estava disponível', () => {
    const iInsert = corpo.indexOf('insert into public.checkin_respostas');
    const iUpdate = corpo.indexOf('update public.checkin_ocorrencias');
    ok(iInsert < iUpdate);
    contem(corpo, "where id = v_oc.id and status = 'disponivel'");
    contem(corpo, "if not found then raise exception 'checkin_ja_finalizado'");
  });

  teste('segunda finalização falha, e sem respostas parciais', () => {
    contem(corpo, "if v_oc.status = 'respondido' then raise exception 'checkin_ja_finalizado'");
    // A função inteira é uma transação: exceção desfaz tudo.
    contem(codigo, 'create unique index if not exists uniq_ckr_pergunta');
    contem(codigo, 'on public.checkin_respostas (ocorrencia_id, pergunta_id)');
  });

  teste('valida obrigatória, tipo, intervalo e opção', () => {
    contem(corpo, "raise exception 'checkin_obrigatoria_faltando:%'");
    contem(corpo, "raise exception 'checkin_tipo_invalido:%'");
    contem(corpo, "raise exception 'checkin_fora_do_intervalo:%'");
    contem(corpo, "raise exception 'checkin_opcao_invalida:%'");
  });

  teste('resolve o paciente pela SESSÃO, não por parâmetro', () => {
    contem(corpo, 'v_eu := public.paciente_do_auth()');
    contem(corpo, "if v_eu is null then raise exception 'checkin_sem_paciente'");
    contem(corpo, 'where id = p_ocorrencia and paciente_id = v_eu');
    ok(!/p_paciente/.test(corpo), 'paciente por parâmetro seria escolher de quem é o check-in');
  });

  teste('o tipo gravado é o do SNAPSHOT, não o da pergunta de hoje', () => {
    contem(corpo, "v_tipo := v_p ->> 'tipo'");
    contem(corpo, 'insert into public.checkin_respostas (ocorrencia_id, pergunta_id, tipo, valor)');
    contem(corpo, 'values (v_oc.id, v_id::uuid, v_tipo, v_val)');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · a pergunta não some (regra escrita)', () => {

  teste('a FK da resposta é RESTRICT', () => {
    // Pergunta usada em resposta não pode ser apagada — a identidade
    // longitudinal depende de ela continuar existindo.
    contem(codigo, 'pergunta_id uuid not null references public.checkin_perguntas(id) on delete restrict');
    ok(!/references public\.checkin_perguntas\(id\) on delete cascade/.test(codigo));
  });

  teste('a pergunta tem soft delete', () => {
    contem(codigo, 'ativo boolean not null default true');
    contem(dados, 'export async function desativarPergunta');
    ok(!/export async function excluirPergunta/.test(dados),
       'não existe excluir de propósito — desativar é o caminho');
  });

  teste('pergunta inativa continua referenciável e comparável', () => {
    // Sai de snapshots novos, mas as respostas antigas continuam apontando
    // para ela e continuam na mesma série.
    contem(dados, "update({ ativo: false })");
    contem(dados, 'export async function serieDaPergunta');
    contem(codigo, 'create index if not exists idx_ckr_longitudinal');
  });

  teste('a regra da identidade longitudinal está registrada', () => {
    contem(sql, 'variavel longitudinal');
    contem(dados, 'VARIÁVEL LONGITUDINAL');
    contem(dados, 'deve gerar');
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · RLS (regra escrita)', () => {

  teste('as seis tabelas têm RLS', () => {
    for (const t of ['checkin_modelos', 'checkin_perguntas', 'checkin_atribuicoes',
                     'checkin_ocorrencias', 'checkin_respostas', 'checkin_auditoria']) {
      contem(codigo, `alter table public.${t}`);
      contem(codigo, 'enable row level security');
    }
  });

  teste('o paciente lê só as próprias ocorrências, e só as que estão em jogo', () => {
    const p = codigo.slice(codigo.indexOf('create policy cko_paciente_select'));
    const c = p.slice(0, p.indexOf(';') + 1);
    contem(c, 'for select to authenticated');
    contem(c, 'paciente_id = public.paciente_do_auth()');
    contem(c, "status in ('disponivel', 'respondido')");
  });

  teste('o paciente NÃO escreve em lugar nenhum', () => {
    for (const cmd of ['insert', 'update', 'delete']) {
      ok(!new RegExp(`create policy \\w*paciente\\w*_${cmd}`).test(codigo),
         `policy de ${cmd} para paciente não pode existir`);
    }
    // E respostas não têm policy de escrita para ninguém — nem o profissional.
    const r = codigo.slice(codigo.indexOf('create policy ckr_nutri_select'));
    ok(!/create policy ckr_\w+_(insert|update|delete)/.test(r));
  });

  teste('o paciente não lê modelo, pergunta nem atribuição', () => {
    for (const t of ['ckm', 'ckp', 'cka']) {
      ok(!new RegExp(`create policy ${t}_paciente`).test(codigo),
         'o snapshot já traz o que ele precisa, sem os campos administrativos');
    }
  });

  teste('não dá para atribuir a paciente de outro profissional', () => {
    const p = codigo.slice(codigo.indexOf('create policy cka_nutri_insert'));
    const c = p.slice(0, p.indexOf(';') + 1);
    contem(c, 'from public.pacientes p');
    contem(c, 'p.id = paciente_id and p.nutri_id = auth.uid()');
    contem(c, 'm.id = modelo_id and m.nutri_id = auth.uid()');
  });

  teste('o vínculo auth→paciente é o consolidado', () => {
    contem(codigo, 'public.paciente_do_auth()');
    ok(!/create or replace function public\.paciente_do_auth/.test(codigo));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · histórico preservado (regra escrita)', () => {

  teste('arquivar modelo não apaga nada', () => {
    contem(dados, 'export async function arquivarModelo');
    contem(dados, "editarModelo(id, { status: 'arquivado' })");
    const f = dados.slice(dados.indexOf('export async function arquivarModelo'));
    ok(!/\.delete\(/.test(f.slice(0, 300)));
    // E a materialização é quem recusa, no banco.
    contem(codigo, "raise exception 'checkin_modelo_arquivado'");
  });

  teste('desativar atribuição preserva o que já existe', () => {
    const f = dados.slice(dados.indexOf('export async function desativarAtribuicao'));
    const c = f.slice(0, f.indexOf('\n}'));
    contem(c, 'ativo: false');
    ok(!/\.delete\(/.test(c), 'não há limpeza automática');
    contem(c, 'proxima_ocorrencia_em: null');
  });

  teste('as FKs de ocorrência são RESTRICT — nada cai em cascata para o passado', () => {
    contem(codigo, 'atribuicao_id uuid not null references public.checkin_atribuicoes(id) on delete restrict');
    contem(codigo, 'modelo_id     uuid not null references public.checkin_modelos(id) on delete restrict');
    contem(codigo, 'paciente_id   uuid not null references public.pacientes(id) on delete restrict');
  });

  teste('cancelar libera o período, sem apagar', () => {
    const f = dados.slice(dados.indexOf('export async function cancelarOcorrencia'));
    const c = f.slice(0, f.indexOf('\n}'));
    contem(c, "update({ status: 'cancelado' })");
    contem(c, "neq('status', 'respondido')");
    ok(!/\.delete\(/.test(c));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · o desfazer não destrói resposta', () => {

  teste('por padrão só desliga: policies, gatilhos e funções', () => {
    const vivo = desfaz.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    contem(vivo, 'drop function if exists public.finalizar_checkin(uuid, jsonb);');
    contem(vivo, 'drop policy if exists cko_paciente_select');
    ok(!/drop table if exists public\.checkin_respostas/.test(vivo),
       'apagar o que o paciente escreveu não pode ser o padrão');
    contem(desfaz, '-- drop table if exists public.checkin_respostas   cascade;');
  });

  teste('RLS continua ligada depois do rollback', () => {
    // Sem policy e com RLS ligada ninguém lê nada — que é o estado seguro
    // para um módulo desligado.
    const vivo = desfaz.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    ok(!/disable row level security/.test(vivo));
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · nenhuma integração foi ligada', () => {

  teste('a fundação não escreve Timeline, notificação nem push', () => {
    const js = dados + readFileSync(new URL('../js/checkin.js', import.meta.url), 'utf8');
    for (const p of ['registrarEvento', 'paciente_notificacoes', 'enviar-push',
                     'CHECKIN_COMPLETED', 'CHECKIN_SENT']) {
      ok(!js.includes(p), `${p} é de etapa seguinte`);
      ok(!codigo.includes(p), `${p} não pode estar na migration`);
    }
  });

  teste('a ocorrência respondida já tem o que a Etapa 4 vai precisar', () => {
    // id, respondido_em e o nome do modelo dentro do snapshot — sem precisar
    // reconstruir significado histórico.
    contem(codigo, 'respondido_em timestamptz');
    contem(codigo, "'modelo', jsonb_build_object('id', v_mod.id, 'nome', v_mod.nome,");
    contem(dados, 'export async function ultimosRespondidos');
  });

  teste('a flag do Hub só ligou porque a aba faz alguma coisa', () => {
    // A regra do topo de paciente-modulos.js: "um módulo só aparece quando
    // está REALMENTE funcional". Ligou na Etapa 2, quando atribuir, gerar e
    // ler respostas passaram a existir. Este teste impede que ela volte a ser
    // promessa — flag ligada sem dispatch é aba cinza dentro do prontuário.
    const mod = readFileSync(new URL('../js/paciente-modulos.js', import.meta.url), 'utf8');
    const ficha = readFileSync(new URL('../js/ficha.js', import.meta.url), 'utf8');
    ok(/checkins:\s*true/.test(mod), 'a fundação está de pé');
    contem(ficha, "if (abaId === 'checkins')");
    contem(ficha, "import('./checkin-paciente-ui.js')");
  });
});


// ═══════════════════════════════════════════════════════════
grupo('check-in · mensagens', () => {
  teste('erro do banco vira frase de gente', () => {
    igual(traduzirErroCheckin('checkin_ja_finalizado'), 'Este check-in já foi respondido.');
    igual(traduzirErroCheckin('checkin_obrigatoria_faltando:q1'), 'Responda todas as perguntas obrigatórias.');
    contem(traduzirErroCheckin('checkin_fora_do_intervalo:q2'), 'fora do intervalo');
    contem(traduzirErroCheckin('new row violates row-level security policy'), 'Sem permissão');
    // Nada de vazar o identificador interno.
    naoContem(traduzirErroCheckin('checkin_obrigatoria_faltando:q1'), 'q1');
    naoContem(traduzirErroCheckin('duplicate key value violates unique constraint "x"'), 'constraint');
  });
});
