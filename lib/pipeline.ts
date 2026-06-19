/**
 * Pipeline orchestrator — processes ONE chapter end-to-end.
 * Designed to run inside a single SSE request (≤ 300s on Vercel Pro).
 *
 * Emits structured events via a callback so the API route can stream them.
 */

import { extractEpubImages, extractEpubText, type PageImage } from '@/lib/extract/epub';
import { extractPdfText, extractPdfImages } from '@/lib/extract/pdf';
import { visionChunk } from '@/lib/ai/gemini';
import { deepseekChunk, isStemSubject } from '@/lib/ai/deepseek';
import { embedTextOpenAI } from '@/lib/ai/openai';
import { injectChunk, upsertChapterSession, getChapterSession } from '@/lib/supabase';
import type { KarpathyChunk } from '@/lib/ai/deepseek';

/** Max image pages per Gemini Vision call — keeps inline_data request under limits. */
const VISION_BATCH = 8;

/** Split an array into fixed-size windows. */
function windows<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Event types ───────────────────────────────────────────────────────────────

export type PipelineEventType =
  | 'extract_start' | 'extract_done'
  | 'chunk_start' | 'chunk_done'
  | 'embed_progress' | 'embed_done'
  | 'supabase_inject'
  | 'chapter_done'
  | 'chapter_skip'
  | 'retrying'
  | 'error';

export interface PipelineEvent {
  type: PipelineEventType;
  msg: string;
  data?: Record<string, unknown>;
}

export type EmitFn = (event: PipelineEvent) => void;

// ── Chapter params ─────────────────────────────────────────────────────────────

export interface ChapterParams {
  bookName: string;
  subject: string;
  chapterTitle: string;
  chapterIndex: number;
  pageStart: number;
  pageEnd: number;
  fileBuffer: Buffer;
  fileType: 'epub' | 'pdf';
  isImageBased: boolean;
  /** Optional link to a book_jobs row (worker mode). */
  jobId?: string;
  /** Called with final chunks just before marking chapter done (for .md export). */
  onChunks?: (chunks: KarpathyChunk[], model: string) => Promise<void>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function processChapter(
  params: ChapterParams,
  emit: EmitFn
): Promise<{ chunks: number; skipped: boolean }> {
  const { bookName, subject, chapterTitle, chapterIndex } = params;

  // ── 1. Check checkpoint ───────────────────────────────────────────────────
  const existing = await getChapterSession(bookName, chapterIndex);
  if (existing?.status === 'done') {
    emit({ type: 'chapter_skip', msg: `Глава ${chapterIndex} уже обработана (${existing.chunks_count} чанков) — пропускаем`, data: { chunks: existing.chunks_count } });
    return { chunks: existing.chunks_count, skipped: true };
  }

  // Mark as processing
  await upsertChapterSession(bookName, subject, chapterTitle, chapterIndex, 'processing', { jobId: params.jobId });

  try {
    // ── 2. Extract ────────────────────────────────────────────────────────────
    emit({ type: 'extract_start', msg: `Извлечение стр. ${params.pageStart}–${params.pageEnd} (${params.pageEnd - params.pageStart + 1} стр.)` });

    let chunks: KarpathyChunk[] = [];
    const useStem = isStemSubject(subject);

    if (params.isImageBased) {
      // Image-based: render/extract page images (PDF via pdf-to-img, EPUB via assets)
      const images: PageImage[] = params.fileType === 'epub'
        ? await extractEpubImages(params.fileBuffer, params.pageStart, params.pageEnd)
        : await extractPdfImages(params.fileBuffer, params.pageStart, params.pageEnd);

      if (!images.length) {
        throw new Error(`Не найдено изображений для стр. ${params.pageStart}–${params.pageEnd}`);
      }

      const totalKB = Math.round(images.reduce((s, i) => s + i.data.length, 0) / 1024);
      const batches = windows(images, VISION_BATCH);
      emit({ type: 'extract_done', msg: `Извлечено ${images.length} изображений (${totalKB}KB, ${batches.length} батч(ей) Vision)` });

      // ── 3. Chunk (Vision, sub-batched to respect Gemini inline limits) ──────
      emit({ type: 'chunk_start', msg: useStem ? 'Vision OCR → DeepSeek V4 Pro (точные науки)...' : 'Gemini Vision OCR + Karpathy...' });

      if (useStem) {
        // STEM image-based: OCR each batch to text, then one DeepSeek chunking pass
        let ocrText = '';
        for (let b = 0; b < batches.length; b++) {
          emit({ type: 'retrying', msg: `Vision OCR батч ${b + 1}/${batches.length}...` });
          ocrText += (await extractTextViaVision(chapterTitle, batches[b])) + '\n\n';
        }
        chunks = await deepseekChunk(chapterTitle, ocrText.trim(), (msg) =>
          emit({ type: 'retrying', msg })
        );
      } else {
        // Humanities image-based: Vision chunk each batch, merge results
        for (let b = 0; b < batches.length; b++) {
          if (batches.length > 1) emit({ type: 'retrying', msg: `Vision батч ${b + 1}/${batches.length}...` });
          const part = await visionChunk(chapterTitle, batches[b], (msg) =>
            emit({ type: 'retrying', msg })
          );
          chunks.push(...part);
        }
      }

    } else {
      // Text-based: extract text
      const rawText = params.fileType === 'epub'
        ? await extractEpubText(params.fileBuffer, params.pageStart, params.pageEnd)
        : await extractPdfText(params.fileBuffer, params.pageStart, params.pageEnd);

      emit({ type: 'extract_done', msg: `Извлечено ${rawText.length} символов` });

      // ── 3. Chunk (DeepSeek or Gemini) ─────────────────────────────────────
      emit({ type: 'chunk_start', msg: useStem ? 'DeepSeek V4 Pro (точные науки)...' : 'Gemini 3.5-Flash (гуманитарные)...' });

      if (useStem) {
        chunks = await deepseekChunk(chapterTitle, rawText, (msg) =>
          emit({ type: 'retrying', msg })
        );
      } else {
        // Text-based humanities: use Gemini chat (no images)
        chunks = await geminiTextChunk(chapterTitle, rawText, (msg) =>
          emit({ type: 'retrying', msg })
        );
      }
    }

    emit({ type: 'chunk_done', msg: `Получено ${chunks.length} чанков`, data: { count: chunks.length } });

    if (!chunks.length) {
      throw new Error('Ни одного чанка не получено — возможно ответ от AI пуст');
    }

    // ── 4. Embed + Inject ──────────────────────────────────────────────────────
    let injected = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedText_str = buildEmbedText(chunk);

      emit({ type: 'embed_progress', msg: `Эмбеддинг ${i + 1}/${chunks.length}: "${chunk.title.slice(0, 40)}"`, data: { current: i + 1, total: chunks.length } });

      const vec1024 = await embedTextOpenAI(embedText_str, 1024);

      await injectChunk(subject, chapterTitle, chunk, vec1024);
      injected++;

      // Small pause to respect rate limits
      if (i < chunks.length - 1) await sleep(800);
    }

    emit({ type: 'embed_done', msg: `${injected} чанков записано в Supabase` });

    // ── 5. Export .md (optional, non-fatal) ───────────────────────────────────
    if (params.onChunks && chunks.length) {
      const model = useStem ? 'deepseek-v4-pro' : 'gemini-3.5-flash';
      try {
        await params.onChunks(chunks, model);
      } catch {
        // md export failure must never abort chapter processing
      }
    }

    // ── 6. Mark done ───────────────────────────────────────────────────────────
    await upsertChapterSession(bookName, subject, chapterTitle, chapterIndex, 'done', { chunksCount: injected, jobId: params.jobId });
    emit({ type: 'chapter_done', msg: `✅ Глава ${chapterIndex} завершена: ${injected} чанков`, data: { chunks: injected } });

    return { chunks: injected, skipped: false };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await upsertChapterSession(bookName, subject, chapterTitle, chapterIndex, 'error', { errorMessage: errMsg, jobId: params.jobId });
    emit({ type: 'error', msg: `❌ Ошибка: ${errMsg}` });
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEmbedText(chunk: KarpathyChunk): string {
  let extra = '';
  if (chunk.key_figures?.length) extra += ' | figures: ' + chunk.key_figures.slice(0, 3).join('; ');
  if (chunk.key_dates?.length) extra += ' | dates: ' + chunk.key_dates.slice(0, 5).join('; ');
  if (chunk.misconceptions?.length) extra += ' | misconceptions: ' + chunk.misconceptions.slice(0, 2).join('; ');
  if (chunk.prerequisites?.length) extra += ' | prerequisites: ' + chunk.prerequisites.slice(0, 2).join('; ');
  return `title: ${chunk.title} | text: ${chunk.content.slice(0, 3000)}${extra}`;
}

async function extractTextViaVision(
  chapterTitle: string,
  images: import('@/lib/extract/epub').PageImage[]
): Promise<string> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY!;
  const MODELS = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'] as const;
  const parts = [
    { text: 'Прочитай текст со всех изображений и верни только plain text (без форматирования), сохраняя структуру страниц.\n\n' },
    ...images.map(img => ({
      inline_data: { mime_type: img.mimeType, data: img.data.toString('base64') },
    })),
    { text: 'Верни только текст страниц.' },
  ];

  for (let m = 0; m < MODELS.length; m++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[m]}:generateContent?key=${GEMINI_KEY}`;
    const MAX_RETRIES = m === 0 ? 3 : 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }

      const isRetryable = res.status === 429 || res.status >= 500;
      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const wait = res.status === 429 ? 30_000 : 15_000 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      break; // try next model
    }
  }

  throw new Error(`Vision OCR failed after retries on all models`);
}

async function geminiTextChunk(
  chapterTitle: string,
  rawText: string,
  statusCb?: (msg: string) => void
): Promise<KarpathyChunk[]> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY!;
  const SYSTEM = `Ты — эксперт-компилятор знаний для сократического AI-репетитора (метод Карпаты).
Преобразуй текст главы в автономные wiki-чанки.
Каждый чанк: title, content (## Контекст/## Суть/## Детали), concepts, key_figures, key_dates, misconceptions, prerequisites, difficulty 1-5, bloom_level, concept_type.
Выведи ТОЛЬКО JSON с массивом "chunks".`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: SYSTEM + '\n\n---\n\n' + rawText.slice(0, 30000) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16000 },
      }),
      signal: AbortSignal.timeout(180_000),
    }
  );

  if (!res.ok) {
    statusCb?.(`⚠️ Gemini text chunk failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const parsed = JSON.parse(clean);
  return (parsed?.chunks ?? []).filter((c: KarpathyChunk) => c.title && c.content?.length >= 200);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
