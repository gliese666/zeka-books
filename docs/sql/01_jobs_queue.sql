-- 01_jobs_queue.sql — Очередь заданий + живой лог для local-first worker (Zeka Books)
-- ─────────────────────────────────────────────────────────────────────────────
-- Применяется через Supabase Management API из project-zero (там SUPABASE_ACCESS_TOKEN).
-- Идемпотентно (IF NOT EXISTS / guard). Project: dofazpitxcoikamibgaj.
--
-- book_processing_sessions уже существует (создан в project-zero, миграция 11):
--   UNIQUE(book_name, chapter_index). Здесь только добавляем колонки.
-- ─────────────────────────────────────────────────────────────────────────────

-- a) Очередь книг
CREATE TABLE IF NOT EXISTS book_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_name      text NOT NULL,
  subject        text NOT NULL,
  file_path      text NOT NULL,
  file_type      text NOT NULL,                 -- 'pdf' | 'epub'
  is_image_based boolean NOT NULL DEFAULT false,
  lang           text,                          -- 'ru' | 'az'
  chapters       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{title,pageStart,pageEnd}]
  total_chapters int NOT NULL DEFAULT 0,
  total_pages    int NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'queued', -- queued|running|paused|done|error
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_book_jobs_status ON book_jobs(status, created_at);

-- b) Append-only живой лог (дашборд читает «since cursor» по id)
CREATE TABLE IF NOT EXISTS book_processing_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id        uuid REFERENCES book_jobs(id) ON DELETE CASCADE,
  chapter_index int,
  ts            timestamptz NOT NULL DEFAULT now(),
  level         text NOT NULL DEFAULT 'info',   -- ok|info|warn|error
  type          text,                           -- PipelineEventType
  msg           text NOT NULL,
  data          jsonb
);

CREATE INDEX IF NOT EXISTS idx_events_job_id ON book_processing_events(job_id, id);

-- c) Связь чекпойнтов глав с заданием + счётчик попыток
ALTER TABLE book_processing_sessions ADD COLUMN IF NOT EXISTS job_id   uuid;
ALTER TABLE book_processing_sessions ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
