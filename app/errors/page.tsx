'use client';

import { useState, useEffect, useCallback } from 'react';

interface ErrorChapter {
  job_id: string;
  book_name: string;
  subject: string;
  chapter_index: number;
  chapter_title: string | null;
  error_message: string | null;
  attempts: number;
}

interface Job {
  id: string;
  book_name: string;
  subject: string;
  status: string;
  error_message: string | null;
  done_chapters: number;
  total_chapters: number;
  error_chapters: number;
}

const btn = (color: string): React.CSSProperties => ({
  height: 30, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  background: `${color}18`, color, border: `1px solid ${color}40`, cursor: 'pointer',
});

export default function ErrorsPage() {
  const [jobs, setJobs]     = useState<Job[]>([]);
  const [errorChapters, setErrorChapters] = useState<ErrorChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [jr, sr] = await Promise.all([
        fetch('/api/jobs').then(r => r.json()),
        fetch('/api/errors').then(r => r.json()).catch(() => ({ chapters: [] })),
      ]);
      setJobs((jr as Job[]) ?? []);
      setErrorChapters(sr.chapters ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retryChapter = useCallback(async (jobId: string, chapterIndex: number) => {
    await fetch(`/api/errors/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, chapterIndex }),
    });
    setActionMsg(`↻ Глава ${chapterIndex} поставлена на retry`);
    setTimeout(() => setActionMsg(null), 3000);
    load();
  }, [load]);

  const retryJob = useCallback(async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry' }),
    });
    setActionMsg('↻ Все ошибки задания поставлены на retry');
    setTimeout(() => setActionMsg(null), 3000);
    load();
  }, [load]);

  const errorJobs = jobs.filter(j => j.status === 'error' || (j.error_chapters ?? 0) > 0);
  const totalErrors = errorChapters.length;

  // Group errors by job
  const byJob: Record<string, ErrorChapter[]> = {};
  for (const ch of errorChapters) {
    if (!byJob[ch.job_id]) byJob[ch.job_id] = [];
    byJob[ch.job_id].push(ch);
  }

  // Error type analysis
  const errorTypes: Record<string, number> = {};
  for (const ch of errorChapters) {
    const msg = ch.error_message ?? 'Unknown';
    const key = msg.includes('429') ? 'Rate limit (429)'
      : msg.includes('timeout') ? 'Timeout'
      : msg.includes('Vision') ? 'Vision API error'
      : msg.includes('DeepSeek') ? 'DeepSeek error'
      : msg.includes('Supabase') ? 'Supabase inject error'
      : msg.includes('чанков') ? 'Пустой ответ AI'
      : 'Другое';
    errorTypes[key] = (errorTypes[key] ?? 0) + 1;
  }
  const topErrors = Object.entries(errorTypes).sort((a, b) => b[1] - a[1]);
  const maxCount = topErrors[0]?.[1] ?? 1;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* Navbar */}
      <nav style={{
        background: '#0f172a', height: 52, display: 'flex', alignItems: 'center',
        padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
        borderBottom: '1px solid #1e293b',
      }}>
        <div style={{ maxWidth: 1140, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ fontWeight: 700, fontSize: 17, color: '#f8fafc', textDecoration: 'none' }}>📚 Zeka Books</a>
          <span style={{ fontSize: 12, color: '#475569' }}>·</span>
          <a href="/" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none' }}>Дашборд</a>
          <a href="/errors" style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, textDecoration: 'none' }}>🐛 Ошибки</a>
        </div>
      </nav>

      <main style={{ maxWidth: 1140, margin: '0 auto', padding: '28px 24px 80px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>🐛 Ошибки обработки</h1>
          {totalErrors > 0 && (
            <span style={{
              background: '#ef444418', color: '#ef4444', border: '1px solid #ef444440',
              borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 700,
            }}>{totalErrors} гл.</span>
          )}
          <button onClick={load} style={btn('#6366f1')}>↻ Обновить</button>
        </div>

        {actionMsg && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
            padding: '12px 16px', marginBottom: 16, fontSize: 14, color: '#166534',
          }}>{actionMsg}</div>
        )}

        {loading && (
          <div style={{ color: '#94a3b8', fontSize: 14, padding: 40, textAlign: 'center' }}>Загружаю...</div>
        )}

        {!loading && totalErrors === 0 && errorJobs.length === 0 && (
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
            padding: '48px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>Ошибок нет</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>Все книги обработаны успешно</div>
          </div>
        )}

        {/* Top error types */}
        {topErrors.length > 0 && (
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
            padding: 20, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 16px' }}>Топ причин ошибок</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topErrors.map(([type, count]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: '#64748b', width: 200, flexShrink: 0 }}>{type}</span>
                  <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', background: '#ef4444',
                      width: `${(count / maxCount) * 100}%`, borderRadius: 4,
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', width: 24, textAlign: 'right' }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error chapters per job */}
        {Object.entries(byJob).map(([jobId, chapters]) => {
          const job = jobs.find(j => j.id === jobId);
          const bookName = chapters[0]?.book_name ?? jobId;
          return (
            <div key={jobId} style={{
              background: '#fff', border: '1px solid #fecaca', borderRadius: 16,
              padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{bookName}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {chapters[0]?.subject} · {chapters.length} гл. с ошибками
                  </div>
                </div>
                <button onClick={() => retryJob(jobId)} style={btn('#f59e0b')}>↻ Retry всех</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {chapters.map(ch => (
                  <div key={ch.chapter_index} style={{
                    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                    padding: '12px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>
                        Глава {ch.chapter_index + 1}{ch.chapter_title ? `: ${ch.chapter_title}` : ''}
                        {' · '}
                        <span style={{ fontWeight: 400, color: '#b91c1c' }}>attempt {ch.attempts}/3</span>
                      </div>
                      {ch.error_message && (
                        <div style={{
                          fontSize: 12, color: '#7f1d1d', marginTop: 4,
                          fontFamily: 'monospace', wordBreak: 'break-all',
                          maxHeight: 60, overflow: 'hidden',
                        }}>
                          {ch.error_message.slice(0, 300)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => retryChapter(jobId, ch.chapter_index)}
                      style={{ ...btn('#ef4444'), marginLeft: 12, flexShrink: 0 }}
                    >↻ Retry</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Error jobs without chapter details */}
        {errorJobs
          .filter(j => !byJob[j.id])
          .map(j => (
            <div key={j.id} style={{
              background: '#fff', border: '1px solid #fecaca', borderRadius: 16,
              padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{j.book_name}</div>
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{j.error_message ?? 'Задание в статусе error'}</div>
              </div>
              <button onClick={() => retryJob(j.id)} style={btn('#f59e0b')}>↻ Retry</button>
            </div>
          ))}
      </main>
    </div>
  );
}
