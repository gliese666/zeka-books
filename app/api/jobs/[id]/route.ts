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
import {
  getJob, getBookSessions, updateJobStatus,
  resetFailedChapters, resetAllChapters, deleteChunksBySubject, deleteJob,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  const chapters = await getBookSessions(job.book_name);
  return NextResponse.json({ job, chapters });
}

/** DELETE /api/jobs/[id] — удалить задание (только если не running). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  if (job.status === 'running') {
    return NextResponse.json({ error: 'Нельзя удалить задание в процессе обработки' }, { status: 409 });
  }
  await deleteJob(id);
  return NextResponse.json({ ok: true });
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
      await resetFailedChapters(job.book_name);
      await updateJobStatus(id, 'queued', null);
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
