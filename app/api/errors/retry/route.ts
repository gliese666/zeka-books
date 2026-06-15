/**
 * POST /api/errors/retry
 * Retry a specific error chapter: flip status back to 'pending', job back to 'queued'.
 * Body: { jobId: string; chapterIndex: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { jobId, chapterIndex } = await req.json();
  if (!jobId || chapterIndex === undefined) {
    return NextResponse.json({ error: 'jobId and chapterIndex required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Reset the specific chapter to pending
  const { error: sesErr } = await supabase
    .from('book_processing_sessions')
    .update({ status: 'pending', error_message: null })
    .eq('job_id', jobId)
    .eq('chapter_index', chapterIndex);

  if (sesErr) return NextResponse.json({ error: sesErr.message }, { status: 500 });

  // Set job status back to queued so worker picks it up
  await supabase
    .from('book_jobs')
    .update({ status: 'queued', error_message: null, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  return NextResponse.json({ ok: true });
}
