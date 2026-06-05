import { NextResponse } from 'next/server';
import { listProcessedBooks } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const books = await listProcessedBooks();
  return NextResponse.json(books);
}
