/**
 * GET   /api/jobs/[id]        — детали задания + чекпойнты глав
 * PATCH /api/jobs/[id]        — управление: { action: 'pause'|'resume'|'retry-failed'|'rerun' }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getJob,
  getBookSessions,
  updateJobStatus,
  resetFailedChapters,
  resetAllChapters,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  const chapters = await getBookSessions(job.book_name);
  return NextResponse.json({ job, chapters });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });

  const { action } = (await req.json()) as { action?: string };

  switch (action) {
    case 'pause':
      await updateJobStatus(id, 'paused');
      break;
    case 'resume':
      await updateJobStatus(id, 'queued');
      break;
    case 'retry-failed':
      await resetFailedChapters(job.book_name);
      await updateJobStatus(id, 'queued', null);
      break;
    case 'rerun':
      await resetAllChapters(job.book_name);
      await updateJobStatus(id, 'queued', null);
      break;
    default:
      return NextResponse.json({ error: `Неизвестное действие: ${action}` }, { status: 400 });
  }

  return NextResponse.json(await getJob(id));
}
