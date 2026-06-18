/**
 * GET    /api/errors  — ошибки глав только из последнего job'а каждой книги
 * DELETE /api/errors?jobId=xxx  — удалить все error-сессии job'а (dismiss)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getSupabaseAdmin();

  // 1. Найти последний job для каждой книги (по created_at)
  const { data: jobs, error: jobsErr } = await supabase
    .from('book_jobs')
    .select('id, book_name')
    .order('created_at', { ascending: false });

  if (jobsErr) return NextResponse.json({ error: jobsErr.message, chapters: [] }, { status: 500 });

  // Берём только первый (последний) job_id на каждую book_name
  const latestJobIds: string[] = [];
  const seen = new Set<string>();
  for (const j of jobs ?? []) {
    if (!seen.has(j.book_name)) {
      seen.add(j.book_name);
      latestJobIds.push(j.id);
    }
  }

  if (!latestJobIds.length) return NextResponse.json({ chapters: [] });

  // 2. Ошибки только из последних job'ов
  const { data, error } = await supabase
    .from('book_processing_sessions')
    .select('job_id, book_name, subject, chapter_index, chapter_title, status, error_message, attempts')
    .eq('status', 'error')
    .in('job_id', latestJobIds)
    .order('job_id')
    .order('chapter_index');

  if (error) return NextResponse.json({ error: error.message, chapters: [] }, { status: 500 });

  return NextResponse.json({ chapters: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId обязателен' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('book_processing_sessions')
    .delete()
    .eq('job_id', jobId)
    .eq('status', 'error');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
