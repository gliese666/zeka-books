'use client';

interface BookSummary {
  subject: string;
  total_chunks: number;
  topics: string[];
}

interface Props {
  books: BookSummary[];
}

export default function BookHistory({ books }: Props) {
  return (
    <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
        Обработанные книги
      </h3>

      {books.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--body)', margin: 0 }}>
          Нет обработанных книг
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {books.map((book, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 0',
                borderBottom: i < books.length - 1 ? '1px solid var(--hairline)' : 'none',
              }}
            >
              {/* Book icon */}
              <span style={{ fontSize: '18px', flexShrink: 0 }}>📗</span>

              {/* Title + topic count */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={book.subject}
                >
                  {book.subject}
                </div>
                {book.topics.length > 0 && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--body)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {book.topics.slice(0, 3).join(' · ')}
                    {book.topics.length > 3 ? ` +${book.topics.length - 3}` : ''}
                  </div>
                )}
              </div>

              {/* Badges */}
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--body)',
                    background: 'var(--hairline)',
                    borderRadius: '999px',
                    padding: '2px 8px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {book.total_chunks} чанков
                </span>
                {book.topics.length > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--body)',
                      background: 'var(--hairline)',
                      borderRadius: '999px',
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {book.topics.length} тем
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
