// ═══════════════════════════════════════════════════════════
// /api/gerar-treino.js — Vercel Serverless Function
// Recebe critérios (músculos-alvo + prioridade, dias/semana, objetivo,
// nível, tempo, observações) + a biblioteca de exercícios do nutri, e pede
// à Anthropic que monte um treino inteligente escolhendo APENAS exercícios
// dessa biblioteca. Devolve a estrutura + um relatório. A chave nunca vai
// para o navegador (ANTHROPIC_API_KEY na Vercel).
// ═══════════════════════════════════════════════════════════

const METODOS_PERMITIDOS = ['Normal', 'Drop-set', 'Rest-pause', 'Piramidal', 'Isometria', 'Cluster', 'FST-7'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada na Vercel' });
  }

  try {
    const { criterios, exercicios } = req.body || {};
    if (!criterios || !Array.isArray(exercicios) || !exercicios.length) {
      return res.status(400).json({ error: 'Envie os critérios e a biblioteca de exercícios (não vazia).' });
    }

    const musculos = (criterios.musculos || [])
      .map(m => `- ${m.grupo}: prioridade ${m.prioridade}`).join('\n') || '- (nenhum priorizado)';
    const dias = Math.max(2, Math.min(7, Number(criterios.dias) || 3));

    // Biblioteca compacta: só o que a IA precisa para escolher (id + nome + grupo).
    const bib = exercicios.slice(0, 300)
      .map(e => `${e.id} | ${e.nome}${e.grupo ? ` | ${e.grupo}` : ''}`).join('\n');

    const prompt = `Você é um treinador especialista em musculação (hipertrofia, força, emagrecimento e periodização). Crie um treino INTELIGENTE, equilibrado e individualizado — nada de divisão fixa ou exercícios aleatórios.

REGRA MAIS IMPORTANTE: não comece escolhendo uma divisão pronta (ABC, Upper/Lower, PPL). Comece pelos DOIS critérios e deixe a estrutura nascer deles:
1) Quais músculos são prioridade (recebem mais frequência, volume e vêm primeiro na ordem).
2) Quantos dias por semana o aluno treina.

CRITÉRIOS DESTE ALUNO
Músculos-alvo e prioridade:
${musculos}
Dias por semana: ${dias}
Objetivo: ${criterios.objetivo || 'hipertrofia'}
Nível: ${criterios.nivel || 'intermediário'}
Tempo por sessão: ${criterios.tempoMin ? criterios.tempoMin + ' min' : 'sem limite rígido'}
Observações (equipamentos/lesões/preferências): ${criterios.obs || 'nenhuma'}

COMO PENSAR (nesta ordem): identifique prioridades → distribua os grupos pelos ${dias} dias respeitando recuperação (48h para o mesmo grupo) → calcule o volume semanal (mais séries para prioritários, manutenção para secundários, sem concentrar tudo num dia) → só então escolha os exercícios. Ordem dentro do dia: compostos/multiarticulares primeiro, isoladores depois. Equilibre agonista/antagonista e superiores/inferiores. Respeite o tempo.

EXERCÍCIOS DISPONÍVEIS (escolha SOMENTE destes — use o id exato). Formato "id | nome | grupo":
${bib}

Se faltar exercício para um grupo prioritário, use o mais próximo disponível e comente na justificativa.

Métodos permitidos por exercício (campo "metodo"): ${METODOS_PERMITIDOS.join(', ')}. Use técnicas avançadas só quando fizer sentido (e explique). NÃO use bi-set/tri-set/super-set.

RESPONDA APENAS com um JSON válido (sem markdown, sem texto antes/depois) neste formato exato:
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
  "relatorio": {
    "estrutura": "nº de treinos, distribuição semanal e o que cada dia trabalha",
    "volume": "séries semanais por grupo e por que cada um recebeu esse volume",
    "justificativa": "por que essa divisão, por que cada músculo nessa frequência, como a recuperação foi considerada",
    "tempo_estimado": "estimativa de duração por sessão"
  }
}

Regras do JSON: use "dia" A, B, C... na ordem; ${dias} dias no total; "series" inteiro; "repeticoes" texto (faixa); "exercicio_id" SEMPRE um id da lista acima; "metodo" um dos permitidos.`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(502).json({ error: 'Falha na Anthropic: ' + aiResp.status, detalhe: errText });
    }

    const data = await aiResp.json();
    const textoIa = (data.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('')
      .replace(/```json|```/g, '').trim();

    let plano;
    try { plano = JSON.parse(textoIa); }
    catch { return res.status(502).json({ error: 'IA retornou formato inesperado', bruto: textoIa.slice(0, 500) }); }

    // Sanitiza: mantém só exercícios cujo id existe na biblioteca enviada.
    const idsValidos = new Set(exercicios.map(e => e.id));
    (plano.dias || []).forEach(d => {
      d.exercicios = (d.exercicios || []).filter(ex => idsValidos.has(ex.exercicio_id)).map(ex => ({
        ...ex,
        metodo: METODOS_PERMITIDOS.includes(ex.metodo) ? ex.metodo : 'Normal',
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
