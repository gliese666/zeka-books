/**
 * GET /api/errors
 * Returns all error chapters across all jobs — for the /errors dashboard page.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('book_processing_sessions')
    .select('job_id, book_name, subject, chapter_index, chapter_title, status, error_message, attempts')
    .eq('status', 'error')
    .order('job_id')
    .order('chapter_index');

  if (error) {
    return NextResponse.json({ error: error.message, chapters: [] }, { status: 500 });
  }

  return NextResponse.json({ chapters: data ?? [] });
}
