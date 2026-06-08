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
  activeFilePath?: string; // currently selected/loaded book
}

type Tab = 'local' | 'upload';

export default function BookUploader({ onUpload, isLoading, activeFilePath }: Props) {
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

  // ── Upload tab handlers ─────────────────────────────────────────────────────

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

  // ── Local tab handlers ──────────────────────────────────────────────────────

  const handleLocalSelect = (book: LocalBook) => {
    if (isLoading) return;
    onUpload(null, book.subject, book.filePath);
  };

  const title = tab === 'local' ? '📚 Books Labs' : '☁️ Загрузить файл';

  return (
    <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
        {title}
      </h2>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, background: 'var(--surface-soft)', borderRadius: 9999, padding: 3 }}>
        {(['local', 'upload'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 9999, fontSize: 13, fontWeight: 500,
              border: 'none',
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? 'var(--ink)' : 'var(--body)',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t === 'local' ? '📚 Books Labs' : '☁️ Загрузить'}
          </button>
        ))}
      </div>

      {/* ── LOCAL TAB ── */}
      {tab === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loadingBooks ? (
            <p style={{ fontSize: 13, color: 'var(--mute)', textAlign: 'center', padding: '20px 0', margin: 0 }}>
              Загрузка списка книг...
            </p>
          ) : localBooks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ fontSize: 13, color: 'var(--mute)', margin: '0 0 4px' }}>Books Labs пуст</p>
              <p style={{ fontSize: 12, color: 'var(--mute)', margin: 0 }}>
                Запусти <code style={{ background: 'var(--hairline)', padding: '1px 5px', borderRadius: 4 }}>npm run dev</code> и открой localhost:3000
              </p>
            </div>
          ) : (
            localBooks.map(book => {
              const isActive = activeFilePath === book.filePath;
              const isCurrentlyLoading = isLoading && isActive;
              return (
                <div
                  key={book.filePath}
                  onClick={() => handleLocalSelect(book)}
                  style={{
                    padding: '11px 14px',
                    borderRadius: 10,
                    border: isActive
                      ? '1.5px solid var(--terminal-green)'
                      : '1px solid var(--hairline)',
                    cursor: isLoading ? (isActive ? 'wait' : 'not-allowed') : 'pointer',
                    background: isActive ? 'rgba(39,201,63,0.04)' : 'var(--surface-soft)',
                    opacity: isLoading && !isActive ? 0.45 : 1,
                    transition: 'all 0.15s',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                  onMouseEnter={e => {
                    if (!isLoading && !isActive)
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--hairline)';
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, margin: 0, color: isActive ? 'var(--ink)' : 'var(--ink)' }}>
                      {book.folder}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--mute)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {book.fileName} · {book.sizeMb} MB
                    </p>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {isCurrentlyLoading ? (
                      <span style={{ fontSize: 11, color: 'var(--mute)' }}>⏳</span>
                    ) : (
                      <span style={{
                        fontSize: 11, borderRadius: 9999, padding: '2px 8px', fontWeight: 500,
                        background: book.ragReadyCount > 0 ? 'rgba(39,201,63,0.12)' : 'var(--hairline)',
                        color: book.ragReadyCount > 0 ? 'var(--terminal-green)' : 'var(--mute)',
                      }}>
                        {book.ragReadyCount > 0 ? `${book.ragReadyCount} чанков` : 'Не обработана'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
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
