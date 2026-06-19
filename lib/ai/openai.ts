/**
 * OpenAI embeddings via REST API.
 * Model: text-embedding-3-large, Matryoshka truncation to 1024D.
 * Cost: ~$0.13 / 1M tokens (vs Gemini-2 embedding).
 */

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embedTextOpenAI(text: string, dims: 1024 | 3072 = 1024): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY env var not set');

  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(OPENAI_EMBED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-large',
          input: text.slice(0, 8000),
          dimensions: dims,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const isRate = res.status === 429;
        if (isRate && attempt < MAX_RETRIES - 1) {
          await sleep(Math.pow(2, attempt) * 1500);
          continue;
        }
        throw new Error(`OpenAI Embed ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as { data: Array<{ embedding: number[] }> };
      return data.data[0]?.embedding ?? [];

    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1500);
      } else {
        throw err;
      }
    }
  }

  throw new Error('embedTextOpenAI: exceeded retries');
}
