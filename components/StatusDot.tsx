'use client';

export type DotStatus =
  | 'queued' | 'pending' | 'processing' | 'running'
  | 'done' | 'error' | 'paused' | 'skip';

const LABEL: Record<DotStatus, string> = {
  queued: 'В очереди',
  pending: 'Ожидает',
  processing: 'Обработка',
  running: 'Выполняется',
  done: 'Готово',
  error: 'Ошибка',
  paused: 'Пауза',
  skip: 'Пропущено',
};

export default function StatusDot({ status, withLabel = false }: { status: DotStatus; withLabel?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span className={`sdot sdot--${status}`} />
      {withLabel && <span style={{ fontSize: 12, color: 'var(--body)' }}>{LABEL[status]}</span>}
    </span>
  );
}
