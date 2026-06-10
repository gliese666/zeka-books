/**
 * GET /api/jobs/[id]/chunks
 * Возвращает все чанки из dim_textbooks_vector для subject этого задания.
 * Эмбеддинги не передаются (слишком большие).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, getChunksBySubject } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'Job не найден' }, { status: 404 });
  const chunks = await getChunksBySubject(job.subject);
  return NextResponse.json({ subject: job.subject, total: chunks.length, chunks });
}
