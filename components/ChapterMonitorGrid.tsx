'use client';

import StatusDot, { type DotStatus } from './StatusDot';

export interface ChapterRow {
  chapter_index: number;
  chapter_title: string;
  status: DotStatus;
  chunks_count: number;
  attempts: number;
}

interface Props {
  chapters: ChapterRow[];
  totalChapters: number;
  activeIndex: number | null;
  onSelect: (idx: number) => void;
}

/** uptime-kuma style grid: one heartbeat tile per chapter. */
export default function ChapterMonitorGrid({ chapters, totalChapters, activeIndex, onSelect }: Props) {
  // Build a dense list 1..totalChapters; chapters without a session row are 'pending'.
  const byIdx = new Map(chapters.map((c) => [c.chapter_index, c]));
  const rows: ChapterRow[] = Array.from({ length: totalChapters }, (_, i) => {
    const idx = i + 1;
    return (
      byIdx.get(idx) ?? {
        chapter_index: idx,
        chapter_title: `Глава ${idx}`,
        status: 'pending' as DotStatus,
        chunks_count: 0,
        attempts: 0,
      }
    );
  });

  return (
    <div className="mon-grid">
      {rows.map((c) => (
        <div
          key={c.chapter_index}
          className={`mon-tile ${activeIndex === c.chapter_index ? 'mon-tile--active' : ''}`}
          onClick={() => onSelect(c.chapter_index)}
        >
          <div className="mon-tile__head">
            <StatusDot status={c.status} />
            <span className="mon-tile__idx">#{c.chapter_index}</span>
          </div>
          <div className="mon-tile__title" title={c.chapter_title}>{c.chapter_title}</div>
          <div className="mon-tile__meta">
            <span>{c.chunks_count} чанк.</span>
            {c.attempts > 1 && <span>↻{c.attempts}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
