# Zeka Books — local-first сервис обработки учебников

PDF / EPUB → Karpathy wiki-чанки → векторная база `dim_textbooks_vector` (Supabase).
Отказоустойчивая обработка любых книг (текст и сканы) фоновым worker-демоном + дашборд в реальном времени.

## Архитектура

```
Dashboard (Next.js, localhost) ──enqueue──▶ Supabase (book_jobs) ◀──claim/process── Worker daemon
        ▲ poll 1s (jobs + events)                   │                                    │ pdf-to-img → Gemini Vision/DeepSeek
        └────────────────────────────────── book_processing_events / sessions ──────────┘ → embed → idempotent upsert
```

- **Worker** не зависит от браузера и таймаутов. При крахе/рестарте — авто-resume с незавершённой главы.
- **Идемпотентность**: `content_hash` + unique index `uq_dim_subject_hash` → повторная вставка чанка игнорируется.
- **Контракт subject**: `lib/normalize.ts` (зеркало `project-zero/src/config/subjects.ts`).

## Запуск (локально, без Vercel)

```bash
npm install
npm run dev:all     # поднимает Next.js (дашборд :3000) + worker одновременно
```

Или по отдельности:

```bash
npm run dev         # только дашборд
npm run worker      # только worker-демон
```

Открой http://localhost:3000 → выбери книгу из «Локальные книги» → «В очередь».
Worker подхватит задание; на дашборде видно статусы глав, шаги и живой лог.

## Переменные окружения (`.env.local`)

```
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Схема БД

`docs/sql/01_jobs_queue.sql` — `book_jobs`, `book_processing_events`, расширение `book_processing_sessions`.
Применяется через Supabase Management API (project-zero).
