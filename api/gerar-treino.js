// ═══════════════════════════════════════════════════════════
// /api/gerar-treino.js — Vercel Serverless Function
// Gera/evolui/ajusta um treino via Anthropic, escolhendo APENAS exercícios
// da biblioteca do nutri. 3 modos:
//   criar   — do zero a partir de músculos-alvo + dias
//   evoluir — progride o treino atual usando as cargas registradas pelo aluno
//   ajustar — aplica um ajuste pontual descrito em texto, mexendo o mínimo
// A chave nunca vai para o navegador (ANTHROPIC_API_KEY na Vercel).
// ═══════════════════════════════════════════════════════════

const METODOS_PERMITIDOS = ['Normal', 'Drop-set', 'Rest-pause', 'Piramidal', 'Isometria', 'Cluster', 'FST-7'];

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

function formato(modo) {
  return `RESPONDA APENAS com um JSON válido (sem markdown, sem texto antes/depois) neste formato exato:
{
  "nome": "nome curto e descritivo do treino",
  "objetivo": "string",
  "dias": [
    {
      "dia": "A",
      "foco": "ex.: Peitoral + Tríceps",
      "exercicios": [
        { "exercicio_id": "id-da-lista", "series": 4, "repeticoes": "8-12", "descanso": "90s", "cadencia": "2-0-2", "rir": "1-2", "metodo": "Normal", "observacao": "" }
      ]
    }
  ],
  ${modo === 'evoluir' ? REL_EVOLUIR : REL_PADRAO}
}

Regras do JSON: use "dia" A, B, C... na ordem; "series" inteiro; "repeticoes" texto (faixa); "exercicio_id" SEMPRE um id da lista de exercícios disponíveis; "metodo" um de ${METODOS_PERMITIDOS.join(', ')} (NÃO use bi-set/tri-set/super-set).`;
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

function contextoEvoluir(treino, progressao) {
  return `MODO: EVOLUIR O TREINO ATUAL. Sua função NÃO é criar um treino novo — é evoluir a ficha de um aluno que já treina, como um treinador experiente revisando semanas de acompanhamento.

PRINCÍPIO PRINCIPAL: mantenha tudo que está funcionando; altere SOMENTE o que precisa evoluir, sempre com justificativa técnica. Continuidade e progressão, não um treino diferente.

ANTES DE MUDAR, analise: a divisão faz sentido? o volume está equilibrado? os músculos prioritários recebem estímulo suficiente com recuperação adequada (nunca o mesmo grupo fatigado em dias consecutivos)? há exercícios redundantes/muito parecidos, excesso de máquinas ou de isoladores, ausência de movimentos fundamentais? o tempo está adequado?

PODE evoluir: aumentar carga/reps, mudar faixa de reps, ajustar séries, reordenar exercícios, trocar exercícios ESTAGNADOS ou que geram dor, substituir equipamento indisponível, inserir técnica avançada (com benefício claro), corrigir desequilíbrios, melhorar o tempo.
NÃO faça: trocar exercício só para variar; mudar toda a divisão sem necessidade; aumentar volume indiscriminadamente; pôr técnica avançada em tudo; alterar exercícios que estão evoluindo bem.

FREQUÊNCIA: mantenha o MESMO número de dias. Se enxergar ganho em mudar a frequência, coloque isso APENAS em "sugestoes" do relatório — nunca aplique automaticamente.
MÚSCULOS PRIORITÁRIOS: dê preferência (frequência, volume, posição no treino, qualidade do estímulo), mas nunca aumente volume só por ser prioridade — respeite a recuperação.

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
    if (modo === 'evoluir') contexto = contextoEvoluir(treinoAtualTexto, progressaoTexto);
    else if (modo === 'ajustar') contexto = contextoAjustar(treinoAtualTexto, instrucao);
    else contexto = contextoCriar(criterios, dias);

    const bib = exercicios.slice(0, 200).map(e => `${e.id} | ${e.nome}${e.grupo ? ` | ${e.grupo}` : ''}`).join('\n');

    const prompt = `${PAPEL}

${contexto}

CONTEXTO DO ALUNO
Objetivo: ${criterios.objetivo || 'hipertrofia'}
Nível: ${criterios.nivel || 'intermediário'}
Tempo por sessão: ${criterios.tempoMin ? criterios.tempoMin + ' min' : 'sem limite rígido'}
Observações (equipamentos/lesões/preferências): ${criterios.obs || 'nenhuma'}

EXERCÍCIOS DISPONÍVEIS (escolha SOMENTE destes — use o id exato). Formato "id | nome | grupo":
${bib}

Se faltar exercício para um grupo, use o mais próximo disponível e comente no relatório.

${formato(modo)}`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
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
          ? 'A resposta da IA ficou muito longa e foi cortada. Tente com menos dias/músculos ou gere de novo.'
          : 'IA retornou formato inesperado. Tente gerar de novo.',
        bruto: textoIa.slice(0, 400),
      });
    }

    const idsValidos = new Set(exercicios.map(e => e.id));
    (plano.dias || []).forEach(d => {
      d.exercicios = (d.exercicios || []).filter(ex => idsValidos.has(ex.exercicio_id)).map(ex => ({
        ...ex, metodo: METODOS_PERMITIDOS.includes(ex.metodo) ? ex.metodo : 'Normal',
      }));
    });
    plano.dias = (plano.dias || []).filter(d => d.exercicios.length);

    if (!plano.dias.length) {
      return res.status(502).json({ error: 'A IA não conseguiu montar o treino com a sua biblioteca. Cadastre mais exercícios e tente de novo.' });
    }
    return res.status(200).json(plano);
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
}
