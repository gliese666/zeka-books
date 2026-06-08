#!/usr/bin/env npx tsx
/**
 * process-local.ts — Local book processor (bypasses Vercel 4.5MB upload limit)
 *
 * Usage:
 *   npx tsx scripts/process-local.ts --file <path/to/book.epub> --subject "История Азербайджана 9" [--from 1]
 *
 * Reads env from .env.local automatically.
 * Saves Karpathy chunks to Books Labs 01_RAG_Ready/ + Supabase.
 */

import fs from 'fs';
import path from 'path';
import { parseEpub, extractEpubImages, extractEpubText } from '../lib/extract/epub';
import { parsePdf, extractPdfText } from '../lib/extract/pdf';
import { visionChunk, embedText } from '../lib/ai/gemini';
import { deepseekChunk, isStemSubject } from '../lib/ai/deepseek';
import { injectChunk, upsertChapterSession, getChapterSession } from '../lib/supabase';
import type { KarpathyChunk } from '../lib/ai/deepseek';

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found');
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ── Colors ────────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
};

function log(msg: string) { console.log(msg); }
function ok(msg: string)  { console.log(`${c.green}✅${c.reset} ${msg}`); }
function info(msg: string){ console.log(`${c.cyan}▸${c.reset}  ${msg}`); }
function warn(msg: string){ console.log(`${c.yellow}⚠️${c.reset}  ${msg}`); }
function err(msg: string) { console.log(`${c.red}❌${c.reset} ${msg}`); }
function prog(msg: string){ process.stdout.write(`\r${c.gray}   ${msg}${c.reset}                    `); }

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const filePath = get('--file');
  const subject  = get('--subject');
  const fromStr  = get('--from');

  if (!filePath || !subject) {
    console.error(`\nUsage: npx tsx scripts/process-local.ts --file <path> --subject "Название" [--from N]\n`);
    process.exit(1);
  }

  return { filePath, subject, fromChapter: fromStr ? parseInt(fromStr) : 1 };
}

// ── Karpathy text chunker (Gemini, no images) ──────────────────────────────────

async function geminiTextChunk(chapterTitle: string, rawText: string, statusCb?: (m: string) => void): Promise<KarpathyChunk[]> {
  const KEY = process.env.GEMINI_API_KEY!;
  const SYSTEM = `Ты — эксперт-компилятор знаний для сократического AI-репетитора (метод Карпаты).
Преобразуй текст главы в автономные wiki-чанки.
Каждый чанк: title, content (## Контекст/## Суть/## Детали), concepts, key_figures, key_dates, misconceptions, prerequisites, difficulty 1-5, bloom_level, concept_type.
Выведи ТОЛЬКО JSON с массивом "chunks".`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`,
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

  if (!res.ok) { statusCb?.(`Gemini text chunk failed: ${res.status}`); return []; }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return (parsed?.chunks ?? []).filter((c: KarpathyChunk) => c.title && c.content?.length >= 200);
  } catch { return []; }
}

// ── Build embed text ─────────────────────────────────────────────────────────

function buildEmbedText(chunk: KarpathyChunk): string {
  let extra = '';
  if (chunk.key_figures?.length) extra += ' | figures: ' + chunk.key_figures.slice(0, 3).join('; ');
  if (chunk.key_dates?.length)   extra += ' | dates: '   + chunk.key_dates.slice(0, 5).join('; ');
  if (chunk.misconceptions?.length) extra += ' | misconceptions: ' + chunk.misconceptions.slice(0, 2).join('; ');
  return `title: ${chunk.title} | text: ${chunk.content.slice(0, 3000)}${extra}`;
}

// ── Save to Obsidian 01_RAG_Ready ─────────────────────────────────────────────

function saveToObsidian(bookFolder: string, chapterIndex: number, chapterTitle: string, chunks: KarpathyChunk[]) {
  const BOOKS_PATH = '/Users/akram/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Obsidian/Books Labs';
  const ragDir = path.join(BOOKS_PATH, bookFolder, '01_RAG_Ready');
  fs.mkdirSync(ragDir, { recursive: true });

  const nn = String(chapterIndex).padStart(2, '0');
  const safeName = chapterTitle.replace(/[/:*?"<>|\\]/g, '_').slice(0, 60);
  const filePath = path.join(ragDir, `${nn}_${safeName}.md`);

  const md = chunks.map(ch => `# ${ch.title}\n\n${ch.content}\n\n---\n`).join('\n');
  fs.writeFileSync(filePath, `# ${chapterTitle}\n\n${md}`, 'utf-8');
  return filePath;
}

// ── Process one chapter ───────────────────────────────────────────────────────

async function processChapter(params: {
  bookName: string;
  subject: string;
  bookFolder: string;
  chapterTitle: string;
  chapterIndex: number;
  pageStart: number;
  pageEnd: number;
  fileBuffer: Buffer;
  fileType: 'epub' | 'pdf';
  isImageBased: boolean;
}): Promise<number> {
  const { bookName, subject, bookFolder, chapterTitle, chapterIndex } = params;

  // Check checkpoint
  const existing = await getChapterSession(bookName, chapterIndex);
  if (existing?.status === 'done') {
    info(`Глава ${chapterIndex} "${chapterTitle.slice(0, 40)}" — уже обработана (${existing.chunks_count} чанков), пропуск`);
    return existing.chunks_count;
  }

  await upsertChapterSession(bookName, subject, chapterTitle, chapterIndex, 'processing');

  const useStem = isStemSubject(subject);
  let chunks: KarpathyChunk[] = [];

  // EXTRACT + CHUNK
  if (params.isImageBased) {
    prog(`Глава ${chapterIndex}: извлечение изображений стр. ${params.pageStart}–${params.pageEnd}...`);
    const images = params.fileType === 'epub'
      ? await extractEpubImages(params.fileBuffer, params.pageStart, params.pageEnd)
      : [];

    if (!images.length) throw new Error(`Нет изображений для стр. ${params.pageStart}–${params.pageEnd}`);
    process.stdout.write('\n');
    info(`Изображений: ${images.length}`);

    prog(`Gemini Vision OCR + Karpathy chunking...`);
    chunks = await visionChunk(chapterTitle, images, m => { process.stdout.write('\n'); warn(m); });

  } else {
    prog(`Глава ${chapterIndex}: извлечение текста стр. ${params.pageStart}–${params.pageEnd}...`);
    const rawText = params.fileType === 'epub'
      ? await extractEpubText(params.fileBuffer, params.pageStart, params.pageEnd)
      : await extractPdfText(params.fileBuffer, params.pageStart, params.pageEnd);

    process.stdout.write('\n');
    info(`Символов: ${rawText.length}`);

    if (useStem) {
      prog(`DeepSeek V4 Pro chunking (точные науки)...`);
      chunks = await deepseekChunk(chapterTitle, rawText, m => { process.stdout.write('\n'); warn(m); });
    } else {
      prog(`Gemini Flash text chunking (гуманитарные)...`);
      chunks = await geminiTextChunk(chapterTitle, rawText, m => { process.stdout.write('\n'); warn(m); });
    }
  }

  process.stdout.write('\n');
  if (!chunks.length) throw new Error('Нет чанков — ответ AI пуст или невалиден');
  info(`Чанков получено: ${c.bold}${chunks.length}${c.reset}`);

  // EMBED + INJECT
  let injected = 0;
  for (let i = 0; i < chunks.length; i++) {
    prog(`Эмбеддинг ${i + 1}/${chunks.length}: "${chunks[i].title.slice(0, 35)}"...`);
    const embedStr = buildEmbedText(chunks[i]);
    const [vec768, vec3072] = await Promise.all([
      embedText(embedStr, 768),
      embedText(embedStr, 3072),
    ]);
    await injectChunk(subject, chapterTitle, chunks[i], vec768, vec3072);
    injected++;
    if (i < chunks.length - 1) await sleep(800);
  }

  process.stdout.write('\n');

  // Save to Obsidian
  const mdPath = saveToObsidian(bookFolder, chapterIndex, chapterTitle, chunks);
  info(`Obsidian: ${path.basename(mdPath)}`);

  await upsertChapterSession(bookName, subject, chapterTitle, chapterIndex, 'done', injected);
  return injected;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  const { filePath, subject, fromChapter } = parseArgs();

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) { err(`Файл не найден: ${absPath}`); process.exit(1); }

  const ext = path.extname(absPath).toLowerCase();
  const fileType: 'epub' | 'pdf' = ext === '.epub' ? 'epub' : 'pdf';
  const bookName = path.basename(absPath);

  // Determine Books Labs folder name from subject
  const bookFolder = subject.replace(/\s+/g, ' ').trim();

  log(`\n${c.bold}${c.blue}╔══════════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}${c.blue}║  Zeka Books — Local Pipeline                     ║${c.reset}`);
  log(`${c.bold}${c.blue}╚══════════════════════════════════════════════════╝${c.reset}\n`);
  info(`Файл:    ${bookName}`);
  info(`Предмет: ${subject}`);
  info(`Тип:     ${fileType.toUpperCase()}`);

  prog('Читаю файл...');
  const fileBuffer = fs.readFileSync(absPath);
  process.stdout.write('\n');
  info(`Размер: ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB`);

  // Parse structure
  prog('Парсинг структуры книги...');
  let chapters: Array<{ title: string; pageStart: number; pageEnd: number }> = [];
  let isImageBased = false;

  if (fileType === 'epub') {
    const meta = await parseEpub(fileBuffer);
    chapters = meta.chapters;
    isImageBased = meta.isImageBased;
    process.stdout.write('\n');
    info(`Глав: ${chapters.length} | Image-based: ${isImageBased} | Страниц: ${meta.totalPages}`);
  } else {
    const meta = await parsePdf(fileBuffer);
    chapters = meta.suggestedChapters;
    isImageBased = meta.isImageBased;
    process.stdout.write('\n');
    info(`Глав: ${chapters.length} | Image-based: ${isImageBased} | Страниц: ${meta.totalPages}`);
  }

  if (!chapters.length) { err('Не найдено ни одной главы'); process.exit(1); }

  // Show chapter list
  log(`\n${c.bold}Главы (${chapters.length}):${c.reset}`);
  chapters.forEach((ch, i) => {
    const idx = i + 1;
    const skip = idx < fromChapter ? c.gray + ' [пропуск]' + c.reset : '';
    log(`  ${c.gray}${String(idx).padStart(2)}.${c.reset} стр. ${ch.pageStart}–${ch.pageEnd}  ${ch.title.slice(0, 55)}${skip}`);
  });

  log('');
  let totalChunks = 0;
  let errors = 0;

  for (let i = 0; i < chapters.length; i++) {
    const idx = i + 1;
    if (idx < fromChapter) continue;

    const ch = chapters[i];
    log(`\n${c.bold}${c.blue}── Глава ${idx}/${chapters.length}: ${ch.title.slice(0, 55)} ──${c.reset}`);

    try {
      const count = await processChapter({
        bookName, subject, bookFolder,
        chapterTitle: ch.title,
        chapterIndex: idx,
        pageStart: ch.pageStart,
        pageEnd: ch.pageEnd,
        fileBuffer, fileType, isImageBased,
      });
      ok(`Глава ${idx} готова — ${count} чанков (итого: ${totalChunks + count})`);
      totalChunks += count;
    } catch (e) {
      errors++;
      err(`Глава ${idx} ОШИБКА: ${e instanceof Error ? e.message : String(e)}`);
      warn('Продолжаю со следующей главой...');
    }

    // Pause between chapters
    if (i < chapters.length - 1) await sleep(2000);
  }

  log(`\n${c.bold}${c.green}╔══════════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}${c.green}║  ГОТОВО: ${String(totalChunks).padEnd(6)} чанков | ${String(errors).padEnd(3)} ошибок             ║${c.reset}`);
  log(`${c.bold}${c.green}╚══════════════════════════════════════════════════╝${c.reset}\n`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

main().catch(e => { console.error(e); process.exit(1); });
