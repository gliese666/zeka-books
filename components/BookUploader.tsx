'use client';

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';

interface LocalBook {
  folder: string;
  subject: string;
  filePath: string;
  fileName: string;
  fileType: 'epub' | 'pdf';
  sizeMb: number;
  ragReadyCount: number;
}

interface Props {
  onUpload: (file: File | null, subject: string, filePath?: string) => void;
  isLoading: boolean;
}

type Tab = 'local' | 'upload';

export default function BookUploader({ onUpload, isLoading }: Props) {
  const [tab, setTab] = useState<Tab>('local');
  const [subject, setSubject] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localBooks, setLocalBooks] = useState<LocalBook[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load Books Labs list on mount
  useEffect(() => {
    setLoadingBooks(true);
    fetch('/api/local-books')
      .then(r => r.json())
      .then(data => setLocalBooks(data.books ?? []))
      .catch(() => setLocalBooks([]))
      .finally(() => setLoadingBooks(false));
  }, []);

  // ── Upload tab handlers ──────────────────────────────────────────────────────

  const handleFile = (file: File) => {
    if (!file) return;
    setSelectedFile(file);
    if (subject.trim()) onUpload(file, subject.trim());
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (!isLoading) setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) handleFile(file); };
  const handleZoneClick = () => { if (!isLoading) inputRef.current?.click(); };

  const handleUploadClick = () => {
    if (!selectedFile || !subject.trim() || isLoading) return;
    onUpload(selectedFile, subject.trim());
  };

  // ── Local tab handlers ───────────────────────────────────────────────────────

  const handleLocalSelect = (book: LocalBook) => {
    if (isLoading) return;
    onUpload(null, book.subject, book.filePath);
  };

  return (
    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
        Загрузить книгу
      </h2>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setTab('local')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 9999, fontSize: 13, fontWeight: 500,
            border: tab === 'local' ? '1.5px solid var(--primary)' : '1px solid var(--hairline)',
            background: tab === 'local' ? 'var(--primary)' : 'var(--surface-soft)',
            color: tab === 'local' ? '#fff' : 'var(--body)',
            cursor: 'pointer',
          }}
        >
          📚 Books Labs
        </button>
        <button
          onClick={() => setTab('upload')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 9999, fontSize: 13, fontWeight: 500,
            border: tab === 'upload' ? '1.5px solid var(--primary)' : '1px solid var(--hairline)',
            background: tab === 'upload' ? 'var(--primary)' : 'var(--surface-soft)',
            color: tab === 'upload' ? '#fff' : 'var(--body)',
            cursor: 'pointer',
          }}
        >
          ☁️ Загрузить файл
        </button>
      </div>

      {/* ── LOCAL TAB ── */}
      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loadingBooks ? (
            <p style={{ fontSize: 13, color: 'var(--mute)', textAlign: 'center', padding: '16px 0' }}>
              Загрузка книг...
            </p>
          ) : localBooks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--mute)', textAlign: 'center', padding: '16px 0' }}>
              Books Labs пуст или сайт открыт не локально.<br />
              <span style={{ fontSize: 12 }}>Запусти <code>npm run dev</code> и открой localhost:3000</span>
            </p>
          ) : (
            localBooks.map(book => (
              <div
                key={book.filePath}
                onClick={() => handleLocalSelect(book)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--hairline)',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  background: 'var(--surface-soft)',
                  opacity: isLoading ? 0.5 : 1,
                  transition: 'border-color 0.15s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
                onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--hairline)'; }}
              >
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{book.folder}</p>
                  <p style={{ fontSize: 12, color: 'var(--body)', margin: '2px 0 0' }}>
                    {book.fileName} · {book.sizeMb} MB
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, borderRadius: 9999, padding: '2px 8px',
                    background: book.ragReadyCount > 0 ? 'rgba(39,201,63,0.12)' : 'var(--hairline)',
                    color: book.ragReadyCount > 0 ? 'var(--terminal-green)' : 'var(--mute)',
                    fontWeight: 500,
                  }}>
                    {book.ragReadyCount > 0 ? `${book.ragReadyCount} глав готово` : 'Не обработана'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── UPLOAD TAB ── */}
      {tab === 'upload' && (
        <>
          <input
            className="input-pill"
            type="text"
            placeholder="Название предмета (напр. История Азербайджана 9)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={isLoading}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />

          <div
            className={`upload-zone${dragOver ? ' drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleZoneClick}
            style={{
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
            }}
          >
            <input ref={inputRef} type="file" accept=".pdf,.epub" style={{ display: 'none' }} onChange={handleChange} disabled={isLoading} />
            {selectedFile ? (
              <>
                <span style={{ fontSize: '28px' }}>📄</span>
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--primary)' }}>{selectedFile.name}</span>
                <span style={{ fontSize: '12px', color: 'var(--body)' }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '28px' }}>📂</span>
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--primary)' }}>Перетащи PDF или EPUB сюда</span>
                <span style={{ fontSize: '13px', color: 'var(--body)' }}>или нажми для выбора</span>
                <span style={{ fontSize: '11px', color: 'var(--body)', background: 'var(--hairline)', borderRadius: '999px', padding: '2px 10px', marginTop: '4px' }}>
                  .pdf · .epub
                </span>
              </>
            )}
          </div>

          {selectedFile && (
            <button className="btn-primary" onClick={handleUploadClick} disabled={!subject.trim() || isLoading} style={{ width: '100%' }}>
              {isLoading ? '⏳ Обработка...' : '▶ Начать обработку'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
