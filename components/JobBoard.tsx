'use client';

import StatusDot, { type DotStatus } from './StatusDot';

export interface Job {
  id: string;
  book_name: string;
  subject: string;
  status: DotStatus;
  total_chapters: number;
  total_pages: number;
  error_message: string | null;
}

export type JobAction = 'pause' | 'resume' | 'retry-failed' | 'rerun';

interface Props {
  jobs: Job[];
  doneByJob: Record<string, number>;   // chapters done per job id
  chunksByJob: Record<string, number>; // total chunks per job id
  activeId: string | null;
  onSelect: (id: string) => void;
  onAction: (id: string, action: JobAction) => void;
}

export default function JobBoard({ jobs, doneByJob, chunksByJob, activeId, onSelect, onAction }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--body)', margin: 0 }}>
          Очередь пуста. Выбери книгу слева → «В очередь».
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {jobs.map((j) => {
        const done = doneByJob[j.id] ?? 0;
        const pct = j.total_chapters ? Math.round((done / j.total_chapters) * 100) : 0;
        const chunks = chunksByJob[j.id] ?? 0;
        return (
          <div
            key={j.id}
            className={`job-card ${activeId === j.id ? 'job-card--active' : ''}`}
            onClick={() => onSelect(j.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot status={j.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.subject}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mute)' }}>{j.book_name}</div>
              </div>
              <span className="chip">{chunks} чанков</span>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--body)' }}>
                  {done}/{j.total_chapters} глав
                </span>
                <span style={{ fontSize: 12, color: 'var(--body)', fontWeight: 500 }}>{pct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {j.error_message && (
              <div style={{ fontSize: 11, color: 'var(--terminal-red)' }}>{j.error_message}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
              {j.status === 'running' || j.status === 'queued' ? (
                <button className="btn-mini" onClick={() => onAction(j.id, 'pause')}>⏸ Пауза</button>
              ) : (
                <button className="btn-mini" onClick={() => onAction(j.id, 'resume')}>▶ Старт</button>
              )}
              <button className="btn-mini" onClick={() => onAction(j.id, 'retry-failed')}>↻ Ошибки</button>
              <button className="btn-mini" onClick={() => onAction(j.id, 'rerun')}>⟳ Заново</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
