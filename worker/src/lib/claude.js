import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          time_seconds: { type: 'number' },
          title: { type: 'string' },
        },
        required: ['time_seconds', 'title'],
      },
    },
  },
  required: ['description', 'tags', 'chapters'],
};

/**
 * Generate SEO metadata from the transcript.
 * @returns {Promise<{description:string, tags:string[], chapters:{time_seconds:number,title:string}[]}>}
 */
export async function generateContent({ title, timedTranscript, sampleTagsets, videoType = 'How-To' }) {
  const samples = (sampleTagsets || [])
    .map((s, i) => `Sample set ${i + 1}: ${Array.isArray(s) ? s.join(', ') : s}`)
    .join('\n');

  const system = [
    'You are an expert YouTube SEO strategist for a long-form channel.',
    'From a video transcript you produce metadata that maximizes discovery and watch time while staying accurate to the content.',
    `The default video type is ${videoType}. Frame the metadata as useful, educational, step-by-step content when the transcript supports it.`,
    'Rules:',
    '- description: 150-300 words. The first 2 lines are a strong hook (they show above "...more"). Natural, keyword-rich, no keyword stuffing, no hashtag spam. Do NOT include chapter timestamps or links (those are added separately).',
    '- tags: 15-30 specific, high-intent tags relevant to THIS video. Match the topical style of the sample tag sets provided, but do not copy them verbatim.',
    '- chapters: 4-8 chapters that segment the video by topic. The first chapter MUST be at time_seconds 0. Each chapter title is short (2-6 words). Pick time_seconds values that align with the [timestamp] markers in the transcript, at least ~30s apart.',
    'Return only the structured JSON.',
  ].join('\n');

  const user = [
    `Video title: ${title}`,
    `Video type: ${videoType}`,
    '',
    "Style reference — my channel's sample tag sets (match the style/topic focus, do not copy verbatim):",
    samples || '(none provided)',
    '',
    'Timed transcript (each line: [timestamp] spoken text):',
    timedTranscript,
    '',
    'Produce the description, tags, and chapters as structured JSON.',
  ].join('\n');

  const resp = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    system,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: user }],
  });

  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text content');
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error('Failed to parse Claude JSON output: ' + e.message);
  }
  return {
    description: parsed.description || '',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
  };
}
