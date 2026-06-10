'use client';

export interface LocalBook {
  folder: string;
  subject: string;
  filePath: string;
  fileName: string;
  fileType: 'epub' | 'pdf';
  sizeMb: number;
  ragReadyCount: number;
}

interface Props {
  books: LocalBook[];
  enqueuingPath: string | null;
  onEnqueue: (book: LocalBook) => void;
}

export default function LocalBooksPanel({ books, enqueuingPath, onEnqueue }: Props) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
        Локальные книги (Books Labs)
      </h3>

      {books.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--body)', margin: 0 }}>
          Папка Books Labs пуста или недоступна.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {books.map((b) => (
            <div
              key={b.filePath}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--hairline)',
              }}
            >
              <span style={{ fontSize: 18 }}>{b.fileType === 'pdf' ? '📕' : '📗'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.subject}>
                  {b.subject}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mute)' }}>
                  {b.fileType.toUpperCase()} · {b.sizeMb}MB
                  {b.ragReadyCount > 0 && <span style={{ color: 'var(--terminal-green)' }}> · {b.ragReadyCount} чанков в RAG</span>}
                </div>
              </div>
              <button
                className="btn-mini"
                disabled={enqueuingPath === b.filePath}
                onClick={() => onEnqueue(b)}
              >
                {enqueuingPath === b.filePath ? '...' : 'В очередь'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
