/**
 * Zeka Books — фоновый worker-демон.
 *
 * Отдельный долгоживущий процесс. Не зависит от браузера и HTTP-таймаутов.
 * Берёт задания из очереди (book_jobs), обрабатывает главы последовательно,
 * пишет живой лог в book_processing_events, чекпойнтит главы в
 * book_processing_sessions. При крахе/рестарте авто-resume с первой
 * незавершённой главы (идемпотентная вставка чанков по content_hash).
 *
 * Запуск: npm run worker
 */

import fs from 'fs';
import { processChapter, type PipelineEvent } from '@/lib/pipeline';
import { parseEpub } from '@/lib/extract/epub';
import { parsePdf } from '@/lib/extract/pdf';
import { writeChapterMd } from '@/lib/export-md';
import {
  claimNextJob,
  getJob,
  updateJobStatus,
  updateJobAfterParse,
  appendEvent,
  getBookSessions,
  resetStuckChapters,
  bumpChapterAttempts,
  type BookJob,
} from '@/lib/supabase';

// ── Config ──────────────────────────────────────────────────────────────────
const POLL_MS = 3000;             // пауза, когда очередь пуста
const CHAPTER_PAUSE_MS = 1500;    // пауза между главами
const MAX_CHAPTER_ATTEMPTS = 3;   // ретраев главы перед пометкой error

let shuttingDown = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function levelOf(type: string): 'ok' | 'info' | 'warn' | 'error' {
  if (type === 'chapter_done' || type === 'embed_done' || type === 'chunk_done') return 'ok';
  if (type === 'error') return 'error';
  if (type === 'retrying') return 'warn';
  return 'info';
}

function log(msg: string) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

// ── Process one job end-to-end ─────────────────────────────────────────────────
async function runJob(job: BookJob): Promise<void> {
  log(`▶ Job ${job.id.slice(0, 8)} — ${job.book_name} (${job.subject})`);
  await appendEvent(job.id, { level: 'info', type: 'job_start', msg: `▶ Старт: ${job.book_name} — ${job.subject}` });

  // ── Parse phase: если API не разбирал файл — делаем это здесь в фоне ────────
  if (!job.chapters.length) {
    await appendEvent(job.id, { level: 'info', type: 'extract_start', msg: '🔍 Определяю структуру книги (это займёт ~10с)...' });
    if (!fs.existsSync(job.file_path)) {
      const msg = `Файл не найден: ${job.file_path}`;
      await appendEvent(job.id, { level: 'error', type: 'error', msg: `❌ ${msg}` });
      await updateJobStatus(job.id, 'error', msg);
      return;
    }
    const fileBuffer = fs.readFileSync(job.file_path);
    const rawMeta = job.file_type === 'epub'
      ? await parseEpub(fileBuffer)
      : await parsePdf(fileBuffer);
    const rawChapters = job.file_type === 'epub'
      ? (rawMeta as Awaited<ReturnType<typeof parseEpub>>).chapters
      : (rawMeta as Awaited<ReturnType<typeof parsePdf>>).suggestedChapters;
    const meta = rawMeta;
    const chapters = rawChapters.map((c) => ({ title: c.title, pageStart: c.pageStart, pageEnd: c.pageEnd }));
    if (!chapters.length) {
      const msg = 'Не удалось определить главы книги';
      await appendEvent(job.id, { level: 'error', type: 'error', msg: `❌ ${msg}` });
      await updateJobStatus(job.id, 'error', msg);
      return;
    }
    await updateJobAfterParse(job.id, { chapters, is_image_based: meta.isImageBased, total_pages: meta.totalPages });
    job = { ...job, chapters, total_chapters: chapters.length, is_image_based: meta.isImageBased };
    await appendEvent(job.id, { level: 'ok', type: 'extract_done', msg: `✅ Структура определена: ${chapters.length} глав` });
    log(`  Parsed ${chapters.length} chapters for job ${job.id.slice(0, 8)}`);
  }

  // Recover any chapter left 'processing' by a previous crash.
  await resetStuckChapters(job.book_name);

  if (!fs.existsSync(job.file_path)) {
    const msg = `Файл не найден: ${job.file_path}`;
    await appendEvent(job.id, { level: 'error', type: 'error', msg: `❌ ${msg}` });
    await updateJobStatus(job.id, 'error', msg);
    return;
  }
  const fileBuffer = fs.readFileSync(job.file_path); // OK: worker process, не блокирует UI

  // Map existing checkpoints for fast skip.
  const sessions = await getBookSessions(job.book_name);
  const doneSet = new Set(sessions.filter((s) => s.status === 'done').map((s) => s.chapter_index));

  let anyError = false;

  for (let i = 0; i < job.chapters.length; i++) {
    if (shuttingDown) {
      log('⏹ Получен сигнал остановки — выходим, job останется running (resume при старте).');
      await appendEvent(job.id, { level: 'warn', type: 'job_paused', msg: '⏹ Worker остановлен — возобновится при следующем запуске' });
      return; // job stays 'running' → re-claimed and resumed next boot
    }

    // Respect external pause or deletion (API set status='paused' or DELETE job).
    const fresh = await getJob(job.id);
    if (!fresh) {
      log('🗑 Job удалён во время обработки — прекращаем, чанки не добавляем.');
      return;
    }
    if (fresh.status === 'paused') {
      log('⏸ Job на паузе — прекращаем обработку.');
      await appendEvent(job.id, { level: 'warn', type: 'job_paused', msg: '⏸ Пауза' });
      return;
    }

    const idx = i + 1; // 1-based
    const ch = job.chapters[i];

    if (doneSet.has(idx)) {
      await appendEvent(job.id, { level: 'info', type: 'chapter_skip', msg: `⏭ Глава ${idx} уже обработана — пропуск`, chapterIndex: idx });
      continue;
    }

    await appendEvent(job.id, { level: 'info', type: 'chapter_start', msg: `\n▶ Глава ${idx}/${job.chapters.length}: ${ch.title.slice(0, 60)}`, chapterIndex: idx });

    const emit = async (ev: PipelineEvent) => {
      log(`[ch${idx}] ${ev.msg.replace(/\n/g, ' ')}`);
      await appendEvent(job.id, { level: levelOf(ev.type), type: ev.type, msg: ev.msg, chapterIndex: idx, data: ev.data });
    };

    let success = false;
    for (let attempt = 1; attempt <= MAX_CHAPTER_ATTEMPTS && !success; attempt++) {
      await bumpChapterAttempts(job.book_name, idx);
      try {
        await processChapter(
          {
            jobId: job.id,
            bookName: job.book_name,
            subject: job.subject,
            chapterTitle: ch.title,
            chapterIndex: idx,
            pageStart: ch.pageStart,
            pageEnd: ch.pageEnd,
            fileBuffer,
            fileType: job.file_type,
            isImageBased: job.is_image_based,
            onChunks: async (chunks, model) => {
              const mdPath = await writeChapterMd({
                subject: job.subject,
                chapterIndex: idx,
                chapterTitle: ch.title,
                chunks,
                model,
              });
              log(`  📝 Экспорт MD: ${mdPath.split('/').slice(-2).join('/')}`);
            },
          },
          (ev) => { void emit(ev); }
        );
        success = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_CHAPTER_ATTEMPTS) {
          const wait = 5000 * attempt;
          await appendEvent(job.id, { level: 'warn', type: 'retrying', msg: `⚠️ Глава ${idx} попытка ${attempt}/${MAX_CHAPTER_ATTEMPTS} провалилась: ${msg.slice(0, 120)}. Повтор через ${wait / 1000}s...`, chapterIndex: idx });
          await sleep(wait);
        } else {
          anyError = true;
          await appendEvent(job.id, { level: 'error', type: 'error', msg: `❌ Глава ${idx} провалена после ${MAX_CHAPTER_ATTEMPTS} попыток: ${msg.slice(0, 160)}`, chapterIndex: idx });
        }
      }
    }

    if (i < job.chapters.length - 1) await sleep(CHAPTER_PAUSE_MS);
  }

  // Final tally.
  const finalSessions = await getBookSessions(job.book_name);
  const totalChunks = finalSessions.reduce((s, x) => s + (x.chunks_count ?? 0), 0);

  if (anyError) {
    await appendEvent(job.id, { level: 'warn', type: 'job_done', msg: `⚠️ Книга обработана с ошибками. Всего чанков: ${totalChunks}. Используйте Retry для проблемных глав.` });
    await updateJobStatus(job.id, 'error', 'Некоторые главы не обработаны');
  } else {
    await appendEvent(job.id, { level: 'ok', type: 'job_done', msg: `🎉 Книга полностью обработана! Всего чанков: ${totalChunks}` });
    await updateJobStatus(job.id, 'done');
  }
  log(`✓ Job ${job.id.slice(0, 8)} — ${anyError ? 'ERROR' : 'DONE'} (${totalChunks} чанков)`);
}

// ── Main loop ───────────────────────────────────────────────────────────────
async function main() {
  log('🟢 Zeka Books worker запущен. Очередь: book_jobs.');

  while (!shuttingDown) {
    let job: BookJob | null = null;
    try {
      job = await claimNextJob();
    } catch (err) {
      log(`⚠️ Ошибка claimNextJob: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    try {
      await runJob(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`❌ Job ${job.id.slice(0, 8)} крах: ${msg}`);
      await appendEvent(job.id, { level: 'error', type: 'error', msg: `❌ Критическая ошибка job: ${msg}` });
      await updateJobStatus(job.id, 'error', msg);
    }
  }

  log('🔴 Worker остановлен.');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(0); // second signal → force
    shuttingDown = true;
    log(`\n${sig} получен — завершаю текущую работу...`);
  });
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
