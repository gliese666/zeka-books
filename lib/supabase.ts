/**
 * Supabase client + all Books Lab operations:
 * - inject chunks to dim_textbooks_vector
 * - book_processing_sessions (checkpoint / resume)
 * - audit chunks quality
 * - list processed books
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { KarpathyChunk } from '@/lib/ai/deepseek';
import { subjectLang } from '@/lib/normalize';

// Lazy client — created on first call so build-time collection doesn't crash
// when env vars aren't available (e.g. Vercel preview with no secrets set).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient<any> {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase env vars not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    _supabase = createClient(url, key);
  }
  return _supabase;
}

/** Exported for use in API routes that need direct Supabase access. */
export function getSupabaseAdmin(): SupabaseClient<any> { return getSupabase(); }

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'pending' | 'processing' | 'done' | 'error';
export type JobStatus = 'pending_parse' | 'queued' | 'running' | 'paused' | 'done' | 'error' | 'archived';

export interface ChapterMeta {
  title: string;
  pageStart: number;
  pageEnd: number;
}

export interface ChapterSession {
  id: string;
  job_id: string | null;
  book_name: string;
  subject: string;
  chapter_title: string;
  chapter_index: number;
  status: SessionStatus;
  chunks_count: number;
  attempts: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface BookJob {
  id: string;
  book_name: string;
  subject: string;
  file_path: string;
  file_type: 'epub' | 'pdf';
  is_image_based: boolean;
  lang: string | null;
  chapters: ChapterMeta[];
  total_chapters: number;
  total_pages: number;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProcessingEvent {
  id: number;
  job_id: string;
  chapter_index: number | null;
  ts: string;
  level: 'ok' | 'info' | 'warn' | 'error';
  type: string | null;
  msg: string;
  data: Record<string, unknown> | null;
}

export interface BookSummary {
  subject: string;
  total_chunks: number;
  topics: string[];
}

// ── Chunks (dim_textbooks_vector) ─────────────────────────────────────────────

/**
 * content_hash = md5(subject || '|' || topic || '|' || content).
 * Совпадает с Postgres md5() (одинаковые байты UTF-8). См. docs/CONTRACT_TEXTBOOKS.md (project-zero).
 */
export function contentHash(subject: string, topic: string, content: string): string {
  return createHash('md5').update(`${subject}|${topic}|${content}`, 'utf8').digest('hex');
}

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
    lang: subjectLang(subject),
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

  // Идемпотентность: повторная вставка того же чанка молча игнорируется
  // (unique index uq_dim_subject_hash(subject, content_hash), создан в Пакете 1).
  const { error } = await getSupabase()
    .from('dim_textbooks_vector')
    .upsert(
      {
        subject,
        topic,
        content: chunk.content,
        content_hash: contentHash(subject, topic, chunk.content),
        embedding_768: vec768,
        embedding_3072: vec3072,
        metadata: meta,
      },
      { onConflict: 'subject,content_hash', ignoreDuplicates: true }
    );

  if (error) throw new Error(`Supabase inject error: ${error.message}`);
}

// ── Sessions (checkpoint/resume) ──────────────────────────────────────────────

export async function getChapterSession(
  bookName: string,
  chapterIndex: number
): Promise<ChapterSession | null> {
  const { data, error } = await getSupabase()
    .from('book_processing_sessions')
    .select('*')
    .eq('book_name', bookName)
    .eq('chapter_index', chapterIndex)
    .single();

  if (error) return null;
  return data as ChapterSession;
}

export interface SessionOpts {
  chunksCount?: number;
  errorMessage?: string | null;
  jobId?: string;
}

export async function upsertChapterSession(
  bookName: string,
  subject: string,
  chapterTitle: string,
  chapterIndex: number,
  status: SessionStatus,
  opts: SessionOpts = {}
): Promise<void> {
  const payload: Record<string, unknown> = {
    book_name: bookName,
    subject,
    chapter_title: chapterTitle,
    chapter_index: chapterIndex,
    status,
    chunks_count: opts.chunksCount ?? 0,
    error_message: opts.errorMessage ?? null,
  };
  if (opts.jobId) payload.job_id = opts.jobId;
  if (status === 'done' || status === 'error') {
    payload.completed_at = new Date().toISOString();
  }

  const { error } = await getSupabase()
    .from('book_processing_sessions')
    .upsert(payload, { onConflict: 'book_name,chapter_index' });

  // Non-fatal: processing continues without checkpointing if this fails.
  if (error) console.warn(`[books] Session upsert skipped: ${error.message}`);
}

/** Increment the attempts counter for a chapter (best-effort). */
export async function bumpChapterAttempts(bookName: string, chapterIndex: number): Promise<number> {
  const existing = await getChapterSession(bookName, chapterIndex);
  const attempts = (existing?.attempts ?? 0) + 1;
  await getSupabase()
    .from('book_processing_sessions')
    .update({ attempts })
    .eq('book_name', bookName)
    .eq('chapter_index', chapterIndex);
  return attempts;
}

export async function getBookSessions(bookName: string): Promise<ChapterSession[]> {
  const { data, error } = await getSupabase()
    .from('book_processing_sessions')
    .select('*')
    .eq('book_name', bookName)
    .order('chapter_index');

  if (error) return [];
  return (data ?? []) as ChapterSession[];
}

// ── Job queue (book_jobs) ───────────────────────────────────────────────────────

export interface NewJob {
  book_name: string;
  subject: string;
  file_path: string;
  file_type: 'epub' | 'pdf';
  lang: string | null;
  // Optional — if omitted, worker will parse the file (status → 'pending_parse')
  is_image_based?: boolean;
  chapters?: ChapterMeta[];
  total_pages?: number;
}

/**
 * Returns existing active job for the same book_name, or null.
 * "Active" = not done/archived/error — prevents duplicate submissions.
 */
export async function findActiveJobByName(bookName: string): Promise<BookJob | null> {
  const { data } = await getSupabase()
    .from('book_jobs')
    .select('*')
    .eq('book_name', bookName)
    .in('status', ['pending_parse', 'queued', 'running', 'paused'])
    .maybeSingle();
  return (data as BookJob | null) ?? null;
}

export async function createJob(job: NewJob): Promise<BookJob> {
  const hasMeta = (job.chapters?.length ?? 0) > 0;
  const { data, error } = await getSupabase()
    .from('book_jobs')
    .insert({
      ...job,
      chapters: job.chapters ?? [],
      total_chapters: job.chapters?.length ?? 0,
      is_image_based: job.is_image_based ?? false,
      total_pages: job.total_pages ?? 0,
      status: hasMeta ? 'queued' : 'pending_parse',
    })
    .select('*')
    .single();
  if (error) throw new Error(`createJob error: ${error.message}`);
  return data as BookJob;
}

export async function updateJobAfterParse(
  id: string,
  meta: { chapters: ChapterMeta[]; is_image_based: boolean; total_pages: number }
): Promise<void> {
  const { error } = await getSupabase()
    .from('book_jobs')
    .update({
      chapters: meta.chapters,
      total_chapters: meta.chapters.length,
      is_image_based: meta.is_image_based,
      total_pages: meta.total_pages,
      status: 'queued',
    })
    .eq('id', id);
  if (error) throw new Error(`updateJobAfterParse error: ${error.message}`);
}

export async function deleteJob(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('book_jobs')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`deleteJob error: ${error.message}`);
}

export interface JobWithProgress extends BookJob {
  done_chapters: number;
  total_chunks: number;
}

export async function listJobs(limit = 50): Promise<JobWithProgress[]> {
  const { data, error } = await getSupabase()
    .from('book_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  const jobs = (data ?? []) as BookJob[];
  if (!jobs.length) return [];

  // Enrich with per-job progress from chapter checkpoints.
  // Group by book_name (not job_id) so chapters processed in a previous run
  // (with a different job_id) are still counted correctly.
  const { data: sess } = await getSupabase()
    .from('book_processing_sessions')
    .select('book_name, status, chunks_count')
    .in('book_name', jobs.map((j) => j.book_name));

  const done: Record<string, number> = {};
  const chunks: Record<string, number> = {};
  for (const s of sess ?? []) {
    if (!s.book_name) continue;
    if (s.status === 'done') done[s.book_name] = (done[s.book_name] ?? 0) + 1;
    chunks[s.book_name] = (chunks[s.book_name] ?? 0) + (s.chunks_count ?? 0);
  }

  return jobs.map((j) => ({
    ...j,
    done_chapters: done[j.book_name] ?? 0,
    total_chunks: chunks[j.book_name] ?? 0,
  }));
}

export async function getJob(id: string): Promise<BookJob | null> {
  const { data, error } = await getSupabase().from('book_jobs').select('*').eq('id', id).single();
  if (error) return null;
  return data as BookJob;
}

/**
 * Atomically claim the next runnable job: oldest in 'queued' or 'running'
 * (running = resume after a worker crash). Sets status='running'.
 */
export async function claimNextJob(): Promise<BookJob | null> {
  const { data } = await getSupabase()
    .from('book_jobs')
    .select('*')
    .in('status', ['pending_parse', 'queued', 'running'])
    .order('created_at', { ascending: true })
    .limit(1);
  const job = data?.[0] as BookJob | undefined;
  if (!job) return null;

  const patch: Record<string, unknown> = { status: 'running', updated_at: new Date().toISOString() };
  if (!job.started_at) patch.started_at = new Date().toISOString();
  await getSupabase().from('book_jobs').update(patch).eq('id', job.id);
  return { ...job, status: 'running' };
}

export async function updateJobStatus(
  id: string,
  status: JobStatus,
  errorMessage: string | null = null
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (errorMessage !== null) patch.error_message = errorMessage;
  if (status === 'done' || status === 'error') patch.completed_at = new Date().toISOString();
  await getSupabase().from('book_jobs').update(patch).eq('id', id);
}

// ── Live events (book_processing_events) ────────────────────────────────────────

export async function appendEvent(
  jobId: string,
  ev: { level?: string; type?: string | null; msg: string; chapterIndex?: number | null; data?: Record<string, unknown> | null }
): Promise<void> {
  const { error } = await getSupabase().from('book_processing_events').insert({
    job_id: jobId,
    chapter_index: ev.chapterIndex ?? null,
    level: ev.level ?? 'info',
    type: ev.type ?? null,
    msg: ev.msg,
    data: ev.data ?? null,
  });
  if (error) console.warn(`[books] appendEvent skipped: ${error.message}`);
}

export async function getEventsSince(jobId: string, afterId = 0, limit = 500): Promise<ProcessingEvent[]> {
  const { data, error } = await getSupabase()
    .from('book_processing_events')
    .select('*')
    .eq('job_id', jobId)
    .gt('id', afterId)
    .order('id', { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as ProcessingEvent[];
}

/** Recover after a crash: any chapter stuck in 'processing' for this book → 'pending'. */
export async function resetStuckChapters(bookName: string): Promise<void> {
  await getSupabase()
    .from('book_processing_sessions')
    .update({ status: 'pending' })
    .eq('book_name', bookName)
    .eq('status', 'processing');
}

/** Retry-failed: flip only 'error' chapters back to 'pending'. */
export async function resetFailedChapters(bookName: string): Promise<void> {
  await getSupabase()
    .from('book_processing_sessions')
    .update({ status: 'pending', error_message: null })
    .eq('book_name', bookName)
    .eq('status', 'error');
}

/** Full re-run: drop all chapter checkpoints for the book (chunk inject stays idempotent). */
export async function resetAllChapters(bookName: string): Promise<void> {
  await getSupabase().from('book_processing_sessions').delete().eq('book_name', bookName);
}

/** Hard reset: delete all RAG chunks for this subject (full reprocess from scratch). */
export async function deleteChunksBySubject(subject: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from('dim_textbooks_vector')
    .delete()
    .eq('subject', subject)
    .select('id');
  if (error) throw new Error(`deleteChunksBySubject: ${error.message}`);
  return data?.length ?? 0;
}

/** View chunks for a subject (without embeddings — too large to send). */
export interface ChunkRow {
  id: string;
  subject: string;
  topic: string;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
}

export async function getChunksBySubject(subject: string): Promise<ChunkRow[]> {
  const { data, error } = await getSupabase()
    .from('dim_textbooks_vector')
    .select('id, subject, topic, content, content_hash, metadata')
    .eq('subject', subject)
    .order('topic', { ascending: true });
  if (error) {
    console.error('[getChunksBySubject] error:', error.message);
    return [];
  }
  return (data ?? []) as ChunkRow[];
}

// ── Book list ─────────────────────────────────────────────────────────────────

export async function listProcessedBooks(): Promise<BookSummary[]> {
  const { data, error } = await getSupabase()
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
  const { data, error } = await getSupabase()
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
