/**
 * Supabase client + all Books Lab operations:
 * - inject chunks to dim_textbooks_vector
 * - book_processing_sessions (checkpoint / resume)
 * - audit chunks quality
 * - list processed books
 */

import { createClient } from '@supabase/supabase-js';
import type { KarpathyChunk } from '@/lib/ai/deepseek';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'pending' | 'processing' | 'done' | 'error';

export interface ChapterSession {
  id: string;
  book_name: string;
  subject: string;
  chapter_title: string;
  chapter_index: number;
  status: SessionStatus;
  chunks_count: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface BookSummary {
  subject: string;
  total_chunks: number;
  topics: string[];
}

// ── Chunks (dim_textbooks_vector) ─────────────────────────────────────────────

export async function injectChunk(
  subject: string,
  topic: string,
  chunk: KarpathyChunk,
  vec768: number[],
  vec3072: number[]
): Promise<void> {
  const meta = {
    type: 'wiki',
    engine: 'zeka-books + Gemini Vision / DeepSeek V4 Pro',
    title: chunk.title,
    concepts: chunk.concepts ?? [],
    key_figures: chunk.key_figures ?? [],
    key_dates: chunk.key_dates ?? [],
    example_pattern: chunk.example_pattern ?? '',
    misconceptions: chunk.misconceptions ?? [],
    prerequisites: chunk.prerequisites ?? [],
    difficulty: chunk.difficulty ?? 3,
    bloom_level: chunk.bloom_level ?? '',
    concept_type: chunk.concept_type ?? '',
  };

  const { error } = await supabase
    .from('dim_textbooks_vector')
    .insert({
      subject,
      topic,
      content: chunk.content,
      embedding_768: vec768,
      embedding_3072: vec3072,
      metadata: meta,
    });

  if (error) throw new Error(`Supabase inject error: ${error.message}`);
}

// ── Sessions (checkpoint/resume) ──────────────────────────────────────────────

export async function getChapterSession(
  bookName: string,
  chapterIndex: number
): Promise<ChapterSession | null> {
  const { data, error } = await supabase
    .from('book_processing_sessions')
    .select('*')
    .eq('book_name', bookName)
    .eq('chapter_index', chapterIndex)
    .single();

  if (error) return null;
  return data as ChapterSession;
}

export async function upsertChapterSession(
  bookName: string,
  subject: string,
  chapterTitle: string,
  chapterIndex: number,
  status: SessionStatus,
  chunksCount = 0,
  errorMessage: string | null = null
): Promise<void> {
  const payload: Partial<ChapterSession> & {
    book_name: string;
    subject: string;
    chapter_title: string;
    chapter_index: number;
    status: SessionStatus;
    chunks_count: number;
    error_message: string | null;
    completed_at?: string | null;
  } = {
    book_name: bookName,
    subject,
    chapter_title: chapterTitle,
    chapter_index: chapterIndex,
    status,
    chunks_count: chunksCount,
    error_message: errorMessage,
  };

  if (status === 'done' || status === 'error') {
    payload.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('book_processing_sessions')
    .upsert(payload, {
      onConflict: 'book_name,chapter_index',
    });

  // Non-fatal: table may not exist yet (SQL migration pending). Processing continues without checkpointing.
  if (error) console.warn(`[books] Session upsert skipped: ${error.message}`);
}

export async function getBookSessions(bookName: string): Promise<ChapterSession[]> {
  const { data, error } = await supabase
    .from('book_processing_sessions')
    .select('*')
    .eq('book_name', bookName)
    .order('chapter_index');

  if (error) return [];
  return (data ?? []) as ChapterSession[];
}

// ── Book list ─────────────────────────────────────────────────────────────────

export async function listProcessedBooks(): Promise<BookSummary[]> {
  const { data, error } = await supabase
    .from('dim_textbooks_vector')
    .select('subject, topic');

  if (error || !data) return [];

  const map = new Map<string, Set<string>>();
  for (const row of data) {
    if (!map.has(row.subject)) map.set(row.subject, new Set());
    map.get(row.subject)!.add(row.topic);
  }

  return Array.from(map.entries()).map(([subject, topics]) => ({
    subject,
    total_chunks: data.filter(r => r.subject === subject).length,
    topics: Array.from(topics),
  }));
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditResult {
  topic: string;
  total: number;
  ok: number;
  issues: Array<{ title: string; problems: string[] }>;
  passed: boolean;
}

export async function auditChapter(subject: string, topic: string): Promise<AuditResult> {
  const { data, error } = await supabase
    .from('dim_textbooks_vector')
    .select('content, metadata')
    .eq('subject', subject)
    .eq('topic', topic);

  if (error || !data) return { topic, total: 0, ok: 0, issues: [], passed: false };

  const issues: Array<{ title: string; problems: string[] }> = [];

  for (const row of data) {
    const content: string = row.content ?? '';
    const meta = row.metadata ?? {};
    const title: string = meta.title ?? '?';
    const problems: string[] = [];

    // Check for required sections (humanities or STEM)
    const hasHumanitiesSections = content.includes('## Контекст') && content.includes('## Суть');
    const hasStemSections = content.includes('## Интуиция') && content.includes('## Теория');
    if (!hasHumanitiesSections && !hasStemSections) {
      problems.push('отсутствуют обязательные секции (## Контекст/Суть или ## Интуиция/Теория)');
    }
    if (!meta.misconceptions?.length) problems.push('misconceptions пусты');
    if (!meta.bloom_level) problems.push('bloom_level пуст');
    if (!meta.concept_type) problems.push('concept_type пуст');
    if (content.length < 200) problems.push(`content слишком короткий (${content.length} chars)`);

    if (problems.length) issues.push({ title, problems });
  }

  return {
    topic,
    total: data.length,
    ok: data.length - issues.length,
    issues,
    passed: issues.length === 0 && data.length > 0,
  };
}
