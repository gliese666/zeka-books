/**
 * DeepSeek V4 Pro — Karpathy chunking for exact sciences (Math, Physics, Chemistry).
 * Uses JSON mode + reasoning_effort: high for maximum quality.
 */

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY!;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-pro';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KarpathyChunk {
  title: string;
  content: string;
  concepts: string[];
  // Humanities fields
  key_figures?: string[];
  key_dates?: string[];
  // STEM fields
  example_pattern?: string;
  // Common
  misconceptions: string[];
  prerequisites: string[];
  difficulty: number;
  bloom_level: string;
  concept_type: string;
}

// ── System prompts ────────────────────────────────────────────────────────────

const STEM_SYSTEM = `Ты — эксперт-компилятор знаний для сократического AI-репетитора (метод Карпаты).
Для каждого концепта в главе создай автономный wiki-чанк с ПОЛНЫМ набором полей:

- "title": название концепта (на русском)
- "content": markdown с секциями:
    ## Интуиция  (простая ментальная модель, аналогия, без формул)
    ## Теория    (формальное определение с формулами LaTeX)
    ## Практика  (2-3 полных разобранных примера с LaTeX пошагово)
- "concepts": список 3-7 связанных понятий
- "example_pattern": шаблон для генерации новых задач (с {переменными})
- "misconceptions": список 2-4 типичных ошибок учеников
- "prerequisites": концепты, которые нужно знать перед изучением
- "difficulty": 1-5
- "bloom_level": знание|понимание|применение|анализ|синтез|оценка
- "concept_type": definition|theorem|formula|method|property|example

ПРАВИЛА:
- Использовать LaTeX для ВСЕХ формул: inline $f$, block $$f$$
- Каждый чанк САМОДОСТАТОЧЕН
- Всё на русском языке
- content не менее 400 символов
- Выведи ТОЛЬКО валидный JSON с массивом "chunks"`;

// ── Main export ───────────────────────────────────────────────────────────────

export async function deepseekChunk(
  chapterTitle: string,
  rawText: string,
  statusCb?: (msg: string) => void
): Promise<KarpathyChunk[]> {
  const prompt = `Скомпилируй главу '${chapterTitle}' в автономные wiki-чанки по методу Карпаты.\n\nТекст:\n${rawText}`;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: STEM_SYSTEM },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'enabled', reasoning_effort: 'high' },
          max_tokens: 32000,
        }),
        signal: AbortSignal.timeout(600_000), // 10 min for complex chapters
      });

      if (!res.ok) {
        const errText = await res.text();
        const is429 = res.status === 429;
        const isServer = res.status >= 500;
        if ((is429 || isServer) && attempt < MAX_RETRIES - 1) {
          // 429 = rate limit: exp backoff + jitter to avoid thundering herd
          const base = is429 ? 20_000 : 15_000;
          const wait = base * Math.pow(2, attempt) + Math.random() * 5_000;
          statusCb?.(`⚠️ DeepSeek ${res.status} (${is429 ? 'rate limit' : 'server error'}) — повтор через ${Math.round(wait / 1000)}s...`);
          await sleep(wait);
          continue;
        }
        throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const usage = data?.usage ?? {};
      const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
      const cacheMiss = usage.prompt_cache_miss_tokens ?? 0;

      const content: string = data?.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(content);
      const chunks: KarpathyChunk[] = parsed?.chunks ?? [];

      const valid = chunks.filter(c =>
        c.title && c.content && c.content.length >= 300
      );

      statusCb?.(`✅ DeepSeek: ${valid.length} чанков | Cache hit: ${cacheHit} | Miss: ${cacheMiss}`);
      return valid;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES - 1) {
        const wait = 15_000 * Math.pow(3, attempt);
        statusCb?.(`⚠️ DeepSeek ошибка (${attempt + 1}/${MAX_RETRIES}): ${msg.slice(0, 80)}. Повтор через ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw new Error(`DeepSeek failed after ${MAX_RETRIES} attempts: ${msg}`);
      }
    }
  }

  return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Detect if subject requires STEM chunker (DeepSeek) or humanities (Gemini Vision). */
export function isStemSubject(subject: string): boolean {
  const s = subject.toLowerCase();
  // Russian: матем(атика), физик(а), хими(я), биолог(ия)
  // Azerbaijani: riyaziyyat, fizika, kimya, biologiya
  return [
    'матем', 'физик', 'хими', 'биолог',
    'math', 'physic', 'chem', 'bio',
    'riyaz', 'fizika', 'kimya', 'biologiya',
  ].some(k => s.includes(k));
}
