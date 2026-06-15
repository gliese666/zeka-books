/**
 * GET  /api/jobs   — список всех заданий (для дашборда)
 * POST /api/jobs   — поставить книгу в очередь
 *   body (JSON): { filePath: string, subject?: string }
 *   Парсит метаданные книги (главы, image-based), нормализует subject, создаёт book_jobs row.
 *   Дальше обработку ведёт worker-демон (npm run worker) — НЕ этот запрос.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseEpub } from '@/lib/extract/epub';
import { parsePdf } from '@/lib/extract/pdf';
import { createJob, listJobs, type ChapterMeta } from '@/lib/supabase';
import { normalizeSubject, subjectLang } from '@/lib/normalize';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listJobs());
}

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
    const isEpub = fileName.toLowerCase().endsWith('.epub');
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    if (!isEpub && !isPdf) {
      return NextResponse.json({ error: 'Поддерживаются только PDF и EPUB' }, { status: 400 });
    }

    const buffer = fs.readFileSync(absPath);

    let title: string, isImageBased: boolean, totalPages: number, chapters: ChapterMeta[];
    if (isEpub) {
      const m = await parseEpub(buffer);
      title = m.title; isImageBased = m.isImageBased; totalPages = m.totalPages;
      chapters = m.chapters.map((c) => ({ title: c.title, pageStart: c.pageStart, pageEnd: c.pageEnd }));
    } else {
      const m = await parsePdf(buffer);
      title = m.title; isImageBased = m.isImageBased; totalPages = m.totalPages;
      chapters = m.suggestedChapters.map((c) => ({ title: c.title, pageStart: c.pageStart, pageEnd: c.pageEnd }));
    }

    if (!chapters.length) {
      return NextResponse.json({ error: 'Не удалось определить главы книги' }, { status: 422 });
    }

    // Канонический subject (контракт): срезаем языковой суффикс.
    const canonicalSubject = normalizeSubject(subject || title);

    const job = await createJob({
      book_name: fileName,
      subject: canonicalSubject,
      file_path: absPath,
      file_type: isEpub ? 'epub' : 'pdf',
      is_image_based: isImageBased,
      lang: subjectLang(canonicalSubject),
      chapters,
      total_pages: totalPages,
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
