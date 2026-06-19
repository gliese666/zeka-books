/**
 * Gemini AI lib — two jobs:
 * 1. Vision OCR + Karpathy chunking for humanities (image pages → JSON chunks)
 * 2. Embedding-2 REST calls (768D + 3072D)
 */

import type { PageImage } from '@/lib/extract/epub';
import type { KarpathyChunk } from '@/lib/ai/deepseek';

const GEMINI_KEY = process.env.GEMINI_API_KEY!;

// ── Models ────────────────────────────────────────────────────────────────────

const VISION_MODEL   = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-3.1-pro-preview'; // used if primary fails with 429/500
const EMBED_URL      = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${GEMINI_KEY}`;

// ── Karpathy system prompts ───────────────────────────────────────────────────

const HUMANITIES_SYSTEM = `Ты — эксперт-компилятор знаний для сократического AI-репетитора (метод Карпаты).
Тебе дают страницы учебника (изображения). Прочти текст со всех страниц (OCR) и преобразуй содержание главы в автономные wiki-чанки.

Для каждого концепта/события/темы создай чанк с полями:
- "title": название (на русском)
- "content": markdown с секциями ## Контекст / ## Суть / ## Детали
- "concepts": список 3-6 связанных понятий
- "key_figures": ключевые персонажи с ролью (["Гейдар Алиев — президент"])
- "key_dates": ключевые даты (["1918 — образование АДР"])
- "misconceptions": 2-3 типичные ошибки школьников
- "prerequisites": понятия, которые нужно знать заранее
- "difficulty": 1-5
- "bloom_level": знание|понимание|применение|анализ|синтез|оценка
- "concept_type": event|period|figure|policy|movement|culture|economy

ПРАВИЛА:
- Каждый чанк САМОДОСТАТОЧЕН
- Все на русском языке
- content не менее 300 символов
- Выведи ТОЛЬКО валидный JSON с массивом "chunks"`;

// ── Vision OCR + Chunking ─────────────────────────────────────────────────────

export async function visionChunk(
  chapterTitle: string,
  images: PageImage[],
  statusCb?: (msg: string) => void
): Promise<KarpathyChunk[]> {
  const model = VISION_MODEL;
  return await callVisionApi(model, chapterTitle, images, statusCb, false);
}

async function callVisionApi(
  model: string,
  chapterTitle: string,
  images: PageImage[],
  statusCb?: (msg: string) => void,
  isFallback = false
): Promise<KarpathyChunk[]> {
  const parts: unknown[] = [
    { text: HUMANITIES_SYSTEM + '\n\n---\n\n' },
  ];

  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.data.toString('base64'),
      },
    });
  }

  parts.push({
    text: `Скомпилируй главу '${chapterTitle}' в автономные wiki-чанки. Страниц: ${images.length}. Выведи только JSON.`,
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 16000,
    },
  };

  const MAX_RETRIES = isFallback ? 2 : 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000), // 4 min per chapter
      });

      if (!res.ok) {
        const errText = await res.text();
        const isRate = res.status === 429;
        const isServer = res.status >= 500;

        if ((isRate || isServer) && attempt < MAX_RETRIES - 1) {
          const wait = isRate ? 30_000 : 15_000 * Math.pow(3, attempt);
          statusCb?.(`⚠️ Gemini ${res.status} — повтор через ${wait / 1000}s...`);
          await sleep(wait);
          continue;
        }

        // Try fallback model once
        if (!isFallback && attempt === MAX_RETRIES - 1) {
          statusCb?.(`⚠️ Переключаюсь на ${FALLBACK_MODEL}...`);
          return callVisionApi(FALLBACK_MODEL, chapterTitle, images, statusCb, true);
        }

        throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
      const parsed = JSON.parse(clean);
      const chunks: KarpathyChunk[] = parsed?.chunks ?? [];

      // Validate chunks
      const valid = chunks.filter(c =>
        c.title && c.content && c.content.length >= 200
      );

      statusCb?.(`✅ Gemini Vision: ${valid.length} чанков (${chunks.length - valid.length} невалидных)`);
      return valid;

    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        const wait = 15_000 * Math.pow(2, attempt);
        statusCb?.(`⚠️ Ошибка Gemini (${attempt + 1}/${MAX_RETRIES}): ${err instanceof Error ? err.message : String(err)}. Повтор через ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }

  return [];
}

// ── Embedding ─────────────────────────────────────────────────────────────────

export async function embedText(text: string, dims: 768 | 1024 | 3072): Promise<number[]> {
  const body = {
    outputDimensionality: dims,
    content: { parts: [{ text: text.slice(0, 8000) }] },
  };

  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const isRate = res.status === 429;
        if (isRate && attempt < MAX_RETRIES - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw new Error(`Gemini Embed ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      return data.embedding?.values ?? [];

    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      } else {
        throw err;
      }
    }
  }

  return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
