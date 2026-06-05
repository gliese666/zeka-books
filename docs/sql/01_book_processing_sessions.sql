-- Run in Supabase Dashboard → SQL Editor
-- Creates checkpoint table for resumable book processing

CREATE TABLE IF NOT EXISTS book_processing_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  book_name       text NOT NULL,
  subject         text NOT NULL,
  chapter_title   text NOT NULL,
  chapter_index   int  NOT NULL,
  status          text DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','error')),
  chunks_count    int  DEFAULT 0,
  error_message   text,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_chapter
  ON book_processing_sessions(book_name, chapter_index);

-- Query index for listing a book's sessions
CREATE INDEX IF NOT EXISTS idx_book_sessions
  ON book_processing_sessions(book_name, chapter_index);

COMMENT ON TABLE book_processing_sessions IS
  'Checkpoint table for Zeka Books — allows resuming book processing from last failed chapter';
