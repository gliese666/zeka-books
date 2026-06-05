'use client';

import { useEffect, useRef } from 'react';

interface LogEntry {
  ts: string;
  msg: string;
  level: 'ok' | 'info' | 'warn' | 'error';
}

interface Props {
  logs: LogEntry[];
}

export default function LogsTerminal({ logs }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="terminal-card">
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="terminal-dots">
          <span className="dot-red" />
          <span className="dot-yellow" />
          <span className="dot-green" />
        </div>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--on-dark-mute, #6b7280)',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            letterSpacing: '0.02em',
          }}
        >
          Processing Logs
        </span>
      </div>

      {/* Log body */}
      <div
        ref={bodyRef}
        className="terminal-body"
        style={{ overflowY: 'auto' }}
      >
        {logs.length === 0 ? (
          <span
            style={{
              color: 'var(--on-dark-mute, #6b7280)',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: '13px',
            }}
          >
            Логи появятся при запуске обработки...
          </span>
        ) : (
          logs.map((entry, i) => (
            <div key={i} style={{ lineHeight: '1.6' }}>
              <span className={`log-${entry.level}`}>
                [{entry.ts}] {entry.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
