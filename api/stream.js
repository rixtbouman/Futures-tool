// Vercel Edge Function for streaming Gemini API calls
// Edge Runtime supports true SSE streaming

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { type, payload } = await req.json();

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
        return new Response(JSON.stringify({ error: 'Unknown generation type' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    // Create a TransformStream for SSE
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start streaming in the background
    streamGeminiResponse(apiKey, streamParams.contents, streamParams.systemInstruction, writer, encoder);

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Streaming error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Stream Gemini API response
async function streamGeminiResponse(apiKey, contents, systemInstruction, writer, encoder) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${apiKey}`;

  const body = { contents };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: `Gemini API error: ${error}` })}\n\n`));
      await writer.close();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
              await writer.write(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }

    await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
  } catch (error) {
    await writer.write(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
  } finally {
    await writer.close();
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

// Parameter helpers for streaming
function getScenarioParams(payload) {
  const { archetype, resources, system, value, tech1, tech2, language, prompt, sectorKnowledge, technologyData } = payload;

  const sectorContext = formatSectorKnowledge(sectorKnowledge);
  const techContext = formatTechnologyData(technologyData);

  const langInstruction = `CRITICAL LANGUAGE REQUIREMENT: You MUST write your ENTIRE response in ${language === 'nl' ? 'Dutch' : 'English'}. Not a single word in ${language === 'nl' ? 'English' : 'Dutch'}.\n\n`;

  const systemInstruction = prompt
    ? `${langInstruction}${prompt}${sectorContext}${techContext}`
    : `${langInstruction}You are a futures scenario writer creating vivid 2050 scenarios for the Dutch migration sector.${sectorContext}${techContext}`;

  const contents = [{
    role: 'user',
    parts: [{
      text: `Create a 2050 scenario for Dutch migration policy with:
- Archetype: ${archetype}
- Resources: ${resources}
- System: ${system}
- Dominant Value: ${value}
- Technologies: ${tech1}, ${tech2}

Follow the structure and length specified in your instructions. Be specific and vivid, not generic.`
    }]
  }];

  return { contents, systemInstruction };
}

function getBackcastingParams(payload) {
  const { year, scenario2050, archetype, value, tech1, tech2, previousPhases, language, prompt, sectorKnowledge, technologyData } = payload;

  const sectorContext = formatSectorKnowledge(sectorKnowledge);
  const techContext = formatTechnologyData(technologyData);

  const langInstruction = `CRITICAL LANGUAGE REQUIREMENT: You MUST write your ENTIRE response in ${language === 'nl' ? 'Dutch' : 'English'}. Not a single word in ${language === 'nl' ? 'English' : 'Dutch'}.\n\n`;

  const systemInstruction = prompt
    ? `${langInstruction}${prompt}${sectorContext}${techContext}`
    : `${langInstruction}You are a strategic foresight expert helping trace the path from 2050 back to today for Dutch migration policy.${sectorContext}${techContext}`;

  let userPrompt = `Based on this 2050 scenario:\n${scenario2050}\n\nDescribe what the migration landscape looks like in ${year}.`;
  if (previousPhases) {
    userPrompt += `\n\nPrevious phases:\n${previousPhases}`;
  }
  userPrompt += `\n\nContext: Archetype=${archetype}, Value=${value}, Tech=${tech1}+${tech2}\n\nFollow the structure and length specified in your instructions. Be concrete and specific.`;

  const contents = [{
    role: 'user',
    parts: [{ text: userPrompt }]
  }];

  return { contents, systemInstruction };
}

function getVignetteParams(payload) {
  const { year, actor, lens, archetype, value, tech1, tech2, backcastingNarrative, language, prompt } = payload;

  const langInstruction = `CRITICAL LANGUAGE REQUIREMENT: You MUST write your ENTIRE response in ${language === 'nl' ? 'Dutch' : 'English'}. Not a single word in ${language === 'nl' ? 'English' : 'Dutch'}.\n\n`;

  const systemInstruction = prompt
    ? `${langInstruction}${prompt}`
    : `${langInstruction}You are a creative writer crafting immersive first-person vignettes for futures workshops.`;

  const contents = [{
    role: 'user',
    parts: [{
      text: `Create a first-person vignette for ${year}:
- Actor: ${actor}
- Lens/perspective: ${lens}
- Context: ${backcastingNarrative}
- Setting: Archetype=${archetype}, Value=${value}, Tech=${tech1}+${tech2}

Follow the structure and length specified in your instructions. Make it vivid and personal.`
    }]
  }];

  return { contents, systemInstruction };
}

function getConsequenceParams(payload) {
  const { intervention, scenario2050, archetype, value, tech1, tech2, backcastingJourney, language, prompt, sectorKnowledge, technologyData } = payload;

  const sectorContext = formatSectorKnowledge(sectorKnowledge);
  const techContext = formatTechnologyData(technologyData);

  const langInstruction = `CRITICAL LANGUAGE REQUIREMENT: You MUST write your ENTIRE response in ${language === 'nl' ? 'Dutch' : 'English'}. Not a single word in ${language === 'nl' ? 'English' : 'Dutch'}.\n\n`;

  const systemInstruction = prompt
    ? `${langInstruction}${prompt}${sectorContext}${techContext}`
    : `${langInstruction}You are a policy analyst examining consequences of interventions in the Dutch migration sector.${sectorContext}${techContext}\n\nStructure your analysis with: Consequences, 2nd Order Effects, 3rd Order Effects, ELSA Implications, and Altered 2050 Scenario.`;

  const contents = [{
    role: 'user',
    parts: [{
      text: `Analyze this policy intervention:
"${intervention}"

Context:
- 2050 Scenario: ${scenario2050}
- Backcasting journey: ${backcastingJourney}
- Setting: Archetype=${archetype}, Value=${value}, Tech=${tech1}+${tech2}

Follow the exact structure and length specified in your instructions. Use markdown headers for each section.`
    }]
  }];

  return { contents, systemInstruction };
}
