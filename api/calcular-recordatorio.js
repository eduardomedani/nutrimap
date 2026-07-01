// ═══════════════════════════════════════════════════════════
// /api/calcular-recordatorio.js  — Vercel Serverless Function
// Recebe o texto do recordatório, chama a Anthropic com a chave
// guardada em ANTHROPIC_API_KEY (variável de ambiente secreta),
// e devolve { kcal_total, prot_g, carb_g, gord_g, observacao }.
// A chave NUNCA vai pro navegador.
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada na Vercel' });
  }

  try {
    const { texto } = req.body || {};
    if (!texto || !texto.trim()) {
      return res.status(400).json({ error: 'Texto do recordatório vazio' });
    }

    const prompt = `Você é nutricionista. Abaixo está um recordatório alimentar de 24h escrito em texto livre por um paciente. Estime o total do DIA inteiro.

RECORDATÓRIO:
${texto}

Responda APENAS com um objeto JSON válido, sem markdown, sem texto antes ou depois, neste formato exato:
{"kcal_total": número, "prot_g": número, "carb_g": número, "gord_g": número, "observacao": "string curta sobre a confiabilidade da estimativa"}

Regras:
- Estime porções padrão quando o paciente não especificar quantidade.
- kcal_total = total do dia somando todas as refeições.
- Arredonde para inteiros.
- Na observacao, sinalize se o recordatório é vago (estimativa menos precisa) ou detalhado.`;

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(502).json({ error: 'Falha na Anthropic: ' + aiResp.status, detalhe: errText });
    }

    const data = await aiResp.json();
    const texto_ia = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(texto_ia);
    } catch {
      return res.status(502).json({ error: 'IA retornou formato inesperado', bruto: texto_ia });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: 'Erro interno: ' + e.message });
  }
}
