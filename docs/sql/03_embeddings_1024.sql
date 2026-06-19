-- Migration 03: Upgrade embeddings to OpenAI text-embedding-3-large 1024D
-- Run this in Supabase SQL editor BEFORE running scripts/reembed-1024.ts
-- Safe to run multiple times (IF NOT EXISTS guards).

-- 1. Add new embedding column (1024D)
ALTER TABLE dim_textbooks_vector
  ADD COLUMN IF NOT EXISTS embedding_1024 vector(1024);

-- 2. HNSW index for fast cosine search on 1024D
--    halfvec cuts index size ~50% with <1% accuracy loss.
CREATE INDEX IF NOT EXISTS idx_dim_embedding_1024_hnsw
  ON dim_textbooks_vector
  USING hnsw ((embedding_1024::halfvec(1024)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. RPC: match_dim_textbooks_1024
--    Drop and recreate (no CREATE OR REPLACE for funcs with different signatures).
DROP FUNCTION IF EXISTS match_dim_textbooks_1024(vector, float, int, text);

CREATE OR REPLACE FUNCTION match_dim_textbooks_1024(
  query_embedding  vector(1024),
  match_threshold  float    DEFAULT 0.5,
  match_count      int      DEFAULT 5,
  filter_subject   text     DEFAULT NULL
)
RETURNS TABLE (
  id               uuid,
  subject          text,
  topic            text,
  content          text,
  metadata         jsonb,
  similarity       float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    subject,
    topic,
    content,
    metadata,
    1 - (embedding_1024 <=> query_embedding) AS similarity
  FROM dim_textbooks_vector
  WHERE
    embedding_1024 IS NOT NULL
    AND (filter_subject IS NULL OR subject = filter_subject)
    AND 1 - (embedding_1024 <=> query_embedding) >= match_threshold
  ORDER BY embedding_1024 <=> query_embedding
  LIMIT match_count;
$$;

-- Grant access to anon and authenticated roles
GRANT EXECUTE ON FUNCTION match_dim_textbooks_1024(vector, float, int, text) TO anon, authenticated, service_role;

-- 4. After running scripts/reembed-1024.ts and verifying all rows filled:
--    (optional) drop old columns to reclaim space
-- ALTER TABLE dim_textbooks_vector DROP COLUMN IF EXISTS embedding_768;
-- ALTER TABLE dim_textbooks_vector DROP COLUMN IF EXISTS embedding_3072;
-- DROP INDEX IF EXISTS idx_dim_embedding_hnsw;  -- old 3072D index if exists
