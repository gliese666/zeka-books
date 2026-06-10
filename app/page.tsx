'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import LocalBooksPanel, { type LocalBook } from '@/components/LocalBooksPanel';
import JobBoard, { type Job, type JobAction } from '@/components/JobBoard';
import ChapterMonitorGrid, { type ChapterRow } from '@/components/ChapterMonitorGrid';
import StatusDot, { type DotStatus } from '@/components/StatusDot';
import LogsTerminal from '@/components/LogsTerminal';

// ── Types ─────────────────────────────────────────────────────────────────────
interface JobListItem extends Job {
  done_chapters: number;
  total_chunks: number;
  updated_at: string;
}
interface ProcessingEvent {
  id: number;
  chapter_index: number | null;
  ts: string;
  level: 'ok' | 'info' | 'warn' | 'error';
  type: string | null;
  msg: string;
}
interface JobFull {
  id: string;
  book_name: string;
  subject: string;
  status: DotStatus;
  file_type: 'epub' | 'pdf';
  is_image_based: boolean;
  total_chapters: number;
  total_pages: number;
}
interface JobDetail {
  job: JobFull;
  chapters: ChapterRow[];
}

const POLL_MS = 1000;

function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Map latest event type → pipeline step index for the StepTimeline.
const STEPS = ['Извлечение', 'Чанкинг (AI)', 'Эмбеддинг', 'Запись в Supabase'];
function stepFromEventType(type: string | null): number {
  if (!type) return -1;
  if (type.startsWith('extract')) return 0;
  if (type.startsWith('chunk')) return 1;
  if (type.startsWith('embed')) return 2;
  if (type === 'supabase_inject' || type === 'chapter_done') return 3;
  return -1;
}

export default function HomePage() {
  const [localBooks, setLocalBooks] = useState<LocalBook[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [events, setEvents] = useState<ProcessingEvent[]>([]);
  const [enqueuingPath, setEnqueuingPath] = useState<string | null>(null);

  const cursorRef = useRef(0);

  // ── Load local books once ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/local-books').then((r) => r.json()).then((d) => setLocalBooks(d.books ?? [])).catch(() => {});
  }, []);

  // ── Poll jobs + selected detail + events every 1s ────────────────────────
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const list: JobListItem[] = await fetch('/api/jobs').then((r) => r.json());
        if (alive) setJobs(list);

        if (selectedJobId) {
          const d: JobDetail = await fetch(`/api/jobs/${selectedJobId}`).then((r) => r.json());
          if (alive) setDetail(d);

          const { events: evs }: { events: ProcessingEvent[] } = await fetch(
            `/api/jobs/${selectedJobId}/events?after=${cursorRef.current}`
          ).then((r) => r.json());
          if (alive && evs?.length) {
            cursorRef.current = evs[evs.length - 1].id;
            setEvents((prev) => [...prev, ...evs]);
          }
        }
      } catch { /* transient — keep polling */ }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [selectedJobId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const selectJob = useCallback((id: string) => {
    setSelectedJobId(id);
    setSelectedChapter(null);
    setEvents([]);
    cursorRef.current = 0;
  }, []);

  const enqueue = useCallback(async (book: LocalBook) => {
    setEnqueuingPath(book.filePath);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: book.filePath, subject: book.subject }),
      });
      const job = await res.json();
      if (res.ok && job?.id) selectJob(job.id);
    } finally {
      setEnqueuingPath(null);
    }
  }, [selectJob]);

  const jobAction = useCallback(async (id: string, action: JobAction) => {
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const doneByJob: Record<string, number> = Object.fromEntries(jobs.map((j) => [j.id, j.done_chapters]));
  const chunksByJob: Record<string, number> = Object.fromEntries(jobs.map((j) => [j.id, j.total_chunks]));

  const logs = events.map((e) => ({ ts: hhmmss(e.ts), msg: e.msg, level: e.level }));

  // Live step for the currently processing chapter.
  const lastEvent = events[events.length - 1];
  const currentStep = stepFromEventType(lastEvent?.type ?? null);
  const isRunning = detail?.job.status === 'running';

  // Derive progress from chapter checkpoints (detail endpoint returns raw job).
  const detailDone = detail ? detail.chapters.filter((c) => c.status === 'done').length : 0;
  const detailChunks = detail ? detail.chapters.reduce((s, c) => s + (c.chunks_count ?? 0), 0) : 0;

  const workerLikelyUp = jobs.some((j) => j.status === 'running') &&
    !!lastEvent && Date.now() - new Date(lastEvent.ts).getTime() < 15000;

  return (
    <>
      <nav style={{ borderBottom: '1px solid var(--hairline)', height: 56, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>Zeka Books · Worker</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className={`sdot sdot--${workerLikelyUp ? 'running' : 'pending'}`} />
            <span className="caption-sm">{workerLikelyUp ? 'Worker активен' : 'Worker: запусти npm run dev:all'}</span>
          </span>
        </div>
      </nav>

      <main style={{ padding: '24px 24px 64px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24 }}>

          {/* Left: queue control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <LocalBooksPanel books={localBooks} enqueuingPath={enqueuingPath} onEnqueue={enqueue} />
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Очередь</h3>
              <JobBoard
                jobs={jobs}
                doneByJob={doneByJob}
                chunksByJob={chunksByJob}
                activeId={selectedJobId}
                onSelect={selectJob}
                onAction={jobAction}
              />
            </div>
          </div>

          {/* Right: live monitor of selected job */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {!detail ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <p className="body-md" style={{ margin: 0 }}>Выбери задание в очереди, чтобы видеть обработку в реальном времени.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <StatusDot status={detail.job.status} withLabel />
                    <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 4 }}>{detail.job.subject}</span>
                    <span className="chip" style={{ marginLeft: 'auto' }}>{detail.job.file_type?.toUpperCase?.() ?? ''}{detail.job.is_image_based ? ' · image' : ' · text'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--hairline)' }}>
                    {[
                      { label: 'Глав', value: `${detailDone}/${detail.job.total_chapters}` },
                      { label: 'Чанков', value: detailChunks },
                      { label: 'Страниц', value: detail.job.total_pages },
                    ].map((s, i) => (
                      <div key={s.label} style={{ flex: 1, padding: '10px 0', textAlign: 'center', borderRight: i < 2 ? '1px solid var(--hairline)' : 'none', background: 'var(--surface-soft)' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 3 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Step timeline */}
                  {isRunning && currentStep >= 0 && (
                    <div style={{ marginTop: 12 }}>
                      {STEPS.map((name, i) => (
                        <div className="step-row" key={name}>
                          <StatusDot status={i < currentStep ? 'done' : i === currentStep ? 'processing' : 'pending'} />
                          <span className="step-row__name">{name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chapter monitor grid */}
                <div className="card" style={{ padding: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Главы</h3>
                  <ChapterMonitorGrid
                    chapters={detail.chapters}
                    totalChapters={detail.job.total_chapters}
                    activeIndex={selectedChapter}
                    onSelect={setSelectedChapter}
                  />
                </div>

                {/* Live log (filtered to chapter if one selected) */}
                <LogsTerminal
                  logs={
                    selectedChapter
                      ? events.filter((e) => e.chapter_index === selectedChapter).map((e) => ({ ts: hhmmss(e.ts), msg: e.msg, level: e.level }))
                      : logs
                  }
                />
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
