/**
 * POST /api/upload-pdf
 * Saves uploaded PDF/EPUB to Books Labs folder and enqueues a job instantly.
 * Heavy parsing (chapters, image detection) is done by the worker daemon.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createJob, findActiveJobByName } from '@/lib/supabase';
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

    const canonicalSubject = normalizeSubject(subjectHint || file.name.replace(/\.(epub|pdf)$/i, ''));

    // ── Duplicate guard ───────────────────────────────────────────────────────
    // If an active job for the same file already exists — return it, don't create another.
    const existing = await findActiveJobByName(file.name);
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    // ── Save file (no parsing — worker handles it) ────────────────────────────
    if (!existsSync(BOOKS_DIR)) {
      return NextResponse.json({ error: `Books Labs папка не найдена: ${BOOKS_DIR}` }, { status: 500 });
    }

    const dir = path.join(BOOKS_DIR, folderName(canonicalSubject), '00_Raw');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, file.name);

    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // ── Enqueue instantly (status = pending_parse) ────────────────────────────
    const job = await createJob({
      book_name: file.name,
      subject: canonicalSubject,
      file_path: filePath,
      file_type: isEpub ? 'epub' : 'pdf',
      lang: subjectLang(canonicalSubject),
      // chapters NOT passed → worker parses on first run
    });

    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
