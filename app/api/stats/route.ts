/**
 * GET /api/stats
 * Aggregate stats: books in RAG, total chunks, running/error jobs, chunks per subject.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sb = getSupabaseAdmin();

    const [chunksRes, jobsRes] = await Promise.all([
      sb.from('dim_textbooks_vector').select('subject, content_hash'),
      sb.from('book_jobs').select('status, subject, book_name'),
    ]);

    const chunks = chunksRes.data ?? [];
    const jobs   = jobsRes.data  ?? [];

    // Per-subject chunk counts
    const bySubject: Record<string, number> = {};
    for (const row of chunks) {
      bySubject[row.subject] = (bySubject[row.subject] ?? 0) + 1;
    }

    const totalBooks  = Object.keys(bySubject).length;
    const totalChunks = chunks.length;
    const running     = jobs.filter((j) => j.status === 'running').length;
    const errors      = jobs.filter((j) => j.status === 'error').length;
    const queued      = jobs.filter((j) => j.status === 'queued').length;

    return NextResponse.json({ totalBooks, totalChunks, running, errors, queued, bySubject });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
