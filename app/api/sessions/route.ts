import { NextRequest, NextResponse } from 'next/server';
import { getBookSessions } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const bookName = req.nextUrl.searchParams.get('book');
  if (!bookName) return NextResponse.json({ error: 'book param required' }, { status: 400 });
  const sessions = await getBookSessions(bookName);
  return NextResponse.json(sessions);
}
