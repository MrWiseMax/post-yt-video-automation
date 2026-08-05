import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// Opus 5 runs thinking by default, and thinking tokens count against max_tokens —
// so max_tokens has to cover the reasoning AND the generated metadata.
const MODEL = 'claude-opus-5';

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
    first_comment: { type: 'string' },
  },
  required: ['description', 'tags', 'chapters', 'first_comment'],
};

// The raw SDK error is a JSON blob that ends up verbatim in the Supabase
// `error` column and on the Recent-videos card. Translate the account-level
// failures into something that says what to actually go fix.
function describeClaudeError(err) {
  const status = err?.status;
  const apiMessage = err?.error?.error?.message || err?.message || String(err);

  if (/organization has been disabled/i.test(apiMessage)) {
    return (
      'Anthropic rejected the request: the organization behind ANTHROPIC_API_KEY is disabled ' +
      '(usually no credit balance or a suspended account). Add credits / re-enable the org at ' +
      'console.anthropic.com, then update the ANTHROPIC_API_KEY repo secret if you issued a new key. ' +
      `Original: ${apiMessage}`
    );
  }
  if (status === 401) {
    return `ANTHROPIC_API_KEY is invalid or revoked — reissue it and update the repo secret. Original: ${apiMessage}`;
  }
  if (status === 403) {
    return `ANTHROPIC_API_KEY lacks access to ${MODEL}. Original: ${apiMessage}`;
  }
  if (status === 429) {
    return `Anthropic rate limit hit — re-run this video in a few minutes. Original: ${apiMessage}`;
  }
  return `Claude metadata generation failed (${status || 'no status'}): ${apiMessage}`;
}

/**
 * Generate SEO metadata + the channel's own first comment from the transcript.
 * All of it comes from ONE call: the transcript is the bulk of the input cost,
 * so asking for the comment here is nearly free versus a second request.
 * @returns {Promise<{description:string, tags:string[], chapters:{time_seconds:number,title:string}[], firstComment:string}>}
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
    '- first_comment: the creator\'s own comment, posted from the channel account the moment the video goes public. Its job is to start a real conversation in the comments section.',
    '  - Write it as the creator speaking in first person, in the same warm, plain-spoken voice as the transcript. Talk to the viewer like a person, not an audience.',
    '  - 2 to 4 sentences, roughly 300-600 characters. Short enough that people actually read it.',
    '  - Reference ONE specific, concrete thing from this video (a number, an example, a moment, a claim). It must be obvious this was written for THIS video and could not be copy-pasted onto another one.',
    '  - End with ONE open question that a viewer can answer from their own experience in a single sentence. Make it easy and inviting to answer, never rhetorical, never a yes/no question.',
    '  - Never ask for likes, subscribes, or shares. No hashtags, no links, no all-caps, no emoji spam (at most one emoji, only if it genuinely fits). Do not restate the title or summarize the whole video.',
    '  - Never promise or imply anything the video does not actually deliver.',
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
    'Produce the description, tags, chapters, and first comment as structured JSON.',
  ].join('\n');

  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    throw new Error(describeClaudeError(err));
  }

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
    firstComment: (parsed.first_comment || '').trim(),
  };
}
