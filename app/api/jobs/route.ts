/**
 * GET  /api/jobs   — список всех заданий (для дашборда)
 * POST /api/jobs   — поставить книгу в очередь
 *   body (JSON): { filePath: string, subject?: string }
 *   Парсит метаданные книги (главы, image-based), нормализует subject, создаёт book_jobs row.
 *   Дальше обработку ведёт worker-демон (npm run worker) — НЕ этот запрос.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createJob, listJobs } from '@/lib/supabase';
import { normalizeSubject, subjectLang } from '@/lib/normalize';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listJobs());
}

/**
 * POST /api/jobs — создать задание мгновенно, без парсинга файла.
 * Парсинг (JSZip / pdfjs) выполняет worker-демон в фоне — не блокирует UI.
 */
export async function POST(req: NextRequest) {
  try {
    const { filePath, subject } = (await req.json()) as { filePath?: string; subject?: string };

    if (!filePath) {
      return NextResponse.json({ error: 'filePath обязателен' }, { status: 400 });
    }
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      return NextResponse.json({ error: `Файл не найден: ${absPath}` }, { status: 404 });
    }

    const fileName = path.basename(absPath);
    const lc = fileName.toLowerCase();
    const isEpub = lc.endsWith('.epub');
    const isPdf = lc.endsWith('.pdf');
    if (!isEpub && !isPdf) {
      return NextResponse.json({ error: 'Поддерживаются только PDF и EPUB' }, { status: 400 });
    }

    const canonicalSubject = normalizeSubject(subject || fileName);

    // Создаём запись без главы — worker определит структуру при старте (status='pending_parse')
    const job = await createJob({
      book_name: fileName,
      subject: canonicalSubject,
      file_path: absPath,
      file_type: isEpub ? 'epub' : 'pdf',
      lang: subjectLang(canonicalSubject),
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
