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
  done: '#27c93f',
  pending: 'var(--body)',
  processing: '#ffbd2e',
  error: '#ff5f56',
  skip: 'var(--body)',
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
  const progressPct = chapters.length > 0 ? (doneCount / chapters.length) * 100 : 0;

  return (
    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
          Главы
        </h2>
        <span
          style={{
            fontSize: '12px',
            background: 'var(--hairline)',
            borderRadius: '999px',
            padding: '2px 10px',
            color: 'var(--body)',
          }}
        >
          {chapters.length}
        </span>
      </div>

      {/* Progress summary */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--body)' }}>
          {doneCount}/{chapters.length} глав · {totalChunks} чанков total
        </span>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${progressPct}%`, transition: 'width 0.3s ease' }}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn-primary"
          onClick={onProcess}
          disabled={isProcessing || chapters.length === 0}
        >
          ▶ Обработать всё
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
      <div
        style={{
          maxHeight: '400px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chapters.length === 0 ? (
          <span style={{ fontSize: '13px', color: 'var(--body)', padding: '12px 0' }}>
            Главы появятся после загрузки книги
          </span>
        ) : (
          chapters.map((chapter, i) => {
            const status = chapterStatuses[i] ?? 'pending';
            const isCurrent = currentChapter === i;
            const chunks = chunkCounts[i];

            return (
              <div
                key={i}
                className="chapter-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 0',
                  borderLeft: isCurrent ? '3px solid var(--primary)' : '3px solid transparent',
                  paddingLeft: isCurrent ? '10px' : '0',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Status icon */}
                <span
                  style={{
                    fontSize: '16px',
                    flexShrink: 0,
                    display: 'inline-block',
                    animation: status === 'processing' ? 'spin 1s linear infinite' : 'none',
                  }}
                >
                  {STATUS_ICON[status] ?? '⏳'}
                </span>

                {/* Title + pages */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: isCurrent ? 600 : 400,
                      color: STATUS_COLOR[status],
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={chapter.title}
                  >
                    {chapter.title.length > 50
                      ? chapter.title.slice(0, 50) + '…'
                      : chapter.title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--body)' }}>
                    стр. {chapter.pageStart}–{chapter.pageEnd}
                  </div>
                </div>

                {/* Chunk count */}
                {status === 'done' && chunks !== undefined && (
                  <span
                    style={{
                      fontSize: '12px',
                      color: '#27c93f',
                      background: '#f0fdf4',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      flexShrink: 0,
                    }}
                  >
                    {chunks} чанков
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
