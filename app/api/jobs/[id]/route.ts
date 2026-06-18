/**
 * GET   /api/jobs/[id]   — детали задания + чекпойнты глав
 * PATCH /api/jobs/[id]   — управление заданием
 *   actions:
 *     start        — запустить (worker подхватит)
 *     pause        — пауза
 *     resume       — продолжить
 *     retry        — повторить только главы с ошибками (чанки остаются)
 *     reset        — мягкий сброс: удалить чекпойнты, чанки в RAG ОСТАЮТСЯ
 *     hard-reset   — полный сброс: удалить ВСЕ чанки из RAG + чекпойнты
 *     archive      — архивировать: скрыть из активной очереди, всё в RAG сохраняется
 *     unarchive    — вернуть из архива
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { folderName } from '@/lib/normalize';
import {
  getJob, getBookSessions, updateJobStatus,
  resetFailedChapters, resetAllChapters, deleteChunksBySubject, deleteEventsByJobId, deleteJob,
} from '@/lib/supabase';

const BOOKS_LABS = '/Users/akram/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Obsidian/Books Labs';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  const chapters = await getBookSessions(job.book_name, id);
  return NextResponse.json({ job, chapters });
}

/** DELETE /api/jobs/[id] — полное удаление: чанки из RAG + сессии + события + папка на диске + запись. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  if (job.status === 'running') {
    return NextResponse.json({ error: 'Нельзя удалить задание в процессе обработки' }, { status: 409 });
  }

  // 1. Удалить чанки из RAG
  const deletedChunks = await deleteChunksBySubject(job.subject);
  // 2. Удалить чекпойнты глав
  await resetAllChapters(job.book_name);
  // 3. Удалить события live-лога
  await deleteEventsByJobId(id);
  // 4. Удалить папку с диска (Books Labs)
  const folder = path.join(BOOKS_LABS, folderName(job.subject));
  let deletedFolder = false;
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
    deletedFolder = true;
  }
  // 5. Удалить запись job
  await deleteJob(id);

  return NextResponse.json({ ok: true, deleted_chunks: deletedChunks, deleted_folder: deletedFolder });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });

  const { action } = (await req.json()) as { action?: string };

  switch (action) {
    case 'start':
    case 'resume':
      await updateJobStatus(id, 'queued');
      break;

    case 'pause':
      await updateJobStatus(id, 'paused');
      break;

    case 'retry':
    case 'retry-failed':
      // Только главы с ошибками → pending. Готовые главы и их чанки без изменений.
      // Status → paused so worker doesn't auto-pick up; user clicks ▶ Запустить manually.
      await resetFailedChapters(job.book_name);
      await updateJobStatus(id, 'paused', null);
      break;

    case 'rerun':
    case 'reset':
      // Мягкий сброс: удалить чекпойнты глав, чанки в RAG ОСТАЮТСЯ.
      // Повторная обработка добавит только новые чанки (идемпотентно по content_hash).
      await resetAllChapters(job.book_name);
      await updateJobStatus(id, 'queued', null);
      break;

    case 'hard-reset': {
      // Полный сброс: удалить ВСЕ чанки из RAG + чекпойнты → обработка с нуля.
      const deleted = await deleteChunksBySubject(job.subject);
      await resetAllChapters(job.book_name);
      await updateJobStatus(id, 'queued', null);
      return NextResponse.json({ ok: true, deleted_chunks: deleted, ...(await getJob(id)) });
    }

    case 'archive':
      // Архив: скрыть из активной очереди, чанки в RAG и история логов — сохраняются.
      await updateJobStatus(id, 'archived');
      break;

    case 'unarchive':
      // Вернуть из архива (статус done = обработан, не ставим в очередь заново).
      await updateJobStatus(id, 'done');
      break;

    default:
      return NextResponse.json({ error: `Неизвестное действие: ${action}` }, { status: 400 });
  }

  return NextResponse.json(await getJob(id));
}
