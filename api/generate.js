// Vercel Serverless Function for Gemini API calls
// Keeps API key secure on server side

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { type, payload } = req.body;

    let result;
    switch (type) {
      case 'recognize':
        result = await recognizeCards(apiKey, payload);
        break;
      case 'scenario':
        result = await generateScenario(apiKey, payload);
        break;
      case 'backcasting':
        result = await generateBackcasting(apiKey, payload);
        break;
      case 'vignette':
        result = await generateVignette(apiKey, payload);
        break;
      case 'consequence':
        result = await generateConsequence(apiKey, payload);
        break;
      default:
        return res.status(400).json({ error: 'Unknown generation type' });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('Generation error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Call Gemini API
async function callGemini(apiKey, contents, systemInstruction = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = { contents };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Phase 1: Recognize cards from photo
async function recognizeCards(apiKey, payload) {
  const { imageBase64, mimeType } = payload;

  const systemInstruction = `You are a card recognition system. Analyze the image and identify the cards shown.

Look for these cards:
- Resources: "Abundance" or "Limits"
- System: "Stable" or "Breaks"
- Dominant Value: "Collective" or "Individual"
- Technology cards (2 of these): "Quantum", "Robotics", "Neurotech", "Biotech", "Climate Tech", "AGI"

Return ONLY valid JSON in this exact format:
{
  "resources": "abundance" or "limits",
  "system": "stable" or "breaks",
  "value": "collective" or "individual",
  "tech1": one of the technology names in lowercase,
  "tech2": another technology name in lowercase,
  "confidence": "high", "medium", or "low"
}

If you cannot read a card clearly, use null for that field.`;

  const contents = [{
    parts: [
      { text: "Identify the cards in this image and return the JSON." },
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64
        }
      }
    ]
  }];

  const result = await callGemini(apiKey, contents, systemInstruction);

  // Parse JSON from response
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('JSON parse error:', e);
  }

  return { error: 'Could not parse card recognition', raw: result };
}

// Phase 1: Generate 2050 scenario
async function generateScenario(apiKey, payload) {
  const { archetype, value, tech1, tech2, language, prompt } = payload;

  const systemInstruction = prompt || `You are a speculative futures writer creating a vivid scenario for the year 2050, focused on the Dutch migration sector.`;

  const userPrompt = `Generate a 2050 scenario with these parameters:
- Archetype: ${archetype}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}

Write 3-4 paragraphs (250-350 words) describing this future.`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}

// Phases 2-4: Generate backcasting narrative
async function generateBackcasting(apiKey, payload) {
  const { year, scenario2050, archetype, value, tech1, tech2, previousPhases, language, prompt } = payload;

  const speculationLevel = year === '2040' ? 'high' : year === '2035' ? 'medium' : 'low';

  const systemInstruction = prompt || `You are helping workshop participants understand how we might arrive at a 2050 future by looking backward through time.`;

  const previousContext = previousPhases ? `\n\nPrevious backcasting phases:\n${previousPhases}` : '';

  const userPrompt = `Describe the world in ${year}, explaining what developments led toward this 2050 scenario:

${scenario2050}

Parameters:
- Archetype: ${archetype}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Speculation level: ${speculationLevel}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}
${previousContext}

Provide:
1. Narrative (5-8 sentences)
2. Key Developments (5-7 bullets with causal explanations)
3. Causal Chain (1-2 sentences)
4. Opportunities (3 bullets)
5. Risks (2 bullets)`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}

// Phases 2-4: Generate vignette
async function generateVignette(apiKey, payload) {
  const { year, actor, lens, archetype, value, tech1, tech2, backcastingNarrative, language, prompt } = payload;

  const systemInstruction = prompt || `You are writing a short narrative vignette—a concrete scene that shows how a major force shapes an actor's reality.`;

  const userPrompt = `Write a vignette for:
- Year: ${year}
- Actor: ${actor}
- Lens: ${lens}
- Archetype: ${archetype}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}

Context from this era:
${backcastingNarrative}

Write 4-6 sentences. A snapshot scene, not analysis. Match the tone to the archetype.`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}

// Phase 6: Generate consequences and altered scenario
async function generateConsequence(apiKey, payload) {
  const { intervention, scenario2050, archetype, value, tech1, tech2, backcastingJourney, language, prompt } = payload;

  const systemInstruction = prompt || `You are analyzing how a strategic intervention made TODAY (2025) would ripple forward and alter the 2050 scenario.`;

  const userPrompt = `Analyze this intervention and rewrite the future:

INTERVENTION: ${intervention}

ORIGINAL 2050 SCENARIO:
${scenario2050}

BACKCASTING JOURNEY:
${backcastingJourney}

Parameters:
- Archetype: ${archetype}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}

Provide:
1. 2nd Order Effects (2 bullets)
2. 3rd Order Effects (2 bullets)
3. ELSA Implications (Ethical, Legal, Social, Accountability)
4. The Altered 2050 (2-3 paragraphs rewriting the original scenario)`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}
