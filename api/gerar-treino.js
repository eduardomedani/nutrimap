// ═══════════════════════════════════════════════════════════
// /api/gerar-treino.js — Vercel Serverless Function
// Gera/evolui/ajusta um treino via Anthropic, escolhendo APENAS exercícios
// da biblioteca do nutri. 3 modos:
//   criar   — do zero a partir de músculos-alvo + dias
//   evoluir — progride o treino atual usando as cargas registradas pelo aluno
//   ajustar — aplica um ajuste pontual descrito em texto, mexendo o mínimo
// A chave nunca vai para o navegador (ANTHROPIC_API_KEY na Vercel).
//
// INVENTÁRIO DA ACADEMIA (opcional, `inventario` no corpo): quando vem, a IA
// tem de dizer em qual estação (EQ..) e puxador (PG..) cada exercício é feito,
// e o servidor DESCARTA o que não bater com um item disponível — listando o
// descarte em relatorio.descartados. Sem inventário, comportamento de antes.
// ═══════════════════════════════════════════════════════════

// Bi-set entra porque o app grava o par (A + B) — ver `par` no formato. Tri-set
// e super-set continuam fora: o app não tem como montá-los a partir da IA.
export const MAX_TOKENS = 12000;

const METODOS_PERMITIDOS = ['Normal', 'Bi-set', 'Drop-set', 'Rest-pause', 'Piramidal', 'Isometria', 'Cluster', 'FST-7'];

const REL_EVOLUIR = `"relatorio": {
    "mantidos": "exercícios mantidos e por quê (o que já vinha funcionando)",
    "alteracoes": "cada troca no formato 'Antigo → Novo: motivo técnico' (uma por linha); vazio se nada trocou",
    "progressoes": "aumentos de carga/séries, mudanças de faixa de reps/intensidade/técnica e por quê",
    "melhorias": "o que melhorou, por quê, e como contribui para o objetivo do aluno",
    "sugestoes": "oportunidades extras NÃO aplicadas (ex.: mudar a frequência) — apenas sugestão; vazio se não houver"
  }`;

const REL_PADRAO = `"relatorio": {
    "estrutura": "nº de treinos, distribuição semanal e o que cada dia trabalha",
    "volume": "séries semanais por grupo e por que cada um recebeu esse volume",
    "justificativa": "por que essa divisão/ajuste; como a recuperação foi considerada",
    "tempo_estimado": "estimativa de duração por sessão"
  }`;

function formato(modo, comInventario) {
  const campoEquip = comInventario ? ', "equipamento_id": "EQ31", "acessorio_id": "PG09"' : '';
  const regraEquip = comInventario
    ? ` "equipamento_id" SEMPRE o id (EQ..) de uma estação DISPONÍVEL do inventário onde o exercício é executado; "acessorio_id" o id (PG..) do puxador usado, ou "" se não usa puxador.`
    : '';
  return `RESPONDA APENAS com um JSON válido (sem markdown, sem texto antes/depois) neste formato exato:
{
  "nome": "nome curto e descritivo do treino",
  "objetivo": "string",
  "dias": [
    {
      "dia": "A",
      "foco": "ex.: Peitoral + Tríceps",
      "exercicios": [
        { "exercicio_id": "id-da-lista"${campoEquip}, "series": 4, "repeticoes": "8-12", "descanso": "90s", "cadencia": "2-0-2", "rir": "1-2", "metodo": "Normal", "observacao": "" },
        { "exercicio_id": "id-do-A"${campoEquip}, "series": 3, "repeticoes": "10-12", "descanso": "60s", "rir": "1", "metodo": "Bi-set",
          "par": { "exercicio_id": "id-do-B"${campoEquip}, "repeticoes": "10-12", "rir": "1" } }
      ]
    }
  ],
  ${modo === 'evoluir' ? REL_EVOLUIR : REL_PADRAO}
}

TAMANHO (a resposta tem limite e é cortada se passar): JSON compacto, sem espaços/quebras de linha desnecessários. OMITA campos vazios ("cadencia", "rir", "observacao", "acessorio_id" sem valor não entram). "observacao" no máximo 80 caracteres e só quando acrescenta algo. Cada campo do "relatorio" com no máximo 400 caracteres, em frases curtas; em listas (ex.: "alteracoes"), uma linha curta por item.

Regras do JSON: use "dia" A, B, C... na ordem; "series" inteiro; "repeticoes" texto (faixa); "exercicio_id" SEMPRE um id da lista de exercícios disponíveis;${regraEquip} "metodo" um de ${METODOS_PERMITIDOS.join(', ')} (NÃO use tri-set/super-set).
BI-SET: "metodo": "Bi-set" EXIGE o objeto "par" com o segundo exercício (B), diferente do A; o B faz as mesmas "series" do A e o "descanso" do A é o descanso APÓS o par. Exercício sem bi-set NÃO tem "par". No treino atual, bi-set aparece como bloco "Bi-set: A) … B) …" — mantenha os que estão funcionando; crie novo só com benefício claro (ex.: tempo curto, antagonistas).`;
}

// ── INVENTÁRIO DA ACADEMIA ─────────────────────────────────
// Vem do front (tabela academia_inventario, só os itens 'disponivel'). Quando
// presente, é a ÚNICA fonte do que existe: a IA tem de amarrar cada exercício
// a uma estação (e puxador) do inventário, e o servidor descarta o que não
// amarrar — a regra não depende da IA obedecer.
const REGRAS_INVENTARIO = `REGRAS DO INVENTÁRIO (obrigatórias):
1. Prescreva SOMENTE exercícios executáveis com as estações e puxadores DISPONÍVEIS acima. Não presuma máquina, banco, barra, anilha, rack ou acessório que não esteja listado. Itens "não confirmados" NÃO existem.
2. A biblioteca tem exercícios que esta academia NÃO comporta (ex.: "com barra" exigindo barra longa de carga + anilhas). Antes de escolher, confira se existe estação compatível. Se não houver, escolha outro exercício da biblioteca.
3. Distinga exercício, estação, puxador e pegada. Ex.: remada baixa na estação de cabo baixo (equipamento) + triângulo (acessório) + pegada neutra fechada (variação). Exercício de cabo/polia só com puxador compatível listado.
4. Use as observações de cada item (o que está "a confirmar", o que a estação NÃO faz).
5. Pegada aberta não trabalha exclusivamente costas superiores e pegada fechada não isola dorsal: ângulo do braço, trajetória, amplitude e ajustes alteram a ênfase. Não justifique escolha por "isolamento" que o equipamento não garante.

CRITÉRIOS PARA VARIAÇÕES DE AGACHAMENTO (pêndulo, hack, Smith/guiado, livre — use só as disponíveis):
- Nenhuma variação é superior em absoluto: escolha por objetivo, experiência, tolerância articular, técnica, amplitude, preferência e fadiga acumulada.
- Hipertrofia: todas podem ser eficazes com amplitude adequada, progressão e esforço suficiente. Não infira ativação pela aparência da máquina.
- Iniciante: a variante que permita aprender o padrão com segurança e controle (máquina guiada pode facilitar, não é obrigatória).
- Foco em quadríceps: pêndulo ou hack se confortáveis; Smith e livre também servem. Maior flexão de joelho tolerada aumenta a demanda de quadríceps.
- Foco em glúteos: profundidade tolerada e estratégia de movimento; não presuma que pés à frente ou hack invertido isolem glúteos/posteriores.
- Posteriores de coxa: agachamento NÃO substitui flexoras e extensão de quadril; não use hack invertido como exercício principal de posteriores.
- Agachamento livre com barra só se barra de carga, anilhas e rack estiverem DISPONÍVEIS; com halteres, goblet/agachamento com halter é possível.
- Redundância: não coloque pêndulo, hack, Smith e livre no mesmo treino por padrão; conte o volume total de padrões de agachamento e a recuperação.
- Dor ou limitação: não diagnostique; ajuste carga, amplitude ou variante e indique avaliação profissional quando necessário.`;

function linhaItem(i) {
  return [i.id, i.nome, i.categoria, i.grupos, i.exercicios, i.obs].map(s => String(s || '').trim()).filter(Boolean).join(' | ');
}

function blocoInventario(inv) {
  const est = inv.disponiveis.filter(i => i.tipo !== 'puxador');
  const pux = inv.disponiveis.filter(i => i.tipo === 'puxador');
  return `INVENTÁRIO DA ACADEMIA — a ÚNICA fonte do que existe. Formato "id | nome | categoria | grupos/pegada | exercícios possíveis | observações".
ESTAÇÕES DISPONÍVEIS:
${est.map(linhaItem).join('\n') || '(nenhuma)'}
PUXADORES DISPONÍVEIS:
${pux.map(linhaItem).join('\n') || '(nenhum)'}
NÃO CONFIRMADOS / INDISPONÍVEIS (tratar como inexistentes): ${inv.ausentes.length ? inv.ausentes.join('; ') : 'nenhum'}

${REGRAS_INVENTARIO}`;
}

/** Normaliza o que veio do front; null se não houver inventário utilizável. */
function lerInventario(bruto) {
  if (!bruto || !Array.isArray(bruto.disponiveis)) return null;
  const disponiveis = bruto.disponiveis
    .filter(i => i && typeof i.id === 'string' && i.id.trim() && i.nome)
    .slice(0, 150)
    .map(i => ({ ...i, id: i.id.trim().toUpperCase(), tipo: i.tipo === 'puxador' ? 'puxador' : 'equipamento' }));
  if (!disponiveis.some(i => i.tipo === 'equipamento')) return null;
  const ausentes = (Array.isArray(bruto.ausentes) ? bruto.ausentes : []).map(String).slice(0, 100);
  return { disponiveis, ausentes };
}

const PAPEL = `Você é um treinador especialista em musculação (hipertrofia, força, emagrecimento e periodização). Monte treinos inteligentes, equilibrados e individualizados — nada de divisão fixa ou exercícios aleatórios. Ordem dentro do dia: compostos/multiarticulares primeiro, isoladores depois. Equilibre agonista/antagonista e superiores/inferiores. Respeite o tempo. Use técnicas avançadas só quando fizer sentido (e explique na justificativa).`;

function contextoCriar(c, dias) {
  const musculos = (c.musculos || []).map(m => `- ${m.grupo}: prioridade ${m.prioridade}`).join('\n') || '- (nenhum priorizado)';
  return `MODO: CRIAR DO ZERO.
REGRA MAIS IMPORTANTE: não comece por uma divisão pronta (ABC, Upper/Lower, PPL). Comece pelos DOIS critérios e deixe a estrutura nascer deles:
1) Músculos prioritários (mais frequência, volume e ordem):
${musculos}
2) Dias por semana: ${dias}

Distribua os grupos pelos ${dias} dias respeitando recuperação (48h para o mesmo grupo), calcule o volume semanal (mais séries para prioritários, manutenção para secundários, sem concentrar num dia) e só então escolha os exercícios.`;
}

function contextoEvoluir(treino, progressao, musculos) {
  // Antes a regra abaixo falava em "músculos prioritários" sem nunca dizer
  // quais eram. Agora vêm da tela (opcional); sem eles, a IA deduz do treino.
  const prioridades = (musculos || []).length
    ? musculos.map(m => `- ${m.grupo}: prioridade ${m.prioridade}`).join('\n')
    : '- (não informados pelo profissional — deduza o foco do treino atual e mantenha-o)';
  return `MODO: EVOLUIR O TREINO ATUAL. Sua função NÃO é criar um treino novo — é evoluir a ficha de um aluno que já treina, como um treinador experiente revisando semanas de acompanhamento.

PRINCÍPIO PRINCIPAL: mantenha tudo que está funcionando; altere SOMENTE o que precisa evoluir, sempre com justificativa técnica. Continuidade e progressão, não um treino diferente.

ANTES DE MUDAR, analise: a divisão faz sentido? o volume está equilibrado? os músculos prioritários recebem estímulo suficiente com recuperação adequada (nunca o mesmo grupo fatigado em dias consecutivos)? há exercícios redundantes/muito parecidos, excesso de máquinas ou de isoladores, ausência de movimentos fundamentais? o tempo está adequado?

PODE evoluir: aumentar carga/reps, mudar faixa de reps, ajustar séries, reordenar exercícios, trocar exercícios ESTAGNADOS ou que geram dor, substituir equipamento indisponível, inserir técnica avançada (com benefício claro), corrigir desequilíbrios, melhorar o tempo.
NÃO faça: trocar exercício só para variar; mudar toda a divisão sem necessidade; aumentar volume indiscriminadamente; pôr técnica avançada em tudo; alterar exercícios que estão evoluindo bem.

FREQUÊNCIA: mantenha o MESMO número de dias. Se enxergar ganho em mudar a frequência, coloque isso APENAS em "sugestoes" do relatório — nunca aplique automaticamente.
MÚSCULOS PRIORITÁRIOS: dê preferência (frequência, volume, posição no treino, qualidade do estímulo), mas nunca aumente volume só por ser prioridade — respeite a recuperação. Prioridade nova não autoriza refazer a divisão: redistribua dentro dos MESMOS dias.
${prioridades}

Use as CARGAS REGISTRADAS para decidir a progressão: onde o aluno avançou, progrida; onde estagnou, ajuste ou troque.

TREINO ATUAL:
${treino}

CARGAS REGISTRADAS PELO ALUNO:
${progressao || 'Sem registros.'}`;
}

function contextoAjustar(treino, instrucao) {
  return `MODO: AJUSTAR O TREINO ATUAL.
Faça APENAS o ajuste pedido, mexendo o mínimo possível e mantendo o restante do treino igual (mesmos dias, mesma estrutura). Não recrie o treino.

AJUSTE SOLICITADO: ${instrucao}

TREINO ATUAL:
${treino}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada na Vercel' });

  try {
    const { modo = 'criar', criterios = {}, exercicios, treinoAtualTexto, progressaoTexto, instrucao } = req.body || {};
    const inventario = lerInventario((req.body || {}).inventario);
    if (!Array.isArray(exercicios) || !exercicios.length) {
      return res.status(400).json({ error: 'Envie a biblioteca de exercícios (não vazia).' });
    }
    if ((modo === 'evoluir' || modo === 'ajustar') && !treinoAtualTexto) {
      return res.status(400).json({ error: 'Treino base ausente.' });
    }
    if (modo === 'ajustar' && !instrucao) {
      return res.status(400).json({ error: 'Descreva o ajuste desejado.' });
    }

    const dias = Math.max(2, Math.min(7, Number(criterios.dias) || 3));
    let contexto;
    if (modo === 'evoluir') contexto = contextoEvoluir(treinoAtualTexto, progressaoTexto, criterios.musculos);
    else if (modo === 'ajustar') contexto = contextoAjustar(treinoAtualTexto, instrucao);
    else contexto = contextoCriar(criterios, dias);

    // Com inventário, o front manda mais candidatos (boa parte da biblioteca
    // não cabe na academia); o teto acompanha.
    const tetoBib = inventario ? 320 : 200;
    const bib = exercicios.slice(0, tetoBib)
      .map(e => [e.id, e.nome, e.grupo, e.equipamento].filter(Boolean).join(' | ')).join('\n');

    const trocaDoAtual = inventario && modo !== 'criar'
      ? '\nNo treino atual, todo exercício que NÃO for executável com o inventário deve ser substituído pelo equivalente executável mais próximo — registre cada troca (em "alteracoes" ou "justificativa").\n'
      : '';

    const prompt = `${PAPEL}

${contexto}
${trocaDoAtual}
CONTEXTO DO ALUNO
Objetivo: ${criterios.objetivo || 'hipertrofia'}
Nível: ${criterios.nivel || 'intermediário'}
Tempo por sessão: ${criterios.tempoMin ? criterios.tempoMin + ' min' : 'sem limite rígido'}
Observações (equipamentos/lesões/preferências): ${criterios.obs || 'nenhuma'}
${inventario ? `\n${blocoInventario(inventario)}\n` : ''}
EXERCÍCIOS DA BIBLIOTECA (escolha SOMENTE destes — use o id exato). Formato "id | nome | grupo | equipamento cadastrado":
${bib}

Se faltar exercício para um grupo, use o mais próximo disponível e comente no relatório.

${formato(modo, !!inventario)}`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      // 12000, não mais: o Evoluir (histórico, bi-set, aparelho) passou dos 8000
      // e era cortado. Dobrar arriscaria o tempo máximo da função na Vercel —
      // o grosso da economia vem das regras de TAMANHO no formato().
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(502).json({ error: 'Falha na Anthropic: ' + aiResp.status, detalhe: errText });
    }

    const data = await aiResp.json();
    const textoIa = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      .replace(/```json|```/g, '').trim();
    const ini = textoIa.indexOf('{');
    const fim = textoIa.lastIndexOf('}');
    const jsonStr = (ini >= 0 && fim > ini) ? textoIa.slice(ini, fim + 1) : textoIa;

    let plano;
    try {
      plano = JSON.parse(jsonStr);
    } catch {
      const truncado = data.stop_reason === 'max_tokens';
      return res.status(502).json({
        error: truncado
          ? (modo === 'criar'
              ? 'A resposta da IA ficou muito longa e foi cortada. Tente com menos dias/músculos ou gere de novo.'
              : 'A resposta da IA ficou muito longa e foi cortada. Gere de novo; se repetir, use um treino base com menos exercícios.')
          : 'IA retornou formato inesperado. Tente gerar de novo.',
        bruto: textoIa.slice(0, 400),
      });
    }

    const idsValidos = new Set(exercicios.map(e => e.id));
    const nomePorId = new Map(exercicios.map(e => [e.id, e.nome]));
    // Com inventário: o exercício só fica se apontar uma ESTAÇÃO disponível e,
    // se citar puxador, um puxador disponível. O que cair é contado e vai para
    // o relatório — o profissional precisa ver o buraco, não descobrir depois.
    const estacoes = new Set((inventario?.disponiveis || []).filter(i => i.tipo !== 'puxador').map(i => i.id));
    const puxadores = new Set((inventario?.disponiveis || []).filter(i => i.tipo === 'puxador').map(i => i.id));
    const descartados = [];
    const cabeNaAcademia = ex => {
      if (!inventario) return true;
      const eq = String(ex.equipamento_id || '').trim().toUpperCase();
      const pg = String(ex.acessorio_id || '').trim().toUpperCase();
      if (!estacoes.has(eq)) return false;
      if (pg && !puxadores.has(pg)) return false;
      ex.equipamento_id = eq;
      ex.acessorio_id = pg;
      return true;
    };
    const rotulo = ex => `${nomePorId.get(ex.exercicio_id) || ex.exercicio_id} (${ex.equipamento_id || 'sem estação'}${ex.acessorio_id ? ' + ' + ex.acessorio_id : ''})`;
    const desfeitos = [];
    // Bi-set só sobrevive inteiro: par existente na biblioteca, diferente do A
    // e (com inventário) executável. Par inválido desfaz o bi-set — o A fica
    // como exercício normal e o motivo vai para o relatório.
    const normalizarPar = (ex, dia) => {
      const par = ex.par && typeof ex.par === 'object' ? ex.par : null;
      const pediuBiset = ex.metodo === 'Bi-set' || !!par;
      if (!pediuBiset) { delete ex.par; return; }
      let motivo = '';
      if (!par || !idsValidos.has(par.exercicio_id)) motivo = 'segundo exercício ausente ou fora da biblioteca';
      else if (par.exercicio_id === ex.exercicio_id) motivo = 'A e B iguais';
      else if (!cabeNaAcademia(par)) motivo = `B fora do inventário: ${rotulo(par)}`;
      if (motivo) {
        desfeitos.push(`Dia ${dia}: ${nomePorId.get(ex.exercicio_id) || ex.exercicio_id} — ${motivo}`);
        delete ex.par;
        ex.metodo = 'Normal';
        return;
      }
      ex.metodo = 'Bi-set';
    };
    (plano.dias || []).forEach(d => {
      d.exercicios = (d.exercicios || []).filter(ex => idsValidos.has(ex.exercicio_id)).filter(ex => {
        if (cabeNaAcademia(ex)) return true;
        descartados.push(`Dia ${d.dia || '?'}: ${rotulo(ex)}`);
        return false;
      }).map(ex => {
        const out = { ...ex, metodo: METODOS_PERMITIDOS.includes(ex.metodo) ? ex.metodo : 'Normal' };
        normalizarPar(out, d.dia || '?');
        return out;
      });
    });
    plano.dias = (plano.dias || []).filter(d => d.exercicios.length);
    const avisos = [];
    if (descartados.length) avisos.push(`Removidos por não caberem no inventário da academia (revise o volume desses dias):\n${descartados.join('\n')}`);
    if (desfeitos.length) avisos.push(`Bi-sets desfeitos (o exercício A ficou como normal):\n${desfeitos.join('\n')}`);
    if (avisos.length) plano.relatorio = { ...(plano.relatorio || {}), descartados: avisos.join('\n\n') };

    if (!plano.dias.length) {
      return res.status(502).json({ error: inventario
        ? 'A IA não conseguiu montar o treino com a sua biblioteca dentro do inventário da academia. Confira o inventário em Exercícios → Minha academia e tente de novo.'
        : 'A IA não conseguiu montar o treino com a sua biblioteca. Cadastre mais exercícios e tente de novo.' });
    }
    return res.status(200).json(plano);
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
}
