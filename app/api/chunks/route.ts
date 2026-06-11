/**
 * GET /api/chunks?subject=X
 * Returns all RAG chunks for a given subject (no embeddings).
 * Used for "legacy" books that have no book_jobs record.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getChunksBySubject } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const subject = req.nextUrl.searchParams.get('subject');
  if (!subject) return NextResponse.json({ error: 'subject param required' }, { status: 400 });
  try {
    const chunks = await getChunksBySubject(subject);
    return NextResponse.json({ subject, total: chunks.length, chunks });
  } catch (err) {
    console.error('[/api/chunks] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
