/**
 * One-shot migration script: re-embed all existing dim_textbooks_vector chunks
 * from Gemini 768/3072D → OpenAI text-embedding-3-large 1024D (Matryoshka MRL).
 *
 * Usage:
 *   npx tsx scripts/reembed-1024.ts
 *
 * Requirements:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY in .env.local
 *
 * Safe to re-run: skips rows that already have embedding_1024 filled.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env.local without dotenv dependency
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=["']?(.+?)["']?\s*$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY) {
  console.error('❌ Missing env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BATCH_SIZE = 20;
const EMBED_URL = 'https://api.openai.com/v1/embeddings';

async function embed(text: string): Promise<number[]> {
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(EMBED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-large',
          input: text.slice(0, 8000),
          dimensions: 1024,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const isRate = res.status === 429;
        if (isRate && attempt < MAX_RETRIES - 1) {
          const wait = Math.pow(2, attempt) * 2000;
          console.log(`  ⏳ Rate limit — waiting ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as { data: Array<{ embedding: number[] }> };
      return data.data[0]?.embedding ?? [];
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
      } else {
        throw err;
      }
    }
  }
  throw new Error('embed: exceeded retries');
}

async function main() {
  console.log('🚀 Re-embed migration: Gemini → OpenAI text-embedding-3-large (1024D)\n');

  // Fetch only rows missing embedding_1024
  const { data: rows, error } = await supabase
    .from('dim_textbooks_vector')
    .select('id, subject, topic, content')
    .is('embedding_1024', null)
    .order('id');

  if (error) {
    console.error('❌ Fetch error:', error.message);
    process.exit(1);
  }

  const total = rows?.length ?? 0;
  console.log(`📊 Rows needing re-embed: ${total}\n`);

  if (total === 0) {
    console.log('✅ All rows already have embedding_1024. Nothing to do.');
    return;
  }

  let done = 0;
  let failed = 0;

  for (let i = 0; i < rows!.length; i++) {
    const row = rows![i];

    // Build embed text same as pipeline.ts buildEmbedText
    const embedInput = `${row.topic}\n\n${row.content}`.trim();

    process.stdout.write(`[${i + 1}/${total}] ${row.subject} — ${(row.topic ?? '').slice(0, 50)} ... `);

    try {
      const vec = await embed(embedInput);

      const { error: upErr } = await supabase
        .from('dim_textbooks_vector')
        .update({ embedding_1024: vec })
        .eq('id', row.id);

      if (upErr) throw new Error(upErr.message);

      console.log(`✓ (${vec.length}D)`);
      done++;
    } catch (err) {
      console.log(`❌ ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Respect OpenAI rate limits (~3000 RPM on Tier 1)
    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise(r => setTimeout(r, 1000));
    } else {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`\n━━━ Done ━━━`);
  console.log(`✅ Success: ${done}/${total}`);
  if (failed > 0) console.log(`❌ Failed: ${failed} — re-run script to retry`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
