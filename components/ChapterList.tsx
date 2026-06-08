'use client';

interface Chapter {
  title: string;
  pageStart: number;
  pageEnd: number;
}

type ChapterStatus = {
  [index: number]: 'pending' | 'processing' | 'done' | 'error' | 'skip';
};

interface Props {
  chapters: Chapter[];
  chapterStatuses: ChapterStatus;
  chunkCounts: { [index: number]: number };
  currentChapter: number | null;
  onProcess: () => void;
  onResume: () => void;
  isProcessing: boolean;
  totalChunks: number;
}

const STATUS_ICON: Record<string, string> = {
  done: '✅',
  pending: '⏳',
  processing: '🔄',
  error: '❌',
  skip: '⏭',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--terminal-green)',
  pending: 'var(--body)',
  processing: '#ffbd2e',
  error: '#ff5f56',
  skip: 'var(--mute)',
};

export default function ChapterList({
  chapters,
  chapterStatuses,
  chunkCounts,
  currentChapter,
  onProcess,
  onResume,
  isProcessing,
  totalChunks,
}: Props) {
  const doneCount = Object.values(chapterStatuses).filter((s) => s === 'done').length;
  const allDone = chapters.length > 0 && doneCount === chapters.length;
  const progressPct = chapters.length > 0 ? (doneCount / chapters.length) * 100 : 0;

  return (
    <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>Главы</h2>
          <span style={{ fontSize: 12, background: 'var(--hairline)', borderRadius: 9999, padding: '1px 9px', color: 'var(--body)' }}>
            {chapters.length}
          </span>
        </div>
        <span style={{ fontSize: 12, color: allDone ? 'var(--terminal-green)' : 'var(--mute)', fontWeight: allDone ? 600 : 400 }}>
          {allDone ? `✓ ${totalChunks} чанков` : `${doneCount}/${chapters.length} · ${totalChunks} чанков`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-primary"
          onClick={onProcess}
          disabled={isProcessing || chapters.length === 0}
          style={{ flex: 1 }}
        >
          {isProcessing ? '⏳ Обработка...' : '▶ Обработать всё'}
        </button>
        <button
          className="btn-secondary"
          onClick={onResume}
          disabled={isProcessing || chapters.length === 0}
        >
          ↩ Resume
        </button>
      </div>

      {/* Chapter list */}
      <div style={{ maxHeight: 380, overflowY: 'auto', marginRight: -4, paddingRight: 4 }}>
        {chapters.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--mute)' }}>Выберите книгу из Books Labs</span>
        ) : (
          chapters.map((chapter, i) => {
            const idx1 = i + 1; // statuses stored with 1-based keys
            const status = chapterStatuses[idx1] ?? 'pending';
            const isCurrent = currentChapter === idx1;
            const chunks = chunkCounts[idx1];

            return (
              <div
                key={i}
                className="chapter-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 0',
                  paddingLeft: isCurrent ? 10 : 0,
                  borderLeft: isCurrent ? '3px solid var(--primary)' : '3px solid transparent',
                  transition: 'all 0.2s',
                  background: isCurrent ? 'rgba(0,0,0,0.02)' : 'transparent',
                  borderRadius: isCurrent ? '0 6px 6px 0' : 0,
                }}
              >
                {/* Status icon */}
                <span style={{
                  fontSize: 14, flexShrink: 0,
                  display: 'inline-block',
                  animation: status === 'processing' ? 'spin 1s linear infinite' : 'none',
                }}>
                  {STATUS_ICON[status] ?? '⏳'}
                </span>

                {/* Title + pages */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: isCurrent ? 600 : 400,
                    color: isCurrent ? 'var(--ink)' : STATUS_COLOR[status],
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }} title={chapter.title}>
                    {chapter.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 1 }}>
                    стр. {chapter.pageStart}–{chapter.pageEnd}
                  </div>
                </div>

                {/* Chunk count badge */}
                {status === 'done' && chunks !== undefined && (
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: 'var(--terminal-green)',
                    background: 'rgba(39,201,63,0.1)',
                    borderRadius: 9999,
                    padding: '2px 7px',
                    flexShrink: 0,
                  }}>
                    {chunks}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
