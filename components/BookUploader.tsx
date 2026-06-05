'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

interface Props {
  onUpload: (file: File, subject: string) => void;
  isLoading: boolean;
}

export default function BookUploader({ onUpload, isLoading }: Props) {
  const [subject, setSubject] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file) return;
    setSelectedFile(file);
    if (subject.trim()) {
      onUpload(file, subject.trim());
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isLoading) setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleZoneClick = () => {
    if (!isLoading) inputRef.current?.click();
  };

  const handleUploadClick = () => {
    if (!selectedFile || !subject.trim() || isLoading) return;
    onUpload(selectedFile, subject.trim());
  };

  return (
    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--primary)', margin: 0 }}>
        Загрузить книгу
      </h2>

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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.epub"
          style={{ display: 'none' }}
          onChange={handleChange}
          disabled={isLoading}
        />

        {selectedFile ? (
          <>
            <span style={{ fontSize: '28px' }}>📄</span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--primary)' }}>
              {selectedFile.name}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--body)' }}>
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: '28px' }}>📂</span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--primary)' }}>
              Перетащи PDF или EPUB сюда
            </span>
            <span style={{ fontSize: '13px', color: 'var(--body)' }}>или нажми для выбора</span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--body)',
                background: 'var(--hairline)',
                borderRadius: '999px',
                padding: '2px 10px',
                marginTop: '4px',
              }}
            >
              .pdf · .epub
            </span>
          </>
        )}
      </div>

      {selectedFile && (
        <button
          className="btn-primary"
          onClick={handleUploadClick}
          disabled={!subject.trim() || isLoading}
          style={{ width: '100%' }}
        >
          {isLoading ? '⏳ Обработка...' : '▶ Начать обработку'}
        </button>
      )}
    </div>
  );
}
