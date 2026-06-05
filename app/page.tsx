'use client';

import { useState, useEffect, useCallback } from 'react';
import BookUploader from '@/components/BookUploader';
import ChapterList from '@/components/ChapterList';
import LogsTerminal from '@/components/LogsTerminal';
import BookHistory from '@/components/BookHistory';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chapter {
  title: string;
  pageStart: number;
  pageEnd: number;
}

interface UploadResult {
  fileName: string;
  fileType: 'epub' | 'pdf';
  title: string;
  isImageBased: boolean;
  totalPages: number;
  chapters: Chapter[];
  subject: string;
}

interface LogEntry {
  ts: string;
  msg: string;
  level: 'ok' | 'info' | 'warn' | 'error';
}

interface BookSummary {
  subject: string;
  total_chunks: number;
  topics: string[];
}

type ChapterStatus = Record<number, 'pending' | 'processing' | 'done' | 'error' | 'skip'>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function classifyEvent(type: string): LogEntry['level'] {
  if (type === 'chapter_done' || type === 'embed_done' || type === 'chunk_done') return 'ok';
  if (type === 'error') return 'error';
  if (type === 'retrying') return 'warn';
  return 'info';
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentChapter, setCurrentChapter] = useState<number | null>(null);
  const [chapterStatuses, setChapterStatuses] = useState<ChapterStatus>({});
  const [chunkCounts, setChunkCounts] = useState<Record<number, number>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);

  // Load book history on mount
  useEffect(() => {
    fetch('/api/books').then(r => r.json()).then(setBooks).catch(() => {});
  }, []);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, { ts: now(), msg, level }]);
  }, []);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleUpload = useCallback(async (file: File, subject: string) => {
    setIsUploading(true);
    setUploadResult(null);
    setChapterStatuses({});
    setChunkCounts({});
    setLogs([]);
    setTotalChunks(0);
    addLog(`Загрузка файла: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('subject', subject);

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());

      const data: UploadResult = await res.json();
      setUploadResult(data);
      setUploadedFile(file);

      // Load existing sessions for resume
      const sessRes = await fetch(`/api/sessions?book=${encodeURIComponent(file.name)}`);
      if (sessRes.ok) {
        const sessions = await sessRes.json();
        const statuses: ChapterStatus = {};
        const counts: Record<number, number> = {};
        for (const s of sessions) {
          statuses[s.chapter_index] = s.status;
          if (s.chunks_count) counts[s.chapter_index] = s.chunks_count;
        }
        setChapterStatuses(statuses);
        setChunkCounts(counts);
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        setTotalChunks(total);
      }

      addLog(`✅ Файл разобран: ${data.chapters.length} глав, ${data.totalPages} стр. (${data.isImageBased ? 'image-based' : 'text-based'})`, 'ok');
    } catch (err) {
      addLog(`❌ Ошибка загрузки: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsUploading(false);
    }
  }, [addLog]);

  // ── Process chapters sequentially ──────────────────────────────────────────

  const processChapters = useCallback(async (startFromIdx?: number) => {
    if (!uploadResult || !uploadedFile) return;
    setIsProcessing(true);

    const chapters = uploadResult.chapters;
    const startIdx = startFromIdx ?? 0;

    for (let i = startIdx; i < chapters.length; i++) {
      const ch = chapters[i];
      const idx = i + 1; // 1-based

      // Skip already done chapters
      if (chapterStatuses[idx] === 'done') {
        addLog(`⏭ Гл. ${idx} уже обработана — пропуск`, 'info');
        continue;
      }

      setCurrentChapter(idx);
      setChapterStatuses(prev => ({ ...prev, [idx]: 'processing' }));
      addLog(`\n▶ Глава ${idx}/${chapters.length}: ${ch.title.slice(0, 60)}`, 'info');

      const form = new FormData();
      form.append('file', uploadedFile);
      form.append('subject', uploadResult.subject);
      form.append('chapterTitle', ch.title);
      form.append('chapterIndex', String(idx));
      form.append('pageStart', String(ch.pageStart));
      form.append('pageEnd', String(ch.pageEnd));
      form.append('fileType', uploadResult.fileType);
      form.append('isImageBased', String(uploadResult.isImageBased));
      form.append('bookName', uploadedFile.name);

      try {
        const res = await fetch('/api/process', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              const level = classifyEvent(event.type);
              addLog(event.msg, level);

              if (event.type === 'chapter_done' || event.type === 'chapter_skip') {
                const chunks: number = event.data?.chunks ?? 0;
                setChapterStatuses(prev => ({ ...prev, [idx]: event.type === 'chapter_skip' ? 'skip' : 'done' }));
                setChunkCounts(prev => ({ ...prev, [idx]: chunks }));
                setTotalChunks(prev => prev + chunks);
              }
              if (event.type === 'error') {
                setChapterStatuses(prev => ({ ...prev, [idx]: 'error' }));
              }
            } catch { /* ignore malformed SSE */ }
          }
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`❌ Глава ${idx} провалилась: ${msg}`, 'error');
        setChapterStatuses(prev => ({ ...prev, [idx]: 'error' }));
      }

      // Brief pause between chapters
      if (i < chapters.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    setCurrentChapter(null);
    setIsProcessing(false);
    addLog(`\n🎉 Обработка завершена!`, 'ok');

    // Refresh book history
    fetch('/api/books').then(r => r.json()).then(setBooks).catch(() => {});
  }, [uploadResult, uploadedFile, chapterStatuses, addLog]);

  const handleProcess = () => processChapters(0);

  // Resume = find first non-done chapter
  const handleResume = () => {
    if (!uploadResult) return;
    const firstPending = uploadResult.chapters.findIndex((_, i) => {
      const idx = i + 1;
      return chapterStatuses[idx] !== 'done' && chapterStatuses[idx] !== 'skip';
    });
    processChapters(firstPending >= 0 ? firstPending : 0);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Nav */}
      <nav style={{
        borderBottom: '1px solid var(--hairline)',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
      }}>
        <div className="page-container" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18 }}>
            Zeka Books
          </span>
          <span className="caption-sm" style={{ color: 'var(--mute)' }}>
            PDF · EPUB → Karpathy → Supabase
          </span>
        </div>
      </nav>

      {/* Main */}
      <main style={{ padding: '32px 0 64px' }}>
        <div className="page-container">

          {/* Hero */}
          {!uploadResult && (
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <h1 className="display-xl" style={{ marginBottom: 12 }}>Обработка учебников</h1>
              <p className="body-md">PDF и EPUB → Karpathy wiki-чанки → векторная база знаний Zeka AI</p>
            </div>
          )}

          <div className="two-col">
            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              <BookUploader onUpload={handleUpload} isLoading={isUploading} />

              {uploadResult && (
                <ChapterList
                  chapters={uploadResult.chapters}
                  chapterStatuses={chapterStatuses}
                  chunkCounts={chunkCounts}
                  currentChapter={currentChapter}
                  onProcess={handleProcess}
                  onResume={handleResume}
                  isProcessing={isProcessing}
                  totalChunks={totalChunks}
                />
              )}
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Stats card */}
              {uploadResult && (
                <div className="card" style={{ padding: 20 }}>
                  <p style={{ fontSize: 14, color: 'var(--body)', marginBottom: 8 }}>Обрабатывается</p>
                  <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>{uploadResult.subject}</p>

                  <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                    <div>
                      <p className="caption-sm">Глав</p>
                      <p style={{ fontWeight: 600 }}>{uploadResult.chapters.length}</p>
                    </div>
                    <div>
                      <p className="caption-sm">Чанков</p>
                      <p style={{ fontWeight: 600, color: 'var(--terminal-green)' }}>{totalChunks}</p>
                    </div>
                    <div>
                      <p className="caption-sm">Формат</p>
                      <p style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 12 }}>
                        {uploadResult.fileType} · {uploadResult.isImageBased ? 'Image' : 'Text'}
                      </p>
                    </div>
                  </div>

                  {isProcessing && currentChapter && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span className="caption-sm">Глава {currentChapter}/{uploadResult.chapters.length}</span>
                        <span className="caption-sm">{Math.round((currentChapter / uploadResult.chapters.length) * 100)}%</span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${(currentChapter / uploadResult.chapters.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <LogsTerminal logs={logs} />

              <BookHistory books={books} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
