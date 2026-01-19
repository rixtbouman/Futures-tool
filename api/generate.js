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
    const { type, payload, stream } = req.body;

    // Non-streaming requests (card recognition)
    if (!stream) {
      let result;
      switch (type) {
        case 'recognize':
          result = await recognizeCards(apiKey, payload);
          break;
        case 'recognizePerspective':
          result = await recognizePerspectiveCards(apiKey, payload);
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
    }

    // Streaming requests
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let streamParams;
    switch (type) {
      case 'scenario':
        streamParams = getScenarioParams(payload);
        break;
      case 'backcasting':
        streamParams = getBackcastingParams(payload);
        break;
      case 'vignette':
        streamParams = getVignetteParams(payload);
        break;
      case 'consequence':
        streamParams = getConsequenceParams(payload);
        break;
      default:
        res.write(`data: ${JSON.stringify({ error: 'Streaming not supported for this type' })}\n\n`);
        return res.end();
    }

    await streamGeminiResponse(apiKey, streamParams.contents, streamParams.systemInstruction, res);

  } catch (error) {
    console.error('Generation error:', error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
}

// Format sector knowledge for injection into prompts
function formatSectorKnowledge(sectorKnowledge) {
  if (!sectorKnowledge) return '';

  const sections = [];

  if (sectorKnowledge.organizational_context) {
    sections.push(`### Organizational Context\n${sectorKnowledge.organizational_context}`);
  }
  if (sectorKnowledge.migration_dimensions) {
    sections.push(`### Migration Dimensions\n${sectorKnowledge.migration_dimensions}`);
  }
  if (sectorKnowledge.stakeholders) {
    sections.push(`### Key Stakeholders\n${sectorKnowledge.stakeholders}`);
  }
  if (sectorKnowledge.challenges) {
    sections.push(`### Challenges\n${sectorKnowledge.challenges}`);
  }
  if (sectorKnowledge.opportunities) {
    sections.push(`### Opportunities\n${sectorKnowledge.opportunities}`);
  }
  if (sectorKnowledge.regulatory_context) {
    sections.push(`### Regulatory Context\n${sectorKnowledge.regulatory_context}`);
  }
  if (sectorKnowledge.compliance_areas) {
    sections.push(`### Compliance Areas\n${sectorKnowledge.compliance_areas}`);
  }
  if (sectorKnowledge.program_lines) {
    sections.push(`### Program Lines\n${sectorKnowledge.program_lines}`);
  }
  if (sectorKnowledge.strategic_context) {
    sections.push(`### Strategic Context\n${sectorKnowledge.strategic_context}`);
  }
  if (sectorKnowledge.strategic_questions) {
    sections.push(`### Strategic Questions\n${sectorKnowledge.strategic_questions}`);
  }
  if (sectorKnowledge.migration_journey_questions) {
    sections.push(`### Migration Journey Questions\n${sectorKnowledge.migration_journey_questions}`);
  }

  if (sections.length === 0) return '';

  return `\n\n---\n\n## SECTOR KNOWLEDGE: ${sectorKnowledge.sector_name || 'DUTCH MIGRATION'}\n\n${sections.join('\n\n')}\n\n---\n`;
}

// Format technology data for injection into prompts
function formatTechnologyData(technologyData) {
  if (!technologyData || !Array.isArray(technologyData) || technologyData.length === 0) return '';

  const techSections = technologyData.map(tech => {
    const parts = [`### ${tech.tech_name}`];

    if (tech.general_info) {
      parts.push(`**General Information:**\n${tech.general_info}`);
    }
    if (tech.applications) {
      parts.push(`**Applications:**\n${tech.applications}`);
    }
    if (tech.elsa_data) {
      parts.push(`**ELSA Considerations:**\n${tech.elsa_data}`);
    }

    return parts.join('\n\n');
  });

  return `\n\n---\n\n## TECHNOLOGY KNOWLEDGE\n\n${techSections.join('\n\n---\n\n')}\n\n---\n`;
}

// Call Gemini API
async function callGemini(apiKey, contents, systemInstruction = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

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

// Stream Gemini API response via SSE
async function streamGeminiResponse(apiKey, contents, systemInstruction, res) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

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
    res.write(`data: ${JSON.stringify({ error: `Gemini API error: ${error}` })}\n\n`);
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          if (jsonStr.trim() === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
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

// Recognize Actor/Lens cards for Perspective Snapshot
async function recognizePerspectiveCards(apiKey, payload) {
  const { imageBase64, mimeType } = payload;

  const systemInstruction = `You are a card recognition system. Analyze the image and identify the Actor and Lens cards shown.

Look for these cards:

ACTORS (identify one):
- "National Political Party"
- "Foreign State"
- "Citizens"
- "NGO"
- "Journalists"
- "Research Institution"
- "Local Government / Municipality"
- "EU Institution"
- "Big Tech"

LENSES (identify one):
- "Housing"
- "Law & Rights"
- "Election"
- "Public Opinion"
- "Labor"
- "Healthcare"
- "Family"
- "Education"
- "Transport"

Return ONLY valid JSON in this exact format:
{
  "actor": the actor name as shown above or null if not visible,
  "lens": the lens name as shown above or null if not visible,
  "confidence": "high", "medium", or "low"
}

If you cannot read a card clearly, use null for that field.`;

  const contents = [{
    parts: [
      { text: "Identify the Actor and Lens cards in this image and return the JSON." },
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

  return { error: 'Could not parse perspective card recognition', raw: result };
}

// Phase 1: Generate 2050 scenario
async function generateScenario(apiKey, payload) {
  const { archetype, resources, system, value, tech1, tech2, language, prompt, sectorKnowledge, technologyData } = payload;

  // Build system instruction with sector and technology knowledge
  const basePrompt = prompt || `You are a speculative futures writer creating a vivid scenario for the year 2050, focused on the Dutch migration sector.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

  const userPrompt = `Generate a 2050 scenario with these parameters:
- Archetype: ${archetype}
- Resources dimension: ${resources}
- System dimension: ${system}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}

Use the sector and technology knowledge provided to ground the scenario.`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}

// Phases 2-4: Generate backcasting narrative
async function generateBackcasting(apiKey, payload) {
  const { year, scenario2050, archetype, value, tech1, tech2, previousPhases, language, prompt, sectorKnowledge, technologyData } = payload;

  const speculationLevel = year === '2040' ? 'high' : year === '2035' ? 'medium' : 'low';

  // Build system instruction with sector and technology knowledge
  const basePrompt = prompt || `You are helping workshop participants understand how we might arrive at a 2050 future by looking backward through time.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

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

Use the sector and technology knowledge provided to ground the narrative.`;

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
  const { intervention, scenario2050, archetype, value, tech1, tech2, backcastingJourney, language, prompt, sectorKnowledge, technologyData } = payload;

  // Build system instruction with sector and technology knowledge
  const basePrompt = prompt || `You are analyzing how a strategic intervention made TODAY (2026) would ripple forward and alter the 2050 scenario.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

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

Use the sector and technology knowledge provided to ground the analysis.

OUTPUT FORMAT (use these exact headers):
## CONSEQUENCE OF THE INTERVENTION
## 2ND ORDER EFFECTS
## 3RD ORDER EFFECTS
## ELSA IMPLICATIONS
## THE ALTERED 2050 SCENARIO`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  return await callGemini(apiKey, contents, systemInstruction);
}

// ===== STREAMING PARAMETER HELPERS =====

function getScenarioParams(payload) {
  const { archetype, resources, system, value, tech1, tech2, language, prompt, sectorKnowledge, technologyData } = payload;

  const basePrompt = prompt || `You are a speculative futures writer creating a vivid scenario for the year 2050, focused on the Dutch migration sector.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

  const userPrompt = `Generate a 2050 scenario with these parameters:
- Archetype: ${archetype}
- Resources dimension: ${resources}
- System dimension: ${system}
- Value dimension: ${value}
- Technologies: ${tech1}, ${tech2}
- Language: ${language === 'nl' ? 'Dutch' : 'English'}

Use the sector and technology knowledge provided to ground the scenario.`;

  return { contents: [{ parts: [{ text: userPrompt }] }], systemInstruction };
}

function getBackcastingParams(payload) {
  const { year, scenario2050, archetype, value, tech1, tech2, previousPhases, language, prompt, sectorKnowledge, technologyData } = payload;

  const speculationLevel = year === '2040' ? 'high' : year === '2035' ? 'medium' : 'low';

  const basePrompt = prompt || `You are helping workshop participants understand how we might arrive at a 2050 future by looking backward through time.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

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

Use the sector and technology knowledge provided to ground the narrative.`;

  return { contents: [{ parts: [{ text: userPrompt }] }], systemInstruction };
}

function getVignetteParams(payload) {
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

  return { contents: [{ parts: [{ text: userPrompt }] }], systemInstruction };
}

function getConsequenceParams(payload) {
  const { intervention, scenario2050, archetype, value, tech1, tech2, backcastingJourney, language, prompt, sectorKnowledge, technologyData } = payload;

  const basePrompt = prompt || `You are analyzing how a strategic intervention made TODAY (2026) would ripple forward and alter the 2050 scenario.`;
  const sectorKnowledgeText = formatSectorKnowledge(sectorKnowledge);
  const technologyKnowledgeText = formatTechnologyData(technologyData);
  const systemInstruction = basePrompt + sectorKnowledgeText + technologyKnowledgeText;

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

Use the sector and technology knowledge provided to ground the analysis.

OUTPUT FORMAT (use these exact headers):
## CONSEQUENCE OF THE INTERVENTION
## 2ND ORDER EFFECTS
## 3RD ORDER EFFECTS
## ELSA IMPLICATIONS
## THE ALTERED 2050 SCENARIO`;

  return { contents: [{ parts: [{ text: userPrompt }] }], systemInstruction };
}
