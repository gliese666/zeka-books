import { NextResponse } from 'next/server';
import { listProcessedBooks } from '@/lib/supabase';

export async function GET() {
  const books = await listProcessedBooks();
  return NextResponse.json(books);
}
