/**
 * POST /api/upload-pdf
 * Accepts multipart file upload (PDF or EPUB), saves to Books Labs folder,
 * parses metadata, and enqueues the job — all in one step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { parsePdf } from '@/lib/extract/pdf';
import { parseEpub } from '@/lib/extract/epub';
import { createJob } from '@/lib/supabase';
import { normalizeSubject, subjectLang, folderName } from '@/lib/normalize';

export const dynamic = 'force-dynamic';

const BOOKS_DIR =
  process.env.BOOKS_LAB_DIR ??
  '/Users/akram/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Obsidian/Books Labs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const subjectHint = (form.get('subject') as string | null)?.trim() || null;

    if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });

    const isEpub = file.name.toLowerCase().endsWith('.epub');
    const isPdf  = file.name.toLowerCase().endsWith('.pdf');
    if (!isEpub && !isPdf) {
      return NextResponse.json({ error: 'Поддерживаются только PDF и EPUB' }, { status: 400 });
    }

    const bytes  = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse metadata before saving (fast, validates the file)
    let title: string, isImageBased: boolean, totalPages: number;
    let chapters: { title: string; pageStart: number; pageEnd: number }[];

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
      return NextResponse.json({ error: 'Не удалось определить главы в файле' }, { status: 422 });
    }

    const canonicalSubject = normalizeSubject(subjectHint || title);

    // Save file to Books Labs/<subject> <aze|рус>/00_Raw/
    const dir = path.join(BOOKS_DIR, folderName(canonicalSubject), '00_Raw');
    if (!existsSync(BOOKS_DIR)) {
      return NextResponse.json({ error: `Books Labs папка не найдена: ${BOOKS_DIR}` }, { status: 500 });
    }
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, file.name);
    await writeFile(filePath, buffer);

    // Create and enqueue job
    const job = await createJob({
      book_name: file.name,
      subject: canonicalSubject,
      file_path: filePath,
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
